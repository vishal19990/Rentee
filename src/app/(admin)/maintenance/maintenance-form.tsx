import Link from "next/link";
import { ActionForm, MoneyField, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { titleCase } from "@/lib/format";
import { currencySymbol, toMajorString } from "@/lib/money";
import { MAINTENANCE_PRIORITIES, MAINTENANCE_STATUSES, type ActionState } from "@/lib/validation";

export type MaintenanceDefaults = {
  propertyId?: string;
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  cost?: number;
};

export function MaintenanceForm({
  action,
  properties,
  defaults = {},
  submitLabel,
  cancelHref,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  properties: { value: string; label: string }[];
  defaults?: MaintenanceDefaults;
  submitLabel: string;
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} className="card p-5 sm:p-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <SelectField
          name="propertyId"
          label="Property"
          placeholder="Select a property…"
          options={properties}
          defaultValue={defaults.propertyId}
          className="sm:col-span-2"
        />
        <TextField
          name="title"
          label="Title"
          defaultValue={defaults.title}
          placeholder="e.g. Leaking kitchen tap"
          className="sm:col-span-2"
        />
        <TextAreaField name="description" label="Description" defaultValue={defaults.description} rows={4} className="sm:col-span-2" />
        <SelectField
          name="priority"
          label="Priority"
          defaultValue={defaults.priority ?? "medium"}
          options={MAINTENANCE_PRIORITIES.map((p) => ({ value: p, label: titleCase(p) }))}
        />
        <SelectField
          name="status"
          label="Status"
          defaultValue={defaults.status ?? "open"}
          options={MAINTENANCE_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))}
        />
        <MoneyField
          name="cost"
          label="Cost (optional)"
          currency={currencySymbol()}
          defaultValue={defaults.cost ? toMajorString(defaults.cost) : ""}
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
