/**
 * Encrypts sensitive files that were uploaded before encryption existed (tenant documents,
 * tenant photos, expense bills) — see src/lib/file-crypto.ts.
 *
 *   npx tsx scripts/encrypt-files.ts            # dry run: counts what would be encrypted
 *   npx tsx scripts/encrypt-files.ts --confirm  # encrypts them
 *
 * Needs MONGODB_URI and FILES_ENCRYPTION_KEY (from .env / .env.local, or the environment) —
 * the SAME key the app uses, or the app won't be able to open the files afterwards.
 * Files keep their GridFS id, so nothing that points at them changes. Already-encrypted files
 * are skipped, so it's safe to run more than once.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import mongoose, { Types } from "mongoose";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });

const { configuredFilesKey, decryptBytes, encryptBytes, isEncrypted } = await import("../src/lib/file-crypto");

const CONFIRM = process.argv.includes("--confirm");
const BUCKETS = ["documents", "avatars", "bills"] as const;

const uri = process.env.MONGODB_URI;
const key = configuredFilesKey();
if (!uri) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}
if (!key) {
  console.error("FILES_ENCRYPTION_KEY is not set. Add the same key the app uses to .env (or the environment) first.");
  process.exit(1);
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function readAll(bucket: mongoose.mongo.GridFSBucket, id: Types.ObjectId): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of bucket.openDownloadStream(id)) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function write(bucket: mongoose.mongo.GridFSBucket, id: Types.ObjectId, filename: string, metadata: unknown, data: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const up = bucket.openUploadStreamWithId(id, filename, { metadata: metadata as Record<string, unknown> });
    up.once("finish", () => resolve());
    up.once("error", reject);
    up.end(data);
  });
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
const db = mongoose.connection.db!;
const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
console.log(`Database: ${db.databaseName} on ${uri.replace(/\/\/[^@]*@/, "//***@").replace(/\?.*$/, "")}`);
console.log(CONFIRM ? "Mode: ENCRYPT (--confirm)\n" : "Mode: dry run (nothing will be changed; add --confirm to encrypt)\n");

let failures = 0;
for (const name of BUCKETS) {
  if (!existing.has(`${name}.files`)) {
    console.log(`  ${name.padEnd(10)} no files`);
    continue;
  }
  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: name });
  const files = await db.collection(`${name}.files`).find({ "metadata.encryptionTempFor": { $exists: false } }).toArray();
  let plain = 0;
  let done = 0;
  for (const f of files) {
    const id = f._id as Types.ObjectId;
    const data = await readAll(bucket, id);
    if (isEncrypted(data)) continue;
    plain++;
    if (!CONFIRM) continue;
    const sealed = encryptBytes(data, key);
    const tempId = new Types.ObjectId();
    try {
      // 1. keep an encrypted copy, 2. replace the original under the same id, 3. verify, 4. drop the copy
      await write(bucket, tempId, `${f.filename}.enc-tmp`, { ...(f.metadata ?? {}), encryptionTempFor: id }, sealed);
      await bucket.delete(id);
      await write(bucket, id, f.filename, f.metadata ?? {}, sealed);
      const check = decryptBytes(await readAll(bucket, id), key);
      if (sha(check) !== sha(data)) throw new Error("verification failed");
      await bucket.delete(tempId);
      done++;
    } catch (err) {
      failures++;
      console.error(`  ! ${name}/${id}: ${(err as Error).message} — the encrypted copy is kept as ${tempId}`);
    }
  }
  console.log(`  ${name.padEnd(10)} ${files.length} files, ${plain} unencrypted${CONFIRM ? `, ${done} encrypted now` : ""}`);
}

console.log(CONFIRM ? (failures ? `\nFinished with ${failures} failure(s) — see above.` : "\nDone. All sensitive files are encrypted.") : "\nDry run only. Run again with --confirm to encrypt.");
await mongoose.disconnect();
process.exit(failures ? 1 : 0);
