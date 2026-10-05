import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { phoneMatches } from "@/lib/enquiry-data";
import {
  REASON_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  canDeleteEnquiry,
  enquiryWhatsAppMessage,
  followUpDue,
  isOpenStatus,
  toLocalDateTimeInput,
  type EnquirySource,
  type EnquiryStatus,
} from "@/lib/enquiries";
import { formatDate, formatDateTime, plural } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { localToday, toISODate } from "@/lib/rent";
import { normalizePhone } from "@/lib/whatsapp";
import { Enquiry } from "@/models/Enquiry";
import { EnquiryActivity } from "@/models/EnquiryActivity";
import { Property } from "@/models/Property";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";
import { ConfirmAction } from "@/components/form";
import { Badge, ButtonLink, Card, DetailList, EmptyState, PageHeader } from "@/components/ui";
import { EnquiryStatusBadge } from "@/components/enquiry-status-badge";
import { IconAlert, IconCalendar, IconPencil, IconTrash } from "@/components/icons";
import { deleteEnquiry } from "../actions";
import {
  ActivityForm,
  ConvertPanel,
  FollowUpForm,
  OpenStatusButtons,
  OutcomeForm,
  ReopenButton,
  VisitForm,
  WhatsAppPanel,
} from "./panels";

export const metadata: Metadata = { title: "Enquiry" };

