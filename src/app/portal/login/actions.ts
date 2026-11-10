"use server";

import { redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { lockedMessage } from "@/lib/login-throttle";
import { INVALID_LOGIN, portalLoginSchema } from "@/lib/portal-auth";
import { hitRateLimit } from "@/lib/rate-limit";
import {
  clearTenantThrottle,
  createTenantSession,
  destroyTenantSession,
  recordTenantLoginFailure,
  requestIp,
  tenantThrottleKeys,
  throttleWait,
} from "@/lib/tenant-auth";
import { TURNSTILE_FIELD, TURNSTILE_MESSAGES, turnstileSiteKey, verifyTurnstile } from "@/lib/turnstile";
import { parseForm, type ActionState } from "@/lib/validation";
import { normalizePhone } from "@/lib/whatsapp";
import { Tenant } from "@/models/Tenant";

// bcrypt hash of a random string: compared against when the phone has no account, so response
// time does not reveal which phone numbers have one.
const DUMMY_HASH = "$2b$12$jPKY.uKnjDsaERrJK0ENDOaKSThUVufnTm7JAPCGHDK54NWH.Omeq";

/** Per IP, per minute, on the portal login POST (on top of the failure lockout). */
const LOGIN_REQUESTS_PER_MINUTE = 20;

export async function tenantLogin(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = parseForm(portalLoginSchema, fd);
  if (!parsed.success) return { ...parsed.state, values: { phone: parsed.state.values?.phone ?? "" } };
  const { phone: rawPhone, password } = parsed.data;
  const values = { phone: rawPhone };

  await connectDB();
  const ip = await requestIp();
  const limit = await hitRateLimit("portal-login", ip, LOGIN_REQUESTS_PER_MINUTE);
  if (!limit.allowed) return { ok: false, message: `Too many attempts. Please wait ${limit.retryAfterSec} seconds and try again.`, values };

  const now = new Date();
  // Unparseable numbers still count against the IP and a stable key, and get the same answer.
  const phone = normalizePhone(rawPhone) ?? `invalid:${rawPhone.replace(/\D/g, "").slice(0, 20)}`;
  const { phoneKey, ipKey } = tenantThrottleKeys(phone, ip);
  const wait = await throttleWait(phoneKey, ipKey, now);
  if (wait > 0) return { ok: false, message: lockedMessage(wait), values };

  if (turnstileSiteKey()) {
    const check = await verifyTurnstile(String(fd.get(TURNSTILE_FIELD) ?? ""), ip);
    if (!check.ok) return { ok: false, message: TURNSTILE_MESSAGES[check.reason], values };
  }

  const tenant = await Tenant.findOne({ "portal.loginPhone": phone }).select("portal").lean();
  const account = tenant?.portal;
  const usable = !!account?.passwordHash && account.enabled === true;
  // Always run one bcrypt compare (constant-time path whether or not the account exists).
  const ok = await verifyPassword(password, usable ? account!.passwordHash! : DUMMY_HASH);
  if (!tenant || !usable || !ok) {
    const locked = await recordTenantLoginFailure(phoneKey, ipKey, now);
    return { ok: false, message: locked > 0 ? lockedMessage(locked) : INVALID_LOGIN, values };
  }

  await clearTenantThrottle(phoneKey);
  await Tenant.updateOne({ _id: tenant._id }, { $set: { "portal.lastLoginAt": now } });
  await createTenantSession(String(tenant._id), account!.sessionVersion ?? 0);
  redirect("/portal");
}

export async function tenantLogout(): Promise<void> {
  await destroyTenantSession();
  redirect("/portal/login");
}
