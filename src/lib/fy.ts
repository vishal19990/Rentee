/**
 * Indian financial year (1 April – 31 March), labelled "2026-27".
 * Pure helpers on ISO date strings (YYYY-MM-DD) / month keys (YYYY-MM).
 */
import { addMonths, monthRange } from "./rent";

const FY_RE = /^(\d{4})-(\d{2})$/;

/** "2026-27" for start year 2026. */
export function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** FY label for a calendar date: 31 Mar 2027 -> "2026-27", 1 Apr 2027 -> "2027-28". */
export function fyOf(isoDate: string): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  return fyLabel(m >= 4 ? y : y - 1);
}

/** Start year of a FY label, or null if the label is malformed ("2026-28", "abc"). */
export function fyStartYear(fy: string): number | null {
  const m = FY_RE.exec(fy);
  if (!m) return null;
  const y = Number(m[1]);
  return fyLabel(y) === fy ? y : null;
}

export function isFy(fy: string): boolean {
  return fyStartYear(fy) !== null;
}

/** First day, last day, and the day after the last day (half-open, for queries) of a FY. */
export function fyRange(fy: string): { start: string; end: string; endExclusive: string } {
  const y = fyStartYear(fy);
  if (y === null) throw new Error(`Invalid financial year: ${fy}`);
  return { start: `${y}-04-01`, end: `${y + 1}-03-31`, endExclusive: `${y + 1}-04-01` };
}

/** The 12 months (YYYY-MM) of a FY, April first. */
export function fyMonths(fy: string): string[] {
  const first = fyRange(fy).start.slice(0, 7);
  return monthRange(first, addMonths(first, 11));
}

/** FY labels from `fromDate`'s FY through `toDate`'s FY, newest first. */
export function fyList(fromDate: string, toDate: string): string[] {
  const a = fyStartYear(fyOf(fromDate))!;
  const b = fyStartYear(fyOf(toDate))!;
  const out: string[] = [];
  for (let y = Math.max(a, b); y >= Math.min(a, b); y--) out.push(fyLabel(y));
  return out;
}
