/**
 * Tenant portal session tokens. Edge-safe (used by middleware): only `jose` + Web Crypto.
 *
 * Kept strictly apart from the admin session (lib/session.ts):
 *   - its own cookie (`rentee_tenant`, never `rentee_session`);
 *   - its own signing key, derived from AUTH_SECRET with a distinct purpose label, so an admin
 *     token never verifies here and a tenant token never verifies as an admin session;
 *   - an audience claim (`rentee:tenant`) checked on verify.
 * Payload: `sub` = tenant id, `ver` = the tenant's portal.sessionVersion (bumped on disable,
 * password change and invite acceptance, which ends every older session). Every portal request
 * also re-checks the tenant in the database (lib/tenant-auth.ts).
 */
import { SignJWT, jwtVerify } from "jose";
import { secretKey } from "./session";

export const TENANT_COOKIE = "rentee_tenant";
export const TENANT_SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
export const TENANT_AUDIENCE = "rentee:tenant";
export const TENANT_ISSUER = "rentee";

export type TenantSessionPayload = { sub: string; ver: number };

const PURPOSE = "rentee:tenant-session:v1";
const OBJECT_ID = /^[a-f\d]{24}$/;

/** HMAC-SHA256(AUTH_SECRET-derived secret, purpose): a key used only for tenant sessions. */
export async function tenantSessionKey(secret: Uint8Array = secretKey()): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", secret as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(PURPOSE)));
}

export async function signTenantSession(payload: TenantSessionPayload, secret?: Uint8Array): Promise<string> {
  if (!OBJECT_ID.test(payload.sub)) throw new Error("Invalid tenant id");
  if (!Number.isInteger(payload.ver) || payload.ver < 0) throw new Error("Invalid session version");
  return new SignJWT({ ver: payload.ver })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setAudience(TENANT_AUDIENCE)
    .setIssuer(TENANT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${TENANT_SESSION_MAX_AGE}s`)
    .sign(await tenantSessionKey(secret));
}

export async function verifyTenantSession(token: string | undefined | null, secret?: Uint8Array): Promise<TenantSessionPayload | null> {
  if (!token || token.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(token, await tenantSessionKey(secret), {
      algorithms: ["HS256"],
      audience: TENANT_AUDIENCE,
      issuer: TENANT_ISSUER,
    });
    if (typeof payload.sub !== "string" || !OBJECT_ID.test(payload.sub)) return null;
    if (typeof payload.ver !== "number" || !Number.isInteger(payload.ver) || payload.ver < 0) return null;
    return { sub: payload.sub, ver: payload.ver };
  } catch {
    return null;
  }
}

export const tenantCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  // Only ever sent to portal pages and portal file routes, never to admin URLs.
  path: "/portal",
  maxAge: TENANT_SESSION_MAX_AGE,
};
