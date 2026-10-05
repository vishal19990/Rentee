import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { PAYMENT_METHODS } from "@/lib/validation";

const { Schema } = mongoose;

/** Payment records are never hard-deleted: they are the source of truth for rent status. */
const paymentSchema = new Schema(
  {
    rental: { type: Schema.Types.ObjectId, ref: "Rental", required: true, index: true },
    /** Rent month this payment applies to, YYYY-MM. */
    forMonth: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    /** Integer minor units, > 0. */
    amount: { type: Number, required: true, min: 1 },
    paidOn: { type: Date, required: true, index: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true, default: "cash" },
    note: { type: String, default: "" },
    /** Rent receipt number, e.g. "RNT/2026-27/0001" (F1); assigned once, never changed. */
    receiptNo: { type: String, default: null },
  },
  { timestamps: true },
);
paymentSchema.index({ receiptNo: 1 }, { unique: true, partialFilterExpression: { receiptNo: { $type: "string" } } });

export type PaymentDoc = InferSchemaType<typeof paymentSchema>;

export const Payment: Model<PaymentDoc> =
  (mongoose.models.Payment as Model<PaymentDoc>) || mongoose.model<PaymentDoc>("Payment", paymentSchema);
