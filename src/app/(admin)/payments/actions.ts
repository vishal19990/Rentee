"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { syncNotificationsSafe } from "@/lib/notification-sync";
import { dateFromISO } from "@/lib/format";
import { formatMonth, payableMonths } from "@/lib/rent";
import { parseForm, paymentSchema, type ActionState } from "@/lib/validation";
import { Payment } from "@/models/Payment";
import { Rental } from "@/models/Rental";
import { ensureReceiptNo } from "@/lib/receipt-store";

/** Records a rent payment. Payments are append-only (never hard-deleted). */
export async function createPayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(paymentSchema, fd);
  if (!parsed.success) return parsed.state;
  const { rentalId, forMonth, paidOn, ...rest } = parsed.data;
  const values = parsed.values;

  await connectDB();
  const rental = await Rental.findById(rentalId).lean();
  if (!rental) return { ok: false, fieldErrors: { rentalId: ["Select a rental"] }, message: "Rental not found.", values };

  const { first, last } = payableMonths(rental);
  if (forMonth < first || forMonth > last) {
    const msg =
      forMonth < first
        ? `Month can't be before the move-in month (${formatMonth(first)})`
        : rental.moveOutDate
          ? `Month can't be after the move-out month (${formatMonth(last)})`
          : `Rent can be prepaid up to ${formatMonth(last)}`;
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { forMonth: [msg] }, values };
  }

  const payment = await Payment.create({ rental: rentalId, forMonth, paidOn: dateFromISO(paidOn), ...rest });
  // Number its rent receipt now (F1); if this fails, the receipt page numbers it on first open.
  await ensureReceiptNo(payment._id).catch((err) => console.error("[receipts] numbering failed:", err));

  // Resolve (or update) this rental's rent notifications right away.
  await syncNotificationsSafe({ scope: { rentalIds: [rentalId] } });

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${rentalId}`);
  revalidatePath(`/properties/${rental.property}`);
  revalidatePath(`/tenants/${rental.tenant}`);

  if (fd.get("returnTo") === "rental") redirect(`/rentals/${rentalId}`);
  return { ok: true, message: "Payment recorded." };
}
