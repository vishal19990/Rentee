/**
 * PDF writers for the tenant ledger and the FY summary (F6), via pdf-lib (pure JS, no native
 * deps). Uses the standard Helvetica fonts, which only cover WinAnsi (Latin-1 + a few
 * symbols): "₹" is written as "Rs." and other unsupported characters become "?".
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { titleCase } from "./format";
import { formatMoney } from "./money";
import { formatMonth } from "./rent";
import { MONTH_STATUS_LABELS, type FySummary, type TenantLedger } from "./reports";

/** Characters Helvetica (WinAnsiEncoding) can draw beyond printable ASCII and Latin-1. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** Makes text drawable with the standard fonts: ₹ -> "Rs.", unsupported characters -> "?". */
export function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text.replace(/₹\s?/g, "Rs.").replace(/[   ]/g, " ").replace(/[\r\n\t]+/g, " ")) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch)) {
      out += ch;
      continue;
    }
    // Try dropping accents (é -> e) before giving up.
    const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    out += base && [...base].every((b) => b.codePointAt(0)! >= 0x20 && b.codePointAt(0)! <= 0x7e) ? base : "?";
  }
  return out;
}

export const pdfMoney = (minor: number) => pdfSafe(formatMoney(minor));

type Align = "left" | "right";
export type PdfColumn = { header: string; width: number; align?: Align };
export type PdfRow = { cells: string[]; bold?: boolean; shade?: boolean };

const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.8, 0.84, 0.88);
const HEAD_BG = rgb(0.89, 0.91, 0.94);
const SHADE_BG = rgb(0.97, 0.98, 0.99);

/** A tiny flowing-layout writer: headings, text lines, key/value lines and paged tables. */
class Writer {
  doc!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;
  readonly margin = 40;

  constructor(
    private readonly size: [number, number],
    private readonly footer: string,
  ) {}

  async init() {
    this.doc = await PDFDocument.create();
    this.doc.setProducer("Rentee");
    this.doc.setCreator("Rentee");
    this.font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.newPage();
    return this;
  }

  get width() {
    return this.size[0] - this.margin * 2;
  }

  newPage() {
    this.page = this.doc.addPage(this.size);
    this.y = this.size[1] - this.margin;
  }

  ensure(h: number) {
    if (this.y - h < this.margin + 18) this.newPage();
  }

  /** Text clipped (with "...") to fit `maxWidth`. */
  fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
    let t = pdfSafe(text);
    if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxWidth) t = t.slice(0, -1);
    return `${t}...`;
  }

  text(s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
    const size = opts.size ?? 10;
    this.ensure(size + 4);
    this.page.drawText(this.fit(s, opts.bold ? this.bold : this.font, size, this.width), {
      x: this.margin,
      y: this.y - size,
      size,
      font: opts.bold ? this.bold : this.font,
      color: opts.color ?? INK,
    });
    this.y -= size + (opts.gap ?? 5);
  }

  space(h: number) {
    this.y -= h;
  }

  heading(s: string) {
    this.ensure(40);
    this.space(6);
    this.text(s, { size: 12, bold: true, gap: 8 });
  }

  /** "Label: value" pairs laid out in columns. */
  facts(items: [string, string][], perRow = 3) {
    const colW = this.width / perRow;
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(28);
      items.slice(i, i + perRow).forEach(([label, value], j) => {
        const x = this.margin + j * colW;
        this.page.drawText(this.fit(label, this.font, 8, colW - 8), { x, y: this.y - 8, size: 8, font: this.font, color: MUTED });
        this.page.drawText(this.fit(value, this.bold, 11, colW - 8), { x, y: this.y - 22, size: 11, font: this.bold, color: INK });
      });
      this.y -= 32;
    }
  }

  table(cols: PdfColumn[], rows: PdfRow[], empty = "Nothing recorded.") {
    const total = cols.reduce((s, c) => s + c.width, 0);
    const scale = this.width / total;
    const widths = cols.map((c) => c.width * scale);
    const rowH = 16;
    const size = 8.5;
    const pad = 4;

    const drawRow = (cells: string[], font: PDFFont, bg?: ReturnType<typeof rgb>) => {
      if (bg) this.page.drawRectangle({ x: this.margin, y: this.y - rowH, width: this.width, height: rowH, color: bg });
      let x = this.margin;
      cells.forEach((cell, i) => {
        const w = widths[i];
        const t = this.fit(cell ?? "", font, size, w - pad * 2);
        const tw = font.widthOfTextAtSize(t, size);
        const tx = cols[i].align === "right" ? x + w - pad - tw : x + pad;
        this.page.drawText(t, { x: tx, y: this.y - rowH + 5, size, font, color: INK });
        x += w;
      });
      this.page.drawLine({
        start: { x: this.margin, y: this.y - rowH },
        end: { x: this.margin + this.width, y: this.y - rowH },
        thickness: 0.5,
        color: LINE,
      });
      this.y -= rowH;
    };
    const header = () => drawRow(cols.map((c) => c.header), this.bold, HEAD_BG);

    this.ensure(rowH * 3);
    header();
    if (rows.length === 0) {
      this.ensure(rowH);
      drawRow([empty, ...cols.slice(1).map(() => "")], this.font);
    }
    for (const r of rows) {
      if (this.y - rowH < this.margin + 18) {
        this.newPage();
        header();
      }
      drawRow(r.cells, r.bold ? this.bold : this.font, r.shade ? SHADE_BG : undefined);
    }
    this.space(10);
  }

  async finish(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const label = pdfSafe(`${this.footer} · Page ${i + 1} of ${pages.length}`);
      p.drawText(label, { x: this.margin, y: this.margin - 16, size: 7.5, font: this.font, color: MUTED });
    });
    return this.doc.save();
  }
}

