import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { Tenant } from "@/models/Tenant";
import { PageHeader } from "@/components/ui";
import { updateTenant } from "../../actions";
import { TenantForm } from "../../tenant-form";

export const metadata: Metadata = { title: "Edit tenant" };

export default async function EditTenantPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  await connectDB();
  const t = await Tenant.findById(_id).lean();
  if (!t) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${t.name}`} back={{ href: `/tenants/${id}`, label: t.name }} />
      <TenantForm
        action={updateTenant.bind(null, id)}
        submitLabel="Save changes"
        cancelHref={`/tenants/${id}`}
        defaults={{ name: t.name, phone: t.phone, email: t.email, idNumber: t.idNumber, notes: t.notes }}
      />
    </div>
  );
}
