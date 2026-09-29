import Link from "next/link";
import { ActionForm, SubmitButton, TextAreaField, TextField } from "@/components/form";
import type { ActionState } from "@/lib/validation";

export type TenantDefaults = { name?: string; phone?: string; email?: string; idNumber?: string; notes?: string };

export function TenantForm({
  action,
  defaults = {},
  submitLabel,
  cancelHref,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: TenantDefaults;
  submitLabel: string;
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} className="card p-5 sm:p-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <TextField name="name" label="Full name" defaultValue={defaults.name} autoComplete="off" className="sm:col-span-2" />
        <TextField name="phone" label="Phone" type="tel" inputMode="tel" defaultValue={defaults.phone} placeholder="+91 98765 43210" />
        <TextField name="email" label="Email (optional)" type="email" defaultValue={defaults.email} autoComplete="off" />
        <TextField name="idNumber" label="ID number (optional)" defaultValue={defaults.idNumber} hint="Aadhaar, passport, driving licence…" className="sm:col-span-2" />
        <TextAreaField name="notes" label="Notes" defaultValue={defaults.notes} rows={4} className="sm:col-span-2" />
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
