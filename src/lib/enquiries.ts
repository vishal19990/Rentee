/**
 * Property enquiries (leads): pure rules, validation, stats, duplicate matching and
 * notification specs. No database access (see lib/enquiry-data.ts for loaders).
 */
import { z } from "zod";
import { formatDate } from "./format";
import { LOCALE, parseMoney } from "./money";
import { notificationKey, type NotificationSpec } from "./notifications";
import { addDays, addMonths, localToday, monthOf } from "./rent";
import type { ActionState } from "./validation";
import { normalizePhone } from "./whatsapp";

/* ---------- vocabularies ---------- */

export const OPEN_STATUSES = ["new", "contacted", "visit_scheduled", "visited"] as const;
export const CLOSED_STATUSES = ["accepted", "rejected", "declined", "no_response", "property_let"] as const;
export const ENQUIRY_STATUSES = [...OPEN_STATUSES, ...CLOSED_STATUSES] as const;
export type OpenStatus = (typeof OPEN_STATUSES)[number];
export type ClosedStatus = (typeof CLOSED_STATUSES)[number];
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const ENQUIRY_SOURCES = [
  "walk_in",
  "phone_call",
  "whatsapp",
  "referral",
  "olx",
  "99acres",
  "magicbricks",
  "nobroker",
  "other",
] as const;
export type EnquirySource = (typeof ENQUIRY_SOURCES)[number];

export const REJECT_REASONS = ["low_budget", "references", "occupants", "pets", "timing", "other"] as const;
export const DECLINE_REASONS = ["found_elsewhere", "rent_too_high", "location", "property_condition", "other"] as const;

export const ACTIVITY_KINDS = ["note", "call", "whatsapp", "visit", "status_change", "follow_up_set", "converted"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
/** Kinds the admin can add by hand; the rest are logged automatically. */
export const MANUAL_ACTIVITY_KINDS = ["note", "call"] as const;

export const STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: "New",
  contacted: "Contacted",
  visit_scheduled: "Visit scheduled",
  visited: "Visited",
  accepted: "Accepted",
  rejected: "Rejected",
  declined: "Declined",
  no_response: "No response",
  property_let: "Property let",
};

export const SOURCE_LABEL: Record<EnquirySource, string> = {
  walk_in: "Walk-in",
  phone_call: "Phone call",
  whatsapp: "WhatsApp",
  referral: "Referral",
  olx: "OLX",
  "99acres": "99acres",
  magicbricks: "MagicBricks",
  nobroker: "NoBroker",
  other: "Other",
};

export const REASON_LABEL: Record<string, string> = {
  low_budget: "Budget too low",
  references: "References",
  occupants: "Occupants",
  pets: "Pets",
  timing: "Timing",
  found_elsewhere: "Found elsewhere",
  rent_too_high: "Rent too high",
  location: "Location",
  property_condition: "Property condition",
  other: "Other",
};

export function isOpenStatus(s: string): s is OpenStatus {
  return (OPEN_STATUSES as readonly string[]).includes(s);
}

export function isClosedStatus(s: string): s is ClosedStatus {
  return (CLOSED_STATUSES as readonly string[]).includes(s);
}

/* ---------- status groups (list filter) ---------- */

export const STATUS_GROUPS = ["open", "accepted", "rejected", "declined", "all"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export function parseStatusGroup(raw: string | undefined): StatusGroup {
  return (STATUS_GROUPS as readonly string[]).includes(raw ?? "") ? (raw as StatusGroup) : "open";
}

export function statusesInGroup(group: StatusGroup): readonly EnquiryStatus[] {
  switch (group) {
    case "open":
      return OPEN_STATUSES;
    case "accepted":
    case "rejected":
    case "declined":
      return [group];
    default:
      return ENQUIRY_STATUSES;
  }
}

/* ---------- form helpers ---------- */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .transform((v) => v || "");

const isValidIsoDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Optional YYYY-MM-DD: empty -> null. */
export const optionalDate = (label: string) =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const s = (raw ?? "").trim();
      if (!s) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !isValidIsoDate(s)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is not a valid date` });
        return z.NEVER;
      }
      return s;
    });

/** Optional local date-time "YYYY-MM-DDTHH:mm" (from <input type="datetime-local">): empty -> null. */
export const optionalDateTime = (label: string) =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const s = (raw ?? "").trim();
      if (!s) return null;
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(s);
      if (!m || !isValidIsoDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is not a valid date and time` });
        return z.NEVER;
      }
      return `${m[1]}T${m[2]}:${m[3]}`;
    });

