/**
 * Tenant portal data isolation: pure scoping rules + form schemas (no database access).
 *
 * Every portal query is built from the session tenant's id through these helpers, never from an
 * id in the URL or form alone; an id from the request is only ever used *together with* the
 * tenant's scope ({ _id: requested, tenant: me } / { _id: requested, rental: { $in: myRentals } }).
 */
import { z } from "zod";
import { OCCUPANT_RELATION_LABELS, type OccupantRelation } from "./occupants";

const OBJECT_ID = /^[a-f\d]{24}$/i;

export function isObjectIdString(v: unknown): v is string {
  return typeof v === "string" && OBJECT_ID.test(v);
}

/** Mongo filter for "one of my records": the requested id AND the tenant's scope. */
export function scoped<T extends Record<string, unknown>>(requestedId: unknown, scope: T): ({ _id: string } & T) | null {
  return isObjectIdString(requestedId) ? { _id: requestedId, ...scope } : null;
}

/** Rentals of the session tenant. */
export function rentalScope<Id>(tenantId: Id): { tenant: Id } {
  return { tenant: tenantId };
}

/** Records hanging off rentals (payments, deposit entries, agreements, charges): only my rentals. */
export function byRentalScope<Id>(myRentalIds: Id[]): { rental: { $in: Id[] } } {
  return { rental: { $in: myRentalIds } };
}

/** A stay that lets a tenant see the landlord's requests for that property. */
export type ActiveStay<Id = string> = { propertyId: Id; since: Date };

/**
 * Maintenance requests a tenant may see: the ones they raised, plus requests the landlord logged
 * for a property they currently rent, created during their stay. Requests other tenants raised
 * (e.g. a previous tenant of the same room) are never included.
 */
export function maintenanceScope<Id>(tenantId: Id, activeStays: ActiveStay<Id>[]): Record<string, unknown> {
  return {
    $or: [
      { tenant: tenantId },
      ...activeStays.map((s) => ({ createdBy: { $ne: "tenant" }, tenant: null, property: s.propertyId, createdAt: { $gte: s.since } })),
    ],
  };
}

/** The same rule as maintenanceScope, for one already-loaded request (used by tests and checks). */
export function canSeeMaintenance(
  m: { tenant: string | null; createdBy?: string | null; property: string; createdAt: Date },
  tenantId: string,
  activeStays: ActiveStay[],
): boolean {
  if (m.tenant === tenantId) return true;
  if (m.createdBy === "tenant" || m.tenant !== null) return false;
  return activeStays.some((s) => s.propertyId === m.property && m.createdAt >= s.since);
}

/* ---------- forms ---------- */

export const PORTAL_PRIORITIES = ["low", "medium", "high"] as const;

export const portalMaintenanceSchema = z.object({
  rentalId: z.string().regex(OBJECT_ID, "Choose your home"),
  title: z.string().trim().min(1, "Describe the problem in a few words").max(120, "Keep the title under 120 characters"),
  description: z
    .string()
    .trim()
    .max(4000, "Keep the description under 4000 characters")
    .optional()
    .transform((v) => v || ""),
  priority: z.enum(PORTAL_PRIORITIES, { errorMap: () => ({ message: "Choose how urgent it is" }) }),
});

export const portalPhoneSchema = z.object({
  phone: z
    .string({ required_error: "Phone is required" })
    .trim()
    .min(1, "Phone is required")
    .regex(/^\+?[\d\s\-()]{6,20}$/, "Enter a valid phone number"),
});

export const portalEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200, "Enter a valid email")
    .optional()
    .transform((v) => v || "")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email"),
});

/* ---------- change log ---------- */

export const CHANGE_FIELDS = ["phone", "email", "occupant_added", "occupant_updated", "occupant_removed", "password"] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];

export const CHANGE_FIELD_LABELS: Record<ChangeField, string> = {
  phone: "Phone",
  email: "Email",
  occupant_added: "Occupant added",
  occupant_updated: "Occupant changed",
  occupant_removed: "Occupant removed",
  password: "Password",
};

/** One-line summary of an occupant for the change log (only the last 4 ID digits, as stored). */
export function describeOccupant(o: { name: string; relation: string; phone?: string; idLast4?: string; emergency?: boolean }): string {
  const rel = OCCUPANT_RELATION_LABELS[o.relation as OccupantRelation] ?? o.relation;
  return [o.name, rel, o.phone || "", o.idLast4 ? `ID ••••${o.idLast4}` : "", o.emergency ? "emergency contact" : ""].filter(Boolean).join(", ");
}
