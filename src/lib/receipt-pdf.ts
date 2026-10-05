/**
 * Rent receipt as a one-page A4 PDF (pdf-lib, pure JS). Text is drawn with the bundled Unicode
 * fonts (see pdf-fonts.ts), so "₹" and Devanagari names print correctly.
 */
import { PDFDocument, rgb } from "pdf-lib";
import { amountInWords } from "./amount-words";
import { chargeLabel } from "./charges";
import { formatDate } from "./format";
import { CURRENCY, formatMoney } from "./money";
import { embedAppFonts, type AppFonts } from "./pdf-fonts";
import type { ReceiptData } from "./receipts";
import { formatMonth } from "./rent";

const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.89, 0.91, 0.94);
const BRAND = rgb(0.31, 0.27, 0.9);
const ROSE = rgb(0.75, 0.1, 0.2);

function wrap(fonts: AppFonts, text: string, size: number, width: number, bold = false): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (fonts.widthOf(next, size, bold) <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderReceiptPdf(r: ReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Rent receipt ${r.receiptNo}`);
  doc.setCreator("Rentee");
  doc.setProducer("Rentee");
  const fonts = await embedAppFonts(doc);
  const page = doc.addPage([595.28, 841.89]);
  const { width } = page.getSize();
  const left = 56;
  const right = width - 56;
  const contentWidth = right - left;
  let y = 790;

  type O = { size?: number; bold?: boolean; color?: typeof INK };
  const text = (s: string, x: number, yy: number, o: O = {}) =>
    fonts.draw(page, s, { x, y: yy, size: o.size ?? 10, bold: o.bold, color: o.color ?? INK });
  const textRight = (s: string, yy: number, o: O = {}, edge = right) =>
    text(s, edge - fonts.widthOf(s, o.size ?? 10, o.bold), yy, o);
  const rule = (yy: number) => page.drawLine({ start: { x: left, y: yy }, end: { x: right, y: yy }, thickness: 0.8, color: LINE });

  // Header
  page.drawRectangle({ x: 0, y: 826, width, height: 16, color: BRAND });
  text("RENT RECEIPT", left, y, { size: 20, bold: true });
  textRight(`No. ${r.receiptNo}`, y + 4, { size: 11, bold: true });
  textRight(`Date: ${formatDate(r.paidOn)}`, y - 12, { color: MUTED });
  y -= 36;

  // Landlord
  const landlordName = r.landlord.name || "Landlord";
  text(landlordName, left, y, { size: 12, bold: true });
  y -= 15;
  for (const line of r.landlord.address ? wrap(fonts, r.landlord.address, 10, contentWidth / 1.6) : []) {
    text(line, left, y, { color: MUTED });
    y -= 13;
  }
  const contact = [r.landlord.phone && `Phone: ${r.landlord.phone}`, r.landlord.pan && `PAN: ${r.landlord.pan}`].filter(Boolean).join("   ");
  if (contact) {
    text(contact, left, y, { color: MUTED });
    y -= 13;
  }
  y -= 8;
  rule(y);
  y -= 24;

  // Statement
  const statement =
    `Received with thanks from ${r.tenantName} the sum of ${formatMoney(r.amount)} towards rent` +
    `${r.breakdown.chargeItems.length ? " and charges" : ""} for ${r.propertyName}` +
    `${r.propertyAddress ? `, ${r.propertyAddress}` : ""}, for the month of ${formatMonth(r.breakdown.month)}.`;
  for (const line of wrap(fonts, statement, 11, contentWidth)) {
    text(line, left, y, { size: 11 });
    y -= 16;
  }
  y -= 10;

  // Details
  const details: [string, string][] = [
    ["Tenant", r.tenantName],
    ["Property", r.propertyName],
    ["For month", formatMonth(r.breakdown.month)],
    ["Paid on", formatDate(r.paidOn)],
    ["Payment method", r.method],
  ];
  if (r.note) details.push(["Note", r.note]);
  for (const [k, v] of details) {
    text(k, left, y, { color: MUTED });
    const lines = wrap(fonts, v, 10, contentWidth - 130);
    lines.forEach((l, i) => text(l, left + 130, y - i * 13));
    y -= 13 * Math.max(lines.length, 1) + 5;
  }
  y -= 10;

  // Breakdown table
  text(`Breakdown for ${formatMonth(r.breakdown.month)}`, left, y, { bold: true, size: 11 });
  y -= 8;
  rule(y);
  y -= 16;
  const row = (label: string, value: string, o: O = {}) => {
    text(label, left, y, o);
    textRight(value, y, o);
    y -= 18;
  };
  row("Rent", formatMoney(r.breakdown.rent));
  for (const c of r.breakdown.chargeItems) row(chargeLabel(c.type), formatMoney(c.amount));
  rule(y + 10);
  row("Total due for the month", formatMoney(r.breakdown.monthDue), { bold: true });
  row("Paid towards the month (including this receipt)", formatMoney(r.breakdown.paidToDate));
  row("Balance for the month", formatMoney(r.breakdown.balanceAfter), { color: r.breakdown.balanceAfter > 0 ? ROSE : INK });
  y -= 6;

  // Amount box
  const words = CURRENCY === "INR" ? wrap(fonts, amountInWords(r.amount), 9.5, contentWidth - 24) : [];
  const boxH = 36 + words.length * 13;
  page.drawRectangle({ x: left, y: y - boxH + 14, width: contentWidth, height: boxH, color: rgb(0.95, 0.96, 0.99), borderColor: LINE, borderWidth: 0.8 });
  text("Amount received", left + 12, y - 4, { bold: true, size: 11 });
  textRight(formatMoney(r.amount), y - 4, { bold: true, size: 14 }, right - 12);
  words.forEach((w, i) => text(w, left + 12, y - 24 - i * 13, { size: 9.5, color: MUTED }));
  y -= boxH + 40;

  // Signature
  page.drawLine({ start: { x: right - 170, y }, end: { x: right, y }, thickness: 0.8, color: MUTED });
  textRight(`For ${landlordName}`, y - 14, { color: MUTED });

  text("This is a computer-generated receipt.", left, 56, { size: 8.5, color: MUTED });
  return doc.save();
}

/** "Receipt-RNT-2026-27-0001.pdf" */
export function receiptFileName(receiptNo: string): string {
  return `Receipt-${receiptNo.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
}
