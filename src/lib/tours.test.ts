import { readFileSync } from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { signReceiptToken, signTourToken, verifyReceiptToken, verifyTourToken } from "./signed-links";
import {
  MAX_TOUR_IMAGE_BYTES,
  NOT_360_MESSAGE,
  addLinkSchema,
  addRoomSchema,
  downscaleTarget,
  enquiryTourMessage,
  externalUrlSchema,
  isEquirectangular,
  normalizeExternalTourUrl,
  normalizeYaw,
  planSampleTour,
  pruneLinks,
  publicTourInfo,
  readImageSize,
  reorder,
  reverseYaw,
  shareLinkValid,
  validateLink,
  validateTourImage,
  validateTourThumb,
  type SampleManifest,
} from "./tours";

const SECRET = new TextEncoder().encode("test-secret-for-tour-links-0123456789");
const PROP = "64b7f0c2a1b2c3d4e5f60718";
const ROOM_A = "64b7f0c2a1b2c3d4e5f60001";
const ROOM_B = "64b7f0c2a1b2c3d4e5f60002";
const ROOM_C = "64b7f0c2a1b2c3d4e5f60003";

function jpg(width: number, height: number): Uint8Array {
  const data = Buffer.alloc(width * height * 4, 200);
  return new Uint8Array(jpeg.encode({ data, width, height }, 50).data);
}

function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function webpVp8x(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  const w = width - 1;
  const h = height - 1;
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return b;
}

const file = (bytes: Uint8Array) => ({ size: bytes.length });

describe("image header sizes", () => {
  it("reads JPEG, PNG and WebP dimensions from the bytes", () => {
    expect(readImageSize(jpg(64, 32))).toEqual({ width: 64, height: 32 });
    expect(readImageSize(pngHeader(8000, 4000))).toEqual({ width: 8000, height: 4000 });
    expect(readImageSize(webpVp8x(6144, 3072))).toEqual({ width: 6144, height: 3072 });
  });
});

describe("add room (matrix: Add room / Not 360° / Fake image)", () => {
  it("an 8000×4000 photo is downscaled in the browser to 6144×3072; smaller ones are kept", () => {
    expect(downscaleTarget(8000, 4000)).toEqual({ width: 6144, height: 3072 });
    expect(downscaleTarget(4096, 2048)).toBeNull();
  });

  it("accepts a 2:1 JPEG and reports its size", () => {
    const b = jpg(128, 64);
    expect(validateTourImage(file(b), b)).toEqual({ contentType: "image/jpeg", width: 128, height: 64 });
  });

  it("allows ±3% around 2:1", () => {
    expect(isEquirectangular(6144, 3072)).toBe(true);
    expect(isEquirectangular(6000, 3072)).toBe(true); // 1.953 (-2.3%)
    expect(isEquirectangular(5900, 3072)).toBe(false); // 1.92 (-4%)
    expect(isEquirectangular(0, 0)).toBe(false);
  });

  it("refuses a 4000×3000 photo with the 360° message", () => {
    const b = pngHeader(4000, 3000);
    expect(validateTourImage(file(b), b)).toEqual({ error: NOT_360_MESSAGE });
    const j = jpg(40, 30);
    expect(validateTourImage(file(j), j)).toEqual({ error: NOT_360_MESSAGE });
  });

  it("refuses an .exe renamed .jpg, empty and oversize files", () => {
    const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]);
    expect(validateTourImage(file(exe), exe).error).toBe("Only JPG, PNG or WebP photos are allowed");
    expect(validateTourImage({ size: 0 }).error).toBe("Choose a 360° photo to upload");
    expect(validateTourImage({ size: MAX_TOUR_IMAGE_BYTES + 1 }, jpg(64, 32)).error).toBe("The photo must be 12 MB or smaller");
  });

  it("thumbnail must be a small JPEG", () => {
    const t = jpg(64, 32);
    expect(validateTourThumb(file(t), t)).toBeNull();
    const p = pngHeader(512, 256);
    expect(validateTourThumb(file(p), p)).toMatch(/JPEG/);
    expect(validateTourThumb({ size: 400 * 1024 }, t)).toMatch(/too large/);
  });

  it("missing name -> field error; names are trimmed and capped at 40", () => {
    const r = addRoomSchema.safeParse({ name: "  " });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.name).toEqual(["Enter a room name"]);
    expect(addRoomSchema.safeParse({ name: " Living room " })).toEqual({ success: true, data: { name: "Living room" } });
    expect(addRoomSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
  });
});

