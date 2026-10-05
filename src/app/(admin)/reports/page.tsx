import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { fyOf } from "@/lib/fy";
import { formatMonth, localToday, monthOf } from "@/lib/rent";
import { PageHeader } from "@/components/ui";
import { IconCalendar, IconChart, IconFile, IconTrendingUp, IconWallet } from "@/components/icons";
import { DownloadLink } from "./download-link";

export const metadata: Metadata = { title: "Reports" };

function ReportCard({
  href,
  icon,
  title,
  description,
  downloads,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  downloads?: ReactNode;
}) {
  return (
    <section className="card flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 [&>svg]:size-5">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">
            <Link href={href} className="hover:text-brand-700">
              {title}
            </Link>
          </h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-1 flex-wrap items-end gap-2">
        <Link href={href} className="btn btn-primary btn-sm">
          Open
        </Link>
        {downloads}
      </div>
    </section>
  );
}

export default async function ReportsPage() {
  await requireUser();
  const today = localToday();
  const month = monthOf(today);
  const fy = fyOf(today);

  return (
    <>
      <PageHeader title="Reports" description="View on screen or download as Excel. The tenant ledger and the FY summary also come as PDF." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ReportCard
          href="/reports/collections"
          icon={<IconWallet />}
          title="Monthly collections"
          description={`Who owed what for a month, what was collected and what is still due. Includes month-by-month totals for the financial year.`}
          downloads={<DownloadLink href={`/api/reports/collections?month=${month}`} label={`Excel (${formatMonth(month)})`} />}
        />
        <ReportCard
          href="/reports/ledger"
          icon={<IconFile />}
          title="Tenant ledger"
          description="For one rental: every month's rent and charges, paid and balance with a running total, all payments and the security deposit entries."
        />
        <ReportCard
          href="/reports/fy"
          icon={<IconCalendar />}
          title="Financial year summary"
          description="Per property income, expenses (by category) and profit for an Indian financial year, with the total rent received for your ITR."
          downloads={
            <>
              <DownloadLink href={`/api/reports/fy-summary?fy=${fy}&format=xlsx`} label={`Excel (FY ${fy})`} />
              <DownloadLink href={`/api/reports/fy-summary?fy=${fy}&format=pdf`} label="PDF" />
            </>
          }
        />
        <ReportCard
          href="/reports/profit"
          icon={<IconTrendingUp />}
          title="Profit report"
          description="Income minus expenses by month with a chart, for all properties or one."
          downloads={<span className="text-xs text-slate-400"><IconChart className="mr-1 inline size-3.5" />Chart on screen</span>}
        />
      </div>
    </>
  );
}
