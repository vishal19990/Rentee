import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { loadReceipt } from "@/lib/receipt-store";
import { receiptMessage } from "@/lib/receipts";
import { receiptShareUrl } from "@/lib/share-links";
import { NO_PHONE_TOOLTIP, normalizePhone, whatsappUrl } from "@/lib/whatsapp";
import { Payment } from "@/models/Payment";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";
import { CopyLinkButton } from "@/components/copy-link-button";
import { ReceiptView } from "@/components/receipt-view";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Receipt" };

/** Admin view of a payment's rent receipt (F1): PDF download and WhatsApp share link. */
export default async function PaymentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  const receipt = await loadReceipt(id, "admin");
  if (!receipt) notFound();

  await connectDB();
  const payment = await Payment.findById(_id).select("rental forMonth").lean();
  const rental = payment ? await Rental.findById(payment.rental).select("tenant").lean() : null;
  const tenant = rental ? await Tenant.findById(rental.tenant).select("phone").lean() : null;
  const shareUrl = await receiptShareUrl(id);
  const message = receiptMessage({ ...receipt, month: receipt.breakdown.month }, shareUrl);
  const phone = normalizePhone(tenant?.phone);
  const landlordMissing = !receipt.landlord.name;

  return (
    <>
      <PageHeader
        back={rental ? { href: `/rentals/${toId(rental._id)}`, label: "Rental" } : { href: "/payments", label: "Payments" }}
        title={`Receipt ${receipt.receiptNo}`}
        description="Share it with the tenant on WhatsApp, or download the PDF."
        actions={
          <>
            <a href={`/api/receipts/${id}`} className="btn btn-primary">
              Download PDF
            </a>
            {phone ? (
              <a
                href={whatsappUrl(phone, message)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn border border-emerald-600/20 bg-emerald-50 text-emerald-800 shadow-xs hover:bg-emerald-100"
              >
                Send receipt on WhatsApp
              </a>
            ) : (
              <span title={NO_PHONE_TOOLTIP} className="inline-flex">
                <button type="button" disabled title={NO_PHONE_TOOLTIP} className="btn border border-emerald-600/20 bg-emerald-50 text-emerald-800">
                  Send receipt on WhatsApp
                </button>
              </span>
            )}
            <CopyLinkButton url={shareUrl} label="Copy share link" />
          </>
        }
      />
      {landlordMissing && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20">
          Add your name and address to receipts under{" "}
          <Link href="/settings" className="link">
            Settings → Receipts
          </Link>
          .
        </p>
      )}
      <div className="mx-auto max-w-2xl">
        <ReceiptView r={receipt} />
        <p className="mt-3 text-xs break-all text-slate-500">
          Share link (no login needed; shows the tenant&apos;s first name only):{" "}
          <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="link">
            {shareUrl}
          </a>
        </p>
      </div>
    </>
  );
}
