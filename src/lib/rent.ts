/**
 * Rent schedule for month-to-month rentals: computed, never stored. Payments are the single
 * source of truth.
 *
 * Rent is billed in **billing cycles** that run from the move-in day ("anniversary" cycles) and
 * is paid at the **end** of each cycle. Cycle k (k = 0, 1, 2…):
 *   start   = addMonthsClamped(moveIn, k)
 *   end     = addMonthsClamped(moveIn, k + 1) − 1 day
 *   dueDate = addMonthsClamped(moveIn, k + 1)   (the next anniversary)
 * e.g. moved in 20 Oct → cycle 20 Oct – 19 Nov, due 20 Nov. The move-in day is clamped to short
 * months but never drifts (31 Jan → due 28 Feb → 31 Mar).
 *
 * Every calendar month holds exactly one cycle start, so a cycle is keyed by the month it starts
 * in (YYYY-MM, `monthOf(start)`). Payments (`forMonth`), charges (`month`) and rent changes
 * (`effectiveMonth`) use that key: they apply to the cycle that starts in that month.
 *
 * For each cycle that has started by today (plus prepaid / already-charged future cycles), never
 * past the final cycle when a move-out date is recorded:
 *   rent    = latest rent change effective on/before the key month, else the original rent;
 *             a final cycle cut short by the move-out date is pro-rated by days,
 *   charges = charges for the key month (chargesForMonth: the single seam for month-keyed
 *             charge items — stored charges + WiFi from a WiFi plan, see wifi.ts),
 *   due = rent + charges, paid = sum of payments for that `forMonth`,
 *   status  = paid if paid >= due; otherwise overdue / partial from the day after the due date,
 *             upcoming until then (the due date itself is not overdue).
 * All comparisons use ISO date strings (YYYY-MM-DD) to stay timezone-safe.
 */
import { LOCALE, minorDigits } from "./money";
import { wifiItemForMonth, type WifiPlanLike } from "./wifi";

export type { WifiPlanLike } from "./wifi";

/** A rent change: from `effectiveMonth` (YYYY-MM) on, the monthly rent is `monthlyRent`. */
export type RentChangeLike = { effectiveMonth: string; monthlyRent: number };

/**
 * A utility / other charge billed for a month: added to the cycle that starts in that month.
 * Any month-keyed extra charge item (e.g. a recurring plan's virtual item) fits this shape.
 */
export type ChargeLike = { month: string; type: string; amount: number };

export type RentalLike = {
  moveInDate: Date | string;
  moveOutDate?: Date | string | null;
  /** The rental's original (agreed at move-in) monthly rent. */
  monthlyRent: number;
  rentChanges?: RentChangeLike[];
  /** Month-keyed charge items (see chargesForMonth). */
  charges?: ChargeLike[];
  /** WiFi plans (billed per person as a virtual "wifi" charge item). */
  wifiPlans?: WifiPlanLike[];
};

/** Just the dates that define a rental's billing cycles. */
export type StayLike = Pick<RentalLike, "moveInDate" | "moveOutDate">;

export type PaymentLike = { forMonth: string; amount: number };

export type ChargeItem = { type: string; amount: number; label?: string };

export type MonthStatus = "paid" | "partial" | "overdue" | "upcoming";

export type RentalStatus = "active" | "moved_out";

/** A billing cycle's dates (see the file comment). */
export type BillingCycle = {
  /** Cycle key: the month the cycle starts in (YYYY-MM). */
  month: string;
  /** First day of the cycle (YYYY-MM-DD). */
  start: string;
  /** Last day of the cycle (the move-out date for a final cycle cut short). */
  end: string;
  /** Next anniversary, or the move-out date for the final cycle. */
  dueDate: string;
  /** Days covered by this cycle (fewer than fullDays only for a short final cycle). */
  days: number;
  /** Days in the full cycle (start to next anniversary). */
  fullDays: number;
};

