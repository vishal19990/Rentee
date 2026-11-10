import type { ReactNode } from "react";
import { Logo } from "@/components/brand";

/** Centered card for the portal's sign-in, set-password and invalid-link pages (mobile first). */
export function PortalAuthFrame({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-slate-950 px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-600/40 via-violet-500/20 to-transparent blur-3xl"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <Logo light size="lg" />
          <span className="text-xs font-semibold tracking-widest text-brand-300 uppercase">Tenant portal</span>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-black/30 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
