import { currencySymbol, toMajorString } from "@/lib/money";
import { getWifiRate } from "@/lib/wifi-store";
import { ActionForm, MoneyField, SubmitButton } from "@/components/form";
import { Card } from "@/components/ui";
import { saveWifiSettings } from "@/app/(admin)/settings/wifi-actions";

/** Settings card: WiFi price per person per month. */
export async function WifiSettingsCard({ className }: { className?: string }) {
  const rate = await getWifiRate();
  return (
    <Card title="WiFi" description="Optional WiFi is charged per person, not per room." className={className}>
      <ActionForm action={saveWifiSettings} className="space-y-4">
        <MoneyField
          name="wifiRatePerPerson"
          label="WiFi price per person (per month)"
          currency={currencySymbol()}
          defaultValue={toMajorString(rate)}
          hint="Used for WiFi plans added or changed from now on. Existing plans and past months keep their price."
        />
        <div className="flex justify-end">
          <SubmitButton>Save WiFi price</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
