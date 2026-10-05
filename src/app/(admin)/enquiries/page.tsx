import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { requireUser } from "@/lib/auth";
import { propertyOptions, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { propertyNames } from "@/lib/enquiry-data";
import {
  ENQUIRY_SOURCES,
  PERIOD_LABEL,
  SOURCE_LABEL,
  STAT_PERIODS,
  STATUS_GROUPS,
  enquiryStats,
  followUpDue,
  formatRate,
  parsePeriod,
  parseStatusGroup,
  periodRange,
  phoneKey,
  statusesInGroup,
  type EnquirySource,
  type StatusGroup,
} from "@/lib/enquiries";
import { formatDate } from "@/lib/format";
import { localToday, toISODate } from "@/lib/rent";
import { Enquiry } from "@/models/Enquiry";
import { ButtonLink, Card, EmptyState, FilterTabs, PageHeader, Table, TBody, Td, Th, THead } from "@/components/ui";
import { EnquiryStatusBadge } from "@/components/enquiry-status-badge";
import { IconMail, IconPlus } from "@/components/icons";

export const metadata: Metadata = { title: "Enquiries" };

type Search = { status?: string; q?: string; property?: string; source?: string; followup?: string; period?: string };

const GROUP_LABEL: Record<StatusGroup, string> = {
  open: "Open",
  accepted: "Accepted",
  rejected: "Rejected",
  declined: "Declined",
  all: "All",
};

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const group = parseStatusGroup(sp.status);
  const period = parsePeriod(sp.period);
  const q = (sp.q ?? "").trim().slice(0, 100);
  const propertyFilter = (sp.property ?? "").trim();
  const sourceFilter = (ENQUIRY_SOURCES as readonly string[]).includes(sp.source ?? "") ? (sp.source as EnquirySource) : "";
  const followUpOnly = sp.followup === "due";
  const today = localToday();

  await connectDB();
  const [rows, properties] = await Promise.all([
    Enquiry.find()
      .sort({ createdAt: -1 })
      .select("name phone phoneKey property source status createdAt outcomeAt visitAt followUpDate")
      .lean(),
    propertyOptions({ includeArchived: true }),
  ]);
  const names = await propertyNames(rows.map((r) => r.property));

  const all = rows.map((r) => ({
    id: toId(r._id),
    name: r.name,
    phone: r.phone,
    phoneKey: r.phoneKey || phoneKey(r.phone),
    propertyId: r.property ? toId(r.property) : null,
    propertyName: r.property ? (names.get(toId(r.property)) ?? "(deleted property)") : null,
    source: r.source,
    status: r.status,
    createdAt: r.createdAt,
    createdDate: localToday(r.createdAt),
    outcomeDate: r.outcomeAt ? localToday(r.outcomeAt) : null,
    visitDate: r.visitAt ? localToday(r.visitAt) : null,
    followUpDate: r.followUpDate ? toISODate(r.followUpDate) : null,
  }));

  // Filters other than the status group (tab counts respect them).
  const qLower = q.toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const filtered = all.filter((e) => {
    if (q) {
      const byName = e.name.toLowerCase().includes(qLower);
      const byPhone = qDigits.length >= 3 && (e.phoneKey.includes(qDigits) || e.phone.replace(/\D/g, "").includes(qDigits));
      if (!byName && !byPhone) return false;
    }
    if (propertyFilter === "any" ? e.propertyId !== null : propertyFilter && e.propertyId !== propertyFilter) return false;
    if (sourceFilter && e.source !== sourceFilter) return false;
    if (followUpOnly && !followUpDue(e, today)) return false;
    return true;
  });
  const counts = Object.fromEntries(
    STATUS_GROUPS.map((g) => [g, filtered.filter((e) => statusesInGroup(g).includes(e.status as never)).length]),
  ) as Record<StatusGroup, number>;
  const shown = filtered.filter((e) => statusesInGroup(group).includes(e.status as never));

  const stats = enquiryStats(all, periodRange(period, today));

  const href = (over: Partial<Search>) => {
    const params = new URLSearchParams();
    const merged: Search = {
      status: group === "open" ? undefined : group,
      q: q || undefined,
      property: propertyFilter || undefined,
      source: sourceFilter || undefined,
      followup: followUpOnly ? "due" : undefined,
      period: period === "this_month" ? undefined : period,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/enquiries?${s}` : "/enquiries";
  };
  const filtersActive = !!(q || propertyFilter || sourceFilter || followUpOnly);

  return (
    <>
      <PageHeader
        title="Enquiries"
        description="People who asked about your properties, and what came of it."
        actions={
          <ButtonLink href="/enquiries/new">
            <IconPlus className="size-4" /> New enquiry
          </ButtonLink>
        }
      />

      <Card
        title="Results"
        description="Received, visits and outcomes in the period. Conversion = accepted ÷ closed."
        className="mb-6"
        bodyClassName="p-0"
        actions={
          <nav className="flex flex-wrap gap-1 text-xs" aria-label="Period">
            {STAT_PERIODS.map((p) => (
              <Link
                key={p}
                href={href({ period: p === "this_month" ? undefined : p })}
                aria-current={p === period ? "page" : undefined}
                className={clsx(
                  "rounded-lg px-2 py-1 font-medium",
                  p === period ? "bg-brand-50 text-brand-700 ring-1 ring-brand-600/15" : "text-slate-500 hover:text-slate-900",
                )}
              >
                {PERIOD_LABEL[p]}
              </Link>
            ))}
          </nav>
        }
      >
        <dl className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Enquiries", value: String(stats.total) },
            { label: "Visits", value: String(stats.visits) },
            { label: "Accepted", value: String(stats.accepted) },
            { label: "Rejected", value: String(stats.rejected) },
            { label: "Declined", value: String(stats.declined) },
            { label: "Conversion", value: formatRate(stats.conversionRate), hint: `${stats.closed} closed` },
          ].map((s) => (
            <div key={s.label} className="bg-white px-5 py-4">
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{s.label}</dt>
              <dd className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{s.value}</dd>
              {s.hint && <dd className="text-xs text-slate-400">{s.hint}</dd>}
            </div>
          ))}
        </dl>
        {stats.bySource.length > 0 && (
          <div className="border-t border-slate-100">
            <Table>
              <THead>
                <Th>Source</Th>
                <Th className="text-right">Enquiries</Th>
                <Th className="text-right">Accepted</Th>
                <Th className="text-right">Conversion</Th>
              </THead>
              <TBody>
                {stats.bySource.map((s) => (
                  <tr key={s.source}>
                    <Td>{SOURCE_LABEL[s.source as EnquirySource] ?? s.source}</Td>
                    <Td className="text-right tabular-nums">{s.count}</Td>
                    <Td className="text-right tabular-nums">{s.accepted}</Td>
                    <Td className="text-right tabular-nums">{formatRate(s.rate)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      <form method="get" action="/enquiries" className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        {group !== "open" && <input type="hidden" name="status" value={group} />}
        {period !== "this_month" && <input type="hidden" name="period" value={period} />}
        <div className="lg:col-span-2">
          <label htmlFor="enq-q" className="label">
            Search
          </label>
          <input id="enq-q" name="q" defaultValue={q} placeholder="Name or phone" className="input" />
        </div>
        <div>
          <label htmlFor="enq-property" className="label">
            Property
          </label>
          <select id="enq-property" name="property" defaultValue={propertyFilter} className="input pr-8">
            <option value="">All properties</option>
            <option value="any">Any property (not specific)</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="enq-source" className="label">
            Source
          </label>
          <select id="enq-source" name="source" defaultValue={sourceFilter} className="input pr-8">
            <option value="">All sources</option>
            {ENQUIRY_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="followup" value="due" defaultChecked={followUpOnly} className="size-4 accent-brand-600" />
            Follow-up due
          </label>
          <button type="submit" className="btn btn-secondary btn-sm">
            Apply
          </button>
          {filtersActive && (
            <Link href={href({ q: undefined, property: undefined, source: undefined, followup: undefined })} className="text-sm link">
              Clear
            </Link>
          )}
        </div>
      </form>

      <FilterTabs
        active={group}
        tabs={STATUS_GROUPS.map((g) => ({
          key: g,
          label: GROUP_LABEL[g],
          href: href({ status: g === "open" ? undefined : g }),
          count: counts[g],
        }))}
      />

      <div className="card overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState
            icon={<IconMail />}
            title={all.length === 0 ? "No enquiries yet" : "No enquiries match"}
            description={
              all.length === 0
                ? "Record people who ask about your properties to track follow-ups, visits and outcomes."
                : "Try another tab or clear the filters."
            }
            action={
              <ButtonLink href="/enquiries/new">
                <IconPlus className="size-4" /> New enquiry
              </ButtonLink>
            }
          />
        ) : (
          <Table>
            <THead>
              <Th>Enquirer</Th>
              <Th>Property</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th>Follow-up</Th>
              <Th className="text-right">Received</Th>
            </THead>
            <TBody>
              {shown.map((e) => {
                const due = followUpDue(e, today);
                return (
                  <tr key={e.id} className="hover:bg-slate-50/60">
                    <Td>
                      <Link href={`/enquiries/${e.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {e.name}
                      </Link>
                      <div className="text-xs text-slate-500">{e.phone}</div>
                    </Td>
                    <Td className="text-slate-600">
                      {e.propertyId ? (
                        <Link href={`/properties/${e.propertyId}`} className="hover:text-brand-700">
                          {e.propertyName}
                        </Link>
                      ) : (
                        <span className="text-slate-400">Any property</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-slate-600">{SOURCE_LABEL[e.source as EnquirySource] ?? e.source}</Td>
                    <Td>
                      <EnquiryStatusBadge status={e.status} />
                    </Td>
                    <Td className={clsx("whitespace-nowrap", due ? "font-medium text-rose-600" : "text-slate-600")}>
                      {e.followUpDate && statusesInGroup("open").includes(e.status as never) ? formatDate(e.followUpDate) : "—"}
                    </Td>
                    <Td className="text-right whitespace-nowrap text-slate-500">{formatDate(e.createdDate)}</Td>
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
