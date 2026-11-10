import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, FileField, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { Card } from "@/components/ui";
import { IconArrowLeft } from "@/components/icons";
import { myRentals } from "@/lib/portal-data";
import { localToday } from "@/lib/rent";
import { requireTenant } from "@/lib/tenant-auth";
import { createPortalMaintenance } from "../actions";

export const metadata: Metadata = { title: "New repair request" };

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low – when you get a chance" },
  { value: "medium", label: "Medium – soon, please" },
  { value: "high", label: "High – urgent problem" },
];

export default async function NewPortalMaintenance() {
  const me = await requireTenant();
  const active = (await myRentals(me, localToday())).filter((r) => r.status === "active");
  if (active.length === 0) redirect("/portal/maintenance");

  return (
    <div className="space-y-4">
      <Link href="/portal/maintenance" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <IconArrowLeft className="size-4" /> Repairs
      </Link>
      <Card title="New repair request" description="Your landlord is notified as soon as you send it.">
        <ActionForm action={createPortalMaintenance} className="space-y-4">
          {active.length === 1 ? (
            <>
              <input type="hidden" name="rentalId" value={active[0].id} />
              <p className="text-sm text-slate-600">
                For <span className="font-medium text-slate-900">{active[0].propertyName}</span>
              </p>
            </>
          ) : (
            <SelectField name="rentalId" label="Home" options={active.map((r) => ({ value: r.id, label: r.propertyName }))} />
          )}
          <TextField name="title" label="What's the problem?" placeholder="e.g. Kitchen tap is leaking" />
          <TextAreaField name="description" label="Details (optional)" rows={4} placeholder="Where is it, since when, anything you've tried…" />
          <SelectField name="priority" label="How urgent is it?" options={PRIORITY_OPTIONS} defaultValue="medium" />
          <FileField name="photo" label="Photo (optional)" accept="image/jpeg,image/png,image/webp,image/gif" hint="JPEG, PNG, WebP or GIF, up to 5 MB." />
          <SubmitButton className="w-full sm:w-auto" pendingLabel="Sending…">
            Send request
          </SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
