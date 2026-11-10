"use client";

import { useState } from "react";
import { FieldWrap, SelectField, useField } from "@/components/form";

export type PeriodChoices = { options: { value: string; label: string }[]; defaultMonth: string };

/**
 * Rental (optional) + "For period" selects for the payment form. Rent is billed in cycles from
 * the move-in day, so the periods depend on the rental: choosing another rental swaps the list
 * and selects that rental's default (oldest unpaid due cycle, else the current cycle).
 */
export function PaymentPeriodFields({
  rentals,
  rentalId,
  periods,
  defaultRentalId,
  defaultMonth,
  compact,
}: {
  /** Rentals to choose from (omit when the rental is fixed). */
  rentals?: { value: string; label: string }[];
  /** Fixed rental. */
  rentalId?: string;
  /** Period choices per rental id. */
  periods: Record<string, PeriodChoices>;
  defaultRentalId?: string;
  defaultMonth?: string;
  compact?: boolean;
}) {
  const rentalField = useField("rentalId", defaultRentalId);
  const [selected, setSelected] = useState(rentalId ?? rentalField.value);
  const choices = periods[selected];
  const month = useField("forMonth", defaultMonth ?? choices?.defaultMonth);
  const [period, setPeriod] = useState(
    choices?.options.some((o) => o.value === month.value) ? month.value : (choices?.defaultMonth ?? ""),
  );

  const chooseRental = (id: string) => {
    setSelected(id);
    setPeriod(periods[id]?.defaultMonth ?? "");
  };

  return (
    <>
      {rentals && (
        <div className={compact ? undefined : "sm:col-span-2"} onChange={(e) => chooseRental((e.target as unknown as HTMLSelectElement).value)}>
          <SelectField name="rentalId" label="Rental" placeholder="Select a rental…" options={rentals} defaultValue={defaultRentalId} />
        </div>
      )}
      <FieldWrap
        id={month.id}
        label="For period"
        error={month.error}
        hint={choices ? "Billing cycle from the move-in day; rent is due at its end." : "Select a rental first."}
      >
        <select
          id={month.id}
          name="forMonth"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          disabled={!choices}
          aria-invalid={month.error ? true : undefined}
          aria-describedby={month.error ? `${month.id}-err` : undefined}
          className="input pr-8"
        >
          {(choices?.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </FieldWrap>
    </>
  );
}
