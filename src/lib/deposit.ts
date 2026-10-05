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
