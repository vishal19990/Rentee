import { addPortalOccupant, removePortalOccupant, updatePortalOccupant } from "@/app/portal/(app)/profile/actions";
import { ActionForm, CheckboxField, ConfirmAction, Hidden, SelectField, SubmitButton, TextField } from "@/components/form";
import { IconPencil, IconPlus, IconTrash, IconUsers } from "@/components/icons";
import type { OccupantRow } from "@/components/occupants-card";
import { Badge, Card } from "@/components/ui";
import { MAX_OCCUPANTS, OCCUPANT_RELATIONS, OCCUPANT_RELATION_LABELS } from "@/lib/occupants";

/** Stored subdocuments -> rows (same mapping as the admin card, without importing its admin actions). */
export function portalOccupantRows(raw: unknown): OccupantRow[] {
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  return list.map((o) => ({
    id: String(o._id),
    name: String(o.name ?? ""),
    phone: String(o.phone ?? ""),
    relation: (OCCUPANT_RELATIONS as readonly string[]).includes(String(o.relation)) ? (o.relation as OccupantRow["relation"]) : "other",
    idLast4: String(o.idLast4 ?? ""),
    notes: String(o.notes ?? ""),
    emergency: o.emergency === true,
  }));
}

const relationOptions =OCCUPANT_RELATIONS.map((r) => ({ value: r, label: OCCUPANT_RELATION_LABELS[r] }));

function Fields({ o }: { o?: OccupantRow }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField name="name" label="Name" defaultValue={o?.name} />
        <TextField name="phone" label="Phone (optional)" type="tel" defaultValue={o?.phone} />
        <SelectField name="relation" label="Relation" options={relationOptions} defaultValue={o?.relation ?? "roommate"} />
        <TextField name="idLast4" label="ID last 4 digits (optional)" inputMode="numeric" placeholder="e.g. 4521" defaultValue={o?.idLast4} />
      </div>
      <TextField name="notes" label="Notes (optional)" defaultValue={o?.notes} />
      <CheckboxField name="emergency" label="Emergency contact" defaultChecked={o?.emergency} />
    </>
  );
}

/** Tenant portal profile: people staying with the tenant (same fields and rules as the admin card). */
export function PortalOccupants({ occupants }: { occupants: OccupantRow[] }) {
  return (
    <Card title="People staying with you" description="Only the last 4 digits of an ID are kept.">
      {occupants.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <IconUsers className="size-4" /> No one added.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {occupants.map((o) => (
            <li key={o.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                  {o.name}
                  <Badge tone="slate">{OCCUPANT_RELATION_LABELS[o.relation]}</Badge>
                  {o.emergency && <Badge tone="rose">Emergency contact</Badge>}
                </p>
                <p className="text-xs break-words text-slate-500">
                  {[o.phone, o.idLast4 ? `ID ••••${o.idLast4}` : "", o.notes].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              <ConfirmAction
                action={removePortalOccupant}
                hidden={{ occupantId: o.id }}
                label="Remove"
                confirmLabel="Remove"
                prompt={`Remove ${o.name}?`}
                variant="ghost"
                icon={<IconTrash className="size-3.5" />}
              />
              <details className="basis-full">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-brand-700 hover:underline [&::-webkit-details-marker]:hidden">
                  <IconPencil className="size-3.5" /> Edit
                </summary>
                <ActionForm action={updatePortalOccupant} className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <Hidden name="occupantId" value={o.id} />
                  <Fields o={o} />
                  <SubmitButton size="sm" variant="secondary">
                    Save changes
                  </SubmitButton>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
      )}
      {occupants.length < MAX_OCCUPANTS && (
        <details className="mt-4 border-t border-slate-100 pt-4">
          <summary className="btn btn-secondary btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <IconPlus className="size-3.5" /> Add person
          </summary>
          <ActionForm action={addPortalOccupant} className="mt-3 space-y-3">
            <Fields />
            <SubmitButton size="sm">Add</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}
