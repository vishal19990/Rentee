"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { asObjectId, syncRentalStatuses } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { addDepositEntry, addDepositPayment, changeDepositEntry, loadDeposit } from "@/lib/deposit-store";
import { depositPaymentLabel, depositReminderMessage, type DepositMethod } from "@/lib/deposit";
import { formatMoneyShort } from "@/lib/money";
import { formatMonth, localToday, monthOf, payableMonths, toISODate } from "@/lib/rent";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import { chargeSchema, depositEntrySchema, depositPaymentSchema, parseForm, rentChangeSchema, type ActionState } from "@/lib/validation";
import { NO_PHONE_TOOLTIP, normalizePhone } from "@/lib/whatsapp";
import { Charge } from "@/models/Charge";
import { DepositEntry } from "@/models/DepositEntry";
import { Property } from "@/models/Property";
import { ReminderLog } from "@/models/ReminderLog";
import { RentChange } from "@/models/RentChange";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";

/**
 * Rental money actions: rent changes (F4), utility/other charges (F5) and the security
 * deposit ledger (F3). All of them change what is due, so rent notifications for the rental
 * are re-synced immediately.
 */

const NOT_FOUND: ActionState = { ok: false, message: "Rental not found." };

async function loadRental(id: string) {
  const _id = asObjectId(id);
  if (!_id) return null;
  await connectDB();
  await syncRentalStatuses();
  const rental = await Rental.findById(_id).lean();
  return rental ? { _id, rental } : null;
}

async function afterChange(id: string, rental: { property: unknown; tenant: unknown }) {
  await syncNotificationsSafe({ scope: { rentalIds: [id] } });
  revalidatePath(`/rentals/${id}`);
  revalidatePath("/rentals");
  revalidatePath("/dashboard");
  revalidatePath("/payments/new");
  revalidatePath(`/properties/${String(rental.property)}`);
  revalidatePath(`/tenants/${String(rental.tenant)}`);
}

/* ---------- rent changes ---------- */

export async function changeRent(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const found = await loadRental(id);
  if (!found) return NOT_FOUND;
  const { _id, rental } = found;
  const firstMonth = monthOf(toISODate(rental.moveInDate));
  const lastMonth = rental.moveOutDate ? monthOf(toISODate(rental.moveOutDate)) : null;
  const parsed = parseForm(rentChangeSchema({ firstMonth, lastMonth }), fd);
  if (!parsed.success) return parsed.state;
  const { effectiveMonth, monthlyRent, note } = parsed.data;

  // Saving the same effective month again replaces that change.
  const res = await RentChange.updateOne(
    { rental: _id, effectiveMonth },
    { $set: { monthlyRent, note }, $setOnInsert: { rental: _id, effectiveMonth } },
    { upsert: true },
  );
  await afterChange(id, rental);
  const verb = res.upsertedCount ? "set" : "updated";
  return { ok: true, message: `Rent from ${formatMonth(effectiveMonth)} ${verb}.` };
}

export async function deleteRentChange(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const found = await loadRental(id);
  if (!found) return NOT_FOUND;
  const changeId = asObjectId(String(fd.get("changeId") ?? ""));
  if (!changeId) return { ok: false, message: "Rent change not found." };
  const res = await RentChange.deleteOne({ _id: changeId, rental: found._id });
  if (res.deletedCount === 0) return { ok: false, message: "Rent change not found." };
  await afterChange(id, found.rental);
  return { ok: true, message: "Rent change removed." };
}

/* ---------- utility & other charges ---------- */

export async function addCharge(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const found = await loadRental(id);
  if (!found) return NOT_FOUND;
  const { _id, rental } = found;
  const { first, last } = payableMonths(rental);
  const parsed = parseForm(chargeSchema({ firstMonth: first, lastMonth: last }), fd);
  if (!parsed.success) return parsed.state;
  const { month, type, amount, meter, note } = parsed.data;

  await Charge.create({ rental: _id, month, type, amount, meter, note });
  await afterChange(id, rental);
  return { ok: true, message: `Charge added to ${formatMonth(month)}.` };
}

export async function deleteCharge(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const found = await loadRental(id);
  if (!found) return NOT_FOUND;
  const chargeId = asObjectId(String(fd.get("chargeId") ?? ""));
  if (!chargeId) return { ok: false, message: "Charge not found." };
  const res = await Charge.deleteOne({ _id: chargeId, rental: found._id });
  if (res.deletedCount === 0) return { ok: false, message: "Charge not found." };
  await afterChange(id, found.rental);
  return { ok: true, message: "Charge removed." };
}

/* ---------- security deposit ---------- */

