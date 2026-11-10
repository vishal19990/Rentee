"use server";

import { revalidatePath } from "next/cache";
import { appBaseUrl } from "@/lib/app-url";
import { requireUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { hashInviteToken, inviteExpiry, inviteMessage, inviteUrl, newInviteToken, NO_PHONE_FOR_INVITE } from "@/lib/portal-auth";
import { hitRateLimit } from "@/lib/rate-limit";
import { firstName } from "@/lib/receipts";
import type { ActionState } from "@/lib/validation";
import { normalizePhone, whatsappUrl } from "@/lib/whatsapp";
import { Tenant } from "@/models/Tenant";

/** Result of "Invite": the link exists only here (the database keeps just its hash). */
export type InviteState = ActionState & { link?: string; whatsapp?: string; expiresAt?: string };

/** Tenant page → Tenant portal → Invite / Send new invite: a 7-day, single-use set-password link. */
export async function inviteTenantToPortal(tenantId: string, _prev: InviteState, _fd: FormData): Promise<InviteState> {
  const user = await requireUser();
  const _id = asObjectId(tenantId);
  if (!_id) return { ok: false, message: "Tenant not found." };
  await connectDB();
  const limit = await hitRateLimit("portal-invite-create", user.id, 30, 3600);
  if (!limit.allowed) return { ok: false, message: "Too many invites in the last hour. Please try again later." };
  const t = await Tenant.findById(_id).select("name phone").lean();
  if (!t) return { ok: false, message: "Tenant not found." };
  const phone = normalizePhone(t.phone);
  if (!phone) return { ok: false, message: NO_PHONE_FOR_INVITE };
  if (await Tenant.exists({ "portal.loginPhone": phone, _id: { $ne: _id } })) {
    return { ok: false, message: "Another tenant's portal account already uses this phone number." };
  }

  const token = newInviteToken();
  const expiresAt = inviteExpiry();
  await Tenant.updateOne(
    { _id },
    { $set: { "portal.inviteTokenHash": hashInviteToken(token), "portal.inviteExpiresAt": expiresAt } },
  );
  const link = inviteUrl(await appBaseUrl(), token);
  revalidatePath(`/tenants/${tenantId}`);
  return {
    ok: true,
    message: "Invite link created. Send it to the tenant now — it is shown only once.",
    link,
    whatsapp: whatsappUrl(phone, inviteMessage(firstName(t.name), link)),
    expiresAt: expiresAt.toISOString(),
  };
}

/** Disable access: no new logins, every session ends (sessionVersion bump), pending invite cancelled. */
export async function disableTenantPortal(tenantId: string): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(tenantId);
  if (!_id) return { ok: false, message: "Tenant not found." };
  await connectDB();
  const res = await Tenant.updateOne(
    { _id, portal: { $exists: true } },
    { $set: { "portal.enabled": false, "portal.inviteTokenHash": null, "portal.inviteExpiresAt": null }, $inc: { "portal.sessionVersion": 1 } },
  );
  if (res.matchedCount === 0) return { ok: false, message: "No portal account." };
  revalidatePath(`/tenants/${tenantId}`);
  return { ok: true, message: "Portal access disabled." };
}

/** Enable access again (only for an account that has a password). Old sessions stay ended. */
export async function enableTenantPortal(tenantId: string): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(tenantId);
  if (!_id) return { ok: false, message: "Tenant not found." };
  await connectDB();
  const res = await Tenant.updateOne({ _id, "portal.passwordHash": { $type: "string" } }, { $set: { "portal.enabled": true } });
  if (res.matchedCount === 0) return { ok: false, message: "The tenant hasn't set a password yet. Send an invite instead." };
  revalidatePath(`/tenants/${tenantId}`);
  return { ok: true, message: "Portal access enabled." };
}
