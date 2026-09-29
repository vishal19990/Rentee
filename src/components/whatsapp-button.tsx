"use client";

import clsx from "clsx";
import { useEffect, useState, useTransition } from "react";
import { relativeTime } from "@/lib/format";
import { NO_PHONE_TOOLTIP } from "@/lib/whatsapp";
import { logReminder } from "@/app/(admin)/reminders/actions";
import type { ReminderButtonProps } from "@/lib/reminders";

function WhatsAppIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2c.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3Z" />
    </svg>
  );
}

/**
 * "Remind on WhatsApp": opens a wa.me click-to-chat link in a new tab (the admin presses send
 * in WhatsApp), records a reminder log via a server action, and shows "Last reminded …".
 * Disabled with the tooltip "Add a phone number" when the tenant has no valid phone.
 */
export function WhatsAppReminderButton({
  rentalId,
  kind,
  url,
  lastRemindedAt,
  size = "sm",
  stacked,
}: ReminderButtonProps & { size?: "sm" | "md"; stacked?: boolean }) {
  const [last, setLast] = useState(lastRemindedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Relative time is rendered after mount so server and client output always match.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => setLast(lastRemindedAt), [lastRemindedAt]);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const label = kind === "due_soon" ? "Remind: due soon" : "Remind on WhatsApp";
  const classes = clsx(
    "btn",
    size === "sm" && "btn-sm",
    "border border-emerald-600/20 bg-emerald-50 text-emerald-800 shadow-xs hover:bg-emerald-100 focus-visible:ring-emerald-500/30",
  );

  const lastText = last && now ? `Last reminded ${relativeTime(last, now)}` : last ? "Reminded before" : null;

  return (
    <div className={clsx("flex gap-x-2 gap-y-1", stacked ? "flex-col items-stretch" : "flex-wrap items-center justify-end")}>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={classes}
          aria-busy={pending || undefined}
          onClick={() => {
            // Let the link open normally (no popup blocker issues), then record the reminder.
            setError(null);
            startTransition(async () => {
              const res = await logReminder(rentalId);
              if (res.ok) setLast(res.sentAt);
              else setError(res.message);
            });
          }}
        >
          <WhatsAppIcon />
          {label}
        </a>
      ) : (
        // A disabled button can't show a native tooltip, so the wrapper carries it too.
        <span title={NO_PHONE_TOOLTIP} className="inline-flex">
          <button type="button" disabled title={NO_PHONE_TOOLTIP} aria-label={`${label} (${NO_PHONE_TOOLTIP})`} className={classes}>
            <WhatsAppIcon />
            {label}
          </button>
        </span>
      )}
      {(lastText || error) && (
        <span className={clsx("text-xs", error ? "font-medium text-rose-600" : "text-slate-500")} suppressHydrationWarning>
          {error ?? lastText}
        </span>
      )}
    </div>
  );
}
