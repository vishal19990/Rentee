import "server-only";
import { connectDB } from "./db";
import { dateFromISO } from "./format";
import { syncNotificationsSafe } from "./notification-sync";
import { ensureReceiptNo } from "./receipt-store";
import { formatCycleMonth, formatMonth, payableMonths } from "./rent";
import type { PAYMENT_METHODS } from "./validation";
import { Payment } from "@/models/Payment";
import { Rental } from "@/models/Rental";

export type NewPayment = {
  rentalId: string;
  forMonth: string;
  amount: number;
  paidOn: string;
  method: (typeof PAYMENT_METHODS)[number];
  note: string;
};

export type RecordPaymentResult =
  | { ok: true; paymentId: string; propertyId: string; tenantId: string; /** The billing cycle paid for, e.g. "20 Oct – 19 Nov 2026". */ period: string }
  | { ok: false; field: "rentalId" | "forMonth"; message: string };

/**
 * Records a rent payment (already validated by paymentSchema): `forMonth` is a billing-cycle key
 * that must be payable for the rental (move-in cycle through the final cycle, or up to 12 months
 * ahead while open-ended).
 * Numbers the receipt and refreshes the rental's notifications. Payments are append-only.
 * Shared by the payment form and the MCP connector.
 */
export async function recordPayment(p: NewPayment): Promise<RecordPaymentResult> {
  await connectDB();
  const rental = await Rental.findById(p.rentalId).lean();
  if (!rental) return { ok: false, field: "rentalId", message: "Rental not found." };

  const { first, last } = payableMonths(rental);
  if (p.forMonth < first || p.forMonth > last) {
    const message =
      p.forMonth < first
        ? `Period can't be before the move-in cycle (${formatCycleMonth(rental, first)})`
        : rental.moveOutDate
          ? `Period can't be after the move-out cycle (${formatCycleMonth(rental, last)})`
          : `Rent can be prepaid up to the cycle starting in ${formatMonth(last)}`;
    return { ok: false, field: "forMonth", message };
  }

  const payment = await Payment.create({
    rental: p.rentalId,
    forMonth: p.forMonth,
    paidOn: dateFromISO(p.paidOn),
    amount: p.amount,
    method: p.method,
    note: p.note,
  });
  // Number its rent receipt now (F1); if this fails, the receipt page numbers it on first open.
  await ensureReceiptNo(payment._id).catch((err) => console.error("[receipts] numbering failed:", err));

  // Resolve (or update) this rental's rent notifications right away.
  await syncNotificationsSafe({ scope: { rentalIds: [p.rentalId] } });

  return {
    ok: true,
    paymentId: String(payment._id),
    propertyId: String(rental.property),
    tenantId: String(rental.tenant),
    period: formatCycleMonth(rental, p.forMonth),
  };
}
