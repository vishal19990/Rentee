import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton, TextField } from "@/components/form";
import { PortalAuthFrame } from "@/components/portal/portal-auth-frame";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { FORGOT_PASSWORD } from "@/lib/portal-auth";
import { getCurrentTenant } from "@/lib/tenant-auth";
import { turnstileSiteKey } from "@/lib/turnstile";
import { tenantLogin } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tenant sign in", robots: { index: false, follow: false } };

export default async function PortalLoginPage() {
  if (await getCurrentTenant()) redirect("/portal");
  const siteKey = turnstileSiteKey();
  return (
    <PortalAuthFrame title="Tenant sign in" subtitle="See your rent, receipts and documents, and report repairs.">
      <ActionForm action={tenantLogin} className="space-y-4">
        <TextField name="phone" label="Phone number" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" />
        <TextField name="password" label="Password" type="password" autoComplete="current-password" />
        {siteKey && <TurnstileWidget siteKey={siteKey} />}
        <SubmitButton className="w-full" pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>
      <details className="mt-5 text-sm">
        <summary className="cursor-pointer font-medium text-brand-700">Forgot password?</summary>
        <p className="mt-2 text-slate-600">{FORGOT_PASSWORD}</p>
      </details>
    </PortalAuthFrame>
  );
}
