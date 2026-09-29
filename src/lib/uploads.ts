/** Stored photo names are random hex + a known image extension; nothing else is accepted or served. */
export const UPLOAD_NAME_RE = /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/;

export const UPLOAD_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export function isUploadName(name: string): boolean {
  return UPLOAD_NAME_RE.test(name);
}

export function photoUrl(name: string): string {
  return `/api/uploads/${name}`;
}
