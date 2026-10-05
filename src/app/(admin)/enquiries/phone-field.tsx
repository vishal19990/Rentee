"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FieldWrap, useField } from "@/components/form";
import { IconAlert } from "@/components/icons";
import type { PhoneMatches } from "@/lib/enquiry-data";
import { STATUS_LABEL, type EnquiryStatus } from "@/lib/enquiries";
import { checkEnquiryPhone } from "./actions";

/**
 * Phone input that, on blur, looks up other enquiries and tenants with the same normalized
 * number and shows a non-blocking warning with links to them.
 */
export function EnquiryPhoneField({
  defaultValue,
  excludeId,
  className,
}: {
  defaultValue?: string;
  excludeId?: string;
  className?: string;
}) {
  const { id, error, value } = useField("phone", defaultValue);
  const [matches, setMatches] = useState<PhoneMatches | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function check(phone: string) {
    const p = phone.trim();
    if (p === checked) return;
    setChecked(p);
    if (p.replace(/\D/g, "").length < 6) {
      setMatches(null);
      return;
    }
    startTransition(async () => {
      try {
        setMatches(await checkEnquiryPhone(p, excludeId));
      } catch {
        setMatches(null);
      }
    });
  }

  const any = matches && (matches.enquiries.length > 0 || matches.tenants.length > 0);

  return (
    <FieldWrap id={id} label="Phone" error={error} className={className}>
      <input
        id={id}
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        defaultValue={value}
        placeholder="e.g. 98765 43210"
        onBlur={(e) => check(e.currentTarget.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className="input"
      />
      {any && (
        <div role="status" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          <p className="flex items-center gap-1.5 font-medium">
            <IconAlert className="size-3.5 shrink-0" /> This number is already known. You can still save.
          </p>
          <ul className="mt-1 space-y-0.5">
            {matches!.tenants.map((t) => (
              <li key={t.id}>
                Tenant:{" "}
                <Link href={`/tenants/${t.id}`} target="_blank" className="font-medium underline">
                  {t.name}
                </Link>
                {t.archived && " (archived)"}
              </li>
            ))}
            {matches!.enquiries.map((e) => (
              <li key={e.id}>
                Enquiry:{" "}
                <Link href={`/enquiries/${e.id}`} target="_blank" className="font-medium underline">
                  {e.name}
                </Link>{" "}
                · {e.propertyName ?? "any property"} · {STATUS_LABEL[e.status as EnquiryStatus] ?? e.status}
              </li>
            ))}
          </ul>
        </div>
      )}
    </FieldWrap>
  );
}
