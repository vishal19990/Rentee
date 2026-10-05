import "server-only";
import { connectDB } from "./db";
import { toId } from "./data";
import {
  DEFAULT_AGREEMENT_EXPIRY_DAYS,
  agreementStatus,
  desiredAgreementNotifications,
  latestAgreement,
  type AgreementRentalInput,
  type AgreementStatus,
} from "./agreements";
import type { NotificationSpec } from "./notifications";
import { toISODate } from "./rent";
import { APP_SETTINGS_KEY, AppSettings } from "@/models/AppSettings";
import { Agreement } from "@/models/Agreement";

export type AgreementRow = {
  id: string;
  rentalId: string;
  startDate: string;
  endDate: string;
  documentId: string | null;
};

export async function getAgreementExpiryDays(): Promise<number> {
  await connectDB();
  const doc = await AppSettings.findOne({ key: APP_SETTINGS_KEY }).select("agreementExpiryDays").lean();
  return doc?.agreementExpiryDays ?? DEFAULT_AGREEMENT_EXPIRY_DAYS;
}

/** Agreements grouped by rental id, newest start first. */
export async function loadAgreements(rentalIds: string[]): Promise<Map<string, AgreementRow[]>> {
  const out = new Map<string, AgreementRow[]>();
  if (rentalIds.length === 0) return out;
  await connectDB();
  const rows = await Agreement.find({ rental: { $in: rentalIds } }).sort({ startDate: -1, endDate: -1 }).lean();
  for (const a of rows) {
    const rentalId = toId(a.rental);
    if (!out.has(rentalId)) out.set(rentalId, []);
    out.get(rentalId)!.push({
      id: toId(a._id),
      rentalId,
      startDate: toISODate(a.startDate),
      endDate: toISODate(a.endDate),
      documentId: a.document ? toId(a.document) : null,
    });
  }
  return out;
}

/** Agreement notifications for the given (already loaded) rentals; used by the notification sync. */
export async function agreementNotificationSpecs(rentals: AgreementRentalInput[], today: string): Promise<NotificationSpec[]> {
  if (rentals.length === 0) return [];
  const [agreements, thresholdDays] = await Promise.all([loadAgreements(rentals.map((r) => r.id)), getAgreementExpiryDays()]);
  return desiredAgreementNotifications({ rentals, agreements, thresholdDays, today });
}

export type AgreementAttention<R> = { rental: R; agreement: AgreementRow; status: Exclude<AgreementStatus, "active"> };

/** Active rentals whose latest agreement is expiring or expired (soonest end date first). */
export async function agreementsNeedingAttention<R extends { id: string; status: string }>(
  rentals: R[],
  today: string,
): Promise<{ items: AgreementAttention<R>[]; thresholdDays: number }> {
  const active = rentals.filter((r) => r.status === "active");
  const [agreements, thresholdDays] = await Promise.all([loadAgreements(active.map((r) => r.id)), getAgreementExpiryDays()]);
  const items: AgreementAttention<R>[] = [];
  for (const rental of active) {
    const agreement = latestAgreement(agreements.get(rental.id) ?? []);
    if (!agreement) continue;
    const status = agreementStatus(agreement, today, thresholdDays);
    if (status !== "active") items.push({ rental, agreement, status });
  }
  items.sort((a, b) => a.agreement.endDate.localeCompare(b.agreement.endDate));
  return { items, thresholdDays };
}
