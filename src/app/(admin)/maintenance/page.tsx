import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { Maintenance } from "@/models/Maintenance";
import { Property } from "@/models/Property";
import { ButtonLink, EmptyState, FilterTabs, PageHeader, StatusBadge, Table, TBody, Td, Th, THead } from "@/components/ui";
import { IconPlus, IconWrench } from "@/components/icons";
import { setMaintenanceStatus } from "./actions";

export const metadata: Metadata = { title: "Maintenance" };

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireUser();
  const { filter: raw } = await searchParams;
  const filter = raw === "done" || raw === "all" ? raw : "open";

  await connectDB();
  const all = await Maintenance.find().sort({ createdAt: -1 }).lean();
  const props = await Property.find({ _id: { $in: all.map((m) => m.property) } }).select("name").lean();
  const propName = new Map(props.map((p) => [toId(p._id), p.name]));

  const openItems = all.filter((m) => m.status !== "done");
  const counts = { open: openItems.length, done: all.length - openItems.length, all: all.length };
  const shown = (filter === "open" ? openItems : filter === "done" ? all.filter((m) => m.status === "done") : all)
    .slice()
    .sort((a, b) =>
      filter === "open" ? (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) : 0,
    );

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Repair issues and their costs across your properties."
        actions={
          <ButtonLink href="/maintenance/new">
            <IconPlus className="size-4" /> New request
          </ButtonLink>
        }
      />
      <FilterTabs
        active={filter}
        tabs={[
          { key: "open", label: "Open", href: "/maintenance", count: counts.open },
          { key: "done", label: "Done", href: "/maintenance?filter=done", count: counts.done },
          { key: "all", label: "All", href: "/maintenance?filter=all", count: counts.all },
        ]}
      />
      <div className="card overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState
            icon={<IconWrench />}
            title={filter === "open" ? "No open requests" : "Nothing here yet"}
            description={filter === "open" ? "All caught up. Log a request when something needs fixing." : undefined}
            action={
              <ButtonLink href="/maintenance/new">
                <IconPlus className="size-4" /> New request
              </ButtonLink>
            }
          />
        ) : (
          <Table>
            <THead>
              <Th>Issue</Th>
              <Th>Property</Th>
              <Th>Priority</Th>
              <Th>Status</Th>
              <Th className="text-right">Cost</Th>
              <Th className="text-right">Update</Th>
            </THead>
            <TBody>
              {shown.map((m) => {
                const id = toId(m._id);
                return (
                  <tr key={id} className="hover:bg-slate-50/60">
                    <Td>
                      <Link href={`/maintenance/${id}/edit`} className="font-medium text-slate-900 hover:text-brand-700">
                        {m.title}
                      </Link>
                      <div className="text-xs text-slate-400">{formatDate(m.createdAt)}</div>
                    </Td>
                    <Td>
                      <Link href={`/properties/${toId(m.property)}`} className="text-slate-600 hover:text-brand-700">
                        {propName.get(toId(m.property)) ?? "—"}
                      </Link>
                    </Td>
                    <Td>
                      <StatusBadge status={m.priority} />
                    </Td>
                    <Td>
                      <StatusBadge status={m.status} />
                    </Td>
                    <Td className="text-right tabular-nums">{m.cost ? formatMoney(m.cost) : "—"}</Td>
                    <Td className="text-right">
                      {m.status !== "done" ? (
                        <form
                          action={setMaintenanceStatus.bind(null, id, m.status === "open" ? "in_progress" : "done")}
                          className="inline"
                        >
                          <button type="submit" className="btn btn-secondary btn-sm">
                            {m.status === "open" ? "Start" : "Mark done"}
                          </button>
                        </form>
                      ) : (
                        <form action={setMaintenanceStatus.bind(null, id, "open")} className="inline">
                          <button type="submit" className="btn btn-ghost btn-sm">
                            Reopen
                          </button>
                        </form>
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
