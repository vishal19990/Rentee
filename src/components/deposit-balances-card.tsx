import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { Badge, Card } from "@/components/ui";
import { TenantAvatar } from "@/components/tenant-avatar";

/**
 * Dashboard card: rentals with part of the security deposit still to be paid (count, total and
 * the five largest balances). Hidden when every deposit is fully paid.
 */
export function DepositBalancesCard({
  rentals,
  className,
}: {
  rentals: { id: string; propertyName: string; tenantId: string; tenantName: string; tenantPhoto: string | null; depositBalance: number }[];
  className?: string;
}) {
  const due = rentals.filter((r) => r.depositBalance > 0).sort((a, b) => b.depositBalance - a.depositBalance);
  if (due.length === 0) return null;
  const total = due.reduce((s, r) => s + r.depositBalance, 0);
  return (
    <Card
      title="Deposit balances"
      description={`${due.length} rental${due.length === 1 ? "" : "s"} · ${formatMoney(total)} of deposit still due`}
      className={className}
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-slate-100">
        {due.slice(0, 5).map((r) => (
          <li key={r.id}>
            <Link href={`/rentals/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
              <div className="flex min-w-0 items-center gap-3">
                <TenantAvatar tenantId={r.tenantId} photo={r.tenantPhoto} name={r.tenantName} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{r.propertyName}</p>
                  <p className="truncate text-xs text-slate-500">{r.tenantName}</p>
                </div>
              </div>
              <Badge tone="amber">{formatMoney(r.depositBalance)}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