/** Parses a local "YYYY-MM-DDTHH:mm" in the server's timezone (like localToday). */
export function dateTimeFromLocal(s: string): Date {
  const [d, t] = s.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return new Date(y, mo - 1, da, h, mi);
}

/** Formats a Date as a local "YYYY-MM-DDTHH:mm" for a datetime-local input. */
export function toLocalDateTimeInput(d: Date | null | undefined): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${localToday(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const optionalObjectId = (label: string) =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const s = (raw ?? "").trim();
      if (!s) return null;
      if (!/^[a-f\d]{24}$/i.test(s)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Select a ${label.toLowerCase()}` });
        return z.NEVER;
      }
      return s;
    });

const optionalInt = (label: string, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const s = (raw ?? "").trim();
      if (!s) return null;
      if (!/^\d+$/.test(s) || Number(s) < min || Number(s) > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a whole number from ${min} to ${max}` });
        return z.NEVER;
      }
      return Number(s);
    });

const optionalBudget = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    const s = (raw ?? "").trim();
    if (!s) return null;
    const v = s.startsWith("-") ? null : parseMoney(s);
    if (v === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Budget must be a valid amount" });
      return z.NEVER;
    }
    return v;
  });

/** Create / edit form. Follow-up date is set at creation only (later via the follow-up setter). */
export const enquirySchema = z.object({
  name: z
    .string({ required_error: "Name is required" })
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters"),
  phone: z
    .string({ required_error: "Phone is required" })
    .trim()
    .min(1, "Phone is required")
    .regex(/^\+?[\d\s\-()]{6,20}$/, "Enter a valid phone number"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => v || "")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email"),
  /** Empty = any property. */
  propertyId: optionalObjectId("Property"),
  source: z.enum(ENQUIRY_SOURCES, { errorMap: () => ({ message: "Select a source" }) }),
  /** Minor units. */
  budget: optionalBudget,
  desiredMoveIn: optionalDate("Desired move-in"),
  occupants: optionalInt("Occupants", 1, 50),
  occupation: optionalText(100),
  notes: optionalText(2000),
  followUpDate: optionalDate("Follow-up date"),
});
export type EnquiryInput = z.output<typeof enquirySchema>;

/** Closing an enquiry with an outcome. Rejected / declined need a reason (and text for "other"). */
export const outcomeSchema = z
  .object({
    outcome: z.enum(CLOSED_STATUSES, { errorMap: () => ({ message: "Select an outcome" }) }),
    reason: z.string().optional().transform((v) => (v ?? "").trim()),
    reasonText: optionalText(500),
  })
  .superRefine((v, ctx) => {
    const allowed: readonly string[] | null =
      v.outcome === "rejected" ? REJECT_REASONS : v.outcome === "declined" ? DECLINE_REASONS : null;
    if (!allowed) return;
    if (!allowed.includes(v.reason)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Select a reason" });
    } else if (v.reason === "other" && !v.reasonText) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reasonText"], message: "Describe the reason" });
    }
  })
  .transform((v) => {
    const needsReason = v.outcome === "rejected" || v.outcome === "declined";
    return {
      outcome: v.outcome,
      outcomeReason: needsReason ? v.reason : "",
      outcomeNote: v.reasonText,
    };
  });

export const activitySchema = z.object({
  kind: z.enum(MANUAL_ACTIVITY_KINDS, { errorMap: () => ({ message: "Select a type" }) }),
  text: z
    .string({ required_error: "Write something" })
    .trim()
    .min(1, "Write something")
    .max(2000, "Must be at most 2000 characters"),
});

export const followUpSchema = z.object({ followUpDate: optionalDate("Follow-up date") });
export const visitSchema = z.object({ visitAt: optionalDateTime("Visit") });

/** Same contract as validation.parseForm, kept local so this module has no extra coupling. */
export function parseEnquiryForm<S extends z.ZodTypeAny>(
  schema: S,
  values: Record<string, string>,
): { success: true; data: z.output<S> } | { success: false; state: ActionState } {
  const result = schema.safeParse(values);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    state: {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: result.error.flatten().fieldErrors as ActionState["fieldErrors"],
      values,
    },
  };
}

/* ---------- status transitions ---------- */

export type EnquiryState = {
  status: EnquiryStatus;
  outcomeReason: string;
  outcomeNote: string;
  outcomeAt: Date | null;
};

export type TransitionResult =
  | { ok: true; update: EnquiryState; activity: string }
  | { ok: false; message: string };

