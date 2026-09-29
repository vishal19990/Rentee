import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, loadRentals, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { formatDate, formatStay, titleCase } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { rentalBadge } from "@/lib/rent";
import { photoUrl } from "@/lib/uploads";
import { Maintenance } from "@/models/Maintenance";
import { Property } from "@/models/Property";
import { ActionForm, ConfirmAction, FileField, SubmitButton } from "@/components/form";
import {
  ButtonLink,
  Card,
  DetailList,
  EmptyState,
  PageHeader,
  StatusBadge,
  Table,
  TBody,
  Td,
  Th,
  THead,
} from "@/components/ui";
import { IconArchive, IconFile, IconImage, IconPencil, IconPlus, IconTrash, IconWrench } from "@/components/icons";
import {
  deleteProperty,
  removePropertyPhoto,
  setPropertyArchived,
  uploadPropertyPhoto,
} from "../actions";

export const metadata: Metadata = { title: "Property" };

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  await connectDB();
  const p = await Property.findById(_id).lean();
  if (!p) notFound();

  const [rentals, maintenance] = await Promise.all([
    loadRentals({ property: _id }),
    Maintenance.find({ property: _id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  const active = rentals.find((l) => l.status === "active");
  const occupancy = active ? "occupied" : "vacant";

  return (
    <>
      <PageHeader
        back={{ href: "/properties", label: "Properties" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {p.name}
            <StatusBadge status={occupancy} />
            {p.archived && <StatusBadge status="archived" />}
          </span>
        }
        description={`${p.address}, ${p.city}`}
        actions={
          <>
            {!active && !p.archived && (
              <ButtonLink href={`/rentals/new?propertyId=${id}`}>
                <IconPlus className="size-4" /> New rental
              </ButtonLink>
            )}
            <ButtonLink href={`/properties/${id}/edit`} variant="secondary">
              <IconPencil className="size-4" /> Edit
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Current rental" bodyClassName={active ? "p-5" : "p-0"}>
            {active ? (
              <div className="space-y-5">
                <DetailList
                  items={[
                    { label: "Tenant", value: <Link className="link" href={`/tenants/${active.tenantId}`}>{active.tenantName}</Link> },
                    { label: "Rent", value: `${formatMoney(active.monthlyRent)} / month, due day ${active.dueDay}` },
                    { label: "Moved in", value: formatDate(active.moveInDate) },
                    {
                      label: "Move-out",
                      value: active.moveOutDate ? `Scheduled ${formatDate(active.moveOutDate)}` : "Not scheduled (month-to-month)",
                    },
                    {
                      label: "Overdue",
                      value:
                        active.summary.overdueAmount > 0 ? (
                          <span className="font-semibold text-rose-600">
                            {formatMoney(active.summary.overdueAmount)} ({active.summary.overdueMonths} mo)
                          </span>
                        ) : (
                          <span className="text-emerald-600">Nothing overdue</span>
                        ),
                    },
                  ]}
                />
                <ButtonLink href={`/rentals/${active.id}`} variant="secondary" size="sm">
                  View rental & payments
                </ButtonLink>
              </div>
            ) : (
              <EmptyState
                compact
                icon={<IconFile />}
                title="This property is vacant"
                description={p.archived ? "Restore the property to create a new rental." : "Create a rental to assign a tenant."}
                action={
                  !p.archived ? (
                    <ButtonLink href={`/rentals/new?propertyId=${id}`} size="sm">
                      <IconPlus className="size-4" /> New rental
                    </ButtonLink>
                  ) : undefined
                }
              />
            )}
          </Card>

          <Card title="Photos" description="JPEG, PNG, WebP or GIF up to 5 MB.">
            {p.photos.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {p.photos.map((f) => (
                  <figure key={f} className="group relative overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
                    <a href={photoUrl(f)} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served by an authenticated route */}
                      <img src={photoUrl(f)} alt={`${p.name} photo`} className="aspect-[4/3] w-full object-cover" />
                    </a>
                    <figcaption className="flex justify-end p-1.5">
                      <ConfirmAction
                        action={removePropertyPhoto.bind(null, id)}
                        hidden={{ file: f }}
                        label="Remove"
                        prompt="Remove?"
                        confirmLabel="Remove"
                        variant="ghost"
                      />
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <EmptyState compact icon={<IconImage />} title="No photos yet" />
            )}
            <ActionForm
              action={uploadPropertyPhoto.bind(null, id)}
              className="mt-5 border-t border-slate-100 pt-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <FileField name="photo" label="Upload photo" accept="image/jpeg,image/png,image/webp,image/gif" className="flex-1" />
                <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
              </div>
            </ActionForm>
          </Card>

          <Card title="Rental history" bodyClassName="p-0">
            {rentals.length === 0 ? (
              <EmptyState compact icon={<IconFile />} title="No rentals yet" />
            ) : (
              <Table>
                <THead>
                  <Th>Tenant</Th>
                  <Th>Stay</Th>
                  <Th className="text-right">Rent</Th>
                  <Th>Status</Th>
                </THead>
                <TBody>
                  {rentals.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/60">
                      <Td>
                        <Link href={`/rentals/${l.id}`} className="link">
                          {l.tenantName}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap text-slate-600">
                        {formatStay(l.moveInDate, l.moveOutDate)}
                      </Td>
                      <Td className="text-right tabular-nums">{formatMoney(l.monthlyRent)}</Td>
                      <Td>
                        <StatusBadge status={rentalBadge(l)} />
                      </Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Details">
            <DetailList
              items={[
                { label: "Type", value: titleCase(p.type) },
                { label: "Asking rent", value: formatMoney(p.monthlyRent) },
                { label: "Bedrooms", value: String(p.bedrooms) },
                { label: "Bathrooms", value: String(p.bathrooms) },
              ]}
            />
            {p.notes && <p className="mt-5 text-sm whitespace-pre-line text-slate-600">{p.notes}</p>}
          </Card>

          <Card
            title="Maintenance"
            bodyClassName="p-0"
            actions={
              <ButtonLink href={`/maintenance/new?propertyId=${id}`} variant="secondary" size="sm">
                <IconPlus className="size-3.5" /> New
              </ButtonLink>
            }
          >
            {maintenance.length === 0 ? (
              <EmptyState compact icon={<IconWrench />} title="No maintenance requests" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {maintenance.map((m) => (
                  <li key={toId(m._id)}>
                    <Link href={`/maintenance/${toId(m._id)}/edit`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                      <span className="min-w-0 truncate text-sm font-medium text-slate-800">{m.title}</span>
                      <StatusBadge status={m.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Danger zone">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  {p.archived ? "Restore to show it in lists again." : "Hide from lists; history is kept."}
                </p>
                <ConfirmAction
                  action={setPropertyArchived.bind(null, id, !p.archived)}
                  label={p.archived ? "Restore" : "Archive"}
                  confirmLabel={p.archived ? "Restore" : "Archive"}
                  icon={<IconArchive className="size-3.5" />}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-600">Only possible if it never had a rental.</p>
                <ConfirmAction
                  action={deleteProperty.bind(null, id)}
                  label="Delete"
                  confirmLabel="Delete"
                  prompt="Delete permanently?"
                  variant="danger"
                  icon={<IconTrash className="size-3.5" />}
                />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
