import type { SVGProps } from "react";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { OCCUPANT_RELATION_LABELS } from "@/lib/occupants";
import { addMonths, formatMonth, localToday, monthOf, payableMonths } from "@/lib/rent";
import { activePlan, latestPlan, peopleLabel, personField, wifiPlanAmount, type WifiPlanRow } from "@/lib/wifi";
import { getWifiRate } from "@/lib/wifi-store";
import { ActionForm, ConfirmAction, Hidden, SubmitButton, TextField } from "@/components/form";
import { Badge, Card } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import type { OccupantRow } from "@/components/occupants-card";
import { WifiPeopleForm, type WifiPersonOption } from "@/components/wifi-people-form";
import { addWifiPlan, changeWifiPlan, removeWifiPlan, stopWifiPlan } from "@/app/(admin)/rentals/wifi-actions";

export const IconWifi = ({ className = "size-5", ...p }: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} {...p}>
    <path d="M2 8.8a15 15 0 0 1 20 0" />
    <path d="M5 12.6a10 10 0 0 1 14 0" />
    <path d="M8.5 16.3a5 5 0 0 1 7 0" />
    <path d="M12 20h.01" />
  </svg>
);

const clamp = (m: string, min: string, max: string | null) => (m < min ? min : max && m > max ? max : m);

const period = (p: WifiPlanRow) =>
  p.toMonth === null ? `From ${formatMonth(p.fromMonth)}` : p.toMonth === p.fromMonth ? formatMonth(p.fromMonth) : `${formatMonth(p.fromMonth)} – ${formatMonth(p.toMonth)}`;

const names = (p: WifiPlanRow) => p.people.map((x) => x.name).join(", ");

/**
 * Rental page "WiFi" card: optional WiFi charged per person. Add (tick people + from month),
 * Change (new people from a month), Stop (from a month), history, and Remove for the latest plan.
 */
