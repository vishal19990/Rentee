import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { EXPENSE_CATEGORIES } from "@/lib/expenses";

const { Schema } = mongoose;

/** Money the landlord spent. `property: null` = general (not tied to a property). */
const expenseSchema = new Schema(
  {
    property: { type: Schema.Types.ObjectId, ref: "Property", default: null, index: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    /** Integer minor units, > 0. */
    amount: { type: Number, required: true, min: 1 },
    /** Calendar date stored as UTC midnight. */
    date: { type: Date, required: true, index: true },
    vendor: { type: String, default: "", trim: true },
    note: { type: String, default: "" },
    /** Maintenance request this expense was logged from (at most one expense per request). */
    maintenance: { type: Schema.Types.ObjectId, ref: "Maintenance", default: null },
    /** Optional bill attachment stored in GridFS (bucket "bills"). */
    bill: {
      type: new Schema(
        {
          fileId: { type: Schema.Types.ObjectId, required: true },
          name: { type: String, required: true },
          contentType: { type: String, required: true },
          size: { type: Number, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);

expenseSchema.index(
  { maintenance: 1 },
  { unique: true, partialFilterExpression: { maintenance: { $type: "objectId" } }, name: "one_expense_per_maintenance" },
);

export type ExpenseDoc = InferSchemaType<typeof expenseSchema>;

export const Expense: Model<ExpenseDoc> = (mongoose.models.Expense as Model<ExpenseDoc>) || mongoose.model<ExpenseDoc>("Expense", expenseSchema);
