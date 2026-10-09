/**
 * 360° virtual tours: pure rules, no database access (tested in tours.test.ts).
 *
 * A tour is a set of rooms (equirectangular 360° photos, 2:1) linked by hotspots, plus an
 * optional external tour embed (Matterport, Kuula, YouTube, Google Maps).
 * Angles are radians in Photo Sphere Viewer's convention: yaw 0 = image centre, growing to
 * the right; pitch 0 = horizon, growing upwards.
 */
import { z } from "zod";
import { detectDocumentType } from "./documents";

export const MAX_TOUR_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_TOUR_THUMB_BYTES = 300 * 1024;
/** Browsers downscale wider panoramas to this before upload (6144×3072). */
export const TOUR_MAX_WIDTH = 6144;
export const TOUR_THUMB_WIDTH = 512;
export const TOUR_THUMB_HEIGHT = 256;
export const MAX_ROOM_NAME = 40;
export const MAX_TOUR_ROOMS = 30;
export const ASPECT_TOLERANCE = 0.03;

export const NOT_360_MESSAGE = "This isn't a 360° photo (it must be twice as wide as it is tall)";
export const TOUR_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

const TWO_PI = Math.PI * 2;

/* ---------- images ---------- */

/** Equirectangular check: width / height = 2 within ±3%. */
export function isEquirectangular(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  return Math.abs(width / height / 2 - 1) <= ASPECT_TOLERANCE;
}

/** JPEG / PNG / WebP from the file signature, else null (PDF and everything else rejected). */
export function detectTourImageType(head: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  const t = detectDocumentType(head);
  return t === "image/jpeg" || t === "image/png" || t === "image/webp" ? t : null;
}

/**
 * Pixel size from the image header (JPEG SOFn, PNG IHDR, WebP VP8/VP8L/VP8X), so the server
 * never trusts dimensions sent by the browser. Returns null when it can't be read.
 */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const type = detectTourImageType(bytes);
  const u16be = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  const u32be = (i: number) => ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
  const u24le = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  if (type === "image/png") {
    if (bytes.length < 24) return null;
    return { width: u32be(16), height: u32be(20) };
  }
  if (type === "image/jpeg") {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      // Standalone markers have no length.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      const len = u16be(i + 2);
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) return { width: u16be(i + 7), height: u16be(i + 5) };
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  if (type === "image/webp") {
    if (bytes.length < 30) return null;
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    // Lossy: 3-byte frame tag, start code 9d 01 2a, then 14-bit width / height (little endian).
    if (chunk === "VP8 ") return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
    if (chunk === "VP8L") {
      const b = (k: number) => bytes[21 + k];
      return { width: 1 + (((b(1) & 0x3f) << 8) | b(0)), height: 1 + (((b(3) & 0x0f) << 10) | (b(2) << 2) | ((b(1) & 0xc0) >> 6)) };
    }
    if (chunk === "VP8X") return { width: 1 + u24le(24), height: 1 + u24le(27) };
    return null;
  }
  return null;
}

export type TourImageCheck =
  | { error: string }
  | { error?: undefined; contentType: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number };

/** Server-side validation of an uploaded panorama: size, signature and 2:1 aspect ratio. */
export function validateTourImage(file: { size: number } | null | undefined, bytes?: Uint8Array): TourImageCheck {
  if (!file || file.size === 0) return { error: "Choose a 360° photo to upload" };
  if (file.size > MAX_TOUR_IMAGE_BYTES) return { error: "The photo must be 12 MB or smaller" };
  if (!bytes) return { error: "Choose a 360° photo to upload" };
  const contentType = detectTourImageType(bytes.subarray(0, 16));
  if (!contentType) return { error: "Only JPG, PNG or WebP photos are allowed" };
  const size = readImageSize(bytes);
  if (!size || !size.width || !size.height) return { error: "This photo couldn't be read. Try saving it as a JPG." };
  if (!isEquirectangular(size.width, size.height)) return { error: NOT_360_MESSAGE };
  return { contentType, ...size };
}

