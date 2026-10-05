"use client";

import clsx from "clsx";
import { useActionState, useState, useTransition, type ReactNode } from "react";
import {
  ActionForm,
  FieldWrap,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  useField,
} from "@/components/form";
import {
  CLOSED_STATUSES,
  DECLINE_REASONS,
  OPEN_STATUSES,
  REASON_LABEL,
  REJECT_REASONS,
  STATUS_LABEL,
  type EnquiryStatus,
} from "@/lib/enquiries";
import { NO_PHONE_TOOLTIP, whatsappUrl } from "@/lib/whatsapp";
import type { ActionState } from "@/lib/validation";
import {
  addEnquiryActivity,
  closeEnquiry,
  convertEnquiry,
  logEnquiryWhatsApp,
  reopenEnquiry,
  setEnquiryFollowUp,
  setEnquiryStatus,
  setEnquiryVisit,
} from "../actions";

type FormAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** One-button form with its own result message. */
function ActionButton({
  action,
  children,
  variant = "secondary",
  hidden,
}: {
  action: FormAction;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  hidden?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton size="sm" variant={variant} pendingLabel="Working…">
        {children}
      </SubmitButton>
      {state.message && !state.ok && <span className="text-xs font-medium text-rose-600">{state.message}</span>}
    </form>
  );
}

/* ---------- status ---------- */

export function OpenStatusButtons({ id, status }: { id: string; status: EnquiryStatus }) {
  return (
    <div className="flex flex-wrap gap-2">
      {OPEN_STATUSES.filter((s) => s !== status).map((s) => (
        <ActionButton key={s} action={setEnquiryStatus.bind(null, id, s)}>
          Mark {STATUS_LABEL[s].toLowerCase()}
        </ActionButton>
      ))}
    </div>
  );
}

function OutcomeFields() {
  const outcome = useField("outcome", "");
  const [value, setValue] = useState(outcome.value);
  const reasons = value === "rejected" ? REJECT_REASONS : value === "declined" ? DECLINE_REASONS : null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FieldWrap id={outcome.id} label="Outcome" error={outcome.error}>
        <select
          id={outcome.id}
          name="outcome"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          aria-invalid={outcome.error ? true : undefined}
          className="input pr-8"
        >
          <option value="">Select…</option>
          {CLOSED_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "rejected"
                ? "Rejected (by me)"
                : s === "declined"
                  ? "Declined (by them)"
                  : s === "accepted"
                    ? "Accepted (will rent)"
                    : STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </FieldWrap>
      {reasons && (
        <SelectField
          key={value}
          name="reason"
          label="Reason"
          placeholder="Select a reason…"
          options={reasons.map((r) => ({ value: r, label: REASON_LABEL[r] }))}
        />
      )}
      <TextAreaField
        name="reasonText"
        label={reasons ? "Details (required for “Other”)" : "Note (optional)"}
        rows={2}
        className="sm:col-span-2"
      />
    </div>
  );
}

