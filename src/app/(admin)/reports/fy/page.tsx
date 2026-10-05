import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fyOf, fyRange, isFy } from "@/lib/fy";
import { formatMoney } from "@/lib/money";
import { localToday } from "@/lib/rent";
import { loadFySummary, reportYears } from "@/lib/reports-data";
import { Card, EmptyState, PageHeader, StatCard, Table, TBody, Td, Th, THead } from "@/components/ui";
import { IconAlert, IconCalendar, IconCheck, IconReceipt, IconTrendingUp } from "@/components/icons";
import { DownloadLink } from "../download-link";

export const metadata: Metadata = { title: "Financial year summary" };

const money = (minor: number) => <span className={minor < 0 ? "text-rose-600" : undefined}>{formatMoney(minor)}</span>;

export default async function FySummaryPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const today = localToday();
  const fy = sp.fy && isFy(sp.fy) ? sp.fy : fyOf(today);
  const { start, end } = fyRange(fy);
  const [s, years] = await Promise.all([loadFySummary(fy), reportYears(today)]);
  if (!years.includes(fy)) years.push(fy);

  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="Financial year summary"
        description={`FY ${fy} (1 Apr ${start.slice(0, 4)} – 31 Mar ${end.slice(0, 4)}). Income is rent received, by payment date.`}
        actions={
          <>
            <DownloadLink href={`/api/reports/fy-summary?fy=${fy}&format=pdf`} label="Download PDF" primary />
            <DownloadLink href={`/api/reports/fy-summary?fy=${fy}&format=xlsx`} label="Excel" />
          </>
        }
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl bg-slate-100 p-3">
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
        <button type="submit" className="btn btn-primary">
          Show
        </button>
      </form>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Rent received (for ITR)"
          value={formatMoney(s.rentReceived)}
          hint="Includes charges collected with rent"
          icon={<IconCheck />}
          tone="emerald"
        />
        <StatCard label="Expenses" value={formatMoney(s.total.expenses)} icon={<IconReceipt />} tone="amber" />
        <StatCard
          label="Profit"
          value={formatMoney(s.total.profit)}
          icon={s.total.profit < 0 ? <IconAlert /> : <IconTrendingUp />}
          tone={s.total.profit < 0 ? "rose" : "brand"}
        />
      </div>

      {s.properties.length === 0 ? (
        <Card>
          <EmptyState icon={<IconCalendar />} title={`Nothing recorded in FY ${fy}`} description="Payments and expenses dated in this year appear here." />
        </Card>
      ) : (
        <div className="space-y-6">
          <Card
            title="By property"
            actions={
              <Link href={`/reports/profit?fy=${fy}`} className="link text-sm">
                Monthly chart
              </Link>
            }
            bodyClassName="p-0"
          >
            <Table>
              <THead>
                <Th>Property</Th>
                <Th className="text-right">Income</Th>
                <Th className="text-right">Expenses</Th>
                <Th className="text-right">Profit</Th>
              </THead>
              <TBody>
                {s.properties.map((p) => (
                  <tr key={p.propertyId ?? "general"}>
                    <Td className="font-medium text-slate-900">{p.name}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(p.income)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(p.expenses)}</Td>
                    <Td className="text-right font-medium tabular-nums">{money(p.profit)}</Td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <Td>Total</Td>
                  <Td className="text-right tabular-nums">{formatMoney(s.total.income)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(s.total.expenses)}</Td>
                  <Td className="text-right tabular-nums">{money(s.total.profit)}</Td>
                </tr>
              </TBody>
            </Table>
          </Card>

          <Card title="Expenses by category" description="All properties, including general expenses." bodyClassName="p-0">
            {s.expensesByCategory.length === 0 ? (
              <EmptyState compact icon={<IconReceipt />} title="No expenses in this year" />
            ) : (
              <Table>
                <THead>
                  <Th>Category</Th>
                  <Th className="text-right">Amount</Th>
                </THead>
                <TBody>
                  {s.expensesByCategory.map((c) => (
                    <tr key={c.category}>
                      <Td>{c.label}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(c.amount)}</Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
