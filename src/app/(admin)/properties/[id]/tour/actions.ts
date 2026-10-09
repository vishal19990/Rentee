"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { addSampleTour, deleteTourFile, saveTourFile } from "@/lib/tour-store";
import {
  MAX_TOUR_ROOMS,
  addLinkSchema,
  addRoomSchema,
  externalUrlSchema,
  normalizeYaw,
  pruneLinks,
  reorder,
  reverseYaw,
  validateLink,
  validateTourImage,
  validateTourThumb,
} from "@/lib/tours";
import { parseForm, type ActionState } from "@/lib/validation";
import { Property } from "@/models/Property";
import { TourRoom } from "@/models/TourRoom";

const NOT_FOUND: ActionState = { ok: false, message: "Property not found." };
const ROOM_NOT_FOUND: ActionState = { ok: false, message: "Room not found." };

function revalidateTour(id: string) {
  revalidatePath(`/properties/${id}`);
  revalidatePath(`/properties/${id}/tour`);
  revalidatePath(`/properties/${id}/tour/view`);
}

async function guard(propertyId: string, roomId?: string) {
  await requireUser();
  const pid = asObjectId(propertyId);
  const rid = roomId === undefined ? null : asObjectId(roomId);
  await connectDB();
  return { pid, rid };
}

/** "Add room": name + 360° photo (already downscaled in the browser) + browser-made thumbnail. */
export async function addTourRoom(propertyId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { pid } = await guard(propertyId);
  if (!pid) return NOT_FOUND;
  const values = { name: String(fd.get("name") ?? "") };
  const parsed = parseForm(addRoomSchema, fd);
  const image = fd.get("image");
  const thumb = fd.get("thumb");
  const imageFile = image instanceof File ? image : null;
  const thumbFile = thumb instanceof File ? thumb : null;

  const imageBytes = imageFile && imageFile.size > 0 && imageFile.size <= 12 * 1024 * 1024 ? new Uint8Array(await imageFile.arrayBuffer()) : undefined;
  const check = validateTourImage(imageFile, imageBytes);
  const fieldErrors: Record<string, string[]> = {};
  if (!parsed.success) Object.assign(fieldErrors, parsed.state.fieldErrors);
  if (check.error) fieldErrors.image = [check.error];
  let thumbBytes: Uint8Array | undefined;
  if (!check.error) {
    thumbBytes = thumbFile && thumbFile.size > 0 && thumbFile.size <= 300 * 1024 ? new Uint8Array(await thumbFile.arrayBuffer()) : undefined;
    const thumbError = validateTourThumb(thumbFile, thumbBytes);
    if (thumbError) fieldErrors.image = [thumbError];
  }
  if (!parsed.success || !("contentType" in check) || fieldErrors.image || !imageBytes || !thumbBytes) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors, values };
  }

  if (!(await Property.exists({ _id: pid }))) return NOT_FOUND;
  const count = await TourRoom.countDocuments({ property: pid });
  if (count >= MAX_TOUR_ROOMS) return { ok: false, fieldErrors: { image: [`A tour can have at most ${MAX_TOUR_ROOMS} rooms`] }, values };
  const last = await TourRoom.findOne({ property: pid }).sort({ order: -1 }).select("order").lean();

  const ext = check.contentType === "image/jpeg" ? "jpg" : check.contentType.split("/")[1];
  const imageId = await saveTourFile(Buffer.from(imageBytes), { filename: `room.${ext}`, contentType: check.contentType });
  const thumbId = await saveTourFile(Buffer.from(thumbBytes), { filename: "room-thumb.jpg", contentType: "image/jpeg" });
  try {
    await TourRoom.create({
      property: pid,
      name: parsed.data.name,
      order: (last?.order ?? -1) + 1,
      image: imageId,
      thumbnail: thumbId,
      contentType: check.contentType,
      width: check.width,
      height: check.height,
    });
  } catch (err) {
    await Promise.all([deleteTourFile(imageId), deleteTourFile(thumbId)]);
    throw err;
  }
  // Property deleted meanwhile: don't leave an orphaned room.
  if (!(await Property.exists({ _id: pid }))) {
    await TourRoom.deleteMany({ property: pid });
    await Promise.all([deleteTourFile(imageId), deleteTourFile(thumbId)]);
    return NOT_FOUND;
  }
  revalidateTour(propertyId);
  return { ok: true, message: `${parsed.data.name} added.` };
}