/** Open status -> another open status. */
export function moveToOpenStatus(current: EnquiryStatus, next: string): TransitionResult {
  if (!isOpenStatus(current)) return { ok: false, message: "Reopen the enquiry first." };
  if (!isOpenStatus(next)) return { ok: false, message: "Unknown status." };
  if (current === next) return { ok: false, message: `Already ${STATUS_LABEL[next].toLowerCase()}.` };
  return {
    ok: true,
    update: { status: next, outcomeReason: "", outcomeNote: "", outcomeAt: null },
    activity: `Status: ${STATUS_LABEL[current]} → ${STATUS_LABEL[next]}`,
  };
}

/** Open status -> closed outcome (already validated by outcomeSchema). */
export function closeWithOutcome(
  current: EnquiryStatus,
  outcome: { outcome: ClosedStatus; outcomeReason: string; outcomeNote: string },
  now: Date,
): TransitionResult {
  if (!isOpenStatus(current)) return { ok: false, message: "This enquiry is already closed. Reopen it first." };
  const reason = outcome.outcomeReason ? ` (${REASON_LABEL[outcome.outcomeReason] ?? outcome.outcomeReason})` : "";
  const note = outcome.outcomeNote ? `: ${outcome.outcomeNote}` : "";
  return {
    ok: true,
    update: { status: outcome.outcome, outcomeReason: outcome.outcomeReason, outcomeNote: outcome.outcomeNote, outcomeAt: now },
    activity: `Status: ${STATUS_LABEL[current]} → ${STATUS_LABEL[outcome.outcome]}${reason}${note}`,
  };
}

/** Closed -> back to "contacted", clearing the outcome. */
export function reopen(current: EnquiryStatus): TransitionResult {
  if (!isClosedStatus(current)) return { ok: false, message: "This enquiry is already open." };
  return {
    ok: true,
    update: { status: "contacted", outcomeReason: "", outcomeNote: "", outcomeAt: null },
    activity: `Reopened (was ${STATUS_LABEL[current]})`,
  };
}

/** A mistaken entry can be deleted only while it is new and has nothing logged beyond its creation. */
export function canDeleteEnquiry(status: string, activityCount: number): boolean {
  return status === "new" && activityCount <= 1;
}

/* ---------- duplicates ---------- */

/** Normalized phone used for matching ("98765 43210" and "+91 98765-43210" match). */
export function phoneKey(raw: string | null | undefined): string {
  return normalizePhone(raw) ?? (raw ?? "").replace(/\D/g, "");
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = phoneKey(a);
  return ka.length > 0 && ka === phoneKey(b);
}

/** Items (enquiries or tenants) whose phone matches `phone`, excluding `excludeId`. */
export function matchingByPhone<T extends { id: string; phone: string }>(phone: string, items: T[], excludeId?: string): T[] {
  return items.filter((i) => i.id !== excludeId && samePhone(phone, i.phone));
}

/* ---------- stats ---------- */

export const STAT_PERIODS = ["this_month", "last_month", "last_3_months", "this_year", "all"] as const;
export type StatPeriod = (typeof STAT_PERIODS)[number];
export const PERIOD_LABEL: Record<StatPeriod, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
  this_year: "Last 12 months",
  all: "All time",
};

export function parsePeriod(raw: string | undefined): StatPeriod {
  return (STAT_PERIODS as readonly string[]).includes(raw ?? "") ? (raw as StatPeriod) : "this_month";
}

/** Inclusive-from / exclusive-to ISO dates; null bounds = unbounded. */
export function periodRange(period: StatPeriod, today: string): { from: string | null; to: string | null } {
  const month = monthOf(today);
  switch (period) {
    case "this_month":
      return { from: `${month}-01`, to: `${addMonths(month, 1)}-01` };
    case "last_month":
      return { from: `${addMonths(month, -1)}-01`, to: `${month}-01` };
    case "last_3_months":
      return { from: `${addMonths(month, -2)}-01`, to: `${addMonths(month, 1)}-01` };
    case "this_year":
      return { from: `${addMonths(month, -11)}-01`, to: `${addMonths(month, 1)}-01` };
    default:
      return { from: null, to: null };
  }
}

function inRange(iso: string | null, r: { from: string | null; to: string | null }): boolean {
  if (!iso) return false;
  return (r.from === null || iso >= r.from) && (r.to === null || iso < r.to);
}

export type StatsRow = {
  status: string;
  source: string;
  /** Local calendar dates (YYYY-MM-DD). */
  createdDate: string;
  outcomeDate: string | null;
  visitDate: string | null;
};

export type SourceStats = { source: string; count: number; accepted: number; closed: number; rate: number | null };

export type EnquiryStats = {
  total: number;
  visits: number;
  accepted: number;
  rejected: number;
  declined: number;
  closed: number;
  /** accepted / closed; null when nothing closed. */
  conversionRate: number | null;
  bySource: SourceStats[];
};

