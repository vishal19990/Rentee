import { disableTenantPortal, enableTenantPortal, inviteTenantToPortal } from "@/app/(admin)/tenants/portal-actions";
import { formatDate, formatDateTime } from "@/lib/format";
import { NO_PHONE_FOR_INVITE, portalStatus, type PortalAccount } from "@/lib/portal-auth";
import { normalizePhone } from "@/lib/whatsapp";
import { ConfirmAction } from "./form";
import { TenantPortalInvite } from "./tenant-portal-invite";
import { Badge, Card } from "./ui";

/** Admin tenant page: the tenant's portal account (invite link, status, disable / enable). */
export function TenantPortalCard({ tenantId, phone, portal }: { tenantId: string; phone: string; portal: PortalAccount | null | undefined }) {
  const status = portalStatus(portal);
  const hasPhone = normalizePhone(phone) !== null;
  const canInvite = status.kind !== "disabled";

  return (
    <Card title="Tenant portal" description="The tenant signs in at /portal with their phone number and a password.">
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {status.kind === "not_invited" && <Badge tone="slate">Not invited</Badge>}
          {status.kind === "invited" && (
            <>
              <Badge tone="sky">Invited</Badge>
              <span className="text-slate-500">Link expires {formatDate(status.expiresAt)}</span>
            </>
          )}
          {status.kind === "invite_expired" && (
            <>
              <Badge tone="amber">Invite expired</Badge>
              <span className="text-slate-500">on {formatDate(status.expiredAt)}</span>
            </>
          )}
          {status.kind === "active" && (
            <>
              <Badge tone="emerald">Active</Badge>
              <span className="text-slate-500">{status.lastLoginAt ? `Last login ${formatDateTime(status.lastLoginAt)}` : "Never signed in"}</span>
              {status.pendingInviteExpiresAt && <span className="text-slate-500">· new invite pending (expires {formatDate(status.pendingInviteExpiresAt)})</span>}
            </>
          )}
          {status.kind === "disabled" && <Badge tone="rose">Disabled</Badge>}
        </p>

        {portal?.passwordHash && portal.loginPhone && <p className="text-xs text-slate-500">Signs in with phone +{portal.loginPhone}</p>}

        {!hasPhone &&<p className="text-sm text-amber-700">{NO_PHONE_FOR_INVITE} (edit the tenant) to invite them.</p>}

        {canInvite && (
          <TenantPortalInvite
            action={inviteTenantToPortal.bind(null, tenantId)}
            label={status.kind === "not_invited" ? "Invite" : status.kind === "active" ? "Send new invite (password reset)" : "Send new invite"}
          />
        )}

        <div className="flex flex-wrap gap-2">
          {(status.kind === "active" || status.kind === "invited") && (
            <ConfirmAction
              action={disableTenantPortal.bind(null, tenantId)}
              label="Disable access"
              confirmLabel="Disable"
              prompt="Sign them out everywhere?"
              variant="danger"
            />
          )}
          {status.kind === "disabled" && <ConfirmAction action={enableTenantPortal.bind(null, tenantId)} label="Enable" confirmLabel="Enable" variant="primary" />}
        </div>
      </div>
    </Card>
  );
}
