import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, loadRentals } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { updateRental } from "../../actions";
import { RentalForm } from "../../rental-form";

export const metadata: Metadata = { title: "Edit rental" };

export default async function EditRentalPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  const [r] = await loadRentals({ _id });
  if (!r) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Edit rental"
        description={`${r.propertyName} · ${r.tenantName}`}
        back={{ href: `/rentals/${id}`, label: "Rental" }}
      />
      <RentalForm
        action={updateRental.bind(null, id)}
        submitLabel="Save changes"
        cancelHref={`/rentals/${id}`}
        showMoveOut
        defaults={{
          moveInDate: r.moveInDate,
          moveOutDate: r.moveOutDate,
          monthlyRent: r.monthlyRent,
          deposit: r.deposit,
          dueDay: r.dueDay,
        }}
      />
    </div>
  );
}
