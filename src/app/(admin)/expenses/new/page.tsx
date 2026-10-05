import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { asObjectId, propertyOptions, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { localToday } from "@/lib/rent";
import { Expense } from "@/models/Expense";
import { Maintenance } from "@/models/Maintenance";
import { Card, PageHeader } from "@/components/ui";
import { createExpense } from "../actions";
import { ExpenseForm, type ExpenseDefaults } from "../expense-form";

export const metadata: Metadata = { title: "Add expense" };

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; maintenanceId?: string }>;
}) {
  await requireUser();
  const { propertyId, maintenanceId } = await searchParams;
  await connectDB();
  const properties = await propertyOptions({ includeArchived: true });
  const defaults: ExpenseDefaults = {
    date: localToday(),
    propertyId: properties.some((p) => p.id === propertyId) ? propertyId : null,
  };

  // "Log as expense" from a maintenance request: prefill from the request.
  const mId = maintenanceId ? asObjectId(maintenanceId) : null;
  const request = mId ? await Maintenance.findById(mId).lean() : null;
  const existing = request ? await Expense.findOne({ maintenance: request._id }).select("_id").lean() : null;
  if (request && !existing) {
    Object.assign(defaults, {
      maintenanceId: toId(request._id),
      propertyId: toId(request.property),
      category: "repair",
      amount: request.cost || undefined,
      note: request.title,
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add expense"
        description={request && !existing ? `From repair: ${request.title}` : undefined}
        back={request ? { href: `/maintenance/${toId(request._id)}/edit`, label: "Maintenance request" } : { href: "/expenses", label: "Expenses" }}
      />
      {existing ? (
        <Card>
          <p className="text-sm text-slate-600">
            This repair is already logged as an expense.{" "}
            <Link className="link" href={`/expenses/${toId(existing._id)}/edit`}>
              View the expense
            </Link>
            .
          </p>
        </Card>
      ) : (
        <ExpenseForm
          action={createExpense}
          submitLabel="Add expense"
          cancelHref={request ? `/maintenance/${toId(request._id)}/edit` : "/expenses"}
          properties={properties.map((p) => ({ value: p.id, label: `${p.name} · ${p.city}` }))}
          defaults={defaults}
        />
      )}
    </div>
  );
}
