import "server-only";
import { agreementNotificationSpecs } from "./agreement-data";
import { connectDB } from "./db";
import { loadRentals, toId } from "./data";
import {
  DEFAULT_THRESHOLDS,
  SYNC_INTERVAL_MS,
  desiredNotifications,
  planSync,
  type MaintenanceInput,
  type NotificationSpec,
  type NotificationThresholds,
} from "./notifications";
import { reminderButtons, type ReminderButtonProps } from "./reminders";
import { localToday } from "./rent";
import { APP_SETTINGS_KEY, AppSettings } from "@/models/AppSettings";
import { Maintenance } from "@/models/Maintenance";
import { Notification } from "@/models/Notification";
import { Property } from "@/models/Property";

export type NotificationSettings = NotificationThresholds & { desktopNotifications: boolean };

export async function getNotificationSettings(): Promise<NotificationSettings> {
  await connectDB();
  const doc = await AppSettings.findOne({ key: APP_SETTINGS_KEY })
    .select("dueSoonDays moveOutDays maintenanceDays desktopNotifications")
    .lean();
  return {
    dueSoonDays: doc?.dueSoonDays ?? DEFAULT_THRESHOLDS.dueSoonDays,
    moveOutDays: doc?.moveOutDays ?? DEFAULT_THRESHOLDS.moveOutDays,
    maintenanceDays: doc?.maintenanceDays ?? DEFAULT_THRESHOLDS.maintenanceDays,
    desktopNotifications: doc?.desktopNotifications ?? true,
  };
}

/** Claims the sync slot atomically: true at most once per SYNC_INTERVAL_MS across all requests. */
async function claimSyncSlot(now: Date): Promise<boolean> {
  try {
    await AppSettings.updateOne({ key: APP_SETTINGS_KEY }, { $setOnInsert: { key: APP_SETTINGS_KEY } }, { upsert: true });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err; // concurrent upsert: doc exists now
  }
  const claimed = await AppSettings.findOneAndUpdate(
    {
      key: APP_SETTINGS_KEY,
      $or: [{ notificationsSyncedAt: null }, { notificationsSyncedAt: { $lte: new Date(now.getTime() - SYNC_INTERVAL_MS) } }],
    },
    { $set: { notificationsSyncedAt: now } },
  ).lean();
  return claimed !== null;
}

function toDoc(spec: NotificationSpec, now: Date) {
  return {
    key: spec.key,
    type: spec.type,
    category: spec.category,
    title: spec.title,
    body: spec.body,
    link: spec.link,
    rental: spec.rentalId ?? null,
    property: spec.propertyId ?? null,
    tenant: spec.tenantId ?? null,
    maintenance: spec.maintenanceId ?? null,
    period: spec.period ?? null,
    activeSince: now,
  };
}

async function loadMaintenance(filter: Record<string, unknown>): Promise<MaintenanceInput[]> {
  const rows = await Maintenance.find(filter).lean();
  const props = await Property.find({ _id: { $in: rows.map((m) => m.property) } }).select("name").lean();
  const propName = new Map(props.map((p) => [toId(p._id), p.name]));
  return rows.map((m) => ({
    id: toId(m._id),
    title: m.title,
    propertyId: toId(m.property),
    propertyName: propName.get(toId(m.property)) ?? "(deleted property)",
    status: m.status as MaintenanceInput["status"],
    priority: m.priority as MaintenanceInput["priority"],
    createdAt: m.createdAt,
  }));
}

/**
 * Reconciles stored notifications with current data.
 * - Default: full sync, throttled to once per 5 minutes (called on admin page loads and polls).
 * - `force`: full sync now (after threshold changes).
 * - `scope`: re-evaluate only the given rentals / maintenance requests, immediately and without
 *   touching the throttle — used right after a mutation so e.g. a payment resolves its
 *   overdue alert at once.
 * Returns whether a sync ran.
 */
