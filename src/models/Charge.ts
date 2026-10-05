import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { CHARGE_TYPES } from "@/lib/charges";

const { Schema } = mongoose;

/**
 * A utility / other charge billed on top of rent for a month. A month's due amount is
 * rent(month) + sum of its charges; payments apply to that total.
 */
const chargeSchema = new Schema(
  {
    rental: { type: Schema.Types.ObjectId, ref: "Rental", required: true },
    /** YYYY-MM. */
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    type: { type: String, enum: CHARGE_TYPES, required: true },
    /** Integer minor units, > 0. */
    amount: { type: Number, required: true, min: 1 },
    /** Electricity meter readings; rate in minor units per unit. */
    meter: {
      type: new Schema(
        {
          previous: { type: Number, required: true, min: 0 },
          current: { type: Number, required: true, min: 0 },
          rate: { type: Number, required: true, min: 0 },
        },
        { _id: false },
      ),
      default: null,
    },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

chargeSchema.index({ rental: 1, month: 1 });

export type ChargeDoc = InferSchemaType<typeof chargeSchema>;

export const Charge: Model<ChargeDoc> = (mongoose.models.Charge as Model<ChargeDoc>) || mongoose.model<ChargeDoc>("Charge", chargeSchema);
