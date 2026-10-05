/**
 * Rental agreements (F8): pure rules, no database access.
 *
 * Indian residential agreements usually run 11 months, so the default end date is
 * start + 11 months − 1 day (1 Jun 2026 → 30 Apr 2027). Status is derived, never stored:
 *   expired  — endDate is before today
 *   expiring — endDate is today or within `thresholdDays`
 *   active   — otherwise
 * Notifications only look at a rental's latest agreement (by start date): renewing creates a
 * newer one, which resolves the expiring/expired notification of the old one.
 */
import { z } from "zod";
import { formatDate } from "./format";
import { daysBetween, notificationKey, type NotificationSpec } from "./notifications";
import { addDays } from "./rent";

export const DEFAULT_AGREEMENT_EXPIRY_DAYS = 30;
export const AGREEMENT_MONTHS = 11;

export type AgreementStatus = "active" | "expiring" | "expired";

export type AgreementLike = { id: string; startDate: string; endDate: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** Adds calendar months to an ISO date, clamping the day to the target month's length (31 Mar + 11 → 28/29 Feb). */
export function addMonthsToDate(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ty = Math.floor(idx / 12);
  const tm = (idx % 12) + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${pad(tm)}-${pad(Math.min(d, lastDay))}`;
}

/** Default end date: start + 11 months − 1 day. */
export function defaultAgreementEnd(startDate: string, months = AGREEMENT_MONTHS): string {
  return addDays(addMonthsToDate(startDate, months), -1);
}

/** A renewal starts the day after the previous agreement ends. */
export function renewalStart(previous: Pick<AgreementLike, "endDate">): string {
  return addDays(previous.endDate, 1);
}

export function agreementStatus(a: Pick<AgreementLike, "endDate">, today: string, thresholdDays = DEFAULT_AGREEMENT_EXPIRY_DAYS): AgreementStatus {
  const days = daysBetween(today, a.endDate);
  if (days < 0) return "expired";
  if (days <= thresholdDays) return "expiring";
  return "active";
}

/** Latest agreement by start date (then end date), or null. */
export function latestAgreement<T extends AgreementLike>(list: T[]): T | null {
  let best: T | null = null;
  for (const a of list) {
    if (!best || a.startDate > best.startDate || (a.startDate === best.startDate && a.endDate > best.endDate)) best = a;
  }
  return best;
}

export type AgreementRentalInput = {
  id: string;
  propertyId: string;
  propertyName: string;
  tenantId: string;
  tenantName: string;
  status: "active" | "moved_out";
  moveOutDate: string | null;
};

function inDays(n: number): string {
  return n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
}

/**
 * `agreement_expiring` (reminder) when the latest agreement ends within `thresholdDays`, and
 * `agreement_expired` (alert) once it has ended with no newer agreement. Only for active rentals;
 * no expiring reminder when the tenant is already scheduled to move out by the end date.
 */
export function desiredAgreementNotifications(input: {
  rentals: AgreementRentalInput[];
  /** Agreements per rental id (any order). */
  agreements: Map<string, AgreementLike[]>;
  thresholdDays: number;
  today: string;
}): NotificationSpec[] {
  const out: NotificationSpec[] = [];
  for (const r of input.rentals) {
    if (r.status !== "active") continue;
    const latest = latestAgreement(input.agreements.get(r.id) ?? []);
    if (!latest) continue;
    const refs = { rentalId: r.id, propertyId: r.propertyId, tenantId: r.tenantId, link: `/rentals/${r.id}`, period: latest.endDate };
    const status = agreementStatus(latest, input.today, input.thresholdDays);
    if (status === "expiring") {
      if (r.moveOutDate && r.moveOutDate <= latest.endDate) continue;
      const days = daysBetween(input.today, latest.endDate);
      out.push({
        key: notificationKey("agreement_expiring", latest.id),
        type: "agreement_expiring",
        category: "reminder",
        title: `Agreement ends ${inDays(days)}: ${r.propertyName}`,
        body: `The rental agreement with ${r.tenantName} ends on ${formatDate(latest.endDate)}. Renew it from the rental page.`,
        ...refs,
      });
    } else if (status === "expired") {
      out.push({
        key: notificationKey("agreement_expired", latest.id),
        type: "agreement_expired",
        category: "alert",
        title: `Agreement expired: ${r.propertyName}`,
        body: `The rental agreement with ${r.tenantName} ended on ${formatDate(latest.endDate)} and hasn't been renewed.`,
        ...refs,
      });
    }
  }
  return out;
}

/* ---------- form validation ---------- */

const isoDate = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is required`)
    .refine((s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, `${label} is not a valid date`);

const optionalDocumentId = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim())
  .pipe(z.union([z.literal("").transform(() => null), z.string().regex(/^[a-f\d]{24}$/i, "Select a document")]));

/**
 * New agreement / renewal form. Empty end date = default (start + 11 months − 1 day).
 * `notBefore`: earliest allowed start (the day after the latest existing agreement ends).
 */
export const agreementFormSchema = (notBefore: string | null) =>
  z
    .object({
      startDate: isoDate("Start date"),
      endDate: z
        .string()
        .optional()
        .transform((v) => (v ?? "").trim())
        .pipe(z.union([z.literal("").transform(() => null), isoDate("End date")])),
      documentId: optionalDocumentId,
    })
    .transform((v) => ({ ...v, endDate: v.endDate ?? defaultAgreementEnd(v.startDate) }))
    .superRefine((v, ctx) => {
      if (notBefore && v.startDate < notBefore) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startDate"],
          message: `Must start on or after ${formatDate(notBefore)}, the day after the current agreement ends`,
        });
      }
      if (v.endDate < v.startDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "End date can't be before the start date" });
      }
    });

export const agreementDocumentSchema = z.object({ agreementId: z.string().regex(/^[a-f\d]{24}$/i, "Agreement not found"), documentId: optionalDocumentId });

export const agreementSettingsSchema = z.object({
  agreementExpiryDays: z
    .string({ required_error: "Days before an agreement ends is required" })
    .trim()
    .regex(/^\d+$/, "Days before an agreement ends must be a whole number")
    .transform(Number)
    .pipe(z.number().int().min(1, "Must be at least 1").max(120, "Must be at most 120")),
});
