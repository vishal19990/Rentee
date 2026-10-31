"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { deleteFile, saveFile } from "@/lib/file-store";
import { validateImage, type ActionState } from "@/lib/validation";
import { Tenant } from "@/models/Tenant";

const NOT_FOUND: ActionState = { ok: false, message: "Tenant not found." };

// Tenant photos appear next to the name across the app.
function refresh(id: string) {
  revalidatePath("/", "layout");
  revalidatePath(`/tenants/${id}`);
}

/** Uploads (or replaces) a tenant's profile photo. The browser sends a square, resized JPEG. */
export async function uploadTenantPhoto(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  const file = fd.get("photo");
  const f = file instanceof File ? file : null;
  let error = validateImage(f);
  let bytes: Buffer | null = null;
  if (!error && f) {
    bytes = Buffer.from(await f.arrayBuffer());
    error = validateImage(f, bytes.subarray(0, 12));
  }
  if (error || !f || !bytes) return { ok: false, message: error ?? "Choose a photo", fieldErrors: { photo: [error ?? "Choose a photo"] } };
  if (f.type === "image/gif") return { ok: false, message: "Use a JPEG, PNG or WebP photo", fieldErrors: { photo: ["Use a JPEG, PNG or WebP photo"] } };

  await connectDB();
  const tenant = await Tenant.findById(_id).select("photo").lean();
  if (!tenant) return NOT_FOUND;
  const fileId = await saveFile("avatars", bytes, { filename: `tenant-${id}.jpg`, contentType: f.type });
  const res = await Tenant.updateOne({ _id }, { $set: { photo: fileId } });
  if (res.matchedCount === 0) {
    await deleteFile("avatars", fileId); // tenant vanished meanwhile: don't leave an orphaned file
    return NOT_FOUND;
  }
  await deleteFile("avatars", tenant.photo);
  refresh(id);
  return { ok: true, message: "Photo updated." };
}

export async function removeTenantPhoto(id: string): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  await connectDB();
  const tenant = await Tenant.findOneAndUpdate({ _id }, { $set: { photo: null } }).select("photo").lean();
  if (!tenant) return NOT_FOUND;
  await deleteFile("avatars", tenant.photo);
  refresh(id);
  return { ok: true, message: "Photo removed." };
}
