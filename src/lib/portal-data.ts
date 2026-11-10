import "server-only";
import { Types } from "mongoose";
import { loadAgreements, type AgreementRow } from "./agreement-data";
import { loadRentals, toId, type RentalRow } from "./data";
import { connectDB } from "./db";
import { loadDeposit } from "./deposit-store";
import { readDocumentFile } from "./document-store";
import { readFile } from "./file-store";
import { dateFromISO } from "./format";
import { byRentalScope, maintenanceScope, rentalScope, scoped, type ActiveStay } from "./portal-scope";
import { loadDepositReceipt, loadReceipt } from "./receipt-store";
import { paymentMethodLabel } from "./receipts";
import { localToday, toISODate } from "./rent";
import type { CurrentTenant } from "./tenant-auth";
import { DepositEntry } from "@/models/DepositEntry";
import { Maintenance } from "@/models/Maintenance";
import { Notification } from "@/models/Notification";
import { Payment } from "@/models/Payment";
import { Property } from "@/models/Property";
import { Rental } from "@/models/Rental";
import { TenantDocument } from "@/models/TenantDocument";
import { CATEGORY_OF, notificationKey, type NotificationType } from "./notifications";

/**
 * Tenant portal data access. EVERY function takes the session tenant (from requireTenant /
 * getCurrentTenant) and scopes its query by it; ids from the request are only used together
 * with that scope, so another tenant's id simply finds nothing (→ 404).
 */

export async function myRentals(me: CurrentTenant, today = localToday()): Promise<RentalRow[]> {
  return loadRentals(rentalScope(me.tenantOid), today);
}

export async function myRentalIds(me: CurrentTenant): Promise<Types.ObjectId[]> {
  await connectDB();
  const rows = await Rental.find(rentalScope(me.tenantOid)).select("_id").lean();
  return rows.map((r) => r._id as Types.ObjectId);
}

export function activeStays(rentals: RentalRow[]): ActiveStay<Types.ObjectId>[] {
  return rentals
    .filter((r) => r.status === "active")
    .map((r) => ({ propertyId: new Types.ObjectId(r.propertyId), since: dateFromISO(r.moveInDate) }));
}

/* ---------- payments + receipts ---------- */

export type PortalPayment = { id: string; rentalId: string; forMonth: string; amount: number; paidOn: string; method: string; receiptNo: string | null };

export async function myPayments(rentalIds: Types.ObjectId[]): Promise<PortalPayment[]> {
  await connectDB();
  const rows = await Payment.find(byRentalScope(rentalIds)).sort({ paidOn: -1, createdAt: -1 }).select("rental forMonth amount paidOn method receiptNo").lean();
  return rows.map((p) => ({
    id: toId(p._id),
    rentalId: toId(p.rental),
    forMonth: p.forMonth,
    amount: p.amount,
    paidOn: toISODate(p.paidOn),
    method: paymentMethodLabel(p.method),
    receiptNo: p.receiptNo ?? null,
  }));
}

/** My rent receipt (null if the payment isn't on one of my rentals). The landlord's payment note is left out. */
export async function myReceipt(me: CurrentTenant, paymentId: string) {
  const filter = scoped(paymentId, byRentalScope(await myRentalIds(me)));
  if (!filter || !(await Payment.exists(filter))) return null;
  const r = await loadReceipt(paymentId, "admin");
  return r ? { ...r, note: null } : null;
}

/** My deposit receipt (received entries on my rentals only). */
export async function myDepositReceipt(me: CurrentTenant, entryId: string) {
  const filter = scoped(entryId, { ...byRentalScope(await myRentalIds(me)), kind: "received" });
  if (!filter || !(await DepositEntry.exists(filter))) return null;
  const r = await loadDepositReceipt(entryId, "admin");
  return r ? { ...r, note: null } : null;
}

export async function myDeposits(rentals: RentalRow[]) {
  const out = new Map<string, Awaited<ReturnType<typeof loadDeposit>>>();
  for (const r of rentals) out.set(r.id, await loadDeposit(new Types.ObjectId(r.id)));
  return out;
}

