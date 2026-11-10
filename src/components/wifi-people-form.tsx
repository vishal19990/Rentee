"use client";

import { useState } from "react";
import { ActionForm, Hidden, SubmitButton, TextField, useActionResult } from "@/components/form";
import { formatMoneyShort } from "@/lib/money";
import type { ActionState } from "@/lib/validation";
import { peopleLabel } from "@/lib/wifi";

export type WifiPersonOption = { field: string; name: string; note: string };

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  people: WifiPersonOption[];
  /** Fields ticked at first. */
  checked: string[];
  /** Price per person (minor units). */
  rate: number;
  monthName: "fromMonth" | "effectiveMonth";
  monthLabel: string;
  monthHint?: string;
  defaultMonth: string;
  minMonth: string;
  maxMonth?: string;
  submitLabel: string;
  hidden?: Record<string, string>;
};

function Fields({ people, checked, rate, monthName, monthLabel, monthHint, defaultMonth, minMonth, maxMonth }: Omit<Props, "action" | "submitLabel" | "hidden">) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(checked));
  const error = useActionResult().fieldErrors?.people?.[0];
  const n = ticked.size;
  const toggle = (field: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(field);
      else next.delete(field);
      return next;
    });
  return (
    <div className="space-y-4">
      <fieldset aria-describedby={error ? "wifi-people-err" : undefined}>
        <legend className="label">Who gets WiFi</legend>
        <ul className="space-y-2">
          {people.map((p) => (
            <li key={p.field}>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg px-1 py-0.5 text-sm">
                <input
                  type="checkbox"
                  name={p.field}
                  // Uncontrolled, with defaultChecked following the state: React resets the form after
                  // each submit, which then restores what is ticked instead of clearing it.
                  defaultChecked={ticked.has(p.field)}
                  onChange={(e) => toggle(p.field, e.target.checked)}
                  className="mt-0.5 size-4 rounded border-slate-300 accent-brand-600"
                />
                <span className="min-w-0">
                  <span className="font-medium break-words text-slate-800">{p.name}</span>
                  <span className="block text-xs text-slate-500">{p.note}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {error && (
          <p id="wifi-people-err" className="mt-1.5 text-xs font-medium text-rose-600">
            {error}
          </p>
        )}
      </fieldset>
      <TextField name={monthName} label={monthLabel} type="month" defaultValue={defaultMonth} min={minMonth} max={maxMonth} hint={monthHint} />
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200/70" aria-live="polite">
        {peopleLabel(n)} × {formatMoneyShort(rate)} = <strong className="text-slate-900">{formatMoneyShort(n * rate)}/month</strong>
      </p>
    </div>
  );
}

/** Tick people + month form for adding or changing a WiFi plan, with the live monthly amount. */
export function WifiPeopleForm({ action, submitLabel, hidden, ...rest }: Props) {
  return (
    <ActionForm action={action} className="space-y-4">
      {hidden && Object.entries(hidden).map(([k, v]) => <Hidden key={k} name={k} value={v} />)}
      <Fields {...rest} />
      <SubmitButton className="w-full" variant="secondary">
        {submitLabel}
      </SubmitButton>
    </ActionForm>
  );
}
