import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { notificationFeed, syncNotificationsSafe } from "@/lib/notification-sync";
import { AppShell } from "@/components/shell";
import { logout } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Throttled (at most once per 5 minutes); keeps notifications current without a cron. Runs
  // after the response is sent so it never delays a page; the bell's 60 s poll picks up results.
  after(() => syncNotificationsSafe());
  const notifications = await notificationFeed().catch((err) => {
    console.error("[notifications] feed failed:", err);
    return { unread: 0, items: [], desktopEnabled: false, serverTime: new Date().toISOString() };
  });
  return (
    <AppShell user={{ name: user.name, email: user.email }} logout={logout} notifications={notifications}>
      {children}
    </AppShell>
  );
}