/* ---------- documents + agreements ---------- */

export type PortalDocument = { id: string; title: string; type: string; contentType: string; size: number; uploadedAt: string };

export async function myDocuments(me: CurrentTenant): Promise<PortalDocument[]> {
  await connectDB();
  const rows = await TenantDocument.find({ tenant: me.tenantOid }).sort({ uploadedAt: -1 }).select("title type contentType size uploadedAt").lean();
  return rows.map((d) => ({
    id: toId(d._id),
    title: d.title,
    type: d.type,
    contentType: d.contentType,
    size: d.size,
    uploadedAt: new Date(d.uploadedAt).toISOString(),
  }));
}

/** Agreements of my rentals; a linked document is kept only if it is one of mine. */
export async function myAgreements(rentalIds: Types.ObjectId[], myDocIds: Set<string>): Promise<Map<string, AgreementRow[]>> {
  const map = await loadAgreements(rentalIds.map(String));
  for (const list of map.values()) for (const a of list) if (a.documentId && !myDocIds.has(a.documentId)) a.documentId = null;
  return map;
}

export async function myDocumentFile(me: CurrentTenant, documentId: string) {
  const filter = scoped(documentId, { tenant: me.tenantOid });
  if (!filter) return null;
  await connectDB();
  const doc = await TenantDocument.findOne(filter).select("title file contentType").lean();
  if (!doc) return null;
  const data = await readDocumentFile(doc.file);
  return data ? { title: doc.title, contentType: doc.contentType, data } : null;
}

/* ---------- maintenance ---------- */

export type PortalMaintenance = {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  propertyName: string;
  createdAt: string;
  updatedAt: string;
  mine: boolean;
  hasPhoto: boolean;
};

export async function myMaintenance(me: CurrentTenant, rentals: RentalRow[]): Promise<PortalMaintenance[]> {
  await connectDB();
  const rows = await Maintenance.find(maintenanceScope(me.tenantOid, activeStays(rentals))).sort({ createdAt: -1 }).limit(200).lean();
  const props = await Property.find({ _id: { $in: rows.map((m) => m.property) } }).select("name").lean();
  const propName = new Map(props.map((p) => [toId(p._id), p.name]));
  return rows.map((m) => ({
    id: toId(m._id),
    title: m.title,
    description: m.description ?? "",
    priority: m.priority,
    status: m.status,
    propertyName: propName.get(toId(m.property)) ?? "",
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    mine: !!m.tenant && toId(m.tenant) === me.tenantId,
    hasPhoto: !!m.photo,
  }));
}

/** Photo of one of MY requests (never another tenant's). */
export async function myMaintenancePhoto(me: CurrentTenant, maintenanceId: string) {
  const filter = scoped(maintenanceId, { tenant: me.tenantOid });
  if (!filter) return null;
  await connectDB();
  const m = await Maintenance.findOne(filter).select("photo photoType").lean();
  if (!m?.photo || !m.photoType) return null;
  const data = await readFile("maintenance", m.photo as Types.ObjectId);
  return data ? { data, contentType: m.photoType } : null;
}

/* ---------- admin notifications for tenant events ---------- */

export async function notifyAdmins(n: {
  type: Extract<NotificationType, "maintenance_tenant_request" | "tenant_details_changed">;
  subjectId: string;
  title: string;
  body: string;
  link: string;
  tenantId: string;
  propertyId?: string | null;
  maintenanceId?: string | null;
}): Promise<void> {
  try {
    await Notification.create({
      key: notificationKey(n.type, n.subjectId),
      type: n.type,
      category: CATEGORY_OF[n.type],
      title: n.title,
      body: n.body,
      link: n.link,
      tenant: n.tenantId,
      property: n.propertyId ?? null,
      maintenance: n.maintenanceId ?? null,
      activeSince: new Date(),
    });
  } catch (err) {
    console.error("[portal] notification failed:", err);
  }
}
