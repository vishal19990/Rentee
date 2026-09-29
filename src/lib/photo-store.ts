import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectDB } from "./db";
import { UPLOAD_CONTENT_TYPES, isUploadName } from "./uploads";

/**
 * Property photos live in MongoDB GridFS (bucket "photos"), so the app works on hosts with an
 * ephemeral disk (e.g. Render free plan). Each file's GridFS `filename` is the stored photo name
 * (random hex + extension) referenced by Property.photos and served at /api/uploads/<name>.
 */
const BUCKET = "photos";

async function bucket() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is not ready");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET });
}

export async function savePhoto(name: string, bytes: Buffer, contentType: string): Promise<void> {
  if (!isUploadName(name)) throw new Error("Invalid photo name");
  const b = await bucket();
  await new Promise<void>((resolve, reject) => {
    const up = b.openUploadStream(name, { metadata: { contentType } });
    up.once("finish", () => resolve());
    up.once("error", reject);
    up.end(bytes);
  });
}

/** Removes every GridFS file stored under this name (normally exactly one). */
export async function deletePhoto(name: string): Promise<void> {
  if (!isUploadName(name)) return;
  const b = await bucket();
  const files = await b.find({ filename: name }).toArray();
  await Promise.all(files.map((f) => b.delete(f._id).catch(() => {})));
}

/**
 * Legacy fallback (dev only): photos uploaded before GridFS were written to ./uploads.
 * If a name isn't in GridFS but that old file exists locally, serve it so existing dev data
 * keeps displaying. Production never reads the local disk.
 */
async function readLegacyDiskPhoto(name: string): Promise<Buffer | null> {
  if (process.env.NODE_ENV === "production") return null;
  try {
    return await fs.readFile(path.join(process.cwd(), "uploads", name));
  } catch {
    return null;
  }
}

/** Reads a stored photo (≤ 5 MB by validation) or returns null if it doesn't exist. */
export async function readPhoto(name: string): Promise<{ data: Buffer; contentType: string } | null> {
  if (!isUploadName(name)) return null;
  const ext = name.split(".").pop()!;
  const fallbackType = UPLOAD_CONTENT_TYPES[ext] ?? "application/octet-stream";

  const b = await bucket();
  const file = (await b.find({ filename: name }).sort({ uploadDate: -1 }).limit(1).toArray())[0];
  if (file) {
    const chunks: Buffer[] = [];
    for await (const chunk of b.openDownloadStream(file._id)) chunks.push(chunk as Buffer);
    const contentType = (file.metadata as { contentType?: string } | undefined)?.contentType ?? fallbackType;
    return { data: Buffer.concat(chunks), contentType };
  }

  const legacy = await readLegacyDiskPhoto(name);
  return legacy ? { data: legacy, contentType: fallbackType } : null;
}
