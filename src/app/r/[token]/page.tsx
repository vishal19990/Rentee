import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadReceipt } from "@/lib/receipt-store";
import { verifyReceiptToken } from "@/lib/signed-links";
import { ReceiptView } from "@/components/receipt-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rent receipt",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Public rent receipt (F1), opened from a signed link shared on WhatsApp; no login.
 * Shows only the tenant's first name, the property name, the month and amounts.
 */
export default async function PublicReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = verifyReceiptToken(token);
  if (!v.ok) notFound();
  const receipt = await loadReceipt(v.link.paymentId, "public");
  if (!receipt) notFound();

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8 sm:py-12">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">Rent receipt {receipt.receiptNo}</p>
        <a href={`/r/${token}/pdf`} className="btn btn-primary btn-sm" download>
          Download PDF
        </a>
      </div>
      <ReceiptView r={receipt} />
    </main>
  );
}
