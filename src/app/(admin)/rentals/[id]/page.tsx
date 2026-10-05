import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, loadRentals } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { formatDate, formatDateTime, titleCase } from "@/lib/format";
import { chargeLabel } from "@/lib/charges";
import { DEPOSIT_KIND_LABELS } from "@/lib/deposit";
import { loadDeposit } from "@/lib/deposit-store";
import { currencySymbol, formatMoney, toMajorString } from "@/lib/money";
import { addMonths, formatMonth, localToday, monthOf, payableMonths, rentalBadge } from "@/lib/rent";
import { reminderButtons } from "@/lib/reminders";
import { getDefaultElectricityRate } from "@/lib/settings";
import { Charge } from "@/models/Charge";
import { Payment } from "@/models/Payment";
import { Property } from "@/models/Property";
import { RentChange } from "@/models/RentChange";
import { ReminderLog } from "@/models/ReminderLog";
import { ActionForm, ConfirmAction, MoneyField, SelectField, SubmitButton, TextField } from "@/components/form";
import {
  ButtonLink,
  Card,
  DetailList,
  EmptyState,
  PageHeader,
  Badge,
  StatCard,
  StatusBadge,
  Table,
  TBody,
  Td,
  Th,
  THead,
} from "@/components/ui";
import { WhatsAppReminderButton } from "@/components/whatsapp-button";
import { AgreementCard } from "@/components/agreement-card";
import { IconAlert, IconBolt, IconCalendar, IconCheck, IconPencil, IconTrash, IconWallet } from "@/components/icons";
import { createPayment } from "../../payments/actions";
import { PaymentForm } from "../../payments/payment-form";
import { deleteRental, moveOutRental } from "../actions";
import { addCharge, changeRent, deleteCharge, deleteRentChange, recordDepositEntry } from "../ledger-actions";
import { ChargeForm } from "./charge-form";

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
  const [payments, reminderLogs, reminders, rentChanges, charges, deposit, property, settingsRate] = await Promise.all([
    Payment.find({ rental: _id }).sort({ paidOn: -1, createdAt: -1 }).lean(),
    ReminderLog.find({ rental: _id }).sort({ sentAt: -1 }).limit(5).lean(),
    reminderButtons([r], today),
    RentChange.find({ rental: _id }).sort({ effectiveMonth: 1 }).lean(),
    Charge.find({ rental: _id }).sort({ month: -1, createdAt: -1 }).lean(),
    loadDeposit(_id),
    Property.findById(r.propertyId).select("electricityRate").lean(),
    getDefaultElectricityRate(),
  ]);
  const reminder = reminders.get(r.id);
  const symbol = currencySymbol();

  // Rent changes: the original rent from move-in, then each change. Default: next month.
  const firstMonth = monthOf(r.moveInDate);
  const moveOutMonth = r.moveOutDate ? monthOf(r.moveOutDate) : null;
  const nextMonth = addMonths(monthOf(today), 1);
  const defaultEffective =
    moveOutMonth && nextMonth > moveOutMonth ? moveOutMonth : nextMonth < firstMonth ? firstMonth : nextMonth;

  // Charges: month bounds, last electricity reading, default rate (property, else Settings).
  const chargeBounds = payableMonths(r, today);
  const lastMeter = charges.find((c) => c.type === "electricity" && c.meter)?.meter ?? null;
  const defaultRate = typeof property?.electricityRate === "number" ? property.electricityRate : settingsRate;
  const thisMonth = monthOf(today);
  const defaultChargeMonth = thisMonth > chargeBounds.last ? chargeBounds.last : thisMonth < firstMonth ? firstMonth : thisMonth;

  // Move-out flow: once a move-out is recorded, the deposit card asks to settle the deposit.
  const settleDeposit = (r.status === "moved_out" || r.movingOut) && deposit.summary.held > 0;

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
        <StatCard
          label="Monthly rent"
          value={formatMoney(r.currentRent)}
          hint={
            r.nextRentChange
              ? `${formatMoney(r.nextRentChange.monthlyRent)} from ${formatMonth(r.nextRentChange.effectiveMonth)} · due day ${r.dueDay}`
              : `Due on day ${r.dueDay}`
          }
          icon={<IconCalendar />}
        />
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
          <Card title="Rent schedule" description="Rent plus charges, less payments; newest month first." bodyClassName="p-0">
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
                      <Td className="text-right tabular-nums">
                        {formatMoney(m.due)}
                        {m.charges > 0 && (
                          <span className="block text-[11px] whitespace-nowrap text-slate-500">
                            Rent {formatMoney(m.rent)}
                            {m.chargeItems.map((c) => ` + ${chargeLabel(c.type)} ${formatMoney(c.amount)}`).join("")}
                          </span>
                        )}
                      </Td>
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

          <Card
            title="Charges"
            description="Electricity, water, maintenance and other charges, added to that month's rent."
            bodyClassName="p-0"
          >
            {charges.length === 0 ? (
              <EmptyState compact icon={<IconBolt />} title="No charges yet" description="Add a utility bill with the form." />
            ) : (
              <Table>
                <THead>
                  <Th>Month</Th>
                  <Th>Type</Th>
                  <Th>Details</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">
                    <span className="sr-only">Remove</span>
                  </Th>
                </THead>
                <TBody>
                  {charges.map((c) => (
                    <tr key={String(c._id)}>
                      <Td className="whitespace-nowrap">{formatMonth(c.month)}</Td>
                      <Td>{chargeLabel(c.type)}</Td>
                      <Td className="text-xs text-slate-500">
                        {[
                          c.meter
                            ? `${c.meter.previous} → ${c.meter.current} (${Math.round((c.meter.current - c.meter.previous) * 100) / 100} units × ${formatMoney(c.meter.rate)})`
                            : "",
                          c.note,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </Td>
                      <Td className="text-right font-medium tabular-nums">{formatMoney(c.amount)}</Td>
                      <Td className="text-right">
                        <ConfirmAction
                          action={deleteCharge.bind(null, id)}
                          hidden={{ chargeId: String(c._id) }}
                          label="Remove"
                          confirmLabel="Remove"
                          prompt="Remove charge?"
                          variant="ghost"
                          icon={<IconTrash className="size-3.5" />}
                        />
                      </Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card title="Rent history" description="Rent for a month is the latest change effective on or before it." bodyClassName="p-0">
            <ul className="divide-y divide-slate-100">
              <li className="px-5 py-3">
                <p className="text-sm font-medium text-slate-900">{formatMoney(r.monthlyRent)} / month</p>
                <p className="text-xs text-slate-500">From {formatMonth(firstMonth)} · original rent</p>
              </li>
              {rentChanges.map((c) => (
                <li key={String(c._id)} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                      {formatMoney(c.monthlyRent)} / month
                      {c.effectiveMonth > thisMonth && <Badge tone="sky">Scheduled</Badge>}
                    </p>
                    <p className="text-xs text-slate-500">
                      From {formatMonth(c.effectiveMonth)}
                      {c.note ? ` · ${c.note}` : ""}
                    </p>
                  </div>
                  <ConfirmAction
                    action={deleteRentChange.bind(null, id)}
                    hidden={{ changeId: String(c._id) }}
                    label="Remove"
                    confirmLabel="Remove"
                    prompt="Remove this rent change?"
                    variant="ghost"
                    icon={<IconTrash className="size-3.5" />}
                  />
                </li>
              ))}
            </ul>
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
              defaults={{ forMonth: defaultMonth, amount: nextDue?.balance ?? r.currentRent, paidOn: today }}
            />
          </Card>

          <Card
            title="Deposit"
            description="Security deposit ledger. Entries are permanent; correct a mistake with a new entry."
            className={settleDeposit ? "ring-2 ring-amber-300" : undefined}
          >
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Received</dt>
                <dd className="font-medium tabular-nums">{formatMoney(deposit.summary.received)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Deductions</dt>
                <dd className="font-medium tabular-nums">{formatMoney(deposit.summary.deducted)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Refunded</dt>
                <dd className="font-medium tabular-nums">{formatMoney(deposit.summary.refunded)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Held</dt>
                <dd className="text-base font-semibold text-slate-900 tabular-nums">{formatMoney(deposit.summary.held)}</dd>
              </div>
            </dl>
            {settleDeposit && (
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-600/20">
                {r.status === "moved_out" ? "The tenant has moved out." : "The tenant is moving out."} Record any deductions (with a
                reason), then refund the balance of {formatMoney(deposit.summary.held)}.
              </p>
            )}
            {deposit.entries.length > 0 && (
              <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
                {deposit.entries.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800">{DEPOSIT_KIND_LABELS[e.kind]}</p>
                      <p className="text-xs break-words text-slate-500">
                        {formatDate(e.date)}
                        {e.reason ? ` · ${e.reason}` : ""}
                      </p>
                    </div>
                    <span
                      className={
                        e.kind === "received"
                          ? "shrink-0 font-medium text-emerald-700 tabular-nums"
                          : "shrink-0 font-medium text-rose-600 tabular-nums"
                      }
                    >
                      {e.kind === "received" ? "+" : "−"}
                      {formatMoney(e.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={recordDepositEntry.bind(null, id)} className="mt-4 space-y-4 border-t border-slate-100 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  name="kind"
                  label="Entry"
                  defaultValue={settleDeposit ? "deduction" : "received"}
                  options={[
                    { value: "received", label: "Received" },
                    { value: "deduction", label: "Deduction" },
                    { value: "refund", label: "Refund" },
                  ]}
                />
                <MoneyField
                  name="amount"
                  label="Amount"
                  currency={symbol}
                  hint={deposit.summary.held > 0 ? `Held: ${formatMoney(deposit.summary.held)}` : undefined}
                />
              </div>
              <TextField name="date" label="Date" type="date" defaultValue={today} />
              <TextField name="reason" label="Reason" placeholder="Required for deductions, e.g. repainting" />
              <SubmitButton className="w-full" variant="secondary">
                Record deposit entry
              </SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Add charge" description="Billed together with that month's rent.">
            <ChargeForm
              action={addCharge.bind(null, id)}
              defaultMonth={defaultChargeMonth}
              minMonth={chargeBounds.first}
              maxMonth={chargeBounds.last}
              lastReading={lastMeter ? lastMeter.current : null}
              defaultRate={defaultRate}
              currency={symbol}
            />
          </Card>

          {(r.status === "active" || r.movingOut) && (
            <Card title="Change rent" description="Applies from the chosen month onwards. Earlier months keep their rent.">
              <ActionForm action={changeRent.bind(null, id)} className="space-y-4">
                <TextField
                  name="effectiveMonth"
                  label="Effective from"
                  type="month"
                  defaultValue={defaultEffective}
                  min={firstMonth}
                  max={moveOutMonth ?? undefined}
                />
                <MoneyField name="monthlyRent" label="New monthly rent" currency={symbol} defaultValue={toMajorString(r.currentRent)} />
                <TextField name="note" label="Note (optional)" placeholder="e.g. Annual 5% increase" />
                <SubmitButton className="w-full" variant="secondary">
                  Save rent change
                </SubmitButton>
              </ActionForm>
            </Card>
          )}

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

          <AgreementCard rental={r} />

          <Card title="Details">
            <DetailList
              items={[
                { label: "Property", value: <Link className="link" href={`/properties/${r.propertyId}`}>{r.propertyName}</Link> },
                { label: "Tenant", value: <Link className="link" href={`/tenants/${r.tenantId}`}>{r.tenantName}</Link> },
                { label: "Moved in", value: formatDate(r.moveInDate) },
                { label: r.status === "moved_out" ? "Moved out" : "Move-out", value: r.moveOutDate ? formatDate(r.moveOutDate) : "Not scheduled" },
                { label: "Original rent", value: formatMoney(r.monthlyRent) },
                { label: "Deposit agreed", value: formatMoney(r.deposit) },
                { label: "Due day", value: String(r.dueDay) },
              ]}
            />
          </Card>

          <Card title="Danger zone">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-600">Only possible with no payments or deposit entries.</p>
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
