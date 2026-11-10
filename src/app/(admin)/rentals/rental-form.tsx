import Link from "next/link";
import { ActionForm, MoneyField, SelectField, SubmitButton, TextField } from "@/components/form";
import { currencySymbol, toMajorString } from "@/lib/money";
import type { ActionState } from "@/lib/validation";

export type RentalDefaults = {
  propertyId?: string;
  tenantId?: string;
  moveInDate?: string;
  moveOutDate?: string | null;
  monthlyRent?: number;
  deposit?: number;
  /** New rentals: default advance date (today). */
  depositAdvanceDate?: string;
  /** Latest allowed advance date (today). */
  advanceMaxDate?: string;
};

export function RentalForm({
  action,
  defaults = {},
  properties,
  tenants,
  showMoveOut,
  submitLabel,
  cancelHref,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: RentalDefaults;
  /** Omit property/tenant options when editing (they are fixed for an existing rental). */
  properties?: { value: string; label: string }[];
  tenants?: { value: string; label: string }[];
  /** Month-to-month: the move-out date is only editable on an existing rental. */
  showMoveOut?: boolean;
  submitLabel: string;
  cancelHref: string;
}) {
  const symbol = currencySymbol();
  return (
    <ActionForm action={action} className="card p-5 sm:p-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {properties && (
          <SelectField name="propertyId" label="Property" placeholder="Select a property…" options={properties} defaultValue={defaults.propertyId} />
        )}
        {tenants && (
          <SelectField name="tenantId" label="Tenant" placeholder="Select a tenant…" options={tenants} defaultValue={defaults.tenantId} />
        )}
        <TextField
          name="moveInDate"
          label="Move-in date"
          type="date"
          defaultValue={defaults.moveInDate}
          hint={
            showMoveOut
              ? "Billing cycles run from this day each month; rent for a cycle is due at its end."
              : "Rent is billed in monthly cycles from this day and paid at the end of each cycle (moved in 20 Oct → pays 20 Nov)."
          }
        />
        {showMoveOut && (
          <TextField
            name="moveOutDate"
            label="Move-out date (optional)"
            type="date"
            defaultValue={defaults.moveOutDate ?? ""}
            hint="Leave empty while the tenant still lives here."
          />
        )}
        <MoneyField
          name="monthlyRent"
          label={showMoveOut ? "Original monthly rent" : "Monthly rent"}
          currency={symbol}
          defaultValue={defaults.monthlyRent ? toMajorString(defaults.monthlyRent) : ""}
          hint={showMoveOut ? "Rent from move-in. For an increase, use “Change rent” on the rental page." : undefined}
        />
        <MoneyField
          name="deposit"
          label="Deposit quoted"
          currency={symbol}
          defaultValue={defaults.deposit !== undefined ? toMajorString(defaults.deposit) : ""}
          hint={
            showMoveOut
              ? "Total security deposit agreed with the tenant. Record payments, deductions or a refund in the Deposit card on the rental page."
              : "Total security deposit agreed with the tenant."
          }
        />
        {!showMoveOut && (
          <>
            <MoneyField
              name="depositAdvance"
              label="Advance received"
              currency={symbol}
              placeholder="Whole deposit"
              hint="Paid so far towards the deposit. Leave empty if the whole deposit is paid; enter 0 if nothing yet. The rest can be added later on the rental page."
            />
            <TextField
              name="depositAdvanceDate"
              label="Advance date"
              type="date"
              defaultValue={defaults.depositAdvanceDate}
              max={defaults.advanceMaxDate}
              hint="Leave empty to use the move-in date. Can be earlier if it was paid at booking."
            />
          </>
        )}
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-5">
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
