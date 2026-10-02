import { LABEL_HEIGHT, LABEL_WIDTH, taskLabelCardMarkup } from './task-label-card';

// A4 sheet of truck-body labels, printed on photo paper and cut on the ScanNCut with Direct Cut.
// Mirror of web/src/components/production/task/labels/task-label-sheet.ts — the web draws the
// preview, this side draws what actually reaches the printer. Keep both layouts identical.
//
// Layout: 5 columns × 4 rows of STANDING cards = 20 slots (10 trucks, one label per side). Each
// 70 × 30 card is turned 90° clockwise (QR on top), so a slot is 30 wide × 70 tall.
// - Height is the tight side: 4 × 70 + 3 × 3.5 = 290.5 mm leaves 3.25 mm top and bottom — just
//   inside the printer's 3 mm unprintable border. A bigger row gap would clip the first and last
//   rows, and borderless mode would rescale the page and break the millimetres the ScanNCut cuts by.
// - Width has 60 mm to spare, spread EVENLY: the same 10 mm left of the first column, between the
//   columns and right of the last.
// The caption (task name + serial/plate) runs down the 10 mm gap LEFT of each card, centred on the
// card's height, in the light guide grey, and falls away with the scrap after the cut.
// Each card carries a 0.2 mm black ring just OUTSIDE its edge: the scanner traces the ring, and
// its inner contour is exactly the card edge, so the cut leaves no black on the card.
//
// FEED ORIENTATION (checked on paper, 02/10/2026): the L3250 takes the sheet standing in the rear
// tray, printable side facing the front, and prints the page's FIRST raster line on the edge that
// goes in first — the bottom edge as the sheet stands. Sent as drawn, the sheet came out upside down
// relative to how it sits in the tray. So the page is turned 180° before printing (`feedRotated`):
// looking at the sheet in the tray, everything reads upright, the preview matches it, and "▲ TOPO"
// marks the edge that stays UP in the tray.

export const SHEET_WIDTH = 210;
export const SHEET_HEIGHT = 297;
/** Between rows: as much as the page height allows. */
export const ROW_GAP = 3.5;
export const CUT_RING = 0.2;
const COLUMNS = 5;
const ROWS = 4;
/** A standing card: the 70 × 30 card turned 90° clockwise. */
export const SLOT_WIDTH = LABEL_HEIGHT;
export const SLOT_HEIGHT = LABEL_WIDTH;

// Ink for everything printed OUTSIDE the cards (caption + "TOPO"): a light grey that still reads up
// close but stays under the contrast the ScanNCut's Direct Cut traces, so it never offers them as
// shapes to cut — only the black rings are picked up.
export const GUIDE_INK = '#BCC1C8';

export const CAPTION_SIZE = 2.6;
const CAPTION_MAX_CHARS = 48; // ~58 mm of Manrope 700 at 2.6 mm (≈1.2 mm a character): within the card height

export interface LabelSlot {
  index: number;
  /** Top-left of the card on the sheet (mm). */
  x: number;
  y: number;
}

/** Between columns, and the side margins: the spare width split evenly. */
export const COLUMN_GAP = (SHEET_WIDTH - COLUMNS * SLOT_WIDTH) / (COLUMNS + 1);

function buildSlots(): LabelSlot[] {
  const blockH = ROWS * SLOT_HEIGHT + (ROWS - 1) * ROW_GAP;
  const top = (SHEET_HEIGHT - blockH) / 2;
  const slots: LabelSlot[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLUMNS; c++) {
      slots.push({
        index: slots.length,
        x: COLUMN_GAP + c * (SLOT_WIDTH + COLUMN_GAP),
        y: top + r * (SLOT_HEIGHT + ROW_GAP),
      });
    }
  }
  return slots;
}

export const LABEL_SLOTS: readonly LabelSlot[] = buildSlots();