export async function WifiCard({
  rental,
  occupants,
}: {
  rental: {
    id: string;
    tenantName: string;
    moveInDate: string;
    moveOutDate: string | null;
    monthlyRent: number;
    dueDay: number;
    status: "active" | "moved_out";
    wifiPlans: WifiPlanRow[];
  };
  occupants: OccupantRow[];
}) {
  const today = localToday();
  const thisMonth = monthOf(today);
  const rate = await getWifiRate();
  const plans = rental.wifiPlans;
  const current = activePlan(plans, thisMonth);
  const latest = latestPlan(plans);
  const history = [...plans].filter((p) => p.id !== current?.id).reverse();
  const { first, last } = payableMonths(rental, today);
  const lastMonth = rental.moveOutDate ? monthOf(rental.moveOutDate) : null;
  const canEdit = rental.status === "active";

  const options: WifiPersonOption[] = [
    { field: personField({ kind: "tenant" }), name: rental.tenantName, note: "Tenant" },
    ...occupants.map((o) => ({ field: personField({ kind: "occupant", occupantId: o.id }), name: o.name, note: OCCUPANT_RELATION_LABELS[o.relation] })),
  ];
  const occupantIds = new Set(occupants.map((o) => o.id));
  const gone = current ? current.people.filter((p) => p.kind === "occupant" && (!p.occupantId || !occupantIds.has(p.occupantId))) : [];

  const nextMonth = addMonths(thisMonth, 1);
  const defaultChange = current ? clamp(current.fromMonth > nextMonth ? current.fromMonth : nextMonth, first, lastMonth) : nextMonth;

  const removeButton = (planId: string) => (
    <ConfirmAction
      action={removeWifiPlan.bind(null, rental.id)}
      hidden={{ planId }}
      label="Remove"
      confirmLabel="Remove"
      prompt="Remove this WiFi plan?"
      variant="ghost"
      icon={<IconTrash className="size-3.5" />}
    />
  );

  return (
    <Card title="WiFi" description={`Optional, charged per person. Billed with the rent each month (${formatMoneyShort(rate)} per person now).`}>
      {current ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-base font-semibold text-slate-900 tabular-nums">{formatMoney(wifiPlanAmount(current))} / month</p>
              <p className="text-xs text-slate-500">
                {peopleLabel(current.people.length)} × {formatMoneyShort(current.ratePerPerson)}
              </p>
            </div>
            {current.fromMonth > thisMonth ? <Badge tone="sky">Starts {formatMonth(current.fromMonth)}</Badge> : <Badge tone="emerald" dot>On</Badge>}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {current.people.map((p) => (
              <li key={`${p.kind}:${p.occupantId ?? ""}:${p.name}`}>
                <Badge tone={gone.includes(p) ? "amber" : "slate"}>{p.name}</Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">
            {current.fromMonth > thisMonth ? `From ${formatMonth(current.fromMonth)}` : `Since ${formatMonth(current.fromMonth)}`}
            {current.toMonth ? ` · until ${formatMonth(current.toMonth)}` : ""}
          </p>
          {gone.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-600/20">
              {gone.map((p) => p.name).join(", ")} {gone.length === 1 ? "is" : "are"} no longer listed as an occupant. Use Change to update who
              gets WiFi; past months stay as billed.
            </p>
          )}
          {canEdit && (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <details className="group">
                <summary className="cursor-pointer list-none text-sm font-medium text-brand-700 hover:underline [&::-webkit-details-marker]:hidden">
                  Change
                </summary>
                <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <WifiPeopleForm
                    action={changeWifiPlan.bind(null, rental.id)}
                    hidden={{ planId: current.id }}
                    people={options}
                    checked={current.people.map((p) => personField(p)).filter((f) => options.some((o) => o.field === f))}
                    rate={rate}
                    monthName="effectiveMonth"
                    monthLabel="Effective from"
                    monthHint={`Earlier months keep the current plan. ${formatMonth(current.fromMonth)} or earlier replaces it.`}
                    defaultMonth={defaultChange}
                    minMonth={first}
                    maxMonth={current.toMonth ?? lastMonth ?? undefined}
                    submitLabel="Save WiFi change"
                  />
                </div>
              </details>
              <details className="group">
                <summary className="cursor-pointer list-none text-sm font-medium text-brand-700 hover:underline [&::-webkit-details-marker]:hidden">
                  Stop
                </summary>
                <ActionForm action={stopWifiPlan.bind(null, rental.id)} className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <Hidden name="planId" value={current.id} />
                  <TextField
                    name="stopMonth"
                    label="No WiFi from"
                    type="month"
                    defaultValue={defaultChange}
                    min={first}
                    hint={`WiFi is billed through the month before. ${formatMonth(current.fromMonth)} or earlier removes the plan.`}
                  />
                  <SubmitButton size="sm" variant="secondary">
                    Stop WiFi
                  </SubmitButton>
                </ActionForm>
              </details>
              {latest?.id === current.id && <div className="flex justify-end">{removeButton(current.id)}</div>}
            </div>
          )}
        </div>
      ) : canEdit ? (
        <WifiPeopleForm
          action={addWifiPlan.bind(null, rental.id)}
          people={options}
          checked={[]}
          rate={rate}
          monthName="fromMonth"
          monthLabel="From month"
          defaultMonth={clamp(thisMonth, first, last)}
          minMonth={first}
          maxMonth={lastMonth ?? undefined}
          submitLabel="Add WiFi"
        />
      ) : (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <IconWifi className="size-4" /> No WiFi.
        </p>
      )}

      {history.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-3">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">History</p>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {history.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{period(p)}</p>
                  <p className="text-xs break-words text-slate-500">
                    {names(p)} · {peopleLabel(p.people.length)} × {formatMoneyShort(p.ratePerPerson)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-medium text-slate-700 tabular-nums">{formatMoney(wifiPlanAmount(p))}/mo</span>
                  {canEdit && latest?.id === p.id && removeButton(p.id)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
