"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, syncRentalStatuses } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import { dateFromISO } from "@/lib/format";
import { localToday, monthOf, rentalStatus, toISODate } from "@/lib/rent";
import { moveOutSchema, parseForm, rentalSchema, rentalUpdateSchema, type ActionState } from "@/lib/validation";
import { Payment } from "@/models/Payment";
import { Property } from "@/models/Property";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";
import { Agreement } from "@/models/Agreement";
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
  const parsed = parseForm(rentalSchema, fd);
  if (!parsed.success) return parsed.state;
  const { propertyId, tenantId, moveInDate, ...terms } = parsed.data;
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
    });
    id = String(doc._id);
  } catch (err) {
    // The partial unique index is the race-safe backstop for the check above.
    if (isDuplicateKey(err)) return fail("propertyId", ACTIVE_EXISTS);
    throw err;
  }
  await syncNotificationsSafe({ scope: { rentalIds: [id] } });
  revalidateRentalViews(id, propertyId, tenantId);
  redirect(`/rentals/${id}`);
}

/** Payments must stay inside the rental's months after a date change. */
async function paymentsOutside(rentalId: unknown, moveInDate: string, moveOutDate: string | null) {
  const or: Record<string, unknown>[] = [{ forMonth: { $lt: monthOf(moveInDate) } }];
  if (moveOutDate) or.push({ forMonth: { $gt: monthOf(moveOutDate) } });
  return Payment.exists({ rental: rentalId, $or: or });
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
    const msg = "Payments are recorded for months outside these dates";
    const field = moveOutDate && (await Payment.exists({ rental: _id, forMonth: { $gt: monthOf(moveOutDate) } }))
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

  try {
    await Rental.updateOne(
      { _id },
      {
        moveInDate: dateFromISO(moveInDate),
        moveOutDate: moveOutDate ? dateFromISO(moveOutDate) : null,
        status,
        ...terms,
      },
    );
  } catch (err) {
    if (isDuplicateKey(err)) return { ok: false, message: ACTIVE_EXISTS, fieldErrors: { moveOutDate: [ACTIVE_EXISTS] }, values };
    throw err;
  }
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

  if (await Payment.exists({ rental: _id, forMonth: { $gt: monthOf(moveOutDate) } })) {
    const msg = "Payments are recorded for months after this date";
    return { ok: false, fieldErrors: { moveOutDate: [msg] }, values: parsed.values };
  }

  const status = storedStatus(moveOutDate);
  await Rental.updateOne({ _id }, { moveOutDate: dateFromISO(moveOutDate), status });
  await syncNotificationsSafe({ scope: { rentalIds: [id] } });
  revalidateRentalViews(id, String(rental.property), String(rental.tenant));
  return {
    ok: true,
    message: status === "moved_out" ? "Move-out recorded. The property is now vacant." : "Move-out scheduled.",
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
  const rental = await Rental.findByIdAndDelete(_id).lean();
  if (!rental) return NOT_FOUND;
  await Agreement.deleteMany({ rental: _id }); // F8: agreements belong to the rental
  await TenantDocument.updateMany({ rental: _id }, { $set: { rental: null } }); // F7: documents stay with the tenant
  await syncNotificationsSafe({ scope: { rentalIds: [id] } });
  revalidateRentalViews(undefined, String(rental.property), String(rental.tenant));
  redirect("/rentals");
}
