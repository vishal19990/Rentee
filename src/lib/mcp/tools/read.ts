import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { agreementsNeedingAttention, loadAgreements } from "../../agreement-data";
import { asObjectId, loadRentals, toId, type RentalRow } from "../../data";
import { connectDB } from "../../db";
import { loadDeposit } from "../../deposit-store";
import { OPEN_STATUSES, STATUS_GROUPS, STATUS_LABEL, phoneKey, statusesInGroup, type EnquiryStatus } from "../../enquiries";
import { propertyNames } from "../../enquiry-data";
import { expenseCategoryLabel } from "../../expenses";
import { dateFromISO } from "../../format";
import { fyOf, fyRange, isFy } from "../../fy";
import { listNotifications } from "../../notification-sync";
import { addDays, addMonths, localToday, monthOf, toISODate } from "../../rent";
import { loadFySummary } from "../../reports-data";
import { reminderDue } from "../../whatsapp";
import { DUE_SOON_WINDOW_DAYS } from "../../bulk-reminders";
import { Enquiry } from "@/models/Enquiry";
import { EnquiryActivity } from "@/models/EnquiryActivity";
import { Expense } from "@/models/Expense";
import { Maintenance } from "@/models/Maintenance";
import { Payment } from "@/models/Payment";
import { Property } from "@/models/Property";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";
import { fail, money, ok, type McpContext } from "../util";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const id = (label: string) => z.string().regex(/^[a-f\d]{24}$/i, `${label} must be a 24-character id`).describe(`${label} id (24 hex characters)`);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Compact rental summary used by list tools. Never includes tenant ID numbers, documents or photos. */
export function rentalSummary(r: RentalRow) {
  return {
    id: r.id,
    property: { id: r.propertyId, name: r.propertyName },
    tenant: { id: r.tenantId, name: r.tenantName },
    status: r.status,
    movingOut: r.movingOut,
    moveInDate: r.moveInDate,
    moveOutDate: r.moveOutDate,
    currentRent: money(r.currentRent),
    dueDay: r.dueDay,
    depositQuoted: money(r.deposit),
    depositBalanceDue: money(r.depositBalance),
    totalDue: money(r.summary.totalDue),
    totalPaid: money(r.summary.totalPaid),
    balance: money(r.summary.balance),
    overdue: money(r.summary.overdueAmount),
    overdueMonths: r.summary.overdueMonths,
  };
}

function overdueItem(r: RentalRow) {
  return {
    rentalId: r.id,
    property: r.propertyName,
    tenant: r.tenantName,
    overdue: money(r.summary.overdueAmount),
    months: r.schedule.filter((m) => m.pastDue && m.balance > 0).map((m) => ({ month: m.month, dueDate: m.dueDate, balance: money(m.balance) })),
  };
}

