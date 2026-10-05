/**
 * UPI pay links (F10): pure helpers. The tenant pays from their own UPI app; nothing is recorded
 * automatically — the landlord records the payment once it arrives.
 */
import { z } from "zod";
import { CURRENCY, minorDigits } from "./money";
import { addMonths, dueForMonth, monthOf, monthRange, type ChargeLike, type RentChangeLike, type RentMonth } from "./rent";

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

export type PayDue = { months: { month: string; balance: number }[]; amount: number };

/**
 * What a pay link asks for, computed live: every unpaid balance in the rent schedule up to the
 * current month (or up to `through`, the last month the link was made for), plus months up to
 * `through` that haven't started yet (e.g. next month's rent from a "due soon" reminder).
 * Fully paid -> amount 0.
 */
export function payDue(
  rental: {
    moveInDate: string;
    moveOutDate: string | null;
    monthlyRent: number;
    rentChanges?: RentChangeLike[];
    charges?: ChargeLike[];
    schedule: RentMonth[];
  },
  through: string | null,
  today: string,
): PayDue {
  const current = monthOf(today);
  const last = through && through > current ? through : current;
  const months: { month: string; balance: number }[] = [];
  const listed = new Set<string>();
  for (const m of rental.schedule) {
    listed.add(m.month);
    if (m.month <= last && m.balance > 0) months.push({ month: m.month, balance: m.balance });
  }
  if (last > current) {
    const first = monthOf(rental.moveInDate);
    const moveOut = rental.moveOutDate ? monthOf(rental.moveOutDate) : null;
    for (const m of monthRange(addMonths(current, 1), last)) {
      if (listed.has(m) || m < first || (moveOut && m > moveOut)) continue;
      const due = dueForMonth(rental, m);
      if (due > 0) months.push({ month: m, balance: due });
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
