import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadRentals } from "@/lib/data";
import { rentalBadge } from "@/lib/rent";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { ButtonLink, EmptyState, FilterTabs, PageHeader, StatusBadge, Table, TBody, Td, Th, THead } from "@/components/ui";
import { IconFile, IconPlus } from "@/components/icons";

export const metadata: Metadata = { title: "Rentals" };

export default async function RentalsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireUser();
  const { filter: raw } = await searchParams;
  const filter = raw === "moved_out" || raw === "all" ? raw : "active";
  const all = await loadRentals();
  const counts = {
    active: all.filter((r) => r.status === "active").length,
    moved_out: all.filter((r) => r.status === "moved_out").length,
    all: all.length,
  };
  const rentals = filter === "all" ? all : all.filter((r) => r.status === filter);

  return (
    <>
      <PageHeader
        title="Rentals"
        description="Who lives where. Month-to-month: rent accrues until a move-out is recorded."
        actions={
          <ButtonLink href="/rentals/new">
            <IconPlus className="size-4" /> New rental
          </ButtonLink>
        }
      />
      <FilterTabs
        active={filter}
        tabs={[
          { key: "active", label: "Active", href: "/rentals", count: counts.active },
          { key: "moved_out", label: "Moved out", href: "/rentals?filter=moved_out", count: counts.moved_out },
          { key: "all", label: "All", href: "/rentals?filter=all", count: counts.all },
        ]}
      />
      <div className="card overflow-hidden">
        {rentals.length === 0 ? (
          <EmptyState
            icon={<IconFile />}
            title={filter === "active" ? "No active rentals" : "No rentals here"}
            description="Create a rental when a tenant moves into a property to start tracking rent."
            action={
              <ButtonLink href="/rentals/new">
                <IconPlus className="size-4" /> New rental
              </ButtonLink>
            }
          />
        ) : (
          <Table>
            <THead>
              <Th>Property</Th>
              <Th>Tenant</Th>
              <Th>Moved in</Th>
              <Th>Move-out</Th>
              <Th className="text-right">Rent</Th>
              <Th className="text-right">Overdue</Th>
              <Th>Status</Th>
            </THead>
            <TBody>
              {rentals.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <Td>
                    <Link href={`/rentals/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {r.propertyName}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/tenants/${r.tenantId}`} className="text-slate-600 hover:text-brand-700">
                      {r.tenantName}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">{formatDate(r.moveInDate)}</Td>
                  <Td className="whitespace-nowrap text-slate-600">
                    {r.moveOutDate ? formatDate(r.moveOutDate) : <span className="text-slate-400">—</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.monthlyRent)}</Td>
                  <Td className="text-right tabular-nums">
                    {r.summary.overdueAmount > 0 ? (
                      <span className="font-semibold text-rose-600">{formatMoney(r.summary.overdueAmount)}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge status={rentalBadge(r)} />
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