export async function recordDepositEntry(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const found = await loadRental(id);
  if (!found) return NOT_FOUND;
  const parsed = parseForm(depositEntrySchema, fd);
  if (!parsed.success) return parsed.state;

  const error = await addDepositEntry(found._id, parsed.data, user.id);
  if (error) return { ok: false, message: error, fieldErrors: { amount: [error] }, values: parsed.values };
  revalidatePath(`/rentals/${id}`);
  const labels = { received: "Deposit received", deduction: "Deduction", refund: "Refund" } as const;
  return { ok: true, message: `${labels[parsed.data.kind]} recorded.` };
}

/** "Add deposit payment": an advance (dated on/before move-in) or a later part payment. */
export async function recordDepositPayment(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const found = await loadRental(id);
  if (!found) return NOT_FOUND;
  const { _id, rental } = found;
  const moveInDate = toISODate(rental.moveInDate);
  const parsed = parseForm(depositPaymentSchema({ moveInDate, today: localToday() }), fd);
  if (!parsed.success) return parsed.state;

  const error = await addDepositPayment(_id, parsed.data, user.id);
  if (error) return { ok: false, message: error, fieldErrors: { amount: [error] }, values: parsed.values };
  revalidatePath(`/rentals/${id}`);
  revalidatePath("/rentals");
  revalidatePath("/dashboard");
  revalidatePath(`/tenants/${String(rental.tenant)}`);
  return { ok: true, message: `${depositPaymentLabel(parsed.data.date, moveInDate)} of ${formatMoneyShort(parsed.data.amount)} recorded.` };
}

function afterDepositChange(id: string, rental: { tenant: unknown }) {
  revalidatePath(`/rentals/${id}`);
  revalidatePath("/rentals");
  revalidatePath("/dashboard");
  revalidatePath(`/tenants/${String(rental.tenant)}`);
}

/** Edits a deposit ledger entry (amount, date, method / reason). Its kind can't change. */
export async function editDepositEntry(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const found = await loadRental(id);
  if (!found) return NOT_FOUND;
  const { _id, rental } = found;
  const entryId = asObjectId(String(fd.get("entryId") ?? ""));
  const entry = entryId ? await DepositEntry.findOne({ _id: entryId, rental: _id }).select("kind").lean() : null;
  if (!entryId || !entry) return { ok: false, message: "Deposit entry not found." };

  let patch: { amount: number; date: string; reason: string; method?: DepositMethod | null };
  if (entry.kind === "received") {
    const parsed = parseForm(depositPaymentSchema({ moveInDate: toISODate(rental.moveInDate), today: localToday() }), fd);
    if (!parsed.success) return parsed.state;
    patch = { amount: parsed.data.amount, date: parsed.data.date, reason: parsed.data.note, method: parsed.data.method };
  } else {
    fd.set("kind", entry.kind);
    const parsed = parseForm(depositEntrySchema, fd);
    if (!parsed.success) return parsed.state;
    patch = { amount: parsed.data.amount, date: parsed.data.date, reason: parsed.data.reason };
  }

  const error = await changeDepositEntry(_id, entryId, patch);
  if (error) return { ok: false, message: error, fieldErrors: { amount: [error] } };
  afterDepositChange(id, rental);
  return { ok: true, message: "Deposit entry updated." };
}

/** Deletes a deposit ledger entry (refused if the remaining ledger would be invalid). */
export async function deleteDepositEntry(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const found = await loadRental(id);
  if (!found) return NOT_FOUND;
  const entryId = asObjectId(String(fd.get("entryId") ?? ""));
  if (!entryId) return { ok: false, message: "Deposit entry not found." };
  const error = await changeDepositEntry(found._id, entryId, null);
  if (error) return { ok: false, message: error };
  afterDepositChange(id, found.rental);
  return { ok: true, message: "Deposit entry deleted." };
}

export type LogDepositReminderResult = { ok: true; sentAt: string } | { ok: false; message: string };

/**
 * Records that the admin opened a WhatsApp reminder about the deposit balance. The message is
 * rebuilt here from current data (never taken from the client).
 */
export async function logDepositReminder(id: string): Promise<LogDepositReminderResult> {
  const user = await requireUser();
  const found = await loadRental(id);
  if (!found) return { ok: false, message: "Rental not found." };
  const { _id, rental } = found;
  const { status } = await loadDeposit(_id);
  if (status.balance <= 0) return { ok: false, message: "The deposit is fully paid" };
  const [tenant, property] = await Promise.all([
    Tenant.findById(rental.tenant).select("name phone").lean(),
    Property.findById(rental.property).select("name").lean(),
  ]);
  const phone = normalizePhone(tenant?.phone);
  if (!phone) return { ok: false, message: NO_PHONE_TOOLTIP };
  const log = await ReminderLog.create({
    rental: _id,
    tenant: rental.tenant,
    sentAt: new Date(),
    message: depositReminderMessage(tenant?.name ?? "", property?.name ?? "", status.balance),
    kind: "deposit",
    phone,
    sentBy: user.id,
  });
  revalidatePath(`/rentals/${id}`);
  return { ok: true, sentAt: log.sentAt.toISOString() };
}
