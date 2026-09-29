import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { createTenant } from "../actions";
import { TenantForm } from "../tenant-form";

export const metadata: Metadata = { title: "Add tenant" };

export default async function NewTenantPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add tenant" back={{ href: "/tenants", label: "Tenants" }} />
      <TenantForm action={createTenant} submitLabel="Create tenant" cancelHref="/tenants" />
    </div>
  );
}
