import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { createProperty } from "../actions";
import { PropertyForm } from "../property-form";

export const metadata: Metadata = { title: "Add property" };

export default async function NewPropertyPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add property" back={{ href: "/properties", label: "Properties" }} />
      <PropertyForm action={createProperty} submitLabel="Create property" cancelHref="/properties" />
    </div>
  );
}
