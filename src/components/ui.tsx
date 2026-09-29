import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { IconArrowLeft } from "./icons";

/* ---------- layout ---------- */

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link
          href={back.href}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <IconArrowLeft className="size-4" /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(bodyClassName ?? "p-5")}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "brand",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ReactNode;
  tone?: "brand" | "emerald" | "rose" | "amber";
  href?: string;
}) {
  const tones = {
    brand: "bg-brand-50 text-brand-600 ring-brand-100",
    emerald: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    rose: "bg-rose-50 text-rose-600 ring-rose-100",
    amber: "bg-amber-50 text-amber-600 ring-amber-100",
  };
  const body = (
    <div className="flex items-start justify-between gap-4 p-5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </div>
      <span className={clsx("grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset", tones[tone])}>
        {icon}
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className="card block transition hover:-translate-y-0.5 hover:shadow-pop">
      {body}
    </Link>
  ) : (
    <div className="card">{body}</div>
  );
}

/* ---------- badges ---------- */

export type BadgeTone = "slate" | "brand" | "emerald" | "amber" | "rose" | "sky" | "violet";

const badgeTones: Record<BadgeTone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-500/15",
  brand: "bg-brand-50 text-brand-700 ring-brand-600/15",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  rose: "bg-rose-50 text-rose-700 ring-rose-600/20",
  sky: "bg-sky-50 text-sky-700 ring-sky-600/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

export function Badge({ tone = "slate", children, dot }: { tone?: BadgeTone; children: ReactNode; dot?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        badgeTones[tone],
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

const STATUS_BADGES: Record<string, { tone: BadgeTone; label: string }> = {
  // occupancy
  occupied: { tone: "emerald", label: "Occupied" },
  vacant: { tone: "amber", label: "Vacant" },
  archived: { tone: "slate", label: "Archived" },
  // rental
  active: { tone: "emerald", label: "Active" },
  moved_out: { tone: "slate", label: "Moved out" },
  moving_out: { tone: "amber", label: "Moving out" },
  // rent month
  paid: { tone: "emerald", label: "Paid" },
  partial: { tone: "amber", label: "Partial" },
  overdue: { tone: "rose", label: "Overdue" },
  upcoming: { tone: "sky", label: "Upcoming" },
  // maintenance status
  open: { tone: "rose", label: "Open" },
  in_progress: { tone: "amber", label: "In progress" },
  done: { tone: "emerald", label: "Done" },
  // priority
  low: { tone: "slate", label: "Low" },
  medium: { tone: "sky", label: "Medium" },
  high: { tone: "amber", label: "High" },
  urgent: { tone: "rose", label: "Urgent" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGES[status] ?? { tone: "slate" as const, label: status };
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

/* ---------- empty state ---------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={clsx("flex flex-col items-center text-center", compact ? "px-4 py-8" : "px-6 py-14")}>
      {icon && (
        <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-500 ring-1 ring-slate-200">
          {icon}
        </span>
      )}
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ---------- tables ---------- */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium tracking-wide text-slate-500 uppercase">
      <tr>{children}</tr>
    </thead>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={clsx("px-5 py-3 font-medium whitespace-nowrap", className)}>{children}</th>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={clsx("px-5 py-3.5 align-middle", className)}>{children}</td>;
}

/* ---------- misc ---------- */

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm";
}) {
  return (
    <Link href={href} className={clsx("btn", `btn-${variant}`, size === "sm" && "btn-sm")}>
      {children}
    </Link>
  );
}

export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{it.label}</dt>
          <dd className="mt-1 text-sm break-words text-slate-900">{it.value || <span className="text-slate-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FilterTabs({
  tabs,
  active,
}: {
  tabs: { key: string; label: string; href: string; count?: number }[];
  active: string;
}) {
  return (
    <nav className="mb-4 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 text-sm" aria-label="Filter">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={clsx(
            "rounded-lg px-3 py-1.5 font-medium transition",
            t.key === active ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-slate-400 tabular-nums">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
