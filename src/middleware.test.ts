import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";
import { SESSION_COOKIE, signSession } from "./lib/session";
import { TENANT_COOKIE, signTenantSession } from "./lib/tenant-session";

const TENANT_ID = "64b7f0c2a1b2c3d4e5f60718";

async function hit(path: string, cookies: Record<string, string> = {}, method = "GET") {
  const req = new NextRequest(`http://localhost${path}`, {
    method,
    headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
  });
  const res = await middleware(req);
  return { status: res.status, location: res.headers.get("location"), next: res.headers.get("x-middleware-next") === "1" };
}

describe("middleware: tenant and admin sessions never cross", () => {
  it("a tenant cookie does not open admin pages (redirect to /login)", async () => {
    const t = await signTenantSession({ sub: TENANT_ID, ver: 0 });
    for (const path of ["/dashboard", "/tenants", "/settings", "/payments"]) {
      const r = await hit(path, { [TENANT_COOKIE]: t });
      expect(r.status).toBe(307);
      expect(new URL(r.location!).pathname).toBe("/login");
    }
  });

  it("a tenant token placed in the admin cookie is rejected too", async () => {
    const t = await signTenantSession({ sub: TENANT_ID, ver: 0 });
    const r = await hit("/dashboard", { [SESSION_COOKIE]: t });
    expect(new URL(r.location!).pathname).toBe("/login");
    expect((await hit("/api/notifications", { [SESSION_COOKIE]: t })).status).toBe(401);
  });

  it("a tenant cookie gets 401 on admin APIs", async () => {
    const t = await signTenantSession({ sub: TENANT_ID, ver: 0 });
    for (const path of ["/api/notifications", "/api/receipts/64b7f0c2a1b2c3d4e5f60718", "/api/documents/64b7f0c2a1b2c3d4e5f60718", "/api/reports/ledger"]) {
      expect((await hit(path, { [TENANT_COOKIE]: t })).status).toBe(401);
    }
  });

  it("portal pages need a tenant session; an admin session doesn't count", async () => {
    const admin = await signSession({ sub: "64b7f0c2a1b2c3d4e5f60799", name: "A", email: "a@b.c" });
    for (const path of ["/portal", "/portal/payments", "/portal/profile"]) {
      const none = await hit(path);
      expect(new URL(none.location!).pathname).toBe("/portal/login");
      const asAdmin = await hit(path, { [SESSION_COOKIE]: admin });
      expect(new URL(asAdmin.location!).pathname).toBe("/portal/login");
    }
    expect((await hit("/portal/api/receipts/64b7f0c2a1b2c3d4e5f60718", { [SESSION_COOKIE]: admin })).status).toBe(401);
    // An admin token copied into the tenant cookie is not a tenant session either.
    expect((await hit("/portal/payments", { [TENANT_COOKIE]: admin })).location).toContain("/portal/login");
  });

  it("portal login and invite pages are public; valid tenant cookie passes to portal pages", async () => {
    expect((await hit("/portal/login")).next).toBe(true);
    expect((await hit("/portal/invite/abc")).next).toBe(true);
    const t = await signTenantSession({ sub: TENANT_ID, ver: 0 });
    expect((await hit("/portal/payments", { [TENANT_COOKIE]: t })).next).toBe(true);
  });

  it("a path that merely starts with 'portal' is not the portal", async () => {
    const t = await signTenantSession({ sub: TENANT_ID, ver: 0 });
    expect(new URL((await hit("/portalx", { [TENANT_COOKIE]: t })).location!).pathname).toBe("/login");
  });
});
