import Link from "next/link";
import { agreementsNeedingAttention } from "@/lib/agreement-data";
import { formatDate } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";
import { AgreementStatusBadge } from "@/components/agreement-card";
import { IconFile } from "@/components/icons";

/** Dashboard card (F8): active rentals whose latest agreement is expiring or already expired. */
export async function AgreementsExpiringCard({
  rentals,
  today,
  className,
}: {
  rentals: { id: string; status: string; propertyName: string; tenantName: string }[];
  today: string;
  className?: string;
}) {
  const { items, thresholdDays } = await agreementsNeedingAttention(rentals, today);
  return (
    <Card title="Agreements expiring" description={`Ending within ${thresholdDays} days, or expired`} className={className} bodyClassName="p-0">
      {items.length === 0 ? (
        <EmptyState compact icon={<IconFile />} title="No agreements need renewal" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map(({ rental, agreement, status }) => (
            <li key={rental.id}>
              <Link href={`/rentals/${rental.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{rental.propertyName}</p>
                  <p className="truncate text-xs text-slate-500">
                    {rental.tenantName} · {status === "expired" ? "ended" : "ends"} {formatDate(agreement.endDate)}
                  </p>
                </div>
                <AgreementStatusBadge status={status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