/** The browser-made thumbnail: a small JPEG. */
export function validateTourThumb(file: { size: number } | null | undefined, bytes?: Uint8Array): string | null {
  if (!file || file.size === 0 || !bytes) return "The preview image is missing. Choose the photo again.";
  if (file.size > MAX_TOUR_THUMB_BYTES) return "The preview image is too large";
  if (detectTourImageType(bytes.subarray(0, 16)) !== "image/jpeg") return "The preview image must be a JPEG";
  return null;
}

/** Size the browser should re-encode a panorama to (null = upload the original as is). */
export function downscaleTarget(width: number, height: number): { width: number; height: number } | null {
  if (width <= TOUR_MAX_WIDTH) return null;
  return { width: TOUR_MAX_WIDTH, height: TOUR_MAX_WIDTH / 2 };
}

/* ---------- angles & links ---------- */

/** Yaw wrapped into (-π, π]. */
export function normalizeYaw(yaw: number): number {
  let y = yaw % TWO_PI;
  if (y > Math.PI) y -= TWO_PI;
  if (y <= -Math.PI) y += TWO_PI;
  return y;
}

/** Where a return link goes when we don't know better: the opposite direction. */
export function reverseYaw(yaw: number): number {
  return normalizeYaw(yaw + Math.PI);
}

export type TourLink = { toRoom: string; yaw: number; pitch: number };

export type LinkCheck = { ok: true; link: TourLink } | { ok: false; error: string };

/** Validates a new hotspot from `fromRoom`; `roomIds` are the property's rooms. */
export function validateLink(fromRoom: string, input: { toRoom: string; yaw: number; pitch: number }, roomIds: string[]): LinkCheck {
  if (!roomIds.includes(fromRoom)) return { ok: false, error: "Room not found." };
  if (!input.toRoom || !roomIds.includes(input.toRoom)) return { ok: false, error: "Choose the room this link opens." };
  if (input.toRoom === fromRoom) return { ok: false, error: "A link can't point to the same room." };
  if (!Number.isFinite(input.yaw) || !Number.isFinite(input.pitch)) return { ok: false, error: "Click a point in the panorama first." };
  if (Math.abs(input.pitch) > Math.PI / 2 + 1e-9) return { ok: false, error: "Click a point in the panorama first." };
  return { ok: true, link: { toRoom: input.toRoom, yaw: normalizeYaw(input.yaw), pitch: input.pitch } };
}

/* ---------- forms ---------- */

export const roomNameSchema = z
  .string({ required_error: "Enter a room name" })
  .trim()
  .min(1, "Enter a room name")
  .max(MAX_ROOM_NAME, `Room name must be at most ${MAX_ROOM_NAME} characters`);

export const addRoomSchema = z.object({ name: roomNameSchema });

const angle = (label: string) =>
  z.coerce.number({ invalid_type_error: label }).refine((n) => Number.isFinite(n), label);

export const addLinkSchema = z.object({
  toRoom: z.string().regex(/^[a-f\d]{24}$/i, "Choose the room this link opens"),
  yaw: angle("Click a point in the panorama first"),
  pitch: angle("Click a point in the panorama first"),
  returnLink: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
});

/* ---------- external tours ---------- */

const YT_ID = /^[\w-]{6,20}$/;

/**
 * Normalizes an external tour URL to an embeddable https URL, or returns an error.
 * Allowed: my.matterport.com, kuula.co, YouTube (www.youtube.com / youtu.be → /embed/<id>)
 * and Google Maps embeds (www.google.com/maps/embed…).
 */
export function normalizeExternalTourUrl(raw: string): { url: string } | { error: string } {
  const value = raw.trim();
  if (!value) return { url: "" };
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return { error: "Enter a full link starting with https://" };
  }
  if (u.protocol !== "https:") return { error: "The link must start with https://" };
  if (u.username || u.password || u.port) return { error: "This link isn't supported" };
  const host = u.hostname.toLowerCase();
  const allowed = "Use a Matterport, Kuula, YouTube or Google Maps embed link";

  if (host === "my.matterport.com" || host === "kuula.co") return { url: u.toString() };

  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return YT_ID.test(id) ? { url: `https://www.youtube.com/embed/${id}` } : { error: "This YouTube link has no video id" };
  }
  if (host === "www.youtube.com" || host === "youtube.com" || host === "m.youtube.com") {
    let id: string | null = null;
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);
      if (m) id = m[1];
    }
    return id && YT_ID.test(id) ? { url: `https://www.youtube.com/embed/${id}` } : { error: "This YouTube link has no video id" };
  }
  if (host === "www.google.com" && (u.pathname === "/maps/embed" || u.pathname.startsWith("/maps/embed/"))) {
    return { url: u.toString() };
  }
  return { error: allowed };
}