/** One rent billing cycle in a rental's schedule. */
export type RentMonth = {
  /** Cycle key (YYYY-MM): the month the cycle starts in; payments' `forMonth` refers to it. */
  month: string;
  /** First / last day of the cycle (YYYY-MM-DD). */
  start: string;
  end: string;
  dueDate: string; // YYYY-MM-DD
  /** Rent for this cycle (after rent changes; pro-rated for a short final cycle). */
  rent: number;
  /** Total utility / other charges for this cycle's key month. */
  charges: number;
  /** Charge breakdown by type, in insertion order (WiFi last, with a label like "WiFi (2 people)"). */
  chargeItems: ChargeItem[];
  /** rent + charges. */
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

/** Months from `from` to `to` (YYYY-MM keys); negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return ty * 12 + tm - (fy * 12 + fm);
}

/** Whole days from ISO date `from` to `to`. */
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * `isoDate` + n months, keeping its day and clamping to the month's last day:
 * 2027-01-31 + 1 → 2027-02-28, + 2 → 2027-03-31 (always from the original day, never drifting).
 */
export function addMonthsClamped(isoDate: string, n: number): string {
  const month = addMonths(monthOf(isoDate), n);
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${pad(Math.min(Number(isoDate.slice(8, 10)), lastDay))}`;
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

/* ---------------- billing cycles ---------------- */

/**
 * Key of the billing cycle that contains `isoDate` (the latest cycle started on or before it),
 * or null before the move-in date. Ignores move-out.
 */
export function cycleMonthOn(rental: Pick<RentalLike, "moveInDate">, isoDate: string): string | null {
  const moveIn = toISODate(rental.moveInDate);
  if (isoDate < moveIn) return null;
  let k = monthsBetween(monthOf(moveIn), monthOf(isoDate));
  if (addMonthsClamped(moveIn, k) > isoDate) k -= 1;
  return addMonths(monthOf(moveIn), k);
}

/**
 * Key of the final billing cycle when a move-out date is recorded (null while open-ended): the
 * cycle containing the move-out date. A move-out exactly on an anniversary ends the stay with
 * the cycle before it (no 1-day cycle is billed).
 */
export function finalCycleMonth(rental: StayLike): string | null {
  if (!rental.moveOutDate) return null;
  const moveIn = toISODate(rental.moveInDate);
  const moveOut = toISODate(rental.moveOutDate);
  const first = monthOf(moveIn);
  const key = cycleMonthOn(rental, moveOut);
  if (!key) return first;
  if (key > first && addMonthsClamped(moveIn, monthsBetween(first, key)) === moveOut) return addMonths(key, -1);
  return key;
}

/**
 * The billing cycle for a key month (YYYY-MM), or null when the rental has no cycle starting in
 * that month (before move-in, or after the final cycle).
 */
export function cycleFor(rental: StayLike, month: string): BillingCycle | null {
  const moveIn = toISODate(rental.moveInDate);
  const k = monthsBetween(monthOf(moveIn), month);
  if (k < 0) return null;
  const final = finalCycleMonth(rental);
  if (final && month > final) return null;
  const start = addMonthsClamped(moveIn, k);
  const next = addMonthsClamped(moveIn, k + 1);
  const fullDays = dayDiff(start, next);
  const cycle: BillingCycle = { month, start, end: addDays(next, -1), dueDate: next, days: fullDays, fullDays };
  if (final === month) {
    const moveOut = toISODate(rental.moveOutDate!);
    cycle.dueDate = moveOut;
    if (moveOut < cycle.end) {
      cycle.end = moveOut < start ? start : moveOut;
      cycle.days = dayDiff(start, cycle.end) + 1;
    }
  }
  return cycle;
}

const dayMonth = (iso: string, locale: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * A cycle's period: "20 Oct – 19 Nov 2026" ("20 Dec 2026 – 19 Jan 2027" across years);
 * short form (tight spaces) "20 Oct–19 Nov".
 */
export function formatCycle(c: { start: string; end: string }, opts: { short?: boolean; locale?: string } = {}): string {
  const locale = opts.locale ?? LOCALE;
  const from = dayMonth(c.start, locale);
  const to = dayMonth(c.end, locale);
  if (opts.short) return `${from}–${to}`;
  const y1 = c.start.slice(0, 4);
  const y2 = c.end.slice(0, 4);
  return y1 === y2 ? `${from} – ${to} ${y2}` : `${from} ${y1} – ${to} ${y2}`;
}

/** Period label for a key month of a rental; falls back to the month name outside its stay. */
export function formatCycleMonth(rental: StayLike, month: string, opts: { short?: boolean; locale?: string } = {}): string {
  const c = cycleFor(rental, month);
  return c ? formatCycle(c, opts) : formatMonth(month);
}

/** Rent for a cycle: the full monthly rent, pro-rated by days (to the nearest major unit) when cut short. */
export function cycleRent(fullRent: number, cycle: Pick<BillingCycle, "days" | "fullDays"> | null): number {
  if (!cycle || cycle.days >= cycle.fullDays) return fullRent;
  const unit = 10 ** minorDigits();
  return Math.round((fullRent * cycle.days) / cycle.fullDays / unit) * unit;
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
 * The range of cycle keys a payment may be recorded for: the move-in cycle through the final
 * cycle, or (while open-ended) up to MAX_PREPAY_MONTHS past the current month.
 */
export function payableMonths(rental: StayLike, today: string = localToday()): { first: string; last: string } {
  const first = monthOf(toISODate(rental.moveInDate));
  const last = finalCycleMonth(rental) ?? addMonths(monthOf(today), MAX_PREPAY_MONTHS);
  return { first, last };
}

/**
 * "For period" choices when recording a payment: every payable cycle (label = period, value = key
 * month), oldest first. Default: the oldest unpaid cycle that is already due, else the current
 * cycle (clamped to the payable range).
 */
export function paymentPeriodOptions(
  rental: StayLike,
  schedule: Pick<RentMonth, "month" | "pastDue" | "balance">[],
  today: string = localToday(),
): { options: { value: string; label: string }[]; defaultMonth: string } {
  const { first, last } = payableMonths(rental, today);
  const options = monthRange(first, last).map((m) => ({ value: m, label: formatCycleMonth(rental, m) }));
  const unpaidDue = schedule.find((m) => m.pastDue && m.balance > 0)?.month;
  const current = cycleMonthOn(rental, today) ?? first;
  const defaultMonth = unpaidDue ?? (current > last ? last : current < first ? first : current);
  return { options, defaultMonth };
}

/**
 * Rent for a month: the latest rent change with effectiveMonth <= month, else the original rent.
 */
export function rentForMonth(rental: Pick<RentalLike, "monthlyRent" | "rentChanges">, month: string): number {
  let best: RentChangeLike | null = null;
  for (const c of rental.rentChanges ?? []) {
    if (c.effectiveMonth <= month && (!best || c.effectiveMonth > best.effectiveMonth)) best = c;
  }
  return best ? best.monthlyRent : rental.monthlyRent;
}

/** Rental fields charges depend on; the stay dates (when given) keep WiFi inside the stay. */
type ChargeTerms = Pick<RentalLike, "charges" | "wifiPlans"> & {
  moveInDate?: Date | string | null;
  moveOutDate?: Date | string | null;
};

/**
 * Charges billed for a key month: total and per-type breakdown (same types merged), plus WiFi.
 * This is the single seam for month-keyed charge items: stored charges with `month` = a cycle's
 * key, and the WiFi plan's virtual item for that month, are added to the cycle starting in that
 * month (never pro-rated). Keys after the final cycle are never billed (see cycleFor).
 */
export function chargesForMonth(rental: ChargeTerms, month: string): { total: number; items: ChargeItem[] } {
  const byType = new Map<string, number>();
  for (const c of rental.charges ?? []) {
    if (c.month !== month) continue;
    byType.set(c.type, (byType.get(c.type) ?? 0) + c.amount);
  }
  const items: ChargeItem[] = [...byType].map(([type, amount]) => ({ type, amount }));
  const wifi = wifiItemForMonth(rental, month);
  if (wifi) items.push(wifi);
  return { total: items.reduce((s, i) => s + i.amount, 0), items };
}

/**
 * What a cycle bills: its dates (null outside the stay), rent (after changes, pro-rated for a short
 * final cycle) and the key month's charges incl. WiFi (never pro-rated).
 */
export function cycleBill(
  rental: RentalLike,
  month: string,
): { cycle: BillingCycle | null; rent: number; charges: number; chargeItems: ChargeItem[]; due: number } {
  const cycle = cycleFor(rental, month);
  const rent = cycleRent(rentForMonth(rental, month), cycle);
  const charges = chargesForMonth(rental, month);
  return { cycle, rent, charges: charges.total, chargeItems: charges.items, due: rent + charges.total };
}

/** What is due for a cycle (by key month): rent (after changes, pro-rated if cut short) + charges (+ WiFi). */
export function dueForMonth(rental: RentalLike, month: string): number {
  return cycleBill(rental, month).due;
}

/** The cycle key "now": the current cycle, or the month itself without a move-in date / before move-in. */
function currentKey(rental: Partial<Pick<RentalLike, "moveInDate">>, today: string): string {
  return (rental.moveInDate && cycleMonthOn({ moveInDate: rental.moveInDate }, today)) || monthOf(today);
}

/** Rent in force today: the current cycle's rent (reflects rent changes effective for it or earlier). */
export function currentRent(
  rental: Pick<RentalLike, "monthlyRent" | "rentChanges"> & Partial<Pick<RentalLike, "moveInDate">>,
  today: string = localToday(),
): number {
  return rentForMonth(rental, currentKey(rental, today));
}

/** The next rent change that takes effect after the current cycle, if any. */
export function upcomingRentChange(
  rental: Pick<RentalLike, "rentChanges"> & Partial<Pick<RentalLike, "moveInDate">>,
  today: string = localToday(),
): RentChangeLike | null {
  const now = currentKey(rental, today);
  let best: RentChangeLike | null = null;
  for (const c of rental.rentChanges ?? []) {
    if (c.effectiveMonth > now && (!best || c.effectiveMonth < best.effectiveMonth)) best = c;
  }
  return best;
}

export function rentSchedule(
  rental: RentalLike,
  payments: PaymentLike[],
  today: string = localToday(),
): RentMonth[] {
  const firstMonth = monthOf(toISODate(rental.moveInDate));
  const finalMonth = finalCycleMonth(rental);

  const paidByMonth = new Map<string, number>();
  for (const p of payments) paidByMonth.set(p.forMonth, (paidByMonth.get(p.forMonth) ?? 0) + p.amount);

  // Cycles that have started by today, never past the final cycle.
  let last = cycleMonthOn(rental, today) ?? addMonths(firstMonth, -1);
  if (finalMonth && finalMonth < last) last = finalMonth;
  // Show prepaid cycles (and cycles already billed charges) too, never past the final cycle.
  const extra = [...paidByMonth.keys(), ...(rental.charges ?? []).map((c) => c.month)];
  for (const m of extra) if (m > last && (!finalMonth || m <= finalMonth)) last = m;
  if (last < firstMonth) return [];

  return monthRange(firstMonth, last).map((month) => {
    const bill = cycleBill(rental, month);
    const cycle = bill.cycle!;
    const paid = paidByMonth.get(month) ?? 0;
    const pastDue = today > cycle.dueDate;
    const status: MonthStatus = paid >= bill.due ? "paid" : pastDue ? (paid > 0 ? "partial" : "overdue") : "upcoming";
    return {
      month,
      start: cycle.start,
      end: cycle.end,
      dueDate: cycle.dueDate,
      rent: bill.rent,
      charges: bill.charges,
      chargeItems: bill.chargeItems,
      due: bill.due,
      paid,
      balance: Math.max(bill.due - paid, 0),
      status,
      pastDue,
    };
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
