import "server-only";
import mongoose, { Types } from "mongoose";
import { connectDB } from "./db";

/**
 * Generic GridFS storage for attachments (same approach as photo-store.ts): files live in
 * MongoDB so hosts with an ephemeral disk keep them. Each bucket is private; files are only
 * ever served through authenticated route handlers.
 *   - "bills": expense bill attachments (F2)
 *   - "tours": 360° virtual tour room photos and thumbnails
 */
export type FileBucket = "bills" | "tours";

async function bucket(name: FileBucket) {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is not ready");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: name });
}

/** Stores bytes and returns the GridFS file id. */
export async function saveFile(
  name: FileBucket,
  bytes: Buffer,
  meta: { filename: string; contentType: string },
): Promise<Types.ObjectId> {
  const b = await bucket(name);
  return new Promise<Types.ObjectId>((resolve, reject) => {
    const up = b.openUploadStream(meta.filename, { metadata: { contentType: meta.contentType } });
    up.once("finish", () => resolve(up.id as Types.ObjectId));
    up.once("error", reject);
    up.end(bytes);
  });
}

export async function readFile(name: FileBucket, id: Types.ObjectId): Promise<Buffer | null> {
  const b = await bucket(name);
  const file = (await b.find({ _id: id }).limit(1).toArray())[0];
  if (!file) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of b.openDownloadStream(file._id)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function deleteFile(name: FileBucket, id: Types.ObjectId | null | undefined): Promise<void> {
  if (!id) return;
  const b = await bucket(name);
  await b.delete(id).catch(() => {});
}

/** A safe display/download file name (no path separators, quotes or control characters). */
export function safeFileName(raw: string, fallback = "file"): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}
