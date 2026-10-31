import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

/**
 * Failed sign-in counters for brute-force protection (see lib/login-throttle.ts). `key` is
 * "email:<address>" or "ip:<address>". Documents expire on their own a day after the last update.
 * Collection name is explicit so it never mixes with another app's collections in a shared database.
 */
const loginThrottleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 0 },
    firstAt: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    updatedAt: { type: Date, required: true, default: () => new Date(), expires: 60 * 60 * 24 },
  },
  { versionKey: false, collection: "rentee_login_throttles" },
);

export type LoginThrottleDoc = InferSchemaType<typeof loginThrottleSchema>;

export const LoginThrottle: Model<LoginThrottleDoc> =
  (mongoose.models.LoginThrottle as Model<LoginThrottleDoc>) ||
  mongoose.model<LoginThrottleDoc>("LoginThrottle", loginThrottleSchema);
