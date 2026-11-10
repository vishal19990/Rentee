"use server";

import { revalidatePath } from "next/cache";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { MAX_OCCUPANTS, occupantSchema } from "@/lib/occupants";
import { newPasswordSchema } from "@/lib/portal-auth";
import { notifyAdmins } from "@/lib/portal-data";
import { CHANGE_FIELD_LABELS, describeOccupant, portalEmailSchema, portalPhoneSchema, type ChangeField } from "@/lib/portal-scope";
import { hitRateLimit } from "@/lib/rate-limit";
import { createTenantSession, requireTenant, type CurrentTenant } from "@/lib/tenant-auth";
import { fieldErrorsOf, parseForm, type ActionState } from "@/lib/validation";
import { normalizePhone } from "@/lib/whatsapp";
import { Tenant } from "@/models/Tenant";
import { TenantChangeLog } from "@/models/TenantChangeLog";

/*
 * Profile changes from the tenant portal. The tenant is ALWAYS the session tenant (never an id
 * from the form); occupant ids from the form are only matched inside that tenant's own record.
 * Every change is logged (TenantChangeLog) and raises an admin notification.
 */

async function recordChange(me: CurrentTenant, field: ChangeField, from: string, to: string): Promise<void> {
  const log = await TenantChangeLog.create({ tenant: me.tenantOid, field, from, to, at: new Date() });
  const body = field === "password" ? "Changed their portal password." : `${CHANGE_FIELD_LABELS[field]}: ${from || "—"} → ${to || "—"}`;
  await notifyAdmins({
    type: "tenant_details_changed",
    subjectId: String(log._id),
    title: `${me.name} updated their details`,
    body,
    link: `/tenants/${me.tenantId}`,
    tenantId: me.tenantId,
  });
  revalidatePath(`/tenants/${me.tenantId}`);
  revalidatePath("/portal/profile");
}

export async function updatePortalPhone(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireTenant();
  const parsed = parseForm(portalPhoneSchema, fd);
  if (!parsed.success) return parsed.state;
  const phone = parsed.data.phone;
  const digits = normalizePhone(phone);
  if (!digits) return { ok: false, fieldErrors: { phone: ["Enter a valid mobile number (WhatsApp)"] }, values: parsed.values };
  await connectDB();
  const before = await Tenant.findById(me.tenantOid).select("phone portal.loginPhone").lean();
  if (!before) return { ok: false, message: "Account not found." };
  if (before.phone === phone && before.portal?.loginPhone === digits) return { ok: true, message: "No changes." };
  if (await Tenant.exists({ "portal.loginPhone": digits, _id: { $ne: me.tenantOid } })) {
    return { ok: false, fieldErrors: { phone: ["This number is already used by another account"] }, values: parsed.values };
  }
  try {
    await Tenant.updateOne({ _id: me.tenantOid }, { $set: { phone, "portal.loginPhone": digits } });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return { ok: false, fieldErrors: { phone: ["This number is already used by another account"] }, values: parsed.values };
    }
    throw err;
  }
  await recordChange(me, "phone", before.phone, phone);
  return { ok: true, message: "Phone saved. Use it to sign in from now on." };
}

