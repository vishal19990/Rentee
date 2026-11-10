"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconFile, IconHome, IconUsers, IconWallet, IconWrench } from "@/components/icons";

export const PORTAL_TABS = [
  { href: "/portal", label: "Home", icon: IconHome },
  { href: "/portal/payments", label: "Payments", icon: IconWallet },
  { href: "/portal/maintenance", label: "Repairs", icon: IconWrench },
  { href: "/portal/documents", label: "Documents", icon: IconFile },
  { href: "/portal/profile", label: "Profile", icon: IconUsers },
];

function isActive(pathname: string, href: string) {
  return href === "/portal" ? pathname === "/portal" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Top links on wider screens. */
export function PortalTopNav() {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 sm:flex" aria-label="Portal">
      {PORTAL_TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={isActive(pathname, t.href) ? "page" : undefined}
          className={clsx(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition",
            isActive(pathname, t.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Bottom tab bar on phones. */
export function PortalTabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      aria-label="Portal"
    >
      <ul className="grid grid-cols-5">
        {PORTAL_TABS.map((t) => {
          const active = isActive(pathname, t.href);
          const Icon = t.icon;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={clsx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-brand-700" : "text-slate-500")}
              >
                <Icon className="size-5" />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
