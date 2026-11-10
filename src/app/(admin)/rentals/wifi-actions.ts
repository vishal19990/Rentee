"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { asObjectId, syncRentalStatuses } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import { formatMonth, payableMonths } from "@/lib/rent";
import { formValues, parseForm, type ActionState } from "@/lib/validation";
import { pickPeople, planAdd, planChange, planRemove, planStop, type PlanEdit, type WifiPerson, type WifiPlanRow } from "@/lib/wifi";
import { getWifiRate, loadWifiPlans } from "@/lib/wifi-store";
import { wifiAddSchema, wifiChangeSchema, wifiStopSchema } from "@/lib/wifi-validation";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";
import { WifiPlan } from "@/models/WifiPlan";

/** WiFi plans on a rental: add, change (from a month), stop, remove the latest. */

const NOT_FOUND: ActionState = { ok: false, message: "Rental not found." };

async function load(id: string) {
  const _id = asObjectId(id);
  if (!_id) return null;
  await connectDB();
  await syncRentalStatuses();
  const rental = await Rental.findById(_id).lean();
  if (!rental) return null;
  const plans = (await loadWifiPlans([_id])).get(id) ?? [];
  return { _id, rental, plans };
}

/** The people who can be ticked: the tenant and their current other occupants. */
async function allowedPeople(tenantId: unknown): Promise<WifiPerson[]> {
  const t = await Tenant.findById(tenantId).select("name occupants").lean();
  if (!t) return [];
  return [
    { kind: "tenant", occupantId: null, name: t.name },
    ...(t.occupants ?? []).map((o) => ({ kind: "occupant" as const, occupantId: String(o._id), name: o.name })),
  ];
}

async function apply(rentalId: Types.ObjectId, edit: Extract<PlanEdit, { ok: true }>) {
  const toDoc = (people: WifiPerson[]) =>
    people.map((p) => ({ kind: p.kind, occupantId: p.occupantId ? new Types.ObjectId(p.occupantId) : null, name: p.name }));
  for (const u of edit.update) {
    const set: Record<string, unknown> = { ...u.set };
    if (u.set.people) set.people = toDoc(u.set.people);
    await WifiPlan.updateOne({ _id: u.id, rental: rentalId }, { $set: set });
  }
  for (const c of edit.create) await WifiPlan.create({ rental: rentalId, ...c, people: toDoc(c.people) });
  if (edit.remove.length) await WifiPlan.deleteMany({ _id: { $in: edit.remove }, rental: rentalId });
}

async function finish(id: string, rental: { property: unknown; tenant: unknown }, edit: PlanEdit, values: Record<string, string>): Promise<ActionState> {
  if (!edit.ok) return { ok: false, message: edit.message, fieldErrors: { [edit.field]: [edit.message] }, values };
  await apply(new Types.ObjectId(id), edit);
  await syncNotificationsSafe({ scope: { rentalIds: [id] } });
  revalidatePath(`/rentals/${id}`);
  revalidatePath("/rentals");
  revalidatePath("/dashboard");
  revalidatePath("/payments/new");
  revalidatePath(`/properties/${String(rental.property)}`);
  revalidatePath(`/tenants/${String(rental.tenant)}`);
  return { ok: true, message: edit.message };
}

function bounds(rental: Parameters<typeof payableMonths>[0]) {
  const { first, last } = payableMonths(rental);
  return { firstMonth: first, lastMonth: last };
}

export async function addWifiPlan(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const found = await load(id);
  if (!found) return NOT_FOUND;
  const parsed = parseForm(wifiAddSchema, fd);
  if (!parsed.success) return parsed.state;
  const people = pickPeople(await allowedPeople(found.rental.tenant), parsed.values);
  const edit = planAdd(
    found.plans,
    { fromMonth: parsed.data.fromMonth, people, ratePerPerson: await getWifiRate() },
    bounds(found.rental),
    formatMonth,
  );
  return finish(id, found.rental, edit, parsed.values);
}

export async function changeWifiPlan(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const found = await load(id);
  if (!found) return NOT_FOUND;
  const parsed = parseForm(wifiChangeSchema, fd);
  if (!parsed.success) return parsed.state;
  const people = pickPeople(await allowedPeople(found.rental.tenant), parsed.values);
  const edit = planChange(
    found.plans,
    parsed.data.planId,
    { effectiveMonth: parsed.data.effectiveMonth, people, ratePerPerson: await getWifiRate() },
    bounds(found.rental),
    formatMonth,
  );
  return finish(id, found.rental, edit, parsed.values);
}

export async function stopWifiPlan(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const found = await load(id);
  if (!found) return NOT_FOUND;
  const parsed = parseForm(wifiStopSchema, fd);
  if (!parsed.success) return parsed.state;
  const edit = planStop(found.plans, parsed.data.planId, parsed.data.stopMonth, formatMonth);
  return finish(id, found.rental, edit, parsed.values);
}

export async function removeWifiPlan(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const found = await load(id);
  if (!found) return NOT_FOUND;
  const edit = planRemove(found.plans as WifiPlanRow[], String(fd.get("planId") ?? ""));
  const state = await finish(id, found.rental, edit, formValues(fd));
  return state.ok ? state : { ok: false, message: state.message };
}
