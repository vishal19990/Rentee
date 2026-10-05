"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import {
  adminSchema,
  electricitySettingsSchema,
  notificationSettingsSchema,
  parseForm,
  passwordChangeSchema,
  reminderTemplateSchema,
  type ActionState,
} from "@/lib/validation";
import { APP_SETTINGS_KEY, AppSettings } from "@/models/AppSettings";
import { User } from "@/models/User";

export async function createAdmin(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(adminSchema, fd);
  if (!parsed.success) return parsed.state;
  const { name, email, password } = parsed.data;
  const values = { name, email };

  await connectDB();
  if (await User.exists({ email })) {
    return { ok: false, fieldErrors: { email: ["An admin with this email already exists"] }, values };
  }
  try {
    await User.create({ name, email, passwordHash: await hashPassword(password) });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return { ok: false, fieldErrors: { email: ["An admin with this email already exists"] }, values };
    }
    throw err;
  }
  revalidatePath("/settings");
  return { ok: true, message: `Admin account created for ${email}.` };
}

export async function changePassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser();
  const parsed = parseForm(passwordChangeSchema, fd);
  if (!parsed.success) return { ...parsed.state, values: undefined };
  const { currentPassword, newPassword } = parsed.data;

  await connectDB();
  const user = await User.findById(me.id);
  if (!user) return { ok: false, message: "Account not found." };
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, fieldErrors: { currentPassword: ["Current password is incorrect"] } };
  }
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  return { ok: true, message: "Password updated." };
}

/** Saves the WhatsApp reminder message template (settings document in MongoDB). */
export async function saveReminderTemplate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(reminderTemplateSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  await AppSettings.updateOne(
    { key: APP_SETTINGS_KEY },
    { $set: { reminderTemplate: parsed.data.reminderTemplate } },
    { upsert: true },
  );
  revalidateReminderViews();
  return { ok: true, message: "Reminder template saved." };
}

export async function resetReminderTemplate(): Promise<ActionState> {
  await requireUser();
  await connectDB();
  await AppSettings.updateOne({ key: APP_SETTINGS_KEY }, { $set: { reminderTemplate: null } }, { upsert: true });
  revalidateReminderViews();
  return { ok: true, message: "Reset to the default template." };
}

function revalidateReminderViews() {
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/rentals", "layout");
  revalidatePath("/tenants", "layout");
}

/** Saves the default electricity rate per unit (used when a property has no rate of its own). */
export async function saveElectricitySettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(electricitySettingsSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  await AppSettings.updateOne({ key: APP_SETTINGS_KEY }, { $set: parsed.data }, { upsert: true });
  revalidatePath("/settings");
  revalidatePath("/rentals", "layout");
  return { ok: true, message: "Electricity rate saved." };
}

/** Saves notification thresholds (N, M, K) and the desktop toggle, then re-syncs notifications. */
export async function saveNotificationSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(notificationSettingsSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  await AppSettings.updateOne({ key: APP_SETTINGS_KEY }, { $set: parsed.data }, { upsert: true });
  // Thresholds changed: re-evaluate now rather than waiting for the 5-minute throttle.
  await syncNotificationsSafe({ force: true });
  revalidatePath("/", "layout");
  return { ok: true, message: "Notification settings saved." };
}
