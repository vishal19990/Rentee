/**
 * Unicode fonts for generated PDFs (pdf-lib + @pdf-lib/fontkit). The standard PDF fonts only
 * cover Latin-1, so "₹" and Indian-script names would not print. This embeds bundled Noto Sans
 * (Latin, "₹", and more) with Noto Sans Devanagari as a fallback, splitting text into runs by
 * which font has the glyph. Characters neither font covers print as "?".
 *
 * Fonts live in src/assets/fonts (SIL Open Font License, see OFL.txt there) and are read from
 * disk at runtime relative to the project root (process.cwd()), which is where `next start`,
 * `npm test` and Render run. Set PDF_FONTS_DIR to read them from elsewhere.
 *
 * Usage: const fonts = await embedAppFonts(doc); fonts.draw(page, "₹1,25,000", { x, y, size, bold });
 */
// @pdf-lib/fontkit's Indic (Devanagari) shaper expects a global regeneratorRuntime.
import "regenerator-runtime/runtime";
import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { rgb, type PDFDocument, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

type FontFile = { regular: string; bold: string };
const PRIMARY: FontFile = { regular: "NotoSans-Regular.ttf", bold: "NotoSans-Bold.ttf" };
const FALLBACKS: FontFile[] = [{ regular: "NotoSansDevanagari-Regular.ttf", bold: "NotoSansDevanagari-Bold.ttf" }];

type Coverage = { hasGlyphForCodePoint(cp: number): boolean };

const bytesCache = new Map<string, Uint8Array>();
const coverageCache = new Map<string, Coverage>();

export function fontsDir(): string {
  return process.env.PDF_FONTS_DIR || path.join(process.cwd(), "src", "assets", "fonts");
}

function fontBytes(file: string): Uint8Array {
  let b = bytesCache.get(file);
  if (!b) {
    b = new Uint8Array(readFileSync(path.join(fontsDir(), file)));
    bytesCache.set(file, b);
  }
  return b;
}

function coverage(file: string): Coverage {
  let c = coverageCache.get(file);
  if (!c) {
    c = fontkit.create(Buffer.from(fontBytes(file))) as unknown as Coverage;
    coverageCache.set(file, c);
  }
  return c;
}

/** Normalizes text for drawing: no line breaks/tabs, other control characters removed. */
export function cleanPdfText(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

export type DrawOptions = { x: number; y: number; size?: number; bold?: boolean; color?: RGB };

export type AppFonts = {
  regular: PDFFont;
  bold: PDFFont;
  /** Splits text into runs, each with a font that has its glyphs ("?" where none does). */
  runs(text: string, bold?: boolean): { text: string; font: PDFFont }[];
  widthOf(text: string, size: number, bold?: boolean): number;
  draw(page: PDFPage, text: string, o: DrawOptions): void;
};

/** Embeds the app's Unicode fonts (subset) into a document. */
export async function embedAppFonts(doc: PDFDocument): Promise<AppFonts> {
  doc.registerFontkit(fontkit);
  const files = [PRIMARY, ...FALLBACKS];
  const embedded = new Map<string, PDFFont>();
  const get = async (file: string) => {
    let f = embedded.get(file);
    if (!f) {
      f = await doc.embedFont(fontBytes(file), { subset: true });
      embedded.set(file, f);
    }
    return f;
  };
  // Primary fonts are always embedded; fallbacks too (subsetting keeps unused ones tiny).
  const fonts = new Map<string, PDFFont>();
  for (const ff of files) {
    fonts.set(ff.regular, await get(ff.regular));
    fonts.set(ff.bold, await get(ff.bold));
  }

  const runs = (text: string, bold = false) => {
    const out: { text: string; font: PDFFont }[] = [];
    let curFile: string | null = null;
    let buf = "";
    for (const ch of cleanPdfText(text)) {
      const cp = ch.codePointAt(0)!;
      let file = (bold ? PRIMARY.bold : PRIMARY.regular);
      let piece = ch;
      if (!coverage(PRIMARY.regular).hasGlyphForCodePoint(cp)) {
        const fb = FALLBACKS.find((f) => coverage(f.regular).hasGlyphForCodePoint(cp));
        // Joiners and combining marks stay with the current fallback run.
        if (fb) file = bold ? fb.bold : fb.regular;
        else if (cp === 0x200c || cp === 0x200d) file = curFile ?? file;
        else piece = "?";
      }
      if (file !== curFile && buf) {
        out.push({ text: buf, font: fonts.get(curFile!)! });
        buf = "";
      }
      curFile = file;
      buf += piece;
    }
    if (buf && curFile) out.push({ text: buf, font: fonts.get(curFile)! });
    return out;
  };

  const widthOf = (text: string, size: number, bold = false) =>
    runs(text, bold).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);

  const draw = (page: PDFPage, text: string, o: DrawOptions) => {
    const size = o.size ?? 10;
    let x = o.x;
    for (const r of runs(text, o.bold)) {
      page.drawText(r.text, { x, y: o.y, size, font: r.font, color: o.color ?? rgb(0, 0, 0) });
      x += r.font.widthOfTextAtSize(r.text, size);
    }
  };

  return { regular: fonts.get(PRIMARY.regular)!, bold: fonts.get(PRIMARY.bold)!, runs, widthOf, draw };
}
