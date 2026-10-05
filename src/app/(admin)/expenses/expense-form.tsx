import Link from "next/link";
import { ActionForm, FileField, Hidden, MoneyField, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/expenses";
import { currencySymbol, toMajorString } from "@/lib/money";
import type { ActionState } from "@/lib/validation";

export type ExpenseDefaults = {
  propertyId?: string | null;
  category?: string;
  amount?: number;
  date?: string;
  vendor?: string;
  note?: string;
  maintenanceId?: string | null;
};

export function ExpenseForm({
  action,
  properties,
  defaults = {},
  submitLabel,
  cancelHref,
  hasBill,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  properties: { value: string; label: string }[];
  defaults?: ExpenseDefaults;
  submitLabel: string;
  cancelHref: string;
  hasBill?: boolean;
}) {
  return (
    <ActionForm action={action} className="card p-5 sm:p-6">
      {defaults.maintenanceId && <Hidden name="maintenanceId" value={defaults.maintenanceId} />}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <SelectField
          name="propertyId"
          label="Property"
          placeholder="General (not tied to a property)"
          options={properties}
          defaultValue={defaults.propertyId ?? ""}
        />
        <SelectField
          name="category"
          label="Category"
          defaultValue={defaults.category ?? "repair"}
          options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))}
        />
        <MoneyField
          name="amount"
          label="Amount"
          currency={currencySymbol()}
          defaultValue={defaults.amount ? toMajorString(defaults.amount) : ""}
        />
        <TextField name="date" label="Date" type="date" defaultValue={defaults.date} />
        <TextField name="vendor" label="Vendor (optional)" defaultValue={defaults.vendor} placeholder="e.g. Sharma Plumbing" />
        <FileField
          name="bill"
          label={hasBill ? "Replace bill (optional)" : "Bill (optional)"}
          accept="application/pdf,image/jpeg,image/png,image/webp"
          hint="PDF, JPG, PNG or WEBP, up to 10 MB."
        />
        <TextAreaField name="note" label="Note (optional)" defaultValue={defaults.note} className="sm:col-span-2" />
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
