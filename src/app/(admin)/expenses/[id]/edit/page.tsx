import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, propertyOptions, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { toISODate } from "@/lib/rent";
import { Expense } from "@/models/Expense";
import { ConfirmAction } from "@/components/form";
import { Card, PageHeader } from "@/components/ui";
import { IconPaperclip, IconTrash } from "@/components/icons";
import { deleteExpense, removeExpenseBill, updateExpense } from "../../actions";
import { ExpenseForm } from "../../expense-form";

export const metadata: Metadata = { title: "Edit expense" };

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  await connectDB();
  const e = await Expense.findById(_id).lean();
  if (!e) notFound();
  const properties = await propertyOptions({ includeArchived: true });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Edit expense"
        back={{ href: "/expenses", label: "Expenses" }}
        description={
          e.maintenance ? (
            <>
              Logged from a{" "}
              <Link className="link" href={`/maintenance/${toId(e.maintenance)}/edit`}>
                maintenance request
              </Link>
              .
            </>
          ) : undefined
        }
        actions={
          <ConfirmAction
            action={deleteExpense.bind(null, id)}
            label="Delete"
            confirmLabel="Delete"
            prompt="Delete expense?"
            variant="danger"
            icon={<IconTrash className="size-3.5" />}
          />
        }
      />
      {e.bill && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a href={`/api/expenses/${id}/bill`} target="_blank" rel="noopener" className="flex min-w-0 items-center gap-2 text-sm link">
              <IconPaperclip className="size-4 shrink-0" />
              <span className="truncate">{e.bill.name}</span>
              <span className="shrink-0 text-xs text-slate-400">{fileSize(e.bill.size)}</span>
            </a>
            <ConfirmAction action={removeExpenseBill.bind(null, id)} label="Remove bill" confirmLabel="Remove" prompt="Remove the bill?" />
          </div>
        </Card>
      )}
      <ExpenseForm
        action={updateExpense.bind(null, id)}
        submitLabel="Save changes"
        cancelHref="/expenses"
        hasBill={!!e.bill}
        properties={properties.map((p) => ({ value: p.id, label: `${p.name} · ${p.city}` }))}
        defaults={{
          propertyId: e.property ? toId(e.property) : null,
          category: e.category,
          amount: e.amount,
          date: toISODate(e.date),
          vendor: e.vendor,
          note: e.note,
        }}
      />
    </div>
  );
}
