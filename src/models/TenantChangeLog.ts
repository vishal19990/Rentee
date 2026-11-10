import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { CHANGE_FIELDS } from "@/lib/portal-scope";

const { Schema } = mongoose;

/**
 * A change a tenant made to their own details from the portal (phone, email, occupants,
 * password). Shown to admins on the tenant page ("Recent changes by tenant"). Append-only.
 */
const tenantChangeLogSchema = new Schema(
  {
    tenant: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    field: { type: String, enum: CHANGE_FIELDS, required: true },
    from: { type: String, default: "" },
    to: { type: String, default: "" },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false, collection: "rentee_tenant_change_logs" },
);

tenantChangeLogSchema.index({ tenant: 1, at: -1 });

export type TenantChangeLogDoc = InferSchemaType<typeof tenantChangeLogSchema>;

export const TenantChangeLog: Model<TenantChangeLogDoc> =
  (mongoose.models.TenantChangeLog as Model<TenantChangeLogDoc>) ||
  mongoose.model<TenantChangeLogDoc>("TenantChangeLog", tenantChangeLogSchema);
