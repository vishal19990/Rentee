/** Landlord expense categories (pure). */

export const EXPENSE_CATEGORIES = [
  "repair",
  "maintenance",
  "property_tax",
  "society",
  "electricity",
  "water",
  "insurance",
  "loan_interest",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  repair: "Repair",
  maintenance: "Maintenance",
  property_tax: "Property tax",
  society: "Society charges",
  electricity: "Electricity",
  water: "Water",
  insurance: "Insurance",
  loan_interest: "Loan interest",
  other: "Other",
};

export function expenseCategoryLabel(c: string): string {
  return EXPENSE_CATEGORY_LABELS[c as ExpenseCategory] ?? c;
}
