import { getAgreementExpiryDays } from "@/lib/agreement-data";
import { ActionForm, SubmitButton, TextField } from "@/components/form";
import { Card } from "@/components/ui";
import { saveAgreementSettings } from "@/app/(admin)/settings/agreement-actions";

/** Settings card (F8): how many days before an agreement ends the renewal reminder appears. */
export async function AgreementSettingsCard({ className }: { className?: string }) {
  const days = await getAgreementExpiryDays();
  return (
    <Card title="Agreements" description="When Rentee reminds you to renew a rental agreement." className={className}>
      <ActionForm action={saveAgreementSettings} className="space-y-4">
        <TextField
          name="agreementExpiryDays"
          label="Renewal reminder (days before the end date)"
          type="number"
          inputMode="numeric"
          min={1}
          max={120}
          defaultValue={days}
          hint="An “Agreement expired” alert follows once the end date passes without a renewal."
        />
        <div className="flex justify-end">
          <SubmitButton>Save agreement settings</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
