import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { listNotifications } from "@/lib/notification-sync";
import { Notification } from "@/models/Notification";
import { FilterTabs, PageHeader } from "@/components/ui";
import { NotificationList, NotificationPageActions } from "./notification-list";

export const metadata: Metadata = { title: "Notifications" };

const FILTERS = ["all", "unread", "alerts", "reminders"] as const;
type Filter = (typeof FILTERS)[number];

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireUser();
  const { filter: raw } = await searchParams;
  const filter: Filter = FILTERS.find((f) => f === raw) ?? "all";

  await connectDB();
  const [items, all, unread, alerts, reminders] = await Promise.all([
    listNotifications({ filter, limit: 200 }),
    Notification.countDocuments({}),
    Notification.countDocuments({ readAt: null, resolvedAt: null }),
    Notification.countDocuments({ category: "alert" }),
    Notification.countDocuments({ category: "reminder" }),
  ]);
  const counts: Record<Filter, number> = { all, unread, alerts, reminders };

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Alerts (overdue rent, pending repairs) and reminders (rent due soon, move-outs). Resolved items are kept for reference."
        actions={<NotificationPageActions />}
      />
      <FilterTabs
        active={filter}
        tabs={FILTERS.map((f) => ({
          key: f,
          label: f === "all" ? "All" : f[0].toUpperCase() + f.slice(1),
          href: f === "all" ? "/notifications" : `/notifications?filter=${f}`,
          count: counts[f],
        }))}
      />
      <NotificationList items={items} filter={filter} />
    </>
  );
}
