import * as QRCode from 'qrcode';

// One truck-body label: 70 × 30 mm card with the task's QR on the left and the Ankaa
// logo + phone + site on the right. Mirror of web/src/components/production/task/labels/task-label-card.ts
// (the web previews the sheet, this side prints it) — keep both identical. Both port the Desktop
// prototype (cartao-ankaa-30x70/build.js) that was printed and cut on the ScanNCut.
//
// Everything is in millimetres (SVG user units = mm).

export const LABEL_WIDTH = 70;
export const LABEL_HEIGHT = 30;
const CORNER = 3;
const QR_SIZE = 23.5;
const QR_Y = (LABEL_HEIGHT - QR_SIZE) / 2; // same margin above and below the QR (and left of it)
const QR_X = QR_Y;

const INK = '#111111';
const GREEN = '#198A42'; // icons: a shade under the logo green so they read on photo paper
const RULE = '#D1D5DB';
const FONT = 'Manrope, Helvetica, Arial, sans-serif';

/** Public page each label points to. */
export const LABEL_SITE_URL = 'https://www.ankaadesign.com.br';
export const taskLabelUrl = (taskId: string) => `${LABEL_SITE_URL}/trabalhos/${taskId}`;

// Ankaa star (site brand/star.svg), drawn in the QR's centre hole. Bbox ≈ 10.7..1244 × 81.6..1172.
const STAR_D =
  'M235.06,1167.74C242.94,1162.43 249.29,1148.17 269.48,1090.50C308.56,978.88 325.69,935.35 350.55,884.50C362.92,859.19 364.25,857.60 370.50,860.76C372.15,861.59 394.43,876.30 420.00,893.44C522.26,961.96 573.00,993.28 640.50,1029.50C717.41,1070.78 832.80,1120.00 852.66,1120.00C861.66,1120.00 866.84,1114.10 865.53,1105.34C863.94,1094.73 858.11,1086.31 819.81,1039.33C785.11,996.75 770.72,978.62 750.98,952.56C669.67,845.25 622.23,765.52 580.65,666.31C567.38,634.64 565.88,628.00 570.07,619.35C575.01,609.15 620.09,570.83 664.04,539.48C696.65,516.22 735.80,491.23 772.50,470.24C853.00,424.22 935.54,389.57 1034.00,360.48C1066.76,350.80 1132.83,334.36 1176.50,325.01C1233.97,312.72 1236.00,312.09 1240.72,305.09C1243.53,300.92 1243.60,297.50 1240.97,293.18C1236.51,285.87 1226.08,283.67 1181.00,280.54C1097.38,274.74 997.93,276.42 914.00,285.05C876.72,288.88 854.80,291.86 814.50,298.57C752.48,308.89 659.81,328.40 598.00,344.15C565.48,352.44 540.30,358.12 535.29,358.31C526.89,358.62 526.45,357.73 526.73,340.70C527.30,305.92 539.06,229.95 555.07,157.61C565.32,111.30 565.93,100.54 558.76,92.38C549.70,82.06 535.49,81.64 522.37,91.32C508.33,101.67 452.68,161.80 414.38,208.00C352.63,282.49 311.77,342.67 280.11,405.77C272.83,420.28 269.72,422.69 244.99,432.99C188.79,456.39 130.69,485.02 76.00,516.26C32.35,541.20 17.20,551.77 12.83,560.33C10.06,565.76 10.73,574.48 14.32,579.90C23.47,593.73 58.65,623.23 138.50,684.00C177.68,713.82 194.42,727.42 195.88,730.64C197.24,733.62 197.27,741.93 195.97,752.00C193.88,768.10 190.01,809.67 188.43,833.00C186.17,866.27 186.90,936.56 189.89,975.00C195.43,1046.19 207.03,1126.23 216.03,1155.37C219.98,1168.16 227.34,1172.94 235.06,1167.74Z';
const STAR_BOX = { x: 10.7, y: 81.6, w: 1233.5, h: 1090.5 };

// Right block, measured from the printed prototype: the logo's star tip sits on the QR's top
// edge and the site baseline on its bottom edge; the site line spans exactly the logo width.
const DIVIDER_X = QR_X + QR_SIZE + 2.6;
const RIGHT_X0 = DIVIDER_X + 2.6;
const RIGHT_X1 = LABEL_WIDTH - QR_X;
const LOGO_W = RIGHT_X1 - RIGHT_X0;
const LOGO_H = (LOGO_W * 379) / 875; // logo.png is 875 × 379
const LOGO_Y = QR_Y - (2 * LOGO_W) / 875; // first opaque row of the png is the star tip (y = 2px)
const SITE_BASE = QR_Y + QR_SIZE;
const TEL_BASE = SITE_BASE - 4.1;
const TEXT_SIZE = 2.5;
const ICON_SIZE = TEXT_SIZE * 1.12;
const TEXT_X = RIGHT_X0 + ICON_SIZE + 0.8;

const f = (v: number) => v.toFixed(3);

/**
 * QR modules as one path: square modules with softly rounded OUTER corners (a corner rounds
 * only when both neighbours touching it are light) and a cleared centre for the star.
 * The scheme+host go in alphanumeric mode (uppercase) and the case-sensitive path in byte
 * mode — the smallest symbol for this URL. Level H absorbs the star hole.
 */
