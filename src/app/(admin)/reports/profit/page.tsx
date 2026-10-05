import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { propertyOptions, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { dateFromISO } from "@/lib/format";
import { fyList, fyOf, fyRange, isFy } from "@/lib/fy";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { profitReport, type ProfitMonth } from "@/lib/profit";
import { formatMonth, localToday, toISODate } from "@/lib/rent";
import { Expense } from "@/models/Expense";
import { Payment } from "@/models/Payment";
import { Rental } from "@/models/Rental";
import { Card, EmptyState, PageHeader, StatCard, Table, TBody, Td, Th, THead } from "@/components/ui";
import { IconAlert, IconChart, IconCheck, IconReceipt, IconTrendingUp } from "@/components/icons";

export const metadata: Metadata = { title: "Profit report" };

function money(minor: number) {
  return <span className={minor < 0 ? "text-rose-600" : undefined}>{formatMoney(minor)}</span>;
}

function ProfitChart({ months }: { months: ProfitMonth[] }) {
  const max = Math.max(...months.flatMap((m) => [m.income, m.expenses]), 1);
  return (
    <div>
      <div className="flex h-56 items-end gap-1 sm:gap-2" role="img" aria-label="Bar chart of monthly income and expenses">
        {months.map((m) => (
          <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            <span className={`hidden text-[10px] font-medium tabular-nums sm:block ${m.profit < 0 ? "text-rose-600" : "text-slate-500"}`}>
              {m.income || m.expenses ? formatMoneyCompact(m.profit) : ""}
            </span>
            <div className="flex h-full w-full items-end justify-center gap-0.5">
              <div
                className="w-1/2 max-w-6 rounded-t bg-brand-500"
                style={{ height: `${Math.max(Math.round((m.income / max) * 100), m.income ? 2 : 0)}%` }}
                title={`${formatMonth(m.month)} income: ${formatMoney(m.income)}`}
              />
              <div
                className="w-1/2 max-w-6 rounded-t bg-rose-300"
                style={{ height: `${Math.max(Math.round((m.expenses / max) * 100), m.expenses ? 2 : 0)}%` }}
                title={`${formatMonth(m.month)} expenses: ${formatMoney(m.expenses)}`}
              />
            </div>
            <span className="text-[10px] text-slate-500 sm:text-xs">{formatMonth(m.month).split(" ")[0]}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand-500" /> Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-rose-300" /> Expenses
        </span>
        <span className="hidden sm:inline">Figures above the bars: profit</span>
      </div>
    </div>
  );
}

export default async function ProfitReportPage({ searchParams }: { searchParams: Promise<{ fy?: string; property?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const today = localToday();
  const fy = sp.fy && isFy(sp.fy) ? sp.fy : fyOf(today);
  const { start, endExclusive, end } = fyRange(fy);
  const range = { $gte: dateFromISO(start), $lt: dateFromISO(endExclusive) };

  await connectDB();
  const [payments, expenses, properties, firstPayment, firstExpense] = await Promise.all([
    Payment.find({ paidOn: range }).select("rental paidOn amount").lean(),
    Expense.find({ date: range }).select("property date amount").lean(),
    propertyOptions({ includeArchived: true }),
    Payment.findOne().sort({ paidOn: 1 }).select("paidOn").lean(),
    Expense.findOne().sort({ date: 1 }).select("date").lean(),
  ]);
  const rentals = await Rental.find({ _id: { $in: [...new Set(payments.map((p) => toId(p.rental)))] } })
    .select("property")
    .lean();
  const propertyOfRental = new Map(rentals.map((r) => [toId(r._id), toId(r.property)]));
  const propName = new Map(properties.map((p) => [p.id, p.name]));

  const report = profitReport(
    fy,
    payments.map((p) => ({ paidOn: toISODate(p.paidOn), amount: p.amount, propertyId: propertyOfRental.get(toId(p.rental)) ?? null })),
    expenses.map((e) => ({ date: toISODate(e.date), amount: e.amount, propertyId: e.property ? toId(e.property) : null })),
  );

  const selected = sp.property && report.properties.some((r) => (r.propertyId ?? "general") === sp.property) ? sp.property : "";
  const focus = selected ? report.properties.find((r) => (r.propertyId ?? "general") === selected)! : null;
  const months = focus ? focus.months : report.months;
  const totals = focus ?? report.total;
  const nameOf = (id: string | null) => (id === null ? "General (no property)" : (propName.get(id) ?? "(deleted property)"));

  const earliest = [firstPayment?.paidOn, firstExpense?.date].filter(Boolean).map((d) => toISODate(d!)).sort()[0] ?? today;
  const years = fyList(earliest, today);
  if (!years.includes(fy)) years.push(fy);

  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="Profit report"
        description={`Financial year ${fy} (1 Apr ${start.slice(0, 4)} – 31 Mar ${end.slice(0, 4)}). Income is rent received, by payment date.`}
        actions={
          <Link href="/expenses" className="btn btn-secondary">
            <IconReceipt className="size-4" /> Expenses
          </Link>
        }
      />

      <form method="get" className="mb-6 grid grid-cols-1 gap-3 rounded-xl bg-slate-100 p-3 sm:grid-cols-3 sm:items-end">
        <label className="text-xs font-medium text-slate-600">
          Financial year
          <select name="fy" defaultValue={fy} className="input mt-1">
            {years.map((y) => (
              <option key={y} value={y}>
                FY {y}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Chart & months for
          <select name="property" defaultValue={selected} className="input mt-1">
            <option value="">All properties</option>
            {report.properties.map((r) => (
              <option key={r.propertyId ?? "general"} value={r.propertyId ?? "general"}>
                {nameOf(r.propertyId)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary">
          Show
        </button>
      </form>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Income" value={formatMoney(totals.income)} hint={focus ? nameOf(focus.propertyId) : "Rent received"} icon={<IconCheck />} tone="emerald" />
        <StatCard label="Expenses" value={formatMoney(totals.expenses)} icon={<IconReceipt />} tone="amber" />
        <StatCard
          label="Profit"
          value={formatMoney(totals.profit)}
          icon={totals.profit < 0 ? <IconAlert /> : <IconTrendingUp />}
          tone={totals.profit < 0 ? "rose" : "brand"}
        />
      </div>

      {report.properties.length === 0 ? (
        <Card>
          <EmptyState icon={<IconChart />} title={`Nothing recorded in FY ${fy}`} description="Payments and expenses dated in this year appear here." />
        </Card>
      ) : (
        <div className="space-y-6">
          <Card title="By month" description={focus ? nameOf(focus.propertyId) : "All properties"}>
            <ProfitChart months={months} />
          </Card>

          <Card title="By property" bodyClassName="p-0">
            <Table>
              <THead>
                <Th>Property</Th>
                <Th className="text-right">Income</Th>
                <Th className="text-right">Expenses</Th>
                <Th className="text-right">Profit</Th>
              </THead>
              <TBody>
                {report.properties.map((r) => (
                  <tr key={r.propertyId ?? "general"}>
                    <Td className="font-medium text-slate-900">
                      <Link className="hover:text-brand-700" href={`/reports/profit?fy=${fy}&property=${r.propertyId ?? "general"}`}>
                        {nameOf(r.propertyId)}
                      </Link>
                    </Td>
                    <Td className="text-right tabular-nums">{formatMoney(r.income)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(r.expenses)}</Td>
                    <Td className="text-right font-medium tabular-nums">{money(r.profit)}</Td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <Td>Total</Td>
                  <Td className="text-right tabular-nums">{formatMoney(report.total.income)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(report.total.expenses)}</Td>
                  <Td className="text-right tabular-nums">{money(report.total.profit)}</Td>
                </tr>
              </TBody>
            </Table>
          </Card>

          <Card title="Monthly figures" description={focus ? nameOf(focus.propertyId) : "All properties"} bodyClassName="p-0">
            <Table>
              <THead>
                <Th>Month</Th>
                <Th className="text-right">Income</Th>
                <Th className="text-right">Expenses</Th>
                <Th className="text-right">Profit</Th>
              </THead>
              <TBody>
                {months.map((m) => (
                  <tr key={m.month}>
                    <Td className="whitespace-nowrap">{formatMonth(m.month)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(m.income)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(m.expenses)}</Td>
                    <Td className="text-right font-medium tabular-nums">{money(m.profit)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
