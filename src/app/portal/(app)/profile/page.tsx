import type { Metadata } from "next";
import { ActionForm, SubmitButton, TextField } from "@/components/form";
import { PortalOccupants, portalOccupantRows } from "@/components/portal/portal-occupants";
import { Card } from "@/components/ui";
import { connectDB } from "@/lib/db";
import { MIN_PASSWORD } from "@/lib/portal-auth";
import { requireTenant } from "@/lib/tenant-auth";
import { Tenant } from "@/models/Tenant";
import { changePortalPassword, updatePortalEmail, updatePortalPhone } from "./actions";

export const metadata: Metadata = { title: "Profile" };

export default async function PortalProfile() {
  const me = await requireTenant();
  await connectDB();
  // Only the fields the tenant may see and edit (never notes, ID number or account internals).
  const t = await Tenant.findById(me.tenantOid).select("name phone email occupants").lean();
  if (!t) return null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Profile</h1>
        <p className="mt-0.5 text-sm text-slate-500">{t.name}. Changes are shared with your landlord.</p>
      </div>

      <Card title="Contact details">
        <div className="space-y-6">
          <ActionForm action={updatePortalPhone} className="space-y-3">
            <TextField name="phone" label="Phone (WhatsApp)" type="tel" inputMode="tel" defaultValue={t.phone} hint="You also sign in with this number." />
            <SubmitButton size="sm" variant="secondary">
              Save phone
            </SubmitButton>
          </ActionForm>
          <ActionForm action={updatePortalEmail} className="space-y-3 border-t border-slate-100 pt-5">
            <TextField name="email" label="Email (optional)" type="email" inputMode="email" defaultValue={t.email} />
            <SubmitButton size="sm" variant="secondary">
              Save email
            </SubmitButton>
          </ActionForm>
        </div>
      </Card>

      <PortalOccupants occupants={portalOccupantRows(t.occupants)} />

      <Card title="Change password">
        <ActionForm action={changePortalPassword} className="space-y-3">
          <TextField name="currentPassword" label="Current password" type="password" autoComplete="current-password" />
          <TextField name="password" label="New password" type="password" autoComplete="new-password" hint={`At least ${MIN_PASSWORD} characters, with letters.`} />
          <TextField name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" />
          <SubmitButton size="sm">Change password</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
