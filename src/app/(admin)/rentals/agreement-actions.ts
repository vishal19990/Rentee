"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { loadAgreements } from "@/lib/agreement-data";
import { agreementDocumentSchema, agreementFormSchema, latestAgreement, renewalStart } from "@/lib/agreements";
import { asObjectId, syncRentalStatuses } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { dateFromISO, formatDate } from "@/lib/format";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import { parseForm, type ActionState } from "@/lib/validation";
import { Agreement } from "@/models/Agreement";
import { Rental } from "@/models/Rental";
import { TenantDocument } from "@/models/TenantDocument";

const NOT_FOUND: ActionState = { ok: false, message: "Rental not found." };

function revalidateAgreementViews(rentalId: string) {
  revalidatePath(`/rentals/${rentalId}`);
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
}

/** A linked document must belong to the rental's tenant. */
async function documentBelongs(documentId: string | null, tenantId: unknown): Promise<boolean> {
  return !documentId || !!(await TenantDocument.exists({ _id: documentId, tenant: tenantId }));
}

/**
 * Adds the first agreement, or renews: when the rental already has agreements, the new one
 * always starts the day after the latest one ends (the submitted start date is ignored).
 * An empty end date defaults to start + 11 months − 1 day.
 */
export async function addAgreement(rentalId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(rentalId);
  if (!_id) return NOT_FOUND;
  await connectDB();
  await syncRentalStatuses();
  const rental = await Rental.findById(_id).select("tenant status").lean();
  if (!rental) return NOT_FOUND;
  if (rental.status !== "active") return { ok: false, message: "This tenant has moved out; agreements can't be added." };

  const latest = latestAgreement((await loadAgreements([rentalId])).get(rentalId) ?? []);
  const notBefore = latest ? renewalStart(latest) : null;
  if (notBefore) fd.set("startDate", notBefore);

  const parsed = parseForm(agreementFormSchema(notBefore), fd);
  if (!parsed.success) return parsed.state;
  const { startDate, endDate, documentId } = parsed.data;
  if (!(await documentBelongs(documentId, rental.tenant))) {
    return { ok: false, fieldErrors: { documentId: ["Select one of this tenant's documents"] }, values: parsed.values };
  }

  try {
    await Agreement.create({ rental: _id, startDate: dateFromISO(startDate), endDate: dateFromISO(endDate), document: documentId });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return { ok: false, message: "An agreement starting on that date already exists. Refresh the page." };
    }
    throw err;
  }
  await syncNotificationsSafe({ scope: { rentalIds: [rentalId] } });
  revalidateAgreementViews(rentalId);
  return {
    ok: true,
    message: `${latest ? "Agreement renewed" : "Agreement added"}: ${formatDate(startDate)} – ${formatDate(endDate)}.`,
  };
}

/** Links (or unlinks) a tenant document as the signed copy of an agreement. */
export async function setAgreementDocument(rentalId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(rentalId);
  if (!_id) return NOT_FOUND;
  const parsed = parseForm(agreementDocumentSchema, fd);
  if (!parsed.success) return parsed.state;
  const { agreementId, documentId } = parsed.data;
  await connectDB();
  const rental = await Rental.findById(_id).select("tenant").lean();
  if (!rental) return NOT_FOUND;
  if (!(await documentBelongs(documentId, rental.tenant))) {
    return { ok: false, fieldErrors: { documentId: ["Select one of this tenant's documents"] }, values: parsed.values };
  }
  const res = await Agreement.updateOne({ _id: agreementId, rental: _id }, { $set: { document: documentId } });
  if (res.matchedCount === 0) return { ok: false, message: "Agreement not found." };
  revalidateAgreementViews(rentalId);
  return { ok: true, message: documentId ? "Document linked." : "Document unlinked." };
}

/** Deletes the latest agreement only (to correct a mistake); older ones stay as history. */
export async function deleteAgreement(rentalId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(rentalId);
  const agreementId = String(fd.get("agreementId") ?? "");
  if (!_id) return NOT_FOUND;
  await connectDB();
  const latest = latestAgreement((await loadAgreements([rentalId])).get(rentalId) ?? []);
  if (!latest || latest.id !== agreementId) return { ok: false, message: "Only the latest agreement can be deleted." };
  await Agreement.deleteOne({ _id: agreementId, rental: _id });
  await syncNotificationsSafe({ scope: { rentalIds: [rentalId] } });
  revalidateAgreementViews(rentalId);
  return { ok: true, message: "Agreement deleted." };
}
