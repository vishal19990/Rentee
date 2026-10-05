import mongoose, { type Model } from "mongoose";

const { Schema } = mongoose;

/** Named atomic sequences (e.g. "receipt:2026-27"), incremented with $inc. */
const counterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export type CounterDoc = { _id: string; seq: number };

export const Counter: Model<CounterDoc> =
  (mongoose.models.Counter as Model<CounterDoc>) || mongoose.model<CounterDoc>("Counter", counterSchema);
