"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { agreementSettingsSchema } from "@/lib/agreements";
import { connectDB } from "@/lib/db";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import { parseForm, type ActionState } from "@/lib/validation";
import { APP_SETTINGS_KEY, AppSettings } from "@/models/AppSettings";

/** Saves the agreement renewal reminder threshold (days before end), then re-syncs notifications. */
export async function saveAgreementSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(agreementSettingsSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  await AppSettings.updateOne({ key: APP_SETTINGS_KEY }, { $set: parsed.data }, { upsert: true });
  await syncNotificationsSafe({ force: true });
  revalidatePath("/", "layout");
  return { ok: true, message: "Agreement settings saved." };
}