const A4_PORTRAIT: [number, number] = [595.28, 841.89];
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];

export type LedgerPdfHeading = { tenantName: string; propertyName: string; stay: string; generatedOn: string };

export async function ledgerPdf(h: LedgerPdfHeading, ledger: TenantLedger): Promise<Uint8Array> {
  const w = await new Writer(A4_LANDSCAPE, `Rentee · Tenant ledger · ${h.tenantName} · generated ${h.generatedOn}`).init();
  w.doc.setTitle(pdfSafe(`Tenant ledger — ${h.tenantName}`));
  w.text("Tenant ledger", { size: 18, bold: true, gap: 6 });
  w.text(`${h.tenantName} · ${h.propertyName}`, { size: 11, gap: 3 });
  w.text(h.stay, { size: 9, color: MUTED, gap: 14 });

  const t = ledger.totals;
  w.facts(
    [
      ["Total due (rent + charges)", pdfMoney(t.due)],
      ["Total paid", pdfMoney(t.paid)],
      [t.outstanding < 0 ? "Paid in advance" : "Outstanding", pdfMoney(Math.abs(t.outstanding))],
      ["Rent", pdfMoney(t.rent)],
      ["Charges", pdfMoney(t.charges)],
      ["Deposit held", pdfMoney(ledger.depositHeld)],
    ],
    3,
  );

  w.heading("Month by month");
  w.table(
    [
      { header: "Month", width: 62 },
      { header: "Due date", width: 62 },
      { header: "Rent", width: 72, align: "right" },
      { header: "Charges", width: 130 },
      { header: "Due", width: 72, align: "right" },
      { header: "Paid", width: 72, align: "right" },
      { header: "Balance", width: 72, align: "right" },
      { header: "Status", width: 54 },
      { header: "Outstanding", width: 80, align: "right" },
    ],
    [
      ...ledger.months.map((m, i) => ({
        shade: i % 2 === 1,
        cells: [
          formatMonth(m.month),
          m.dueDate,
          pdfMoney(m.rent),
          m.chargeItems.length ? m.chargeItems.map((c) => `${c.label} ${pdfMoney(c.amount)}`).join(", ") : "-",
          pdfMoney(m.due),
          pdfMoney(m.paid),
          pdfMoney(m.balance),
          MONTH_STATUS_LABELS[m.status],
          pdfMoney(m.outstanding),
        ],
      })),
      { bold: true, cells: ["Total", "", pdfMoney(t.rent), pdfMoney(t.charges), pdfMoney(t.due), pdfMoney(t.paid), "", "", pdfMoney(t.outstanding)] },
    ],
    "No rent months yet.",
  );

  w.heading("Payments");
  w.table(
    [
      { header: "Paid on", width: 70 },
      { header: "For month", width: 70 },
      { header: "Amount", width: 80, align: "right" },
      { header: "Method", width: 80 },
      { header: "Note", width: 250 },
    ],
    ledger.payments.map((p, i) => ({
      shade: i % 2 === 1,
      cells: [p.paidOn, formatMonth(p.forMonth), pdfMoney(p.amount), titleCase(p.method), p.note],
    })),
    "No payments recorded.",
  );

  w.heading("Security deposit");
  w.table(
    [
      { header: "Date", width: 70 },
      { header: "Entry", width: 70 },
      { header: "Amount", width: 80, align: "right" },
      { header: "Reason", width: 250 },
      { header: "Held after", width: 80, align: "right" },
    ],
    ledger.deposit.map((d, i) => ({
      shade: i % 2 === 1,
      cells: [d.date, d.label, `${d.kind === "received" ? "+" : "-"}${pdfMoney(d.amount)}`, d.reason, pdfMoney(d.held)],
    })),
    "No deposit entries.",
  );
  return w.finish();
}

