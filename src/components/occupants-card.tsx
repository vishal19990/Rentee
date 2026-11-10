import { addOccupant, removeOccupant, updateOccupant } from "@/app/(admin)/tenants/occupant-actions";
import { MAX_OCCUPANTS, OCCUPANT_RELATIONS, OCCUPANT_RELATION_LABELS, type OccupantRelation } from "@/lib/occupants";
import { ActionForm, CheckboxField, ConfirmAction, Hidden, SelectField, SubmitButton, TextField } from "./form";
import { IconPencil, IconPhone, IconPlus, IconTrash, IconUsers } from "./icons";
import { TenantAvatar } from "./tenant-avatar";
import { Badge, Card } from "./ui";

export type OccupantRow = {
  id: string;
  name: string;
  phone: string;
  relation: OccupantRelation;
  idLast4: string;
  notes: string;
  emergency: boolean;
};

const relationOptions = OCCUPANT_RELATIONS.map((r) => ({ value: r, label: OCCUPANT_RELATION_LABELS[r] }));

function OccupantFields({ o }: { o?: OccupantRow }) {
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

/** Tenant page: other people staying with this tenant, with add / edit / remove. */
export function OccupantsCard({ tenantId, occupants }: { tenantId: string; occupants: OccupantRow[] }) {
  return (
    <Card title="Other occupants" description="People staying with this tenant, and secondary or emergency contacts.">
      {occupants.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <IconUsers className="size-4" /> No one added yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {occupants.map((o) => (
            <li key={o.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3">
              <TenantAvatar tenantId={o.id} name={o.name} size="sm" />
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
              <div className="flex items-center gap-1">
                {o.phone && (
                  <a href={`tel:${o.phone.replace(/[^\d+]/g, "")}`} className="btn btn-ghost btn-sm" aria-label={`Call ${o.name}`}>
                    <IconPhone className="size-3.5" />
                  </a>
                )}
                <ConfirmAction
                  action={removeOccupant.bind(null, tenantId)}
                  hidden={{ occupantId: o.id }}
                  label="Remove"
                  confirmLabel="Remove"
                  prompt={`Remove ${o.name}?`}
                  variant="ghost"
                  icon={<IconTrash className="size-3.5" />}
                />
              </div>
              <details className="basis-full">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-brand-700 hover:underline [&::-webkit-details-marker]:hidden">
                  <IconPencil className="size-3.5" /> Edit
                </summary>
                <ActionForm action={updateOccupant.bind(null, tenantId)} className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <Hidden name="occupantId" value={o.id} />
                  <OccupantFields o={o} />
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
          <ActionForm action={addOccupant.bind(null, tenantId)} className="mt-3 space-y-3">
            <OccupantFields />
            <SubmitButton size="sm">Add</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}

/** Rental page: compact, read-only list of who else stays in the room. */
export function OccupantsSummary({ tenantId, occupants }: { tenantId: string; occupants: OccupantRow[] }) {
  if (occupants.length === 0) return null;
  return (
    <Card title={`Also staying (${occupants.length})`} description={<a className="link" href={`/tenants/${tenantId}`}>Manage on the tenant page</a>}>
      <ul className="space-y-2">
        {occupants.map((o) => (
          <li key={o.id} className="flex items-center gap-3 text-sm">
            <TenantAvatar tenantId={o.id} name={o.name} size="xs" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-slate-900">{o.name}</span>
              <span className="text-slate-500"> · {OCCUPANT_RELATION_LABELS[o.relation]}{o.phone ? ` · ${o.phone}` : ""}</span>
            </span>
            {o.emergency && <Badge tone="rose">Emergency</Badge>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Maps stored subdocuments to rows. */
export function toOccupantRows(raw: unknown): OccupantRow[] {
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  return list.map((o) => ({
    id: String(o._id),
    name: String(o.name ?? ""),
    phone: String(o.phone ?? ""),
    relation: (OCCUPANT_RELATIONS as readonly string[]).includes(String(o.relation)) ? (o.relation as OccupantRelation) : "other",
    idLast4: String(o.idLast4 ?? ""),
    notes: String(o.notes ?? ""),
    emergency: o.emergency === true,
  }));
}
