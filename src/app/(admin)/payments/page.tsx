import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadRentals, toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { dateFromISO, formatDate, titleCase } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { addMonths, formatMonth, localToday, monthOf } from "@/lib/rent";
import { Payment } from "@/models/Payment";
import { ButtonLink, EmptyState, PageHeader, Table, TBody, Td, Th, THead } from "@/components/ui";
import { IconArrowLeft, IconPlus, IconWallet } from "@/components/icons";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireUser();
  const { month: raw } = await searchParams;
  const current = monthOf(localToday());
  const month = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : current;

  await connectDB();
  const payments = await Payment.find({
    paidOn: { $gte: dateFromISO(`${month}-01`), $lt: dateFromISO(`${addMonths(month, 1)}-01`) },
  })
    .sort({ paidOn: -1, createdAt: -1 })
    .lean();
  const rentals = await loadRentals({ _id: { $in: [...new Set(payments.map((p) => toId(p.rental)))] } });
  const rentalById = new Map(rentals.map((l) => [l.id, l]));
  const total = payments.reduce((s, p) => s + p.amount, 0);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Rent received, by the date it was paid. Payment records are permanent."
        actions={
          <ButtonLink href="/payments/new">
            <IconPlus className="size-4" /> Record payment
          </ButtonLink>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
          <Link href={`/payments?month=${addMonths(month, -1)}`} className="btn btn-ghost btn-sm" aria-label="Previous month">
            <IconArrowLeft className="size-4" />
          </Link>
          <span className="min-w-28 px-2 text-center text-sm font-semibold text-slate-900">{formatMonth(month)}</span>
          <Link
            href={`/payments?month=${addMonths(month, 1)}`}
            className="btn btn-ghost btn-sm"
            aria-label="Next month"
            aria-disabled={month >= current}
          >
            <IconArrowLeft className="size-4 rotate-180" />
          </Link>
        </div>
        <p className="text-sm text-slate-600">
          Total received: <span className="font-semibold text-slate-900 tabular-nums">{formatMoney(total)}</span>
        </p>
      </div>
      <div className="card overflow-hidden">
        {payments.length === 0 ? (
          <EmptyState icon={<IconWallet />} title={`No payments in ${formatMonth(month)}`} />
        ) : (
          <Table>
            <THead>
              <Th>Paid on</Th>
              <Th>Property / tenant</Th>
              <Th>For month</Th>
              <Th>Method</Th>
              <Th className="text-right">Amount</Th>
            </THead>
            <TBody>
              {payments.map((p) => {
                const l = rentalById.get(toId(p.rental));
                return (
                  <tr key={toId(p._id)} className="hover:bg-slate-50/60">
                    <Td className="whitespace-nowrap">{formatDate(p.paidOn)}</Td>
                    <Td>
                      {l ? (
                        <Link href={`/rentals/${l.id}`} className="block">
                          <span className="font-medium text-slate-900 hover:text-brand-700">{l.propertyName}</span>
                          <span className="block text-xs text-slate-500">{l.tenantName}</span>
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{formatMonth(p.forMonth)}</Td>
                    <Td>{p.method === "upi" ? "UPI" : titleCase(p.method)}</Td>
                    <Td className="text-right font-medium tabular-nums">{formatMoney(p.amount)}</Td>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
