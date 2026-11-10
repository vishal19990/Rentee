import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton, TextField } from "@/components/form";
import { PortalAuthFrame } from "@/components/portal/portal-auth-frame";
import { connectDB } from "@/lib/db";
import { hashInviteToken, isInviteTokenShape, MIN_PASSWORD } from "@/lib/portal-auth";
import { firstName } from "@/lib/receipts";
import { Property } from "@/models/Property";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";
import { acceptInvite } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Set your password",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Invite link from the landlord: shows the tenant's first name + property, then sets a password. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let tenant: { _id: unknown; name: string } | null = null;
  if (isInviteTokenShape(token)) {
    await connectDB();
    tenant = await Tenant.findOne({ "portal.inviteTokenHash": hashInviteToken(token), "portal.inviteExpiresAt": { $gt: new Date() } })
      .select("name")
      .lean();
  }
  if (!tenant) {
    return (
      <PortalAuthFrame title="This link doesn't work">
        <p className="text-sm text-slate-600">It may have expired, been used already, or been replaced by a newer link.</p>
        <p className="mt-3 text-sm font-medium text-slate-900">Ask your landlord for a new link.</p>
        <Link href="/portal/login" className="btn btn-secondary mt-6 w-full">
          Go to sign in
        </Link>
      </PortalAuthFrame>
    );
  }
  const rental =
    (await Rental.findOne({ tenant: tenant._id, status: "active" }).select("property").lean()) ??
    (await Rental.findOne({ tenant: tenant._id }).sort({ moveInDate: -1 }).select("property").lean());
  const property = rental ? await Property.findById(rental.property).select("name").lean() : null;

  return (
    <PortalAuthFrame
      title={`Welcome, ${firstName(tenant.name)}`}
      subtitle={property ? <>Set a password for your Rentee account for <strong className="text-slate-700">{property.name}</strong>.</> : "Set a password for your Rentee account."}
    >
      <ActionForm action={acceptInvite.bind(null, token)} className="space-y-4">
        <TextField
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters, with letters. Not your phone number.`}
        />
        <TextField name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" />
        <SubmitButton className="w-full" pendingLabel="Setting up…">
          Set password and sign in
        </SubmitButton>
      </ActionForm>
      <p className="mt-5 text-xs text-slate-500">Afterwards, sign in with your phone number and this password.</p>
    </PortalAuthFrame>
  );
}
