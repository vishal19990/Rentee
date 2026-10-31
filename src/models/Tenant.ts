import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: "", lowercase: true, trim: true },
    idNumber: { type: String, default: "", trim: true },
    notes: { type: String, default: "" },
    archived: { type: Boolean, default: false, index: true },
    /** Profile photo: GridFS file id in the "avatars" bucket (square JPEG, resized in the browser). */
    photo: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

export type TenantDoc = InferSchemaType<typeof tenantSchema>;

// This schema gained fields over time; in dev, recompile on hot reload so a running server
// does not keep a stale cached model that silently drops the new fields.
if (process.env.NODE_ENV !== "production" && mongoose.models.Tenant) mongoose.deleteModel("Tenant");

export const Tenant: Model<TenantDoc> = (mongoose.models.Tenant as Model<TenantDoc>) || mongoose.model<TenantDoc>("Tenant", tenantSchema);
