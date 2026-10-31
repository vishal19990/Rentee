"use client";

import { useEffect, useState, useTransition } from "react";
import { relativeTime } from "@/lib/format";
import { NO_PHONE_TOOLTIP } from "@/lib/whatsapp";
import { logDepositReminder } from "@/app/(admin)/rentals/ledger-actions";

const CLASSES =
  "btn btn-sm w-full border border-emerald-600/20 bg-emerald-50 text-emerald-800 shadow-xs hover:bg-emerald-100 focus-visible:ring-emerald-500/30";

/**
 * "Remind on WhatsApp" for a deposit balance: opens the wa.me link (the admin presses send) and
 * logs a `deposit` reminder. Disabled with "Add a phone number" when the tenant has no phone.
 */
export function DepositReminderButton({
  rentalId,
  url,
  lastRemindedAt,
}: {
  rentalId: string;
  url: string | null;
  lastRemindedAt: string | null;
}) {
  const [last, setLast] = useState(lastRemindedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setLast(lastRemindedAt), [lastRemindedAt]);
  useEffect(() => setNow(new Date()), []);

  const lastText = last && now ? `Last reminded ${relativeTime(last, now)}` : last ? "Reminded before" : null;
  return (
    <div className="flex flex-col gap-1">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={CLASSES}
          aria-busy={pending || undefined}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await logDepositReminder(rentalId);
              if (res.ok) setLast(res.sentAt);
              else setError(res.message);
            });
          }}
        >
          Remind on WhatsApp
        </a>
      ) : (
        <span title={NO_PHONE_TOOLTIP} className="inline-flex">
          <button type="button" disabled title={NO_PHONE_TOOLTIP} className={CLASSES}>
            Remind on WhatsApp
          </button>
        </span>
      )}
      {(lastText || error) && (
        <span className={error ? "text-xs font-medium text-rose-600" : "text-xs text-slate-500"} suppressHydrationWarning>
          {error ?? lastText}
        </span>
      )}
    </div>
  );
}
