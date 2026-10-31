/**
 * Security deposit ledger (pure). Entries are append-only: received (money in), deduction
 * (kept for damages / dues), refund (money back). Held = received − deductions − refunds,
 * and can never go negative. Corrections are new entries, never edits or deletes.
 */
import { formatMoneyShort } from "./money";

export const DEPOSIT_KINDS = ["received", "deduction", "refund"] as const;
export type DepositKind = (typeof DEPOSIT_KINDS)[number];

export const DEPOSIT_KIND_LABELS: Record<DepositKind, string> = {
  received: "Received",
  deduction: "Deduction",
  refund: "Refund",
};

export type DepositEntryLike = { kind: string; amount: number };

export type DepositSummary = { received: number; deducted: number; refunded: number; held: number };

export function depositSummary(entries: DepositEntryLike[]): DepositSummary {
  let received = 0;
  let deducted = 0;
  let refunded = 0;
  for (const e of entries) {
    if (e.kind === "received") received += e.amount;
    else if (e.kind === "deduction") deducted += e.amount;
    else if (e.kind === "refund") refunded += e.amount;
  }
  return { received, deducted, refunded, held: received - deducted - refunded };
}

/** Error message if this entry would make the held balance negative, else null. */
export function depositEntryError(held: number, kind: DepositKind, amount: number): string | null {
  if (kind === "received") return null;
  if (amount <= held) return null;
  return held > 0 ? `Cannot exceed held deposit ${formatMoneyShort(held)}` : "No deposit is held for this rental";
}

/* ---------- advance and part payments ---------- */

/**
 * Rentals created with an advance (`Rental.depositAdvance` set) record the deposit as it is
 * paid: received entries dated on or before move-in are the **Advance**, later ones are
 * **Part payments** ("Paid later"). Balance = agreed − total received (never negative).
 * Rentals without it (created before this) were recorded as fully paid at move-in, so their
 * balance is always 0.
 */
export const DEPOSIT_METHODS = ["cash", "upi", "bank_transfer", "cheque", "other"] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];

/** How many days before move-in a deposit payment may be dated. */
export const DEPOSIT_EARLIEST_DAYS = 60;

export type DepositPaymentLabel = "Advance" | "Part payment";

/** "Advance" for a payment dated on or before move-in, otherwise "Part payment". */
export function depositPaymentLabel(date: string, moveInDate: string): DepositPaymentLabel {
  return date <= moveInDate ? "Advance" : "Part payment";
}

/** Display label for any ledger entry (received entries are Advance / Part payment). */
export function depositEntryLabel(entry: { kind: string; date: string }, moveInDate: string): string {
  if (entry.kind === "received") return depositPaymentLabel(entry.date, moveInDate);
  return DEPOSIT_KIND_LABELS[entry.kind as DepositKind] ?? entry.kind;
}

export type DepositStatus = DepositSummary & {
  /** Deposit quoted (agreed) to the tenant. */
  agreed: number;
  /** Received on or before the move-in date. */
  advance: number;
  /** Received after the move-in date. */
  paidLater: number;
  /** Still to be paid towards the deposit (always 0 for rentals without the advance flow). */
  balance: number;
};

export function depositStatus(
  rental: { deposit: number; moveInDate: string; advanceFlow: boolean },
  entries: (DepositEntryLike & { date: string })[],
): DepositStatus {
  const summary = depositSummary(entries);
  let advance = 0;
  let paidLater = 0;
  for (const e of entries) {
    if (e.kind !== "received") continue;
    if (e.date <= rental.moveInDate) advance += e.amount;
    else paidLater += e.amount;
  }
  const balance = rental.advanceFlow ? Math.max(rental.deposit - summary.received, 0) : 0;
  return { ...summary, agreed: rental.deposit, advance, paidLater, balance };
}

/** Error for a deposit payment of `amount` when `balance` is still due, else null. */
export function depositPaymentError(balance: number, amount: number): string | null {
  if (balance <= 0) return "The deposit is fully paid";
  if (amount > balance) return `Only ${formatMoneyShort(balance)} of the deposit is still due`;
  return null;
}

/** Error when the agreed deposit would drop below what has already been received, else null. */
export function agreedDepositError(agreed: number, received: number): string | null {
  return agreed < received ? `Agreed deposit can't be less than ${formatMoneyShort(received)} already received` : null;
}

/** Message for "Remind on WhatsApp" on the deposit card. */
export function depositReminderMessage(tenantName: string, propertyName: string, balance: number): string {
  return `Hi ${tenantName}, a gentle reminder that ${formatMoneyShort(balance)} of the security deposit for ${propertyName} is still due. Thank you!`;
}
