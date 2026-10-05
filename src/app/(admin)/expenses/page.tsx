import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { asObjectId, propertyOptions, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, expenseCategoryLabel } from "@/lib/expenses";
import { dateFromISO, formatDate } from "@/lib/format";
import { fyList, fyOf, fyRange, isFy } from "@/lib/fy";
import { formatMoney } from "@/lib/money";
import { localToday, toISODate } from "@/lib/rent";
import { Expense } from "@/models/Expense";
import { ButtonLink, EmptyState, PageHeader, Table, TBody, Td, Th, THead } from "@/components/ui";
import { IconChart, IconPaperclip, IconPlus, IconReceipt } from "@/components/icons";

export const metadata: Metadata = { title: "Expenses" };

type Search = { fy?: string; property?: string; category?: string };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const today = localToday();
  const fy = sp.fy === "all" ? "all" : sp.fy && isFy(sp.fy) ? sp.fy : fyOf(today);
  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(sp.category ?? "") ? sp.category! : "";
  const propertyParam = sp.property === "general" ? "general" : sp.property && asObjectId(sp.property) ? sp.property : "";

  await connectDB();
  const query: Record<string, unknown> = {};
  if (fy !== "all") {
    const { start, endExclusive } = fyRange(fy);
    query.date = { $gte: dateFromISO(start), $lt: dateFromISO(endExclusive) };
  }
  if (category) query.category = category;
  if (propertyParam === "general") query.property = null;
  else if (propertyParam) query.property = asObjectId(propertyParam);

  const [expenses, properties, oldest] = await Promise.all([
    Expense.find(query).sort({ date: -1, createdAt: -1 }).lean(),
    propertyOptions({ includeArchived: true }),
    Expense.findOne().sort({ date: 1 }).select("date").lean(),
  ]);
  const propName = new Map(properties.map((p) => [p.id, p.name]));
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const years = fyList(oldest ? toISODate(oldest.date) : today, today);
  const filtered = fy !== fyOf(today) || !!category || !!propertyParam;

  return (
    <>
      <PageHeader
        title="Expenses"
        description="What you spend on your properties: repairs, taxes, society charges and more."
        actions={
          <>
            <ButtonLink href="/reports/profit" variant="secondary">
              <IconChart className="size-4" /> Profit report
            </ButtonLink>
            <ButtonLink href="/expenses/new">
              <IconPlus className="size-4" /> Add expense
            </ButtonLink>
          </>
        }
      />

      <form method="get" className="mb-4 grid grid-cols-1 gap-3 rounded-xl bg-slate-100 p-3 sm:grid-cols-4 sm:items-end">
        <label className="text-xs font-medium text-slate-600">
          Financial year
          <select name="fy" defaultValue={fy} className="input mt-1">
            {years.map((y) => (
              <option key={y} value={y}>
                FY {y}
              </option>
            ))}
            <option value="all">All years</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Property
          <select name="property" defaultValue={propertyParam} className="input mt-1">
            <option value="">All properties</option>
            <option value="general">General (no property)</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Category
          <select name="category" defaultValue={category} className="input mt-1">
            <option value="">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary flex-1">
            Filter
          </button>
          {filtered && (
            <Link href="/expenses" className="btn btn-ghost">
              Reset
            </Link>
          )}
        </div>
      </form>

      <p className="mb-3 text-sm text-slate-600">
        {expenses.length} expense{expenses.length === 1 ? "" : "s"} · Total{" "}
        <span className="font-semibold text-slate-900 tabular-nums">{formatMoney(total)}</span>
      </p>

      <div className="card overflow-hidden">
        {expenses.length === 0 ? (
          <EmptyState
            icon={<IconReceipt />}
            title={filtered ? "No expenses match these filters" : "No expenses this year"}
            description="Log repairs, property tax, society charges and other costs to see your profit."
            action={
              <ButtonLink href="/expenses/new">
                <IconPlus className="size-4" /> Add expense
              </ButtonLink>
            }
          />
        ) : (
          <Table>
            <THead>
              <Th>Date</Th>
              <Th>Property</Th>
              <Th>Category</Th>
              <Th>Vendor / note</Th>
              <Th className="text-right">Amount</Th>
            </THead>
            <TBody>
              {expenses.map((e) => {
                const id = toId(e._id);
                return (
                  <tr key={id} className="hover:bg-slate-50/60">
                    <Td className="whitespace-nowrap">
                      <Link href={`/expenses/${id}/edit`} className="font-medium text-slate-900 hover:text-brand-700">
                        {formatDate(e.date)}
                      </Link>
                    </Td>
                    <Td className="text-slate-600">{e.property ? (propName.get(toId(e.property)) ?? "(deleted property)") : "General"}</Td>
                    <Td>{expenseCategoryLabel(e.category)}</Td>
                    <Td className="max-w-[18rem] text-slate-500">
                      <span className="flex items-center gap-1.5">
                        {e.bill && (
                          <a href={`/api/expenses/${id}/bill`} target="_blank" rel="noopener" title="View bill" className="text-brand-600">
                            <IconPaperclip className="size-4" />
                            <span className="sr-only">View bill</span>
                          </a>
                        )}
                        <span className="truncate">{[e.vendor, e.note].filter(Boolean).join(" · ") || "—"}</span>
                      </span>
                    </Td>
                    <Td className="text-right font-medium tabular-nums">
                      <Link href={`/expenses/${id}/edit`}>{formatMoney(e.amount)}</Link>
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
