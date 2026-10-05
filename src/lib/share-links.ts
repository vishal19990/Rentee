import "server-only";
import { appBaseUrl } from "./app-url";
import { getUpiSettings } from "./landlord-settings";
import { signPayToken, signReceiptToken } from "./signed-links";
import type { ReminderDue } from "./whatsapp";

/** Public receipt link: <base>/r/<token> (no login; does not expire). */
export async function receiptShareUrl(paymentId: string): Promise<string> {
  return `${await appBaseUrl()}/r/${signReceiptToken(paymentId)}`;
}

/** Public UPI pay link for a rental: <base>/p/<token> (expires after 45 days); "" when UPI is off. */
export async function payLinkUrl(rentalId: string, through: string | null = null): Promise<string> {
  const upi = await getUpiSettings();
  if (!upi.enabled) return "";
  return `${await appBaseUrl()}/p/${signPayToken(rentalId, { through })}`;
}

/**
 * For {payLink} in WhatsApp reminders: returns a per-rental builder for buildReminder's
 * `payLink` option (covers the reminder's months), or undefined when UPI isn't configured.
 */
export async function reminderPayLinks(): Promise<((rentalId: string) => (due: ReminderDue) => string) | undefined> {
  const upi = await getUpiSettings();
  if (!upi.enabled) return undefined;
  const base = await appBaseUrl();
  return (rentalId) => (due) => `${base}/p/${signPayToken(rentalId, { through: due.months[due.months.length - 1]?.month ?? null })}`;
}
