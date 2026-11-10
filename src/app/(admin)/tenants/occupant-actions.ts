"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { MAX_OCCUPANTS, occupantSchema } from "@/lib/occupants";
import { parseForm, type ActionState } from "@/lib/validation";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";

const NOT_FOUND: ActionState = { ok: false, message: "Tenant not found." };

async function refresh(tenantId: string) {
  revalidatePath(`/tenants/${tenantId}`);
  // Occupants also show on the tenant's rental pages.
  const rentals = await Rental.find({ tenant: tenantId }).select("_id").lean();
  for (const r of rentals) revalidatePath(`/rentals/${String(r._id)}`);
}

export async function addOccupant(tenantId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(tenantId);
  if (!_id) return NOT_FOUND;
  const parsed = parseForm(occupantSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  // Only one emergency contact: adding a new one clears the others.
  if (parsed.data.emergency) await Tenant.updateOne({ _id }, { $set: { "occupants.$[].emergency": false } });
  const res = await Tenant.updateOne(
    { _id, [`occupants.${MAX_OCCUPANTS - 1}`]: { $exists: false } },
    { $push: { occupants: parsed.data } },
  );
  if (res.matchedCount === 0) {
    return (await Tenant.exists({ _id })) ? { ok: false, message: `A tenant can have at most ${MAX_OCCUPANTS} other occupants.` } : NOT_FOUND;
  }
  await refresh(tenantId);
  return { ok: true, message: `${parsed.data.name} added.` };
}

export async function updateOccupant(tenantId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(tenantId);
  const occupantId = asObjectId(String(fd.get("occupantId") ?? ""));
  if (!_id || !occupantId) return NOT_FOUND;
  const parsed = parseForm(occupantSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  if (parsed.data.emergency) await Tenant.updateOne({ _id }, { $set: { "occupants.$[].emergency": false } });
  const set = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [`occupants.$.${k}`, v]));
  const res = await Tenant.updateOne({ _id, "occupants._id": occupantId }, { $set: set });
  if (res.matchedCount === 0) return { ok: false, message: "Occupant not found." };
  await refresh(tenantId);
  return { ok: true, message: "Saved." };
}

export async function removeOccupant(tenantId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(tenantId);
  const occupantId = asObjectId(String(fd.get("occupantId") ?? ""));
  if (!_id || !occupantId) return NOT_FOUND;
  await connectDB();
  const res = await Tenant.updateOne({ _id }, { $pull: { occupants: { _id: occupantId } } });
  if (res.modifiedCount === 0) return { ok: false, message: "Occupant not found." };
  await refresh(tenantId);
  return { ok: true, message: "Removed." };
}
