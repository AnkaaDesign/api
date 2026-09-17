/**
 * Boleto barcode / linha digitável — reconstruction after a due-date change.
 *
 * The due date is not just a column on our side: it is **encoded inside the boleto
 * itself**, as the "fator de vencimento" in positions 6-9 of the 44-digit barcode.
 * Change the due date and forget these, and the record says one date while the line
 * the customer pays says another.
 *
 * That is exactly what happened: `PUT /invoices/:id/boleto/due-date` PATCHed Sicredi
 * and rewrote `BankSlip.dueDate` + `Installment.dueDate`, but `barcode` and
 * `digitableLine` were only ever written at CREATION. 18 of 321 slips ended up
 * carrying a stale factor — up to 41 days off — and two things then leak it to the
 * customer: the "copiar linha digitável" button, and `GET /boleto/pdf`, which uses
 * the stored `digitableLine` as the lookup key at Sicredi.
 *
 * Only the factor changes when a due date moves — bank, currency, amount and the free
 * field (cooperativa/posto/beneficiário/nossoNumero) all stay. So the new codes can be
 * derived locally, with no extra bank round-trip: swap the factor, recompute the
 * general check digit (módulo 11), and rebuild the linha digitável (módulo 10 per
 * field). Sicredi's `queryBoleto` does not return these fields, so deriving them is
 * also the only option that works.
 *
 * Both algorithms were validated against **all 323** production slips that carry a
 * barcode: the recomputed check digit and the rebuilt linha digitável match the
 * stored ones 323/323. `tests/boleto-barcode.test.ts` pins that.
 *
 * Layout of the 44-digit barcode (1-indexed, FEBRABAN):
 *   1-3   banco            (748 = Sicredi)
 *   4     moeda            (9 = real)
 *   5     DV geral         (módulo 11 over the other 43)
 *   6-9   fator vencimento (days since the epoch below)
 *   10-19 valor            (centavos, zero-padded)
 *   20-44 campo livre      (bank-specific; untouched here)
 */

import { formatDueDateYMD, parseDueDateYMD } from './due-date.util';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Factor 1000 = 2025-02-22.
 *
 * The original FEBRABAN epoch (07/10/1997) ran out at factor 9999 on 21/02/2025 and
 * reset to 1000 the next day. Every boleto in this system was issued after that reset,
 * so the post-rollover epoch is the only one implemented — a pre-2025 barcode would
 * decode to nonsense, which is why `barcodeDueDateYMD` range-checks the factor instead
 * of trusting it.
 */
const FACTOR_1000_DATE_UTC = Date.UTC(2025, 1, 22);
const MIN_FACTOR = 1000;
const MAX_FACTOR = 9999;

const BARCODE_LENGTH = 44;
const DIGITABLE_LINE_LENGTH = 47;

const isAllDigits = (value: string): boolean => /^\d+$/.test(value);

/** A 44-digit, all-numeric barcode. Anything else cannot be reasoned about. */
export function isValidBarcodeShape(barcode: string | null | undefined): boolean {
  return (
    typeof barcode === 'string' && barcode.length === BARCODE_LENGTH && isAllDigits(barcode)
  );
}

