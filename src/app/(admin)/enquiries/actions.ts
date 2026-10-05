"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { phoneMatches, tenantsWithPhone, type PhoneMatches } from "@/lib/enquiry-data";
import {
  STATUS_LABEL,
  activitySchema,
  canDeleteEnquiry,
  closeWithOutcome,
  dateTimeFromLocal,
  enquirySchema,
  followUpSchema,
  isOpenStatus,
  moveToOpenStatus,
  outcomeSchema,
  parseEnquiryForm,
  phoneKey,
  reopen,
  samePhone,
  toLocalDateTimeInput,
  visitSchema,
  type ActivityKind,
  type EnquiryStatus,
  type TransitionResult,
} from "@/lib/enquiries";
import { dateFromISO, formatDate, formatDateTime } from "@/lib/format";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import { toISODate } from "@/lib/rent";
import { formValues, type ActionState } from "@/lib/validation";
import { Enquiry } from "@/models/Enquiry";
import { EnquiryActivity } from "@/models/EnquiryActivity";
import { Property } from "@/models/Property";
import { Tenant } from "@/models/Tenant";

const NOT_FOUND: ActionState = { ok: false, message: "Enquiry not found." };
const CHANGED: ActionState = { ok: false, message: "This enquiry was just changed elsewhere. Reload and try again." };

