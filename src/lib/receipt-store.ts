import "server-only";
import { Types } from "mongoose";
import { connectDB } from "./db";
import { asObjectId, toId } from "./data";
import { getLandlordDetails } from "./landlord-settings";
import {
  firstName,
  formatReceiptNo,
  paymentMethodLabel,
  receiptBreakdown,
  receiptCounterKey,
  receiptFy,
  type ReceiptData,
  depositReceiptCounterKey,
  formatDepositReceiptNo,
  type DepositReceiptData,
} from "./receipts";
import { depositPaymentLabel } from "./deposit";
import { toISODate } from "./rent";
import { Charge } from "@/models/Charge";
import { Counter } from "@/models/Counter";
import { DepositEntry } from "@/models/DepositEntry";
import { Payment } from "@/models/Payment";
import { Property } from "@/models/Property";
import { Rental } from "@/models/Rental";
import { RentChange } from "@/models/RentChange";
import { Tenant } from "@/models/Tenant";

/**
 * Next receipt number for a financial year. The sequence is a single document incremented
 * atomically with $inc, so concurrent payments never share a number.
 */
export async function nextReceiptNo(fy: string): Promise<string> {
  await connectDB();
  const key = receiptCounterKey(fy);
  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean();
      return formatReceiptNo(fy, doc!.seq);
    } catch (err) {
      // Two first-ever upserts for the same key can race on _id; the loser just retries.
      if ((err as { code?: number }).code === 11000 && attempt < 3) continue;
      throw err;
    }
  }
}

/**
 * The payment's receipt number, assigning one (from its payment date's FY) if it has none yet.
 * Payments recorded before receipts existed get theirs the first time a receipt is opened.
 */
export async function ensureReceiptNo(paymentId: Types.ObjectId | string): Promise<string | null> {
  await connectDB();
  const p = await Payment.findById(paymentId).select("paidOn receiptNo").lean();
  if (!p) return null;
  if (p.receiptNo) return p.receiptNo;
  const receiptNo = await nextReceiptNo(receiptFy(toISODate(p.paidOn)));
  const res = await Payment.updateOne({ _id: p._id, receiptNo: null }, { $set: { receiptNo } });
  if (res.modifiedCount === 1) return receiptNo;
  // Someone else numbered it first (the number we drew is left unused).
  const again = await Payment.findById(p._id).select("receiptNo").lean();
  return again?.receiptNo ?? null;
}

/**
 * Everything a receipt shows. `view: "public"` (the /r/ share link) shows only the tenant's
 * first name and the property name — no address, note, phone or ID details.
 */
export async function loadReceipt(paymentId: string, view: "admin" | "public"): Promise<ReceiptData | null> {
  const _id = asObjectId(paymentId);
  if (!_id) return null;
  await connectDB();
  const receiptNo = await ensureReceiptNo(_id);
  const payment = await Payment.findById(_id).lean();
  if (!payment || !receiptNo) return null;
  const rental = await Rental.findById(payment.rental).select("property tenant monthlyRent").lean();
  if (!rental) return null;

  const [tenant, property, changes, charges, monthPayments, landlord] = await Promise.all([
    Tenant.findById(rental.tenant).select("name").lean(),
    Property.findById(rental.property).select("name address city").lean(),
    RentChange.find({ rental: rental._id }).select("effectiveMonth monthlyRent").lean(),
    Charge.find({ rental: rental._id, month: payment.forMonth }).sort({ createdAt: 1 }).select("month type amount").lean(),
    Payment.find({ rental: rental._id, forMonth: payment.forMonth }).select("forMonth amount paidOn createdAt").lean(),
    getLandlordDetails(),
  ]);

  const asLike = (p: { _id: unknown; forMonth: string; amount: number; paidOn: Date; createdAt?: Date }) => ({
    id: toId(p._id),
    forMonth: p.forMonth,
    amount: p.amount,
    paidOn: toISODate(p.paidOn),
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : "",
  });
  const breakdown = receiptBreakdown(
    {
      monthlyRent: rental.monthlyRent,
      rentChanges: changes.map((c) => ({ effectiveMonth: c.effectiveMonth, monthlyRent: c.monthlyRent })),
      charges: charges.map((c) => ({ month: c.month, type: c.type, amount: c.amount })),
    },
    asLike(payment),
    monthPayments.map(asLike),
  );

  const tenantName = tenant?.name ?? "Tenant";
  const isPublic = view === "public";
  return {
    receiptNo,
    paidOn: toISODate(payment.paidOn),
    method: paymentMethodLabel(payment.method),
    amount: payment.amount,
    landlord,
    tenantName: isPublic ? firstName(tenantName) : tenantName,
    propertyName: property?.name ?? "Property",
    propertyAddress: isPublic || !property ? null : [property.address, property.city].filter(Boolean).join(", "),
    note: isPublic ? null : payment.note || null,
    breakdown,
  };
}

