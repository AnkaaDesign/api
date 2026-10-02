import { LABEL_HEIGHT, LABEL_WIDTH, taskLabelCardMarkup } from './task-label-card';

// A4 sheet of truck-body labels, printed on photo paper and cut on the ScanNCut with Direct Cut.
// Mirror of web/src/components/production/task/labels/task-label-sheet.ts — the web draws the
// preview, this side draws what actually reaches the printer. Keep both layouts identical.
//
// Layout: 2 columns × 8 rows of lying cards = 16 slots (8 trucks, one label per side).
// Columns are spread evenly — the same space left of the first card, between them and right of
// the second (~23.3 mm). Rows are 6 mm apart: each card's caption (task name + serial/plate) is
// printed in that gap, just above the card, and falls away with the scrap after the cut.
// Each card carries a 0.5 mm black ring just OUTSIDE its edge: the scanner traces the ring, and
// its inner contour is exactly the card edge, so the cut leaves no black on the card.

export const SHEET_WIDTH = 210;
export const SHEET_HEIGHT = 297;
export const ROW_GAP = 6;
export const CUT_RING = 0.5;
const COLUMNS = 2;
const ROWS = 8;

export const CAPTION_SIZE = 3;
// above the card edge: descenders clear the cut ring (~0.6 mm) and caps clear the card above (~1.4 mm)
export const CAPTION_BASELINE = 1.9;
const CAPTION_MAX_CHARS = 46; // ~65 mm of Manrope 700 at 3 mm (≈1.4 mm a character)

export interface LabelSlot {
  index: number;
  /** Top-left of the card on the sheet (mm). */
  x: number;
  y: number;
}

function buildSlots(): LabelSlot[] {
  const columnGap = (SHEET_WIDTH - COLUMNS * LABEL_WIDTH) / (COLUMNS + 1);
  const blockH = ROWS * LABEL_HEIGHT + (ROWS - 1) * ROW_GAP;
  const top = (SHEET_HEIGHT - blockH) / 2;
  const slots: LabelSlot[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLUMNS; c++) {
      slots.push({
        index: slots.length,
        x: columnGap + c * (LABEL_WIDTH + columnGap),
        y: top + r * (LABEL_HEIGHT + ROW_GAP),
      });
    }
  }
  return slots;
}

export const LABEL_SLOTS: readonly LabelSlot[] = buildSlots();

export interface PlacedLabel {
  slot: number;
  taskId: string;
  /** Printed above the card, outside the cut: e.g. "TJB Transporte · 38887". */
  caption: string;
}

/** "Name · serial" (or plate), the name shortened so the line never runs past the card. */
export function taskLabelCaption(name: string, identifier: string | null | undefined): string {
  const id = identifier?.trim();
  const room = CAPTION_MAX_CHARS - (id ? id.length + 3 : 0);
  const shortName =
    name.length > room ? `${name.slice(0, Math.max(0, room - 1)).trimEnd()}…` : name;
  return id ? `${shortName} · ${id}` : shortName;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function cutRing(slot: LabelSlot): string {
  const o = CUT_RING / 2;
  return `<rect x="${slot.x - o}" y="${slot.y - o}" width="${LABEL_WIDTH + CUT_RING}" height="${LABEL_HEIGHT + CUT_RING}" rx="${3 + o}" fill="none" stroke="#000" stroke-width="${CUT_RING}"/>`;
}

function caption(slot: LabelSlot, text: string): string {
  return `<text x="${slot.x}" y="${slot.y - CAPTION_BASELINE}" font-family="Manrope, Helvetica, Arial, sans-serif" font-weight="700" font-size="${CAPTION_SIZE}" fill="#374151">${escapeXml(text)}</text>`;
}

/**
 * Orientation mark for a fresh sheet: a small grey "▲ TOPO" in BOTH top corners, on the leading edge
 * — the L3250 feeds from the rear tray and prints the first raster line on the edge that goes in
 * first, so the top of this page IS the edge that enters the printer. The sheet goes back in with
 * the mark leading, and the next print lands on the free slots. It sits right at the 3 mm printable
 * limit, far from the cards, and in grey, so the ScanNCut's Direct Cut doesn't take it for a shape.
 */
export function orientationMarkSvg(): string {
  const edge = 3.5; // just inside the printer's 3 mm unprintable border
  const size = 2.6; // triangle width and the text cap height
  const f = (v: number) => v.toFixed(2);
  const triangle = (x: number) =>
    `<path d="M${f(x + size / 2)} ${f(edge)}L${f(x + size)} ${f(edge + size)}H${f(x)}Z" fill="#9CA3AF"/>`;
  const label = (x: number, anchor: 'start' | 'end') =>
    `<text x="${f(x)}" y="${f(edge + size)}" font-family="Manrope, Helvetica, Arial, sans-serif" font-weight="700" font-size="3.4" fill="#9CA3AF" text-anchor="${anchor}">TOPO</text>`;
  return (
    triangle(edge) +
    label(edge + size + 1, 'start') +
    triangle(SHEET_WIDTH - edge - size) +
    label(SHEET_WIDTH - edge - size - 1, 'end')
  );
}

/**
 * Full A4 sheet as an SVG string (mm units). Empty slots stay blank — the paper may already be used
 * there. `orientationMark` is set on the first print of a fresh sheet.
 */
export function taskLabelSheetSvg(
  labels: PlacedLabel[],
  logoHref: string,
  options: { orientationMark?: boolean } = {},
): string {
  const body = labels
    .map(({ slot, taskId, caption: text }) => {
      const s = LABEL_SLOTS[slot];
      if (!s) return '';
      return (
        `<g transform="translate(${s.x} ${s.y})">${taskLabelCardMarkup(taskId, logoHref, `s${s.index}`)}</g>` +
        cutRing(s) +
        caption(s, text)
      );
    })
    .join('');
  const mark = options.orientationMark ? orientationMarkSvg() : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH}mm" height="${SHEET_HEIGHT}mm" viewBox="0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}">${mark}${body}</svg>`;
}

/** Standalone A4 page around the sheet — exactly one page (the overflow guard stops a rounding spill). */
export function taskLabelSheetHtml(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@700&display=block" rel="stylesheet">
<style>@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff;width:210mm;height:297mm;overflow:hidden}svg{display:block}</style>
</head><body>${svg}</body></html>`;
}