export async function syncNotifications(
  opts: { force?: boolean; scope?: { rentalIds?: string[]; maintenanceIds?: string[] } } = {},
): Promise<boolean> {
  await connectDB();
  const now = new Date();
  const today = localToday(now);
  const scope = opts.scope;

  if (!scope) {
    if (opts.force) await AppSettings.updateOne({ key: APP_SETTINGS_KEY }, { $set: { notificationsSyncedAt: now } }, { upsert: true });
    else if (!(await claimSyncSlot(now))) return false;
  }

  const thresholds = await getNotificationSettings();
  const rentalIds = scope?.rentalIds ?? [];
  const maintenanceIds = scope?.maintenanceIds ?? [];
  const [rentals, maintenance] = await Promise.all([
    scope ? (rentalIds.length ? loadRentals({ _id: { $in: rentalIds } }, today) : Promise.resolve([])) : loadRentals({}, today),
    scope
      ? maintenanceIds.length
        ? loadMaintenance({ _id: { $in: maintenanceIds } })
        : Promise.resolve([])
      : loadMaintenance({ status: { $ne: "done" } }),
  ]);

  const desired = desiredNotifications({ rentals, maintenance, thresholds, today, now });
  desired.push(...(await agreementNotificationSpecs(rentals, today))); // F8: agreement_expiring / agreement_expired
  const desiredKeys = desired.map((d) => d.key);
  const subjectFilter = scope
    ? { $or: [{ rental: { $in: rentalIds } }, { maintenance: { $in: maintenanceIds } }] }
    : { resolvedAt: null };
  const existing = await Notification.find({ $or: [subjectFilter, { key: { $in: desiredKeys } }] })
    .select("key title body resolvedAt")
    .lean();

  const plan = planSync(
    existing.map((e) => ({ key: e.key, title: e.title, body: e.body, resolvedAt: e.resolvedAt ?? null })),
    desired,
  );

  if (plan.create.length) {
    try {
      await Notification.insertMany(
        plan.create.map((c) => toDoc(c, now)),
        { ordered: false },
      );
    } catch (err) {
      // A concurrent sync may have inserted the same keys: the unique index keeps one; ignore duplicates.
      const e = err as { code?: number; writeErrors?: { code?: number; err?: { code?: number } }[] };
      const onlyDupes =
        e.code === 11000 || (Array.isArray(e.writeErrors) && e.writeErrors.every((w) => (w.code ?? w.err?.code) === 11000));
      if (!onlyDupes) throw err;
    }
  }
  if (plan.resolveKeys.length) {
    await Notification.updateMany({ key: { $in: plan.resolveKeys }, resolvedAt: null }, { $set: { resolvedAt: now } });
  }
  const writes = [
    ...plan.reopen.map((r) => ({
      updateOne: { filter: { key: r.key }, update: { $set: { ...toDoc(r, now), resolvedAt: null, readAt: null } } },
    })),
    ...plan.update.map((u) => ({ updateOne: { filter: { key: u.key }, update: { $set: { title: u.title, body: u.body } } } })),
  ];
  if (writes.length) await Notification.bulkWrite(writes, { ordered: false });
  return true;
}

/** Never lets a notification problem break a page load or a mutation. */
export async function syncNotificationsSafe(opts?: Parameters<typeof syncNotifications>[0]): Promise<void> {
  try {
    await syncNotifications(opts);
  } catch (err) {
    console.error("[notifications] sync failed:", err);
  }
}

/* ---------- reading ---------- */

export type NotificationItem = {
  id: string;
  key: string;
  type: string;
  category: "alert" | "reminder";
  title: string;
  body: string;
  link: string;
  activeSince: string;
  read: boolean;
  resolved: boolean;
  /** WhatsApp remind button props for unresolved rent items with something to remind about. */
  reminder: ReminderButtonProps | null;
};

type Filter = "all" | "unread" | "alerts" | "reminders";

export function notificationQuery(filter: Filter): Record<string, unknown> {
  switch (filter) {
    case "unread":
      return { readAt: null, resolvedAt: null };
    case "alerts":
      return { category: "alert" };
    case "reminders":
      return { category: "reminder" };
    default:
      return {};
  }
}

export async function unreadNotificationCount(): Promise<number> {
  await connectDB();
  return Notification.countDocuments({ readAt: null, resolvedAt: null });
}

/** Lists notifications (newest first) with WhatsApp reminder props on rent items. */
export async function listNotifications(opts: {
  filter?: Filter;
  unresolvedOnly?: boolean;
  limit?: number;
}): Promise<NotificationItem[]> {
  await connectDB();
  const query: Record<string, unknown> = { ...notificationQuery(opts.filter ?? "all") };
  if (opts.unresolvedOnly) query.resolvedAt = null;
  const rows = await Notification.find(query)
    .sort({ resolvedAt: 1, activeSince: -1 })
    .limit(opts.limit ?? 100)
    .lean();

  const rentIds = [
    ...new Set(
      rows
        .filter((n) => !n.resolvedAt && n.rental && (n.type === "rent_overdue" || n.type === "rent_due_soon"))
        .map((n) => toId(n.rental)),
    ),
  ];
  const reminders = rentIds.length ? await reminderButtons(await loadRentals({ _id: { $in: rentIds } })) : new Map();

  return rows.map((n) => ({
    id: toId(n._id),
    key: n.key,
    type: n.type,
    category: n.category as "alert" | "reminder",
    title: n.title,
    body: n.body,
    link: n.link,
    activeSince: n.activeSince.toISOString(),
    read: !!n.readAt,
    resolved: !!n.resolvedAt,
    reminder:
      !n.resolvedAt && n.rental && (n.type === "rent_overdue" || n.type === "rent_due_soon")
        ? (reminders.get(toId(n.rental)) ?? null)
        : null,
  }));
}

export type NotificationFeed = {
  unread: number;
  items: NotificationItem[];
  desktopEnabled: boolean;
  serverTime: string;
};

/** Data for the bell dropdown and the poll endpoint: unread count + latest 10 open items. */
export async function notificationFeed(): Promise<NotificationFeed> {
  const [unread, items, settings] = await Promise.all([
    unreadNotificationCount(),
    listNotifications({ unresolvedOnly: true, limit: 10 }),
    getNotificationSettings(),
  ]);
  return { unread, items, desktopEnabled: settings.desktopNotifications, serverTime: new Date().toISOString() };
}
