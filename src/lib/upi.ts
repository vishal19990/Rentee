/**
 * UPI pay links (F10): pure helpers. The tenant pays from their own UPI app; nothing is recorded
 * automatically — the landlord records the payment once it arrives.
 */
import { z } from "zod";
import { CURRENCY, minorDigits } from "./money";
import { addMonths, cycleBill, monthOf, monthRange, type ChargeLike, type RentChangeLike, type RentMonth, type WifiPlanLike } from "./rent";

/** UPI VPA, e.g. "landlord@okhdfcbank". */
export const VPA_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

export type UpiSettings = { upiId: string; payeeName: string };

/** UPI is only offered when a UPI ID is set and the app currency is INR. */
export function upiEnabled(s: { upiId?: string | null } | null | undefined, currency: string = CURRENCY): boolean {
  return !!s?.upiId && VPA_RE.test(s.upiId) && currency === "INR";
}

/** Amount in minor units as the UPI "am" parameter: 700000 -> "7000.00". */
export function upiAmount(minor: number): string {
  const digits = minorDigits("INR");
  return (minor / 10 ** digits).toFixed(digits);
}

/** upi://pay deep link (also the QR code content). */
export function upiUri(p: { vpa: string; payeeName: string; amount: number; note: string }): string {
  const q = [
    `pa=${encodeURIComponent(p.vpa)}`,
    `pn=${encodeURIComponent(p.payeeName)}`,
    `am=${upiAmount(p.amount)}`,
    `cu=INR`,
    `tn=${encodeURIComponent(p.note.slice(0, 50))}`,
  ];
  return `upi://pay?${q.join("&")}`;
}

export type PayDue = { months: { month: string; start: string; end: string; balance: number }[]; amount: number };

/**
 * What a pay link asks for, computed live: every unpaid billing cycle whose due date has arrived
 * (rent is paid at the end of a cycle), plus unpaid cycles up to `through` (the last cycle key the
 * link was made for), including ones not yet listed (e.g. the next cycle from a "due soon"
 * reminder). Fully paid -> amount 0.
 */
export function payDue(
  rental: {
    moveInDate: string;
    moveOutDate: string | null;
    monthlyRent: number;
    rentChanges?: RentChangeLike[];
    charges?: ChargeLike[];
    wifiPlans?: WifiPlanLike[];
    schedule: RentMonth[];
  },
  through: string | null,
  today: string,
): PayDue {
  const months: PayDue["months"] = [];
  const listed = new Set<string>();
  for (const m of rental.schedule) {
    listed.add(m.month);
    const covered = m.dueDate <= today || (through !== null && m.month <= through);
    if (covered && m.balance > 0) months.push({ month: m.month, start: m.start, end: m.end, balance: m.balance });
  }
  const lastListed = rental.schedule.length ? rental.schedule[rental.schedule.length - 1].month : null;
  if (through && (!lastListed || through > lastListed)) {
    const from = lastListed ? addMonths(lastListed, 1) : monthOf(rental.moveInDate);
    for (const m of monthRange(from, through)) {
      if (listed.has(m)) continue;
      const bill = cycleBill(rental, m);
      if (bill.cycle && bill.due > 0) months.push({ month: m, start: bill.cycle.start, end: bill.cycle.end, balance: bill.due });
    }
  }
  months.sort((a, b) => (a.month < b.month ? -1 : 1));
  return { months, amount: months.reduce((s, m) => s + m.balance, 0) };
}

export const upiSettingsSchema = z.object({
  upiId: z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .refine((v) => !v || VPA_RE.test(v), "Enter a UPI ID like name@bank"),
  upiPayeeName: z
    .string()
    .trim()
    .max(80, "Payee name must be at most 80 characters")
    .optional()
    .transform((v) => v || ""),
});
