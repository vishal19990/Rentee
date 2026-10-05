import { amountInWords } from "@/lib/amount-words";
import { chargeLabel } from "@/lib/charges";
import { formatDate } from "@/lib/format";
import { CURRENCY, formatMoney } from "@/lib/money";
import type { ReceiptData } from "@/lib/receipts";
import { formatMonth } from "@/lib/rent";

/** A rent receipt, as shown on the admin receipt page and the public /r/ link (F1). */
export function ReceiptView({ r }: { r: ReceiptData }) {
  const b = r.breakdown;
  const landlordName = r.landlord.name || "Landlord";
  return (
    <article className="card overflow-hidden">
      <div className="h-2 bg-brand-600" />
      <div className="space-y-6 p-5 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-widest text-brand-600 uppercase">Rent receipt</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">{landlordName}</h2>
            {r.landlord.address && <p className="mt-0.5 text-sm whitespace-pre-line text-slate-500">{r.landlord.address}</p>}
            {(r.landlord.phone || r.landlord.pan) && (
              <p className="mt-0.5 text-sm text-slate-500">
                {[r.landlord.phone && `Phone ${r.landlord.phone}`, r.landlord.pan && `PAN ${r.landlord.pan}`].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="text-left sm:text-right">
            <p className="text-sm font-semibold text-slate-900 tabular-nums">{r.receiptNo}</p>
            <p className="text-sm text-slate-500">{formatDate(r.paidOn)}</p>
          </div>
        </header>

        <p className="text-sm leading-relaxed text-slate-700">
          Received with thanks from <strong className="text-slate-900">{r.tenantName}</strong> the sum of{" "}
          <strong className="text-slate-900">{formatMoney(r.amount)}</strong> towards rent{b.chargeItems.length > 0 && " and charges"} for{" "}
          <strong className="text-slate-900">{r.propertyName}</strong>
          {r.propertyAddress && `, ${r.propertyAddress}`}, for the month of {formatMonth(b.month)}.
        </p>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">For month</dt>
            <dd className="font-medium text-slate-900">{formatMonth(b.month)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Paid on</dt>
            <dd className="font-medium text-slate-900">{formatDate(r.paidOn)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Method</dt>
            <dd className="font-medium text-slate-900">{r.method}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Property</dt>
            <dd className="font-medium break-words text-slate-900">{r.propertyName}</dd>
          </div>
          {r.note && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-xs text-slate-500">Note</dt>
              <dd className="break-words text-slate-700">{r.note}</dd>
            </div>
          )}
        </dl>

        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Breakdown for {formatMonth(b.month)}</p>
          <table className="mt-2 w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="py-2 text-slate-600">Rent</td>
                <td className="py-2 text-right tabular-nums">{formatMoney(b.rent)}</td>
              </tr>
              {b.chargeItems.map((c) => (
                <tr key={c.type}>
                  <td className="py-2 text-slate-600">{chargeLabel(c.type)}</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(c.amount)}</td>
                </tr>
              ))}
              <tr className="font-semibold text-slate-900">
                <td className="py-2">Total due for the month</td>
                <td className="py-2 text-right tabular-nums">{formatMoney(b.monthDue)}</td>
              </tr>
              <tr>
                <td className="py-2 text-slate-600">Paid towards the month (incl. this receipt)</td>
                <td className="py-2 text-right tabular-nums">{formatMoney(b.paidToDate)}</td>
              </tr>
              <tr>
                <td className="py-2 text-slate-600">Balance for the month</td>
                <td className={b.balanceAfter > 0 ? "py-2 text-right font-medium text-rose-600 tabular-nums" : "py-2 text-right tabular-nums"}>
                  {b.balanceAfter > 0 ? formatMoney(b.balanceAfter) : "Nil"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900">Amount received</span>
            <span className="text-xl font-semibold text-slate-900 tabular-nums">{formatMoney(r.amount)}</span>
          </div>
          {CURRENCY === "INR" && <p className="mt-1 text-xs text-slate-500">{amountInWords(r.amount)}</p>}
        </div>

        <p className="text-xs text-slate-400">This is a computer-generated receipt.</p>
      </div>
    </article>
  );
}
