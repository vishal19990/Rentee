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
  dueDay?: number;
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
          hint={showMoveOut ? undefined : "Rent is charged monthly from this date until the tenant moves out."}
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
          label="Security deposit"
          currency={symbol}
          defaultValue={defaults.deposit !== undefined ? toMajorString(defaults.deposit) : ""}
          hint={
            showMoveOut
              ? "Agreed deposit at move-in. To record more money received, deductions or a refund, use the Deposit card on the rental page."
              : "Recorded as received in the deposit ledger."
          }
        />
        <TextField
          name="dueDay"
          label="Rent due day"
          type="number"
          inputMode="numeric"
          min={1}
          max={28}
          defaultValue={defaults.dueDay ?? 5}
          hint="Day of the month rent is due (1–28). Unpaid rent becomes overdue after this day."
        />
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
