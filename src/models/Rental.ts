import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

/**
 * A month-to-month rental: a tenant living in a property. There is no contract end date;
 * "Move out" records `moveOutDate`. A rental with a future moveOutDate stays `active` until
 * that date is reached (see `rentalStatus` in lib/rent.ts and `syncRentalStatuses` in lib/data.ts).
 */
const rentalSchema = new Schema(
  {
    property: { type: Schema.Types.ObjectId, ref: "Property", required: true, index: true },
    tenant: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    /** Calendar dates stored as UTC midnight. */
    moveInDate: { type: Date, required: true },
    moveOutDate: { type: Date, default: null },
    /** Integer minor units. */
    monthlyRent: { type: Number, required: true, min: 1 },
    deposit: { type: Number, required: true, min: 0, default: 0 },
    dueDay: { type: Number, required: true, min: 1, max: 28, default: 1 },
    status: { type: String, enum: ["active", "moved_out"], required: true, default: "active", index: true },
  },
  { timestamps: true },
);

// Hard guarantee: a property can have at most one active rental.
rentalSchema.index(
  { property: 1 },
  { unique: true, partialFilterExpression: { status: "active" }, name: "one_active_rental_per_property" },
);

export type RentalDoc = InferSchemaType<typeof rentalSchema>;

export const Rental: Model<RentalDoc> =
  (mongoose.models.Rental as Model<RentalDoc>) || mongoose.model<RentalDoc>("Rental", rentalSchema);
