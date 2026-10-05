import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { asObjectId, loadRentals } from "@/lib/data";
import { getUpiSettings } from "@/lib/landlord-settings";
import { formatMoney } from "@/lib/money";
import { firstName } from "@/lib/receipts";
import { formatMonth, localToday } from "@/lib/rent";
import { verifyPayToken } from "@/lib/signed-links";
import { payDue, upiUri } from "@/lib/upi";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pay rent",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Public UPI pay page (F10), opened from a signed /p/ link in a WhatsApp reminder; no login.
 * The amount is computed live. Paying here does not record anything: the landlord records the
 * payment once it arrives. Shows only the tenant's first name, property name, months and amounts.
 */
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = verifyPayToken(token);
  if (!v.ok) notFound();
  const upi = await getUpiSettings();
  if (!upi.enabled) notFound();
  const _id = asObjectId(v.link.rentalId);
  if (!_id) notFound();
  const today = localToday();
  const [rental] = await loadRentals({ _id }, today);
  if (!rental) notFound();

  const due = payDue(rental, v.link.through, today);
  const monthsLabel = due.months.map((m) => formatMonth(m.month)).join(", ");
  const uri =
    due.amount > 0
      ? upiUri({
          vpa: upi.upiId,
          payeeName: upi.payee,
          amount: due.amount,
          note: `Rent ${due.months.length === 1 ? formatMonth(due.months[0].month) : `${due.months.length} months`} ${rental.propertyName}`,
        })
      : null;
  const qr = uri ? await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M", width: 240 }) : null;

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 py-8 sm:py-12">
      <section className="card overflow-hidden">
        <div className="h-2 bg-brand-600" />
        <div className="space-y-5 p-5 sm:p-6">
          <header>
            <p className="text-xs font-semibold tracking-widest text-brand-600 uppercase">Rent payment</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">{rental.propertyName}</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Hi {firstName(rental.tenantName)}, pay {upi.payee} by UPI.
            </p>
          </header>

          {due.amount === 0 ? (
            <div className="rounded-xl bg-emerald-50 p-4 text-center ring-1 ring-emerald-600/20">
              <p className="text-base font-semibold text-emerald-800">Nothing due, thank you!</p>
              <p className="mt-1 text-sm text-emerald-700">All rent up to now has been received.</p>
            </div>
          ) : (
            <>
              <div>
                <ul className="divide-y divide-slate-100 text-sm">
                  {due.months.map((m) => (
                    <li key={m.month} className="flex justify-between gap-3 py-2">
                      <span className="text-slate-600">{formatMonth(m.month)}</span>
                      <span className="tabular-nums">{formatMoney(m.balance)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-slate-200 pt-3">
                  <span className="text-sm font-semibold text-slate-900">Amount due</span>
                  <span className="text-2xl font-semibold text-slate-900 tabular-nums">{formatMoney(due.amount)}</span>
                </div>
              </div>

              {qr && (
                <div className="flex flex-col items-center gap-2">
                  <div
                    className="w-60 max-w-full rounded-xl bg-white p-2 ring-1 ring-slate-200 [&>svg]:h-auto [&>svg]:w-full"
                    role="img"
                    aria-label={`UPI QR code to pay ${formatMoney(due.amount)}`}
                    dangerouslySetInnerHTML={{ __html: qr }}
                  />
                  <p className="text-xs text-slate-500">Scan with any UPI app</p>
                </div>
              )}

              {uri && (
                <a href={uri} className="btn btn-primary w-full">
                  Pay {formatMoney(due.amount)} with a UPI app
                </a>
              )}
              <p className="text-center text-xs text-slate-500">
                UPI ID: <span className="font-medium text-slate-700 select-all">{upi.upiId}</span>
                {monthsLabel && <> · For {monthsLabel}</>}
              </p>
            </>
          )}

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200/70">
            Payment is confirmed once the landlord records it. The amount shown is updated as payments are recorded.
          </p>
        </div>
      </section>
    </main>
  );
}
