import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { ENQUIRY_SOURCES, ENQUIRY_STATUSES } from "@/lib/enquiries";

const { Schema } = mongoose;

/**
 * A property enquiry (lead). `property: null` = "any property". Closed outcomes keep
 * `outcomeReason` / `outcomeNote` / `outcomeAt`; reopening clears them. See lib/enquiries.ts.
 */
const enquirySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    /** Normalized phone (phoneKey in lib/enquiries.ts) for duplicate matching and search. */
    phoneKey: { type: String, default: "", index: true },
    email: { type: String, default: "", lowercase: true, trim: true },
    property: { type: Schema.Types.ObjectId, ref: "Property", default: null, index: true },
    source: { type: String, enum: ENQUIRY_SOURCES, required: true, default: "other" },
    /** Monthly budget, integer minor units. */
    budget: { type: Number, min: 0, default: null },
    /** Calendar date stored as UTC midnight. */
    desiredMoveIn: { type: Date, default: null },
    occupants: { type: Number, min: 1, default: null },
    occupation: { type: String, default: "", trim: true },
    notes: { type: String, default: "" },
    status: { type: String, enum: ENQUIRY_STATUSES, required: true, default: "new", index: true },
    outcomeReason: { type: String, default: "" },
    outcomeNote: { type: String, default: "" },
    outcomeAt: { type: Date, default: null },
    /** Calendar date stored as UTC midnight. */
    followUpDate: { type: Date, default: null },
    /** Visit date and time (an instant). */
    visitAt: { type: Date, default: null },
    convertedTenant: { type: Schema.Types.ObjectId, ref: "Tenant", default: null, index: true },
    convertedRental: { type: Schema.Types.ObjectId, ref: "Rental", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export type EnquiryDoc = InferSchemaType<typeof enquirySchema>;

// In dev, recompile on hot reload so a running server picks up schema changes.
if (process.env.NODE_ENV !== "production" && mongoose.models.Enquiry) mongoose.deleteModel("Enquiry");

export const Enquiry: Model<EnquiryDoc> =
  (mongoose.models.Enquiry as Model<EnquiryDoc>) || mongoose.model<EnquiryDoc>("Enquiry", enquirySchema);
