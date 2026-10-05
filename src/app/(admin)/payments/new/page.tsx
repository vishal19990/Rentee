import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { loadRentals } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { localToday, monthOf } from "@/lib/rent";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { IconFile } from "@/components/icons";
import { createPayment } from "../actions";
import { PaymentForm } from "../payment-form";

export const metadata: Metadata = { title: "Record payment" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ rentalId?: string }> }) {
  await requireUser();
  const { rentalId } = await searchParams;
  const today = localToday();
  // Active rentals, plus moved-out ones that still have an outstanding balance.
  const rentals = (await loadRentals({}, today)).filter((l) => l.status === "active" || l.summary.balance > 0);
  const selected = rentals.find((l) => l.id === rentalId);
  const nextDue = selected?.schedule.find((m) => m.balance > 0);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Record payment" back={{ href: "/payments", label: "Payments" }} />
      {rentals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconFile />}
            title="No active rentals"
            description="Payments are recorded against a rental."
            action={<ButtonLink href="/rentals/new">New rental</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="card p-5 sm:p-6">
          <PaymentForm
            action={createPayment}
            rentals={rentals.map((l) => ({
              value: l.id,
              label: `${l.propertyName} · ${l.tenantName}${l.summary.overdueAmount > 0 ? ` (overdue ${formatMoney(l.summary.overdueAmount)})` : ""}`,
            }))}
            returnTo="rental"
            defaults={{
              rentalId: selected?.id,
              forMonth: nextDue?.month ?? monthOf(today),
              amount: nextDue?.balance ?? selected?.currentRent,
              paidOn: today,
            }}
          />
        </div>
      )}
    </div>
  );
}
