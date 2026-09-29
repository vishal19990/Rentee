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
    /** Stored file names under uploads/, served via /api/uploads/[file]. */
    photos: { type: [String], default: [] },
    notes: { type: String, default: "" },
    archived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

export type PropertyDoc = InferSchemaType<typeof propertySchema>;

export const Property: Model<PropertyDoc> =
  (mongoose.models.Property as Model<PropertyDoc>) || mongoose.model<PropertyDoc>("Property", propertySchema);
