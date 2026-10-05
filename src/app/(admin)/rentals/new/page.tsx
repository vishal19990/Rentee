import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { occupiedPropertyIds, propertyOptions, tenantOptions } from "@/lib/data";
import { localToday } from "@/lib/rent";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { IconFile } from "@/components/icons";
import { createRental } from "../actions";
import { RentalForm } from "../rental-form";

export const metadata: Metadata = { title: "New rental" };

export default async function NewRentalPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; tenantId?: string; property?: string; tenant?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  // `property` / `tenant` are accepted too (used by "Convert to tenant" on an enquiry).
  const propertyId = sp.propertyId ?? sp.property;
  const tenantId = sp.tenantId ?? sp.tenant;
  const [properties, tenants, occupied] = await Promise.all([propertyOptions(), tenantOptions(), occupiedPropertyIds()]);
  const selected = properties.find((p) => p.id === propertyId);

  const back = selected ? { href: `/properties/${selected.id}`, label: selected.name } : { href: "/rentals", label: "Rentals" };

  if (properties.length === 0 || tenants.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="New rental" back={back} />
        <Card>
          <EmptyState
            icon={<IconFile />}
            title={properties.length === 0 ? "Add a property first" : "Add a tenant first"}
            description="A rental records a tenant living in a property."
            action={
              <Link href={properties.length === 0 ? "/properties/new" : "/tenants/new"} className="btn btn-primary">
                {properties.length === 0 ? "Add property" : "Add tenant"}
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New rental"
        description="Month-to-month: rent is charged every month until you record a move-out."
        back={back}
      />
      <RentalForm
        action={createRental}
        submitLabel="Create rental"
        cancelHref={back.href}
        properties={properties.map((p) => ({
          value: p.id,
          label: `${p.name} · ${p.city}${occupied.has(p.id) ? " (occupied)" : ""}`,
        }))}
        tenants={tenants.map((t) => ({ value: t.id, label: `${t.name} · ${t.phone}` }))}
        defaults={{
          propertyId: selected?.id,
          tenantId: tenants.some((t) => t.id === tenantId) ? tenantId : undefined,
          moveInDate: localToday(),
          monthlyRent: selected?.monthlyRent,
          deposit: selected ? selected.monthlyRent * 2 : undefined,
          dueDay: 5,
        }}
      />
    </div>
  );
}
