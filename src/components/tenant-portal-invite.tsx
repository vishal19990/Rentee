"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { InviteState } from "@/app/(admin)/tenants/portal-actions";
import { FormMessage } from "./form";
import { CopyLinkButton } from "./copy-link-button";

type InviteAction = (prev: InviteState, fd: FormData) => Promise<InviteState>;

function InviteButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
      {pending ? "Creating link…" : label}
    </button>
  );
}

/** "Invite" / "Send new invite" with the one-time link, a WhatsApp button and Copy link. */
export function TenantPortalInvite({ action, label }: { action: InviteAction; label: string }) {
  const [state, formAction] = useActionState(action, {} as InviteState);
  return (
    <div className="space-y-3">
      <form action={formAction}>
        <InviteButton label={label} />
      </form>
      {state.message && !state.link && <FormMessage state={state} />}
      {state.link && (
        <div className="space-y-2 rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-600/20" data-invite-link={state.link}>
          <p className="text-xs font-medium text-emerald-800">{state.message}</p>
          <p className="text-xs break-all text-slate-700 select-all">{state.link}</p>
          <div className="flex flex-wrap gap-2">
            {state.whatsapp && (
              <a href={state.whatsapp} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
                Send on WhatsApp
              </a>
            )}
            <CopyLinkButton url={state.link} />
          </div>
        </div>
      )}
    </div>
  );
}
