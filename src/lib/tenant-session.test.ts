import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { secretKey, signSession, verifySession } from "./session";
import { TENANT_AUDIENCE, signTenantSession, tenantCookieOptions, tenantSessionKey, verifyTenantSession, TENANT_COOKIE } from "./tenant-session";
import { SESSION_COOKIE } from "./session";

const TENANT_ID = "64b7f0c2a1b2c3d4e5f60718";
const USER_ID = "64b7f0c2a1b2c3d4e5f60799";

describe("tenant vs admin sessions are separate", () => {
  it("a tenant token verifies as a tenant session", async () => {
    const t = await signTenantSession({ sub: TENANT_ID, ver: 3 });
    expect(await verifyTenantSession(t)).toEqual({ sub: TENANT_ID, ver: 3 });
  });

  it("the admin verifier rejects a tenant token", async () => {
    const t = await signTenantSession({ sub: TENANT_ID, ver: 0 });
    expect(await verifySession(t)).toBeNull();
  });

  it("the tenant verifier rejects an admin token", async () => {
    const admin = await signSession({ sub: USER_ID, name: "Admin", email: "a@b.c" });
    expect(await verifySession(admin)).not.toBeNull();
    expect(await verifyTenantSession(admin)).toBeNull();
  });

  it("the admin verifier rejects a token with a tenant audience even if signed with the admin key", async () => {
    const forged = await new SignJWT({ ver: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(TENANT_ID)
      .setAudience(TENANT_AUDIENCE)
      .setExpirationTime("1h")
      .sign(secretKey());
    expect(await verifySession(forged)).toBeNull();
  });

  it("the tenant verifier rejects a token signed with the tenant key but without the tenant audience", async () => {
    const noAud = await new SignJWT({ ver: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(TENANT_ID)
      .setIssuer("rentee")
      .setExpirationTime("1h")
      .sign(await tenantSessionKey());
    expect(await verifyTenantSession(noAud)).toBeNull();
  });

  it("the tenant key is derived, never the raw AUTH_SECRET", async () => {
    const k = await tenantSessionKey();
    expect(Buffer.from(k).equals(Buffer.from(secretKey()))).toBe(false);
    expect(k.length).toBe(32);
  });

  it("rejects tampered, expired, alg=none and malformed tokens", async () => {
    const t = await signTenantSession({ sub: TENANT_ID, ver: 1 });
    const [h, p, s] = t.split(".");
    const otherPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: USER_ID })).toString("base64url");
    expect(await verifyTenantSession(`${h}.${otherPayload}.${s}`)).toBeNull();
    const expired = await new SignJWT({ ver: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(TENANT_ID)
      .setAudience(TENANT_AUDIENCE)
      .setIssuer("rentee")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(await tenantSessionKey());
    expect(await verifyTenantSession(expired)).toBeNull();
    const none = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${p}.`;
    expect(await verifyTenantSession(none)).toBeNull();
    expect(await verifyTenantSession("garbage")).toBeNull();
    expect(await verifyTenantSession("")).toBeNull();
    expect(await verifyTenantSession(undefined)).toBeNull();
  });

  it("a token signed under another AUTH_SECRET is rejected", async () => {
    const other = new TextEncoder().encode("another-secret-another-secret-123456");
    const t = await signTenantSession({ sub: TENANT_ID, ver: 0 }, other);
    expect(await verifyTenantSession(t)).toBeNull();
    expect(await verifyTenantSession(t, other)).not.toBeNull();
  });

  it("refuses to sign bad ids / versions", async () => {
    await expect(signTenantSession({ sub: "not-an-id", ver: 0 })).rejects.toThrow();
    await expect(signTenantSession({ sub: TENANT_ID, ver: -1 })).rejects.toThrow();
  });

  it("uses its own cookie, limited to /portal", () => {
    expect(TENANT_COOKIE).not.toBe(SESSION_COOKIE);
    expect(tenantCookieOptions.path).toBe("/portal");
    expect(tenantCookieOptions.httpOnly).toBe(true);
    expect(tenantCookieOptions.sameSite).toBe("lax");
    expect(tenantCookieOptions.maxAge).toBe(60 * 60 * 24 * 30);
  });
});
