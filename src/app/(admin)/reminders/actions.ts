"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { asObjectId, loadRentals } from "@/lib/data";
import { getReminderTemplate } from "@/lib/reminders";
import { localToday } from "@/lib/rent";
import { buildReminder } from "@/lib/whatsapp";
import { ReminderLog } from "@/models/ReminderLog";

export type LogReminderResult = { ok: true; sentAt: string } | { ok: false; message: string };

/**
 * Records that the admin opened a WhatsApp reminder for a rental. The message is rebuilt
 * on the server from current data (the client never supplies it), so the log is trustworthy.
 */
export async function logReminder(rentalId: string): Promise<LogReminderResult> {
  const user = await requireUser();
  const _id = asObjectId(rentalId);
  if (!_id) return { ok: false, message: "Rental not found." };

  const today = localToday();
  const [rental] = await loadRentals({ _id }, today);
  if (!rental) return { ok: false, message: "Rental not found." };

  const built = buildReminder({
    rental,
    tenantName: rental.tenantName,
    tenantPhone: rental.tenantPhone,
    propertyName: rental.propertyName,
    template: await getReminderTemplate(),
    today,
  });
  if (!built) return { ok: false, message: "Nothing to remind about." };
  if (!built.phone) return { ok: false, message: "Add a phone number" };

  const log = await ReminderLog.create({
    rental: _id,
    tenant: rental.tenantId,
    sentAt: new Date(),
    message: built.message,
    kind: built.kind,
    phone: built.phone,
    sentBy: user.id,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/rentals/${rentalId}`);
  revalidatePath(`/tenants/${rental.tenantId}`);
  return { ok: true, sentAt: log.sentAt.toISOString() };
}