export async function renameTourRoom(propertyId: string, roomId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { pid, rid } = await guard(propertyId, roomId);
  if (!pid || !rid) return ROOM_NOT_FOUND;
  const parsed = parseForm(addRoomSchema, fd);
  if (!parsed.success) return parsed.state;
  const res = await TourRoom.updateOne({ _id: rid, property: pid }, { name: parsed.data.name });
  if (res.matchedCount === 0) return ROOM_NOT_FOUND;
  revalidateTour(propertyId);
  return { ok: true, message: "Renamed." };
}

export async function moveTourRoom(propertyId: string, roomId: string, dir: -1 | 1): Promise<ActionState> {
  const { pid, rid } = await guard(propertyId, roomId);
  if (!pid || !rid || (dir !== -1 && dir !== 1)) return ROOM_NOT_FOUND;
  const rooms = await TourRoom.find({ property: pid }).sort({ order: 1, _id: 1 }).select("_id").lean();
  const next = reorder(rooms.map((r) => String(r._id)), roomId, dir);
  if (!next) return { ok: true };
  await TourRoom.bulkWrite(next.map((id, order) => ({ updateOne: { filter: { _id: new Types.ObjectId(id), property: pid }, update: { order } } })));
  revalidateTour(propertyId);
  return { ok: true };
}

/** Deletes a room, its GridFS files and every link pointing to it. */
export async function deleteTourRoom(propertyId: string, roomId: string): Promise<ActionState> {
  const { pid, rid } = await guard(propertyId, roomId);
  if (!pid || !rid) return ROOM_NOT_FOUND;
  const room = await TourRoom.findOneAndDelete({ _id: rid, property: pid }).lean();
  if (!room) return ROOM_NOT_FOUND;
  const incoming = await TourRoom.find({ property: pid, "links.toRoom": rid }).select("links").lean();
  await Promise.all(incoming.map((r) => TourRoom.updateOne({ _id: r._id }, { links: pruneLinks(r.links, roomId) })));
  await Property.updateOne({ _id: pid, "tour.startRoom": rid }, { $set: { "tour.startRoom": null } });
  await Promise.all([deleteTourFile(room.image), deleteTourFile(room.thumbnail)]);
  revalidateTour(propertyId);
  return { ok: true, message: `${room.name} deleted.` };
}

export async function setTourStartRoom(propertyId: string, roomId: string): Promise<ActionState> {
  const { pid, rid } = await guard(propertyId, roomId);
  if (!pid || !rid) return ROOM_NOT_FOUND;
  if (!(await TourRoom.exists({ _id: rid, property: pid }))) return ROOM_NOT_FOUND;
  const res = await Property.updateOne({ _id: pid }, { $set: { "tour.startRoom": rid } });
  if (res.matchedCount === 0) return NOT_FOUND;
  revalidateTour(propertyId);
  return { ok: true, message: "Start room set." };
}

/** "Set starting view": the room opens looking at `yaw`. */
export async function setRoomInitialYaw(propertyId: string, roomId: string, yaw: number): Promise<ActionState> {
  const { pid, rid } = await guard(propertyId, roomId);
  if (!pid || !rid) return ROOM_NOT_FOUND;
  if (typeof yaw !== "number" || !Number.isFinite(yaw)) return { ok: false, message: "Look around first, then set the view." };
  const res = await TourRoom.updateOne({ _id: rid, property: pid }, { initialYaw: normalizeYaw(yaw) });
  if (res.matchedCount === 0) return ROOM_NOT_FOUND;
  revalidateTour(propertyId);
  return { ok: true, message: "Starting view saved." };
}

