import { Types } from "mongoose";
import { toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { DOCUMENT_ACCEPT, DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, formatFileSize, type DocumentType } from "@/lib/documents";
import { formatDate, formatStay } from "@/lib/format";
import { toISODate } from "@/lib/rent";
import { Property } from "@/models/Property";
import { Rental } from "@/models/Rental";
import { TenantDocument } from "@/models/TenantDocument";
import { ActionForm, ConfirmAction, FileField, SelectField, SubmitButton, TextField } from "@/components/form";
import { Badge, Card, EmptyState } from "@/components/ui";
import { IconFile, IconTrash } from "@/components/icons";
import { deleteTenantDocument, uploadTenantDocument } from "@/app/(admin)/tenants/document-actions";

export function documentUrl(id: string, download = false): string {
  return `/api/documents/${id}${download ? "?download=1" : ""}`;
}

/**
 * Tenant documents (F7): list, view/download (authenticated route), delete, upload.
 * Server component: loads its own data so the tenant page only needs `<DocumentsCard tenantId=… />`.
 */
export async function DocumentsCard({ tenantId }: { tenantId: string }) {
  await connectDB();
  const tenant = new Types.ObjectId(tenantId);
  const [docs, rentals] = await Promise.all([
    TenantDocument.find({ tenant }).sort({ uploadedAt: -1 }).lean(),
    Rental.find({ tenant }).sort({ moveInDate: -1 }).select("property moveInDate moveOutDate").lean(),
  ]);
  const props = await Property.find({ _id: { $in: rentals.map((r) => r.property) } }).select("name").lean();
  const propName = new Map(props.map((p) => [toId(p._id), p.name]));
  const rentalLabel = new Map(
    rentals.map((r) => [
      toId(r._id),
      `${propName.get(toId(r.property)) ?? "(deleted property)"} · ${formatStay(toISODate(r.moveInDate), r.moveOutDate ? toISODate(r.moveOutDate) : null)}`,
    ]),
  );

  return (
    <Card title="Documents" description="ID proofs, agreements and verification. Visible only to signed-in admins." bodyClassName="p-0">
      {docs.length === 0 ? (
        <EmptyState compact icon={<IconFile />} title="No documents yet" description="Upload Aadhaar, PAN, the signed agreement or police verification." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {docs.map((d) => {
            const id = toId(d._id);
            return (
              <li key={id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                    <a href={documentUrl(id)} target="_blank" rel="noreferrer" className="link break-all">
                      {d.title}
                    </a>
                    <Badge tone="slate">{DOCUMENT_TYPE_LABELS[d.type as DocumentType] ?? d.type}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDate(d.uploadedAt)} · {d.contentType === "application/pdf" ? "PDF" : d.contentType.replace("image/", "").toUpperCase()} ·{" "}
                    {formatFileSize(d.size)}
                    {d.rental && rentalLabel.get(toId(d.rental)) ? ` · ${rentalLabel.get(toId(d.rental))}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={documentUrl(id)} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                    View
                  </a>
                  <a href={documentUrl(id, true)} className="btn btn-secondary btn-sm">
                    Download
                  </a>
                  <ConfirmAction
                    action={deleteTenantDocument.bind(null, tenantId)}
                    hidden={{ documentId: id }}
                    label="Delete"
                    confirmLabel="Delete"
                    prompt="Delete document?"
                    variant="ghost"
                    icon={<IconTrash className="size-3.5" />}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ActionForm action={uploadTenantDocument.bind(null, tenantId)} className="space-y-4 border-t border-slate-100 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            name="type"
            label="Type"
            defaultValue="aadhaar"
            options={DOCUMENT_TYPES.map((t) => ({ value: t, label: DOCUMENT_TYPE_LABELS[t] }))}
          />
          <TextField name="title" label="Title" placeholder="Optional, e.g. Aadhaar (front)" />
          {rentals.length > 0 && (
            <SelectField
              name="rentalId"
              label="Rental"
              placeholder="Not linked to a rental"
              options={[...rentalLabel].map(([value, label]) => ({ value, label }))}
              className="sm:col-span-2"
            />
          )}
          <FileField name="file" label="File" accept={DOCUMENT_ACCEPT} hint="PDF, JPG, PNG or WebP up to 10 MB." className="sm:col-span-2" />
        </div>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Uploading…">Upload document</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
