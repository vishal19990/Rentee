import "server-only";
import { connectDB } from "./db";
import type { RentalRow } from "./data";
import { localToday } from "./rent";
import { DEFAULT_REMINDER_TEMPLATE, buildReminder, type ReminderKind } from "./whatsapp";
import { APP_SETTINGS_KEY, AppSettings } from "@/models/AppSettings";
import { ReminderLog } from "@/models/ReminderLog";
import { Types } from "mongoose";

/** The admin-edited reminder template, or the built-in default. */
export async function getReminderTemplate(): Promise<string> {
  await connectDB();
  const doc = await AppSettings.findOne({ key: APP_SETTINGS_KEY }).select("reminderTemplate").lean();
  return doc?.reminderTemplate?.trim() ? doc.reminderTemplate : DEFAULT_REMINDER_TEMPLATE;
}

/** Latest reminder timestamp per rental id. */
export async function lastRemindedByRental(rentalIds: string[]): Promise<Map<string, Date>> {
  if (rentalIds.length === 0) return new Map();
  await connectDB();
  const rows = await ReminderLog.aggregate<{ _id: Types.ObjectId; last: Date }>([
    { $match: { rental: { $in: rentalIds.map((id) => new Types.ObjectId(id)) } } },
    { $group: { _id: "$rental", last: { $max: "$sentAt" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.last]));
}

/** Props for <WhatsAppReminderButton>, serializable for client components. */
export type ReminderButtonProps = {
  rentalId: string;
  kind: ReminderKind;
  url: string | null;
  /** The rendered message (for previews). */
  message: string;
  lastRemindedAt: string | null;
};

/**
 * Builds reminder button props for each rental that has something to remind about
 * (past-due balance, or the next upcoming month as "due soon").
 */
export async function reminderButtons(rows: RentalRow[], today = localToday()): Promise<Map<string, ReminderButtonProps>> {
  const template = await getReminderTemplate();
  const out = new Map<string, ReminderButtonProps>();
  for (const r of rows) {
    const built = buildReminder({
      rental: r,
      tenantName: r.tenantName,
      tenantPhone: r.tenantPhone,
      propertyName: r.propertyName,
      template,
      today,
    });
    if (built) out.set(r.id, { rentalId: r.id, kind: built.kind, url: built.url, message: built.message, lastRemindedAt: null });
  }
  const last = await lastRemindedByRental([...out.keys()]);
  for (const [id, props] of out) props.lastRemindedAt = last.get(id)?.toISOString() ?? null;
  return out;
}
