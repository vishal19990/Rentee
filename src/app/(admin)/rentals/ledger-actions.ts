"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { asObjectId, syncRentalStatuses } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { addDepositEntry } from "@/lib/deposit-store";
import { formatMonth, monthOf, payableMonths, toISODate } from "@/lib/rent";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import { chargeSchema, depositEntrySchema, parseForm, rentChangeSchema, type ActionState } from "@/lib/validation";
import { Charge } from "@/models/Charge";
import { RentChange } from "@/models/RentChange";
import { Rental } from "@/models/Rental";

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
