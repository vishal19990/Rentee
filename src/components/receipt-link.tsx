import Link from "next/link";
import { IconReceipt } from "./icons";

/** "Receipt" button for a payment row (F1): opens the receipt page (PDF + WhatsApp share). */
export function ReceiptLink({ paymentId, receiptNo }: { paymentId: string; receiptNo?: string | null }) {
  return (
    <Link
      href={`/payments/${paymentId}/receipt`}
      className="btn btn-ghost btn-sm whitespace-nowrap"
      title={receiptNo ? `Receipt ${receiptNo}` : "Receipt"}
    >
      <IconReceipt className="size-3.5" /> Receipt
    </Link>
  );
}
