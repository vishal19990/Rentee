/**
 * Rent receipts (F1): pure helpers for numbering, the per-month breakdown, landlord details
 * and the WhatsApp share message. Database access lives in receipt-store.ts.
 */
import { z } from "zod";
import { fyOf } from "./fy";
import { formatMoneyShort } from "./money";
import { chargesForMonth, formatMonth, rentForMonth, type ChargeLike, type RentChangeLike } from "./rent";

export const RECEIPT_PREFIX = "RNT";

/** "RNT/2026-27/0001" (at least 4 digits; grows past 9999). */
export function formatReceiptNo(fy: string, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(`Invalid receipt sequence: ${seq}`);
  return `${RECEIPT_PREFIX}/${fy}/${String(seq).padStart(4, "0")}`;
}

/** Receipt numbers run per Indian financial year of the payment date. */
export function receiptFy(paidOnIso: string): string {
  return fyOf(paidOnIso);
}

/** Counter key for a FY's receipt sequence. */
export function receiptCounterKey(fy: string): string {
  return `receipt:${fy}`;
}

/** "Asha Menon" -> "Asha" (public pages show only the tenant's first name). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export function paymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank transfer",
    upi: "UPI",
    cheque: "Cheque",
    card: "Card",
    other: "Other",
  };
  return labels[method] ?? method;
}

export type ReceiptPaymentLike = { id: string; forMonth: string; amount: number; paidOn: string; createdAt?: string };

export type ReceiptBreakdown = {
  month: string;
  rent: number;
  chargeItems: { type: string; amount: number }[];
  /** Rent + charges for the month. */
  monthDue: number;
  /** Paid towards the month up to and including this payment. */
  paidToDate: number;
  /** Still due for the month after this payment. */
  balanceAfter: number;
};

/**
 * The month a payment is for, broken down into rent and charges, and what was paid towards it
 * up to and including this payment (payments ordered by date paid, then creation).
 */
export function receiptBreakdown(
  rental: { monthlyRent: number; rentChanges?: RentChangeLike[]; charges?: ChargeLike[] },
  payment: ReceiptPaymentLike,
  monthPayments: ReceiptPaymentLike[],
): ReceiptBreakdown {
  const month = payment.forMonth;
  const rent = rentForMonth(rental, month);
  const charges = chargesForMonth(rental, month);
  const key = (p: ReceiptPaymentLike) => `${p.paidOn}|${p.createdAt ?? ""}|${p.id}`;
  const mine = key(payment);
  let paidToDate = 0;
  for (const p of monthPayments) if (p.forMonth === month && p.id !== payment.id && key(p) < mine) paidToDate += p.amount;
  paidToDate += payment.amount;
  const monthDue = rent + charges.total;
  return { month, rent, chargeItems: charges.items, monthDue, paidToDate, balanceAfter: Math.max(monthDue - paidToDate, 0) };
}

export type LandlordDetails = { name: string; address: string; phone: string; pan: string };

/** Everything a receipt shows (admin and public views differ only in tenant/property detail). */
export type ReceiptData = {
  receiptNo: string;
  paidOn: string;
  method: string;
  amount: number;
  landlord: LandlordDetails;
  tenantName: string;
  propertyName: string;
  /** Admin view only. */
  propertyAddress: string | null;
  /** Admin view only. */
  note: string | null;
  breakdown: ReceiptBreakdown;
};

/** Message for "Send receipt on WhatsApp". */
export function receiptMessage(r: Pick<ReceiptData, "receiptNo" | "amount" | "tenantName" | "propertyName"> & { month: string }, link: string): string {
  return (
    `Hi ${firstName(r.tenantName)}, thank you for your payment of ${formatMoneyShort(r.amount)} for ${r.propertyName} ` +
    `(${formatMonth(r.month)}). Your rent receipt ${r.receiptNo}: ${link}`
  );
}

/* ---------- Settings: landlord details printed on receipts ---------- */

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .transform((v) => v || "");

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const landlordSettingsSchema = z.object({
  landlordName: text("Name", 120),
  landlordAddress: text("Address", 300),
  landlordPhone: text("Phone", 30).refine((v) => !v || /^[+\d][\d\s()-]{6,}$/.test(v), "Enter a valid phone number"),
  landlordPan: z
    .string()
    .optional()
    .transform((v) => (v ?? "").replace(/\s/g, "").toUpperCase())
    .refine((v) => !v || PAN_RE.test(v), "PAN must look like ABCDE1234F"),
});