const KIND_LABEL: Record<string, string> = {
  note: "Note",
  call: "Call",
  whatsapp: "WhatsApp",
  visit: "Visit",
  status_change: "Status",
  follow_up_set: "Follow-up",
  converted: "Converted",
};

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  await connectDB();
  const e = await Enquiry.findById(_id).lean();
  if (!e) notFound();

  const [activities, property, matches, tenant, rental] = await Promise.all([
    EnquiryActivity.find({ enquiry: _id }).sort({ at: -1, _id: -1 }).lean(),
    e.property ? Property.findById(e.property).select("name city").lean() : Promise.resolve(null),
    phoneMatches(e.phone, id),
    e.convertedTenant ? Tenant.findById(e.convertedTenant).select("name").lean() : Promise.resolve(null),
    e.convertedRental ? Rental.findById(e.convertedRental).select("_id").lean() : Promise.resolve(null),
  ]);

  const status = e.status as EnquiryStatus;
  const open = isOpenStatus(status);
  const today = localToday();
  const followUp = e.followUpDate ? toISODate(e.followUpDate) : null;
  const propertyName = property?.name ?? null;
  const deletable = canDeleteEnquiry(status, activities.length);

  return (
    <>
      <PageHeader
        back={{ href: "/enquiries", label: "Enquiries" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {e.name}
            <EnquiryStatusBadge status={status} />
          </span>
        }
        description={`Received ${formatDate(localToday(e.createdAt))} · ${SOURCE_LABEL[e.source as EnquirySource] ?? e.source}`}
        actions={
          <>
            <ButtonLink href={`/enquiries/${id}/edit`} variant="secondary">
              <IconPencil className="size-4" /> Edit
            </ButtonLink>
            {deletable && (
              <ConfirmAction
                action={deleteEnquiry.bind(null, id)}
                label="Delete"
                confirmLabel="Delete"
                prompt="Delete this mistaken entry?"
                variant="danger"
                icon={<IconTrash className="size-3.5" />}
              />
            )}
          </>
        }
      />

      {(matches.tenants.length > 0 || matches.enquiries.length > 0) && (
        <div role="status" className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          <p className="flex items-center gap-2 font-medium">
            <IconAlert className="size-4 shrink-0" /> This phone number is already known
          </p>
          <p className="mt-1">
            {matches.tenants.length > 0 && (
              <>
                Tenant{matches.tenants.length > 1 ? "s" : ""}:{" "}
                {matches.tenants.map((t, i) => (
                  <span key={t.id}>
                    {i > 0 && ", "}
                    <Link href={`/tenants/${t.id}`} className="font-medium underline">
                      {t.name}
                    </Link>
                    {t.archived && " (archived)"}
                  </span>
                ))}
                {matches.enquiries.length > 0 && " · "}
              </>
            )}
            {matches.enquiries.length > 0 && `${plural(matches.enquiries.length, "other enquiry", "other enquiries")} (see below)`}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Status" description={open ? "Move it along, or close it with an outcome." : "This enquiry is closed."}>
            {open ? (
              <div className="space-y-5">
                <OpenStatusButtons id={id} status={status} />
                <div className="border-t border-slate-100 pt-5">
                  <OutcomeForm id={id} />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <DetailList
                  items={[
                    { label: "Outcome", value: STATUS_LABEL[status] },
                    { label: "Closed on", value: e.outcomeAt ? formatDate(localToday(e.outcomeAt)) : "" },
                    ...(e.outcomeReason ? [{ label: "Reason", value: REASON_LABEL[e.outcomeReason] ?? e.outcomeReason }] : []),
                    ...(e.outcomeNote ? [{ label: "Details", value: e.outcomeNote }] : []),
                  ]}
                />
                {status === "accepted" && (
                  <div className="border-t border-slate-100 pt-4">
                    {e.convertedTenant ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-slate-600">Converted to tenant</span>
                        <Link href={`/tenants/${toId(e.convertedTenant)}`} className="link">
                          {tenant?.name ?? "(deleted tenant)"}
                        </Link>
                        {rental ? (
                          <ButtonLink href={`/rentals/${toId(rental._id)}`} variant="secondary" size="sm">
                            View rental
                          </ButtonLink>
                        ) : tenant ? (
                          <ButtonLink
                            href={`/rentals/new?tenant=${toId(e.convertedTenant)}${e.property ? `&property=${toId(e.property)}` : ""}`}
                            size="sm"
                          >
                            Create rental
                          </ButtonLink>
                        ) : null}
                      </div>
                    ) : (
                      <ConvertPanel id={id} matches={matches.tenants} />
                    )}
                  </div>
                )}
                <div className="border-t border-slate-100 pt-4">
                  <ReopenButton id={id} />
                </div>
              </div>
            )}
          </Card>

          <Card title="Timeline" description="Append-only: notes, calls, messages and changes.">
            <ActivityForm id={id} />
            {activities.length > 0 && (
              <ol className="mt-6 space-y-4 border-t border-slate-100 pt-5">
                {activities.map((a) => (
                  <li key={toId(a._id)} className="flex gap-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={a.kind === "note" || a.kind === "call" ? "brand" : "slate"}>{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                        <time className="text-xs text-slate-400">{formatDateTime(a.at)}</time>
                      </div>
                      <p className="mt-1 text-sm break-words whitespace-pre-line text-slate-700">{a.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Details">
            <DetailList
              items={[
                { label: "Phone", value: e.phone },
                { label: "Email", value: e.email },
                {
                  label: "Property",
                  value: e.property ? (
                    <Link href={`/properties/${toId(e.property)}`} className="link">
                      {propertyName ?? "(deleted property)"}
                    </Link>
                  ) : (
                    "Any property"
                  ),
                },
                { label: "Budget", value: e.budget ? `${formatMoney(e.budget)} / month` : "" },
                { label: "Desired move-in", value: e.desiredMoveIn ? formatDate(e.desiredMoveIn) : "" },
                { label: "Occupants", value: e.occupants ? String(e.occupants) : "" },
                { label: "Occupation", value: e.occupation },
              ]}
            />
            {e.notes && <p className="mt-5 text-sm whitespace-pre-line text-slate-600">{e.notes}</p>}
          </Card>

          <Card title="Follow-up & visit">
            {open ? (
              <div className="space-y-5">
                {followUp && (
                  <p className={followUpDue({ status, followUpDate: followUp }, today) ? "text-sm font-medium text-rose-600" : "text-sm text-slate-600"}>
                    Follow-up {followUp === today ? "due today" : followUp < today ? `overdue since ${formatDate(followUp)}` : `on ${formatDate(followUp)}`}
                  </p>
                )}
                <FollowUpForm id={id} current={followUp} />
                <div className="border-t border-slate-100 pt-5">
                  {e.visitAt && <p className="mb-3 text-sm text-slate-600">Visit: {formatDateTime(e.visitAt)}</p>}
                  <VisitForm id={id} current={e.visitAt ? toLocalDateTimeInput(e.visitAt) : null} />
                </div>
              </div>
            ) : (
              <EmptyState
                compact
                icon={<IconCalendar />}
                title="Closed"
                description={e.visitAt ? `Last visit: ${formatDateTime(e.visitAt)}` : "Reopen to set a follow-up or visit."}
              />
            )}
          </Card>

          <Card title="WhatsApp">
            <WhatsAppPanel id={id} phoneDigits={normalizePhone(e.phone)} defaultMessage={enquiryWhatsAppMessage(e.name, propertyName)} />
          </Card>

          <Card title="Previous enquiries from this number" bodyClassName="p-0">
            {matches.enquiries.length === 0 ? (
              <EmptyState compact title="None" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {matches.enquiries.map((m) => (
                  <li key={m.id}>
                    <Link href={`/enquiries/${m.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{m.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {m.propertyName ?? "Any property"} · {formatDate(localToday(new Date(m.createdAt)))}
                        </p>
                      </div>
                      <EnquiryStatusBadge status={m.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
