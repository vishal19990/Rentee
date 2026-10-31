import { listGrants, recentAudit } from "@/lib/oauth/store";
import { SCOPE_WRITE } from "@/lib/oauth/core";
import { formatDateTime, relativeTime } from "@/lib/format";
import { ConfirmAction } from "@/components/form";
import { Badge, Card } from "@/components/ui";
import { revokeConnectedApp } from "@/app/(admin)/settings/connected-apps-actions";

/**
 * Settings card: apps connected through the MCP connector (OAuth grants) with Revoke, and the
 * last 20 changes they made.
 */
export async function ConnectedAppsCard({ className }: { className?: string }) {
  const [grants, audit] = await Promise.all([listGrants(), recentAudit(20)]);
  const now = new Date();
  return (
    <Card
      title="Connected apps"
      description="Apps such as Claude that you allowed to use Rentee through the MCP connector (/api/mcp). Revoking disconnects them immediately."
      className={className}
      bodyClassName="p-0"
    >
      {grants.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">No apps connected.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {grants.map((g) => (
            <li key={g.family} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                  {g.clientName}
                  <Badge tone={g.scopes.includes(SCOPE_WRITE) ? "amber" : "slate"}>
                    {g.scopes.includes(SCOPE_WRITE) ? "Read & changes" : "Read only"}
                  </Badge>
                </p>
                <p className="text-xs text-slate-500">
                  Allowed by {g.userName} · {formatDateTime(g.grantedAt)} · {g.lastUsedAt ? `last used ${relativeTime(g.lastUsedAt, now)}` : "not used yet"}
                </p>
              </div>
              <ConfirmAction
                action={revokeConnectedApp}
                hidden={{ grant: g.family }}
                label="Revoke"
                confirmLabel="Revoke"
                prompt={`Disconnect ${g.clientName}?`}
                variant="danger"
              />
            </li>
          ))}
        </ul>
      )}
      {audit.length > 0 && (
        <div className="border-t border-slate-100 px-5 py-4">
          <p className="label">Recent changes by connected apps</p>
          <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-2">
                <span className="text-slate-400">{formatDateTime(a.at)}</span>
                <span className="font-medium text-slate-800">{a.tool}</span>
                <span className={a.ok ? "" : "text-rose-600"}>{a.summary}</span>
                <span className="text-slate-400">
                  · {a.clientName} for {a.userName}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
