"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Types } from "mongoose";
import type { z } from "zod";
import { requireUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { deleteFile, safeFileName, saveFile } from "@/lib/file-store";
import { dateFromISO } from "@/lib/format";
import { ATTACHMENT_TYPES, expenseSchema, parseForm, validateAttachment, type ActionState } from "@/lib/validation";
import { Expense } from "@/models/Expense";
import { Maintenance } from "@/models/Maintenance";
import { Property } from "@/models/Property";

const NOT_FOUND: ActionState = { ok: false, message: "Expense not found." };
const ALREADY_LOGGED = "This repair is already logged as an expense";

function revalidateExpenseViews(id?: string) {
  revalidatePath("/expenses");
  revalidatePath("/reports", "layout");
  revalidatePath("/maintenance", "layout");
  if (id) revalidatePath(`/expenses/${id}/edit`);
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

type Bill = { fileId: Types.ObjectId; name: string; contentType: string; size: number };

/** Reads + validates the optional "bill" file. Returns the stored bill, nothing, or a field error. */
async function storeBill(fd: FormData): Promise<{ bill: Bill | null } | { error: string }> {
  const file = fd.get("bill");
  const f = file instanceof File && file.size > 0 ? file : null;
  if (!f) return { bill: null };
  let error = validateAttachment(f);
  if (error) return { error };
  const bytes = Buffer.from(await f.arrayBuffer());
  error = validateAttachment(f, bytes.subarray(0, 12));
  if (error) return { error };
  const name = safeFileName(f.name, `bill.${ATTACHMENT_TYPES[f.type]}`);
  const fileId = await saveFile("bills", bytes, { filename: name, contentType: f.type });
  return { bill: { fileId, name, contentType: f.type, size: f.size } };
}

type ExpenseInput = z.output<typeof expenseSchema>;

/** Validates the form and the property / maintenance references. */
async function parseExpense(
  fd: FormData,
): Promise<{ state: ActionState } | { data: ExpenseInput; values: Record<string, string> }> {
  const parsed = parseForm(expenseSchema, fd);
  if (!parsed.success) return { state: parsed.state };
  const { values, data } = parsed;
  await connectDB();
  if (data.propertyId && !(await Property.exists({ _id: data.propertyId }))) {
    return { state: { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { propertyId: ["Select a property"] }, values } };
  }
  if (data.maintenanceId && !(await Maintenance.exists({ _id: data.maintenanceId }))) {
    return { state: { ok: false, message: "That maintenance request no longer exists.", values } };
  }
  return { data, values };
}

export async function createExpense(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = await parseExpense(fd);
  if ("state" in parsed) return parsed.state;
  const { data, values } = parsed;
  if (data.maintenanceId && (await Expense.exists({ maintenance: data.maintenanceId }))) {
    return { ok: false, message: ALREADY_LOGGED, values };
  }

  const stored = await storeBill(fd);
  if ("error" in stored) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { bill: [stored.error] }, values };

  try {
    await Expense.create({
      property: data.propertyId,
      category: data.category,
      amount: data.amount,
      date: dateFromISO(data.date),
      vendor: data.vendor,
      note: data.note,
      maintenance: data.maintenanceId,
      bill: stored.bill,
    });
  } catch (err) {
    await deleteFile("bills", stored.bill?.fileId);
    if (isDuplicateKey(err)) return { ok: false, message: ALREADY_LOGGED, values };
    throw err;
  }
  revalidateExpenseViews();
  redirect(data.maintenanceId ? `/maintenance/${data.maintenanceId}/edit` : "/expenses");
}

export async function updateExpense(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  const parsed = await parseExpense(fd);
  if ("state" in parsed) return parsed.state;
  const { data, values } = parsed;
  const existing = await Expense.findById(_id).select("bill maintenance").lean();
  if (!existing) return NOT_FOUND;

  const stored = await storeBill(fd);
  if ("error" in stored) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { bill: [stored.error] }, values };

  await Expense.updateOne(
    { _id },
    {
      property: data.propertyId,
      category: data.category,
      amount: data.amount,
      date: dateFromISO(data.date),
      vendor: data.vendor,
      note: data.note,
      // The maintenance link is fixed at creation.
      ...(stored.bill ? { bill: stored.bill } : {}),
    },
  );
  // A new bill replaces the old one.
  if (stored.bill && existing.bill) await deleteFile("bills", existing.bill.fileId);
  revalidateExpenseViews(id);
  redirect("/expenses");
}

export async function removeExpenseBill(id: string): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  await connectDB();
  const before = await Expense.findOneAndUpdate({ _id, bill: { $ne: null } }, { $set: { bill: null } }).lean();
  if (!before?.bill) return { ok: false, message: "No bill attached." };
  await deleteFile("bills", before.bill.fileId);
  revalidateExpenseViews(id);
  return { ok: true, message: "Bill removed." };
}

export async function deleteExpense(id: string): Promise<ActionState> {
  await requireUser();
  const _id = asObjectId(id);
  if (!_id) return NOT_FOUND;
  await connectDB();
  const doc = await Expense.findByIdAndDelete(_id).lean();
  if (!doc) return NOT_FOUND;
  await deleteFile("bills", doc.bill?.fileId);
  revalidateExpenseViews();
  redirect("/expenses");
}
