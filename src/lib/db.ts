import mongoose from "mongoose";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/rentee";

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };

const globalForMongoose = globalThis as unknown as { __mongoose?: Cache };
const cache: Cache = globalForMongoose.__mongoose ?? { conn: null, promise: null };
globalForMongoose.__mongoose = cache;

/** Returns a cached Mongoose connection (reused across hot reloads and requests). */
export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    const uri = process.env.MONGODB_URI || DEFAULT_URI;
    cache.promise = mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 }).catch((err) => {
      cache.promise = null;
      throw err;
    });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}
