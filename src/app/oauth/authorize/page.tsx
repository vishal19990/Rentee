import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/brand";
import {
  authorizeParamsFrom,
  baseUrlFrom,
  checkAuthorizeRequest,
  clientRedirect,
  oauthUrls,
  writeRequested,
} from "@/lib/oauth/core";
import { consentToken } from "@/lib/oauth/consent";
import { findClient } from "@/lib/oauth/store";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "Connect an app", robots: { index: false } };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-slate-950 px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-600/40 via-violet-500/20 to-transparent blur-3xl"
      />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo light size="lg" />
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-black/30 sm:p-8">{children}</div>
        <p className="mt-6 text-center text-xs text-slate-400">Rentee · Rental property management</p>
      </div>
    </div>
  );
}

/**
 * OAuth 2.1 consent screen for MCP clients (Claude). Signed-out admins are sent to /login and
 * back. An untrusted client or redirect URI gets an error page — never a redirect.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? null : (v ?? null); // repeated parameters are invalid
  };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") qs.set(k, v);

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`);

  const params = authorizeParamsFrom(one);
  const base = baseUrlFrom(process.env.APP_URL, await headers());
  const urls = oauthUrls(base);
  const client = await findClient(params.clientId);
  const check = checkAuthorizeRequest(params, client, urls.resource);

  if (!check.ok && check.kind === "fatal") {
    return (
      <Frame>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Can&apos;t connect this app</h1>
        <p className="mt-2 text-sm text-slate-600">{check.message}</p>
        <p className="mt-4 text-xs text-slate-500">Nothing was shared. You can close this window.</p>
      </Frame>
    );
  }
  if (!check.ok) {
    redirect(clientRedirect(params.redirectUri, { error: check.error, error_description: check.description, state: params.state, iss: urls.issuer }));
  }

  const redirectHost = new URL(params.redirectUri).host;
  const offerWrite = writeRequested(params.scope);

  return (
    <Frame>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Connect {client!.name} to Rentee?</h1>
      <p className="mt-1 text-sm text-slate-500">
        Signed in as <span className="font-medium text-slate-700">{user.name}</span> ({user.email})
      </p>
      <dl className="mt-5 space-y-2 rounded-xl bg-slate-50 p-4 text-sm ring-1 ring-slate-200/70">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">App</dt>
          <dd className="truncate font-medium text-slate-900">{client!.name}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Returns to</dt>
          <dd className="truncate font-mono text-xs leading-5 text-slate-900">{redirectHost}</dd>
        </div>
      </dl>
      <ConsentForm
        params={params}
        csrf={consentToken(user.id, params)}
        offerWrite={offerWrite}
      />
    </Frame>
  );
}
