import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

/** Singleton document (key "app") for admin-editable app settings. */
export const APP_SETTINGS_KEY = "app";

const appSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: APP_SETTINGS_KEY },
    /** WhatsApp reminder message template; null/empty = use the built-in default. */
    reminderTemplate: { type: String, default: null },
    /** Notification thresholds (days): N rent due soon, M moving out soon, K maintenance pending. */
    dueSoonDays: { type: Number, default: 3, min: 0, max: 30 },
    moveOutDays: { type: Number, default: 7, min: 1, max: 60 },
    maintenanceDays: { type: Number, default: 7, min: 1, max: 90 },
    /** Agreement renewal reminder: days before an agreement's end date (F8). */
    agreementExpiryDays: { type: Number, default: 30, min: 1, max: 120 },
    /** Whether browser desktop notifications are allowed (each browser still needs permission). */
    desktopNotifications: { type: Boolean, default: true },
    /** Default electricity rate per unit (minor units) when a property has none; null = not set. */
    defaultElectricityRate: { type: Number, min: 0, default: null },
    /** Last notification sync (throttle: at most once per 5 minutes). */
    notificationsSyncedAt: { type: Date, default: null },
    /** Landlord details printed on rent receipts (F1); empty = not shown. */
    landlordName: { type: String, default: "" },
    landlordAddress: { type: String, default: "" },
    landlordPhone: { type: String, default: "" },
    landlordPan: { type: String, default: "" },
    /** UPI pay links (F10): VPA and payee name; empty UPI ID = pay links off. */
    upiId: { type: String, default: "" },
    upiPayeeName: { type: String, default: "" },
  },
  { timestamps: true },
);

export type AppSettingsDoc = InferSchemaType<typeof appSettingsSchema>;

// This schema gained fields over time; in dev, recompile on hot reload so a running server
// doesn't keep a stale cached model that silently drops the new fields.
if (process.env.NODE_ENV !== "production" && mongoose.models.AppSettings) mongoose.deleteModel("AppSettings");

export const AppSettings: Model<AppSettingsDoc> =
  (mongoose.models.AppSettings as Model<AppSettingsDoc>) || mongoose.model<AppSettingsDoc>("AppSettings", appSettingsSchema);
