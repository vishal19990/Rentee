import { Types } from "mongoose";
import { getAgreementExpiryDays, loadAgreements, type AgreementRow } from "@/lib/agreement-data";
import { agreementStatus, defaultAgreementEnd, latestAgreement, renewalStart, type AgreementStatus } from "@/lib/agreements";
import { toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@/lib/documents";
import { formatDate } from "@/lib/format";
import { daysBetween } from "@/lib/notifications";
import { localToday } from "@/lib/rent";
import { TenantDocument } from "@/models/TenantDocument";
import { ActionForm, ConfirmAction, Hidden, SelectField, SubmitButton, TextField } from "@/components/form";
import { Badge, Card, EmptyState, type BadgeTone } from "@/components/ui";
import { documentUrl } from "@/components/documents-card";
import { IconFile, IconTrash } from "@/components/icons";
import { addAgreement, deleteAgreement, setAgreementDocument } from "@/app/(admin)/rentals/agreement-actions";

const STATUS: Record<AgreementStatus, { tone: BadgeTone; label: string }> = {
  active: { tone: "emerald", label: "Active" },
  expiring: { tone: "amber", label: "Expiring" },
  expired: { tone: "rose", label: "Expired" },
};

export function AgreementStatusBadge({ status }: { status: AgreementStatus }) {
  return (
    <Badge tone={STATUS[status].tone} dot>
      {STATUS[status].label}
    </Badge>
  );
}

function timeLeft(a: AgreementRow, today: string): string {
  if (a.startDate > today) return `Starts ${formatDate(a.startDate)}`;
  const days = daysBetween(today, a.endDate);
  if (days < 0) return `Ended ${-days} day${days === -1 ? "" : "s"} ago`;
  if (days === 0) return "Ends today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

/**
 * Rental agreement (F8): current agreement with status, renew / add, linked signed copy, history.
 * Server component: loads its own data so the rental page only needs `<AgreementCard rental=… />`.
 */
export async function AgreementCard({
  rental,
}: {
  rental: { id: string; tenantId: string; moveInDate: string; status: "active" | "moved_out" };
}) {
  await connectDB();
  const today = localToday();
  const [byRental, thresholdDays, docs] = await Promise.all([
    loadAgreements([rental.id]),
    getAgreementExpiryDays(),
    TenantDocument.find({ tenant: new Types.ObjectId(rental.tenantId) }).sort({ uploadedAt: -1 }).select("title type").lean(),
  ]);
  const agreements = byRental.get(rental.id) ?? [];
  const current = latestAgreement(agreements);
  const history = agreements.filter((a) => a.id !== current?.id);
  const docTitle = new Map(docs.map((d) => [toId(d._id), d.title]));
  const docOptions = [...docs]
    .sort((a, b) => Number(b.type === "agreement") - Number(a.type === "agreement"))
    .map((d) => ({ value: toId(d._id), label: `${d.title} (${DOCUMENT_TYPE_LABELS[d.type as DocumentType] ?? d.type})` }));
  const active = rental.status === "active";
  const nextStart = current ? renewalStart(current) : null;

  const docLink = (a: AgreementRow) =>
    a.documentId && docTitle.has(a.documentId) ? (
      <a href={documentUrl(a.documentId)} target="_blank" rel="noreferrer" className="link">
        {docTitle.get(a.documentId)}
      </a>
    ) : null;

  return (
    <Card
      title="Agreement"
      description={`Usually 11 months. Rentee reminds you ${thresholdDays} days before it ends.`}
    >
      {current ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">
              {formatDate(current.startDate)} – {formatDate(current.endDate)}
            </p>
            <AgreementStatusBadge status={agreementStatus(current, today, thresholdDays)} />
          </div>
          <p className="text-xs text-slate-500">{timeLeft(current, today)}</p>
          <div className="text-sm text-slate-600">
            Signed copy: {docLink(current) ?? <span className="text-slate-400">not linked</span>}
          </div>
          {docOptions.length > 0 && (
            <ActionForm action={setAgreementDocument.bind(null, rental.id)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Hidden name="agreementId" value={current.id} />
              <SelectField
                name="documentId"
                label="Link document"
                placeholder="None"
                defaultValue={current.documentId ?? ""}
                options={docOptions}
                className="flex-1"
              />
              <SubmitButton variant="secondary">Save</SubmitButton>
            </ActionForm>
          )}
          <div className="flex justify-end">
            <ConfirmAction
              action={deleteAgreement.bind(null, rental.id)}
              hidden={{ agreementId: current.id }}
              label="Delete"
              confirmLabel="Delete"
              prompt="Delete this agreement?"
              variant="ghost"
              icon={<IconTrash className="size-3.5" />}
            />
          </div>
        </div>
      ) : (
        <EmptyState compact icon={<IconFile />} title="No agreement recorded" description={active ? "Add the current agreement to get renewal reminders." : undefined} />
      )}

      {active && (
        <ActionForm action={addAgreement.bind(null, rental.id)} className="mt-5 space-y-4 border-t border-slate-100 pt-5">
          <p className="text-sm font-medium text-slate-900">{current ? "Renew agreement" : "Add agreement"}</p>
          {nextStart ? (
            <p className="text-xs text-slate-500">Starts {formatDate(nextStart)}, the day after the current agreement ends.</p>
          ) : (
            <TextField name="startDate" label="Start date" type="date" defaultValue={rental.moveInDate} />
          )}
          <TextField
            name="endDate"
            label="End date"
            type="date"
            defaultValue={nextStart ? defaultAgreementEnd(nextStart) : ""}
            min={nextStart ?? undefined}
            hint="Leave empty for 11 months (start + 11 months − 1 day)."
          />
          {docOptions.length > 0 && (
            <SelectField name="documentId" label="Signed copy" placeholder="None" options={docOptions} hint="Upload documents on the tenant page." />
          )}
          <SubmitButton className="w-full" variant={current ? "primary" : "secondary"}>
            {current ? "Renew agreement" : "Add agreement"}
          </SubmitButton>
        </ActionForm>
      )}

      {history.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-3">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">History</p>
          <ul className="mt-2 space-y-2 text-sm text-slate-600">
            {history.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {formatDate(a.startDate)} – {formatDate(a.endDate)}
                  {docLink(a) && <> · {docLink(a)}</>}
                </span>
                <AgreementStatusBadge status={agreementStatus(a, today, thresholdDays)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
