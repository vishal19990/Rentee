import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { PROPERTY_TYPES } from "@/lib/validation";

const { Schema } = mongoose;

const propertySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    type: { type: String, enum: PROPERTY_TYPES, required: true, default: "house" },
    bedrooms: { type: Number, required: true, min: 0, default: 0 },
    bathrooms: { type: Number, required: true, min: 0, default: 0 },
    /** Asking rent, integer minor units. Rentals carry their own agreed rent. */
    monthlyRent: { type: Number, required: true, min: 0 },
    /** Electricity rate per unit (minor units); null = use the Settings default. */
    electricityRate: { type: Number, min: 0, default: null },
    /** Stored file names under uploads/, served via /api/uploads/[file]. */
    photos: { type: [String], default: [] },
    notes: { type: String, default: "" },
    archived: { type: Boolean, default: false, index: true },
    /** 360° virtual tour settings (the rooms themselves live in TourRoom). */
    tour: {
      /** Public share link /t/<token> on or off. */
      enabled: { type: Boolean, default: false },
      /** Bumped by "Reset link" so older share links stop working. */
      shareVersion: { type: Number, default: 0 },
      /** Optional embeddable external tour (Matterport, Kuula, YouTube, Google Maps). */
      externalUrl: { type: String, default: "" },
      startRoom: { type: Schema.Types.ObjectId, ref: "TourRoom", default: null },
    },
  },
  { timestamps: true },
);

export type PropertyDoc = InferSchemaType<typeof propertySchema>;

// This schema gained fields over time; in dev, recompile on hot reload so a running server
// does not keep a stale cached model that silently drops the new fields.
if (process.env.NODE_ENV !== "production" && mongoose.models.Property) mongoose.deleteModel("Property");

export const Property: Model<PropertyDoc> =
  (mongoose.models.Property as Model<PropertyDoc>) || mongoose.model<PropertyDoc>("Property", propertySchema);
