/**
 * Color utility functions for converting between different color spaces
 */

/**
 * Convert hex color to RGB values
 * @param hex - Hex color string (with or without #)
 * @returns RGB values or null if invalid
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Remove # if present
  const cleanHex = hex.replace("#", "");

  // Validate hex string
  if (!/^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
    return null;
  }

  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  return { r, g, b };
}

/**
 * Convert RGB to XYZ color space (intermediate step for LAB)
 * @param r - Red value (0-255)
 * @param g - Green value (0-255)
 * @param b - Blue value (0-255)
 * @returns XYZ values
 */
function rgbToXyz(r: number, g: number, b: number): { x: number; y: number; z: number } {
  // Normalize RGB values to 0-1 range
  let rNorm = r / 255;
  let gNorm = g / 255;
  let bNorm = b / 255;

  // Apply gamma correction
  rNorm = rNorm > 0.04045 ? Math.pow((rNorm + 0.055) / 1.055, 2.4) : rNorm / 12.92;
  gNorm = gNorm > 0.04045 ? Math.pow((gNorm + 0.055) / 1.055, 2.4) : gNorm / 12.92;
  bNorm = bNorm > 0.04045 ? Math.pow((bNorm + 0.055) / 1.055, 2.4) : bNorm / 12.92;

  // Multiply by 100 to get proper scale
  rNorm *= 100;
  gNorm *= 100;
  bNorm *= 100;

  // Convert to XYZ using sRGB matrix
  const x = rNorm * 0.4124564 + gNorm * 0.3575761 + bNorm * 0.1804375;
  const y = rNorm * 0.2126729 + gNorm * 0.7151522 + bNorm * 0.072175;
  const z = rNorm * 0.0193339 + gNorm * 0.119192 + bNorm * 0.9503041;

  return { x, y, z };
}

/**
 * Convert XYZ to LAB color space
 * @param x - X value
 * @param y - Y value
 * @param z - Z value
 * @returns LAB values
 */
function xyzToLab(x: number, y: number, z: number): { l: number; a: number; b: number } {
  // D65 illuminant reference values
  const xRef = 95.047;
  const yRef = 100.0;
  const zRef = 108.883;

  // Normalize by reference values
  let xNorm = x / xRef;
  let yNorm = y / yRef;
  let zNorm = z / zRef;

  // Apply transformation
  const fx = xNorm > 0.008856 ? Math.pow(xNorm, 1 / 3) : 7.787 * xNorm + 16 / 116;
  const fy = yNorm > 0.008856 ? Math.pow(yNorm, 1 / 3) : 7.787 * yNorm + 16 / 116;
  const fz = zNorm > 0.008856 ? Math.pow(zNorm, 1 / 3) : 7.787 * zNorm + 16 / 116;

  // Calculate LAB values
  const l = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);

  return { l, a, b };
}

/**
 * Convert hex color to LAB color space
 * @param hex - Hex color string (with or without #)
 * @returns LAB values or null if invalid hex
 */
export function hexToLab(hex: string): { l: number; a: number; b: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const xyz = rgbToXyz(rgb.r, rgb.g, rgb.b);
  return xyzToLab(xyz.x, xyz.y, xyz.z);
}

/**
 * Convert RGB to hex color
 * @param r - Red value (0-255)
 * @param g - Green value (0-255)
 * @param b - Blue value (0-255)
 * @returns Hex color string with #
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const hex = Math.round(Math.max(0, Math.min(255, n))).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Calculate color difference using CIE76 formula
 * @param lab1 - First LAB color
 * @param lab2 - Second LAB color
 * @returns Delta E value (0 = identical, 100 = opposite)
 */
export function deltaE76(lab1: { l: number; a: number; b: number }, lab2: { l: number; a: number; b: number }): number {
  const deltaL = lab1.l - lab2.l;
  const deltaA = lab1.a - lab2.a;
  const deltaB = lab1.b - lab2.b;

  return Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB);
}

/**
 * Get perceived brightness of a color
 * @param hex - Hex color string
 * @returns Brightness value (0-255)
 */
export function getColorBrightness(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  // Using perceived brightness formula
  return Math.round((rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000);
}

/**
 * Determine if a color is light or dark
 * @param hex - Hex color string
 * @returns true if light, false if dark, null if invalid
 */
export function isLightColor(hex: string): boolean | null {
  const brightness = getColorBrightness(hex);
  if (brightness === null) return null;

  return brightness > 127;
}

/**
 * Format RGB values as a string
 * @param r - Red value (0-255)
 * @param g - Green value (0-255)
 * @param b - Blue value (0-255)
 * @returns RGB string format
 */
export function formatRgb(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Format LAB values as a string
 * @param l - Lightness value
 * @param a - A value (green-red)
 * @param b - B value (blue-yellow)
 * @returns LAB string format
 */
export function formatLab(l: number, a: number, b: number): string {
  return `lab(${l.toFixed(2)}, ${a.toFixed(2)}, ${b.toFixed(2)})`;
}
