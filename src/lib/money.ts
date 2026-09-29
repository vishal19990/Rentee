/** Money is stored as integer minor units (e.g. paise for INR) and formatted app-wide. */

export const CURRENCY = (process.env.NEXT_PUBLIC_CURRENCY || "INR").toUpperCase();
export const LOCALE = process.env.NEXT_PUBLIC_LOCALE || "en-IN";

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, locale: string, compact = false): Intl.NumberFormat {
  const key = `${currency}|${locale}|${compact}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
    });
    formatterCache.set(key, f);
  }
  return f;
}

/** Number of minor-unit digits for a currency (INR/USD: 2, JPY: 0). */
export function minorDigits(currency: string = CURRENCY): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

export function formatMoney(minor: number, currency: string = CURRENCY, locale: string = LOCALE): string {
  const major = minor / 10 ** minorDigits(currency);
  return formatter(currency, locale).format(major);
}

export function formatMoneyCompact(minor: number, currency: string = CURRENCY, locale: string = LOCALE): string {
  const major = minor / 10 ** minorDigits(currency);
  return formatter(currency, locale, true).format(major);
}

/**
 * Parses a user-entered decimal string ("12,500.50") into integer minor units.
 * Returns null if the input is not a valid non-negative amount with at most the
 * currency's number of decimals.
 */
export function parseMoney(input: string, currency: string = CURRENCY): number | null {
  const digits = minorDigits(currency);
  const s = input.trim().replace(/[,\s_]/g, "");
  if (!s) return null;
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  if ((m[2] ?? "").length > digits) return null;
  const whole = m[1];
  const frac = (m[2] ?? "").padEnd(digits, "0");
  const value = Number(whole) * 10 ** digits + (frac ? Number(frac) : 0);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

/** Converts minor units into a plain decimal string suitable for an input's value. */
export function toMajorString(minor: number, currency: string = CURRENCY): string {
  const digits = minorDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

/** The currency's display symbol in the app locale (e.g. "₹", "$"). */
export function currencySymbol(currency: string = CURRENCY, locale: string = LOCALE): string {
  return formatter(currency, locale).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
}

/** Like formatMoney, but drops a zero fraction ("₹15,000" rather than "₹15,000.00"). For messages. */
export function formatMoneyShort(minor: number, currency: string = CURRENCY, locale: string = LOCALE): string {
  const digits = minorDigits(currency);
  if (minor % 10 ** digits !== 0) return formatMoney(minor, currency, locale);
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(
    minor / 10 ** digits,
  );
}