/* ---------- security deposit receipts ---------- */

/** Next deposit receipt number ("DEP/<FY>/<seq>") from its own atomic counter. */
export async function nextDepositReceiptNo(fy: string): Promise<string> {
  await connectDB();
  const key = depositReceiptCounterKey(fy);
  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean();
      return formatDepositReceiptNo(fy, doc!.seq);
    } catch (err) {
      if ((err as { code?: number }).code === 11000 && attempt < 3) continue;
      throw err;
    }
  }
}

/**
 * A received deposit entry's receipt number, assigning one (from its date's FY) if it has none.
 * New payments are numbered when recorded; older entries the first time their receipt opens.
 * Returns null for unknown ids and for deductions / refunds (they have no receipt).
 */
export async function ensureDepositReceiptNo(entryId: Types.ObjectId | string): Promise<string | null> {
  await connectDB();
  const e = await DepositEntry.findById(entryId).select("kind date receiptNo").lean();
  if (!e || e.kind !== "received") return null;
  if (e.receiptNo) return e.receiptNo;
  const receiptNo = await nextDepositReceiptNo(receiptFy(toISODate(e.date)));
  const res = await DepositEntry.updateOne({ _id: e._id, receiptNo: null }, { $set: { receiptNo } });
  if (res.modifiedCount === 1) return receiptNo;
  const again = await DepositEntry.findById(e._id).select("receiptNo").lean();
  return again?.receiptNo ?? null;
}

/**
 * Everything a deposit receipt shows. `view: "public"` shows only the tenant's first name and
 * the property name (no address or note), as for rent receipts.
 */
export async function loadDepositReceipt(entryId: string, view: "admin" | "public"): Promise<DepositReceiptData | null> {
  const _id = asObjectId(entryId);
  if (!_id) return null;
  await connectDB();
  const receiptNo = await ensureDepositReceiptNo(_id);
  const entry = await DepositEntry.findById(_id).lean();
  if (!entry || !receiptNo) return null;
  const rental = await Rental.findById(entry.rental).select("property tenant deposit moveInDate depositAdvance").lean();
  if (!rental) return null;
  const [tenant, property, received, landlord] = await Promise.all([
    Tenant.findById(rental.tenant).select("name").lean(),
    Property.findById(rental.property).select("name address city").lean(),
    DepositEntry.find({ rental: rental._id, kind: "received" }).select("amount date createdAt").lean(),
    getLandlordDetails(),
  ]);
  // Received up to and including this entry (by date, then creation).
  const key = (x: { date: Date; createdAt?: Date; _id: unknown }) =>
    `${toISODate(x.date)}|${x.createdAt ? new Date(x.createdAt).toISOString() : ""}|${toId(x._id)}`;
  const mine = key(entry);
  const totalReceived = received.filter((x) => key(x) <= mine).reduce((s, x) => s + x.amount, 0);
  const advanceFlow = !!rental.depositAdvance;

  const tenantName = tenant?.name ?? "Tenant";
  const isPublic = view === "public";
  const date = toISODate(entry.date);
  return {
    kind: "deposit",
    receiptNo,
    paidOn: date,
    method: entry.method ? paymentMethodLabel(entry.method) : "",
    amount: entry.amount,
    landlord,
    tenantName: isPublic ? firstName(tenantName) : tenantName,
    propertyName: property?.name ?? "Property",
    propertyAddress: isPublic || !property ? null : [property.address, property.city].filter(Boolean).join(", "),
    note: isPublic ? null : entry.reason || null,
    label: depositPaymentLabel(date, toISODate(rental.moveInDate)),
    agreed: rental.deposit,
    totalReceived,
    balance: advanceFlow ? Math.max(rental.deposit - totalReceived, 0) : 0,
  };
}
