import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { Property } from "@/models/Property";
import { PageHeader } from "@/components/ui";
import { updateProperty } from "../../actions";
import { PropertyForm } from "../../property-form";

export const metadata: Metadata = { title: "Edit property" };

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  await connectDB();
  const p = await Property.findById(_id).lean();
  if (!p) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${p.name}`} back={{ href: `/properties/${id}`, label: p.name }} />
      <PropertyForm
        action={updateProperty.bind(null, id)}
        submitLabel="Save changes"
        cancelHref={`/properties/${id}`}
        defaults={{
          name: p.name,
          address: p.address,
          city: p.city,
          type: p.type,
          bedrooms: p.bedrooms,
          bathrooms: p.bathrooms,
          monthlyRent: p.monthlyRent,
          notes: p.notes,
        }}
      />
    </div>
  );
}
