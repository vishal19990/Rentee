import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

/**
 * Optional WiFi for a rental, charged per person: from `fromMonth` through `toMonth` (inclusive;
 * null = ongoing) each month is billed people.length × ratePerPerson as a "WiFi" charge item
 * (see lib/wifi.ts). Plans of one rental never overlap (checked in the actions). People and the
 * rate are snapshots, so removing an occupant or changing the price never changes past months.
 */
const wifiPlanSchema = new Schema(
  {
    rental: { type: Schema.Types.ObjectId, ref: "Rental", required: true },
    /** YYYY-MM. */
    fromMonth: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    /** YYYY-MM, inclusive; null = ongoing. */
    toMonth: { type: String, default: null, match: /^\d{4}-\d{2}$/ },
    people: {
      type: [
        new Schema(
          {
            kind: { type: String, enum: ["tenant", "occupant"], required: true },
            /** Tenant.occupants[]._id for an occupant. */
            occupantId: { type: Schema.Types.ObjectId, default: null },
            /** Name when the plan was saved. */
            name: { type: String, required: true, trim: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    /** Integer minor units per person per month (the Settings price when saved). */
    ratePerPerson: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

// One plan per rental per start month (overlaps are checked in the actions).
wifiPlanSchema.index({ rental: 1, fromMonth: 1 }, { unique: true });

export type WifiPlanDoc = InferSchemaType<typeof wifiPlanSchema>;

export const WifiPlan: Model<WifiPlanDoc> =
  (mongoose.models.WifiPlan as Model<WifiPlanDoc>) || mongoose.model<WifiPlanDoc>("WifiPlan", wifiPlanSchema);