export interface PlacedLabel {
  slot: number;
  taskId: string;
  /** Printed in the gap left of the card, outside the cut: e.g. "TJB Transporte · 38887". */
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
  return `<rect x="${slot.x - o}" y="${slot.y - o}" width="${SLOT_WIDTH + CUT_RING}" height="${SLOT_HEIGHT + CUT_RING}" rx="${3 + o}" fill="none" stroke="#000" stroke-width="${CUT_RING}"/>`;
}

/** Where a slot's caption is centred: in the middle of the gap left of the card, at mid-height. */
export function captionAnchor(slot: LabelSlot): { x: number; y: number } {
  return { x: slot.x - COLUMN_GAP / 2, y: slot.y + SLOT_HEIGHT / 2 };
}

function caption(slot: LabelSlot, text: string): string {
  const { x, y } = captionAnchor(slot);
  // runs DOWN the gap (the turned card's own reading direction), centred both ways
  return `<text transform="translate(${x} ${y}) rotate(90)" text-anchor="middle" dominant-baseline="central" font-family="Manrope, Helvetica, Arial, sans-serif" font-weight="700" font-size="${CAPTION_SIZE}" fill="${GUIDE_INK}">${escapeXml(text)}</text>`;
}

/**
 * Orientation mark for a fresh sheet: a small grey arrowhead in each side margin, level with the
 * first row and pointing UP — the edge that stays up when the sheet stands in the printer's rear
 * tray (see FEED ORIENTATION above). The sheet goes back in the same way and the next print lands on
 * the free slots. Grey, small and clear of the captions (those sit at mid-height), so the ScanNCut's
 * Direct Cut doesn't take it for a shape.
 */
export function orientationMarkSvg(): string {
  const first = LABEL_SLOTS[0];
  const margin = first.x; // the side margin's width
  // small enough to stay inside the 3 mm unprintable border of a 10 mm margin
  const width = 3;
  const height = 2.6;
  const f = (v: number) => v.toFixed(2);
  const arrow = (cx: number) =>
    `<path d="M${f(cx)} ${f(first.y)}L${f(cx + width / 2)} ${f(first.y + height)}H${f(cx - width / 2)}Z" fill="${GUIDE_INK}"/>`;
  return arrow(margin / 2) + arrow(SHEET_WIDTH - margin / 2);
}

/**
 * Full A4 sheet as an SVG string (mm units). Empty slots stay blank — the paper may already be used
 * there. `orientationMark` is set on the first print of a fresh sheet; `feedRotated` turns the page
 * 180° for the printer (see FEED ORIENTATION above) — only the copy sent to the printer uses it.
 */
export function taskLabelSheetSvg(
  labels: PlacedLabel[],
  logoHref: string,
  options: { orientationMark?: boolean; feedRotated?: boolean } = {},
): string {
  const body = labels
    .map(({ slot, taskId, caption: text }) => {
      const s = LABEL_SLOTS[slot];
      if (!s) return '';
      return (
        // turned 90° clockwise about the slot: the card's top edge becomes its right side, QR on top
        `<g transform="translate(${s.x + SLOT_WIDTH} ${s.y}) rotate(90)">${taskLabelCardMarkup(taskId, logoHref, `s${s.index}`)}</g>` +
        cutRing(s) +
        caption(s, text)
      );
    })
    .join('');
  const mark = options.orientationMark ? orientationMarkSvg() : '';
  const turn = options.feedRotated
    ? ` transform="rotate(180 ${SHEET_WIDTH / 2} ${SHEET_HEIGHT / 2})"`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH}mm" height="${SHEET_HEIGHT}mm" viewBox="0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}"><g${turn}>${mark}${body}</g></svg>`;
}

/** Standalone A4 page around the sheet — exactly one page (the overflow guard stops a rounding spill). */
export function taskLabelSheetHtml(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@700&display=block" rel="stylesheet">
<style>@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff;width:210mm;height:297mm;overflow:hidden}svg{display:block}</style>
</head><body>${svg}</body></html>`;
}