export async function fySummaryPdf(s: FySummary, generatedOn: string): Promise<Uint8Array> {
  const w = await new Writer(A4_PORTRAIT, `Rentee · FY ${s.fy} summary · generated ${generatedOn}`).init();
  const y = Number(s.fy.slice(0, 4));
  w.doc.setTitle(pdfSafe(`Financial year summary ${s.fy}`));
  w.text(`Financial year ${s.fy} summary`, { size: 18, bold: true, gap: 6 });
  w.text(`1 Apr ${y} – 31 Mar ${y + 1}. Income is rent received, counted by payment date.`, { size: 9, color: MUTED, gap: 14 });

  w.facts([
    ["Total rent received (for ITR)", pdfMoney(s.rentReceived)],
    ["Expenses", pdfMoney(s.total.expenses)],
    ["Profit", pdfMoney(s.total.profit)],
  ]);
  w.text("Rent received includes utility charges collected together with rent.", { size: 8, color: MUTED, gap: 4 });

  w.heading("By property");
  w.table(
    [
      { header: "Property", width: 200 },
      { header: "Income", width: 90, align: "right" },
      { header: "Expenses", width: 90, align: "right" },
      { header: "Profit", width: 90, align: "right" },
    ],
    [
      ...s.properties.map((p, i) => ({ shade: i % 2 === 1, cells: [p.name, pdfMoney(p.income), pdfMoney(p.expenses), pdfMoney(p.profit)] })),
      { bold: true, cells: ["Total", pdfMoney(s.total.income), pdfMoney(s.total.expenses), pdfMoney(s.total.profit)] },
    ],
    `Nothing recorded in FY ${s.fy}.`,
  );

  w.heading("Expenses by category");
  w.table(
    [
      { header: "Property", width: 200 },
      { header: "Category", width: 150 },
      { header: "Amount", width: 120, align: "right" },
    ],
    [
      ...s.properties.flatMap((p) => p.expensesByCategory.map((c) => ({ cells: [p.name, c.label, pdfMoney(c.amount)] }))),
      ...s.expensesByCategory.map((c, i) => ({ bold: true, shade: true, cells: [i === 0 ? "All properties" : "", c.label, pdfMoney(c.amount)] })),
    ],
    "No expenses recorded.",
  );

  w.heading("By month");
  w.table(
    [
      { header: "Month", width: 120 },
      { header: "Income", width: 110, align: "right" },
      { header: "Expenses", width: 110, align: "right" },
      { header: "Profit", width: 110, align: "right" },
    ],
    [
      ...s.months.map((m, i) => ({
        shade: i % 2 === 1,
        cells: [formatMonth(m.month), pdfMoney(m.income), pdfMoney(m.expenses), pdfMoney(m.profit)],
      })),
      { bold: true, cells: ["Total", pdfMoney(s.total.income), pdfMoney(s.total.expenses), pdfMoney(s.total.profit)] },
    ],
  );
  return w.finish();
}
