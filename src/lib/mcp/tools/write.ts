import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asObjectId, syncRentalStatuses, toId } from "../../data";
import { connectDB } from "../../db";
import { DEPOSIT_METHODS, depositPaymentLabel } from "../../deposit";
import { addDepositPayment } from "../../deposit-store";
import { ENQUIRY_SOURCES, activitySchema, enquirySchema, phoneKey } from "../../enquiries";
import { dateFromISO, formatDate } from "../../format";
import { formatMoneyShort } from "../../money";
import { syncNotificationsSafe } from "../../notification-sync";
import { SCOPE_WRITE, hasScope } from "../../oauth/core";
import { auditWrite } from "../../oauth/store";
import { recordPayment } from "../../payment-store";
import { formatMonth, localToday, toISODate } from "../../rent";
import {
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  PAYMENT_METHODS,
  depositPaymentSchema,
  maintenanceSchema,
  paymentSchema,
} from "../../validation";
import { Enquiry } from "@/models/Enquiry";
import { EnquiryActivity } from "@/models/EnquiryActivity";
import { Maintenance } from "@/models/Maintenance";
import { Property } from "@/models/Property";
import { Rental } from "@/models/Rental";
import { fail, money, moneyInput, ok, zodMessage, type McpContext } from "../util";

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const id = (label: string) => z.string().describe(`${label} id (24 hex characters)`);
const amount = (what: string) =>
  z.number().describe(`${what} in major currency units (rupees for INR), e.g. 15000 or 15000.50`);

const READ_ONLY_MESSAGE =
  "This connection is read-only: this tool requires the rentee:write scope. Disconnect and reconnect Rentee, and tick “Also allow changes” on the consent screen.";

type Result = ReturnType<typeof ok>;

/**
 * Write tools: scope check (rentee:write), the app's own validation, and an audit entry for every
 * attempt. There are deliberately no delete tools.
 */
