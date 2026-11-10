import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { MAINTENANCE_PRIORITIES, MAINTENANCE_STATUSES } from "@/lib/validation";

const { Schema } = mongoose;

const maintenanceSchema = new Schema(
  {
    property: { type: Schema.Types.ObjectId, ref: "Property", required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    priority: { type: String, enum: MAINTENANCE_PRIORITIES, required: true, default: "medium" },
    status: { type: String, enum: MAINTENANCE_STATUSES, required: true, default: "open", index: true },
    /** Integer minor units. */
    cost: { type: Number, min: 0, default: 0 },
    /** "tenant" when raised from the tenant portal (then `tenant` is set). */
    createdBy: { type: String, enum: ["admin", "tenant"], default: "admin" },
    tenant: { type: Schema.Types.ObjectId, ref: "Tenant", default: null, index: true },
    /** Optional photo from the tenant: GridFS id in the encrypted "maintenance" bucket. */
    photo: { type: Schema.Types.ObjectId, default: null },
    photoType: { type: String, default: null },
  },
  { timestamps: true },
);

export type MaintenanceDoc = InferSchemaType<typeof maintenanceSchema>;

// Gained tenant-portal fields; in dev, recompile on hot reload so a stale cached model doesn't drop them.
if (process.env.NODE_ENV !== "production" && mongoose.models.Maintenance) mongoose.deleteModel("Maintenance");

export const Maintenance: Model<MaintenanceDoc> =
  (mongoose.models.Maintenance as Model<MaintenanceDoc>) || mongoose.model<MaintenanceDoc>("Maintenance", maintenanceSchema);
