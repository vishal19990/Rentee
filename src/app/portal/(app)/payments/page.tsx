import type { Metadata } from "next";
import { Card, EmptyState, StatusBadge } from "@/components/ui";
import { IconReceipt, IconWallet } from "@/components/icons";
import { formatDate, formatStay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { myDeposits, myPayments, myRentals } from "@/lib/portal-data";
import { formatCycle, localToday } from "@/lib/rent";
import { requireTenant } from "@/lib/tenant-auth";
import { Types } from "mongoose";

export const metadata: Metadata = { title: "Payments" };

export default async function PortalPayments() {
  const me = await requireTenant();
  const today = localToday();
  const rentals = await myRentals(me, today);
  const [payments, deposits] = await Promise.all([
    myPayments(rentals.map((r) => new Types.ObjectId(r.id))),
    myDeposits(rentals),
  ]);
  const multi = rentals.length > 1;
  const propName = new Map(rentals.map((r) => [r.id, r.propertyName]));

  if (rentals.length === 0) {
    return <EmptyState icon={<IconWallet />} title="No rentals yet" description="Your rent schedule and receipts will show here." />;
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Payments</h1>

      {rentals.map((r) => (
        <Card key={r.id} title={`Rent schedule${multi ? ` · ${r.propertyName}` : ""}`} description={formatStay(r.moveInDate, r.moveOutDate)} bodyClassName="p-0">
          <ul className="divide-y divide-slate-100">
            {[...r.schedule].reverse().map((m) => (
              <li key={m.month} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{formatCycle(m)}</p>
                  <p className="text-xs text-slate-500">
                    Due {formatDate(m.dueDate)} · {formatMoney(m.due)}
                    {m.charges > 0 && ` (rent ${formatMoney(m.rent)} + ${m.chargeItems.map((c) => c.label ?? c.type).join(", ")})`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge status={m.status} />
                  <span className="text-xs text-slate-500 tabular-nums">Paid {formatMoney(m.paid)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Card title="Payments received" bodyClassName="p-0">
        {payments.length === 0 ? (
          <EmptyState compact icon={<IconReceipt />} title="No payments yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {payments.map((p) => {
              const r = rentals.find((x) => x.id === p.rentalId);
              const cycle = r?.schedule.find((m) => m.month === p.forMonth);
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 tabular-nums">{formatMoney(p.amount)}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(p.paidOn)} · {p.method}
                      {cycle ? ` · for ${formatCycle(cycle, { short: true })}` : ""}
                      {multi ? ` · ${propName.get(p.rentalId)}` : ""}
                    </p>
                  </div>
                  <a href={`/portal/api/receipts/${p.id}`} className="btn btn-secondary btn-sm shrink-0">
                    Receipt
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {rentals.map((r) => {
        const d = deposits.get(r.id);
        if (!d || (d.status.agreed === 0 && d.entries.length === 0)) return null;
        return (
          <Card
            key={`dep-${r.id}`}
            title={`Security deposit${multi ? ` · ${r.propertyName}` : ""}`}
            description={`Quoted ${formatMoney(d.status.agreed)} · paid ${formatMoney(d.status.received)} · balance ${formatMoney(d.status.balance)} · held ${formatMoney(Math.max(d.summary.held, 0))}`}
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-slate-100">
              {d.entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {e.label} · <span className="tabular-nums">{formatMoney(e.amount)}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(e.date)}
                      {e.kind !== "received" && e.reason ? ` · ${e.reason}` : ""}
                    </p>
                  </div>
                  {e.kind === "received" && (
                    <a href={`/portal/api/deposit-receipts/${e.id}`} className="btn btn-secondary btn-sm shrink-0">
                      Receipt
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
