"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, syncRentalStatuses } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import { dateFromISO } from "@/lib/format";
import { finalCycleMonth, localToday, monthOf, rentalStatus, toISODate } from "@/lib/rent";
import { moveOutSchema, parseForm, rentalCreateSchema, rentalUpdateSchema, type ActionState } from "@/lib/validation";
import { agreedDepositGuard, ensureDepositLedger } from "@/lib/deposit-store";
import { linkConvertedRental } from "@/lib/enquiry-data";
import { roomChangeError } from "@/lib/room-change";
import { Charge } from "@/models/Charge";
import { DepositEntry } from "@/models/DepositEntry";
import { Payment } from "@/models/Payment";
import { RentChange } from "@/models/RentChange";
import { Property } from "@/models/Property";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";
import { Agreement } from "@/models/Agreement";
import { WifiPlan } from "@/models/WifiPlan";
import { TenantDocument } from "@/models/TenantDocument";

const NOT_FOUND: ActionState = { ok: false, message: "Rental not found." };
const ACTIVE_EXISTS = "Property already has an active rental";

function isDuplicateKey(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

function revalidateRentalViews(rentalId?: string, propertyId?: string, tenantId?: string) {
  revalidatePath("/rentals");
  revalidatePath("/dashboard");
  revalidatePath("/properties");
  revalidatePath("/tenants");
  revalidatePath("/payments");
  if (rentalId) revalidatePath(`/rentals/${rentalId}`);
  if (propertyId) revalidatePath(`/properties/${propertyId}`);
  if (tenantId) revalidatePath(`/tenants/${tenantId}`);
}

/** Stored status for a move-out date (see rentalStatus). */
function storedStatus(moveOutDate: string | null, today = localToday()) {
  return rentalStatus({ moveOutDate }, today);
}

export async function createRental(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(rentalCreateSchema(localToday()), fd);
  if (!parsed.success) return parsed.state;
  const { propertyId, tenantId, moveInDate, advance, ...terms } = parsed.data;
  const values = parsed.values;
  const fail = (field: string, msg: string): ActionState => ({
    ok: false,
    message: msg,
    fieldErrors: { [field]: [msg] },
    values,
  });

  await connectDB();
  await syncRentalStatuses();
  const [property, tenant] = await Promise.all([
    Property.findById(propertyId).select("archived").lean(),
    Tenant.findById(tenantId).select("archived").lean(),
  ]);
  if (!property) return fail("propertyId", "Select a property");
  if (property.archived) return fail("propertyId", "This property is archived. Restore it first.");
  if (!tenant) return fail("tenantId", "Select a tenant");
  if (tenant.archived) return fail("tenantId", "This tenant is archived. Restore them first.");
  if (await Rental.exists({ property: propertyId, status: "active" })) return fail("propertyId", ACTIVE_EXISTS);

  let id: string;
  try {
    const doc = await Rental.create({
      property: propertyId,
      tenant: tenantId,
      moveInDate: dateFromISO(moveInDate),
      moveOutDate: null,
      status: "active",
      ...terms,
      // The deposit is paid as an advance (possibly 0) plus later part payments.
      depositAdvance: { amount: advance.amount, date: dateFromISO(advance.date) },
    });
    id = String(doc._id);
  } catch (err) {
    // The partial unique index is the race-safe backstop for the check above.
    if (isDuplicateKey(err)) return fail("propertyId", ACTIVE_EXISTS);
    throw err;
  }
  // An advance > 0 opens the deposit ledger with a "received" entry on the advance date.
  await ensureDepositLedger(id);
  await linkConvertedRental(tenantId, propertyId, id); // enquiry converted to this tenant -> link the rental
  await syncNotificationsSafe({ scope: { rentalIds: [id] } });
  revalidateRentalViews(id, propertyId, tenantId);
  redirect(`/rentals/${id}`);
}

/** Key month of the last billing cycle for these dates (see finalCycleMonth). */
const lastCycle = (moveInDate: string, moveOutDate: string) => finalCycleMonth({ moveInDate, moveOutDate })!;

/** Payments must stay inside the rental's billing cycles after a date change. */
async function paymentsOutside(rentalId: unknown, moveInDate: string, moveOutDate: string | null) {
  const or: Record<string, unknown>[] = [{ forMonth: { $lt: monthOf(moveInDate) } }];
  if (moveOutDate) or.push({ forMonth: { $gt: lastCycle(moveInDate, moveOutDate) } });
  return Payment.exists({ rental: rentalId, $or: or });
}

/** Charges must stay inside the rental's billing cycles too. */
async function chargesOutside(rentalId: unknown, moveInDate: string, moveOutDate: string | null) {
  const or: Record<string, unknown>[] = [{ month: { $lt: monthOf(moveInDate) } }];
  if (moveOutDate) or.push({ month: { $gt: lastCycle(moveInDate, moveOutDate) } });
  return Charge.exists({ rental: rentalId, $or: or });
}

export async function updateRental(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  const parsed = parseForm(rentalUpdateSchema, fd);
  if (!parsed.success) return parsed.state;
  const { moveInDate, moveOutDate, ...terms } = parsed.data;
  const values = parsed.values;

  await connectDB();
  await syncRentalStatuses();
  const rental = await Rental.findById(_id).lean();
  if (!rental) return NOT_FOUND;

  if (await paymentsOutside(_id, moveInDate, moveOutDate)) {
    const msg = "Payments are recorded for billing cycles outside these dates";
    const field = moveOutDate && (await Payment.exists({ rental: _id, forMonth: { $gt: lastCycle(moveInDate, moveOutDate) } }))
      ? "moveOutDate"
      : "moveInDate";
    return { ok: false, message: msg, fieldErrors: { [field]: [msg] }, values };
  }
  if (await chargesOutside(_id, moveInDate, moveOutDate)) {
    const msg = "Charges are recorded for billing cycles outside these dates. Remove them first.";
    const field = moveOutDate && (await Charge.exists({ rental: _id, month: { $gt: lastCycle(moveInDate, moveOutDate) } }))
      ? "moveOutDate"
      : "moveInDate";
    return { ok: false, message: msg, fieldErrors: { [field]: [msg] }, values };
  }

  const status = storedStatus(moveOutDate);
  // Clearing a past move-out date re-activates the rental: the property must be free.
  if (status === "active" && rental.status !== "active") {
    if (await Rental.exists({ property: rental.property, status: "active", _id: { $ne: _id } })) {
      return { ok: false, message: ACTIVE_EXISTS, fieldErrors: { moveOutDate: [ACTIVE_EXISTS] }, values };
    }
  }

  // Advance-flow rentals: the agreed deposit can't drop below what was already received.
  const agreedError = await agreedDepositGuard(_id, terms.deposit);
  if (agreedError) return { ok: false, message: agreedError, fieldErrors: { deposit: [agreedError] }, values };

  try {
    const res = await Rental.updateOne(
      { _id, $or: [{ depositReceived: { $exists: false } }, { depositReceived: { $lte: terms.deposit } }] },
      {
        moveInDate: dateFromISO(moveInDate),
        moveOutDate: moveOutDate ? dateFromISO(moveOutDate) : null,
        status,
        ...terms,
      },
    );
    if (res.matchedCount === 0) {
      // A deposit payment landed meanwhile and the new agreed amount is now below it.
      const msg = (await agreedDepositGuard(_id, terms.deposit)) ?? "The deposit changed meanwhile. Please try again.";
      return { ok: false, message: msg, fieldErrors: { deposit: [msg] }, values };
    }
  } catch (err) {
    if (isDuplicateKey(err)) return { ok: false, message: ACTIVE_EXISTS, fieldErrors: { moveOutDate: [ACTIVE_EXISTS] }, values };
    throw err;
  }
  // A deposit entered for the first time opens the ledger; later changes are ledger entries.
  await ensureDepositLedger(_id);
  await syncNotificationsSafe({ scope: { rentalIds: [id] } });
  revalidateRentalViews(id, String(rental.property), String(rental.tenant));
  redirect(`/rentals/${id}`);
}

/**
 * Records (or reschedules) a tenant's move-out. Rent stops after the move-out month.
 * A date today or earlier frees the property immediately; a future date keeps the rental
 * active until that day.
 */
export async function moveOutRental(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  await connectDB();
  await syncRentalStatuses();
  const rental = await Rental.findById(_id).lean();
  if (!rental) return NOT_FOUND;
  if (rental.status !== "active") return { ok: false, message: "This tenant has already moved out." };

  const parsed = parseForm(moveOutSchema(toISODate(rental.moveInDate)), fd);
  if (!parsed.success) return parsed.state;
  const { moveOutDate } = parsed.data;

  const finalCycle = lastCycle(toISODate(rental.moveInDate), moveOutDate);
  if (await Payment.exists({ rental: _id, forMonth: { $gt: finalCycle } })) {
    const msg = "Payments are recorded for billing cycles after this date";
    return { ok: false, fieldErrors: { moveOutDate: [msg] }, values: parsed.values };
  }
  if (await Charge.exists({ rental: _id, month: { $gt: finalCycle } })) {
    const msg = "Charges are recorded for billing cycles after this date";
    return { ok: false, fieldErrors: { moveOutDate: [msg] }, values: parsed.values };
  }

  const status = storedStatus(moveOutDate);
  await Rental.updateOne({ _id }, { moveOutDate: dateFromISO(moveOutDate), status });
  await syncNotificationsSafe({ scope: { rentalIds: [id] } });
  revalidateRentalViews(id, String(rental.property), String(rental.tenant));
  return {
    ok: true,
    message:
      (status === "moved_out" ? "Move-out recorded. The property is now vacant." : "Move-out scheduled.") +
      " Settle the security deposit (deductions, refund) in the Deposit card.",
  };
}

export async function deleteRental(id: string): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  await connectDB();
  if (await Payment.exists({ rental: _id })) {
    return {
      ok: false,
      message: "Payments are recorded against this rental, so it can't be deleted. Record a move-out instead.",
    };
  }
  if (await DepositEntry.exists({ rental: _id, source: "manual" })) {
    return {
      ok: false,
      message: "Deposit entries are recorded against this rental, so it can't be deleted. Record a move-out instead.",
    };
  }
  const rental = await Rental.findByIdAndDelete(_id).lean();
  if (!rental) return NOT_FOUND;
  // A rental deleted by mistake never really happened: drop its derived records.
  await Promise.all([
    DepositEntry.deleteMany({ rental: _id, source: "initial" }),
    Charge.deleteMany({ rental: _id }),
    RentChange.deleteMany({ rental: _id }),
    Agreement.deleteMany({ rental: _id }),
    WifiPlan.deleteMany({ rental: _id }),
  ]);
  await TenantDocument.updateMany({ rental: _id }, { $set: { rental: null } }); // documents stay with the tenant
  await syncNotificationsSafe({ scope: { rentalIds: [id] } });
  revalidateRentalViews(undefined, String(rental.property), String(rental.tenant));
  redirect("/rentals");
}

