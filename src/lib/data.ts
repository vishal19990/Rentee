import "server-only";
import { Types, isValidObjectId } from "mongoose";
import { connectDB } from "./db";
import { dateFromISO } from "./format";
import {
  currentRent,
  localToday,
  rentSchedule,
  rentalStatus,
  summarize,
  toISODate,
  upcomingRentChange,
  type ChargeLike,
  type RentChangeLike,
  type RentMonth,
  type RentSummary,
} from "./rent";
import { Charge } from "@/models/Charge";
import { Payment } from "@/models/Payment";
import { RentChange } from "@/models/RentChange";
import { Property } from "@/models/Property";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";

export const toId = (v: unknown) => String(v);

export function asObjectId(id: string): Types.ObjectId | null {
  return isValidObjectId(id) ? new Types.ObjectId(id) : null;
}

/**
 * Rentals with a move-out date that has now arrived are stored as `moved_out`, so the
 * one-active-rental-per-property index frees the property. Status is always derivable
 * (see rentalStatus); this just keeps the stored field in step. Cheap and idempotent.
 */
export async function syncRentalStatuses(today = localToday()): Promise<void> {
  await connectDB();
  await Rental.updateMany(
    { status: "active", moveOutDate: { $ne: null, $lte: dateFromISO(today) } },
    { status: "moved_out" },
  );
}

export type RentalRow = {
  id: string;
  propertyId: string;
  propertyName: string;
  tenantId: string;
  tenantName: string;
  tenantPhone: string;
  moveInDate: string;
  moveOutDate: string | null;
  /** Original rent agreed at move-in (stored on the rental, never overwritten). */
  monthlyRent: number;
  /** Rent in force this month (after rent changes). Use this for display. */
  currentRent: number;
  /** Next scheduled rent change after this month, if any. */
  nextRentChange: RentChangeLike | null;
  /** Rent changes, oldest first. */
  rentChanges: RentChangeLike[];
  /** Utility / other charges (all months). */
  charges: ChargeLike[];
  deposit: number;
  dueDay: number;
  status: "active" | "moved_out";
  /** Active, with a move-out date scheduled in the future. */
  movingOut: boolean;
  schedule: RentMonth[];
  summary: RentSummary;
};

/**
 * Loads rentals (optionally filtered) with their property/tenant names, payments,
 * and the computed rent schedule.
 */
export async function loadRentals(filter: Record<string, unknown> = {}, today = localToday()): Promise<RentalRow[]> {
  await syncRentalStatuses(today);
  const rentals = await Rental.find(filter).sort({ status: 1, moveInDate: -1 }).lean();
  if (rentals.length === 0) return [];

  const rentalIds = rentals.map((r) => r._id);
  const [properties, tenants, payments, changes, charges] = await Promise.all([
    Property.find({ _id: { $in: rentals.map((r) => r.property) } }).select("name").lean(),
    Tenant.find({ _id: { $in: rentals.map((r) => r.tenant) } }).select("name phone").lean(),
    Payment.find({ rental: { $in: rentalIds } }).select("rental forMonth amount").lean(),
    RentChange.find({ rental: { $in: rentalIds } }).sort({ effectiveMonth: 1 }).select("rental effectiveMonth monthlyRent").lean(),
    Charge.find({ rental: { $in: rentalIds } }).sort({ month: 1, createdAt: 1 }).select("rental month type amount").lean(),
  ]);
  const propName = new Map(properties.map((p) => [toId(p._id), p.name]));
  const tenantName = new Map(tenants.map((t) => [toId(t._id), t.name]));
  const tenantPhone = new Map(tenants.map((t) => [toId(t._id), t.phone]));
  const paymentsByRental = new Map<string, { forMonth: string; amount: number }[]>();
  for (const p of payments) {
    const k = toId(p.rental);
    if (!paymentsByRental.has(k)) paymentsByRental.set(k, []);
    paymentsByRental.get(k)!.push({ forMonth: p.forMonth, amount: p.amount });
  }

  const group = <T extends { rental: unknown }, U>(rows: T[], map: (row: T) => U) => {
    const out = new Map<string, U[]>();
    for (const row of rows) {
      const k = toId(row.rental);
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(map(row));
    }
    return out;
  };
  const changesByRental = group(changes, (c) => ({ effectiveMonth: c.effectiveMonth, monthlyRent: c.monthlyRent }));
  const chargesByRental = group(charges, (c) => ({ month: c.month, type: c.type, amount: c.amount }));

  return rentals.map((r) => {
    const rentChanges = changesByRental.get(toId(r._id)) ?? [];
    const rentalCharges = chargesByRental.get(toId(r._id)) ?? [];
    const terms = { ...r, rentChanges, charges: rentalCharges };
    const schedule = rentSchedule(terms, paymentsByRental.get(toId(r._id)) ?? [], today);
    const status = rentalStatus(r, today);
    return {
      id: toId(r._id),
      propertyId: toId(r.property),
      propertyName: propName.get(toId(r.property)) ?? "(deleted property)",
      tenantId: toId(r.tenant),
      tenantName: tenantName.get(toId(r.tenant)) ?? "(deleted tenant)",
      tenantPhone: tenantPhone.get(toId(r.tenant)) ?? "",
      moveInDate: toISODate(r.moveInDate),
      moveOutDate: r.moveOutDate ? toISODate(r.moveOutDate) : null,
      monthlyRent: r.monthlyRent,
      currentRent: currentRent(terms, today),
      nextRentChange: upcomingRentChange(terms, today),
      rentChanges,
      charges: rentalCharges,
      deposit: r.deposit,
      dueDay: r.dueDay,
      status,
      movingOut: status === "active" && !!r.moveOutDate,
      schedule,
      summary: summarize(schedule),
    };
  });
}

/** Set of property ids that currently have an active rental (=> occupied). */
export async function occupiedPropertyIds(): Promise<Set<string>> {
  await syncRentalStatuses();
  const active = await Rental.find({ status: "active" }).select("property").lean();
  return new Set(active.map((r) => toId(r.property)));
}

export async function propertyOptions(opts: { includeArchived?: boolean } = {}) {
  await connectDB();
  const rows = await Property.find(opts.includeArchived ? {} : { archived: false })
    .sort({ name: 1 })
    .select("name city monthlyRent")
    .lean();
  return rows.map((p) => ({ id: toId(p._id), name: p.name, city: p.city, monthlyRent: p.monthlyRent }));
}

export async function tenantOptions() {
  await connectDB();
  const rows = await Tenant.find({ archived: false }).sort({ name: 1 }).select("name phone").lean();
  return rows.map((t) => ({ id: toId(t._id), name: t.name, phone: t.phone }));
}