export function registerWriteTools(server: McpServer, run: (fn: () => Promise<Result>) => Promise<Result>, ctx: McpContext) {
  const write = (tool: string, summary: () => string, fn: () => Promise<Result>) =>
    run(async () => {
      if (!hasScope(ctx.scopes, SCOPE_WRITE)) {
        await auditWrite(ctx, tool, `Refused (read-only): ${summary()}`, false);
        return fail(READ_ONLY_MESSAGE);
      }
      const res = await fn();
      await auditWrite(ctx, tool, (res.isError ? "Failed: " : "") + summary(), !res.isError);
      return res;
    });

  server.registerTool(
    "record_rent_payment",
    {
      title: "Record rent payment",
      description:
        "Records a rent payment for a rental and month (the same rules as the app: the month must be between the move-in month and the move-out month, or up to 12 months ahead while the rental is open-ended). Payments can't be deleted, so confirm the details first. Requires rentee:write.",
      inputSchema: {
        rentalId: id("Rental"),
        forMonth: z.string().describe("Rent month the payment is for, YYYY-MM"),
        amount: amount("Amount paid"),
        paidOn: z.string().optional().describe("Date paid, YYYY-MM-DD (default today)"),
        method: z.enum(PAYMENT_METHODS).optional().describe("Default cash"),
        note: z.string().max(500).optional(),
      },
      annotations: WRITE,
    },
    (args) =>
      write("record_rent_payment", () => `${args.forMonth} ${args.amount} for rental ${args.rentalId}`, async () => {
        const parsed = paymentSchema.safeParse({
          rentalId: args.rentalId,
          forMonth: args.forMonth,
          amount: moneyInput(args.amount),
          paidOn: args.paidOn ?? localToday(),
          method: args.method ?? "cash",
          note: args.note ?? "",
        });
        if (!parsed.success) return fail(zodMessage(parsed.error));
        const res = await recordPayment(parsed.data);
        if (!res.ok) return fail(res.message);
        for (const p of ["/payments", "/dashboard", "/rentals", `/rentals/${parsed.data.rentalId}`, `/properties/${res.propertyId}`, `/tenants/${res.tenantId}`]) {
          revalidatePath(p);
        }
        return ok({
          recorded: true,
          paymentId: res.paymentId,
          rentalId: parsed.data.rentalId,
          forMonth: parsed.data.forMonth,
          month: formatMonth(parsed.data.forMonth),
          amount: money(parsed.data.amount),
          paidOn: parsed.data.paidOn,
          method: parsed.data.method,
        });
      }),
  );

  server.registerTool(
    "add_deposit_payment",
    {
      title: "Add deposit payment",
      description:
        "Records money received towards a rental's security deposit (an advance on/before move-in or a later part payment). Refused if it would exceed the deposit still due. Date: up to 60 days before move-in, never in the future. Requires rentee:write.",
      inputSchema: {
        rentalId: id("Rental"),
        amount: amount("Amount received"),
        date: z.string().optional().describe("YYYY-MM-DD (default today)"),
        method: z.enum(DEPOSIT_METHODS).optional().describe("Default cash"),
        note: z.string().max(300).optional(),
      },
      annotations: WRITE,
    },
    (args) =>
      write("add_deposit_payment", () => `${args.amount} for rental ${args.rentalId}`, async () => {
        const _id = asObjectId(args.rentalId);
        if (!_id) return fail("Rental not found.");
        await connectDB();
        await syncRentalStatuses();
        const rental = await Rental.findById(_id).select("moveInDate tenant").lean();
        if (!rental) return fail("Rental not found.");
        const moveInDate = toISODate(rental.moveInDate);
        const parsed = depositPaymentSchema({ moveInDate, today: localToday() }).safeParse({
          amount: moneyInput(args.amount),
          date: args.date ?? localToday(),
          method: args.method ?? "cash",
          note: args.note ?? "",
        });
        if (!parsed.success) return fail(zodMessage(parsed.error));
        const error = await addDepositPayment(_id, parsed.data, ctx.userId);
        if (error) return fail(error);
        for (const p of [`/rentals/${args.rentalId}`, "/rentals", "/dashboard", `/tenants/${String(rental.tenant)}`]) revalidatePath(p);
        return ok({
          recorded: true,
          label: depositPaymentLabel(parsed.data.date, moveInDate),
          message: `${depositPaymentLabel(parsed.data.date, moveInDate)} of ${formatMoneyShort(parsed.data.amount)} recorded.`,
          amount: money(parsed.data.amount),
          date: parsed.data.date,
        });
      }),
  );

  server.registerTool(
    "create_enquiry",
    {
      title: "Create enquiry",
      description: "Adds a new property enquiry (lead). Leave propertyId empty for 'any property'. Requires rentee:write.",
      inputSchema: {
        name: z.string().max(100),
        phone: z.string().max(40),
        email: z.string().max(200).optional(),
        propertyId: id("Property").optional(),
        source: z.enum(ENQUIRY_SOURCES).optional().describe("Default other"),
        budget: amount("Monthly budget").optional(),
        desiredMoveIn: z.string().optional().describe("YYYY-MM-DD"),
        occupants: z.number().int().optional(),
        occupation: z.string().max(100).optional(),
        notes: z.string().max(2000).optional(),
        followUpDate: z.string().optional().describe("YYYY-MM-DD"),
      },
      annotations: WRITE,
    },
    (args) =>
      write("create_enquiry", () => `${args.name} (${args.phone})`, async () => {
        const parsed = enquirySchema.safeParse({
          name: args.name,
          phone: args.phone,
          email: args.email ?? "",
          propertyId: args.propertyId ?? "",
          source: args.source ?? "other",
          budget: moneyInput(args.budget),
          desiredMoveIn: args.desiredMoveIn ?? "",
          occupants: args.occupants === undefined ? "" : String(args.occupants),
          occupation: args.occupation ?? "",
          notes: args.notes ?? "",
          followUpDate: args.followUpDate ?? "",
        });
        if (!parsed.success) return fail(zodMessage(parsed.error));
        const d = parsed.data;
        await connectDB();
        if (d.propertyId && !(await Property.exists({ _id: d.propertyId }))) return fail("Property not found.");
        const doc = await Enquiry.create({
          name: d.name,
          phone: d.phone,
          phoneKey: phoneKey(d.phone),
          email: d.email,
          property: d.propertyId,
          source: d.source,
          budget: d.budget,
          desiredMoveIn: d.desiredMoveIn ? dateFromISO(d.desiredMoveIn) : null,
          occupants: d.occupants,
          occupation: d.occupation,
          notes: d.notes,
          status: "new",
          followUpDate: d.followUpDate ? dateFromISO(d.followUpDate) : null,
          createdBy: asObjectId(ctx.userId),
        });
        await EnquiryActivity.create({
          enquiry: doc._id,
          kind: "status_change",
          text: `Enquiry created via ${ctx.clientName}${d.followUpDate ? ` · follow-up ${formatDate(d.followUpDate)}` : ""}`,
          at: new Date(),
          by: asObjectId(ctx.userId),
        });
        const enquiryId = toId(doc._id);
        await syncNotificationsSafe({ scope: { enquiryIds: [enquiryId] } });
        revalidatePath("/enquiries");
        revalidatePath("/dashboard");
        if (d.propertyId) revalidatePath(`/properties/${d.propertyId}`);
        return ok({ created: true, enquiryId, name: d.name, status: "new" });
      }),
  );

  server.registerTool(
    "add_enquiry_note",
    {
      title: "Add enquiry note",
      description: "Adds a note or a logged call to an enquiry's timeline (timeline entries can't be edited or deleted). Requires rentee:write.",
      inputSchema: {
        enquiryId: id("Enquiry"),
        kind: z.enum(["note", "call"]).optional().describe("Default note"),
        text: z.string().max(2000),
      },
      annotations: WRITE,
    },
    (args) =>
      write("add_enquiry_note", () => `${args.kind ?? "note"} on enquiry ${args.enquiryId}`, async () => {
        const _id = asObjectId(args.enquiryId);
        if (!_id) return fail("Enquiry not found.");
        const parsed = activitySchema.safeParse({ kind: args.kind ?? "note", text: args.text });
        if (!parsed.success) return fail(zodMessage(parsed.error));
        await connectDB();
        if (!(await Enquiry.exists({ _id }))) return fail("Enquiry not found.");
        await EnquiryActivity.create({ enquiry: _id, kind: parsed.data.kind, text: parsed.data.text, at: new Date(), by: asObjectId(ctx.userId) });
        revalidatePath("/enquiries");
        revalidatePath(`/enquiries/${args.enquiryId}`);
        return ok({ added: true, enquiryId: args.enquiryId, kind: parsed.data.kind });
      }),
  );

  server.registerTool(
    "create_maintenance_request",
    {
      title: "Create maintenance request",
      description: "Logs a repair / maintenance request for a property. Requires rentee:write.",
      inputSchema: {
        propertyId: id("Property"),
        title: z.string().max(120),
        description: z.string().max(4000).optional(),
        priority: z.enum(MAINTENANCE_PRIORITIES).optional().describe("Default medium"),
        status: z.enum(MAINTENANCE_STATUSES).optional().describe("Default open"),
        cost: amount("Cost").optional(),
      },
      annotations: WRITE,
    },
    (args) =>
      write("create_maintenance_request", () => `${args.title} at property ${args.propertyId}`, async () => {
        const parsed = maintenanceSchema.safeParse({
          propertyId: args.propertyId,
          title: args.title,
          description: args.description ?? "",
          priority: args.priority ?? "medium",
          status: args.status ?? "open",
          cost: moneyInput(args.cost),
        });
        if (!parsed.success) return fail(zodMessage(parsed.error));
        const { propertyId, ...data } = parsed.data;
        await connectDB();
        if (!(await Property.exists({ _id: propertyId }))) return fail("Property not found.");
        const created = await Maintenance.create({ property: propertyId, ...data });
        await syncNotificationsSafe({ scope: { maintenanceIds: [String(created._id)] } });
        revalidatePath("/maintenance");
        revalidatePath("/dashboard");
        revalidatePath(`/properties/${propertyId}`);
        return ok({ created: true, maintenanceId: String(created._id), title: data.title, priority: data.priority, status: data.status });
      }),
  );

  server.registerTool(
    "update_maintenance_status",
    {
      title: "Update maintenance status",
      description: "Moves a maintenance request to open, in_progress or done. Requires rentee:write.",
      inputSchema: {
        maintenanceId: id("Maintenance request"),
        status: z.enum(MAINTENANCE_STATUSES),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    (args) =>
      write("update_maintenance_status", () => `${args.maintenanceId} → ${args.status}`, async () => {
        const _id = asObjectId(args.maintenanceId);
        if (!_id) return fail("Maintenance request not found.");
        await connectDB();
        const doc = await Maintenance.findByIdAndUpdate(_id, { status: args.status }).lean();
        if (!doc) return fail("Maintenance request not found.");
        await syncNotificationsSafe({ scope: { maintenanceIds: [args.maintenanceId] } });
        revalidatePath("/maintenance");
        revalidatePath("/dashboard");
        revalidatePath(`/properties/${String(doc.property)}`);
        return ok({ updated: true, maintenanceId: args.maintenanceId, title: doc.title, from: doc.status, to: args.status });
      }),
  );
}
