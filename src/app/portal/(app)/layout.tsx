import type { Metadata } from "next";
import { Logo } from "@/components/brand";
import { IconLogout } from "@/components/icons";
import { PortalTabBar, PortalTopNav } from "@/components/portal/portal-nav";
import { firstName } from "@/lib/receipts";
import { requireTenant } from "@/lib/tenant-auth";
import { tenantLogout } from "../login/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: "My home", template: "%s · Rentee" },
  robots: { index: false, follow: false },
};

/** Tenant portal shell: every page below requires a tenant session (re-checked in the database). */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await requireTenant();
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <a href="/portal" aria-label="Rentee tenant portal home">
            <Logo />
          </a>
          <PortalTopNav />
          <form action={tenantLogout} className="flex items-center gap-2">
            <span className="hidden max-w-32 truncate text-sm text-slate-600 md:inline">{firstName(me.name)}</span>
            <button type="submit" className="btn btn-ghost btn-sm" aria-label="Sign out">
              <IconLogout className="size-4" />
              <span className="sm:hidden md:inline">Sign out</span>
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-5 pb-28 sm:pb-12">{children}</main>
      <PortalTabBar />
    </div>
  );
}
