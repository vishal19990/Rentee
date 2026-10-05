"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { landlordSettingsSchema } from "@/lib/receipts";
import { upiSettingsSchema } from "@/lib/upi";
import { parseForm, type ActionState } from "@/lib/validation";
import { APP_SETTINGS_KEY, AppSettings } from "@/models/AppSettings";

/** Saves the landlord details printed on rent receipts (F1). */
export async function saveLandlordSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(landlordSettingsSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  await AppSettings.updateOne({ key: APP_SETTINGS_KEY }, { $set: parsed.data }, { upsert: true });
  revalidatePath("/settings");
  revalidatePath("/payments", "layout");
  return { ok: true, message: "Receipt details saved." };
}

/** Saves the UPI ID and payee name used by pay links and {payLink} (F10). */
export async function saveUpiSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(upiSettingsSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  await AppSettings.updateOne({ key: APP_SETTINGS_KEY }, { $set: parsed.data }, { upsert: true });
  // Reminder messages (and the default template) change with UPI on/off.
  revalidatePath("/", "layout");
  return { ok: true, message: parsed.data.upiId ? "UPI settings saved." : "UPI pay links turned off." };
}
