/**
 * HMAC-signed tokens for the public, no-login pages:
 *   /r/<token>  rent receipt (one payment; does not expire)
 *   /p/<token>  UPI pay link (one rental; expires PAY_LINK_DAYS after it was made)
 *
 * Token = "<payload>.<signature>", where payload is a short dot-separated string and the
 * signature is HMAC-SHA256 (truncated to 128 bits, base64url) under a key derived from
 * AUTH_SECRET (domain-separated, so it is never the session-signing key itself).
 * Anything malformed, re-signed or altered fails verification; an expired pay link is reported
 * as "expired" only after its signature checks out.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { secretKey } from "./session";

export const PAY_LINK_DAYS = 45;

const DAY_MS = 86_400_000;
const SIG_BYTES = 16;
const OBJECT_ID = /^[a-f\d]{24}$/;

export type ReceiptLink = { kind: "receipt"; paymentId: string };
export type PayLink = {
  kind: "pay";
  rentalId: string;
  /** Last month (YYYY-MM) the link was made for, e.g. the month a "due soon" reminder covers. */
  through: string | null;
  /** Expiry as a UTC day number (days since 1970-01-01); valid through the end of that day. */
  expiresDay: number;
};
export type SignedLink = ReceiptLink | PayLink;

export type VerifyResult<T> = { ok: true; link: T } | { ok: false; reason: "invalid" | "expired" };

function linkKey(secret?: Uint8Array): Buffer {
  return createHmac("sha256", Buffer.from(secret ?? secretKey()))
    .update("rentee:signed-links:v1")
    .digest();
}

function sign(payload: string, secret?: Uint8Array): string {
  return createHmac("sha256", linkKey(secret)).update(payload).digest().subarray(0, SIG_BYTES).toString("base64url");
}

export function utcDay(now: Date = new Date()): number {
  return Math.floor(now.getTime() / DAY_MS);
}

function seal(payload: string, secret?: Uint8Array): string {
  return `${payload}.${sign(payload, secret)}`;
}

/** Splits and checks the signature; returns the payload parts or null. */
function open(token: string, secret?: Uint8Array): string[] | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const cut = token.lastIndexOf(".");
  if (cut <= 0) return null;
  const payload = token.slice(0, cut);
  const given = Buffer.from(token.slice(cut + 1), "base64url");
  const expected = Buffer.from(sign(payload, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  // Reject non-canonical encodings of the same bytes (keeps one token per link).
  if (token.slice(cut + 1) !== expected.toString("base64url")) return null;
  return payload.split(".");
}

export function signReceiptToken(paymentId: string, secret?: Uint8Array): string {
  if (!OBJECT_ID.test(paymentId)) throw new Error("Invalid payment id");
  return seal(`r.${paymentId}`, secret);
}

export function verifyReceiptToken(token: string, secret?: Uint8Array): VerifyResult<ReceiptLink> {
  const parts = open(token, secret);
  if (!parts || parts.length !== 2 || parts[0] !== "r" || !OBJECT_ID.test(parts[1])) return { ok: false, reason: "invalid" };
  return { ok: true, link: { kind: "receipt", paymentId: parts[1] } };
}

/**
 * Pay link for a rental. The expiry is a whole UTC day, so links made on the same day are
 * identical (a reminder's logged message matches the one that was opened).
 */
export function signPayToken(
  rentalId: string,
  opts: { through?: string | null; now?: Date; days?: number } = {},
  secret?: Uint8Array,
): string {
  if (!OBJECT_ID.test(rentalId)) throw new Error("Invalid rental id");
  const through = opts.through && /^\d{4}-\d{2}$/.test(opts.through) ? opts.through.replace("-", "") : "-";
  const expiresDay = utcDay(opts.now) + (opts.days ?? PAY_LINK_DAYS);
  return seal(`p.${rentalId}.${through}.${expiresDay.toString(36)}`, secret);
}

export function verifyPayToken(token: string, now: Date = new Date(), secret?: Uint8Array): VerifyResult<PayLink> {
  const parts = open(token, secret);
  if (!parts || parts.length !== 4 || parts[0] !== "p" || !OBJECT_ID.test(parts[1])) return { ok: false, reason: "invalid" };
  const [, rentalId, rawThrough, rawExp] = parts;
  let through: string | null = null;
  if (rawThrough !== "-") {
    if (!/^\d{6}$/.test(rawThrough)) return { ok: false, reason: "invalid" };
    through = `${rawThrough.slice(0, 4)}-${rawThrough.slice(4)}`;
  }
  if (!/^[0-9a-z]{1,8}$/.test(rawExp)) return { ok: false, reason: "invalid" };
  const expiresDay = parseInt(rawExp, 36);
  if (utcDay(now) > expiresDay) return { ok: false, reason: "expired" };
  return { ok: true, link: { kind: "pay", rentalId, through, expiresDay } };
}
