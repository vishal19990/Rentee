import { formatMoney } from "@/lib/money";
import { formatMonth } from "@/lib/rent";
import { wifiMonthSummary, type WifiPlanLike } from "@/lib/wifi";
import { Card } from "@/components/ui";
import { IconWifi } from "@/components/wifi-card";

/** Dashboard card: people on WiFi this month, the month's WiFi amount and rentals with WiFi. Hidden when none. */
export function WifiDashboardCard({
  rentals,
  month,
  className,
}: {
  rentals: { wifiPlans: WifiPlanLike[]; moveInDate: string; moveOutDate: string | null }[];
  month: string;
  className?: string;
}) {
  const s = wifiMonthSummary(rentals, month);
  if (s.rentals === 0) return null;
  return (
    <Card title="WiFi" description={`${formatMonth(month)} · charged per person`} className={className} actions={<IconWifi className="size-5 text-slate-400" />}>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-slate-500">People</dt>
          <dd className="text-lg font-semibold text-slate-900 tabular-nums">{s.people}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">This month</dt>
          <dd className="text-lg font-semibold text-slate-900 tabular-nums">{formatMoney(s.amount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Rentals</dt>
          <dd className="text-lg font-semibold text-slate-900 tabular-nums">{s.rentals}</dd>
        </div>
      </dl>
    </Card>
  );
}
