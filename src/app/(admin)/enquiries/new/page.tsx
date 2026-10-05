import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { propertyOptions } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { createEnquiry } from "../actions";
import { EnquiryForm } from "../enquiry-form";

export const metadata: Metadata = { title: "New enquiry" };

export default async function NewEnquiryPage({ searchParams }: { searchParams: Promise<{ propertyId?: string }> }) {
  await requireUser();
  const { propertyId } = await searchParams;
  const properties = await propertyOptions();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New enquiry" description="Someone asked about renting a property." back={{ href: "/enquiries", label: "Enquiries" }} />
      <EnquiryForm
        action={createEnquiry}
        submitLabel="Save enquiry"
        cancelHref="/enquiries"
        withFollowUp
        properties={properties.map((p) => ({ value: p.id, label: `${p.name} · ${p.city}` }))}
        defaults={{ propertyId: properties.some((p) => p.id === propertyId) ? propertyId : undefined }}
      />
    </div>
  );
}
