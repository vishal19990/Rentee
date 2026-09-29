import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadRentals, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Tenant } from "@/models/Tenant";
import { Badge, ButtonLink, EmptyState, FilterTabs, PageHeader, StatusBadge, Table, TBody, Td, Th, THead } from "@/components/ui";
import { IconPlus, IconUsers } from "@/components/icons";

export const metadata: Metadata = { title: "Tenants" };

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireUser();
  const { filter } = await searchParams;
  const archived = filter === "archived";

  await connectDB();
  const [tenants, activeCount, archivedCount, rentals] = await Promise.all([
    Tenant.find({ archived }).sort({ name: 1 }).lean(),
    Tenant.countDocuments({ archived: false }),
    Tenant.countDocuments({ archived: true }),
    loadRentals({ status: "active" }),
  ]);
  const rentalByTenant = new Map(rentals.map((l) => [l.tenantId, l]));

  return (
    <>
      <PageHeader
        title="Tenants"
        description="People renting your properties."
        actions={
          <ButtonLink href="/tenants/new">
            <IconPlus className="size-4" /> Add tenant
          </ButtonLink>
        }
      />
      <FilterTabs
        active={archived ? "archived" : "active"}
        tabs={[
          { key: "active", label: "Current", href: "/tenants", count: activeCount },
          { key: "archived", label: "Archived", href: "/tenants?filter=archived", count: archivedCount },
        ]}
      />
      <div className="card overflow-hidden">
        {tenants.length === 0 ? (
          <EmptyState
            icon={<IconUsers />}
            title={archived ? "No archived tenants" : "No tenants yet"}
            description={archived ? undefined : "Add a tenant, then create a rental to assign them to a property."}
            action={
              archived ? undefined : (
                <ButtonLink href="/tenants/new">
                  <IconPlus className="size-4" /> Add tenant
                </ButtonLink>
              )
            }
          />
        ) : (
          <Table>
            <THead>
              <Th>Name</Th>
              <Th>Contact</Th>
              <Th>Property</Th>
              <Th className="text-right">Overdue</Th>
              <Th>Status</Th>
            </THead>
            <TBody>
              {tenants.map((t) => {
                const rental = rentalByTenant.get(toId(t._id));
                return (
                  <tr key={toId(t._id)} className="hover:bg-slate-50/60">
                    <Td>
                      <Link href={`/tenants/${toId(t._id)}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {t.name}
                      </Link>
                    </Td>
                    <Td className="text-slate-600">
                      <div>{t.phone}</div>
                      {t.email && <div className="text-xs text-slate-400">{t.email}</div>}
                    </Td>
                    <Td>
                      {rental ? (
                        <Link href={`/properties/${rental.propertyId}`} className="link">
                          {rental.propertyName}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {rental && rental.summary.overdueAmount > 0 ? (
                        <span className="font-semibold text-rose-600">{formatMoney(rental.summary.overdueAmount)}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </Td>
                    <Td>
                      {t.archived ? (
                        <StatusBadge status="archived" />
                      ) : rental ? (
                        <Badge tone="emerald" dot>Renting</Badge>
                      ) : (
                        <Badge tone="slate">Not renting</Badge>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
