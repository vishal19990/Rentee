"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  BULK_FILTERS,
  BULK_FILTER_LABELS,
  filterBulkItems,
  isSendable,
  progressLabel,
  selectAllState,
  sendQueue,
  toggleSelectAll,
  type BulkFilter,
  type BulkReminderItem,
  type SendOutcome,
} from "@/lib/bulk-reminders";
import { formatDate, relativeTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { NO_PHONE_TOOLTIP } from "@/lib/whatsapp";
import { Badge, Card, EmptyState } from "@/components/ui";
import { IconCheck, IconX } from "@/components/icons";
import { logReminder } from "./actions";

type Queued = BulkReminderItem & { url: string };
type Outcome = { outcome: SendOutcome; error?: string };
type Session = { queue: Queued[]; index: number };

const WA_CLASSES =
  "btn border border-emerald-600/20 bg-emerald-50 text-emerald-800 shadow-xs hover:bg-emerald-100 focus-visible:ring-emerald-500/30";

export function BulkReminders({ items: initialItems, serverNow }: { items: BulkReminderItem[]; serverNow: string }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<BulkFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [session, setSession] = useState<Session | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [, startTransition] = useTransition();
  // Relative times are rendered after mount so server and client output match.
  const [now, setNow] = useState<Date | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!session) setItems(initialItems);
  }, [initialItems, session]);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const filterNow = useMemo(() => now ?? new Date(serverNow), [now, serverNow]);
  const visible = useMemo(() => filterBulkItems(items, filter, filterNow), [items, filter, filterNow]);
  const queue = sendQueue(visible, selected);
  const allState = selectAllState(selected, visible);
  const sendableVisible = visible.filter(isSendable).length;
  const counts = useMemo(
    () => Object.fromEntries(BULK_FILTERS.map((f) => [f, filterBulkItems(items, f, filterNow).length])) as Record<BulkFilter, number>,
    [items, filterNow],
  );

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = allState === "some";
  }, [allState]);

  /** Logs a reminder whose WhatsApp tab the click has just opened. */
  function record(item: Queued) {
    setOutcomes((o) => ({ ...o, [item.rentalId]: { outcome: "sent" } }));
    startTransition(async () => {
      try {
        const res = await logReminder(item.rentalId);
        if (res.ok) {
          setItems((list) => list.map((i) => (i.rentalId === item.rentalId ? { ...i, lastRemindedAt: res.sentAt } : i)));
        } else {
          setOutcomes((o) => ({ ...o, [item.rentalId]: { outcome: "sent", error: res.message } }));
        }
      } catch {
        setOutcomes((o) => ({ ...o, [item.rentalId]: { outcome: "sent", error: "Could not log this reminder." } }));
      }
    });
  }

  // The WhatsApp links are real <a target="_blank"> elements, so the new tab opens straight
  // from the click (never blocked as a popup); the handlers only log and advance.
  function start(q: Queued[]) {
    setOutcomes({});
    record(q[0]);
    setSession({ queue: q, index: 1 });
  }

  function sendCurrent() {
    if (!session) return;
    record(session.queue[session.index]);
    setSession({ ...session, index: session.index + 1 });
  }

  function skipCurrent() {
    if (!session) return;
    const item = session.queue[session.index];
    setOutcomes((o) => ({ ...o, [item.rentalId]: { outcome: "skipped" } }));
    setSession({ ...session, index: session.index + 1 });
  }

  function finish() {
    setSession(null);
    setSelected(new Set());
    router.refresh();
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sending = session !== null;
  const current = session && session.index < session.queue.length ? session.queue[session.index] : null;
  const sentCount = Object.values(outcomes).filter((o) => o.outcome === "sent").length;
  const skippedCount = Object.values(outcomes).filter((o) => o.outcome === "skipped").length;
  const errorCount = Object.values(outcomes).filter((o) => o.error).length;

  return (
    <div className="space-y-4">
      {session && (
        <Card
          title={current ? `Reminder ${progressLabel(session.index, session.queue.length)}` : "All done"}
          description={
            current
              ? "Press send in the WhatsApp tab, then come back here for the next one."
              : `${sentCount} opened in WhatsApp, ${skippedCount} skipped${errorCount ? `, ${errorCount} not logged` : ""}.`
          }
          actions={
            current ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={finish}>
                Stop
              </button>
            ) : undefined
          }
        >
          <div
            className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={session.queue.length}
            aria-valuenow={session.index}
            aria-label="Reminders processed"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${(session.index / session.queue.length) * 100}%` }}
            />
          </div>
          {current ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{current.tenantName}</p>
                  <p className="text-xs text-slate-500">
                    {current.propertyName} · {current.months}
                  </p>
                </div>
                <span
                  className={clsx(
                    "text-sm font-semibold tabular-nums",
                    current.kind === "overdue" ? "text-rose-600" : "text-slate-900",
                  )}
                >
                  {formatMoney(current.amount)}
                </span>
              </div>
              <p className="rounded-xl bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-700 ring-1 ring-slate-200">
                {current.message}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={current.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={WA_CLASSES}
                  onClick={sendCurrent}
                >
                  Send next
                </a>
                <button type="button" className="btn btn-secondary" onClick={skipCurrent}>
                  Skip
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" onClick={finish}>
              Done
            </button>
          )}
        </Card>
      )}

      <nav className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 text-sm" aria-label="Filter">
        {BULK_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            disabled={sending}
            onClick={() => setFilter(f)}
            aria-pressed={f === filter}
            className={clsx(
              "rounded-lg px-3 py-1.5 font-medium transition disabled:cursor-not-allowed",
              f === filter ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {BULK_FILTER_LABELS[f]}
            <span className="ml-1.5 text-xs text-slate-400 tabular-nums">{counts[f]}</span>
          </button>
        ))}
      </nav>

      <Card
        bodyClassName="p-0"
        title={
          <label className="flex items-center gap-3">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allState === "all"}
              disabled={sending || sendableVisible === 0}
              onChange={() => setSelected((s) => toggleSelectAll(s, visible))}
              className="size-4 rounded border-slate-300 accent-brand-600"
              aria-label="Select all"
            />
            <span>Select all</span>
          </label>
        }
        actions={
          !sending &&
          (queue.length > 0 ? (
            <a
              href={queue[0].url}
              target="_blank"
              rel="noopener noreferrer"
              className={clsx(WA_CLASSES, "btn-sm")}
              onClick={() => start(queue)}
            >
              Start sending ({queue.length})
            </a>
          ) : (
            <button type="button" disabled className={clsx(WA_CLASSES, "btn-sm")} title="Select reminders to send">
              Start sending
            </button>
          ))
        }
      >
        {visible.length === 0 ? (
          <EmptyState
            compact
            icon={<IconCheck />}
            title={items.length === 0 ? "Nothing to remind about" : "No reminders match this filter"}
            description={items.length === 0 ? "No rent is overdue or due soon." : undefined}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((item) => {
              const sendable = isSendable(item);
              const result = outcomes[item.rentalId];
              const id = `rem-${item.rentalId}`;
              return (
                <li
                  key={item.rentalId}
                  className={clsx(
                    "flex items-start gap-3 px-5 py-3.5",
                    !sendable && "opacity-60",
                    current?.rentalId === item.rentalId && "bg-emerald-50/60",
                  )}
                  title={sendable ? undefined : NO_PHONE_TOOLTIP}
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={sendable && selected.has(item.rentalId)}
                    disabled={!sendable || sending}
                    onChange={() => toggle(item.rentalId)}
                    title={sendable ? undefined : NO_PHONE_TOOLTIP}
                    className="mt-0.5 size-4 shrink-0 rounded border-slate-300 accent-brand-600"
                  />
                  <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <label htmlFor={id} className={clsx("min-w-0", sendable && !sending && "cursor-pointer")}>
                      <span className="block text-sm font-medium text-slate-900">
                        {item.tenantName}
                        <span className="font-normal text-slate-500"> · {item.propertyName}</span>
                      </span>
                      <span className="block text-xs text-slate-500">
                        {item.months} · due {formatDate(item.dueDate)}
                      </span>
                      <span className="block text-xs text-slate-500" suppressHydrationWarning>
                        {item.lastRemindedAt
                          ? now
                            ? `Last reminded ${relativeTime(item.lastRemindedAt, now)}`
                            : "Reminded before"
                          : "Never reminded"}
                      </span>
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      {result?.error ? (
                        <span className="text-xs font-medium text-rose-600">{result.error}</span>
                      ) : result?.outcome === "sent" ? (
                        <Badge tone="emerald">
                          <IconCheck className="size-3" /> Opened
                        </Badge>
                      ) : result?.outcome === "skipped" ? (
                        <Badge tone="slate">
                          <IconX className="size-3" /> Skipped
                        </Badge>
                      ) : null}
                      {!sendable && (
                        <Link href={`/tenants/${item.tenantId}/edit`} className="text-xs link">
                          {NO_PHONE_TOOLTIP}
                        </Link>
                      )}
                      <Badge tone={item.kind === "overdue" ? "rose" : "sky"} dot>
                        {item.kind === "overdue" ? "Overdue" : "Due soon"}
                      </Badge>
                      <span
                        className={clsx(
                          "text-sm font-semibold tabular-nums",
                          item.kind === "overdue" ? "text-rose-600" : "text-slate-900",
                        )}
                      >
                        {formatMoney(item.amount)}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