/** Calendar date (yyyy-MM-dd) → fator de vencimento. Throws outside the valid range. */
export function dueDateToFactor(ymd: string): number {
  const date = parseDueDateYMD(ymd);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Data de vencimento inválida para o fator: "${ymd}"`);
  }
  const days = Math.round(
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      FACTOR_1000_DATE_UTC) /
      MS_PER_DAY,
  );
  const factor = MIN_FACTOR + days;
  if (factor < MIN_FACTOR || factor > MAX_FACTOR) {
    throw new Error(
      `Data ${ymd} fica fora da faixa do fator de vencimento (${MIN_FACTOR}-${MAX_FACTOR}).`,
    );
  }
  return factor;
}

/** Fator de vencimento → calendar date (yyyy-MM-dd), or null when out of range. */
export function factorToDueDateYMD(factor: number): string | null {
  if (!Number.isInteger(factor) || factor < MIN_FACTOR || factor > MAX_FACTOR) return null;
  return formatDueDateYMD(new Date(FACTOR_1000_DATE_UTC + (factor - MIN_FACTOR) * MS_PER_DAY));
}

/** The due date a barcode actually encodes (yyyy-MM-dd), or null if unreadable. */
export function barcodeDueDateYMD(barcode: string | null | undefined): string | null {
  if (!isValidBarcodeShape(barcode)) return null;
  return factorToDueDateYMD(Number(barcode!.slice(5, 9)));
}

/** The amount a barcode encodes, in reais, or null if unreadable. */
export function barcodeAmount(barcode: string | null | undefined): number | null {
  if (!isValidBarcodeShape(barcode)) return null;
  return Number(barcode!.slice(9, 19)) / 100;
}

/**
 * DV geral (position 5): módulo 11 over the other 43 digits, weights 2..9 cycling
 * from the right. A remainder yielding 0, 1 or 10 becomes 1.
 */
export function computeBarcodeCheckDigit(digits43: string): number {
  if (digits43.length !== BARCODE_LENGTH - 1 || !isAllDigits(digits43)) {
    throw new Error('DV geral exige exatamente 43 dígitos.');
  }
  let weight = 2;
  let sum = 0;
  for (let i = digits43.length - 1; i >= 0; i--) {
    sum += Number(digits43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 0 || dv === 1 || dv > 9 ? 1 : dv;
}

/** DV of a linha digitável field: módulo 10, weights 2/1 from the right, digits summed. */
function computeFieldCheckDigit(block: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = block.length - 1; i >= 0; i--) {
    const product = Number(block[i]) * weight;
    sum += product > 9 ? product - 9 : product;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Derive the 47-digit linha digitável from a barcode.
 *
 * Fields: 1 = banco+moeda+campo livre[1-5], 2 = campo livre[6-15],
 * 3 = campo livre[16-25] (each + módulo-10 DV), 4 = DV geral, 5 = fator + valor.
 */
export function barcodeToDigitableLine(barcode: string): string {
  if (!isValidBarcodeShape(barcode)) {
    throw new Error('Código de barras inválido: são esperados 44 dígitos.');
  }
  const field1 = barcode.slice(0, 4) + barcode.slice(19, 24);
  const field2 = barcode.slice(24, 34);
  const field3 = barcode.slice(34, 44);
  return (
    field1 +
    computeFieldCheckDigit(field1) +
    field2 +
    computeFieldCheckDigit(field2) +
    field3 +
    computeFieldCheckDigit(field3) +
    barcode[4] +
    barcode.slice(5, 19)
  );
}

/** Does this barcode already encode `ymd`? False when the barcode is unreadable. */
export function isBarcodeCurrentForDueDate(
  barcode: string | null | undefined,
  ymd: string,
): boolean {
  const encoded = barcodeDueDateYMD(barcode);
  return encoded !== null && encoded === ymd;
}

export interface RebuiltBoletoCodes {
  barcode: string;
  digitableLine: string;
}

/**
 * Rebuild `barcode` + `digitableLine` for a new due date, preserving everything else.
 *
 * Returns null when there is nothing trustworthy to rebuild from (no barcode, wrong
 * shape, or a date outside the factor range) — callers should then keep the stored
 * codes and log, never write a half-valid line that a customer might pay against.
 */
export function rebuildBoletoCodesForDueDate(
  barcode: string | null | undefined,
  newDueDateYMD: string,
): RebuiltBoletoCodes | null {
  if (!isValidBarcodeShape(barcode)) return null;

  let factor: number;
  try {
    factor = dueDateToFactor(newDueDateYMD);
  } catch {
    return null;
  }

  const current = barcode as string;
  // Everything but the factor survives: bank, currency, amount and the free field.
  const digits43 =
    current.slice(0, 4) + String(factor).padStart(4, '0') + current.slice(9);
  const rebuilt = digits43.slice(0, 4) + computeBarcodeCheckDigit(digits43) + digits43.slice(4);

  return { barcode: rebuilt, digitableLine: barcodeToDigitableLine(rebuilt) };
}

export const BOLETO_BARCODE_LENGTH = BARCODE_LENGTH;
export const BOLETO_DIGITABLE_LINE_LENGTH = DIGITABLE_LINE_LENGTH;
