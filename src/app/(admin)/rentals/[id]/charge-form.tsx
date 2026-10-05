"use client";

import { useEffect, useRef, useState } from "react";
import { ActionForm, FieldWrap, SubmitButton, TextField, useActionResult, useField } from "@/components/form";
import { CHARGE_TYPES, CHARGE_TYPE_LABELS, electricityAmount, meterUnits } from "@/lib/charges";
import { formatMoney, parseMoney, toMajorString } from "@/lib/money";
import type { ActionState } from "@/lib/validation";

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaultMonth: string;
  minMonth: string;
  maxMonth: string;
  /** Last electricity reading for this rental (pre-fills "previous reading"). */
  lastReading: number | null;
  /** Default rate per unit in minor units (property rate, else Settings default). */
  defaultRate: number | null;
  currency: string;
};

/** A controlled text input that still shows the server-side field error. */
function LiveInput({
  name,
  label,
  value,
  onChange,
  prefix,
  hint,
  inputMode = "decimal",
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  hint?: React.ReactNode;
  inputMode?: "decimal" | "numeric";
}) {
  const { id, error } = useField(name);
  const input = (
    <input
      id={id}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode={inputMode}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-err` : undefined}
      className={prefix ? "input pl-12" : "input"}
    />
  );
  return (
    <FieldWrap id={id} label={label} error={error} hint={hint}>
      {prefix ? (
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-0 grid w-10 place-items-center border-r border-slate-200 text-xs font-medium text-slate-500">
            {prefix}
          </span>
          {input}
        </div>
      ) : (
        input
      )}
    </FieldWrap>
  );
}

function ChargeFields({ defaultMonth, minMonth, maxMonth, lastReading, defaultRate, currency }: Omit<Props, "action">) {
  const [type, setType] = useState<string>("electricity");
  const [previous, setPrevious] = useState(lastReading !== null ? String(lastReading) : "");
  const [current, setCurrent] = useState("");
  const [rate, setRate] = useState(defaultRate !== null ? toMajorString(defaultRate) : "");
  const [amount, setAmount] = useState("");
  const [amountEdited, setAmountEdited] = useState(false);

  // After a successful save, start the next bill from this reading.
  const result = useActionResult();
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (!result.ok || handled.current === result) return;
    handled.current = result;
    if (type === "electricity" && current.trim()) setPrevious(current);
    setCurrent("");
    setAmount("");
    setAmountEdited(false);
  }, [result, type, current]);

  const prev = previous.trim() === "" ? NaN : Number(previous.replace(/,/g, ""));
  const curr = current.trim() === "" ? NaN : Number(current.replace(/,/g, ""));
  const rateMinor = parseMoney(rate);
  const units = Number.isFinite(prev) && Number.isFinite(curr) ? meterUnits(prev, curr) : null;
  const computed = units !== null && rateMinor ? electricityAmount(prev, curr, rateMinor) : null;
  const isElectricity = type === "electricity";
  // Until the admin types an amount, it follows units × rate.
  const shownAmount = isElectricity && !amountEdited && computed !== null ? toMajorString(computed) : amount;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-2 gap-4">
        <TextField name="month" label="Month" type="month" defaultValue={defaultMonth} min={minMonth} max={maxMonth} />
        <TypeSelect value={type} onChange={setType} />
      </div>
      {isElectricity && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
          <div className="grid grid-cols-2 gap-3">
            <LiveInput
              name="meterPrevious"
              label="Previous reading"
              value={previous}
              onChange={setPrevious}
              hint={lastReading !== null ? "From the last bill" : undefined}
            />
            <LiveInput name="meterCurrent" label="Current reading" value={current} onChange={setCurrent} />
          </div>
          <LiveInput
            name="meterRate"
            label="Rate per unit"
            value={rate}
            onChange={setRate}
            prefix={currency}
            hint={defaultRate === null ? "Set a default rate on the property or in Settings." : undefined}
          />
          <p className="text-xs text-slate-600" aria-live="polite">
            {units !== null && computed !== null
              ? `${units} units × ${formatMoney(rateMinor!)} = ${formatMoney(computed)}`
              : current && units === null && Number.isFinite(curr)
                ? "Current reading is below the previous reading."
                : "Enter readings to calculate the amount, or type the amount directly."}
          </p>
        </div>
      )}
      <LiveInput
        name="amount"
        label="Amount"
        value={shownAmount}
        onChange={(v) => {
          setAmount(v);
          setAmountEdited(true);
        }}
        prefix={currency}
        hint={isElectricity && computed !== null && amountEdited ? "Edited by hand." : undefined}
      />
      <TextField name="note" label="Note (optional)" placeholder="Bill no., period…" />
    </div>
  );
}

function TypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { id, error } = useField("type");
  return (
    <FieldWrap id={id} label="Type" error={error}>
      <select id={id} name="type" value={value} onChange={(e) => onChange(e.target.value)} className="input pr-8">
        {CHARGE_TYPES.map((t) => (
          <option key={t} value={t}>
            {CHARGE_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

export function ChargeForm({ action, ...rest }: Props) {
  return (
    <ActionForm action={action}>
      <ChargeFields {...rest} />
      <div className="mt-4">
        <SubmitButton className="w-full">Add charge</SubmitButton>
      </div>
    </ActionForm>
  );
}
