import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, loadRentals } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { formatDate, formatStay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { reminderButtons } from "@/lib/reminders";
import { localToday, rentalBadge } from "@/lib/rent";
import { NO_PHONE_TOOLTIP, normalizePhone } from "@/lib/whatsapp";
import { Tenant } from "@/models/Tenant";
import { ConfirmAction } from "@/components/form";
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
import { WhatsAppReminderButton } from "@/components/whatsapp-button";
import { DocumentsCard } from "@/components/documents-card";
import { IconArchive, IconFile, IconPencil, IconPlus, IconTrash } from "@/components/icons";
import { deleteTenant, setTenantArchived } from "../actions";

export const metadata: Metadata = { title: "Tenant" };

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  await connectDB();
  const t = await Tenant.findById(_id).lean();
  if (!t) notFound();
  const today = localToday();
  const rentals = await loadRentals({ tenant: _id }, today);
  const reminders = await reminderButtons(rentals, today);
  const hasWhatsApp = normalizePhone(t.phone) !== null;
  const totalPaid = rentals.reduce((s, l) => s + l.summary.totalPaid, 0);
  const totalOverdue = rentals.reduce((s, l) => s + l.summary.overdueAmount, 0);

  return (
    <>
      <PageHeader
        back={{ href: "/tenants", label: "Tenants" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t.name}
            {t.archived && <StatusBadge status="archived" />}
          </span>
        }
        description={[t.phone, t.email].filter(Boolean).join(" · ")}
        actions={
          <>
            {!t.archived && (
              <ButtonLink href={`/rentals/new?tenantId=${id}`}>
                <IconPlus className="size-4" /> New rental
              </ButtonLink>
            )}
            <ButtonLink href={`/tenants/${id}/edit`} variant="secondary">
              <IconPencil className="size-4" /> Edit
            </ButtonLink>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Rentals" bodyClassName="p-0">
            {rentals.length === 0 ? (
              <EmptyState compact icon={<IconFile />} title="No rentals yet" />
            ) : (
              <Table>
                <THead>
                  <Th>Property</Th>
                  <Th>Stay</Th>
                  <Th className="text-right">Rent</Th>
                  <Th className="text-right">Overdue</Th>
                  <Th>Status</Th>
                  {reminders.size > 0 && <Th className="text-right">Reminder</Th>}
                </THead>
                <TBody>
                  {rentals.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/60">
                      <Td>
                        <Link href={`/rentals/${l.id}`} className="link">
                          {l.propertyName}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap text-slate-600">
                        {formatStay(l.moveInDate, l.moveOutDate)}
                      </Td>
                      <Td className="text-right tabular-nums">{formatMoney(l.monthlyRent)}</Td>
                      <Td className="text-right tabular-nums">
                        {l.summary.overdueAmount > 0 ? (
                          <span className="font-semibold text-rose-600">{formatMoney(l.summary.overdueAmount)}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </Td>
                      <Td>
                        <StatusBadge status={rentalBadge(l)} />
                      </Td>
                      {reminders.size > 0 && (
                        <Td className="text-right">
                          {reminders.get(l.id) ? <WhatsAppReminderButton {...reminders.get(l.id)!} /> : null}
                        </Td>
                      )}
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
          <DocumentsCard tenantId={id} />
        </div>
        <div className="space-y-6">
          <Card title="Details">
            <DetailList
              items={[
                {
                  label: "Phone",
                  value: hasWhatsApp ? (
                    t.phone
                  ) : (
                    <span className="text-amber-700">
                      {t.phone || "—"} <span className="text-xs">({NO_PHONE_TOOLTIP} for WhatsApp reminders)</span>
                    </span>
                  ),
                },
                { label: "Email", value: t.email },
                { label: "ID number", value: t.idNumber },
                { label: "Tenant since", value: formatDate(t.createdAt) },
                { label: "Total paid", value: formatMoney(totalPaid) },
                {
                  label: "Overdue",
                  value: totalOverdue > 0 ? <span className="font-semibold text-rose-600">{formatMoney(totalOverdue)}</span> : "—",
                },
              ]}
            />
            {t.notes && <p className="mt-5 text-sm whitespace-pre-line text-slate-600">{t.notes}</p>}
          </Card>
          <Card title="Danger zone">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-600">{t.archived ? "Restore this tenant." : "Hide from lists; history is kept."}</p>
                <ConfirmAction
                  action={setTenantArchived.bind(null, id, !t.archived)}
                  label={t.archived ? "Restore" : "Archive"}
                  confirmLabel={t.archived ? "Restore" : "Archive"}
                  icon={<IconArchive className="size-3.5" />}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-600">Only possible if they never had a rental.</p>
                <ConfirmAction
                  action={deleteTenant.bind(null, id)}
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
