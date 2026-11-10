"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { parseForm, type ActionState } from "@/lib/validation";
import { wifiSettingsSchema } from "@/lib/wifi-validation";
import { APP_SETTINGS_KEY, AppSettings } from "@/models/AppSettings";

/** Saves the WiFi price per person. Existing plans keep their own rate; new or changed plans use this. */
export async function saveWifiSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(wifiSettingsSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  await AppSettings.updateOne({ key: APP_SETTINGS_KEY }, { $set: parsed.data }, { upsert: true });
  revalidatePath("/settings");
  revalidatePath("/rentals", "layout");
  return { ok: true, message: `WiFi price set to ${formatMoney(parsed.data.wifiRatePerPerson)} per person.` };
}