function revalidateEnquiry(id?: string, propertyIds: (string | null | undefined)[] = []) {
  revalidatePath("/enquiries");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/enquiries/${id}`);
  for (const p of propertyIds) if (p) revalidatePath(`/properties/${p}`);
}

async function logActivity(enquiryId: unknown, kind: ActivityKind, text: string, userId: string) {
  await EnquiryActivity.create({ enquiry: enquiryId, kind, text, at: new Date(), by: asObjectId(userId) });
}

async function afterChange(id: string, propertyIds: (string | null | undefined)[] = []) {
  await syncNotificationsSafe({ scope: { enquiryIds: [id] } });
  revalidateEnquiry(id, propertyIds);
}

function toDoc(data: ReturnType<typeof enquirySchema.parse>) {
  return {
    name: data.name,
    phone: data.phone,
    phoneKey: phoneKey(data.phone),
    email: data.email,
    property: data.propertyId,
    source: data.source,
    budget: data.budget,
    desiredMoveIn: data.desiredMoveIn ? dateFromISO(data.desiredMoveIn) : null,
    occupants: data.occupants,
    occupation: data.occupation,
    notes: data.notes,
  };
}

async function propertyMissing(propertyId: string | null): Promise<boolean> {
  return !!propertyId && !(await Property.exists({ _id: propertyId }));
}

/* ---------- create / edit / delete ---------- */

export async function createEnquiry(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const values = formValues(fd);
  const parsed = parseEnquiryForm(enquirySchema, values);
  if (!parsed.success) return parsed.state;
  const data = parsed.data;
  await connectDB();
  if (await propertyMissing(data.propertyId)) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { propertyId: ["Select a property"] }, values };
  }
  const doc = await Enquiry.create({
    ...toDoc(data),
    status: "new",
    followUpDate: data.followUpDate ? dateFromISO(data.followUpDate) : null,
    createdBy: asObjectId(user.id),
  });
  const id = toId(doc._id);
  await logActivity(
    doc._id,
    "status_change",
    `Enquiry created${data.followUpDate ? ` · follow-up ${formatDate(data.followUpDate)}` : ""}`,
    user.id,
  );
  await afterChange(id, [data.propertyId]);
  redirect(`/enquiries/${id}`);
}

const editSchema = enquirySchema.omit({ followUpDate: true });

export async function updateEnquiry(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  const values = formValues(fd);
  const parsed = parseEnquiryForm(editSchema, values);
  if (!parsed.success) return parsed.state;
  const data = parsed.data;
  await connectDB();
  if (await propertyMissing(data.propertyId)) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { propertyId: ["Select a property"] }, values };
  }
  const before = await Enquiry.findByIdAndUpdate(_id, toDoc({ ...data, followUpDate: null })).lean();
  if (!before) return NOT_FOUND;
  await afterChange(id, [data.propertyId, before.property ? toId(before.property) : null]);
  redirect(`/enquiries/${id}`);
}

/** Deletes a mistaken entry: only while `new` with nothing logged beyond its creation. */
export async function deleteEnquiry(id: string): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  await connectDB();
  const e = await Enquiry.findById(_id).select("status property").lean();
  if (!e) return NOT_FOUND;
  const activities = await EnquiryActivity.countDocuments({ enquiry: _id });
  if (!canDeleteEnquiry(e.status, activities)) {
    return { ok: false, message: "Only a new enquiry with no activity can be deleted. Close it with an outcome instead." };
  }
  const res = await Enquiry.deleteOne({ _id, status: "new" });
  if (res.deletedCount === 0) return CHANGED;
  await EnquiryActivity.deleteMany({ enquiry: _id });
  await afterChange(id, [e.property ? toId(e.property) : null]);
  redirect("/enquiries");
}

/* ---------- status ---------- */

async function applyTransition(
  id: string,
  userId: string,
  transition: (current: EnquiryStatus) => TransitionResult,
  extra: Record<string, unknown> = {},
): Promise<ActionState> {
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  await connectDB();
  const e = await Enquiry.findById(_id).select("status property").lean();
  if (!e) return NOT_FOUND;
  const t = transition(e.status as EnquiryStatus);
  if (!t.ok) return { ok: false, message: t.message };
  // Conditional on the status we read, so two concurrent changes can't both apply.
  const res = await Enquiry.updateOne({ _id, status: e.status }, { $set: { ...t.update, ...extra } });
  if (res.matchedCount === 0) return CHANGED;
  await logActivity(_id, "status_change", t.activity, userId);
  await afterChange(id, [e.property ? toId(e.property) : null]);
  return { ok: true, message: `Marked ${STATUS_LABEL[t.update.status].toLowerCase()}.` };
}

/** Open status -> another open status (bound: id, status). */
export async function setEnquiryStatus(id: string, status: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  return applyTransition(id, user.id, (current) => moveToOpenStatus(current, status));
}

/** Closes an open enquiry with an outcome (rejected / declined need a reason). */
export async function closeEnquiry(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const values = formValues(fd);
  const parsed = parseEnquiryForm(outcomeSchema, values);
  if (!parsed.success) return parsed.state;
  const now = new Date();
  return applyTransition(id, user.id, (current) => closeWithOutcome(current, parsed.data, now));
}

export async function reopenEnquiry(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await applyTransition(id, user.id, reopen);
  return res.ok ? { ok: true, message: "Reopened." } : res;
}

/* ---------- timeline, follow-up, visit ---------- */

export async function addEnquiryActivity(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  const values = formValues(fd);
  const parsed = parseEnquiryForm(activitySchema, values);
  if (!parsed.success) return parsed.state;
  await connectDB();
  if (!(await Enquiry.exists({ _id }))) return NOT_FOUND;
  await logActivity(_id, parsed.data.kind, parsed.data.text, user.id);
  revalidateEnquiry(id);
  return { ok: true, message: parsed.data.kind === "call" ? "Call logged." : "Note added." };
}

export async function setEnquiryFollowUp(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  const values = formValues(fd);
  const parsed = parseEnquiryForm(followUpSchema, values);
  if (!parsed.success) return parsed.state;
  const next = parsed.data.followUpDate;
  await connectDB();
  const e = await Enquiry.findById(_id).select("status followUpDate property").lean();
  if (!e) return NOT_FOUND;
  if (!isOpenStatus(e.status)) return { ok: false, message: "Reopen the enquiry to set a follow-up." };
  const current = e.followUpDate ? toISODate(e.followUpDate) : null;
  if (current === next) return { ok: true, message: "No change." };
  await Enquiry.updateOne({ _id }, { $set: { followUpDate: next ? dateFromISO(next) : null } });
  await logActivity(_id, "follow_up_set", next ? `Follow-up set for ${formatDate(next)}` : "Follow-up cleared", user.id);
  await afterChange(id, [e.property ? toId(e.property) : null]);
  return { ok: true, message: next ? `Follow-up set for ${formatDate(next)}.` : "Follow-up cleared." };
}

/** Sets or clears the visit. Scheduling a visit moves a new / contacted enquiry to "visit scheduled". */
export async function setEnquiryVisit(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  const values = formValues(fd);
  const parsed = parseEnquiryForm(visitSchema, values);
  if (!parsed.success) return parsed.state;
  const next = parsed.data.visitAt;
  await connectDB();
  const e = await Enquiry.findById(_id).select("status visitAt property").lean();
  if (!e) return NOT_FOUND;
  if (!isOpenStatus(e.status)) return { ok: false, message: "Reopen the enquiry to schedule a visit." };
  if (toLocalDateTimeInput(e.visitAt) === (next ?? "")) return { ok: true, message: "No change." };
  const visitAt = next ? dateTimeFromLocal(next) : null;
  const moveStatus = !!visitAt && (e.status === "new" || e.status === "contacted");
  const res = await Enquiry.updateOne(
    { _id, status: e.status },
    { $set: { visitAt, ...(moveStatus ? { status: "visit_scheduled" } : {}) } },
  );
  if (res.matchedCount === 0) return CHANGED;
  await logActivity(_id, "visit", visitAt ? `Visit scheduled for ${formatDateTime(visitAt)}` : "Visit cancelled", user.id);
  if (moveStatus) {
    await logActivity(_id, "status_change", `Status: ${STATUS_LABEL[e.status as EnquiryStatus]} → ${STATUS_LABEL.visit_scheduled}`, user.id);
  }
  await afterChange(id, [e.property ? toId(e.property) : null]);
  return { ok: true, message: visitAt ? `Visit scheduled for ${formatDateTime(visitAt)}.` : "Visit cancelled." };
}

/** Records that the admin opened a WhatsApp chat (nothing is sent automatically). */
export async function logEnquiryWhatsApp(id: string, message: string): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();
  const _id = asObjectId(id);
  if (!_id) return { ok: false, message: "Enquiry not found." };
  await connectDB();
  if (!(await Enquiry.exists({ _id }))) return { ok: false, message: "Enquiry not found." };
  await logActivity(_id, "whatsapp", `WhatsApp opened: ${String(message ?? "").slice(0, 1000)}`, user.id);
  revalidateEnquiry(id);
  return { ok: true };
}

/* ---------- duplicates & conversion ---------- */

/** Other enquiries / tenants with this phone, for the form's non-blocking warning. */
export async function checkEnquiryPhone(phone: string, excludeId?: string): Promise<PhoneMatches> {
  await requireUser();
  return phoneMatches(String(phone ?? "").slice(0, 40), excludeId && asObjectId(excludeId) ? excludeId : undefined);
}

/**
 * Converts an accepted enquiry into a tenant. `tenant` = "new" creates one (refused when a tenant
 * already has this phone, so no duplicate is made), or the id of a tenant with the same phone to
 * link (restored if archived). Then opens the new-rental form with tenant and property preselected.
 */
export async function convertEnquiry(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  const choice = String(fd.get("tenant") ?? "");
  await connectDB();
  const e = await Enquiry.findById(_id).lean();
  if (!e) return NOT_FOUND;
  if (e.status !== "accepted") return { ok: false, message: "Mark the enquiry accepted before converting it." };

  let tenantId: string;
  if (e.convertedTenant) {
    tenantId = toId(e.convertedTenant);
  } else {
    const matches = await tenantsWithPhone(e.phone);
    if (choice === "new") {
      if (matches.length) {
        return { ok: false, message: `${matches[0].name} already has this phone number. Link the existing tenant instead.` };
      }
      const t = await Tenant.create({
        name: e.name,
        phone: e.phone,
        email: e.email ?? "",
        notes: `From enquiry ${formatDate(toISODate(e.createdAt))}`,
      });
      tenantId = toId(t._id);
    } else {
      const tid = asObjectId(choice);
      const t = tid ? await Tenant.findById(tid).select("phone archived").lean() : null;
      if (!t || !samePhone(t.phone, e.phone)) return { ok: false, message: "Choose a tenant with the same phone number." };
      if (t.archived) await Tenant.updateOne({ _id: tid }, { $set: { archived: false } });
      tenantId = toId(tid);
    }
    const res = await Enquiry.updateOne({ _id, convertedTenant: null }, { $set: { convertedTenant: tenantId } });
    if (res.matchedCount === 0) return CHANGED;
    await logActivity(_id, "converted", choice === "new" ? "Converted: new tenant created" : "Converted: linked to existing tenant", user.id);
    revalidatePath("/tenants");
    revalidateEnquiry(id, [e.property ? toId(e.property) : null]);
  }
  const qs = new URLSearchParams({ tenant: tenantId });
  if (e.property) qs.set("property", toId(e.property));
  redirect(`/rentals/new?${qs.toString()}`);
}