describe("link rooms (matrix: Link rooms)", () => {
  const rooms = [ROOM_A, ROOM_B];

  it("saves a hotspot with yaw/pitch to another room", () => {
    expect(validateLink(ROOM_A, { toRoom: ROOM_B, yaw: 1.2, pitch: -0.1 }, rooms)).toEqual({
      ok: true,
      link: { toRoom: ROOM_B, yaw: 1.2, pitch: -0.1 },
    });
  });

  it("refuses a link to the same room, an unknown room or a missing point", () => {
    expect(validateLink(ROOM_A, { toRoom: ROOM_A, yaw: 0, pitch: 0 }, rooms)).toEqual({ ok: false, error: "A link can't point to the same room." });
    expect(validateLink(ROOM_A, { toRoom: ROOM_C, yaw: 0, pitch: 0 }, rooms).ok).toBe(false);
    expect(validateLink(ROOM_A, { toRoom: ROOM_B, yaw: NaN, pitch: 0 }, rooms).ok).toBe(false);
  });

  it("wraps yaw and puts an unknown return link opposite", () => {
    expect(normalizeYaw(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeYaw(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2);
    expect(reverseYaw(0.5)).toBeCloseTo(0.5 - Math.PI);
    expect(reverseYaw(-2)).toBeCloseTo(-2 + Math.PI);
  });

  it("parses the link form", () => {
    expect(addLinkSchema.parse({ toRoom: ROOM_B, yaw: "1.5", pitch: "-0.2", returnLink: "on" })).toEqual({
      toRoom: ROOM_B,
      yaw: 1.5,
      pitch: -0.2,
      returnLink: true,
    });
    expect(addLinkSchema.safeParse({ toRoom: ROOM_B, yaw: "", pitch: "x" }).success).toBe(false);
  });
});

describe("delete room (matrix: Delete room)", () => {
  it("removes incoming links only", () => {
    const links = [
      { toRoom: ROOM_B, yaw: 1, pitch: 0 },
      { toRoom: ROOM_C, yaw: 2, pitch: 0 },
    ];
    expect(pruneLinks(links, ROOM_B)).toEqual([{ toRoom: ROOM_C, yaw: 2, pitch: 0 }]);
  });

  it("reorders rooms up and down", () => {
    expect(reorder([ROOM_A, ROOM_B, ROOM_C], ROOM_B, -1)).toEqual([ROOM_B, ROOM_A, ROOM_C]);
    expect(reorder([ROOM_A, ROOM_B], ROOM_A, -1)).toBeNull();
    expect(reorder([ROOM_A, ROOM_B], ROOM_B, 1)).toBeNull();
  });
});

describe("share links (matrix: Share link / Revoked link / Tampered token)", () => {
  it("round-trips and opens while sharing is on", () => {
    const t = signTourToken(PROP, 0, SECRET);
    const v = verifyTourToken(t, SECRET);
    expect(v).toEqual({ ok: true, link: { kind: "tour", propertyId: PROP, version: 0 } });
    expect(shareLinkValid({ enabled: true, shareVersion: 0 }, 0)).toBe(true);
  });

  it("is revoked by disabling sharing or resetting the link", () => {
    expect(shareLinkValid({ enabled: false, shareVersion: 0 }, 0)).toBe(false);
    expect(shareLinkValid({ enabled: true, shareVersion: 1 }, 0)).toBe(false);
    expect(shareLinkValid(null, 0)).toBe(false);
    // the reset link is a different token
    expect(signTourToken(PROP, 1, SECRET)).not.toBe(signTourToken(PROP, 0, SECRET));
  });

  it("rejects tampered tokens and other link kinds", () => {
    const t = signTourToken(PROP, 3, SECRET);
    const [kind, id, ver, sig] = t.split(".");
    expect(verifyTourToken(`${kind}.${id}.${(parseInt(ver, 36) + 1).toString(36)}.${sig}`, SECRET).ok).toBe(false);
    expect(verifyTourToken(`${kind}.${id.replace(/.$/, "9")}.${ver}.${sig}`, SECRET).ok).toBe(false);
    expect(verifyTourToken(`${t}x`, SECRET).ok).toBe(false);
    expect(verifyTourToken(t, new TextEncoder().encode("another-secret-another-secret-123")).ok).toBe(false);
    expect(verifyTourToken("garbage", SECRET).ok).toBe(false);
    expect(verifyReceiptToken(t, SECRET).ok).toBe(false);
    expect(verifyTourToken(signReceiptToken(PROP, SECRET), SECRET).ok).toBe(false);
  });
});

describe("external tours (matrix: External URL)", () => {
  it("converts YouTube links to the embed URL", () => {
    expect(normalizeExternalTourUrl("https://youtu.be/abc123")).toEqual({ url: "https://www.youtube.com/embed/abc123" });
    expect(normalizeExternalTourUrl("https://www.youtube.com/watch?v=abc123&t=5")).toEqual({ url: "https://www.youtube.com/embed/abc123" });
    expect(normalizeExternalTourUrl("https://www.youtube.com/embed/abc123")).toEqual({ url: "https://www.youtube.com/embed/abc123" });
  });

  it("keeps Matterport, Kuula and Google Maps embeds", () => {
    expect(normalizeExternalTourUrl("https://my.matterport.com/show/?m=AbCdEf")).toEqual({ url: "https://my.matterport.com/show/?m=AbCdEf" });
    expect(normalizeExternalTourUrl("https://kuula.co/share/collection/7abc")).toEqual({ url: "https://kuula.co/share/collection/7abc" });
    expect("url" in normalizeExternalTourUrl("https://www.google.com/maps/embed?pb=!4v1")).toBe(true);
  });

  it("refuses other hosts, http and look-alikes", () => {
    for (const bad of [
      "https://evil.com/embed",
      "http://my.matterport.com/show/?m=x",
      "https://my.matterport.com.evil.com/",
      "https://www.google.com/search?q=x",
      "javascript:alert(1)",
      "https://user:pw@kuula.co/x",
      "not a url",
    ]) {
      expect("error" in normalizeExternalTourUrl(bad), bad).toBe(true);
    }
    expect(normalizeExternalTourUrl("  ")).toEqual({ url: "" });
  });

  it("form schema returns a field error for a non-allowed host", () => {
    const r = externalUrlSchema.safeParse({ externalUrl: "https://example.com/tour" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.externalUrl?.[0]).toMatch(/Matterport/);
  });
});

describe("public privacy (matrix: Public privacy)", () => {
  it("keeps only listing fields and says Occupied/Available", () => {
    const property = {
      name: "Palm Grove Villa",
      city: "Bengaluru",
      address: "12 Palm Grove Road",
      bedrooms: 3,
      bathrooms: 2,
      monthlyRent: 3_500_000,
      notes: "secret",
      tenantName: "Rahul",
      tenantPhone: "99001 44556",
    };
    const info = publicTourInfo(property, true);
    expect(info).toEqual({ name: "Palm Grove Villa", city: "Bengaluru", bedrooms: 3, bathrooms: 2, monthlyRent: 3_500_000, availability: "Occupied" });
    expect(JSON.stringify(info)).not.toMatch(/Rahul|99001|Palm Grove Road|secret/);
    expect(publicTourInfo(property, false).availability).toBe("Available");
  });

  it("enquiry WhatsApp text", () => {
    expect(enquiryTourMessage("Sneha Kulkarni", "Cedar House", "https://x/t/abc")).toBe("Hi Sneha Kulkarni, here's a 360° tour of Cedar House: https://x/t/abc");
  });
});

describe("sample tour (manifest + hotspot wiring)", () => {
  const dir = path.join(process.cwd(), "src", "assets", "sample-tour");
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as SampleManifest;

  it("has Living room, Bedroom and Kitchen as real 2:1 JPEGs with thumbnails", () => {
    expect(manifest.rooms.map((r) => r.name)).toEqual(["Living room", "Bedroom", "Kitchen"]);
    for (const r of manifest.rooms) {
      const bytes = new Uint8Array(readFileSync(path.join(dir, r.image)));
      const check = validateTourImage(file(bytes), bytes);
      expect(check).toEqual({ contentType: "image/jpeg", width: r.width, height: r.height });
      expect(bytes.length).toBeLessThan(1.5 * 1024 * 1024);
      const thumb = new Uint8Array(readFileSync(path.join(dir, r.thumbnail)));
      expect(validateTourThumb(file(thumb), thumb)).toBeNull();
      expect(readImageSize(thumb)).toEqual({ width: 512, height: 256 });
    }
  });

  it("links Living room <-> Bedroom and Living room <-> Kitchen at the doors", () => {
    const byKey = Object.fromEntries(manifest.rooms.map((r) => [r.key, r]));
    expect(manifest.start).toBe("living");
    expect(byKey.living.links.map((l) => l.to).sort()).toEqual(["bedroom", "kitchen"]);
    expect(byKey.bedroom.links.map((l) => l.to)).toEqual(["living"]);
    expect(byKey.kitchen.links.map((l) => l.to)).toEqual(["living"]);
    for (const r of manifest.rooms) {
      for (const l of r.links) {
        expect(Math.abs(l.yaw)).toBeLessThanOrEqual(Math.PI);
        // doors are below the horizon but not on the floor
        expect(l.pitch).toBeLessThan(0);
        expect(l.pitch).toBeGreaterThan(-0.5);
      }
    }
    // Living room: bedroom door on the right (positive yaw), kitchen door on the left.
    expect(byKey.living.links.find((l) => l.to === "bedroom")!.yaw).toBeGreaterThan(0);
    expect(byKey.living.links.find((l) => l.to === "kitchen")!.yaw).toBeLessThan(0);
  });

  it("planSampleTour resolves keys to room ids and sets the start room", () => {
    const ids = { living: ROOM_A, bedroom: ROOM_B, kitchen: ROOM_C };
    const plan = planSampleTour(manifest, ids);
    expect(plan.startRoom).toBe(ROOM_A);
    expect(plan.rooms.map((r) => [r.id, r.name, r.order])).toEqual([
      [ROOM_A, "Living room", 0],
      [ROOM_B, "Bedroom", 1],
      [ROOM_C, "Kitchen", 2],
    ]);
    expect(plan.rooms[0].links.map((l) => l.toRoom).sort()).toEqual([ROOM_B, ROOM_C].sort());
    expect(plan.rooms[1].links).toEqual([{ toRoom: ROOM_A, yaw: expect.any(Number), pitch: expect.any(Number) }]);
    for (const r of plan.rooms) for (const l of r.links) expect(validateLink(r.id, l, [ROOM_A, ROOM_B, ROOM_C]).ok).toBe(true);
  });

  it("planSampleTour rejects a broken manifest", () => {
    const broken = { ...manifest, rooms: [{ ...manifest.rooms[0], links: [{ to: "garage", yaw: 0, pitch: 0 }] }] };
    expect(() => planSampleTour(broken, { living: ROOM_A })).toThrow(/bad link/);
  });
});
