import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { DEPOSIT_KINDS, DEPOSIT_METHODS } from "@/lib/deposit";

const { Schema } = mongoose;

/**
 * Security-deposit ledger entry. Never edited or hard-deleted: corrections are new entries.
 * `source: "initial"` marks the entry created from Rental.deposit (at rental creation, or
 * lazily for rentals that existed before the ledger); at most one per rental.
 */
const depositEntrySchema = new Schema(
  {
    rental: { type: Schema.Types.ObjectId, ref: "Rental", required: true, index: true },
    kind: { type: String, enum: DEPOSIT_KINDS, required: true },
    /** Integer minor units, > 0. */
    amount: { type: Number, required: true, min: 1 },
    date: { type: Date, required: true },
    reason: { type: String, default: "" },
    source: { type: String, enum: ["initial", "manual"], required: true, default: "manual" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** How a received payment was made (advance-flow payments; null on older entries). */
    method: { type: String, enum: [...DEPOSIT_METHODS, null], default: null },
    /** Deposit receipt number "DEP/<FY>/<seq>" for received entries; assigned lazily on older ones. */
    receiptNo: { type: String, default: null },
  },
  { timestamps: true },
);

depositEntrySchema.index(
  { rental: 1 },
  { unique: true, partialFilterExpression: { source: "initial" }, name: "one_initial_deposit_per_rental" },
);

export type DepositEntryDoc = InferSchemaType<typeof depositEntrySchema>;

// Gained fields (method, receiptNo); in dev, recompile on hot reload so a stale cached model doesn't drop them.
if (process.env.NODE_ENV !== "production" && mongoose.models.DepositEntry) mongoose.deleteModel("DepositEntry");

export const DepositEntry: Model<DepositEntryDoc> =
  (mongoose.models.DepositEntry as Model<DepositEntryDoc>) || mongoose.model<DepositEntryDoc>("DepositEntry", depositEntrySchema);
