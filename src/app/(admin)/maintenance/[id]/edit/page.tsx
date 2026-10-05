import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId, propertyOptions, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { Expense } from "@/models/Expense";
import { Maintenance } from "@/models/Maintenance";
import { ConfirmAction } from "@/components/form";
import { ButtonLink, PageHeader } from "@/components/ui";
import { IconReceipt, IconTrash } from "@/components/icons";
import { deleteMaintenance, updateMaintenance } from "../../actions";
import { MaintenanceForm } from "../../maintenance-form";

export const metadata: Metadata = { title: "Maintenance request" };

export default async function EditMaintenancePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  await connectDB();
  const m = await Maintenance.findById(_id).lean();
  if (!m) notFound();
  // Include archived properties so a request on an archived property keeps its selection.
  const properties = await propertyOptions({ includeArchived: true });
  const expense = await Expense.findOne({ maintenance: _id }).select("amount").lean();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={m.title}
        description={`Reported ${formatDate(m.createdAt)}`}
        back={{ href: "/maintenance", label: "Maintenance" }}
        actions={
          <>
            {expense ? (
              <ButtonLink href={`/expenses/${toId(expense._id)}/edit`} variant="secondary" size="sm">
                <IconReceipt className="size-3.5" /> Logged as expense ({formatMoney(expense.amount)})
              </ButtonLink>
            ) : (
              <ButtonLink href={`/expenses/new?maintenanceId=${id}`} variant="secondary" size="sm">
                <IconReceipt className="size-3.5" /> Log cost as expense
              </ButtonLink>
            )}
            <ConfirmAction
            action={deleteMaintenance.bind(null, id)}
            label="Delete"
            confirmLabel="Delete"
            prompt="Delete request?"
            variant="danger"
            icon={<IconTrash className="size-3.5" />}
            />
          </>
        }
      />
      <MaintenanceForm
        action={updateMaintenance.bind(null, id)}
        submitLabel="Save changes"
        cancelHref="/maintenance"
        properties={properties.map((p) => ({ value: p.id, label: `${p.name} · ${p.city}` }))}
        defaults={{
          propertyId: toId(m.property),
          title: m.title,
          description: m.description,
          priority: m.priority,
          status: m.status,
          cost: m.cost ?? 0,
        }}
      />
    </div>
  );
}
