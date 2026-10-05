/**
 * Amounts in words, Indian numbering system (thousand, lakh, crore), as printed on receipts:
 * 1,25,000 -> "Rupees One Lakh Twenty-Five Thousand Only".
 */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u ? `${TENS[t]}-${ONES[u]}` : TENS[t];
}

/** A non-negative integer in words, Indian system ("One Crore Two Lakh Three Thousand Four Hundred Five"). */
export function numberToIndianWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Not a non-negative integer: ${n}`);
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  let rest = n % 10_000_000;
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  const hundred = Math.floor(rest / 100);
  rest %= 100;
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(belowHundred(rest));
  return parts.join(" ");
}

/**
 * Amount in minor units (paise) in words: 12500000 -> "Rupees One Lakh Twenty-Five Thousand Only",
 * 150050 -> "Rupees One Thousand Five Hundred and Fifty Paise Only".
 */
export function amountInWords(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error(`Invalid amount: ${minor}`);
  const rupees = Math.floor(minor / 100);
  const paise = minor % 100;
  const main = `Rupees ${numberToIndianWords(rupees)}`;
  return paise ? `${main} and ${belowHundred(paise)} Paise Only` : `${main} Only`;
}
