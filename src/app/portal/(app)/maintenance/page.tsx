import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, StatusBadge } from "@/components/ui";
import { IconCheck, IconImage, IconPlus, IconWrench } from "@/components/icons";
import { formatDate } from "@/lib/format";
import { myMaintenance, myRentals } from "@/lib/portal-data";
import { localToday } from "@/lib/rent";
import { requireTenant } from "@/lib/tenant-auth";

export const metadata: Metadata = { title: "Repairs" };

export default async function PortalMaintenance({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const me = await requireTenant();
  const { sent } = await searchParams;
  const rentals = await myRentals(me, localToday());
  const canRequest = rentals.some((r) => r.status === "active");
  const items = await myMaintenance(me, rentals);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Repairs</h1>
          <p className="mt-0.5 text-sm text-slate-500">Report a problem and follow its progress.</p>
        </div>
        {canRequest && (
          <Link href="/portal/maintenance/new" className="btn btn-primary">
            <IconPlus className="size-4" /> New request
          </Link>
        )}
      </div>

      {sent === "1" && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
          <IconCheck className="size-4" /> Request sent. Your landlord has been notified.
        </p>
      )}

      <Card bodyClassName="p-0">
        {items.length === 0 ? (
          <EmptyState compact icon={<IconWrench />} title="No requests yet" description={canRequest ? "Something broken? Tap New request." : undefined} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((m) => (
              <li key={m.id} className="space-y-1.5 px-5 py-3.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{m.title}</p>
                  <StatusBadge status={m.status} />
                </div>
                {m.description && <p className="text-slate-600 whitespace-pre-line">{m.description}</p>}
                <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <StatusBadge status={m.priority} />
                  <span>
                    {m.propertyName} · {formatDate(m.createdAt)}
                  </span>
                  {!m.mine && <Badge tone="slate">From landlord</Badge>}
                  {m.hasPhoto && (
                    <a href={`/portal/api/maintenance/${m.id}/photo`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                      <IconImage className="size-3.5" /> Photo
                    </a>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
