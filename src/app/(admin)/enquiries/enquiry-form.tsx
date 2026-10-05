import Link from "next/link";
import { ActionForm, MoneyField, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { ENQUIRY_SOURCES, SOURCE_LABEL } from "@/lib/enquiries";
import { currencySymbol, toMajorString } from "@/lib/money";
import type { ActionState } from "@/lib/validation";
import { EnquiryPhoneField } from "./phone-field";

export type EnquiryDefaults = {
  name?: string;
  phone?: string;
  email?: string;
  propertyId?: string;
  source?: string;
  budget?: number | null;
  desiredMoveIn?: string;
  occupants?: number | null;
  occupation?: string;
  notes?: string;
};

export function EnquiryForm({
  action,
  properties,
  defaults = {},
  submitLabel,
  cancelHref,
  excludeId,
  withFollowUp,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  properties: { value: string; label: string }[];
  defaults?: EnquiryDefaults;
  submitLabel: string;
  cancelHref: string;
  /** Enquiry being edited (left out of the duplicate warning). */
  excludeId?: string;
  /** Show the follow-up date (new enquiries only; later it is set on the enquiry page). */
  withFollowUp?: boolean;
}) {
  return (
    <ActionForm action={action} className="card p-5 sm:p-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <TextField name="name" label="Name" defaultValue={defaults.name} autoComplete="off" />
        <EnquiryPhoneField defaultValue={defaults.phone} excludeId={excludeId} />
        <TextField name="email" label="Email (optional)" type="email" defaultValue={defaults.email} />
        <SelectField
          name="source"
          label="Source"
          defaultValue={defaults.source ?? "phone_call"}
          options={ENQUIRY_SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))}
        />
        <SelectField
          name="propertyId"
          label="Property"
          placeholder="Any property"
          options={properties}
          defaultValue={defaults.propertyId}
          className="sm:col-span-2"
        />
        <MoneyField
          name="budget"
          label="Monthly budget (optional)"
          currency={currencySymbol()}
          defaultValue={defaults.budget ? toMajorString(defaults.budget) : ""}
        />
        <TextField name="desiredMoveIn" label="Desired move-in (optional)" type="date" defaultValue={defaults.desiredMoveIn} />
        <TextField
          name="occupants"
          label="Occupants (optional)"
          inputMode="numeric"
          defaultValue={defaults.occupants ?? ""}
          placeholder="e.g. 3"
        />
        <TextField name="occupation" label="Occupation (optional)" defaultValue={defaults.occupation} placeholder="e.g. Software engineer" />
        {withFollowUp && (
          <TextField name="followUpDate" label="Follow up on (optional)" type="date" hint="You'll get a reminder on this day." />
        )}
        <TextAreaField name="notes" label="Notes" defaultValue={defaults.notes} rows={3} className="sm:col-span-2" />
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
