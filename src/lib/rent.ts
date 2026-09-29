/**
 * Rent schedule for month-to-month rentals: computed, never stored. Payments are the single
 * source of truth.
 *
 * For each month from the move-in month through the current month (or through the move-out
 * month, if a move-out date is recorded and earlier):
 *   due = monthlyRent, paid = sum of payments for that `forMonth`,
 *   status = paid if paid >= due; otherwise overdue / partial once past the due day,
 *   upcoming before it.
 * All comparisons use ISO date strings (YYYY-MM-DD) to stay timezone-safe.
 */

export type RentalLike = {
  moveInDate: Date | string;
  moveOutDate?: Date | string | null;
  monthlyRent: number;
  dueDay: number;
};

export type PaymentLike = { forMonth: string; amount: number };

export type MonthStatus = "paid" | "partial" | "overdue" | "upcoming";

export type RentalStatus = "active" | "moved_out";

export type RentMonth = {
  month: string; // YYYY-MM
  dueDate: string; // YYYY-MM-DD
  due: number;
  paid: number;
  balance: number;
  status: MonthStatus;
  pastDue: boolean;
};

export type RentSummary = {
  totalDue: number;
  totalPaid: number;
  balance: number;
  overdueAmount: number;
  overdueMonths: number;
};

/** How far ahead rent may be prepaid for an open-ended rental. */
export const MAX_PREPAY_MONTHS = 12;

const pad = (n: number) => String(n).padStart(2, "0");

/** Dates are stored as UTC midnight; this returns their calendar date. */
export function toISODate(d: Date | string): string {
  if (typeof d === "string") return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date(d).toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in the server's local timezone. */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of months between two YYYY-MM keys. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function formatMonth(month: string, locale = "en-IN"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Derived rental status. A recorded move-out takes effect on the move-out date itself;
 * a future move-out date keeps the rental active until that day arrives.
 */
export function rentalStatus(rental: Pick<RentalLike, "moveOutDate">, today: string = localToday()): RentalStatus {
  if (!rental.moveOutDate) return "active";
  return toISODate(rental.moveOutDate) <= today ? "moved_out" : "active";
}

/** Badge key for a rental: active, moving_out (future move-out scheduled) or moved_out. */
export function rentalBadge(r: { status: RentalStatus; movingOut: boolean }): "active" | "moving_out" | "moved_out" {
  return r.status === "moved_out" ? "moved_out" : r.movingOut ? "moving_out" : "active";
}

/**
 * The range of months a payment may be recorded for: move-in month through the move-out month,
 * or (while open-ended) up to MAX_PREPAY_MONTHS past the current month.
 */
export function payableMonths(rental: RentalLike, today: string = localToday()): { first: string; last: string } {
  const first = monthOf(toISODate(rental.moveInDate));
  const last = rental.moveOutDate
    ? monthOf(toISODate(rental.moveOutDate))
    : addMonths(monthOf(today), MAX_PREPAY_MONTHS);
  return { first, last };
}

export function rentSchedule(
  rental: RentalLike,
  payments: PaymentLike[],
  today: string = localToday(),
): RentMonth[] {
  const moveIn = toISODate(rental.moveInDate);
  const firstMonth = monthOf(moveIn);
  const moveOutMonth = rental.moveOutDate ? monthOf(toISODate(rental.moveOutDate)) : null;

  const paidByMonth = new Map<string, number>();
  for (const p of payments) paidByMonth.set(p.forMonth, (paidByMonth.get(p.forMonth) ?? 0) + p.amount);

  // Rent accrues through the current month, and stops after the move-out month.
  let last = monthOf(today);
  if (moveOutMonth && moveOutMonth < last) last = moveOutMonth;
  // Show prepaid months too (never past the move-out month).
  for (const m of paidByMonth.keys()) if (m > last && (!moveOutMonth || m <= moveOutMonth)) last = m;
  if (last < firstMonth) return [];

  return monthRange(firstMonth, last).map((month) => {
    let dueDate = `${month}-${pad(rental.dueDay)}`;
    if (dueDate < moveIn) dueDate = moveIn; // first month: never due before move-in
    const due = rental.monthlyRent;
    const paid = paidByMonth.get(month) ?? 0;
    const pastDue = today > dueDate;
    const status: MonthStatus = paid >= due ? "paid" : pastDue ? (paid > 0 ? "partial" : "overdue") : "upcoming";
    return { month, dueDate, due, paid, balance: Math.max(due - paid, 0), status, pastDue };
  });
}

export function summarize(schedule: RentMonth[]): RentSummary {
  let totalDue = 0;
  let totalPaid = 0;
  let overdueAmount = 0;
  let overdueMonths = 0;
  for (const m of schedule) {
    totalDue += m.due;
    totalPaid += m.paid;
    if (m.pastDue && m.balance > 0) {
      overdueAmount += m.balance;
      overdueMonths += 1;
    }
  }
  return { totalDue, totalPaid, balance: Math.max(totalDue - totalPaid, 0), overdueAmount, overdueMonths };
}
