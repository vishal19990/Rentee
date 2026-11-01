import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptBytes, encryptBytes, isEncrypted, keyFromSecret, openFromStorage, sealForStorage } from "./file-crypto";

const KEY = keyFromSecret("a".repeat(32));
const OTHER = keyFromSecret("b".repeat(32));
const pdf = Buffer.from("%PDF-1.7 fake aadhaar scan …");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("file encryption", () => {
  it("round-trips and the stored bytes don't contain the original", () => {
    const sealed = encryptBytes(pdf, KEY);
    expect(isEncrypted(sealed)).toBe(true);
    expect(sealed.includes(Buffer.from("aadhaar"))).toBe(false);
    expect(decryptBytes(sealed, KEY).equals(pdf)).toBe(true);
  });

  it("uses a fresh IV each time (same file encrypts differently)", () => {
    expect(encryptBytes(pdf, KEY).equals(encryptBytes(pdf, KEY))).toBe(false);
  });

  it("rejects the wrong key", () => {
    expect(() => decryptBytes(encryptBytes(pdf, KEY), OTHER)).toThrow();
  });

  it("rejects tampered data", () => {
    const sealed = encryptBytes(pdf, KEY);
    sealed[sealed.length - 1] ^= 0xff;
    expect(() => decryptBytes(sealed, KEY)).toThrow();
  });

  it("returns older unencrypted files unchanged", () => {
    expect(decryptBytes(pdf, KEY).equals(pdf)).toBe(true);
    expect(decryptBytes(pdf, null).equals(pdf)).toBe(true);
  });

  it("an encrypted file can't be read without the key", () => {
    expect(() => decryptBytes(encryptBytes(pdf, KEY), null)).toThrow(/FILES_ENCRYPTION_KEY/);
  });

  it("refuses short keys", () => {
    expect(() => keyFromSecret("too-short")).toThrow(/at least 32/);
  });

  it("sealForStorage encrypts when the key is configured; openFromStorage reverses it", () => {
    vi.stubEnv("FILES_ENCRYPTION_KEY", "c".repeat(40));
    const stored = sealForStorage(pdf);
    expect(isEncrypted(stored)).toBe(true);
    expect(openFromStorage(stored).equals(pdf)).toBe(true);
  });

  it("production without a key refuses to store a sensitive file unencrypted", () => {
    vi.stubEnv("FILES_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => sealForStorage(pdf)).toThrow(/FILES_ENCRYPTION_KEY is not set/);
  });
});
