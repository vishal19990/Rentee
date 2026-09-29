import { z } from "zod";
import { parseMoney } from "./money";
import { REMINDER_PLACEHOLDERS, unknownPlaceholders } from "./whatsapp";

/* ---------- shared form-state contract (used by server actions and client forms) ---------- */

export type FieldErrors = Record<string, string[] | undefined>;

export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  /** Submitted values, echoed back so the form keeps what was typed after an error. */
  values?: Record<string, string>;
};

/** Flattens FormData into plain string values (files and framework fields are skipped). */
export function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  return error.flatten().fieldErrors as FieldErrors;
}

/** Parses FormData with a schema, returning either data or a ready-to-return ActionState. */
export function parseForm<S extends z.ZodTypeAny>(
  schema: S,
  fd: FormData,
): { success: true; data: z.output<S>; values: Record<string, string> } | { success: false; state: ActionState } {
  const values = formValues(fd);
  const result = schema.safeParse(values);
  if (result.success) return { success: true, data: result.data, values };
  return {
    success: false,
    state: {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(result.error),
      values,
    },
  };
}

/* ---------- primitives ---------- */

const requiredText = (label: string, max: number) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .transform((v) => v || "");

export const objectId = (label: string) =>
  z
    .string({ required_error: `Select a ${label.toLowerCase()}` })
    .regex(/^[a-f\d]{24}$/i, `Select a ${label.toLowerCase()}`);

const isoDate = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is required`)
    .refine((s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, `${label} is not a valid date`);

const intInRange = (label: string, min: number, max: number) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .regex(/^\d+$/, `${label} must be a whole number`)
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(min, `${label} must be at least ${min}`)
        .max(max, `${label} must be at most ${max}`),
    );

/** Money input -> integer minor units. `positive` requires > 0, otherwise >= 0. */
export const money = (label: string, { positive = true, optional = false } = {}) =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const s = (raw ?? "").trim();
      if (!s) {
        if (optional) return 0;
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is required` });
        return z.NEVER;
      }
      if (s.startsWith("-")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: positive ? `${label} must be greater than zero` : `${label} cannot be negative`,
        });
        return z.NEVER;
      }
      const v = parseMoney(s);
      if (v === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a valid amount` });
        return z.NEVER;
      }
      if (positive && v <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be greater than zero` });
        return z.NEVER;
      }
      return v;
    });

/* ---------- domain schemas ---------- */

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const PROPERTY_TYPES = ["house", "apartment", "villa", "townhouse", "commercial", "other"] as const;

export const propertySchema = z.object({
  name: requiredText("Name", 100),
  address: requiredText("Address", 200),
  city: requiredText("City", 80),
  type: z.enum(PROPERTY_TYPES, { errorMap: () => ({ message: "Select a property type" }) }),
  bedrooms: intInRange("Bedrooms", 0, 50),
  bathrooms: intInRange("Bathrooms", 0, 50),
  monthlyRent: money("Monthly rent"),
  notes: optionalText(2000),
});

export const tenantSchema = z.object({
  name: requiredText("Name", 100),
  phone: z
    .string({ required_error: "Phone is required" })
    .trim()
    .min(1, "Phone is required")
    .regex(/^\+?[\d\s\-()]{6,20}$/, "Enter a valid phone number"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => v || "")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email"),
  idNumber: optionalText(50),
  notes: optionalText(2000),
});

/** Optional date input: empty -> null. */
const optionalIsoDate = (label: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .pipe(z.union([z.literal("").transform(() => null), isoDate(label)]));

const rentalTerms = {
  moveInDate: isoDate("Move-in date"),
  monthlyRent: money("Monthly rent"),
  deposit: money("Deposit", { positive: false, optional: true }),
  dueDay: intInRange("Due day", 1, 28),
};

const MOVE_OUT_BEFORE_MOVE_IN = "Move-out date can't be before the move-in date";

/** New rental: month-to-month, so no end/move-out date is entered at creation. */
export const rentalSchema = z.object({
  propertyId: objectId("Property"),
  tenantId: objectId("Tenant"),
  ...rentalTerms,
});

/** Editing a rental; the move-out date is optional (empty = still living there). */
export const rentalUpdateSchema = z
  .object({ ...rentalTerms, moveOutDate: optionalIsoDate("Move-out date") })
  .refine((v) => v.moveOutDate === null || v.moveOutDate >= v.moveInDate, {
    message: MOVE_OUT_BEFORE_MOVE_IN,
    path: ["moveOutDate"],
  });

/** "Move out" form. The rental's move-in date is passed in for the cross-field check. */
export const moveOutSchema = (moveInDate: string) =>
  z
    .object({ moveOutDate: isoDate("Move-out date") })
    .refine((v) => v.moveOutDate >= moveInDate, { message: MOVE_OUT_BEFORE_MOVE_IN, path: ["moveOutDate"] });

export const PAYMENT_METHODS = ["cash", "bank_transfer", "upi", "cheque", "card", "other"] as const;

export const paymentSchema = z.object({
  rentalId: objectId("Rental"),
  forMonth: z
    .string({ required_error: "Select the month this payment is for" })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Select the month this payment is for"),
  amount: money("Amount"),
  paidOn: isoDate("Paid on"),
  method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: "Select a payment method" }) }),
  note: optionalText(500),
});

export const MAINTENANCE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const MAINTENANCE_STATUSES = ["open", "in_progress", "done"] as const;

export const maintenanceSchema = z.object({
  propertyId: objectId("Property"),
  title: requiredText("Title", 120),
  description: optionalText(4000),
  priority: z.enum(MAINTENANCE_PRIORITIES, { errorMap: () => ({ message: "Select a priority" }) }),
  status: z.enum(MAINTENANCE_STATUSES, { errorMap: () => ({ message: "Select a status" }) }),
  cost: money("Cost", { positive: false, optional: true }),
});

export const adminSchema = z.object({
  name: requiredText("Name", 100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200, "Password is too long"),
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters").max(200, "Password is too long"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/* ---------- WhatsApp reminders ---------- */

export const reminderTemplateSchema = z.object({
  reminderTemplate: z
    .string({ required_error: "Message template is required" })
    .trim()
    .min(10, "Message template must be at least 10 characters")
    .max(1000, "Message template must be at most 1000 characters")
    .superRefine((v, ctx) => {
      const unknown = unknownPlaceholders(v);
      if (unknown.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown placeholder ${unknown.map((u) => `{${u}}`).join(", ")}. Use ${REMINDER_PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}.`,
        });
      }
    }),
});

/* ---------- notifications ---------- */

export const notificationSettingsSchema = z.object({
  dueSoonDays: intInRange("Days before rent is due", 0, 30),
  moveOutDays: intInRange("Days before a move-out", 1, 60),
  maintenanceDays: intInRange("Days a repair can stay open", 1, 90),
  desktopNotifications: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

/* ---------- uploads ---------- */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Validates an uploaded image by declared type, size, and (optionally) file signature. */
export function validateImage(file: { type: string; size: number } | null | undefined, head?: Uint8Array): string | null {
  if (!file || file.size === 0) return "Choose an image to upload";
  if (!IMAGE_TYPES[file.type]) return "Only JPEG, PNG, WebP or GIF images are allowed";
  if (file.size > MAX_UPLOAD_BYTES) return "Image must be 5 MB or smaller";
  if (head && !matchesSignature(file.type, head)) return "File is not a valid image";
  return null;
}

function matchesSignature(type: string, b: Uint8Array): boolean {
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  switch (type) {
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "image/gif":
      return starts(0x47, 0x49, 0x46, 0x38);
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
    default:
      return false;
  }
}
