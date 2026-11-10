"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { saveFile } from "@/lib/file-store";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import { myRentals, notifyAdmins } from "@/lib/portal-data";
import { portalMaintenanceSchema } from "@/lib/portal-scope";
import { hitRateLimit } from "@/lib/rate-limit";
import { requireTenant } from "@/lib/tenant-auth";
import { parseForm, validateImage, type ActionState } from "@/lib/validation";
import { Maintenance } from "@/models/Maintenance";

/** New repair request from the tenant portal (only for a property the tenant currently rents). */
export async function createPortalMaintenance(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireTenant();
  const parsed = parseForm(portalMaintenanceSchema, fd);
  if (!parsed.success) return parsed.state;
  const { rentalId, title, description, priority } = parsed.data;

  // The rental must be one of MY current rentals (never trust the id alone).
  const rental = (await myRentals(me)).find((r) => r.id === rentalId && r.status === "active");
  if (!rental) return { ok: false, fieldErrors: { rentalId: ["Choose your current home"] }, values: parsed.values };

  const file = fd.get("photo");
  let photo: { bytes: Buffer; type: string } | null = null;
  if (file instanceof File && file.size > 0) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const err = validateImage({ type: file.type, size: file.size }, bytes.subarray(0, 12));
    if (err) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { photo: [err] }, values: parsed.values };
    photo = { bytes, type: file.type };
  }

  await connectDB();
  const limit = await hitRateLimit("portal-maintenance", me.tenantId, 10, 3600);
  if (!limit.allowed) return { ok: false, message: "You've sent a lot of requests in the last hour. Please try again later.", values: parsed.values };

  const photoId = photo ? await saveFile("maintenance", photo.bytes, { filename: `maintenance-${me.tenantId}`, contentType: photo.type }) : null;
  const created = await Maintenance.create({
    property: new Types.ObjectId(rental.propertyId),
    title,
    description,
    priority,
    status: "open",
    createdBy: "tenant",
    tenant: me.tenantOid,
    photo: photoId,
    photoType: photo?.type ?? null,
  });
  const id = String(created._id);
  await notifyAdmins({
    type: "maintenance_tenant_request",
    subjectId: id,
    title: `Repair request: ${rental.propertyName}`,
    body: `${me.name} reported "${title}" (${priority} priority)${photo ? " with a photo" : ""}.`,
    link: `/maintenance/${id}/edit`,
    tenantId: me.tenantId,
    propertyId: rental.propertyId,
    maintenanceId: id,
  });
  await syncNotificationsSafe({ scope: { maintenanceIds: [id] } });
  revalidatePath("/maintenance");
  revalidatePath("/portal/maintenance");
  redirect("/portal/maintenance?sent=1");
}
