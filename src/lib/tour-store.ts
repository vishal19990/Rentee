import "server-only";
import { Types } from "mongoose";
import { appBaseUrl } from "./app-url";
import { connectDB } from "./db";
import { deleteFile, readFile, saveFile } from "./file-store";
import { createSampleTour } from "./sample-tour";
import { signTourToken } from "./signed-links";
import type { TourViewerRoom } from "./tours";
import { Property } from "@/models/Property";
import { TourRoom } from "@/models/TourRoom";

/**
 * Virtual tour storage: room photos and thumbnails in the GridFS bucket "tours", served to
 * admins via /api/tours/[roomId]/(image|thumb) and to share-link visitors via
 * /t/<token>/img/[roomId] and /t/<token>/thumb/[roomId].
 */

export const saveTourFile = (bytes: Buffer, meta: { filename: string; contentType: string }) => saveFile("tours", bytes, meta);
export const deleteTourFile = (id: Types.ObjectId | null | undefined) => deleteFile("tours", id);
export const readTourFile = (id: Types.ObjectId) => readFile("tours", id);

export function adminRoomUrls(roomId: string) {
  return { image: `/api/tours/${roomId}/image`, thumb: `/api/tours/${roomId}/thumb` };
}

export function publicRoomUrls(token: string, roomId: string) {
  return { image: `/t/${token}/img/${roomId}`, thumb: `/t/${token}/thumb/${roomId}` };
}

/** Rooms of a property in tour order, ready for the viewer. */
export async function loadTourRooms(
  propertyId: Types.ObjectId,
  urls: (roomId: string) => { image: string; thumb: string } = adminRoomUrls,
): Promise<TourViewerRoom[]> {
  await connectDB();
  const rooms = await TourRoom.find({ property: propertyId }).sort({ order: 1, _id: 1 }).lean();
  return rooms.map((r) => {
    const id = String(r._id);
    return {
      id,
      name: r.name,
      ...urls(id),
      initialYaw: r.initialYaw ?? 0,
      links: (r.links ?? []).map((l) => ({ id: String(l._id), toRoom: String(l.toRoom), yaw: l.yaw, pitch: l.pitch })),
      sample: !!r.sample,
    };
  });
}

/** Start room id: the stored one if it still exists, else the first room. */
export function startRoomOf(rooms: { id: string }[], stored: unknown): string | null {
  const s = stored ? String(stored) : null;
  if (s && rooms.some((r) => r.id === s)) return s;
  return rooms[0]?.id ?? null;
}

export async function tourShareUrl(propertyId: string, version: number): Promise<string> {
  return `${await appBaseUrl()}/t/${signTourToken(propertyId, version)}`;
}

/** Deletes every room of a property and their GridFS files (property delete). */
export async function deletePropertyTour(propertyId: Types.ObjectId): Promise<void> {
  await connectDB();
  const rooms = await TourRoom.find({ property: propertyId }).select("image thumbnail").lean();
  await TourRoom.deleteMany({ property: propertyId });
  await Promise.all(rooms.flatMap((r) => [deleteTourFile(r.image), deleteTourFile(r.thumbnail)]));
}

export async function addSampleTour(propertyId: Types.ObjectId): Promise<boolean> {
  await connectDB();
  if (!(await Property.exists({ _id: propertyId }))) return false;
  return createSampleTour(propertyId, saveTourFile, (id) => deleteTourFile(id));
}

/**
 * Properties whose tour can be sent to an enquirer: sharing on, not archived, with rooms or an
 * external tour. The enquiry's own property (if any) comes first.
 */
export async function sharedTourOptions(preferredPropertyId: string | null): Promise<{ propertyId: string; name: string; url: string }[]> {
  await connectDB();
  const props = await Property.find({ "tour.enabled": true, archived: false }).select("name tour").sort({ name: 1 }).lean();
  if (props.length === 0) return [];
  const withRooms = new Set((await TourRoom.distinct("property", { property: { $in: props.map((p) => p._id) } })).map(String));
  const usable = props.filter((p) => withRooms.has(String(p._id)) || !!p.tour?.externalUrl);
  usable.sort((a, b) => Number(String(b._id) === preferredPropertyId) - Number(String(a._id) === preferredPropertyId));
  return Promise.all(
    usable.map(async (p) => ({ propertyId: String(p._id), name: p.name, url: await tourShareUrl(String(p._id), p.tour?.shareVersion ?? 0) })),
  );
}
