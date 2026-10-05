"use client";

import clsx from "clsx";
import { createContext, useActionState, useContext, useId, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/validation";
import { IconAlert, IconCheck } from "./icons";

type FormAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const FormCtx = createContext<ActionState>({});

/**
 * Wraps a server action with useActionState and exposes its result to the fields inside,
 * so each field can show its own server-side validation error and keep the typed value.
 */
export function ActionForm({
  action,
  children,
  className,
  showMessage = true,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  showMessage?: boolean;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  return (
    <FormCtx.Provider value={state}>
      <form action={formAction} className={className} noValidate>
        {showMessage && <FormMessage state={state} />}
        {children}
      </form>
    </FormCtx.Provider>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  const ok = state.ok;
  return (
    <div
      role={ok ? "status" : "alert"}
      className={clsx(
        "mb-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset",
        ok ? "bg-emerald-50 text-emerald-800 ring-emerald-600/20" : "bg-rose-50 text-rose-800 ring-rose-600/20",
      )}
    >
      {ok ? <IconCheck className="mt-0.5 size-4 shrink-0" /> : <IconAlert className="mt-0.5 size-4 shrink-0" />}
      <span>{state.message}</span>
    </div>
  );
}

/** The latest server action result of the enclosing ActionForm. */
export function useActionResult(): ActionState {
  return useContext(FormCtx);
}

/** Field id, server error and echoed/default value — for custom fields inside an ActionForm. */
export function useField(name: string, defaultValue?: string | number | null) {
  const state = useContext(FormCtx);
  const id = useId();
  const error = state.fieldErrors?.[name]?.[0];
  const value = state.values?.[name] ?? (defaultValue == null ? "" : String(defaultValue));
  return { id, error, value };
}

export function FieldWrap({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

type BaseProps = {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  hint?: ReactNode;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

export function TextField({
  type = "text",
  prefix,
  inputMode,
  autoComplete,
  min,
  max,
  step,
  ...p
}: BaseProps & {
  type?: "text" | "email" | "password" | "date" | "month" | "number" | "tel";
  prefix?: string;
  inputMode?: "decimal" | "numeric" | "tel" | "email" | "text";
  autoComplete?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
}) {
  const { id, error, value } = useField(p.name, p.defaultValue);
  // Never echo passwords back into the form.
  const dv = type === "password" ? undefined : value;
  const input = (
    <input
      id={id}
      name={p.name}
      type={type}
      defaultValue={dv}
      required={p.required}
      disabled={p.disabled}
      placeholder={p.placeholder}
      inputMode={inputMode}
      autoComplete={autoComplete}
      min={min}
      max={max}
      step={step}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-err` : undefined}
      className={clsx("input", prefix && "pl-12")}
    />
  );
  return (
    <FieldWrap id={id} label={p.label} error={error} hint={p.hint} className={p.className}>
      {prefix ? (
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-0 grid w-10 place-items-center border-r border-slate-200 text-xs font-medium text-slate-500">
            {prefix}
          </span>
          {input}
        </div>
      ) : (
        input
      )}
    </FieldWrap>
  );
}

export function MoneyField(p: BaseProps & { currency: string }) {
  return <TextField {...p} inputMode="decimal" prefix={p.currency} placeholder={p.placeholder ?? "0.00"} />;
}

export function SelectField({
  options,
  placeholder,
  ...p
}: BaseProps & { options: { value: string; label: string }[] }) {
  const { id, error, value } = useField(p.name, p.defaultValue);
  return (
    <FieldWrap id={id} label={p.label} error={error} hint={p.hint} className={p.className}>
      <select
        id={id}
        name={p.name}
        defaultValue={value}
        key={value /* re-apply the echoed value after a failed submit */}
        required={p.required}
        disabled={p.disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className="input pr-8"
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

export function TextAreaField({ rows = 3, ...p }: BaseProps & { rows?: number }) {
  const { id, error, value } = useField(p.name, p.defaultValue);
  return (
    <FieldWrap id={id} label={p.label} error={error} hint={p.hint} className={p.className}>
      <textarea
        id={id}
        name={p.name}
        rows={rows}
        defaultValue={value}
        placeholder={p.placeholder}
        disabled={p.disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className="input"
      />
    </FieldWrap>
  );
}

export function FileField({ accept, ...p }: BaseProps & { accept?: string }) {
  const { id, error } = useField(p.name);
  return (
    <FieldWrap id={id} label={p.label} error={error} hint={p.hint} className={p.className}>
      <input
        id={id}
        name={p.name}
        type="file"
        accept={accept}
        aria-invalid={error ? true : undefined}
        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
      />
    </FieldWrap>
  );
}

export function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  variant = "primary",
  size,
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={clsx("btn", `btn-${variant}`, size === "sm" && "btn-sm", className)}
    >
      {pending && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
      )}
      {pending ? pendingLabel : children}
    </button>
  );
}

/**
 * A single-button form for destructive / state-changing actions (delete, archive, remove photo),
 * with an inline two-step confirmation and error display.
 */
export function ConfirmAction({
  action,
  label,
  confirmLabel = "Confirm",
  prompt = "Are you sure?",
  variant = "secondary",
  icon,
  hidden,
}: {
  action: FormAction;
  label: string;
  confirmLabel?: string;
  prompt?: string;
  variant?: "secondary" | "danger" | "primary" | "ghost";
  icon?: ReactNode;
  hidden?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="inline-flex flex-col items-end gap-1">
      {confirming ? (
        <form
          action={(fd) => {
            setConfirming(false);
            return formAction(fd);
          }}
          className="flex flex-wrap items-center justify-end gap-2"
        >
          {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <span className="text-xs font-medium text-slate-600">{prompt}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <SubmitButton size="sm" variant={variant === "danger" ? "danger" : "primary"} pendingLabel="Working…">
            {confirmLabel}
          </SubmitButton>
        </form>
      ) : (
        <button type="button" className={clsx("btn btn-sm", `btn-${variant}`)} onClick={() => setConfirming(true)}>
          {icon}
          {label}
        </button>
      )}
      {state.message && (
        <p role={state.ok ? "status" : "alert"} className={clsx("max-w-xs text-right text-xs font-medium", state.ok ? "text-emerald-700" : "text-rose-600")}>
          {state.message}
        </p>
      )}
    </div>
  );
}

/** Checkbox that posts "on" when checked; keeps the submitted state after a failed submit. */
export function CheckboxField({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description?: ReactNode;
  defaultChecked?: boolean;
}) {
  const state = useContext(FormCtx);
  const id = useId();
  const checked = state.values ? state.values[name] === "on" : !!defaultChecked;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        name={name}
        type="checkbox"
        defaultChecked={checked}
        key={String(checked)}
        className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 accent-brand-600 focus:ring-brand-500"
      />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </label>
    </div>
  );
}
