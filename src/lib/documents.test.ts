import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_BYTES,
  detectDocumentType,
  documentFileName,
  documentFormSchema,
  formatFileSize,
  validateDocumentFile,
} from "./documents";

const bytes = (...b: number[]) => Uint8Array.from([...b, ...Array(Math.max(0, 12 - b.length)).fill(0)]);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00); // "MZ" — a Windows executable
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);

describe("detectDocumentType", () => {
  it("recognises PDF, JPEG, PNG and WebP by signature", () => {
    expect(detectDocumentType(PDF)).toBe("application/pdf");
    expect(detectDocumentType(JPG)).toBe("image/jpeg");
    expect(detectDocumentType(PNG)).toBe("image/png");
    expect(detectDocumentType(WEBP)).toBe("image/webp");
  });

  it("rejects anything else, including GIF and truncated headers", () => {
    expect(detectDocumentType(EXE)).toBeNull();
    expect(detectDocumentType(GIF)).toBeNull();
    expect(detectDocumentType(Uint8Array.from([0x25, 0x50]))).toBeNull();
    expect(detectDocumentType(Uint8Array.from([0x52, 0x49, 0x46, 0x46]))).toBeNull();
  });
});

describe("validateDocumentFile (matrix: document upload)", () => {
  it("rejects an .exe renamed to .pdf (signature decides, not the name/declared type)", () => {
    const file = { size: 50_000, type: "application/pdf", name: "aadhaar.pdf" };
    expect(validateDocumentFile(file, EXE)).toEqual({ error: "Only PDF, JPG, PNG or WebP files are allowed" });
  });

  it("rejects a 12 MB file before reading its bytes", () => {
    expect(validateDocumentFile({ size: 12 * 1024 * 1024 })).toEqual({ error: "File must be 10 MB or smaller" });
    expect(validateDocumentFile({ size: 12 * 1024 * 1024 }, PDF).error).toBe("File must be 10 MB or smaller");
  });

  it("accepts exactly 10 MB and returns the detected content type", () => {
    expect(validateDocumentFile({ size: MAX_DOCUMENT_BYTES }, PDF)).toEqual({ contentType: "application/pdf" });
    expect(validateDocumentFile({ size: 1000 }, WEBP)).toEqual({ contentType: "image/webp" });
  });

  it("requires a non-empty file", () => {
    expect(validateDocumentFile(null).error).toBe("Choose a file to upload");
    expect(validateDocumentFile({ size: 0 }).error).toBe("Choose a file to upload");
  });
});

describe("documentFormSchema", () => {
  it("parses type, optional title and optional rental", () => {
    expect(documentFormSchema.parse({ type: "pan", title: " PAN card ", rentalId: "" })).toEqual({
      type: "pan",
      title: "PAN card",
      rentalId: null,
    });
    expect(documentFormSchema.parse({ type: "other", rentalId: "a".repeat(24) }).rentalId).toBe("a".repeat(24));
  });

  it("rejects unknown types and bad rental ids", () => {
    const r = documentFormSchema.safeParse({ type: "passport", rentalId: "nope" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = r.error.flatten().fieldErrors;
      expect(errs.type?.[0]).toBe("Select a document type");
      expect(errs.rentalId?.[0]).toBe("Select a rental");
    }
  });
});

describe("helpers", () => {
  it("builds safe download names with the stored type's extension", () => {
    expect(documentFileName("Aadhaar (front)", "image/jpeg")).toBe("Aadhaar-front.jpg");
    expect(documentFileName('../../etc/"passwd"', "application/pdf")).toBe("etcpasswd.pdf");
    expect(documentFileName("agreement.pdf", "application/pdf")).toBe("agreement.pdf");
    expect(documentFileName("!!!", "image/png")).toBe("document.png");
  });

  it("formats file sizes", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});
