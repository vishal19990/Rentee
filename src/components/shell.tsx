"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { NotificationFeed } from "@/lib/notification-sync";
import { NotificationBell, NotificationsProvider, useNotifications } from "./notifications";
import {
  IconBell,
  IconDashboard,
  IconFile,
  IconHome,
  IconLogout,
  IconMenu,
  IconSettings,
  IconUsers,
  IconWallet,
  IconWrench,
  IconX,
} from "./icons";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: IconDashboard },
  { href: "/properties", label: "Properties", icon: IconHome },
  { href: "/tenants", label: "Tenants", icon: IconUsers },
  { href: "/rentals", label: "Rentals", icon: IconFile },
  { href: "/payments", label: "Payments", icon: IconWallet },
  { href: "/maintenance", label: "Maintenance", icon: IconWrench },
  { href: "/notifications", label: "Notifications", icon: IconBell },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

export function Logo({ light }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg shadow-brand-900/30">
        <IconHome className="size-5" />
      </span>
      <span className={clsx("text-lg font-semibold tracking-tight", light ? "text-white" : "text-slate-900")}>
        Rentee
      </span>
    </span>
  );
}

function Sidebar({
  user,
  logout,
  onNavigate,
}: {
  user: { name: string; email: string };
  logout: () => Promise<void>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { feed } = useNotifications();
  const initials = user.name
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-300">
      <div className="px-5 pt-6 pb-8">
        <Link href="/dashboard" onClick={onNavigate}>
          <Logo light />
        </Link>
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "bg-white/10 text-white shadow-inner shadow-white/5"
                  : "text-slate-400 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className={clsx("size-5", active ? "text-brand-300" : "text-slate-500 group-hover:text-slate-300")} />
              {label}
              {href === "/notifications" && feed.unread > 0 && (
                <span className="ml-auto rounded-full bg-rose-500/90 px-2 py-0.5 text-[11px] leading-none font-semibold text-white tabular-nums">
                  {feed.unread > 99 ? "99+" : feed.unread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="m-3 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-500/20 text-sm font-semibold text-brand-200">
            {initials || "A"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user.name}</p>
            <p className="truncate text-xs text-slate-400">{user.email}</p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              title="Sign out"
              aria-label="Sign out"
              className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              <IconLogout className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  user,
  logout,
  notifications,
  children,
}: {
  user: { name: string; email: string };
  logout: () => Promise<void>;
  notifications: NotificationFeed;
  children: ReactNode;
}) {
  return (
    <NotificationsProvider initialFeed={notifications}>
      <Shell user={user} logout={logout}>
        {children}
      </Shell>
    </NotificationsProvider>
  );
}

function Shell({
  user,
  logout,
  children,
}: {
  user: { name: string; email: string };
  logout: () => Promise<void>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar user={user} logout={logout} />
      </aside>

      {/* Mobile drawer */}
      <div className={clsx("fixed inset-0 z-40 lg:hidden", open ? "pointer-events-auto" : "pointer-events-none")}>
        <div
          className={clsx("absolute inset-0 bg-slate-950/50 backdrop-blur-sm transition-opacity", open ? "opacity-100" : "opacity-0")}
          onClick={() => setOpen(false)}
          aria-hidden
        />
        <aside
          className={clsx(
            "absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl transition-transform duration-200",
            open ? "translate-x-0" : "-translate-x-full",
          )}
          aria-label="Navigation"
          aria-hidden={!open}
          inert={!open}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-5 right-3 z-10 grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close menu"
          >
            <IconX />
          </button>
          <Sidebar user={user} logout={logout} onNavigate={() => setOpen(false)} />
        </aside>
      </div>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            type="button"
            onClick={() => setOpen(true)}
          className="grid size-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
          aria-label="Open menu"
          aria-expanded={open}
        >
            <IconMenu />
          </button>
        </div>
      </header>

      <main className="lg:pl-64">
        {/* Desktop top bar */}
        <div className="sticky top-0 z-20 hidden border-b border-slate-200/70 bg-slate-50/80 backdrop-blur lg:block">
          <div className="mx-auto flex max-w-7xl items-center justify-end gap-2 px-8 py-2">
            <NotificationBell />
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
