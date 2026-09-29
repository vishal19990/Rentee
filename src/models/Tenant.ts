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
  },
  { timestamps: true },
);

export type TenantDoc = InferSchemaType<typeof tenantSchema>;

export const Tenant: Model<TenantDoc> = (mongoose.models.Tenant as Model<TenantDoc>) || mongoose.model<TenantDoc>("Tenant", tenantSchema);
