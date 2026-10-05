import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { DOCUMENT_TYPES } from "@/lib/documents";

const { Schema } = mongoose;

/**
 * A tenant document (ID proof, agreement scan…). The bytes live in GridFS bucket "documents"
 * (`file` is the GridFS id) and are served only to signed-in admins via /api/documents/[id].
 */
const tenantDocumentSchema = new Schema(
  {
    tenant: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    rental: { type: Schema.Types.ObjectId, ref: "Rental", default: null, index: true },
    type: { type: String, enum: DOCUMENT_TYPES, required: true },
    title: { type: String, required: true, trim: true },
    file: { type: Schema.Types.ObjectId, required: true },
    /** Detected from the file signature at upload. */
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

export type TenantDocumentDoc = InferSchemaType<typeof tenantDocumentSchema>;

export const TenantDocument: Model<TenantDocumentDoc> =
  (mongoose.models.TenantDocument as Model<TenantDocumentDoc>) ||
  mongoose.model<TenantDocumentDoc>("TenantDocument", tenantDocumentSchema);