export const externalUrlSchema = z.object({
  externalUrl: z
    .string()
    .max(2000, "This link is too long")
    .optional()
    .transform((v, ctx) => {
      const r = normalizeExternalTourUrl(v ?? "");
      if ("error" in r) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error });
        return z.NEVER;
      }
      return r.url;
    }),
});

/** Attributes for the sandboxed external tour iframe. */
export const EXTERNAL_IFRAME_ALLOW = "fullscreen; xr-spatial-tracking; gyroscope; accelerometer";
export const EXTERNAL_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-presentation allow-forms";

/* ---------- messages ---------- */

export function tourShareMessage(propertyName: string, link: string): string {
  return `Take a 360° tour of ${propertyName}: ${link}`;
}

export function enquiryTourMessage(name: string, propertyName: string, link: string): string {
  return `Hi ${name.trim() || "there"}, here's a 360° tour of ${propertyName}: ${link}`;
}

/* ---------- ordering ---------- */

/** New order after moving `id` one step up (-1) or down (+1); null when it can't move. */
export function reorder(ids: string[], id: string, dir: -1 | 1): string[] | null {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/* ---------- sample tour ---------- */

export type SampleManifest = {
  version: number;
  width: number;
  height: number;
  start: string;
  rooms: {
    key: string;
    name: string;
    image: string;
    thumbnail: string;
    width: number;
    height: number;
    initialYaw: number;
    links: { to: string; yaw: number; pitch: number }[];
  }[];
};

/**
 * Turns the sample manifest into rooms with links resolved to the created room ids.
 * `ids` maps manifest keys to database ids. Throws on a broken manifest.
 */
export function planSampleTour(manifest: SampleManifest, ids: Record<string, string>) {
  const keys = new Set(manifest.rooms.map((r) => r.key));
  if (!keys.has(manifest.start)) throw new Error("Sample tour: unknown start room");
  return {
    startRoom: ids[manifest.start],
    rooms: manifest.rooms.map((r, order) => ({
      key: r.key,
      id: ids[r.key],
      name: r.name,
      order,
      initialYaw: r.initialYaw,
      links: r.links.map((l) => {
        if (!keys.has(l.to) || l.to === r.key) throw new Error(`Sample tour: bad link ${r.key} -> ${l.to}`);
        return { toRoom: ids[l.to], yaw: normalizeYaw(l.yaw), pitch: l.pitch };
      }),
    })),
  };
}

/** Links left in a room after `removedRoom` is deleted. */
export function pruneLinks<L extends { toRoom: unknown }>(links: L[], removedRoom: string): L[] {
  return links.filter((l) => String(l.toRoom) !== removedRoom);
}

/* ---------- public share ---------- */

export type TourSettings = { enabled?: boolean | null; shareVersion?: number | null };

/** A verified /t/ token opens the tour only while sharing is on and the link wasn't reset. */
export function shareLinkValid(tour: TourSettings | null | undefined, tokenVersion: number): boolean {
  return !!tour?.enabled && (tour.shareVersion ?? 0) === tokenVersion;
}

/**
 * Everything the public /t/ page may show about a property. Built field by field, so nothing
 * else (address, tenant, rental, notes) can leak through.
 */
export function publicTourInfo(
  p: { name: string; city: string; bedrooms: number; bathrooms: number; monthlyRent: number },
  occupied: boolean,
) {
  return {
    name: p.name,
    city: p.city,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    monthlyRent: p.monthlyRent,
    availability: occupied ? ("Occupied" as const) : ("Available" as const),
  };
}

/* ---------- viewer data (serializable, shared by admin and public pages) ---------- */

export type TourViewerRoom = {
  id: string;
  name: string;
  /** Panorama and thumbnail URLs (authenticated admin routes or token-checked public ones). */
  image: string;
  thumb: string;
  initialYaw: number;
  links: { id: string; toRoom: string; yaw: number; pitch: number }[];
  sample: boolean;
};