/**
 * Stats for a period: `total` and per-source `count` = enquiries received in the period;
 * `visits` = visits dated in the period; outcomes (accepted / rejected / declined / closed)
 * = enquiries closed in the period. Conversion rate = accepted / closed.
 */
export function enquiryStats(rows: StatsRow[], range: { from: string | null; to: string | null }): EnquiryStats {
  const s: EnquiryStats = { total: 0, visits: 0, accepted: 0, rejected: 0, declined: 0, closed: 0, conversionRate: null, bySource: [] };
  const src = new Map<string, SourceStats>();
  const sourceRow = (source: string) => {
    let r = src.get(source);
    if (!r) src.set(source, (r = { source, count: 0, accepted: 0, closed: 0, rate: null }));
    return r;
  };
  for (const r of rows) {
    if (inRange(r.createdDate, range)) {
      s.total++;
      sourceRow(r.source).count++;
    }
    if (inRange(r.visitDate, range)) s.visits++;
    if (isClosedStatus(r.status) && inRange(r.outcomeDate, range)) {
      s.closed++;
      const sr = sourceRow(r.source);
      sr.closed++;
      if (r.status === "accepted") {
        s.accepted++;
        sr.accepted++;
      } else if (r.status === "rejected") s.rejected++;
      else if (r.status === "declined") s.declined++;
    }
  }
  s.conversionRate = conversionRate(s.accepted, s.closed);
  s.bySource = [...src.values()]
    .map((r) => ({ ...r, rate: conversionRate(r.accepted, r.closed) }))
    .sort((a, b) => b.count - a.count || b.closed - a.closed || a.source.localeCompare(b.source));
  return s;
}

export function conversionRate(accepted: number, closed: number): number | null {
  return closed > 0 ? accepted / closed : null;
}

/** 0.3 -> "30%", null -> "—". */
export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/* ---------- follow-ups, visits & notifications ---------- */

export function followUpDue(e: { status: string; followUpDate: string | null }, today: string): boolean {
  return isOpenStatus(e.status) && !!e.followUpDate && e.followUpDate <= today;
}

/** A visit is "upcoming" when it is today (local date) or within the next 24 hours. */
export function visitSoon(e: { status: string; visitAt: Date | null }, now: Date): boolean {
  if (!isOpenStatus(e.status) || e.status === "visited" || !e.visitAt) return false;
  if (localToday(e.visitAt) === localToday(now)) return true;
  const ms = e.visitAt.getTime() - now.getTime();
  return ms > 0 && ms <= 24 * 3600 * 1000;
}

export function formatTime(d: Date, locale: string = LOCALE): string {
  return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

export type EnquiryNotificationInput = {
  id: string;
  name: string;
  phone: string;
  propertyId: string | null;
  propertyName: string | null;
  status: string;
  followUpDate: string | null;
  visitAt: Date | null;
};

export function desiredEnquiryNotifications(enquiries: EnquiryNotificationInput[], now: Date): NotificationSpec[] {
  const today = localToday(now);
  const out: NotificationSpec[] = [];
  for (const e of enquiries) {
    const where = e.propertyName ?? "any property";
    const link = `/enquiries/${e.id}`;
    const refs = e.propertyId ? { propertyId: e.propertyId } : {};
    if (followUpDue(e, today)) {
      out.push({
        key: notificationKey("enquiry_follow_up", e.id, e.followUpDate!),
        type: "enquiry_follow_up",
        category: "reminder",
        title: `Follow up: ${e.name}`,
        body: `Enquiry for ${where} · follow-up ${e.followUpDate === today ? "due today" : `was due ${formatDate(e.followUpDate)}`} · ${e.phone}`,
        link,
        period: e.followUpDate!,
        ...refs,
      });
    }
    if (e.visitAt && visitSoon(e, now)) {
      const day = localToday(e.visitAt);
      const when = day === today ? "today" : day === addDays(today, 1) ? "tomorrow" : formatDate(day);
      out.push({
        key: notificationKey("enquiry_visit", e.id, e.visitAt.toISOString()),
        type: "enquiry_visit",
        category: "reminder",
        title: `Visit ${when} at ${formatTime(e.visitAt)}: ${e.name}`,
        body: `${e.name} (${e.phone}) is visiting ${where}.`,
        link,
        period: day,
        ...refs,
      });
    }
  }
  return out;
}

/* ---------- WhatsApp ---------- */

export function enquiryWhatsAppMessage(name: string, propertyName: string | null): string {
  return `Hi ${name}, this is regarding your enquiry for ${propertyName ?? "our property"}.`;
}