/**
 * "Change room": moves a rental to another (vacant) property in place, keeping its deposit,
 * advance, agreement, charges and payments. Only before the stay has started (see roomChangeError).
 */
export async function changeRentalProperty(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  const fail = (msg: string): ActionState => ({ ok: false, message: msg, fieldErrors: { propertyId: [msg] } });
  const newProperty = asObjectId(String(fd.get("propertyId") ?? ""));
  if (!newProperty) return fail("Choose the new room / property");

  await connectDB();
  await syncRentalStatuses();
  const rental = await Rental.findById(_id).lean();
  if (!rental) return NOT_FOUND;
  if (String(rental.property) === String(newProperty)) return fail("The rental is already for this property");
  const target = await Property.findById(newProperty).select("name archived").lean();
  if (!target || target.archived) return fail("That property isn't available");

  const today = localToday();
  const ruleError = roomChangeError({
    status: rental.status,
    moveInDate: toISODate(rental.moveInDate),
    today,
    hasPayments: !!(await Payment.exists({ rental: _id })),
  });
  if (ruleError) return { ok: false, message: ruleError };
  if (await Rental.exists({ property: newProperty, status: "active" })) return fail(ACTIVE_EXISTS);

  try {
    const res = await Rental.updateOne({ _id, property: rental.property }, { $set: { property: newProperty } });
    if (res.matchedCount === 0) return { ok: false, message: "The rental changed meanwhile. Please try again." };
  } catch (err) {
    if (isDuplicateKey(err)) return fail(ACTIVE_EXISTS); // someone else took the room meanwhile
    throw err;
  }
  await syncNotificationsSafe({ scope: { rentalIds: [id] } });
  revalidateRentalViews(id, String(rental.property), String(rental.tenant));
  revalidatePath(`/properties/${String(newProperty)}`);
  return { ok: true, message: `Moved to ${target.name}.` };
}
