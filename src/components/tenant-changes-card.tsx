import { formatDateTime } from "@/lib/format";
import { CHANGE_FIELD_LABELS, type ChangeField } from "@/lib/portal-scope";
import { Card } from "./ui";

export type TenantChangeRow = { id: string; field: string; from: string; to: string; at: Date };

/** Admin tenant page: changes the tenant made to their own details in the portal. */
export function TenantChangesCard({ changes }: { changes: TenantChangeRow[] }) {
  if (changes.length === 0) return null;
  return (
    <Card title="Recent changes by tenant" description="Made by the tenant in the tenant portal.">
      <ul className="divide-y divide-slate-100 text-sm">
        {changes.map((c) => (
          <li key={c.id} className="py-2.5">
            <p className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-slate-900">{CHANGE_FIELD_LABELS[c.field as ChangeField] ?? c.field}</span>
              <span className="text-xs text-slate-400">{formatDateTime(c.at)}</span>
            </p>
            {c.field === "password" ? (
              <p className="text-xs text-slate-500">Password changed</p>
            ) : (
              <p className="text-xs break-words text-slate-600">
                {c.from ? <span className="text-slate-400 line-through">{c.from}</span> : null}
                {c.from && c.to ? " → " : null}
                {c.to}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