export function OutcomeForm({ id }: { id: string }) {
  return (
    <ActionForm action={closeEnquiry.bind(null, id)} className="space-y-4">
      <OutcomeFields />
      <div className="flex justify-end">
        <SubmitButton size="sm">Close enquiry</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ReopenButton({ id }: { id: string }) {
  return <ActionButton action={reopenEnquiry.bind(null, id)}>Reopen</ActionButton>;
}

/* ---------- conversion ---------- */

export function ConvertPanel({
  id,
  matches,
}: {
  id: string;
  matches: { id: string; name: string; phone: string; archived: boolean }[];
}) {
  const action = convertEnquiry.bind(null, id);
  if (matches.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">Creates a tenant with this name, phone and email, then opens a new rental.</p>
        <ActionButton action={action} variant="primary" hidden={{ tenant: "new" }}>
          Convert to tenant
        </ActionButton>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">
        {matches.length === 1 ? "A tenant already has" : "Tenants already have"} this phone number. Link instead of creating a duplicate:
      </p>
      <div className="flex flex-wrap gap-2">
        {matches.map((t) => (
          <ActionButton key={t.id} action={action} variant="primary" hidden={{ tenant: t.id }}>
            Link {t.name}
            {t.archived ? " (archived, will be restored)" : ""}
          </ActionButton>
        ))}
      </div>
    </div>
  );
}

/* ---------- follow-up & visit ---------- */

function DateTimeField({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string }) {
  const { id, error, value } = useField(name, defaultValue);
  return (
    <FieldWrap id={id} label={label} error={error} className="flex-1">
      <input id={id} name={name} type="datetime-local" defaultValue={value} key={value} className="input" />
    </FieldWrap>
  );
}

export function FollowUpForm({ id, current }: { id: string; current: string | null }) {
  const action = setEnquiryFollowUp.bind(null, id);
  return (
    <div className="space-y-2">
      <ActionForm action={action}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextField name="followUpDate" label="Follow up on" type="date" defaultValue={current ?? ""} className="flex-1" />
          <SubmitButton size="sm" variant="secondary">
            Set
          </SubmitButton>
        </div>
      </ActionForm>
      {current && (
        <ActionButton action={action} variant="ghost" hidden={{ followUpDate: "" }}>
          Clear follow-up
        </ActionButton>
      )}
    </div>
  );
}

export function VisitForm({ id, current }: { id: string; current: string | null }) {
  const action = setEnquiryVisit.bind(null, id);
  return (
    <div className="space-y-2">
      <ActionForm action={action}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <DateTimeField name="visitAt" label="Visit on" defaultValue={current ?? ""} />
          <SubmitButton size="sm" variant="secondary">
            {current ? "Reschedule" : "Schedule"}
          </SubmitButton>
        </div>
      </ActionForm>
      {current && (
        <ActionButton action={action} variant="ghost" hidden={{ visitAt: "" }}>
          Cancel visit
        </ActionButton>
      )}
    </div>
  );
}

/* ---------- timeline ---------- */

export function ActivityForm({ id }: { id: string }) {
  return (
    <ActionForm action={addEnquiryActivity.bind(null, id)} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
        <SelectField
          name="kind"
          label="Type"
          defaultValue="note"
          options={[
            { value: "note", label: "Note" },
            { value: "call", label: "Call" },
          ]}
        />
        <TextAreaField name="text" label="What happened" rows={2} placeholder="e.g. Called, will confirm after the weekend" />
      </div>
      <div className="flex justify-end">
        <SubmitButton size="sm" variant="secondary">
          Add to timeline
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/* ---------- WhatsApp ---------- */

function WhatsAppIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2c.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3Z" />
    </svg>
  );
}

/**
 * "Message on WhatsApp": editable prefilled text, opens a wa.me link in a new tab and logs a
 * `whatsapp` activity. Nothing is sent automatically.
 */
export function WhatsAppPanel({ id, phoneDigits, defaultMessage }: { id: string; phoneDigits: string | null; defaultMessage: string }) {
  const [message, setMessage] = useState(defaultMessage);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const classes = clsx(
    "btn btn-sm",
    "border border-emerald-600/20 bg-emerald-50 text-emerald-800 shadow-xs hover:bg-emerald-100 focus-visible:ring-emerald-500/30",
  );
  return (
    <div className="space-y-3">
      <label htmlFor={`wa-${id}`} className="label">
        Message
      </label>
      <textarea id={`wa-${id}`} rows={3} value={message} onChange={(e) => setMessage(e.currentTarget.value)} className="input" />
      <div className="flex flex-wrap items-center gap-2">
        {phoneDigits ? (
          <a
            href={whatsappUrl(phoneDigits, message)}
            target="_blank"
            rel="noopener noreferrer"
            className={classes}
            aria-busy={pending || undefined}
            onClick={() => {
              setStatus(null);
              startTransition(async () => {
                try {
                  const res = await logEnquiryWhatsApp(id, message);
                  setError(!res.ok);
                  setStatus(res.ok ? "Logged in the timeline." : (res.message ?? "Could not log."));
                } catch {
                  setError(true);
                  setStatus("Could not log.");
                }
              });
            }}
          >
            <WhatsAppIcon /> Message on WhatsApp
          </a>
        ) : (
          <span title={NO_PHONE_TOOLTIP} className="inline-flex">
            <button type="button" disabled className={classes}>
              <WhatsAppIcon /> Message on WhatsApp
            </button>
          </span>
        )}
        {status && <span className={clsx("text-xs", error ? "font-medium text-rose-600" : "text-slate-500")}>{status}</span>}
      </div>
    </div>
  );
}
