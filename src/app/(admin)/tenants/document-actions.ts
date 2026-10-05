"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { deleteDocumentFile, saveDocumentFile } from "@/lib/document-store";
import { DOCUMENT_TYPE_LABELS, SIGNATURE_BYTES, documentFormSchema, validateDocumentFile } from "@/lib/documents";
import { parseForm, type ActionState } from "@/lib/validation";
import { Agreement } from "@/models/Agreement";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";
import { TenantDocument } from "@/models/TenantDocument";

const TENANT_NOT_FOUND: ActionState = { ok: false, message: "Tenant not found." };

function revalidateDocumentViews(tenantId: string) {
  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath("/rentals", "layout"); // agreement cards list the tenant's documents
}

/** Uploads a tenant document (PDF/JPG/PNG/WebP ≤ 10 MB, checked by file signature) to GridFS. */
export async function uploadTenantDocument(tenantId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(tenantId);
  if (!_id) return TENANT_NOT_FOUND;

  const parsed = parseForm(documentFormSchema, fd);
  const file = fd.get("file");
  const f = file instanceof File ? file : null;
  let check = validateDocumentFile(f);
  let bytes: Buffer | null = null;
  if (!check.error && f) {
    bytes = Buffer.from(await f.arrayBuffer());
    check = validateDocumentFile(f, bytes.subarray(0, SIGNATURE_BYTES));
  }
  if (!parsed.success || check.error) {
    const state: ActionState = parsed.success
      ? { ok: false, message: "Please fix the highlighted fields.", values: parsed.values }
      : parsed.state;
    return { ...state, fieldErrors: { ...state.fieldErrors, ...(check.error ? { file: [check.error] } : {}) } };
  }
  const { type, title, rentalId } = parsed.data;
  const contentType = check.contentType!;

  await connectDB();
  if (!(await Tenant.exists({ _id }))) return TENANT_NOT_FOUND;
  if (rentalId && !(await Rental.exists({ _id: rentalId, tenant: _id }))) {
    return { ok: false, fieldErrors: { rentalId: ["Select one of this tenant's rentals"] }, values: parsed.values };
  }

  const fileId = await saveDocumentFile(bytes!, contentType);
  try {
    await TenantDocument.create({
      tenant: _id,
      rental: rentalId,
      type,
      title: title || DOCUMENT_TYPE_LABELS[type],
      file: fileId,
      contentType,
      size: bytes!.length,
      uploadedAt: new Date(),
    });
  } catch (err) {
    await deleteDocumentFile(fileId); // don't leave an orphaned file behind
    throw err;
  }
  revalidateDocumentViews(tenantId);
  return { ok: true, message: "Document uploaded." };
}

/** Deletes a document record and its GridFS file; agreements that linked it are unlinked. */
export async function deleteTenantDocument(tenantId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(tenantId);
  const docId = asObjectId(String(fd.get("documentId") ?? ""));
  if (!_id || !docId) return { ok: false, message: "Document not found." };
  await connectDB();
  const doc = await TenantDocument.findOneAndDelete({ _id: docId, tenant: _id }).lean();
  if (!doc) return { ok: false, message: "Document not found." };
  await Agreement.updateMany({ document: docId }, { $set: { document: null } });
  await deleteDocumentFile(doc.file);
  revalidateDocumentViews(tenantId);
  return { ok: true, message: "Document deleted." };
}
