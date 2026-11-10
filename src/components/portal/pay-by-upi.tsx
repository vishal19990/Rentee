import QRCode from "qrcode";
import { formatMoney } from "@/lib/money";
import { formatCycle } from "@/lib/rent";
import { upiUri } from "@/lib/upi";

/**
 * "Pay by UPI" for the tenant portal home: QR + UPI app button for the amount due now (same UPI
 * link format as the public /p/ pay page). Paying records nothing; the landlord records it.
 */
export async function PayByUpi({
  amount,
  months,
  propertyName,
  upi,
}: {
  amount: number;
  months: { month: string; start: string; end: string }[];
  propertyName: string;
  upi: { upiId: string; payee: string; payeeName: string };
}) {
  const note = `Rent ${months.length === 1 ? formatCycle(months[0], { short: true }) : `${months.length} months`} ${propertyName}`;
  const uri = upiUri({ vpa: upi.upiId, payeeName: upi.payee, amount, note });
  const qr = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M", width: 220 });
  return (
    <div className="space-y-3 rounded-xl bg-brand-50/60 p-4 ring-1 ring-brand-100">
      <p className="text-sm font-semibold text-slate-900">Pay {formatMoney(amount)} by UPI</p>
      <div className="flex flex-col items-center gap-2">
        <div
          className="w-52 max-w-full rounded-xl bg-white p-2 ring-1 ring-slate-200 [&>svg]:h-auto [&>svg]:w-full"
          role="img"
          aria-label={`UPI QR code to pay ${formatMoney(amount)}`}
          dangerouslySetInnerHTML={{ __html: qr }}
        />
        <p className="text-xs text-slate-500">Scan with any UPI app</p>
      </div>
      <a href={uri} className="btn btn-primary w-full">
        Pay with UPI app
      </a>
      <p className="text-center text-xs text-slate-500">
        UPI ID: <span className="font-medium text-slate-700 select-all">{upi.upiId}</span> · {upi.payee}
      </p>
      <p className="text-center text-xs text-slate-500">Payment is confirmed once your landlord records it.</p>
    </div>
  );
}