/** "Add link": a hotspot in `roomId` at (yaw, pitch) opening `toRoom`, optionally with a return link. */
export async function addTourLink(propertyId: string, roomId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { pid, rid } = await guard(propertyId, roomId);
  if (!pid || !rid) return ROOM_NOT_FOUND;
  const parsed = parseForm(addLinkSchema, fd);
  if (!parsed.success) return parsed.state;
  const rooms = await TourRoom.find({ property: pid }).select("_id links").lean();
  const check = validateLink(roomId, parsed.data, rooms.map((r) => String(r._id)));
  if (!check.ok) return { ok: false, message: check.error, fieldErrors: { toRoom: [check.error] }, values: parsed.values };
  const { toRoom, yaw, pitch } = check.link;
  const target = new Types.ObjectId(toRoom);
  await TourRoom.updateOne({ _id: rid, property: pid }, { $push: { links: { toRoom: target, yaw, pitch } } });
  let back = false;
  if (parsed.data.returnLink) {
    const targetRoom = rooms.find((r) => String(r._id) === toRoom);
    if (targetRoom && !targetRoom.links.some((l) => String(l.toRoom) === roomId)) {
      await TourRoom.updateOne({ _id: target, property: pid }, { $push: { links: { toRoom: rid, yaw: reverseYaw(yaw), pitch } } });
      back = true;
    }
  }
  revalidateTour(propertyId);
  return { ok: true, message: back ? "Link and return link added." : "Link added." };
}

export async function removeTourLink(propertyId: string, roomId: string, linkId: string): Promise<ActionState> {
  const { pid, rid } = await guard(propertyId, roomId);
  const lid = asObjectId(linkId);
  if (!pid || !rid || !lid) return ROOM_NOT_FOUND;
  const res = await TourRoom.updateOne({ _id: rid, property: pid }, { $pull: { links: { _id: lid } } });
  if (res.modifiedCount === 0) return { ok: false, message: "Link not found." };
  revalidateTour(propertyId);
  return { ok: true, message: "Link removed." };
}

export async function setExternalTourUrl(propertyId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { pid } = await guard(propertyId);
  if (!pid) return NOT_FOUND;
  const parsed = parseForm(externalUrlSchema, fd);
  if (!parsed.success) return parsed.state;
  const res = await Property.updateOne({ _id: pid }, { $set: { "tour.externalUrl": parsed.data.externalUrl } });
  if (res.matchedCount === 0) return NOT_FOUND;
  revalidateTour(propertyId);
  return {
    ok: true,
    message: parsed.data.externalUrl ? "External tour saved." : "External tour removed.",
    values: { externalUrl: parsed.data.externalUrl },
  };
}

export async function setTourSharing(propertyId: string, enabled: boolean): Promise<ActionState> {
  const { pid } = await guard(propertyId);
  if (!pid) return NOT_FOUND;
  const res = await Property.updateOne({ _id: pid }, { $set: { "tour.enabled": !!enabled } });
  if (res.matchedCount === 0) return NOT_FOUND;
  revalidateTour(propertyId);
  return { ok: true, message: enabled ? "Sharing is on." : "Sharing is off. Old links no longer open." };
}

/** Bumps the share version: every link sent so far stops working. */
export async function resetTourShareLink(propertyId: string): Promise<ActionState> {
  const { pid } = await guard(propertyId);
  if (!pid) return NOT_FOUND;
  const res = await Property.updateOne({ _id: pid }, { $inc: { "tour.shareVersion": 1 } });
  if (res.matchedCount === 0) return NOT_FOUND;
  revalidateTour(propertyId);
  return { ok: true, message: "New link created. Old links no longer open." };
}

/** "Use sample tour": copies the built-in demo rooms into an empty tour. */
export async function addSampleTourAction(propertyId: string): Promise<ActionState> {
  const { pid } = await guard(propertyId);
  if (!pid) return NOT_FOUND;
  const added = await addSampleTour(pid);
  if (!added) return { ok: false, message: "The sample tour can only be added to a tour without rooms." };
  revalidateTour(propertyId);
  return { ok: true, message: "Sample tour added: Living room, Bedroom and Kitchen." };
}
