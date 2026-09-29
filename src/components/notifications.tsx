"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { relativeTime } from "@/lib/format";
import type { NotificationFeed, NotificationItem } from "@/lib/notification-sync";
import { markAllNotificationsRead, markNotificationRead } from "@/app/(admin)/notifications/actions";
import { IconAlert, IconBell, IconCalendar, IconCheck } from "./icons";
import { WhatsAppReminderButton } from "./whatsapp-button";

const POLL_MS = 60_000;
const LAST_SEEN_KEY = "rentee:notifications:lastSeen";

type Permission = NotificationPermission | "unsupported";

type Ctx = {
  feed: NotificationFeed;
  permission: Permission;
  enableDesktop: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
};

const NotificationsCtx = createContext<Ctx | null>(null);

export function useNotifications(): Ctx {
  const ctx = useContext(NotificationsCtx);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationsProvider>");
  return ctx;
}

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}
function writeLastSeen(v: string) {
  try {
    localStorage.setItem(LAST_SEEN_KEY, v);
  } catch {
    /* storage unavailable: desktop alerts may repeat, nothing else breaks */
  }
}

/**
 * Holds the bell's feed, polls /api/notifications every 60 s, and — only after the admin clicked
 * "Enable desktop notifications" and granted permission — shows a desktop notification for items
 * created since the last poll (tracked per browser in localStorage, shared by all tabs).
 */
export function NotificationsProvider({ initialFeed, children }: { initialFeed: NotificationFeed; children: ReactNode }) {
  const router = useRouter();
  const [feed, setFeed] = useState(initialFeed);
  const [permission, setPermission] = useState<Permission>("default");
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => setFeed(initialFeed), [initialFeed]);
  useEffect(() => {
    setPermission(typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "unsupported");
  }, []);

  const showDesktop = useCallback((f: NotificationFeed) => {
    if (!f.desktopEnabled || !("Notification" in window) || window.Notification.permission !== "granted") return;
    const lastSeen = readLastSeen();
    if (!lastSeen) {
      // First run in this browser: only announce things that appear from now on.
      writeLastSeen(f.serverTime);
      return;
    }
    let newest = lastSeen;
    for (const item of [...f.items].reverse()) {
      if (item.activeSince <= lastSeen || item.read) continue;
      if (item.activeSince > newest) newest = item.activeSince;
      try {
        const n = new window.Notification(item.title, { body: item.body, tag: item.key });
        n.onclick = () => {
          window.focus();
          void markNotificationRead(item.id);
          routerRef.current.push(item.link);
          n.close();
        };
      } catch {
        /* some browsers only allow notifications from a service worker; skip quietly */
      }
    }
    if (newest > lastSeen) writeLastSeen(newest);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (res.status === 401) return router.refresh(); // session gone -> middleware sends to /login
      if (!res.ok) return;
      const next = (await res.json()) as NotificationFeed;
      setFeed(next);
      showDesktop(next);
    } catch {
      /* offline or server restarting: try again next tick */
    }
  }, [router, showDesktop]);

  useEffect(() => {
    showDesktop(initialFeed);
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start polling once
  }, []);

  const enableDesktop = useCallback(async () => {
    if (!("Notification" in window)) return setPermission("unsupported");
    const p = await window.Notification.requestPermission();
    setPermission(p);
    if (p === "granted") {
      writeLastSeen(new Date().toISOString());
      new window.Notification("Desktop notifications enabled", {
        body: "Rentee will alert you about overdue rent, due dates, move-outs and repairs while a tab is open.",
        tag: "rentee-enabled",
      });
    }
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      setFeed((f) => ({
        ...f,
        unread: Math.max(0, f.unread - (f.items.some((i) => i.id === id && !i.read) ? 1 : 0)),
        items: f.items.map((i) => (i.id === id ? { ...i, read: true } : i)),
      }));
      const unread = await markNotificationRead(id);
      setFeed((f) => ({ ...f, unread }));
      router.refresh();
    },
    [router],
  );

  const markAllRead = useCallback(async () => {
    setFeed((f) => ({ ...f, unread: 0, items: f.items.map((i) => ({ ...i, read: true })) }));
    const unread = await markAllNotificationsRead();
    setFeed((f) => ({ ...f, unread }));
    router.refresh();
  }, [router]);

  return (
    <NotificationsCtx.Provider value={{ feed, permission, enableDesktop, markRead, markAllRead, refresh }}>
      {children}
    </NotificationsCtx.Provider>
  );
}

/* ---------- presentation ---------- */

