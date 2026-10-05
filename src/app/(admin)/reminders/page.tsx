import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { buildBulkItems, DUE_SOON_WINDOW_DAYS } from "@/lib/bulk-reminders";
import { loadRentals } from "@/lib/data";
import { localToday } from "@/lib/rent";
import { reminderButtons } from "@/lib/reminders";
import { PageHeader } from "@/components/ui";
import { BulkReminders } from "./bulk-reminders";

export const metadata: Metadata = { title: "Reminders" };

export default async function RemindersPage() {
  await requireUser();
  const today = localToday();
  const rentals = await loadRentals({}, today);
  const buttons = await reminderButtons(rentals, today);
  const items = buildBulkItems(
    rentals.map((rental) => ({ rental, button: buttons.get(rental.id) })),
    today,
  );

  return (
    <>
      <PageHeader
        title="Reminders"
        description={`Send WhatsApp rent reminders in bulk: overdue rent first, then rent due in the next ${DUE_SOON_WINDOW_DAYS} days. Each reminder opens in WhatsApp for you to press send.`}
      />
      <BulkReminders items={items} serverNow={new Date().toISOString()} />
    </>
  );
}
