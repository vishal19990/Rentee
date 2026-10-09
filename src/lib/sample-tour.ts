/**
 * Built-in sample tour (src/assets/sample-tour, made by scripts/generate-sample-tour.mjs):
 * three demo rooms — Living room, Bedroom, Kitchen — linked at their doors, so a landlord can
 * try the viewer without real 360° photos. Used by "Use sample tour" and by `npm run seed`.
 *
 * Not "server-only" so the seed script (plain Node) can use it; it never runs in the browser.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Types } from "mongoose";
import { Property } from "@/models/Property";
import { TourRoom } from "@/models/TourRoom";
import { planSampleTour, type SampleManifest } from "./tours";

export function sampleTourDir(): string {
  return path.join(process.cwd(), "src", "assets", "sample-tour");
}

export async function loadSampleManifest(): Promise<SampleManifest> {
  return JSON.parse(await readFile(path.join(sampleTourDir(), "manifest.json"), "utf8")) as SampleManifest;
}

export type SaveTourFile = (bytes: Buffer, meta: { filename: string; contentType: string }) => Promise<Types.ObjectId>;
export type DeleteTourFile = (id: Types.ObjectId) => Promise<void>;

/**
 * Copies the sample photos into GridFS as rooms of `propertyId` (marked `sample: true`) and
 * makes the Living room the start room. Returns false (and adds nothing) if the property
 * already has rooms. Files are cleaned up if anything fails halfway.
 */
export async function createSampleTour(propertyId: Types.ObjectId, save: SaveTourFile, remove: DeleteTourFile): Promise<boolean> {
  if (await TourRoom.exists({ property: propertyId })) return false;
  const manifest = await loadSampleManifest();
  const ids = Object.fromEntries(manifest.rooms.map((r) => [r.key, new Types.ObjectId().toHexString()]));
  const plan = planSampleTour(manifest, ids);

  const saved: Types.ObjectId[] = [];
  try {
    const docs = [];
    for (const [i, r] of manifest.rooms.entries()) {
      const [image, thumb] = await Promise.all([
        readFile(path.join(sampleTourDir(), r.image)),
        readFile(path.join(sampleTourDir(), r.thumbnail)),
      ]);
      const imageId = await save(image, { filename: r.image, contentType: "image/jpeg" });
      saved.push(imageId);
      const thumbId = await save(thumb, { filename: r.thumbnail, contentType: "image/jpeg" });
      saved.push(thumbId);
      const p = plan.rooms[i];
      docs.push({
        _id: new Types.ObjectId(p.id),
        property: propertyId,
        name: p.name,
        order: p.order,
        image: imageId,
        thumbnail: thumbId,
        contentType: "image/jpeg",
        width: r.width,
        height: r.height,
        initialYaw: p.initialYaw,
        links: p.links.map((l) => ({ toRoom: new Types.ObjectId(l.toRoom), yaw: l.yaw, pitch: l.pitch })),
        sample: true,
      });
    }
    // Re-check right before writing so two clicks can't create two sample tours.
    if (await TourRoom.exists({ property: propertyId })) throw new Error("already has rooms");
    await TourRoom.insertMany(docs);
    await Property.updateOne({ _id: propertyId }, { $set: { "tour.startRoom": new Types.ObjectId(plan.startRoom) } });
    return true;
  } catch (err) {
    await Promise.all(saved.map((id) => remove(id).catch(() => {})));
    if (err instanceof Error && err.message === "already has rooms") return false;
    throw err;
  }
}
