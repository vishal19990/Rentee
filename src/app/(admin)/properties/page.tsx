import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { occupiedPropertyIds, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { titleCase } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { photoUrl } from "@/lib/uploads";
import { Property } from "@/models/Property";
import { ButtonLink, EmptyState, FilterTabs, PageHeader, StatusBadge } from "@/components/ui";
import { IconBath, IconBed, IconHome, IconMapPin, IconPlus } from "@/components/icons";

export const metadata: Metadata = { title: "Properties" };

type Filter = "all" | "occupied" | "vacant" | "archived";

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireUser();
  const { filter: raw } = await searchParams;
  const filter: Filter = (["all", "occupied", "vacant", "archived"] as const).find((f) => f === raw) ?? "all";

  await connectDB();
  const [all, occupied] = await Promise.all([Property.find().sort({ name: 1 }).lean(), occupiedPropertyIds()]);
  const rows = all.map((p) => ({
    id: toId(p._id),
    name: p.name,
    address: p.address,
    city: p.city,
    type: p.type,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    monthlyRent: p.monthlyRent,
    photo: p.photos[0],
    archived: p.archived,
    occupied: occupied.has(toId(p._id)),
  }));
  const live = rows.filter((r) => !r.archived);
  const counts = {
    all: live.length,
    occupied: live.filter((r) => r.occupied).length,
    vacant: live.filter((r) => !r.occupied).length,
    archived: rows.length - live.length,
  };
  const shown =
    filter === "archived"
      ? rows.filter((r) => r.archived)
      : filter === "occupied"
        ? live.filter((r) => r.occupied)
        : filter === "vacant"
          ? live.filter((r) => !r.occupied)
          : live;

  return (
    <>
      <PageHeader
        title="Properties"
        description={`${counts.all} active · ${counts.occupied} occupied · ${counts.vacant} vacant`}
        actions={
          <ButtonLink href="/properties/new">
            <IconPlus className="size-4" /> Add property
          </ButtonLink>
        }
      />
      <FilterTabs
        active={filter}
        tabs={(["all", "occupied", "vacant", "archived"] as const).map((k) => ({
          key: k,
          label: k === "all" ? "All" : titleCase(k),
          href: k === "all" ? "/properties" : `/properties?filter=${k}`,
          count: counts[k],
        }))}
      />
      {shown.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconHome />}
            title={filter === "all" ? "No properties yet" : `No ${filter} properties`}
            description={filter === "all" ? "Add your first property to start tracking tenants, rentals and rent." : undefined}
            action={
              filter === "all" ? (
                <ButtonLink href="/properties/new">
                  <IconPlus className="size-4" /> Add property
                </ButtonLink>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <Link
              key={p.id}
              href={`/properties/${p.id}`}
              className="card group overflow-hidden transition hover:-translate-y-0.5 hover:shadow-pop"
            >
              <div className="relative aspect-[16/9] bg-gradient-to-br from-slate-100 to-slate-200">
                {p.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served by an authenticated route
                  <img src={photoUrl(p.photo)} alt="" className="size-full object-cover transition group-hover:scale-[1.02]" />
                ) : (
                  <div className="grid size-full place-items-center text-slate-400">
                    <IconHome className="size-10" />
                  </div>
                )}
                <div className="absolute top-3 left-3">
                  <StatusBadge status={p.archived ? "archived" : p.occupied ? "occupied" : "vacant"} />
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-slate-900">{p.name}</h3>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-slate-500">
                      <IconMapPin className="size-3.5 shrink-0" /> {p.address}, {p.city}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-sm font-semibold text-slate-900 tabular-nums">
                    {formatMoney(p.monthlyRent)}
                    <span className="block text-xs font-normal text-slate-500">/ month</span>
                  </p>
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                  <span>{titleCase(p.type)}</span>
                  <span className="flex items-center gap-1">
                    <IconBed className="size-4" /> {p.bedrooms}
                  </span>
                  <span className="flex items-center gap-1">
                    <IconBath className="size-4" /> {p.bathrooms}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
