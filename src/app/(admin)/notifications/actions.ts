"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { unreadNotificationCount } from "@/lib/notification-sync";
import { Notification } from "@/models/Notification";

/** Read state is shared across admins (single-landlord use). Returns the new unread count. */
export async function markNotificationRead(id: string): Promise<number> {
  await requireUser();
  const _id = asObjectId(id);
  await connectDB();
  if (_id) await Notification.updateOne({ _id, readAt: null }, { $set: { readAt: new Date() } });
  revalidatePath("/notifications");
  return unreadNotificationCount();
}

export async function markAllNotificationsRead(): Promise<number> {
  await requireUser();
  await connectDB();
  await Notification.updateMany({ readAt: null }, { $set: { readAt: new Date() } });
  revalidatePath("/notifications");
  return unreadNotificationCount();
}
