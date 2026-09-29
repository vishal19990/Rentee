import mongoose from "mongoose";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/rentee";

/** MONGODB_URI, falling back to the local dev database outside production. */
export function mongoUri(): string {
  const uri = process.env.MONGODB_URI?.trim();
  if (uri) return uri;
  if (process.env.NODE_ENV === "production") {
    throw new Error("MONGODB_URI must be set in production (e.g. your MongoDB Atlas connection string).");
  }
  return DEFAULT_URI;
}

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };

const globalForMongoose = globalThis as unknown as { __mongoose?: Cache };
const cache: Cache = globalForMongoose.__mongoose ?? { conn: null, promise: null };
globalForMongoose.__mongoose = cache;

/** Returns a cached Mongoose connection (reused across hot reloads and requests). */
export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose.connect(mongoUri(), { serverSelectionTimeoutMS: 8000 }).catch((err) => {
      cache.promise = null;
      throw err;
    });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}
