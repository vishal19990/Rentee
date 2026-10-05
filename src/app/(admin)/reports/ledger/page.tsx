import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDate, formatStay, titleCase } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { formatMonth, localToday } from "@/lib/rent";
import { ledgerOptions, loadLedger, tenantName } from "@/lib/reports-data";
import { Card, EmptyState, PageHeader, StatCard, StatusBadge, Table, TBody, Td, Th, THead } from "@/components/ui";
import { IconCheck, IconFile, IconReceipt, IconWallet } from "@/components/icons";
import { DownloadLink } from "../download-link";

export const metadata: Metadata = { title: "Tenant ledger" };

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ rental?: string; tenant?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const today = localToday();
  const forTenant = sp.tenant ? await tenantName(sp.tenant) : null;
  const options = await ledgerOptions(forTenant ? sp.tenant : undefined);
  const selected = options.find((o) => o.id === sp.rental)?.id ?? options[0]?.id ?? "";
  const data = selected ? await loadLedger(selected, today) : null;

  return (
    <>
      <PageHeader
        back={forTenant ? { href: `/tenants/${sp.tenant}`, label: forTenant } : { href: "/reports", label: "Reports" }}
        title="Tenant ledger"
        description="Every month's rent and charges, what was paid and the running balance, plus payments and the security deposit."
        actions={
          data && (
            <>
              <DownloadLink href={`/api/reports/ledger?rental=${selected}&format=pdf`} label="Download PDF" primary />
              <DownloadLink href={`/api/reports/ledger?rental=${selected}&format=xlsx`} label="Excel" />
            </>
          )
        }
      />

      {options.length === 0 ? (
        <Card>
          <EmptyState icon={<IconFile />} title="No rentals yet" description="A ledger appears once a tenant has a rental." />
        </Card>
      ) : (
        <>
          <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl bg-slate-100 p-3">
            {forTenant && <input type="hidden" name="tenant" value={sp.tenant} />}
            <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">
              Rental
              <select name="rental" defaultValue={selected} className="input mt-1">
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-primary">
              Show
            </button>
            {forTenant && (
              <Link href="/reports/ledger" className="btn btn-ghost">
                All tenants
              </Link>
            )}
          </form>

          {data && <Ledger data={data} />}
        </>
      )}
    </>
  );
}

function Ledger({ data }: { data: NonNullable<Awaited<ReturnType<typeof loadLedger>>> }) {
  const { rental: r, ledger } = data;
  const t = ledger.totals;
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        <Link href={`/tenants/${r.tenantId}`} className="link">
          {r.tenantName}
        </Link>{" "}
        ·{" "}
        <Link href={`/rentals/${r.id}`} className="link">
          {r.propertyName}
        </Link>{" "}
        · {formatStay(r.moveInDate, r.moveOutDate)}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total due" value={formatMoney(t.due)} hint={`Rent ${formatMoney(t.rent)} + charges ${formatMoney(t.charges)}`} icon={<IconReceipt />} />
        <StatCard label="Total paid" value={formatMoney(t.paid)} icon={<IconCheck />} tone="emerald" />
        <StatCard
          label={t.outstanding < 0 ? "Paid in advance" : "Outstanding"}
          value={formatMoney(Math.abs(t.outstanding))}
          hint={t.overdue > 0 ? `${formatMoney(t.overdue)} overdue` : undefined}
          icon={<IconWallet />}
          tone={t.outstanding > 0 ? "rose" : "brand"}
        />
        <StatCard label="Deposit held" value={formatMoney(ledger.depositHeld)} icon={<IconWallet />} tone="amber" />
      </div>

      <Card title="Month by month" bodyClassName="p-0">
        {ledger.months.length === 0 ? (
          <EmptyState compact icon={<IconFile />} title="No rent months yet" />
        ) : (
          <Table>
            <THead>
              <Th>Month</Th>
              <Th className="text-right">Rent</Th>
              <Th className="text-right">Charges</Th>
              <Th className="text-right">Due</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
              <Th className="text-right">Running</Th>
            </THead>
            <TBody>
              {ledger.months.map((m) => (
                <tr key={m.month}>
                  <Td className="whitespace-nowrap">
                    {formatMonth(m.month)}
                    <span className="block text-xs text-slate-500">due {formatDate(m.dueDate)}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(m.rent)}</Td>
                  <Td className="text-right tabular-nums">
                    {m.charges > 0 ? formatMoney(m.charges) : <span className="text-slate-400">—</span>}
                    {m.chargeItems.length > 0 && (
                      <span className="block text-xs text-slate-500">{m.chargeItems.map((c) => c.label).join(", ")}</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(m.due)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(m.paid)}</Td>
                  <Td className={`text-right tabular-nums ${m.balance > 0 ? "text-rose-600" : "text-slate-400"}`}>{formatMoney(m.balance)}</Td>
                  <Td>
                    <StatusBadge status={m.status} />
                  </Td>
                  <Td className="text-right font-medium tabular-nums">{formatMoney(m.outstanding)}</Td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <Td>Total</Td>
                <Td className="text-right tabular-nums">{formatMoney(t.rent)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(t.charges)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(t.due)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(t.paid)}</Td>
                <Td />
                <Td />
                <Td className="text-right tabular-nums">{formatMoney(t.outstanding)}</Td>
              </tr>
            </TBody>
          </Table>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Payments" bodyClassName="p-0">
          {ledger.payments.length === 0 ? (
            <EmptyState compact icon={<IconWallet />} title="No payments recorded" />
          ) : (
            <Table>
              <THead>
                <Th>Paid on</Th>
                <Th>For</Th>
                <Th className="text-right">Amount</Th>
                <Th>Method</Th>
              </THead>
              <TBody>
                {ledger.payments.map((p, i) => (
                  <tr key={i}>
                    <Td className="whitespace-nowrap">{formatDate(p.paidOn)}</Td>
                    <Td className="whitespace-nowrap">{formatMonth(p.forMonth)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(p.amount)}</Td>
                    <Td>{titleCase(p.method)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card title="Security deposit" bodyClassName="p-0">
          {ledger.deposit.length === 0 ? (
            <EmptyState compact icon={<IconWallet />} title="No deposit entries" />
          ) : (
            <Table>
              <THead>
                <Th>Date</Th>
                <Th>Entry</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Held after</Th>
              </THead>
              <TBody>
                {ledger.deposit.map((d, i) => (
                  <tr key={i}>
                    <Td className="whitespace-nowrap">{formatDate(d.date)}</Td>
                    <Td>
                      {d.label}
                      {d.reason && <span className="block text-xs text-slate-500">{d.reason}</span>}
                    </Td>
                    <Td className={`text-right tabular-nums ${d.kind === "received" ? "text-emerald-700" : "text-rose-600"}`}>
                      {d.kind === "received" ? "+" : "−"}
                      {formatMoney(d.amount)}
                    </Td>
                    <Td className="text-right tabular-nums">{formatMoney(d.held)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
