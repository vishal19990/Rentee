import "server-only";
import { asObjectId } from "./data";
import { connectDB } from "./db";
import { verifyTourToken } from "./signed-links";
import { readTourFile } from "./tour-store";
import { shareLinkValid } from "./tours";
import { Property } from "@/models/Property";
import { TourRoom } from "@/models/TourRoom";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * Streams a room's panorama or thumbnail. With `propertyId`, the room must belong to that
 * property (public share links); admin routes pass null after checking the session.
 */
export async function serveTourImage(
  roomId: string,
  kind: "image" | "thumb",
  opts: { propertyId: string | null; cache: string },
): Promise<Response> {
  const rid = asObjectId(roomId);
  if (!rid) return notFound();
  await connectDB();
  const filter = opts.propertyId ? { _id: rid, property: asObjectId(opts.propertyId) } : { _id: rid };
  const room = await TourRoom.findOne(filter).select("image thumbnail contentType").lean();
  if (!room) return notFound();
  const data = await readTourFile(kind === "image" ? room.image : room.thumbnail);
  if (!data) return notFound();
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": kind === "image" ? room.contentType || "image/jpeg" : "image/jpeg",
      "Content-Length": String(data.length),
      "Cache-Control": opts.cache,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/** Public image for a /t/<token> visitor: the token must still open the tour. */
export async function servePublicTourImage(token: string, roomId: string, kind: "image" | "thumb"): Promise<Response> {
  const v = verifyTourToken(token);
  if (!v.ok) return notFound();
  await connectDB();
  const p = await Property.findById(v.link.propertyId).select("tour archived").lean();
  if (!p || p.archived || !shareLinkValid(p.tour, v.link.version)) return notFound();
  // Short cache so turning sharing off takes effect quickly for new page loads.
  return serveTourImage(roomId, kind, { propertyId: v.link.propertyId, cache: "private, max-age=600" });
}