export async function updatePortalEmail(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireTenant();
  const parsed = parseForm(portalEmailSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  const before = await Tenant.findById(me.tenantOid).select("email").lean();
  if (!before) return { ok: false, message: "Account not found." };
  if ((before.email ?? "") === parsed.data.email) return { ok: true, message: "No changes." };
  await Tenant.updateOne({ _id: me.tenantOid }, { $set: { email: parsed.data.email } });
  await recordChange(me, "email", before.email ?? "", parsed.data.email);
  return { ok: true, message: "Email saved." };
}

type OccupantLike = { _id?: unknown; name: string; relation: string; phone?: string; idLast4?: string; emergency?: boolean; notes?: string };

export async function addPortalOccupant(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireTenant();
  const parsed = parseForm(occupantSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  if (parsed.data.emergency) await Tenant.updateOne({ _id: me.tenantOid }, { $set: { "occupants.$[].emergency": false } });
  const res = await Tenant.updateOne(
    { _id: me.tenantOid, [`occupants.${MAX_OCCUPANTS - 1}`]: { $exists: false } },
    { $push: { occupants: parsed.data } },
  );
  if (res.matchedCount === 0) return { ok: false, message: `You can add at most ${MAX_OCCUPANTS} people.` };
  await recordChange(me, "occupant_added", "", describeOccupant(parsed.data));
  return { ok: true, message: `${parsed.data.name} added.` };
}

function findOccupant(list: unknown, id: string): OccupantLike | null {
  const arr = Array.isArray(list) ? (list as OccupantLike[]) : [];
  return arr.find((o) => String(o._id) === id) ?? null;
}

export async function updatePortalOccupant(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireTenant();
  const occupantId = String(fd.get("occupantId") ?? "");
  if (!/^[a-f\d]{24}$/i.test(occupantId)) return { ok: false, message: "Person not found." };
  const parsed = parseForm(occupantSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  const t = await Tenant.findOne({ _id: me.tenantOid, "occupants._id": occupantId }).select("occupants").lean();
  const before = t ? findOccupant(t.occupants, occupantId) : null;
  if (!before) return { ok: false, message: "Person not found." };
  if (parsed.data.emergency) await Tenant.updateOne({ _id: me.tenantOid }, { $set: { "occupants.$[].emergency": false } });
  const set = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [`occupants.$.${k}`, v]));
  const res = await Tenant.updateOne({ _id: me.tenantOid, "occupants._id": occupantId }, { $set: set });
  if (res.matchedCount === 0) return { ok: false, message: "Person not found." };
  const from = describeOccupant(before);
  const to = describeOccupant(parsed.data);
  if (from !== to || (before.notes ?? "") !== parsed.data.notes) await recordChange(me, "occupant_updated", from, to);
  return { ok: true, message: "Saved." };
}

export async function removePortalOccupant(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireTenant();
  const occupantId = String(fd.get("occupantId") ?? "");
  if (!/^[a-f\d]{24}$/i.test(occupantId)) return { ok: false, message: "Person not found." };
  await connectDB();
  const t = await Tenant.findOne({ _id: me.tenantOid, "occupants._id": occupantId }).select("occupants").lean();
  const before = t ? findOccupant(t.occupants, occupantId) : null;
  if (!before) return { ok: false, message: "Person not found." };
  const res = await Tenant.updateOne({ _id: me.tenantOid }, { $pull: { occupants: { _id: occupantId } } });
  if (res.modifiedCount === 0) return { ok: false, message: "Person not found." };
  await recordChange(me, "occupant_removed", describeOccupant(before), "");
  return { ok: true, message: "Removed." };
}

export async function changePortalPassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireTenant();
  await connectDB();
  const limit = await hitRateLimit("portal-password", me.tenantId, 10, 900);
  if (!limit.allowed) return { ok: false, message: "Too many attempts. Please try again later." };
  const t = await Tenant.findById(me.tenantOid).select("portal").lean();
  if (!t?.portal?.passwordHash) return { ok: false, message: "Account not found." };
  const current = String(fd.get("currentPassword") ?? "");
  if (!(await verifyPassword(current, t.portal.passwordHash))) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { currentPassword: ["Current password is incorrect"] } };
  }
  const parsed = newPasswordSchema(t.portal.loginPhone ?? null).safeParse({
    password: String(fd.get("password") ?? ""),
    confirmPassword: String(fd.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  const updated = await Tenant.findOneAndUpdate(
    { _id: me.tenantOid, "portal.passwordHash": t.portal.passwordHash },
    { $set: { "portal.passwordHash": await hashPassword(parsed.data.password) }, $inc: { "portal.sessionVersion": 1 } },
    { new: true },
  )
    .select("portal.sessionVersion")
    .lean();
  if (!updated?.portal) return { ok: false, message: "Your password changed meanwhile. Please try again." };
  // Signs out every other device; this one gets a fresh session.
  await createTenantSession(me.tenantId, updated.portal.sessionVersion ?? 0);
  await recordChange(me, "password", "", "");
  return { ok: true, message: "Password changed. Other devices have been signed out." };
}
