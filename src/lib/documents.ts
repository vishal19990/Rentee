/**
 * Tenant documents (F7): pure validation rules, no database access.
 *
 * Accepted files: PDF, JPEG, PNG, WebP up to 10 MB. The stored content type comes from the
 * file's signature (magic bytes), never from the browser-declared type or the file name, so a
 * renamed executable ("setup.exe" -> "id.pdf") is rejected.
 */
import { z } from "zod";

export const DOCUMENT_TYPES = ["aadhaar", "pan", "agreement", "police_verification", "photo", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  aadhaar: "Aadhaar",
  pan: "PAN",
  agreement: "Rental agreement",
  police_verification: "Police verification",
  photo: "Photo",
  other: "Other",
};

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Content type -> extension, for every accepted document format. */
export const DOCUMENT_CONTENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

/** Bytes needed by detectDocumentType. */
export const SIGNATURE_BYTES = 12;

/** Content type from the file signature, or null if it isn't an accepted format. */
export function detectDocumentType(head: Uint8Array): string | null {
  const starts = (...sig: number[]) => head.length >= sig.length && sig.every((v, i) => head[i] === v);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf"; // %PDF-
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x52, 0x49, 0x46, 0x46) && head.length >= 12 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) {
    return "image/webp"; // RIFF....WEBP
  }
  return null;
}

/**
 * Validates an uploaded document. Without `head` only presence/size are checked (cheap pre-check
 * before reading the bytes); with `head` the signature decides the type.
 * Returns `{ error }` or `{ contentType }`.
 */
export function validateDocumentFile(
  file: { size: number } | null | undefined,
  head?: Uint8Array,
): { error: string; contentType?: undefined } | { error?: undefined; contentType: string | null } {
  if (!file || file.size === 0) return { error: "Choose a file to upload" };
  if (file.size > MAX_DOCUMENT_BYTES) return { error: "File must be 10 MB or smaller" };
  if (!head) return { contentType: null };
  const contentType = detectDocumentType(head);
  if (!contentType) return { error: "Only PDF, JPG, PNG or WebP files are allowed" };
  return { contentType };
}

/** Download file name: the title made filesystem-safe, plus the extension of the stored type. */
export function documentFileName(title: string, contentType: string): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[^\w\s.-]/g, "")
      .replace(/^[\s.]+/, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "document";
  const ext = DOCUMENT_CONTENT_TYPES[contentType] ?? "bin";
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Upload form fields (the file itself is validated by validateDocumentFile). */
export const documentFormSchema = z.object({
  type: z.enum(DOCUMENT_TYPES, { errorMap: () => ({ message: "Select a document type" }) }),
  title: z
    .string()
    .trim()
    .max(120, "Title must be at most 120 characters")
    .optional()
    .transform((v) => v || ""),
  rentalId: z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .pipe(z.union([z.literal("").transform(() => null), z.string().regex(/^[a-f\d]{24}$/i, "Select a rental")])),
});
