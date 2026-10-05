import "server-only";
import { connectDB } from "./db";
import { toId } from "./data";
import {
  OPEN_STATUSES,
  desiredEnquiryNotifications,
  phoneKey,
  samePhone,
  type EnquiryNotificationInput,
} from "./enquiries";
import type { NotificationSpec } from "./notifications";
import { toISODate } from "./rent";
import { Enquiry } from "@/models/Enquiry";
import { EnquiryActivity } from "@/models/EnquiryActivity";
import { Property } from "@/models/Property";
import { Tenant } from "@/models/Tenant";

export type PhoneMatches = {
  enquiries: { id: string; name: string; status: string; createdAt: string; propertyName: string | null }[];
  tenants: { id: string; name: string; phone: string; archived: boolean }[];
};

/** Property names by id (archived included). */
export async function propertyNames(ids: unknown[]): Promise<Map<string, string>> {
  const clean = ids.filter(Boolean);
  if (clean.length === 0) return new Map();
  const rows = await Property.find({ _id: { $in: clean } }).select("name").lean();
  return new Map(rows.map((p) => [toId(p._id), p.name]));
}

/** Tenants whose normalized phone matches. Tenants have no stored key, so all are compared. */
export async function tenantsWithPhone(phone: string): Promise<PhoneMatches["tenants"]> {
  if (!phoneKey(phone)) return [];
  await connectDB();
  const rows = await Tenant.find().select("name phone archived").lean();
  return rows
    .filter((t) => samePhone(phone, t.phone))
    .map((t) => ({ id: toId(t._id), name: t.name, phone: t.phone, archived: !!t.archived }));
}

/** Other enquiries and tenants with the same normalized phone (non-blocking duplicate warning). */
export async function phoneMatches(phone: string, excludeEnquiryId?: string): Promise<PhoneMatches> {
  const key = phoneKey(phone);
  if (!key) return { enquiries: [], tenants: [] };
  await connectDB();
  const filter: Record<string, unknown> = { phoneKey: key };
  if (excludeEnquiryId) filter._id = { $ne: excludeEnquiryId };
  const [rows, tenants] = await Promise.all([
    Enquiry.find(filter).sort({ createdAt: -1 }).limit(20).select("name status createdAt property").lean(),
    tenantsWithPhone(phone),
  ]);
  const names = await propertyNames(rows.map((r) => r.property));
  return {
    enquiries: rows.map((r) => ({
      id: toId(r._id),
      name: r.name,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      propertyName: r.property ? (names.get(toId(r.property)) ?? null) : null,
    })),
    tenants,
  };
}

/**
 * Enquiry notifications (enquiry_follow_up / enquiry_visit) for the notification sync.
 * `ids: null` = full sync over open enquiries; otherwise only those enquiries.
 */
export async function enquiryNotificationSpecs(ids: string[] | null, now: Date): Promise<NotificationSpec[]> {
  if (ids && ids.length === 0) return [];
  await connectDB();
  const filter: Record<string, unknown> = ids
    ? { _id: { $in: ids } }
    : { status: { $in: OPEN_STATUSES }, $or: [{ followUpDate: { $ne: null } }, { visitAt: { $ne: null } }] };
  const rows = await Enquiry.find(filter).select("name phone property status followUpDate visitAt").lean();
  const names = await propertyNames(rows.map((r) => r.property));
  const input: EnquiryNotificationInput[] = rows.map((r) => ({
    id: toId(r._id),
    name: r.name,
    phone: r.phone,
    propertyId: r.property ? toId(r.property) : null,
    propertyName: r.property ? (names.get(toId(r.property)) ?? null) : null,
    status: r.status,
    followUpDate: r.followUpDate ? toISODate(r.followUpDate) : null,
    visitAt: r.visitAt ?? null,
  }));
  return desiredEnquiryNotifications(input, now);
}

/** Mongo filter matching stored enquiry notifications of the given enquiries (by key). */
export function enquiryNotificationKeyFilter(ids: string[]): Record<string, unknown>[] {
  const clean = ids.filter((id) => /^[a-f\d]{24}$/i.test(id));
  if (clean.length === 0) return [];
  return [{ key: { $regex: `^enquiry_(follow_up|visit):(${clean.join("|")}):` } }];
}

/**
 * After a rental is created: link it to converted enquiries for that tenant (and that property,
 * or "any property") that are not linked yet. Never throws.
 */
export async function linkConvertedRental(tenantId: string, propertyId: string, rentalId: string): Promise<void> {
  try {
    await connectDB();
    const rows = await Enquiry.find({
      convertedTenant: tenantId,
      convertedRental: null,
      $or: [{ property: propertyId }, { property: null }],
    })
      .select("_id")
      .lean();
    if (rows.length === 0) return;
    await Enquiry.updateMany({ _id: { $in: rows.map((r) => r._id) } }, { $set: { convertedRental: rentalId } });
    await EnquiryActivity.insertMany(
      rows.map((r) => ({ enquiry: r._id, kind: "converted", text: "Rental created", at: new Date() })),
    );
  } catch (err) {
    console.error("[enquiries] linking rental failed:", err);
  }
}
