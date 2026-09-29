import { ActionForm, Hidden, MoneyField, SelectField, SubmitButton, TextField } from "@/components/form";
import { titleCase } from "@/lib/format";
import { currencySymbol, toMajorString } from "@/lib/money";
import { PAYMENT_METHODS, type ActionState } from "@/lib/validation";

export function PaymentForm({
  action,
  rentalId,
  rentals,
  defaults = {},
  returnTo,
  compact,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  /** Fixed rental (e.g. on the rental page) … */
  rentalId?: string;
  /** … or a list to choose from. */
  rentals?: { value: string; label: string }[];
  defaults?: { rentalId?: string; forMonth?: string; amount?: number; paidOn?: string; method?: string };
  returnTo?: "rental";
  compact?: boolean;
}) {
  return (
    <ActionForm action={action}>
      {rentalId && <Hidden name="rentalId" value={rentalId} />}
      {returnTo && <Hidden name="returnTo" value={returnTo} />}
      <div className={compact ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 gap-5 sm:grid-cols-2"}>
        {rentals && (
          <SelectField
            name="rentalId"
            label="Rental"
            placeholder="Select a rental…"
            options={rentals}
            defaultValue={defaults.rentalId}
            className={compact ? undefined : "sm:col-span-2"}
          />
        )}
        <TextField name="forMonth" label="For month" type="month" defaultValue={defaults.forMonth} placeholder="YYYY-MM" />
        <MoneyField
          name="amount"
          label="Amount"
          currency={currencySymbol()}
          defaultValue={defaults.amount ? toMajorString(defaults.amount) : ""}
        />
        <TextField name="paidOn" label="Paid on" type="date" defaultValue={defaults.paidOn} />
        <SelectField
          name="method"
          label="Method"
          defaultValue={defaults.method ?? "bank_transfer"}
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: m === "upi" ? "UPI" : titleCase(m) }))}
        />
        <TextField name="note" label="Note (optional)" placeholder="Reference no., remarks…" className={compact ? undefined : "sm:col-span-2"} />
      </div>
      <div className="mt-5 flex justify-end">
        <SubmitButton className={compact ? "w-full" : undefined}>Record payment</SubmitButton>
      </div>
    </ActionForm>
  );
}