export function CategoryIcon({ item }: { item: Pick<NotificationItem, "category" | "type" | "resolved"> }) {
  const alert = item.category === "alert";
  return (
    <span
      className={clsx(
        "grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
        item.resolved
          ? "bg-slate-50 text-slate-400 ring-slate-200"
          : alert
            ? "bg-rose-50 text-rose-600 ring-rose-100"
            : "bg-amber-50 text-amber-600 ring-amber-100",
      )}
    >
      {item.resolved ? <IconCheck className="size-4" /> : alert ? <IconAlert className="size-4" /> : <IconCalendar className="size-4" />}
    </span>
  );
}

/** "3 hours ago", rendered after mount so server and client markup match. */
export function TimeAgo({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(relativeTime(iso));
    const t = setInterval(() => setText(relativeTime(iso)), 60_000);
    return () => clearInterval(t);
  }, [iso]);
  return (
    <time dateTime={iso} className="text-xs text-slate-400" suppressHydrationWarning>
      {text ?? " "}
    </time>
  );
}

export function EnableDesktopButton({ className, compact }: { className?: string; compact?: boolean }) {
  const { permission, enableDesktop, feed } = useNotifications();
  if (!feed.desktopEnabled) {
    return compact ? null : <p className={clsx("text-xs text-slate-500", className)}>Desktop notifications are turned off in Settings.</p>;
  }
  if (permission === "unsupported") {
    return compact ? null : <p className={clsx("text-xs text-slate-500", className)}>This browser doesn’t support desktop notifications.</p>;
  }
  if (permission === "granted") {
    return (
      <p className={clsx("flex items-center gap-1.5 text-xs text-emerald-700", className)}>
        <IconCheck className="size-3.5" /> Desktop notifications are on in this browser
      </p>
    );
  }
  if (permission === "denied") {
    return (
      <p className={clsx("text-xs text-slate-500", className)}>
        Desktop notifications are blocked for this site. Allow them in your browser’s site settings.
      </p>
    );
  }
  return (
    <button type="button" onClick={() => void enableDesktop()} className={clsx("btn btn-secondary btn-sm", className)}>
      <IconBell className="size-3.5" /> Enable desktop notifications
    </button>
  );
}

function FeedItem({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  const { markRead } = useNotifications();
  const router = useRouter();
  return (
    <li className={clsx("relative px-4 py-3", !item.read && "bg-brand-50/40")}>
      <div className="flex gap-3">
        <CategoryIcon item={item} />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => {
            onOpen();
            void markRead(item.id);
            router.push(item.link);
          }}
        >
          <span className="flex items-start justify-between gap-2">
            <span className={clsx("text-sm text-slate-900", !item.read && "font-semibold")}>{item.title}</span>
            {!item.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
          </span>
          <span className="mt-0.5 block text-xs text-slate-600">{item.body}</span>
          <TimeAgo iso={item.activeSince} />
        </button>
      </div>
      {item.reminder && (
        <div className="mt-2 pl-11">
          <WhatsAppReminderButton {...item.reminder} />
        </div>
      )}
    </li>
  );
}

/** Bell with unread badge + dropdown of the latest 10 open notifications. */
export function NotificationBell({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { feed, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const badge = feed.unread > 99 ? "99+" : String(feed.unread);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={feed.unread ? `Notifications, ${feed.unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={clsx(
          "relative grid size-10 place-items-center rounded-lg transition",
          tone === "dark" ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100",
        )}
      >
        <IconBell />
        {feed.unread > 0 && (
          <span className="absolute top-1 right-1 min-w-4.5 rounded-full bg-rose-600 px-1 text-center text-[10px] leading-4.5 font-semibold text-white ring-2 ring-white tabular-nums">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:w-[26rem]"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">
              Notifications {feed.unread > 0 && <span className="font-normal text-slate-500">· {feed.unread} unread</span>}
            </p>
            {feed.unread > 0 && (
              <button type="button" onClick={() => void markAllRead()} className="text-xs font-medium text-brand-700 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {feed.items.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <span className="mx-auto mb-3 grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-400">
                <IconBell className="size-5" />
              </span>
              <p className="text-sm font-medium text-slate-900">You’re all caught up</p>
              <p className="mt-1 text-xs text-slate-500">Overdue rent, due dates, move-outs and repairs show up here.</p>
            </div>
          ) : (
            <ul className="max-h-[min(28rem,60vh)] divide-y divide-slate-100 overflow-y-auto">
              {feed.items.map((item) => (
                <FeedItem key={item.id} item={item} onOpen={() => setOpen(false)} />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
            <EnableDesktopButton compact />
            <Link href="/notifications" onClick={() => setOpen(false)} className="ml-auto text-sm font-medium text-brand-700 hover:underline">
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
