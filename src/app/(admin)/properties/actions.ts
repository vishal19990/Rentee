"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, syncRentalStatuses } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import { deletePhoto, savePhoto } from "@/lib/photo-store";
import { IMAGE_TYPES, parseForm, propertySchema, validateImage, type ActionState } from "@/lib/validation";
import { Rental } from "@/models/Rental";
import { Maintenance } from "@/models/Maintenance";
import { Property } from "@/models/Property";

const NOT_FOUND: ActionState = { ok: false, message: "Property not found." };

export async function createProperty(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(propertySchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  const doc = await Property.create(parsed.data);
  revalidatePath("/properties");
  redirect(`/properties/${doc._id}`);
}

export async function updateProperty(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  const parsed = parseForm(propertySchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  const res = await Property.updateOne({ _id }, parsed.data);
  if (res.matchedCount === 0) return NOT_FOUND;
  revalidatePath("/properties");
  redirect(`/properties/${id}`);
}

export async function setPropertyArchived(id: string, archived: boolean): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  await connectDB();
  await syncRentalStatuses();
  if (archived && (await Rental.exists({ property: _id, status: "active" }))) {
    return { ok: false, message: "Record the current tenant's move-out before archiving this property." };
  }
  const res = await Property.updateOne({ _id }, { archived });
  if (res.matchedCount === 0) return NOT_FOUND;
  revalidatePath("/properties");
  revalidatePath(`/properties/${id}`);
  return { ok: true, message: archived ? "Property archived." : "Property restored." };
}

export async function deleteProperty(id: string): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  await connectDB();
  if (await Rental.exists({ property: _id })) {
    return { ok: false, message: "This property has rentals, so it can't be deleted. Archive it instead." };
  }
  const property = await Property.findByIdAndDelete(_id).lean();
  if (!property) return NOT_FOUND;
  const requestIds = (await Maintenance.find({ property: _id }).select("_id").lean()).map((m) => String(m._id));
  await Maintenance.deleteMany({ property: _id });
  await syncNotificationsSafe({ scope: { maintenanceIds: requestIds } });
  await Promise.all(property.photos.map((f) => deletePhoto(f)));
  revalidatePath("/properties");
  redirect("/properties");
}

export async function uploadPropertyPhoto(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
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
  if (error || !f || !bytes) return { ok: false, fieldErrors: { photo: [error ?? "Choose an image to upload"] } };

  await connectDB();
  const property = await Property.findById(_id).select("photos").lean();
  if (!property) return NOT_FOUND;
  if (property.photos.length >= 12) return { ok: false, fieldErrors: { photo: ["A property can have at most 12 photos"] } };

  const name = `${crypto.randomBytes(16).toString("hex")}.${IMAGE_TYPES[f.type]}`;
  await savePhoto(name, bytes, f.type);
  const res = await Property.updateOne({ _id }, { $push: { photos: name } });
  if (res.matchedCount === 0) {
    await deletePhoto(name); // property vanished meanwhile: don't leave an orphaned file
    return NOT_FOUND;
  }
  revalidatePath(`/properties/${id}`);
  revalidatePath("/properties");
  return { ok: true, message: "Photo uploaded." };
}

export async function removePropertyPhoto(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  const name = String(fd.get("file") ?? "");
  if (!_id) return NOT_FOUND;
  await connectDB();
  const res = await Property.updateOne({ _id, photos: name }, { $pull: { photos: name } });
  if (res.modifiedCount === 0) return { ok: false, message: "Photo not found." };
  await deletePhoto(name);
  revalidatePath(`/properties/${id}`);
  revalidatePath("/properties");
  return { ok: true, message: "Photo removed." };
}
