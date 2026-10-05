import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

/**
 * A rent change: from `effectiveMonth` on, the rental's monthly rent is `monthlyRent`.
 * Rent for a month = latest change with effectiveMonth <= month, else Rental.monthlyRent
 * (the original rent, which is never overwritten). See rentForMonth in lib/rent.ts.
 */
const rentChangeSchema = new Schema(
  {
    rental: { type: Schema.Types.ObjectId, ref: "Rental", required: true },
    /** YYYY-MM. */
    effectiveMonth: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    /** Integer minor units. */
    monthlyRent: { type: Number, required: true, min: 1 },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

// One rent per rental per effective month (saving the same month again replaces it).
rentChangeSchema.index({ rental: 1, effectiveMonth: 1 }, { unique: true });

export type RentChangeDoc = InferSchemaType<typeof rentChangeSchema>;

export const RentChange: Model<RentChangeDoc> =
  (mongoose.models.RentChange as Model<RentChangeDoc>) || mongoose.model<RentChangeDoc>("RentChange", rentChangeSchema);