function qrMarkup(taskId: string): string {
  const qr = QRCode.create(
    [
      { data: `${LABEL_SITE_URL.toUpperCase()}/`, mode: 'alphanumeric' },
      { data: new TextEncoder().encode(`trabalhos/${taskId}`), mode: 'byte' },
    ],
    { errorCorrectionLevel: 'H' },
  );
  const n = qr.modules.size;
  const m = QR_SIZE / n;
  const c = (n - 1) / 2;
  // 11 × 11 modules cleared for the star: ~3 of each block's 13 correctable codewords (version 8-H,
  // 6 blocks), leaving ~10 a block for dirt and wear on a truck body. Read clean by jsQR and ZXing
  // from 120 to 200 dpi with blur and JPEG; a bigger hole shows more star but eats that margin.
  const hole = 5;
  const inHole = (x: number, y: number) => {
    const dx = Math.abs(x - c);
    const dy = Math.abs(y - c);
    return dx <= hole && dy <= hole && !(dx === hole && dy === hole);
  };
  const dark = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < n && y < n && !!qr.modules.get(y, x) && !inHole(x, y);

  const r = m * 0.32;
  const e = 0.006; // tiny overlap so print shows no hairlines between joined modules
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!dark(x, y)) continue;
      const up = dark(x, y - 1),
        dn = dark(x, y + 1),
        lf = dark(x - 1, y),
        rt = dark(x + 1, y);
      const tl = !up && !lf ? r : 0,
        tr = !up && !rt ? r : 0,
        br = !dn && !rt ? r : 0,
        bl = !dn && !lf ? r : 0;
      const x0 = QR_X + x * m - e,
        y0 = QR_Y + y * m - e,
        x1 = QR_X + (x + 1) * m + e,
        y1 = QR_Y + (y + 1) * m + e;
      d +=
        `M${f(x0 + tl)} ${f(y0)}H${f(x1 - tr)}` +
        (tr ? `Q${f(x1)} ${f(y0)} ${f(x1)} ${f(y0 + tr)}` : '') +
        `V${f(y1 - br)}` +
        (br ? `Q${f(x1)} ${f(y1)} ${f(x1 - br)} ${f(y1)}` : '') +
        `H${f(x0 + bl)}` +
        (bl ? `Q${f(x0)} ${f(y1)} ${f(x0)} ${f(y1 - bl)}` : '') +
        `V${f(y0 + tl)}` +
        (tl ? `Q${f(x0)} ${f(y0)} ${f(x0 + tl)} ${f(y0)}` : '') +
        'Z';
    }
  }

  const starW = (2 * hole + 1) * m * 0.92;
  const sc = starW / STAR_BOX.w;
  const cx = QR_X + (c + 0.5) * m;
  const cy = QR_Y + (c + 0.5) * m;
  const starX = cx - starW / 2 - STAR_BOX.x * sc;
  const starY = cy - (STAR_BOX.h * sc) / 2 - STAR_BOX.y * sc;

  return (
    `<path d="${d}" fill="${INK}"/>` +
    `<path d="${STAR_D}" fill="${INK}" transform="translate(${f(starX)} ${f(starY)}) scale(${sc.toFixed(5)})"/>`
  );
}

const whatsappIcon = (fill: string) =>
  `<path fill="${fill}" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/>`;
const globeIcon = (stroke: string) =>
  `<g fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></g>`;

/** Places a 24-unit icon so its centre sits on the x-height of the text line ending at `base`. */
const iconAt = (base: number, body: string) => {
  const cy = base - TEXT_SIZE * 0.36;
  return `<g transform="translate(${f(RIGHT_X0)} ${f(cy - ICON_SIZE / 2)}) scale(${(ICON_SIZE / 24).toFixed(5)})">${body}</g>`;
};

/**
 * The card's inner markup in its own 70 × 30 coordinate space (no outer <svg>), ready to be
 * placed on a sheet. `idPrefix` keeps clip-path ids unique per copy.
 */
export function taskLabelCardMarkup(taskId: string, logoHref: string, idPrefix: string): string {
  const clip = `${idPrefix}-clip`;
  return (
    `<defs><clipPath id="${clip}"><rect width="${LABEL_WIDTH}" height="${LABEL_HEIGHT}" rx="${CORNER}"/></clipPath></defs>` +
    `<g clip-path="url(#${clip})">` +
    `<rect width="${LABEL_WIDTH}" height="${LABEL_HEIGHT}" fill="#FFFFFF"/>` +
    qrMarkup(taskId) +
    `<line x1="${f(DIVIDER_X)}" y1="${f(QR_Y + 2)}" x2="${f(DIVIDER_X)}" y2="${f(QR_Y + QR_SIZE - 2)}" stroke="${RULE}" stroke-width="0.18" stroke-linecap="round"/>` +
    `<image x="${f(RIGHT_X0)}" y="${f(LOGO_Y)}" width="${f(LOGO_W)}" height="${f(LOGO_H)}" href="${logoHref}"/>` +
    `<g font-family="${FONT}" font-weight="700" fill="${INK}" font-size="${TEXT_SIZE}">` +
    iconAt(TEL_BASE, whatsappIcon(GREEN)) +
    `<text x="${f(TEXT_X)}" y="${f(TEL_BASE)}">(43) 98428-3228</text>` +
    iconAt(SITE_BASE, globeIcon(GREEN)) +
    // textLength pins the site line to the logo width whatever font the printer's browser resolves
    `<text x="${f(TEXT_X)}" y="${f(SITE_BASE)}" textLength="${f(RIGHT_X1 - TEXT_X)}" lengthAdjust="spacingAndGlyphs">www.ankaadesign.com.br</text>` +
    `</g></g>`
  );
}
