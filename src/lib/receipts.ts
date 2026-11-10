/**
 * Rent receipts (F1): pure helpers for numbering, the per-month breakdown, landlord details
 * and the WhatsApp share message. Database access lives in receipt-store.ts.
 */
import { z } from "zod";
import { fyOf } from "./fy";
import { formatMoneyShort } from "./money";
import { addDays, addMonths, cycleBill, formatCycle, type ChargeItem, type RentalLike } from "./rent";

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
  /** Billing cycle key (YYYY-MM) the payment is for. */
  month: string;
  /** The cycle's period (YYYY-MM-DD); see formatCycle. */
  start: string;
  end: string;
  rent: number;
  chargeItems: ChargeItem[];
  /** Rent + charges (incl. WiFi) for the cycle. */
  monthDue: number;
  /** Paid towards the cycle up to and including this payment. */
  paidToDate: number;
  /** Still due for the cycle after this payment. */
  balanceAfter: number;
};

/**
 * The billing cycle a payment is for, broken down into rent and charges, and what was paid
 * towards it up to and including this payment (payments ordered by date paid, then creation).
 */
export function receiptBreakdown(
  rental: RentalLike,
  payment: ReceiptPaymentLike,
  monthPayments: ReceiptPaymentLike[],
): ReceiptBreakdown {
  const month = payment.forMonth;
  const bill = cycleBill(rental, month);
  // A payment outside the stay (legacy data) still gets a receipt: label it with the calendar month.
  const start = bill.cycle?.start ?? `${month}-01`;
  const end = bill.cycle?.end ?? addDays(`${addMonths(month, 1)}-01`, -1);
  const key = (p: ReceiptPaymentLike) => `${p.paidOn}|${p.createdAt ?? ""}|${p.id}`;
  const mine = key(payment);
  let paidToDate = 0;
  for (const p of monthPayments) if (p.forMonth === month && p.id !== payment.id && key(p) < mine) paidToDate += p.amount;
  paidToDate += payment.amount;
  const monthDue = bill.due;
  return { month, start, end, rent: bill.rent, chargeItems: bill.chargeItems, monthDue, paidToDate, balanceAfter: Math.max(monthDue - paidToDate, 0) };
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
export function receiptMessage(
  r: Pick<ReceiptData, "receiptNo" | "amount" | "tenantName" | "propertyName"> & { start: string; end: string },
  link: string,
): string {
  return (
    `Hi ${firstName(r.tenantName)}, thank you for your payment of ${formatMoneyShort(r.amount)} for ${r.propertyName} ` +
    `(${formatCycle(r)}). Your rent receipt ${r.receiptNo}: ${link}`
  );
}

/* ---------- security deposit receipts ---------- */

export const DEPOSIT_RECEIPT_PREFIX = "DEP";

/** "DEP/2026-27/0001": its own sequence per FY of the payment date, separate from rent receipts. */
export function formatDepositReceiptNo(fy: string, seq: number): string {
  return formatReceiptNo(fy, seq).replace(RECEIPT_PREFIX, DEPOSIT_RECEIPT_PREFIX);
}

export function depositReceiptCounterKey(fy: string): string {
  return `deposit-receipt:${fy}`;
}

/** A security deposit receipt (one received ledger entry). Same privacy rules as rent receipts. */
export type DepositReceiptData = {
  kind: "deposit";
  receiptNo: string;
  paidOn: string;
  /** "" when the entry has no method recorded. */
  method: string;
  amount: number;
  landlord: LandlordDetails;
  tenantName: string;
  propertyName: string;
  /** Admin view only. */
  propertyAddress: string | null;
  /** Admin view only. */
  note: string | null;
  /** "Advance" (on or before move-in) or "Part payment". */
  label: string;
  /** Deposit quoted. */
  agreed: number;
  /** Total received up to and including this payment. */
  totalReceived: number;
  /** Still due after this payment. */
  balance: number;
};

export function isDepositReceipt(r: ReceiptData | DepositReceiptData): r is DepositReceiptData {
  return (r as DepositReceiptData).kind === "deposit";
}

/** Message for "Send receipt on WhatsApp" on a deposit receipt. */
export function depositReceiptMessage(r: Pick<DepositReceiptData, "receiptNo" | "amount" | "tenantName" | "propertyName">, link: string): string {
  return (
    `Hi ${firstName(r.tenantName)}, thank you for your security deposit payment of ${formatMoneyShort(r.amount)} for ` +
    `${r.propertyName}. Your deposit receipt ${r.receiptNo}: ${link}`
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
