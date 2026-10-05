import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadRentals, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { dateFromISO, formatDate } from "@/lib/format";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { addDays, addMonths, formatMonth, localToday, monthOf } from "@/lib/rent";
import { reminderButtons } from "@/lib/reminders";
import { Maintenance } from "@/models/Maintenance";
import { Payment } from "@/models/Payment";
import { Property } from "@/models/Property";
import { ButtonLink, Card, EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { WhatsAppReminderButton } from "@/components/whatsapp-button";
import { AgreementsExpiringCard } from "@/components/agreements-expiring-card";
import {
  IconAlert,
  IconCalendar,
  IconCheck,
  IconHome,
  IconPlus,
  IconTrendingUp,
  IconWallet,
  IconWrench,
} from "@/components/icons";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const today = localToday();
  const thisMonth = monthOf(today);
  const firstChartMonth = addMonths(thisMonth, -5);

  await connectDB();
  const [properties, rentals, openMaintenance, income] = await Promise.all([
    Property.find({ archived: false }).select("_id").lean(),
    loadRentals({}, today),
    Maintenance.find({ status: { $ne: "done" } }).sort({ createdAt: -1 }).lean(),
    Payment.aggregate<{ _id: string; total: number }>([
      {
        $match: {
          paidOn: { $gte: dateFromISO(`${firstChartMonth}-01`), $lt: dateFromISO(`${addMonths(thisMonth, 1)}-01`) },
        },
      },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$paidOn" } }, total: { $sum: "$amount" } } },
    ]),
  ]);

  const liveIds = new Set(properties.map((p) => toId(p._id)));
  const active = rentals.filter((l) => l.status === "active");
  const occupied = new Set(active.map((l) => l.propertyId).filter((id) => liveIds.has(id))).size;
  const total = liveIds.size;
  const occupancyPct = total ? Math.round((occupied / total) * 100) : 0;

  const incomeByMonth = new Map(income.map((r) => [r._id, r.total]));
  const chart = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(firstChartMonth, i);
    return { month: m, total: incomeByMonth.get(m) ?? 0 };
  });
  const collectedThisMonth = incomeByMonth.get(thisMonth) ?? 0;
  const expectedThisMonth = active.reduce((s, l) => {
    const m = l.schedule.find((x) => x.month === thisMonth);
    return s + (m ? m.due : 0);
  }, 0);
  const chartMax = Math.max(...chart.map((c) => c.total), 1);

  const overdue = rentals.filter((l) => l.summary.overdueAmount > 0).sort((a, b) => b.summary.overdueAmount - a.summary.overdueAmount);
  const overdueTotal = overdue.reduce((s, l) => s + l.summary.overdueAmount, 0);
  const reminders = await reminderButtons(overdue, today);

  const soon = addDays(today, 30);
  // Active rentals with a scheduled move-out in the next 30 days (a move-out dated today or
  // earlier has already taken effect, so the rental is no longer active).
  const movingOut = active
    .filter((l): l is typeof l & { moveOutDate: string } => !!l.moveOutDate && l.moveOutDate <= soon)
    .sort((a, b) => a.moveOutDate.localeCompare(b.moveOutDate));

  const propName = new Map(rentals.map((l) => [l.propertyId, l.propertyName]));
  const maintProps = await Property.find({ _id: { $in: openMaintenance.map((m) => m.property) } }).select("name").lean();
  for (const p of maintProps) propName.set(toId(p._id), p.name);

  const firstName = user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={`Hello, ${firstName}`}
        description={`Here's how your rentals look today, ${formatDate(today)}.`}
        actions={
          <>
            <ButtonLink href="/payments/new" variant="secondary">
              <IconWallet className="size-4" /> Record payment
            </ButtonLink>
            <ButtonLink href="/properties/new">
              <IconPlus className="size-4" /> Add property
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Occupancy"
          value={`${occupancyPct}%`}
          hint={`${occupied} of ${total} properties occupied`}
          icon={<IconHome />}
          href="/properties"
        />
        <StatCard
          label="Collected this month"
          value={formatMoney(collectedThisMonth)}
          hint={expectedThisMonth ? `${formatMoney(expectedThisMonth)} rent due in ${formatMonth(thisMonth)}` : formatMonth(thisMonth)}
          icon={<IconCheck />}
          tone="emerald"
          href="/payments"
        />
        <StatCard
          label="Overdue rent"
          value={formatMoney(overdueTotal)}
          hint={overdue.length ? `${overdue.length} rental${overdue.length === 1 ? "" : "s"} behind` : "Everyone is up to date"}
          icon={<IconAlert />}
          tone={overdueTotal > 0 ? "rose" : "emerald"}
        />
        <StatCard
          label="Open maintenance"
          value={String(openMaintenance.length)}
          hint={`${openMaintenance.filter((m) => m.priority === "urgent" || m.priority === "high").length} high priority`}
          icon={<IconWrench />}
          tone="amber"
          href="/maintenance"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card
          title="Income"
          description="Rent received over the last 6 months"
          className="xl:col-span-2"
          actions={<IconTrendingUp className="size-5 text-slate-400" />}
        >
          <div className="flex h-56 items-end gap-2 sm:gap-4" role="img" aria-label="Bar chart of monthly income">
            {chart.map((c) => {
              const h = Math.round((c.total / chartMax) * 100);
              const current = c.month === thisMonth;
              return (
                <div key={c.month} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                    {c.total ? formatMoneyCompact(c.total) : ""}
                  </span>
                  <div
                    className={
                      current
                        ? "w-full max-w-14 rounded-t-lg bg-gradient-to-t from-brand-600 to-brand-400 shadow-sm"
                        : "w-full max-w-14 rounded-t-lg bg-brand-200 transition hover:bg-brand-300"
                    }
                    style={{ height: `${Math.max(h, c.total ? 3 : 1)}%` }}
                    title={`${formatMonth(c.month)}: ${formatMoney(c.total)}`}
                  />
                  <span className={current ? "text-xs font-semibold text-slate-900" : "text-xs text-slate-500"}>
                    {formatMonth(c.month).split(" ")[0]}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Moving out soon" description="Scheduled move-outs in the next 30 days" bodyClassName="p-0">
          {movingOut.length === 0 ? (
            <EmptyState compact icon={<IconCalendar />} title="No move-outs scheduled" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {movingOut.map((l) => (
                <li key={l.id}>
                  <Link href={`/rentals/${l.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{l.propertyName}</p>
                      <p className="truncate text-xs text-slate-500">{l.tenantName}</p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-amber-700">{formatDate(l.moveOutDate)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Overdue rent"
          description={overdue.length ? `${formatMoney(overdueTotal)} outstanding` : undefined}
          actions={overdue.length ? <Link href="/reminders" className="text-sm link">Send reminders</Link> : undefined}
          className="xl:col-span-2"
          bodyClassName="p-0"
        >
          {overdue.length === 0 ? (
            <EmptyState compact icon={<IconCheck />} title="No overdue rent" description="All tenants are paid up." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {overdue.map((l) => {
                const months = l.schedule.filter((m) => m.pastDue && m.balance > 0);
                return (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <Link href={`/rentals/${l.id}`} className="text-sm font-medium text-slate-900 hover:text-brand-700">
                        {l.propertyName}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {l.tenantName} · {months.map((m) => formatMonth(m.month)).join(", ")}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
                      <span className="text-sm font-semibold text-rose-600 tabular-nums">
                        {formatMoney(l.summary.overdueAmount)}
                      </span>
                      <ButtonLink href={`/payments/new?rentalId=${l.id}`} variant="secondary" size="sm">
                        Record
                      </ButtonLink>
                      {reminders.get(l.id) && <WhatsAppReminderButton {...reminders.get(l.id)!} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="Open maintenance"
          bodyClassName="p-0"
          actions={
            <Link href="/maintenance" className="text-sm link">
              View all
            </Link>
          }
        >
          {openMaintenance.length === 0 ? (
            <EmptyState compact icon={<IconWrench />} title="No open requests" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {openMaintenance.slice(0, 6).map((m) => (
                <li key={toId(m._id)}>
                  <Link
                    href={`/maintenance/${toId(m._id)}/edit`}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{m.title}</p>
                      <p className="truncate text-xs text-slate-500">{propName.get(toId(m.property)) ?? ""}</p>
                    </div>
                    <StatusBadge status={m.priority} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <AgreementsExpiringCard rentals={rentals} today={today} />
      </div>
    </>
  );
}
