"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import type { NotificationItem } from "@/lib/notification-sync";
import { Badge, EmptyState } from "@/components/ui";
import { CategoryIcon, EnableDesktopButton, TimeAgo, useNotifications } from "@/components/notifications";
import { WhatsAppReminderButton } from "@/components/whatsapp-button";
import { IconBell } from "@/components/icons";

const TYPE_LABEL: Record<string, string> = {
  rent_overdue: "Rent overdue",
  rent_due_soon: "Rent due soon",
  move_out_soon: "Moving out",
  maintenance_pending: "Maintenance",
  agreement_expiring: "Agreement ending",
  agreement_expired: "Agreement expired",
  enquiry_follow_up: "Enquiry follow-up",
  enquiry_visit: "Enquiry visit",
};

export function NotificationPageActions() {
  const { feed, markAllRead } = useNotifications();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EnableDesktopButton />
      <button type="button" className="btn btn-secondary" disabled={feed.unread === 0} onClick={() => void markAllRead()}>
        Mark all read
      </button>
    </div>
  );
}

export function NotificationList({ items, filter }: { items: NotificationItem[]; filter: string }) {
  const { markRead } = useNotifications();
  // Local read overrides so the list updates instantly.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  if (items.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<IconBell />}
          title={filter === "unread" ? "No unread notifications" : "No notifications"}
          description="Rentee checks for overdue rent, upcoming due dates, move-outs and pending repairs every few minutes."
        />
      </div>
    );
  }

  return (
    <ul className="card divide-y divide-slate-100 overflow-hidden">
      {items.map((item) => {
        const read = item.read || readIds.has(item.id);
        const mark = () => {
          setReadIds((s) => new Set(s).add(item.id));
          void markRead(item.id);
        };
        return (
          <li key={item.id} className={clsx("flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start", !read && !item.resolved && "bg-brand-50/40")}>
            <div className="flex min-w-0 flex-1 gap-3">
              <CategoryIcon item={item} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={item.link}
                    onClick={() => !read && mark()}
                    className={clsx("text-sm text-slate-900 hover:text-brand-700", !read && !item.resolved ? "font-semibold" : "font-medium")}
                  >
                    {item.title}
                  </Link>
                  <Badge tone={item.category === "alert" ? "rose" : "amber"}>{TYPE_LABEL[item.type] ?? item.type}</Badge>
                  {item.resolved && <Badge tone="emerald">Resolved</Badge>}
                </div>
                <p className={clsx("mt-0.5 text-sm", item.resolved ? "text-slate-400" : "text-slate-600")}>{item.body}</p>
                <TimeAgo iso={item.activeSince} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-11 sm:justify-end sm:pl-0">
              {item.reminder && <WhatsAppReminderButton {...item.reminder} />}
              {!read && !item.resolved && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={mark}>
                  Mark read
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
