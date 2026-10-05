import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

/**
 * Reports hub. For now the only report is the profit report; the full hub (collections,
 * tenant ledger, FY summary, exports) replaces this redirect later.
 */
export default async function ReportsPage() {
  await requireUser();
  redirect("/reports/profit");
}
