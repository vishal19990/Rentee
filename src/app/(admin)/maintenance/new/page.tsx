import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { propertyOptions } from "@/lib/data";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { IconWrench } from "@/components/icons";
import { createMaintenance } from "../actions";
import { MaintenanceForm } from "../maintenance-form";

export const metadata: Metadata = { title: "New maintenance request" };

export default async function NewMaintenancePage({ searchParams }: { searchParams: Promise<{ propertyId?: string }> }) {
  await requireUser();
  const { propertyId } = await searchParams;
  const properties = await propertyOptions();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New maintenance request" back={{ href: "/maintenance", label: "Maintenance" }} />
      {properties.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconWrench />}
            title="Add a property first"
            action={<ButtonLink href="/properties/new">Add property</ButtonLink>}
          />
        </Card>
      ) : (
        <MaintenanceForm
          action={createMaintenance}
          submitLabel="Create request"
          cancelHref="/maintenance"
          properties={properties.map((p) => ({ value: p.id, label: `${p.name} · ${p.city}` }))}
          defaults={{ propertyId: properties.some((p) => p.id === propertyId) ? propertyId : undefined }}
        />
      )}
    </div>
  );
}
