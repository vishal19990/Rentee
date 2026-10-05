/**
 * Bulk WhatsApp reminders (/reminders): pure selection, ordering and filter logic.
 * The page builds one item per rental with something to remind about, using the same
 * reminder rules as the single "Remind on WhatsApp" button (src/lib/whatsapp.ts).
 */
import { formatMonth } from "./rent";
import { reminderDue, type ReminderKind, type ReminderRental } from "./whatsapp";

/** "Due soon" items are listed only when their due date is at most this many days away. */
export const DUE_SOON_WINDOW_DAYS = 7;
/** The "Not reminded in 7 days" filter. */
export const NOT_REMINDED_DAYS = 7;

export const BULK_FILTERS = ["all", "overdue", "due_soon", "not_reminded"] as const;
export type BulkFilter = (typeof BULK_FILTERS)[number];

export const BULK_FILTER_LABELS: Record<BulkFilter, string> = {
  all: "All",
  overdue: "Overdue only",
  due_soon: "Due soon",
  not_reminded: `Not reminded in ${NOT_REMINDED_DAYS} days`,
};

export type BulkReminderItem = {
  rentalId: string;
  tenantId: string;
  tenantName: string;
  propertyName: string;
  kind: ReminderKind;
  /** Outstanding amount the reminder covers (minor units). */
  amount: number;
  /** Months covered, formatted (e.g. "Aug 2026, Sept 2026"). */
  months: string;
  /** Earliest unpaid due date (YYYY-MM-DD). */
  dueDate: string;
  /** wa.me link; null when the tenant has no valid phone (row disabled). */
  url: string | null;
  message: string;
  lastRemindedAt: string | null;
};

/** What the page knows about each rental: its schedule plus the built reminder button props. */
export type BulkSource = {
  rental: ReminderRental & { id: string; tenantId: string; tenantName: string; propertyName: string };
  button: { url: string | null; message: string; lastRemindedAt: string | null } | undefined;
};

function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000);
}

/**
 * One item per rental with a due: every overdue rental, plus "due soon" rentals whose next
 * due date is within `dueSoonDays`. Ordered overdue first (oldest due date, then largest
 * amount), then due soon (nearest due date); ties by tenant name.
 */
export function buildBulkItems(
  sources: BulkSource[],
  today: string,
  dueSoonDays: number = DUE_SOON_WINDOW_DAYS,
): BulkReminderItem[] {
  const items: BulkReminderItem[] = [];
  for (const { rental, button } of sources) {
    if (!button) continue;
    const due = reminderDue(rental, today);
    if (!due || due.amount <= 0) continue;
    if (due.kind === "due_soon" && daysBetween(today, due.dueDate) > dueSoonDays) continue;
    items.push({
      rentalId: rental.id,
      tenantId: rental.tenantId,
      tenantName: rental.tenantName,
      propertyName: rental.propertyName,
      kind: due.kind,
      amount: due.amount,
      months: due.months.map((m) => formatMonth(m.month)).join(", "),
      dueDate: due.dueDate,
      url: button.url,
      message: button.message,
      lastRemindedAt: button.lastRemindedAt,
    });
  }
  return sortBulkItems(items);
}

export function sortBulkItems(items: BulkReminderItem[]): BulkReminderItem[] {
  const rank = (k: ReminderKind) => (k === "overdue" ? 0 : 1);
  return [...items].sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) ||
      a.dueDate.localeCompare(b.dueDate) ||
      b.amount - a.amount ||
      a.tenantName.localeCompare(b.tenantName),
  );
}

/** True when the rental has never been reminded, or not within the last `days` days. */
export function notRemindedSince(lastRemindedAt: string | null, now: Date, days: number = NOT_REMINDED_DAYS): boolean {
  if (!lastRemindedAt) return true;
  const t = Date.parse(lastRemindedAt);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t >= days * 86_400_000;
}

export function filterBulkItems(items: BulkReminderItem[], filter: BulkFilter, now: Date): BulkReminderItem[] {
  switch (filter) {
    case "overdue":
      return items.filter((i) => i.kind === "overdue");
    case "due_soon":
      return items.filter((i) => i.kind === "due_soon");
    case "not_reminded":
      return items.filter((i) => notRemindedSince(i.lastRemindedAt, now));
    default:
      return items;
  }
}

/** Items that can be sent (tenant has a valid phone). */
export function isSendable(item: BulkReminderItem): item is BulkReminderItem & { url: string } {
  return !!item.url;
}

/**
 * Select-all toggle over the visible items: when every sendable visible item is already
 * selected, they are all removed; otherwise they are all added. Hidden selections are kept.
 */
export function toggleSelectAll(selected: ReadonlySet<string>, visible: BulkReminderItem[]): Set<string> {
  const ids = visible.filter(isSendable).map((i) => i.rentalId);
  const next = new Set(selected);
  const allOn = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) {
    if (allOn) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** Selection state of the select-all checkbox for the visible items. */
export function selectAllState(selected: ReadonlySet<string>, visible: BulkReminderItem[]): "all" | "some" | "none" {
  const ids = visible.filter(isSendable).map((i) => i.rentalId);
  const n = ids.filter((id) => selected.has(id)).length;
  if (n === 0) return "none";
  return n === ids.length ? "all" : "some";
}

/** The send queue: selected, sendable, visible items, in display order. */
export function sendQueue(visible: BulkReminderItem[], selected: ReadonlySet<string>): (BulkReminderItem & { url: string })[] {
  return visible.filter(isSendable).filter((i) => selected.has(i.rentalId));
}

export type SendOutcome = "sent" | "skipped";

/** Progress label, e.g. "3 of 8" (1-based position of the item being shown). */
export function progressLabel(position: number, total: number): string {
  return `${Math.min(position + 1, total)} of ${total}`;
}
