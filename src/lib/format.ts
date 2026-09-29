import { LOCALE } from "./money";
import { toISODate } from "./rent";

/** Formats a stored calendar date (UTC midnight) without timezone drift. */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const iso = toISODate(d);
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Converts a form date string (YYYY-MM-DD) into the stored Date (UTC midnight). */
export function dateFromISO(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** "1 Jun 2026 – present" / "1 Jun 2026 – 31 Aug 2026" for a rental's stay. */
export function formatStay(moveInDate: string, moveOutDate: string | null): string {
  return `${formatDate(moveInDate)} – ${moveOutDate ? formatDate(moveOutDate) : "present"}`;
}

/** "just now", "5 minutes ago", "3 days ago"… (for "Last reminded"). */
export function relativeTime(from: Date | string, now: Date = new Date(), locale: string = LOCALE): string {
  const diffSec = Math.round((new Date(from).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return "just now";
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 86400],
    ["month", 30 * 86400],
    ["week", 7 * 86400],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs) return rtf.format(Math.round(diffSec / secs), unit);
  }
  return rtf.format(Math.round(diffSec / 60), "minute");
}

/** Date and time in the app locale, e.g. "29 Sept 2026, 3:45 pm". */
export function formatDateTime(d: Date | string): string {
  return new Date(d).toLocaleString(LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}
