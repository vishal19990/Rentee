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
  },
  { timestamps: true },
);

export type MaintenanceDoc = InferSchemaType<typeof maintenanceSchema>;

export const Maintenance: Model<MaintenanceDoc> =
  (mongoose.models.Maintenance as Model<MaintenanceDoc>) || mongoose.model<MaintenanceDoc>("Maintenance", maintenanceSchema);
