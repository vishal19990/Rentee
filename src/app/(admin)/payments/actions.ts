"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { recordPayment } from "@/lib/payment-store";
import { parseForm, paymentSchema, type ActionState } from "@/lib/validation";

/** Records a rent payment. Payments are append-only (never hard-deleted). */
export async function createPayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(paymentSchema, fd);
  if (!parsed.success) return parsed.state;
  const { rentalId } = parsed.data;
  const values = parsed.values;

  const res = await recordPayment(parsed.data);
  if (!res.ok) {
    return res.field === "rentalId"
      ? { ok: false, fieldErrors: { rentalId: ["Select a rental"] }, message: res.message, values }
      : { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { forMonth: [res.message] }, values };
  }

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${rentalId}`);
  revalidatePath(`/properties/${res.propertyId}`);
  revalidatePath(`/tenants/${res.tenantId}`);

  if (fd.get("returnTo") === "rental") redirect(`/rentals/${rentalId}`);
  return { ok: true, message: "Payment recorded." };
}
