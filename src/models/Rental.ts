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
    /** Agreed deposit at move-in (minor units). The deposit ledger (DepositEntry) is the source of truth. */
    deposit: { type: Number, required: true, min: 0, default: 0 },
    /**
     * Cached held deposit (received - deductions - refunds), used only as an atomic guard so
     * concurrent refunds can never drive the balance negative. Absent until the ledger is
     * initialised (see ensureDepositLedger in lib/deposit-store.ts).
     */
    depositHeld: { type: Number, min: 0 },
    /**
     * Set on rentals created with a deposit advance (the deposit is paid in parts): the advance
     * taken at creation (minor units, may be 0) and its date. Absent on older rentals, whose
     * deposit was recorded as fully received at move-in. See depositStatus in lib/deposit.ts.
     */
    depositAdvance: {
      type: new Schema({ amount: { type: Number, required: true, min: 0 }, date: { type: Date, required: true } }, { _id: false }),
      default: undefined,
    },
    /**
     * Cached total received (advance-flow rentals only), used as an atomic guard so payments
     * can never take more than the agreed deposit. See addDepositEntry in lib/deposit-store.ts.
     */
    depositReceived: { type: Number, min: 0 },
    /**
     * Set when the admin deleted the ledger's opening ("initial") entry, so ensureDepositLedger
     * doesn't re-create it from the deposit / advance fields.
     */
    depositInitialRemoved: { type: Boolean, default: false },
    // Legacy: rent is now billed in cycles from the move-in day (lib/rent.ts). Kept for history; unused.
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

// This schema gained fields over time; in dev, recompile on hot reload so a running server
// does not keep a stale cached model that silently drops the new fields.
if (process.env.NODE_ENV !== "production" && mongoose.models.Rental) mongoose.deleteModel("Rental");

export const Rental: Model<RentalDoc> =
  (mongoose.models.Rental as Model<RentalDoc>) || mongoose.model<RentalDoc>("Rental", rentalSchema);
