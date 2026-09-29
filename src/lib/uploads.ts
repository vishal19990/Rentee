import path from "node:path";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");

/** Stored upload names are random hex + a known image extension; nothing else is served. */
export const UPLOAD_NAME_RE = /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/;

export const UPLOAD_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** Absolute path for a stored upload, or null if the name is not a valid upload name. */
export function uploadPath(name: string): string | null {
  return UPLOAD_NAME_RE.test(name) ? path.join(UPLOAD_DIR, name) : null;
}

export function photoUrl(name: string): string {
  return `/api/uploads/${name}`;
}
