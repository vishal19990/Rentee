import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

/**
 * A rental agreement period for a rental (default 11 months). Status (active / expiring /
 * expired) is derived from endDate, never stored — see lib/agreements.ts. "Renew" creates the
 * next agreement starting the day after the latest one ends.
 */
const agreementSchema = new Schema(
  {
    rental: { type: Schema.Types.ObjectId, ref: "Rental", required: true, index: true },
    /** Calendar dates stored as UTC midnight. */
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    /** Optional signed copy (a TenantDocument of the rental's tenant). */
    document: { type: Schema.Types.ObjectId, ref: "TenantDocument", default: null },
  },
  { timestamps: true },
);

// Two agreements for one rental can't start on the same day (also guards double-submitted renewals).
agreementSchema.index({ rental: 1, startDate: 1 }, { unique: true, name: "one_agreement_per_start" });

export type AgreementDoc = InferSchemaType<typeof agreementSchema>;

export const Agreement: Model<AgreementDoc> =
  (mongoose.models.Agreement as Model<AgreementDoc>) || mongoose.model<AgreementDoc>("Agreement", agreementSchema);
