/**
 * WhatsApp rent reminders via click-to-chat links (https://wa.me/<digits>?text=<message>).
 * Pure helpers: phone normalization, choosing what to remind about, message templating, URL.
 * Nothing is sent automatically — the admin opens the link and presses send in WhatsApp.
 */
import { formatDate } from "./format";
import { formatMoneyShort } from "./money";
import { addMonths, dueForMonth, formatMonth, monthOf, type ChargeLike, type RentChangeLike, type RentMonth } from "./rent";

export const DEFAULT_COUNTRY_CODE = (process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE || "91").replace(/\D/g, "") || "91";

export const REMINDER_PLACEHOLDERS = ["tenant", "property", "amount", "months", "dueDate"] as const;
export type ReminderPlaceholder = (typeof REMINDER_PLACEHOLDERS)[number];
export type ReminderVars = Record<ReminderPlaceholder, string>;

export const DEFAULT_REMINDER_TEMPLATE =
  "Hi {tenant}, this is a friendly reminder that rent of {amount} for {property} is pending for {months} (due {dueDate}). " +
  "Please pay at your earliest convenience. Thank you!";

export const NO_PHONE_TOOLTIP = "Add a phone number";

const MIN_DIGITS = 8;
const MAX_DIGITS = 15; // E.164

/**
 * Normalizes a phone number into the digits wa.me expects (country code + number, no "+").
 * - Non-digits are stripped.
 * - A number written with a leading "+" or "00" is international and used as-is.
 * - A 10-digit number gets the default country code (NEXT_PUBLIC_DEFAULT_COUNTRY_CODE, default 91).
 * - An 11-digit number starting with a trunk "0" (e.g. "098765 43210") drops the 0 and gets the default code.
 * - Anything with fewer than 8 digits (or more than 15) is invalid -> null.
 */
export function normalizePhone(raw: string | null | undefined, defaultCountryCode: string = DEFAULT_COUNTRY_CODE): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const international = s.startsWith("+") || s.startsWith("00");
  let digits = s.replace(/\D/g, "");
  if (international) {
    if (s.startsWith("00")) digits = digits.slice(2);
  } else if (digits.length === 10) {
    digits = defaultCountryCode + digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = defaultCountryCode + digits.slice(1);
  }
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  return digits;
}

/** Replaces {placeholder} tokens; unknown tokens are left untouched. */
export function renderTemplate(template: string, vars: Partial<ReminderVars>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key as ReminderPlaceholder]) : whole,
  );
}

/** Placeholders used in a template that are not supported (for validation). */
export function unknownPlaceholders(template: string): string[] {
  const known = new Set<string>(REMINDER_PLACEHOLDERS);
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !known.has(k)))];
}

export function whatsappUrl(phoneDigits: string, message: string): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
}

export type ReminderKind = "overdue" | "due_soon";

export type ReminderDue = {
  kind: ReminderKind;
  /** Unpaid months included in the reminder, oldest first. */
  months: { month: string; dueDate: string; balance: number }[];
  /** Outstanding total across those months (minor units). */
  amount: number;
  /** Earliest unpaid due date (YYYY-MM-DD). */
  dueDate: string;
};

export type ReminderRental = {
  status: "active" | "moved_out";
  /** Original rent; with rentChanges/charges, next month's due is computed per month. */
  monthlyRent: number;
  rentChanges?: RentChangeLike[];
  charges?: ChargeLike[];
  dueDay: number;
  moveOutDate: string | null;
  schedule: RentMonth[];
};

/**
 * What a reminder should cover:
 * - "overdue": every past-due month with a balance (the outstanding past-due total);
 * - otherwise, for an active rental, "due_soon": the next upcoming unpaid month.
 * Returns null when there is nothing to remind about.
 */
export function reminderDue(rental: ReminderRental, today: string): ReminderDue | null {
  const overdue = rental.schedule.filter((m) => m.pastDue && m.balance > 0);
  if (overdue.length > 0) {
    return {
      kind: "overdue",
      months: overdue.map((m) => ({ month: m.month, dueDate: m.dueDate, balance: m.balance })),
      amount: overdue.reduce((s, m) => s + m.balance, 0),
      dueDate: overdue[0].dueDate,
    };
  }
  if (rental.status !== "active" || rental.schedule.length === 0) return null;

  const upcoming = rental.schedule.find((m) => !m.pastDue && m.balance > 0);
  if (upcoming) {
    return {
      kind: "due_soon",
      months: [{ month: upcoming.month, dueDate: upcoming.dueDate, balance: upcoming.balance }],
      amount: upcoming.balance,
      dueDate: upcoming.dueDate,
    };
  }

  // Everything billed so far is paid: remind about the first month after the schedule
  // (next month), unless the tenant is moving out before then.
  const lastListed = rental.schedule[rental.schedule.length - 1].month;
  const next = addMonths(lastListed > monthOf(today) ? lastListed : monthOf(today), 1);
  if (rental.moveOutDate && next > monthOf(rental.moveOutDate)) return null;
  const dueDate = `${next}-${String(rental.dueDay).padStart(2, "0")}`;
  const amount = dueForMonth(rental, next);
  return { kind: "due_soon", months: [{ month: next, dueDate, balance: amount }], amount, dueDate };
}

export function reminderVars(due: ReminderDue, tenant: string, property: string): ReminderVars {
  return {
    tenant,
    property,
    amount: formatMoneyShort(due.amount),
    months: due.months.map((m) => formatMonth(m.month)).join(", "),
    dueDate: formatDate(due.dueDate),
  };
}

export type BuiltReminder = {
  kind: ReminderKind;
  message: string;
  /** Normalized phone digits, or null if the tenant has no valid phone. */
  phone: string | null;
  /** wa.me link, or null when the phone is missing/invalid (button disabled). */
  url: string | null;
};

/** Everything the "Remind on WhatsApp" button needs; null when there is nothing to remind about. */
export function buildReminder(input: {
  rental: ReminderRental;
  tenantName: string;
  tenantPhone: string | null | undefined;
  propertyName: string;
  template: string;
  today: string;
}): BuiltReminder | null {
  const due = reminderDue(input.rental, input.today);
  if (!due) return null;
  const message = renderTemplate(input.template, reminderVars(due, input.tenantName, input.propertyName));
  const phone = normalizePhone(input.tenantPhone);
  return { kind: due.kind, message, phone, url: phone ? whatsappUrl(phone, message) : null };
}
