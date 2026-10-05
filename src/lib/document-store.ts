import "server-only";
import mongoose, { Types } from "mongoose";
import { connectDB } from "./db";

/**
 * Tenant documents (Aadhaar, PAN, agreements…) live in their own MongoDB GridFS bucket
 * "documents", separate from property photos. They are only ever served to signed-in admins
 * through /api/documents/[id]; there is no public URL.
 */
const BUCKET = "documents";

async function bucket() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is not ready");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET });
}

/** Stores the bytes and returns the GridFS file id. */
export async function saveDocumentFile(bytes: Buffer, contentType: string): Promise<Types.ObjectId> {
  const b = await bucket();
  const id = new Types.ObjectId();
  await new Promise<void>((resolve, reject) => {
    const up = b.openUploadStreamWithId(id, id.toHexString(), { metadata: { contentType } });
    up.once("finish", () => resolve());
    up.once("error", reject);
    up.end(bytes);
  });
  return id;
}

export async function deleteDocumentFile(id: Types.ObjectId | string): Promise<void> {
  const b = await bucket();
  await b.delete(new Types.ObjectId(String(id))).catch(() => {}); // already gone: nothing to do
}

/** Reads a stored document (≤ 10 MB by validation) or returns null if it doesn't exist. */
export async function readDocumentFile(id: Types.ObjectId | string): Promise<Buffer | null> {
  const b = await bucket();
  const _id = new Types.ObjectId(String(id));
  const file = (await b.find({ _id }).limit(1).toArray())[0];
  if (!file) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of b.openDownloadStream(_id)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
