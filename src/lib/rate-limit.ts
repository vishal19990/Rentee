import "server-only";
import mongoose, { type Model } from "mongoose";
import { connectDB } from "./db";
import { fixedWindow, type RateDecision } from "./rate-limit-core";

/**
 * Request limits for machine-facing endpoints (MCP connector, OAuth token/revoke): a counter per
 * (bucket, id, minute) in MongoDB, so limits hold across restarts and multiple instances.
 * Counters expire on their own shortly after their window ends.
 */
const schema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { versionKey: false, collection: "rentee_rate_limits" },
);

type RateDoc = { _id: string; count: number; expiresAt: Date };
const RateLimit: Model<RateDoc> = (mongoose.models.RateLimit as Model<RateDoc>) || mongoose.model<RateDoc>("RateLimit", schema);

/**
 * Counts one request for `id` in `bucket` and says whether it's within `limit` per `windowSec`.
 * Fails open (allows) if the counter can't be written, so a database hiccup never locks Claude out
 * on top of whatever else is wrong.
 */
export async function hitRateLimit(bucket: string, id: string, limit: number, windowSec = 60, now = new Date()): Promise<RateDecision> {
  const w = fixedWindow(bucket, id, now, windowSec);
  try {
    await connectDB();
    const doc = await RateLimit.findOneAndUpdate(
      { _id: w.key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: w.expiresAt } },
      { upsert: true, new: true, lean: true },
    );
    return w.decide(doc?.count ?? 1, limit);
  } catch (err) {
    console.error("[rate-limit] counter failed, allowing request:", err);
    return { allowed: true, remaining: limit, retryAfterSec: 0 };
  }
}
