import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { ACTIVITY_KINDS } from "@/lib/enquiries";

const { Schema } = mongoose;

/** Append-only timeline entry for an enquiry (notes, calls, status changes, visits…). */
const enquiryActivitySchema = new Schema(
  {
    enquiry: { type: Schema.Types.ObjectId, ref: "Enquiry", required: true, index: true },
    kind: { type: String, enum: ACTIVITY_KINDS, required: true },
    text: { type: String, default: "" },
    at: { type: Date, required: true, default: () => new Date() },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export type EnquiryActivityDoc = InferSchemaType<typeof enquiryActivitySchema>;

export const EnquiryActivity: Model<EnquiryActivityDoc> =
  (mongoose.models.EnquiryActivity as Model<EnquiryActivityDoc>) ||
  mongoose.model<EnquiryActivityDoc>("EnquiryActivity", enquiryActivitySchema);
