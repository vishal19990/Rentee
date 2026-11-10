import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Types, isValidObjectId } from "mongoose";
import { connectDB } from "./db";
import { IP_MAX_FAILURES, afterFailure, clientIp, lockMinutesLeft, type Throttle } from "./login-throttle";
import { sessionStillValid, TENANT_MAX_FAILURES } from "./portal-auth";
import { TENANT_COOKIE, signTenantSession, tenantCookieOptions, verifyTenantSession } from "./tenant-session";
import { LoginThrottle } from "@/models/LoginThrottle";
import { Tenant } from "@/models/Tenant";

/**
 * Tenant portal authentication (server side). Tenants are never `User`s: the admin guard
 * (`requireUser`) can't be satisfied by a tenant, and `requireTenant` can't be satisfied by an admin.
 */
export type CurrentTenant = {
  /** Session tenant id: the ONLY id every portal query is scoped by. */
  tenantId: string;
  tenantOid: Types.ObjectId;
  name: string;
};

export async function createTenantSession(tenantId: string, sessionVersion: number): Promise<void> {
  const token = await signTenantSession({ sub: tenantId, ver: sessionVersion });
  (await cookies()).set(TENANT_COOKIE, token, tenantCookieOptions);
}

export async function destroyTenantSession(): Promise<void> {
  (await cookies()).set(TENANT_COOKIE, "", { ...tenantCookieOptions, maxAge: 0 });
}

/**
 * The signed-in tenant, re-checked against the database on every call: the tenant must exist,
 * have an enabled account with a password, and the token's version must still be current.
 */
export async function getCurrentTenant(): Promise<CurrentTenant | null> {
  const session = await verifyTenantSession((await cookies()).get(TENANT_COOKIE)?.value);
  if (!session || !isValidObjectId(session.sub)) return null;
  await connectDB();
  const t = await Tenant.findById(session.sub).select("name portal").lean();
  if (!t || !sessionStillValid(t.portal, session.ver)) return null;
  return { tenantId: String(t._id), tenantOid: t._id as Types.ObjectId, name: t.name };
}

/** Guard for every portal page and server action. Redirects to /portal/login when signed out. */
export async function requireTenant(): Promise<CurrentTenant> {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/portal/login");
  return tenant;
}

/* ---------- login throttle (same rules as the admin login, keyed by phone) ---------- */

export async function requestIp(): Promise<string> {
  const h = await headers();
  return clientIp(h.get("x-forwarded-for"), h.get("x-real-ip"));
}

export async function readThrottle(key: string): Promise<Throttle | null> {
  const t = await LoginThrottle.findOne({ key }).select("count firstAt lockedUntil").lean();
  return t ? { count: t.count, firstAt: t.firstAt, lockedUntil: t.lockedUntil ?? null } : null;
}

async function recordFailure(key: string, max: number, now: Date): Promise<void> {
  const next = afterFailure(await readThrottle(key), now, max);
  await LoginThrottle.updateOne({ key }, { $set: { ...next, updatedAt: now } }, { upsert: true });
}

export const tenantThrottleKeys = (phoneDigits: string, ip: string) => ({ phoneKey: `tenant:${phoneDigits}`, ipKey: `ip:${ip}` });

export async function throttleWait(phoneKey: string, ipKey: string, now: Date): Promise<number> {
  const [p, i] = await Promise.all([readThrottle(phoneKey), readThrottle(ipKey)]);
  return Math.max(lockMinutesLeft(p, now), lockMinutesLeft(i, now));
}

export async function recordTenantLoginFailure(phoneKey: string, ipKey: string, now: Date): Promise<number> {
  await Promise.all([recordFailure(phoneKey, TENANT_MAX_FAILURES, now), recordFailure(ipKey, IP_MAX_FAILURES, now)]);
  return lockMinutesLeft(await readThrottle(phoneKey), now);
}

export async function clearTenantThrottle(phoneKey: string): Promise<void> {
  await LoginThrottle.deleteOne({ key: phoneKey });
}