export function registerReadTools(server: McpServer, run: (fn: () => Promise<ReturnType<typeof ok>>) => Promise<ReturnType<typeof ok>>, _ctx: McpContext) {
  server.registerTool(
    "get_dashboard",
    {
      title: "Dashboard",
      description:
        "Today's overview of the landlord's portfolio: occupancy, rent collected this month, overdue rent (total and list), rent due in the next 7 days, open maintenance, upcoming move-outs (30 days), deposit balances still due, rental agreements expiring, and open enquiries with follow-ups and visits due.",
      annotations: READ,
    },
    () =>
      run(async () => {
        const today = localToday();
        const thisMonth = monthOf(today);
        await connectDB();
        const [properties, rentals, openMaintenance, collected] = await Promise.all([
          Property.find({ archived: false }).select("_id").lean(),
          loadRentals({}, today),
          Maintenance.find({ status: { $ne: "done" } }).sort({ createdAt: -1 }).lean(),
          Payment.aggregate<{ total: number }>([
            { $match: { paidOn: { $gte: dateFromISO(`${thisMonth}-01`), $lt: dateFromISO(`${addMonths(thisMonth, 1)}-01`) } } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]),
        ]);
        const live = new Set(properties.map((p) => toId(p._id)));
        const active = rentals.filter((r) => r.status === "active");
        const occupied = new Set(active.map((r) => r.propertyId).filter((p) => live.has(p))).size;
        const overdue = rentals.filter((r) => r.summary.overdueAmount > 0).sort((a, b) => b.summary.overdueAmount - a.summary.overdueAmount);
        const dueSoon = active
          .map((r) => ({ r, due: reminderDue(r, today) }))
          .filter(({ due }) => due && due.kind === "due_soon" && due.amount > 0 && due.dueDate <= addDays(today, DUE_SOON_WINDOW_DAYS))
          .map(({ r, due }) => ({ rentalId: r.id, property: r.propertyName, tenant: r.tenantName, dueDate: due!.dueDate, amount: money(due!.amount) }));
        const soon = addDays(today, 30);
        const movingOut = active
          .filter((r) => r.moveOutDate && r.moveOutDate <= soon)
          .map((r) => ({ rentalId: r.id, property: r.propertyName, tenant: r.tenantName, moveOutDate: r.moveOutDate }));
        const depositDue = rentals.filter((r) => r.depositBalance > 0);
        const { items: agreements } = await agreementsNeedingAttention(rentals, today);
        const maintNames = await propertyNames(openMaintenance.map((m) => m.property));
        const todayStart = new Date(`${today}T00:00:00`);
        const [y, mo, d] = addDays(today, 1).split("-").map(Number);
        const [openEnquiries, followUpsDue, visitsToday] = await Promise.all([
          Enquiry.countDocuments({ status: { $in: OPEN_STATUSES } }),
          Enquiry.countDocuments({ status: { $in: OPEN_STATUSES }, followUpDate: { $ne: null, $lte: new Date(`${today}T00:00:00Z`) } }),
          Enquiry.countDocuments({ status: { $in: OPEN_STATUSES }, visitAt: { $gte: todayStart, $lt: new Date(y, mo - 1, d) } }),
        ]);
        const expected = active.reduce((s, r) => s + (r.schedule.find((m) => m.month === thisMonth)?.due ?? 0), 0);
        return ok({
          today,
          occupancy: { occupied, properties: live.size, percent: live.size ? Math.round((occupied / live.size) * 100) : 0 },
          collectedThisMonth: money(collected[0]?.total ?? 0),
          dueThisMonth: money(expected),
          overdue: { total: money(overdue.reduce((s, r) => s + r.summary.overdueAmount, 0)), rentals: overdue.map(overdueItem) },
          dueSoon,
          openMaintenance: {
            count: openMaintenance.length,
            highPriority: openMaintenance.filter((m) => m.priority === "urgent" || m.priority === "high").length,
            items: openMaintenance.slice(0, 10).map((m) => ({
              id: toId(m._id),
              title: m.title,
              property: maintNames.get(toId(m.property)) ?? "",
              priority: m.priority,
              status: m.status,
            })),
          },
          movingOut,
          depositBalances: {
            count: depositDue.length,
            total: money(depositDue.reduce((s, r) => s + r.depositBalance, 0)),
            rentals: depositDue.map((r) => ({ rentalId: r.id, property: r.propertyName, tenant: r.tenantName, balance: money(r.depositBalance) })),
          },
          agreementsExpiring: agreements.map((a) => ({
            rentalId: a.rental.id,
            property: a.rental.propertyName,
            tenant: a.rental.tenantName,
            endDate: a.agreement.endDate,
            status: a.status,
          })),
          enquiries: { open: openEnquiries, followUpsDue, visitsToday },
        });
      }),
  );

  server.registerTool(
    "list_properties",
    {
      title: "List properties",
      description: "Lists properties with city, type, asking rent, and whether each is occupied (and by whom). Archived properties are hidden unless includeArchived is true.",
      inputSchema: {
        search: z.string().max(100).optional().describe("Matches name, address or city"),
        includeArchived: z.boolean().optional(),
      },
      annotations: READ,
    },
    ({ search, includeArchived }) =>
      run(async () => {
        await connectDB();
        const q: Record<string, unknown> = includeArchived ? {} : { archived: false };
        if (search?.trim()) {
          const re = new RegExp(escapeRegex(search.trim()), "i");
          q.$or = [{ name: re }, { address: re }, { city: re }];
        }
        const [props, active] = await Promise.all([
          Property.find(q).sort({ name: 1 }).limit(500).lean(),
          loadRentals({ status: "active" }),
        ]);
        const byProperty = new Map(active.map((r) => [r.propertyId, r]));
        return ok(
          props.map((p) => {
            const r = byProperty.get(toId(p._id));
            return {
              id: toId(p._id),
              name: p.name,
              address: p.address,
              city: p.city,
              type: p.type,
              bedrooms: p.bedrooms,
              bathrooms: p.bathrooms,
              askingRent: money(p.monthlyRent),
              archived: p.archived,
              occupied: !!r,
              currentRental: r ? { id: r.id, tenant: r.tenantName, rent: money(r.currentRent) } : null,
            };
          }),
        );
      }),
  );

  server.registerTool(
    "get_property",
    {
      title: "Get property",
      description: "One property's details with its rentals (current and past), maintenance requests and open enquiries.",
      inputSchema: { propertyId: id("Property") },
      annotations: READ,
    },
    ({ propertyId }) =>
      run(async () => {
        await connectDB();
        const _id = asObjectId(propertyId);
        const p = _id ? await Property.findById(_id).lean() : null;
        if (!p) return fail("Property not found.");
        const [rentals, maintenance, enquiries] = await Promise.all([
          loadRentals({ property: _id }),
          Maintenance.find({ property: _id }).sort({ createdAt: -1 }).limit(50).lean(),
          Enquiry.find({ property: _id, status: { $in: OPEN_STATUSES } }).sort({ createdAt: -1 }).limit(50).select("name status createdAt followUpDate").lean(),
        ]);
        return ok({
          id: toId(p._id),
          name: p.name,
          address: p.address,
          city: p.city,
          type: p.type,
          bedrooms: p.bedrooms,
          bathrooms: p.bathrooms,
          askingRent: money(p.monthlyRent),
          electricityRatePerUnit: p.electricityRate != null ? money(p.electricityRate) : null,
          notes: p.notes,
          archived: p.archived,
          occupied: rentals.some((r) => r.status === "active"),
          rentals: rentals.map(rentalSummary),
          maintenance: maintenance.map((m) => ({
            id: toId(m._id),
            title: m.title,
            priority: m.priority,
            status: m.status,
            cost: money(m.cost ?? 0),
            createdAt: m.createdAt.toISOString(),
          })),
          openEnquiries: enquiries.map((e) => ({
            id: toId(e._id),
            name: e.name,
            status: e.status,
            createdAt: e.createdAt.toISOString(),
            followUpDate: e.followUpDate ? toISODate(e.followUpDate) : null,
          })),
        });
      }),
  );

  server.registerTool(
    "list_tenants",
    {
      title: "List tenants",
      description: "Lists tenants (name, phone, email, current property). Search by name, phone or email. ID numbers, documents and photos are never included.",
      inputSchema: {
        search: z.string().max(100).optional(),
        includeArchived: z.boolean().optional(),
      },
      annotations: READ,
    },
    ({ search, includeArchived }) =>
      run(async () => {
        await connectDB();
        const q: Record<string, unknown> = includeArchived ? {} : { archived: false };
        const s = search?.trim();
        if (s) {
          const re = new RegExp(escapeRegex(s), "i");
          q.$or = [{ name: re }, { email: re }, { phone: re }];
        }
        let tenants = await Tenant.find(q).sort({ name: 1 }).limit(500).select("name phone email archived").lean();
        // Phone numbers are stored as typed; also match on digits only.
        if (s && phoneKey(s).length >= 4 && tenants.length === 0) {
          const all = await Tenant.find(includeArchived ? {} : { archived: false }).select("name phone email archived").lean();
          tenants = all.filter((t) => phoneKey(t.phone).includes(phoneKey(s)));
        }
        const active = await Rental.find({ status: "active", tenant: { $in: tenants.map((t) => t._id) } }).select("tenant property").lean();
        const names = await propertyNames(active.map((r) => r.property));
        const current = new Map(active.map((r) => [toId(r.tenant), { rentalId: toId(r._id), property: names.get(toId(r.property)) ?? "" }]));
        return ok(
          tenants.map((t) => ({
            id: toId(t._id),
            name: t.name,
            phone: t.phone,
            email: t.email,
            archived: t.archived,
            currentRental: current.get(toId(t._id)) ?? null,
          })),
        );
      }),
  );

  server.registerTool(
    "get_tenant",
    {
      title: "Get tenant",
      description: "One tenant's contact details, notes and rentals with balances. Never includes the ID number, documents or photo.",
      inputSchema: { tenantId: id("Tenant") },
      annotations: READ,
    },
    ({ tenantId }) =>
      run(async () => {
        await connectDB();
        const _id = asObjectId(tenantId);
        const t = _id ? await Tenant.findById(_id).select("name phone email notes archived createdAt").lean() : null;
        if (!t) return fail("Tenant not found.");
        const rentals = await loadRentals({ tenant: _id });
        return ok({
          id: toId(t._id),
          name: t.name,
          phone: t.phone,
          email: t.email,
          notes: t.notes,
          archived: t.archived,
          since: t.createdAt.toISOString(),
          rentals: rentals.map(rentalSummary),
        });
      }),
  );

  server.registerTool(
    "list_rentals",
    {
      title: "List rentals",
      description: "Lists rentals (tenant in a property) with current rent, balance, overdue amount and deposit balance. Filter by status, property or tenant.",
      inputSchema: {
        status: z.enum(["active", "moved_out", "all"]).optional().describe("Default: active"),
        propertyId: id("Property").optional(),
        tenantId: id("Tenant").optional(),
      },
      annotations: READ,
    },
    ({ status, propertyId, tenantId }) =>
      run(async () => {
        const filter: Record<string, unknown> = {};
        if (propertyId) filter.property = asObjectId(propertyId);
        if (tenantId) filter.tenant = asObjectId(tenantId);
        const rows = await loadRentals(filter);
        const s = status ?? "active";
        return ok(rows.filter((r) => s === "all" || r.status === s).map(rentalSummary));
      }),
  );

  server.registerTool(
    "get_rental",
    {
      title: "Get rental",
      description:
        "One rental in full: month-by-month rent schedule (rent, charges, due, paid, balance, status), utility charges, rent changes, recent payments, the security deposit ledger and status, and the latest agreement.",
      inputSchema: { rentalId: id("Rental") },
      annotations: READ,
    },
    ({ rentalId }) =>
      run(async () => {
        const _id = asObjectId(rentalId);
        const [r] = _id ? await loadRentals({ _id }) : [];
        if (!r) return fail("Rental not found.");
        const [deposit, payments, agreements] = await Promise.all([
          loadDeposit(_id!),
          Payment.find({ rental: _id }).sort({ paidOn: -1, createdAt: -1 }).limit(50).lean(),
          loadAgreements([r.id]),
        ]);
        const latest = agreements.get(r.id)?.[0] ?? null;
        return ok({
          ...rentalSummary(r),
          monthlyRentAtMoveIn: money(r.monthlyRent),
          nextRentChange: r.nextRentChange ? { effectiveMonth: r.nextRentChange.effectiveMonth, rent: money(r.nextRentChange.monthlyRent) } : null,
          rentChanges: r.rentChanges.map((c) => ({ effectiveMonth: c.effectiveMonth, rent: money(c.monthlyRent) })),
          charges: r.charges.map((c) => ({ month: c.month, type: c.type, amount: money(c.amount) })),
          schedule: r.schedule.map((m) => ({
            month: m.month,
            dueDate: m.dueDate,
            rent: money(m.rent),
            charges: money(m.charges),
            due: money(m.due),
            paid: money(m.paid),
            balance: money(m.balance),
            status: m.status,
          })),
          payments: payments.map((p) => ({
            id: toId(p._id),
            forMonth: p.forMonth,
            amount: money(p.amount),
            paidOn: toISODate(p.paidOn),
            method: p.method,
            note: p.note,
            receiptNo: p.receiptNo ?? null,
          })),
          deposit: {
            advanceFlow: deposit.advanceFlow,
            quoted: money(deposit.status.agreed),
            advance: money(deposit.status.advance),
            paidLater: money(deposit.status.paidLater),
            received: money(deposit.summary.received),
            deducted: money(deposit.summary.deducted),
            refunded: money(deposit.summary.refunded),
            held: money(deposit.summary.held),
            balanceDue: money(deposit.status.balance),
            entries: deposit.entries.map((e) => ({ date: e.date, kind: e.kind, label: e.label, amount: money(e.amount), method: e.method, reason: e.reason, receiptNo: e.receiptNo })),
          },
          latestAgreement: latest ? { startDate: latest.startDate, endDate: latest.endDate } : null,
        });
      }),
  );

  server.registerTool(
    "list_overdue_rent",
    {
      title: "Overdue rent",
      description: "Rentals with overdue rent (past the due day and not fully paid), largest first, with the unpaid months.",
      annotations: READ,
    },
    () =>
      run(async () => {
        const rows = (await loadRentals()).filter((r) => r.summary.overdueAmount > 0).sort((a, b) => b.summary.overdueAmount - a.summary.overdueAmount);
        return ok({ total: money(rows.reduce((s, r) => s + r.summary.overdueAmount, 0)), rentals: rows.map(overdueItem) });
      }),
  );

  server.registerTool(
    "list_payments",
    {
      title: "List rent payments",
      description: "Rent payments, newest first, by payment date range and/or rental. Defaults to the last 90 days.",
      inputSchema: {
        from: isoDate.optional().describe("Paid on or after (YYYY-MM-DD)"),
        to: isoDate.optional().describe("Paid on or before (YYYY-MM-DD)"),
        rentalId: id("Rental").optional(),
        limit: z.number().int().min(1).max(500).optional().describe("Default 100"),
      },
      annotations: READ,
    },
    ({ from, to, rentalId, limit }) =>
      run(async () => {
        await connectDB();
        const q: Record<string, unknown> = {};
        const start = from ?? (rentalId ? null : addDays(localToday(), -90));
        const range: Record<string, Date> = {};
        if (start) range.$gte = dateFromISO(start);
        if (to) range.$lt = dateFromISO(addDays(to, 1));
        if (Object.keys(range).length) q.paidOn = range;
        if (rentalId) q.rental = asObjectId(rentalId);
        const rows = await Payment.find(q).sort({ paidOn: -1, createdAt: -1 }).limit(limit ?? 100).lean();
        const rentals = await Rental.find({ _id: { $in: rows.map((p) => p.rental) } }).select("property tenant").lean();
        const [props, tenants] = await Promise.all([
          propertyNames(rentals.map((r) => r.property)),
          Tenant.find({ _id: { $in: rentals.map((r) => r.tenant) } }).select("name").lean(),
        ]);
        const tenantName = new Map(tenants.map((t) => [toId(t._id), t.name]));
        const rentalInfo = new Map(rentals.map((r) => [toId(r._id), { property: props.get(toId(r.property)) ?? "", tenant: tenantName.get(toId(r.tenant)) ?? "" }]));
        return ok({
          total: money(rows.reduce((s, p) => s + p.amount, 0)),
          payments: rows.map((p) => ({
            id: toId(p._id),
            rentalId: toId(p.rental),
            ...(rentalInfo.get(toId(p.rental)) ?? { property: "", tenant: "" }),
            forMonth: p.forMonth,
            amount: money(p.amount),
            paidOn: toISODate(p.paidOn),
            method: p.method,
            note: p.note,
            receiptNo: p.receiptNo ?? null,
          })),
        });
      }),
  );

  server.registerTool(
    "list_expenses",
    {
      title: "List expenses",
      description: "Expenses for an Indian financial year (e.g. 2026-27; default the current one), optionally for one property or 'general' (not tied to a property).",
      inputSchema: {
        fy: z.string().optional().describe("Financial year like 2026-27"),
        propertyId: z.union([id("Property"), z.literal("general")]).optional(),
      },
      annotations: READ,
    },
    ({ fy, propertyId }) =>
      run(async () => {
        const year = fy ?? fyOf(localToday());
        if (!isFy(year)) return fail("fy must look like 2026-27.");
        const { start, endExclusive } = fyRange(year);
        await connectDB();
        const q: Record<string, unknown> = { date: { $gte: dateFromISO(start), $lt: dateFromISO(endExclusive) } };
        if (propertyId === "general") q.property = null;
        else if (propertyId) q.property = asObjectId(propertyId);
        const rows = await Expense.find(q).sort({ date: -1, createdAt: -1 }).limit(1000).lean();
        const names = await propertyNames(rows.map((e) => e.property));
        return ok({
          fy: year,
          total: money(rows.reduce((s, e) => s + e.amount, 0)),
          expenses: rows.map((e) => ({
            id: toId(e._id),
            date: toISODate(e.date),
            property: e.property ? (names.get(toId(e.property)) ?? "(deleted property)") : "General",
            category: expenseCategoryLabel(e.category),
            amount: money(e.amount),
            vendor: e.vendor,
            note: e.note,
            hasBill: !!e.bill,
          })),
        });
      }),
  );

  server.registerTool(
    "get_profit_report",
    {
      title: "Profit report",
      description: "Income (rent received, by payment date) minus expenses for an Indian financial year: per property, by expense category and by month, plus total rent received for the ITR.",
      inputSchema: { fy: z.string().optional().describe("Financial year like 2026-27 (default: current)") },
      annotations: READ,
    },
    ({ fy }) =>
      run(async () => {
        const year = fy ?? fyOf(localToday());
        if (!isFy(year)) return fail("fy must look like 2026-27.");
        const s = await loadFySummary(year);
        const cat = (c: { label: string; amount: number }) => ({ category: c.label, amount: money(c.amount) });
        return ok({
          fy: s.fy,
          total: { income: money(s.total.income), expenses: money(s.total.expenses), profit: money(s.total.profit) },
          rentReceived: money(s.rentReceived),
          properties: s.properties.map((p) => ({
            propertyId: p.propertyId,
            name: p.name,
            income: money(p.income),
            expenses: money(p.expenses),
            profit: money(p.profit),
            expensesByCategory: p.expensesByCategory.map(cat),
          })),
          expensesByCategory: s.expensesByCategory.map(cat),
          months: s.months.map((m) => ({ month: m.month, income: money(m.income), expenses: money(m.expenses), profit: money(m.profit) })),
        });
      }),
  );

  server.registerTool(
    "list_enquiries",
    {
      title: "List enquiries",
      description: "Property enquiries (leads), newest first. Status group: open (default), accepted, rejected, declined or all. Search by name or phone.",
      inputSchema: {
        status: z.enum(STATUS_GROUPS).optional(),
        search: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(500).optional().describe("Default 100"),
      },
      annotations: READ,
    },
    ({ status, search, limit }) =>
      run(async () => {
        await connectDB();
        const q: Record<string, unknown> = { status: { $in: statusesInGroup(status ?? "open") } };
        const s = search?.trim();
        if (s) {
          const or: Record<string, unknown>[] = [{ name: new RegExp(escapeRegex(s), "i") }];
          if (phoneKey(s).length >= 4) or.push({ phoneKey: new RegExp(escapeRegex(phoneKey(s))) });
          q.$or = or;
        }
        const rows = await Enquiry.find(q).sort({ createdAt: -1 }).limit(limit ?? 100).lean();
        const names = await propertyNames(rows.map((e) => e.property));
        return ok(
          rows.map((e) => ({
            id: toId(e._id),
            name: e.name,
            phone: e.phone,
            property: e.property ? (names.get(toId(e.property)) ?? "") : "Any property",
            source: e.source,
            status: e.status,
            statusLabel: STATUS_LABEL[e.status as EnquiryStatus] ?? e.status,
            followUpDate: e.followUpDate ? toISODate(e.followUpDate) : null,
            visitAt: e.visitAt ? e.visitAt.toISOString() : null,
            createdAt: e.createdAt.toISOString(),
          })),
        );
      }),
  );

  server.registerTool(
    "get_enquiry",
    {
      title: "Get enquiry",
      description: "One enquiry with all its details and the full timeline (notes, calls, status changes, visits).",
      inputSchema: { enquiryId: id("Enquiry") },
      annotations: READ,
    },
    ({ enquiryId }) =>
      run(async () => {
        await connectDB();
        const _id = asObjectId(enquiryId);
        const e = _id ? await Enquiry.findById(_id).lean() : null;
        if (!e) return fail("Enquiry not found.");
        const [activities, names] = await Promise.all([
          EnquiryActivity.find({ enquiry: _id }).sort({ at: -1, _id: -1 }).limit(500).lean(),
          propertyNames([e.property]),
        ]);
        return ok({
          id: toId(e._id),
          name: e.name,
          phone: e.phone,
          email: e.email,
          property: e.property ? { id: toId(e.property), name: names.get(toId(e.property)) ?? "" } : null,
          source: e.source,
          budget: e.budget != null ? money(e.budget) : null,
          desiredMoveIn: e.desiredMoveIn ? toISODate(e.desiredMoveIn) : null,
          occupants: e.occupants,
          occupation: e.occupation,
          notes: e.notes,
          status: e.status,
          statusLabel: STATUS_LABEL[e.status as EnquiryStatus] ?? e.status,
          outcomeReason: e.outcomeReason || null,
          outcomeNote: e.outcomeNote || null,
          followUpDate: e.followUpDate ? toISODate(e.followUpDate) : null,
          visitAt: e.visitAt ? e.visitAt.toISOString() : null,
          convertedTenantId: e.convertedTenant ? toId(e.convertedTenant) : null,
          convertedRentalId: e.convertedRental ? toId(e.convertedRental) : null,
          createdAt: e.createdAt.toISOString(),
          timeline: activities.map((a) => ({ at: a.at.toISOString(), kind: a.kind, text: a.text })),
        });
      }),
  );

  server.registerTool(
    "list_maintenance",
    {
      title: "List maintenance requests",
      description: "Maintenance / repair requests with property, priority, status and cost. Status: open (default: open and in progress), done or all.",
      inputSchema: {
        status: z.enum(["open", "done", "all"]).optional(),
        propertyId: id("Property").optional(),
      },
      annotations: READ,
    },
    ({ status, propertyId }) =>
      run(async () => {
        await connectDB();
        const s = status ?? "open";
        const q: Record<string, unknown> = s === "open" ? { status: { $ne: "done" } } : s === "done" ? { status: "done" } : {};
        if (propertyId) q.property = asObjectId(propertyId);
        const rows = await Maintenance.find(q).sort({ createdAt: -1 }).limit(500).lean();
        const names = await propertyNames(rows.map((m) => m.property));
        return ok(
          rows.map((m) => ({
            id: toId(m._id),
            title: m.title,
            description: m.description,
            property: { id: toId(m.property), name: names.get(toId(m.property)) ?? "(deleted property)" },
            priority: m.priority,
            status: m.status,
            cost: money(m.cost ?? 0),
            createdAt: m.createdAt.toISOString(),
            updatedAt: m.updatedAt.toISOString(),
          })),
        );
      }),
  );

  server.registerTool(
    "list_notifications",
    {
      title: "List notifications",
      description: "The app's alerts and reminders (overdue rent, rent due soon, move-outs, pending repairs, enquiry follow-ups, agreements). Unread only by default.",
      inputSchema: {
        unreadOnly: z.boolean().optional().describe("Default true"),
        limit: z.number().int().min(1).max(200).optional().describe("Default 50"),
      },
      annotations: READ,
    },
    ({ unreadOnly, limit }) =>
      run(async () => {
        const items = await listNotifications({ filter: unreadOnly === false ? "all" : "unread", limit: limit ?? 50 });
        return ok(
          items.map((n) => ({
            id: n.id,
            type: n.type,
            category: n.category,
            title: n.title,
            body: n.body,
            since: n.activeSince,
            read: n.read,
            resolved: n.resolved,
          })),
        );
      }),
  );

  server.registerTool(
    "list_agreements_expiring",
    {
      title: "Agreements expiring",
      description: "Active rentals whose latest rental agreement is expiring soon (within the Settings threshold) or already expired, soonest first.",
      annotations: READ,
    },
    () =>
      run(async () => {
        const today = localToday();
        const rentals = await loadRentals({ status: "active" }, today);
        const { items, thresholdDays } = await agreementsNeedingAttention(rentals, today);
        return ok({
          thresholdDays,
          agreements: items.map((a) => ({
            rentalId: a.rental.id,
            property: a.rental.propertyName,
            tenant: a.rental.tenantName,
            startDate: a.agreement.startDate,
            endDate: a.agreement.endDate,
            status: a.status,
          })),
        });
      }),
  );
}
