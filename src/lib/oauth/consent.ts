import "server-only";
import { createHmac } from "node:crypto";
import { secretKey } from "../session";
import { safeEqual, type AuthorizeParams } from "./core";

/**
 * CSRF token for the consent form: HMAC (key derived from AUTH_SECRET, domain-separated) over the
 * signed-in admin, the exact authorization request and the time it was shown. Valid 10 minutes.
 */
const MAX_AGE_MS = 10 * 60 * 1000;

function key(): Buffer {
  return createHmac("sha256", Buffer.from(secretKey())).update("rentee:oauth-consent:v1").digest();
}

function canonical(p: AuthorizeParams): string {
  return JSON.stringify([p.clientId, p.redirectUri, p.responseType, p.codeChallenge, p.codeChallengeMethod, p.state, p.scope, p.resource]);
}

function sign(userId: string, p: AuthorizeParams, issuedAt: number): string {
  return createHmac("sha256", key()).update(`${userId}|${issuedAt}|${canonical(p)}`).digest("base64url");
}

export function consentToken(userId: string, p: AuthorizeParams, now = Date.now()): string {
  return `${now}.${sign(userId, p, now)}`;
}

export function verifyConsentToken(token: string, userId: string, p: AuthorizeParams, now = Date.now()): boolean {
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(token ?? "");
  if (!m) return false;
  const issuedAt = Number(m[1]);
  if (!(now - issuedAt >= 0 && now - issuedAt <= MAX_AGE_MS)) return false;
  return safeEqual(m[2], sign(userId, p, issuedAt));
}
