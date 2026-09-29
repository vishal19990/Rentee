import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { NOTIFICATION_TYPES } from "@/lib/notifications";

const { Schema } = mongoose;

/**
 * An in-app admin notification. Read state is shared across admins (single-landlord use).
 * `key` (type + subject + period) is unique so the sync is idempotent.
 */
const notificationSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    category: { type: String, enum: ["alert", "reminder"], required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: { type: String, required: true },
    rental: { type: Schema.Types.ObjectId, ref: "Rental", default: null },
    property: { type: Schema.Types.ObjectId, ref: "Property", default: null },
    tenant: { type: Schema.Types.ObjectId, ref: "Tenant", default: null },
    maintenance: { type: Schema.Types.ObjectId, ref: "Maintenance", default: null },
    period: { type: String, default: null },
    /** When the condition (last) became true: set on create and on reopen. Drives ordering + desktop alerts. */
    activeSince: { type: Date, required: true, default: () => new Date(), index: true },
    readAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ resolvedAt: 1, readAt: 1 });

export type NotificationDoc = InferSchemaType<typeof notificationSchema>;

export const Notification: Model<NotificationDoc> =
  (mongoose.models.Notification as Model<NotificationDoc>) ||
  mongoose.model<NotificationDoc>("Notification", notificationSchema);
