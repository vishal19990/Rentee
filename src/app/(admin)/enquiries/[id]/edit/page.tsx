import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, propertyOptions, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { toISODate } from "@/lib/rent";
import { Enquiry } from "@/models/Enquiry";
import { PageHeader } from "@/components/ui";
import { updateEnquiry } from "../../actions";
import { EnquiryForm } from "../../enquiry-form";

export const metadata: Metadata = { title: "Edit enquiry" };

export default async function EditEnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  await connectDB();
  const e = await Enquiry.findById(_id).lean();
  if (!e) notFound();
  // Include archived properties so an enquiry about an archived property keeps its selection.
  const properties = await propertyOptions({ includeArchived: true });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${e.name}`} back={{ href: `/enquiries/${id}`, label: e.name }} />
      <EnquiryForm
        action={updateEnquiry.bind(null, id)}
        submitLabel="Save changes"
        cancelHref={`/enquiries/${id}`}
        excludeId={id}
        properties={properties.map((p) => ({ value: p.id, label: `${p.name} · ${p.city}` }))}
        defaults={{
          name: e.name,
          phone: e.phone,
          email: e.email ?? "",
          propertyId: e.property ? toId(e.property) : undefined,
          source: e.source,
          budget: e.budget ?? null,
          desiredMoveIn: e.desiredMoveIn ? toISODate(e.desiredMoveIn) : undefined,
          occupants: e.occupants ?? null,
          occupation: e.occupation ?? "",
          notes: e.notes ?? "",
        }}
      />
    </div>
  );
}
