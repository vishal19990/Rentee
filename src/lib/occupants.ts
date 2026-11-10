import { z } from "zod";

/** Other people staying with a tenant (co-occupants / secondary contacts). */
export const OCCUPANT_RELATIONS = ["spouse", "family", "roommate", "friend", "other"] as const;
export type OccupantRelation = (typeof OCCUPANT_RELATIONS)[number];

export const OCCUPANT_RELATION_LABELS: Record<OccupantRelation, string> = {
  spouse: "Spouse",
  family: "Family",
  roommate: "Roommate",
  friend: "Friend",
  other: "Other",
};

export const MAX_OCCUPANTS = 10;

const text = (max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .pipe(z.string().max(max, `Keep this under ${max} characters`));

/** Add / edit form. Only the last 4 digits of an ID are kept (never a full Aadhaar number). */
export const occupantSchema = z
  .object({
    name: z
      .string()
      .optional()
      .transform((v) => (v ?? "").trim())
      .pipe(z.string().min(1, "Enter a name").max(80, "Keep the name under 80 characters")),
    phone: text(30).refine((v) => v === "" || v.replace(/\D/g, "").length >= 8, "Enter a valid phone number, or leave it empty"),
    relation: z.enum(OCCUPANT_RELATIONS, { errorMap: () => ({ message: "Choose a relation" }) }),
    idLast4: text(20).refine((v) => v === "" || /^\d{4}$/.test(v), "Enter only the last 4 digits (e.g. 4521)"),
    notes: text(300),
    emergency: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
  });

export type OccupantInput = z.infer<typeof occupantSchema>;
