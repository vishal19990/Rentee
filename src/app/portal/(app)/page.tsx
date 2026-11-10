import type { Metadata } from "next";
import Link from "next/link";
import { PayByUpi } from "@/components/portal/pay-by-upi";
import { Badge, Card, StatusBadge } from "@/components/ui";
import { IconHome } from "@/components/icons";
import { formatDate, formatStay } from "@/lib/format";
import { getUpiSettings } from "@/lib/landlord-settings";
import { formatMoney } from "@/lib/money";
import { myDeposits, myRentals } from "@/lib/portal-data";
import { firstName } from "@/lib/receipts";
import { formatCycle, localToday, rentalBadge } from "@/lib/rent";
import { requireTenant } from "@/lib/tenant-auth";
import { payDue } from "@/lib/upi";
import { activePlan, wifiPlanAmount } from "@/lib/wifi";

export const metadata: Metadata = { title: "My home" };

export default async function PortalHome() {
  const me = await requireTenant();
  const today = localToday();
  const rentals = await myRentals(me, today);
  const current = rentals.filter((r) => r.status === "active");
  const past = rentals.filter((r) => r.status !== "active");
  const [upi, deposits] = await Promise.all([getUpiSettings(), myDeposits(current)]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Hi {firstName(me.name)}</h1>
        <p className="mt-0.5 text-sm text-slate-500">Here's your rent at a glance.</p>
      </div>

      {current.length === 0 && (
        <Card>
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <IconHome className="size-4" /> You have no current rental.
          </p>
        </Card>
      )}

      {current.map((r) => {
        const cycle = r.schedule.find((m) => m.start <= today && today <= m.end) ?? r.schedule.find((m) => m.dueDate >= today) ?? null;
        const due = payDue(r, null, today);
        const deposit = deposits.get(r.id)?.status;
        const wifi = activePlan(r.wifiPlans, today.slice(0, 7));
        return (
          <Card
            key={r.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {r.propertyName} <StatusBadge status={rentalBadge(r)} />
              </span>
            }
            description={`Since ${formatDate(r.moveInDate)}${r.moveOutDate ? ` · moving out ${formatDate(r.moveOutDate)}` : ""}`}
          >
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                  <dt className="text-xs text-slate-500">Monthly rent</dt>
                  <dd className="mt-0.5 text-lg font-semibold text-slate-900 tabular-nums">{formatMoney(r.currentRent)}</dd>
                </div>
                <div className={r.summary.overdueAmount > 0 ? "rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200" : "rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200"}>
                  <dt className="text-xs text-slate-500">Overdue</dt>
                  <dd className={r.summary.overdueAmount > 0 ? "mt-0.5 text-lg font-semibold text-rose-700 tabular-nums" : "mt-0.5 text-lg font-semibold text-emerald-700"}>
                    {r.summary.overdueAmount > 0 ? formatMoney(r.summary.overdueAmount) : "Nothing"}
                  </dd>
                </div>
              </dl>
              {cycle && (
                <p className="text-sm text-slate-600">
                  Current period <span className="font-medium text-slate-900">{formatCycle(cycle)}</span> · due{" "}
                  <span className="font-medium text-slate-900">{formatDate(cycle.dueDate)}</span> ({formatMoney(cycle.due)})
                </p>
              )}
              {due.amount > 0 ? (
                <p className="text-sm">
                  <span className="font-semibold text-slate-900">Due now: {formatMoney(due.amount)}</span>
                  <span className="text-slate-500"> for {due.months.map((m) => formatCycle(m)).join(", ")}</span>
                </p>
              ) : (
                <p className="text-sm font-medium text-emerald-700">Nothing due right now. Thank you!</p>
              )}
              {due.amount > 0 && upi.enabled && <PayByUpi amount={due.amount} months={due.months} propertyName={r.propertyName} upi={upi} />}
              {deposit && deposit.agreed > 0 && (
                <div className="text-sm">
                  <p className="font-medium text-slate-900">Security deposit</p>
                  <p className="mt-0.5 text-slate-600">
                    Quoted {formatMoney(deposit.agreed)} · paid {formatMoney(deposit.received)}
                    {deposit.balance > 0 ? (
                      <>
                        {" "}
                        · <Badge tone="amber">Balance {formatMoney(deposit.balance)}</Badge>
                      </>
                    ) : (
                      <> · fully paid</>
                    )}
                  </p>
                </div>
              )}
              {wifi && (
                <p className="text-sm text-slate-600">
                  WiFi: {wifi.people.length} {wifi.people.length === 1 ? "person" : "people"} × {formatMoney(wifi.ratePerPerson)} ={" "}
                  {formatMoney(wifiPlanAmount(wifi))}/month
                </p>
              )}
              <Link href="/portal/payments" className="link text-sm">
                See rent schedule and receipts →
              </Link>
            </div>
          </Card>
        );
      })}

      {past.length > 0 && (
        <Card title="Past">
          <ul className="divide-y divide-slate-100 text-sm">
            {past.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  <span className="font-medium text-slate-900">{r.propertyName}</span>
                  <span className="block text-xs text-slate-500">{formatStay(r.moveInDate, r.moveOutDate)}</span>
                </span>
                {r.summary.overdueAmount > 0 ? <Badge tone="rose">Owed {formatMoney(r.summary.overdueAmount)}</Badge> : <StatusBadge status="moved_out" />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
