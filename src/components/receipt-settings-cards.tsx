import { getLandlordDetails, getUpiSettings } from "@/lib/landlord-settings";
import { CURRENCY } from "@/lib/money";
import { ActionForm, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { Card } from "@/components/ui";
import { saveLandlordSettings, saveUpiSettings } from "@/app/(admin)/settings/receipt-actions";

/** Settings card (F1): landlord details printed on rent receipts. */
export async function LandlordSettingsCard({ className }: { className?: string }) {
  const d = await getLandlordDetails();
  return (
    <Card
      title="Receipts"
      description="Your details as printed on rent receipts, including receipts shared with tenants by link."
      className={className}
    >
      <ActionForm action={saveLandlordSettings} className="space-y-4">
        <TextField name="landlordName" label="Landlord name" defaultValue={d.name} autoComplete="off" />
        <TextAreaField name="landlordAddress" label="Address" rows={2} defaultValue={d.address} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField name="landlordPhone" label="Phone (optional)" type="tel" defaultValue={d.phone} autoComplete="off" />
          <TextField
            name="landlordPan"
            label="PAN (optional)"
            defaultValue={d.pan}
            autoComplete="off"
            hint="Tenants claiming HRA may need it."
          />
        </div>
        <div className="flex justify-end">
          <SubmitButton>Save receipt details</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

/** Settings card (F10): UPI ID for tenant pay links and the {payLink} placeholder. */
export async function UpiSettingsCard({ className }: { className?: string }) {
  const upi = await getUpiSettings();
  return (
    <Card
      title="UPI payments"
      description="Tenants get a pay link with a UPI QR code. Payments are not recorded automatically; record them once they arrive."
      className={className}
    >
      <ActionForm action={saveUpiSettings} className="space-y-4">
        <TextField
          name="upiId"
          label="UPI ID"
          placeholder="yourname@okhdfcbank"
          defaultValue={upi.upiId}
          autoComplete="off"
          hint="Leave empty to turn pay links off."
        />
        <TextField
          name="upiPayeeName"
          label="Payee name (optional)"
          defaultValue={upi.payeeName}
          autoComplete="off"
          hint="Shown in the tenant's UPI app. Defaults to the landlord name."
        />
        {!upi.enabled && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-600/20">
            {CURRENCY !== "INR"
              ? `UPI pay links need the app currency to be INR (it is ${CURRENCY}).`
              : "Add your UPI ID to include a pay link ({payLink}) in WhatsApp reminders."}
          </p>
        )}
        <div className="flex justify-end">
          <SubmitButton>Save UPI settings</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
