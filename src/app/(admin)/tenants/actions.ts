"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, syncRentalStatuses } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { parseForm, tenantSchema, type ActionState } from "@/lib/validation";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";

const NOT_FOUND: ActionState = { ok: false, message: "Tenant not found." };

export async function createTenant(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(tenantSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  const doc = await Tenant.create(parsed.data);
  revalidatePath("/tenants");
  redirect(`/tenants/${doc._id}`);
}

export async function updateTenant(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  const parsed = parseForm(tenantSchema, fd);
  if (!parsed.success) return parsed.state;
  await connectDB();
  const res = await Tenant.updateOne({ _id }, parsed.data);
  if (res.matchedCount === 0) return NOT_FOUND;
  revalidatePath("/tenants");
  redirect(`/tenants/${id}`);
}

export async function setTenantArchived(id: string, archived: boolean): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  await connectDB();
  await syncRentalStatuses();
  if (archived && (await Rental.exists({ tenant: _id, status: "active" }))) {
    return { ok: false, message: "Record this tenant's move-out before archiving." };
  }
  const res = await Tenant.updateOne({ _id }, { archived });
  if (res.matchedCount === 0) return NOT_FOUND;
  revalidatePath("/tenants");
  revalidatePath(`/tenants/${id}`);
  return { ok: true, message: archived ? "Tenant archived." : "Tenant restored." };
}

export async function deleteTenant(id: string): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  await connectDB();
  if (await Rental.exists({ tenant: _id })) {
    return { ok: false, message: "This tenant has rentals, so they can't be deleted. Archive instead." };
  }
  const res = await Tenant.deleteOne({ _id });
  if (res.deletedCount === 0) return NOT_FOUND;
  revalidatePath("/tenants");
  redirect("/tenants");
}
