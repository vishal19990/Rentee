import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, loadRentals } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { formatDate, formatDateTime, titleCase } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { formatMonth, localToday, monthOf, rentalBadge } from "@/lib/rent";
import { reminderButtons } from "@/lib/reminders";
import { Payment } from "@/models/Payment";
import { ReminderLog } from "@/models/ReminderLog";
import { ActionForm, ConfirmAction, SubmitButton, TextField } from "@/components/form";
import {
  ButtonLink,
  Card,
  DetailList,
  EmptyState,
  PageHeader,
  StatCard,
  StatusBadge,
  Table,
  TBody,
  Td,
  Th,
  THead,
} from "@/components/ui";
import { WhatsAppReminderButton } from "@/components/whatsapp-button";
import { IconAlert, IconCalendar, IconCheck, IconPencil, IconTrash, IconWallet } from "@/components/icons";
import { createPayment } from "../../payments/actions";
import { PaymentForm } from "../../payments/payment-form";
import { deleteRental, moveOutRental } from "../actions";

export const metadata: Metadata = { title: "Rental" };

export default async function RentalPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  const today = localToday();
  const [r] = await loadRentals({ _id }, today);
  if (!r) notFound();
  await connectDB();
  const [payments, reminderLogs, reminders] = await Promise.all([
    Payment.find({ rental: _id }).sort({ paidOn: -1, createdAt: -1 }).lean(),
    ReminderLog.find({ rental: _id }).sort({ sentAt: -1 }).limit(5).lean(),
    reminderButtons([r], today),
  ]);
  const reminder = reminders.get(r.id);

  const schedule = [...r.schedule].reverse();
  const nextDue = r.schedule.find((m) => m.balance > 0);
  const lastMonth = r.moveOutDate && monthOf(r.moveOutDate) < monthOf(today) ? monthOf(r.moveOutDate) : monthOf(today);
  const defaultMonth = nextDue?.month ?? lastMonth;

  return (
    <>
      <PageHeader
        back={{ href: "/rentals", label: "Rentals" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {r.propertyName}
            <StatusBadge status={rentalBadge(r)} />
          </span>
        }
        description={
          <>
            Tenant:{" "}
            <Link href={`/tenants/${r.tenantId}`} className="link">
              {r.tenantName}
            </Link>{" "}
            · Moved in {formatDate(r.moveInDate)}
            {r.moveOutDate && ` · ${r.status === "moved_out" ? "Moved out" : "Moving out"} ${formatDate(r.moveOutDate)}`}
          </>
        }
        actions={
          <ButtonLink href={`/rentals/${id}/edit`} variant="secondary">
            <IconPencil className="size-4" /> Edit
          </ButtonLink>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Monthly rent" value={formatMoney(r.monthlyRent)} hint={`Due on day ${r.dueDay}`} icon={<IconCalendar />} />
        <StatCard
          label="Collected"
          value={formatMoney(r.summary.totalPaid)}
          hint={`of ${formatMoney(r.summary.totalDue)} billed to date`}
          icon={<IconCheck />}
          tone="emerald"
        />
        <StatCard
          label="Overdue"
          value={formatMoney(r.summary.overdueAmount)}
          hint={r.summary.overdueMonths ? `${r.summary.overdueMonths} month(s) past due` : "All caught up"}
          icon={<IconAlert />}
          tone={r.summary.overdueAmount > 0 ? "rose" : "emerald"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Rent schedule" description="Computed from payments; newest month first." bodyClassName="p-0">
            {schedule.length === 0 ? (
              <EmptyState
                compact
                icon={<IconCalendar />}
                title="No rent due yet"
                description={`The tenant moves in on ${formatDate(r.moveInDate)}.`}
              />
            ) : (
              <Table>
                <THead>
                  <Th>Month</Th>
                  <Th>Due date</Th>
                  <Th className="text-right">Due</Th>
                  <Th className="text-right">Paid</Th>
                  <Th className="text-right">Balance</Th>
                  <Th>Status</Th>
                </THead>
                <TBody>
                  {schedule.map((m) => (
                    <tr key={m.month} className={m.status === "overdue" ? "bg-rose-50/40" : undefined}>
                      <Td className="font-medium whitespace-nowrap text-slate-900">{formatMonth(m.month)}</Td>
                      <Td className="whitespace-nowrap text-slate-600">{formatDate(m.dueDate)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(m.due)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(m.paid)}</Td>
                      <Td className="text-right tabular-nums">
                        {m.balance > 0 ? (
                          <span className={m.pastDue ? "font-semibold text-rose-600" : ""}>{formatMoney(m.balance)}</span>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        <StatusBadge status={m.status} />
                      </Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card title="Payments" bodyClassName="p-0">
            {payments.length === 0 ? (
              <EmptyState compact icon={<IconWallet />} title="No payments recorded yet" />
            ) : (
              <Table>
                <THead>
                  <Th>Paid on</Th>
                  <Th>For month</Th>
                  <Th>Method</Th>
                  <Th>Note</Th>
                  <Th className="text-right">Amount</Th>
                </THead>
                <TBody>
                  {payments.map((p) => (
                    <tr key={String(p._id)}>
                      <Td className="whitespace-nowrap">{formatDate(p.paidOn)}</Td>
                      <Td className="whitespace-nowrap">{formatMonth(p.forMonth)}</Td>
                      <Td>{p.method === "upi" ? "UPI" : titleCase(p.method)}</Td>
                      <Td className="max-w-[16rem] truncate text-slate-500">{p.note || "—"}</Td>
                      <Td className="text-right font-medium tabular-nums">{formatMoney(p.amount)}</Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {(reminder || reminderLogs.length > 0) && (
            <Card
              title="WhatsApp reminder"
              description={
                reminder?.kind === "due_soon"
                  ? "Nothing overdue. Send a friendly heads-up for the next rent."
                  : "Opens WhatsApp with the message ready; you press send."
              }
            >
              {reminder ? (
                <div className="space-y-3">
                  <p className="rounded-xl bg-emerald-50/60 p-3 text-sm whitespace-pre-line text-slate-700 ring-1 ring-emerald-600/10">
                    {reminder.message}
                  </p>
                  <WhatsAppReminderButton {...reminder} size="md" stacked />
                </div>
              ) : (
                <p className="text-sm text-slate-500">Nothing to remind about right now.</p>
              )}
              {reminderLogs.length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Recent reminders</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {reminderLogs.map((log) => (
                      <li key={String(log._id)} className="flex justify-between gap-2">
                        <span>{formatDateTime(log.sentAt)}</span>
                        <span className="text-slate-400">{log.kind === "due_soon" ? "Due soon" : "Overdue"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          <Card title="Record payment">
            <PaymentForm
              action={createPayment}
              rentalId={id}
              compact
              defaults={{ forMonth: defaultMonth, amount: nextDue?.balance ?? r.monthlyRent, paidOn: today }}
            />
          </Card>

          {r.status === "active" && (
            <Card
              title={r.movingOut ? "Change move-out date" : "Move out"}
              description="Rent stops after the move-out month. The property becomes vacant on that date."
            >
              <ActionForm action={moveOutRental.bind(null, id)} className="space-y-4">
                <TextField
                  name="moveOutDate"
                  label="Move-out date"
                  type="date"
                  defaultValue={r.moveOutDate ?? today}
                  min={r.moveInDate}
                />
                <SubmitButton className="w-full" variant="secondary">
                  {r.movingOut ? "Update move-out" : "Record move-out"}
                </SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card title="Details">
            <DetailList
              items={[
                { label: "Property", value: <Link className="link" href={`/properties/${r.propertyId}`}>{r.propertyName}</Link> },
                { label: "Tenant", value: <Link className="link" href={`/tenants/${r.tenantId}`}>{r.tenantName}</Link> },
                { label: "Moved in", value: formatDate(r.moveInDate) },
                { label: r.status === "moved_out" ? "Moved out" : "Move-out", value: r.moveOutDate ? formatDate(r.moveOutDate) : "Not scheduled" },
                { label: "Deposit", value: formatMoney(r.deposit) },
                { label: "Due day", value: String(r.dueDay) },
              ]}
            />
          </Card>

          <Card title="Danger zone">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-600">Only possible with no payments.</p>
              <ConfirmAction
                action={deleteRental.bind(null, id)}
                label="Delete"
                confirmLabel="Delete"
                prompt="Delete rental?"
                variant="danger"
                icon={<IconTrash className="size-3.5" />}
              />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
