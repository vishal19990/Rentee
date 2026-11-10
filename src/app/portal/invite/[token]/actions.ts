"use server";

import { redirect } from "next/navigation";
import { hashPassword } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { hashInviteToken, isInviteTokenShape, newPasswordSchema } from "@/lib/portal-auth";
import { hitRateLimit } from "@/lib/rate-limit";
import { createTenantSession, requestIp } from "@/lib/tenant-auth";
import { fieldErrorsOf, type ActionState } from "@/lib/validation";
import { normalizePhone } from "@/lib/whatsapp";
import { Tenant } from "@/models/Tenant";

const INVALID: ActionState = { ok: false, message: "This link is invalid, expired or already used. Ask your landlord for a new link." };

/** Set-password form on /portal/invite/<token>: activates the account and signs the tenant in. */
export async function acceptInvite(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!isInviteTokenShape(token)) return INVALID;
  await connectDB();
  const limit = await hitRateLimit("portal-invite", await requestIp(), 10);
  if (!limit.allowed) return { ok: false, message: `Too many attempts. Please wait ${limit.retryAfterSec} seconds and try again.` };

  const now = new Date();
  const tokenHash = hashInviteToken(token);
  const live = { "portal.inviteTokenHash": tokenHash, "portal.inviteExpiresAt": { $gt: now } };
  const tenant = await Tenant.findOne(live).select("phone").lean();
  if (!tenant) return INVALID;
  const loginPhone = normalizePhone(tenant.phone);
  if (!loginPhone) return { ok: false, message: "Your landlord needs to add your phone number first." };

  const parsed = newPasswordSchema(loginPhone).safeParse({
    password: String(fd.get("password") ?? ""),
    confirmPassword: String(fd.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };

  if (await Tenant.exists({ "portal.loginPhone": loginPhone, _id: { $ne: tenant._id } })) {
    return { ok: false, message: "This phone number is already used by another tenant account. Ask your landlord." };
  }
  const passwordHash = await hashPassword(parsed.data.password);
  let updated;
  try {
    // Single use: only succeeds while the token is still the live one.
    updated = await Tenant.findOneAndUpdate(
      { _id: tenant._id, ...live },
      {
        $set: {
          "portal.passwordHash": passwordHash,
          "portal.loginPhone": loginPhone,
          "portal.enabled": true,
          "portal.inviteTokenHash": null,
          "portal.inviteExpiresAt": null,
          "portal.lastLoginAt": now,
        },
        // Ends any older sessions (e.g. a password reset through a new invite).
        $inc: { "portal.sessionVersion": 1 },
      },
      { new: true },
    )
      .select("portal")
      .lean();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return { ok: false, message: "This phone number is already used by another tenant account. Ask your landlord." };
    }
    throw err;
  }
  if (!updated?.portal) return INVALID;
  await createTenantSession(String(tenant._id), updated.portal.sessionVersion ?? 0);
  redirect("/portal");
}
