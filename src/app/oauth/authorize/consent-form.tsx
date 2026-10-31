"use client";

import { useState, type FormEvent } from "react";
import type { AuthorizeParams } from "@/lib/oauth/core";

/**
 * Approve / deny. Posts to /oauth/authorize/decision (session cookie + CSRF token) and then
 * navigates to the redirect it returns (the client's validated callback with code or error).
 */
export function ConsentForm({ params, csrf, offerWrite }: { params: AuthorizeParams; csrf: string; offerWrite: boolean }) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value === "deny" ? "deny" : "approve";
    const fd = new FormData(e.currentTarget);
    fd.set("decision", decision);
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch("/oauth/authorize/decision", {
        method: "POST",
        body: new URLSearchParams(fd as unknown as Record<string, string>),
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => null)) as { redirect?: string; error?: string } | null;
      if (res.ok && body?.redirect) {
        window.location.assign(body.redirect);
        return;
      }
      setError(body?.error ?? "Something went wrong. Reload the page and try again.");
    } catch {
      setError("Network error. Please try again.");
    }
    setBusy(null);
  }

  const hidden: [string, string | null][] = [
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["response_type", params.responseType],
    ["code_challenge", params.codeChallenge],
    ["code_challenge_method", params.codeChallengeMethod],
    ["state", params.state],
    ["scope", params.scope],
    ["resource", params.resource],
    ["csrf", csrf],
  ];

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      {hidden.map(([k, v]) => (v === null ? null : <input key={k} type="hidden" name={k} value={v} />))}
      <div>
        <p className="text-sm font-medium text-slate-800">This app will be able to:</p>
        <ul className="mt-2 space-y-2 text-sm text-slate-700">
          <li className="flex gap-2">
            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-600" />
            <span>
              <span className="font-medium">Read</span> your properties, tenants, rentals, payments, expenses, enquiries, maintenance
              and reports. Tenant ID numbers, documents and photos are never shared.
            </span>
          </li>
        </ul>
      </div>
      {offerWrite && (
        <label className="flex items-start gap-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <input type="checkbox" name="allow_write" value="on" className="mt-0.5 size-4 accent-brand-600" />
          <span className="text-sm">
            <span className="font-medium text-slate-800">Also allow changes (record payments, add enquiries…)</span>
            <span className="mt-0.5 block text-xs text-slate-600">
              Lets the app record rent and deposit payments, create enquiries and notes, and log or update maintenance. It can never
              delete anything.
            </span>
          </span>
        </label>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="submit" name="decision" value="deny" className="btn btn-secondary" disabled={busy !== null}>
          {busy === "deny" ? "Cancelling…" : "Deny"}
        </button>
        <button type="submit" name="decision" value="approve" className="btn btn-primary" disabled={busy !== null}>
          {busy === "approve" ? "Connecting…" : "Allow access"}
        </button>
      </div>
      <p className="text-xs text-slate-500">You can disconnect it any time under Settings → Connected apps.</p>
    </form>
  );
}
