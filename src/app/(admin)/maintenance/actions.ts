"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import { MAINTENANCE_STATUSES, maintenanceSchema, parseForm, type ActionState } from "@/lib/validation";
import { Maintenance } from "@/models/Maintenance";
import { Property } from "@/models/Property";

const NOT_FOUND: ActionState = { ok: false, message: "Request not found." };

function revalidateAll(propertyId?: string) {
  revalidatePath("/maintenance");
  revalidatePath("/dashboard");
  if (propertyId) revalidatePath(`/properties/${propertyId}`);
}

export async function createMaintenance(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(maintenanceSchema, fd);
  if (!parsed.success) return parsed.state;
  const { propertyId, ...data } = parsed.data;
  await connectDB();
  if (!(await Property.exists({ _id: propertyId }))) {
    return { ok: false, fieldErrors: { propertyId: ["Select a property"] }, values: parsed.values };
  }
  const created = await Maintenance.create({ property: propertyId, ...data });
  await syncNotificationsSafe({ scope: { maintenanceIds: [String(created._id)] } });
  revalidateAll(propertyId);
  redirect("/maintenance");
}

export async function updateMaintenance(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  const parsed = parseForm(maintenanceSchema, fd);
  if (!parsed.success) return parsed.state;
  const { propertyId, ...data } = parsed.data;
  await connectDB();
  if (!(await Property.exists({ _id: propertyId }))) {
    return { ok: false, fieldErrors: { propertyId: ["Select a property"] }, values: parsed.values };
  }
  const before = await Maintenance.findByIdAndUpdate(_id, { property: propertyId, ...data }).lean();
  if (!before) return NOT_FOUND;
  await syncNotificationsSafe({ scope: { maintenanceIds: [id] } });
  revalidateAll(propertyId);
  if (String(before.property) !== propertyId) revalidatePath(`/properties/${before.property}`);
  redirect("/maintenance");
}

/** Quick status change from the list (plain form action). */
export async function setMaintenanceStatus(id: string, status: string): Promise<void> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id || !(MAINTENANCE_STATUSES as readonly string[]).includes(status)) return;
  await connectDB();
  const doc = await Maintenance.findByIdAndUpdate(_id, { status }).lean();
  if (!doc) return;
  await syncNotificationsSafe({ scope: { maintenanceIds: [id] } });
  revalidateAll(String(doc.property));
}

export async function deleteMaintenance(id: string): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  await connectDB();
  const doc = await Maintenance.findByIdAndDelete(_id).lean();
  if (!doc) return NOT_FOUND;
  await syncNotificationsSafe({ scope: { maintenanceIds: [id] } });
  revalidateAll(String(doc.property));
  redirect("/maintenance");
}
