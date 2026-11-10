import type { Metadata } from "next";
import { Badge, Card, EmptyState } from "@/components/ui";
import { IconFile, IconPaperclip } from "@/components/icons";
import { agreementStatus } from "@/lib/agreements";
import { getAgreementExpiryDays } from "@/lib/agreement-data";
import { DOCUMENT_TYPE_LABELS, formatFileSize, type DocumentType } from "@/lib/documents";
import { formatDate } from "@/lib/format";
import { myAgreements, myDocuments, myRentalIds, myRentals } from "@/lib/portal-data";
import { localToday } from "@/lib/rent";
import { requireTenant } from "@/lib/tenant-auth";

export const metadata: Metadata = { title: "Documents" };

const AGREEMENT_TONE = { active: "emerald", expiring: "amber", expired: "rose" } as const;

export default async function PortalDocuments() {
  const me = await requireTenant();
  const today = localToday();
  const [rentals, rentalIds, documents, expiryDays] = await Promise.all([myRentals(me, today), myRentalIds(me), myDocuments(me), getAgreementExpiryDays()]);
  const docById = new Map(documents.map((d) => [d.id, d]));
  const agreements = await myAgreements(rentalIds, new Set(docById.keys()));
  const propName = new Map(rentals.map((r) => [r.id, r.propertyName]));
  const allAgreements = [...agreements.values()].flat();

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Documents</h1>

      <Card title="Rental agreements" bodyClassName="p-0">
        {allAgreements.length === 0 ? (
          <EmptyState compact icon={<IconFile />} title="No agreement recorded yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {allAgreements.map((a) => {
              const status = agreementStatus(a, today, expiryDays);
              const doc = a.documentId ? docById.get(a.documentId) : null;
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      {propName.get(a.rentalId) ?? "Agreement"}
                      <Badge tone={AGREEMENT_TONE[status]}>{status === "active" ? "Active" : status === "expiring" ? "Ending soon" : "Ended"}</Badge>
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(a.startDate)} – {formatDate(a.endDate)}
                    </p>
                  </div>
                  {doc ? (
                    <a href={`/portal/api/documents/${doc.id}?download=1`} className="btn btn-secondary btn-sm">
                      <IconPaperclip className="size-3.5" /> Download
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">No signed copy uploaded</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="My documents" bodyClassName="p-0">
        {documents.length === 0 ? (
          <EmptyState compact icon={<IconPaperclip />} title="No documents yet" description="Documents your landlord keeps for you (ID proofs, agreements) appear here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{d.title}</p>
                  <p className="text-xs text-slate-500">
                    {DOCUMENT_TYPE_LABELS[d.type as DocumentType] ?? d.type} · {formatFileSize(d.size)} · {formatDate(d.uploadedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <a href={`/portal/api/documents/${d.id}`} target="_blank" rel="noopener" className="btn btn-ghost btn-sm">
                    View
                  </a>
                  <a href={`/portal/api/documents/${d.id}?download=1`} className="btn btn-secondary btn-sm">
                    Download
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
