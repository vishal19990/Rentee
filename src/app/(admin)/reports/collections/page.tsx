import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { fyOf } from "@/lib/fy";
import { formatMoney } from "@/lib/money";
import { formatMonth, localToday, monthOf } from "@/lib/rent";
import { isMonthKey, loadCollections } from "@/lib/reports-data";
import { Card, EmptyState, PageHeader, StatCard, StatusBadge, Table, TBody, Td, Th, THead } from "@/components/ui";
import { IconAlert, IconCheck, IconReceipt, IconWallet } from "@/components/icons";
import { DownloadLink } from "../download-link";

export const metadata: Metadata = { title: "Monthly collections" };

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const today = localToday();
  const thisMonth = monthOf(today);
  // Rent schedules run through the current month, so later months have nothing to show yet.
  const month = isMonthKey(sp.month) && sp.month <= thisMonth ? sp.month : thisMonth;
  const fy = fyOf(`${month}-01`);
  const { report, byMonth } = await loadCollections(month, fy, today);
  const t = report.totals;
  const rate = t.due > 0 ? Math.round((t.paid / t.due) * 100) : null;

  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="Monthly collections"
        description={`${formatMonth(month)}: rent plus charges due for the month, and what has been paid towards it.`}
        actions={<DownloadLink href={`/api/reports/collections?month=${month}`} label="Download Excel" primary />}
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl bg-slate-100 p-3">
        <label className="text-xs font-medium text-slate-600">
          Month
          <input type="month" name="month" defaultValue={month} max={thisMonth} className="input mt-1" required />
        </label>
        <button type="submit" className="btn btn-primary">
          Show
        </button>
      </form>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Due" value={formatMoney(t.due)} hint={`Rent ${formatMoney(t.rent)} + charges ${formatMoney(t.charges)}`} icon={<IconReceipt />} />
        <StatCard label="Collected" value={formatMoney(t.paid)} hint={rate === null ? undefined : `${rate}% of due`} icon={<IconCheck />} tone="emerald" />
        <StatCard label="Still due" value={formatMoney(t.balance)} icon={<IconAlert />} tone={t.balance > 0 ? "rose" : "brand"} />
        <StatCard label="Cash received in month" value={formatMoney(report.received)} hint="By payment date, any rent month" icon={<IconWallet />} tone="amber" />
      </div>

      <div className="space-y-6">
        <Card title={`Rentals in ${formatMonth(month)}`} bodyClassName="p-0">
          {report.rows.length === 0 ? (
            <EmptyState compact icon={<IconWallet />} title="No rentals in this month" />
          ) : (
            <Table>
              <THead>
                <Th>Property</Th>
                <Th>Tenant</Th>
                <Th>Due date</Th>
                <Th className="text-right">Due</Th>
                <Th className="text-right">Paid</Th>
                <Th className="text-right">Balance</Th>
                <Th>Status</Th>
              </THead>
              <TBody>
                {report.rows.map((r) => (
                  <tr key={r.rentalId} className="hover:bg-slate-50/60">
                    <Td className="font-medium text-slate-900">
                      <Link href={`/rentals/${r.rentalId}`} className="link">
                        {r.propertyName}
                      </Link>
                    </Td>
                    <Td>{r.tenantName}</Td>
                    <Td className="whitespace-nowrap text-slate-600">{formatDate(r.dueDate)}</Td>
                    <Td className="text-right tabular-nums">
                      {formatMoney(r.due)}
                      {r.charges > 0 && <span className="block text-xs text-slate-500">incl. {formatMoney(r.charges)} charges</span>}
                    </Td>
                    <Td className="text-right tabular-nums">{formatMoney(r.paid)}</Td>
                    <Td className={`text-right font-medium tabular-nums ${r.balance > 0 ? "text-rose-600" : "text-slate-400"}`}>
                      {formatMoney(r.balance)}
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <Td>Total</Td>
                  <Td />
                  <Td />
                  <Td className="text-right tabular-nums">{formatMoney(t.due)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(t.paid)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(t.balance)}</Td>
                  <Td />
                </tr>
              </TBody>
            </Table>
          )}
        </Card>

        <Card title={`FY ${fy} by month`} description="Due, paid and balance per rent month; received is cash by payment date." bodyClassName="p-0">
          <Table>
            <THead>
              <Th>Month</Th>
              <Th className="text-right">Due</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Balance</Th>
              <Th className="text-right">Received</Th>
            </THead>
            <TBody>
              {byMonth.map((m) => (
                <tr key={m.month} className={m.month === month ? "bg-brand-50/60" : undefined}>
                  <Td className="whitespace-nowrap">
                    {m.month <= thisMonth ? (
                      <Link href={`/reports/collections?month=${m.month}`} className="link">
                        {formatMonth(m.month)}
                      </Link>
                    ) : (
                      <span className="text-slate-400">{formatMonth(m.month)}</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(m.due)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(m.paid)}</Td>
                  <Td className={`text-right tabular-nums ${m.balance > 0 ? "text-rose-600" : ""}`}>{formatMoney(m.balance)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(m.received)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
