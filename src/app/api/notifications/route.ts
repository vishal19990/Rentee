import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { notificationFeed, syncNotificationsSafe } from "@/lib/notification-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Poll endpoint for the bell and desktop notifications (every 60 s from open admin tabs).
 * Also triggers the throttled notification sync (at most once per 5 minutes).
 */
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await syncNotificationsSafe();
  const feed = await notificationFeed();
  return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
}
