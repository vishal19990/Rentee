import Link from "next/link";
import { ActionForm, MoneyField, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { currencySymbol, toMajorString } from "@/lib/money";
import { titleCase } from "@/lib/format";
import { PROPERTY_TYPES, type ActionState } from "@/lib/validation";

export type PropertyDefaults = {
  name?: string;
  address?: string;
  city?: string;
  type?: string;
  bedrooms?: number;
  bathrooms?: number;
  monthlyRent?: number;
  notes?: string;
};

export function PropertyForm({
  action,
  defaults = {},
  submitLabel,
  cancelHref,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: PropertyDefaults;
  submitLabel: string;
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} className="card p-5 sm:p-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <TextField name="name" label="Property name" defaultValue={defaults.name} placeholder="e.g. Green Villa" className="sm:col-span-2" />
        <TextField name="address" label="Address" defaultValue={defaults.address} placeholder="Street, area" className="sm:col-span-2" />
        <TextField name="city" label="City" defaultValue={defaults.city} />
        <SelectField
          name="type"
          label="Type"
          defaultValue={defaults.type ?? "house"}
          options={PROPERTY_TYPES.map((t) => ({ value: t, label: titleCase(t) }))}
        />
        <TextField name="bedrooms" label="Bedrooms" type="number" inputMode="numeric" min={0} defaultValue={defaults.bedrooms ?? 1} />
        <TextField name="bathrooms" label="Bathrooms" type="number" inputMode="numeric" min={0} defaultValue={defaults.bathrooms ?? 1} />
        <MoneyField
          name="monthlyRent"
          label="Asking rent / month"
          currency={currencySymbol()}
          defaultValue={defaults.monthlyRent !== undefined ? toMajorString(defaults.monthlyRent) : ""}
          hint="Used as the default rent for new rentals."
        />
        <TextAreaField name="notes" label="Notes" defaultValue={defaults.notes} className="sm:col-span-2" rows={4} />
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
