import { TRUCK_MANUFACTURER_LABELS } from '@constants';
import { TRUCK_MANUFACTURER } from '@constants';

/**
 * Get human-readable label for truck manufacturer
 */
export function getTruckManufacturerLabel(manufacturer: TRUCK_MANUFACTURER): string {
  return TRUCK_MANUFACTURER_LABELS[manufacturer] || manufacturer;
}

// =====================================================================
// Placa e chassi — fonte única de verdade
// =====================================================================
// Regra de armazenamento: SEMPRE em maiúsculas, só [A-Z0-9], sem separador,
// string vazia vira null. O hífen é camada de APRESENTAÇÃO — `plateNormalized`
// e `chassisNumberNormalized` são colunas geradas (`lower(unaccent(col))`) que
// preservam pontuação, então uma placa gravada como "ABC-1234" some da busca
// por "abc1234".
//
// Placa antiga:  AAA9999  (exibida ABC-1234, com hífen)
// Placa Mercosul: AAA9A99 (exibida ABC1D23, SEM hífen — o layout Contran não
// imprime separador). Os dois padrões só divergem na 5ª posição.

export const PLATE_OLD_REGEX = /^[A-Z]{3}[0-9]{4}$/;
export const PLATE_MERCOSUL_REGEX = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;
/** União exata dos dois formatos brasileiros. */
export const PLATE_REGEX = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

/**
 * Máscara POSICIONAL da placa. Validar com a regex inteira durante a digitação
 * travaria o campo no 4º caractere; aqui cada posição tem seu alfabeto e os
 * dois padrões convivem sem ramificar — a decisão "antiga ou Mercosul" só
 * existe quando o 5º caractere chega.
 */
export const PLATE_MASK: RegExp[] = [
  /[A-Z]/,
  /[A-Z]/,
  /[A-Z]/,
  /[0-9]/,
  /[A-Z0-9]/,
  /[0-9]/,
  /[0-9]/,
];

export const PLATE_LENGTH = 7;
export const CHASSIS_LENGTH = 17;

/**
 * VIN conforme ISO 3779: 17 caracteres, alfabeto sem I, O nem Q — a norma as
 * proíbe justamente porque se confundem com 1 e 0. Os 3 registros legados que
 * violavam isso eram erro de digitação e foram corrigidos em 24/08 (`O`→`0` em
 * `94BF1543LLR041427`, `I`→`1` em `9A9CFF253T1DV8848`), provados pelos irmãos
 * de série na própria base — 68 dos 69 chassis `9A9CFF` têm `1` na 11ª posição.
 */
export const CHASSIS_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;
/** Só o tamanho/alfabeto amplo — usado para separar as duas mensagens de erro. */
export const CHASSIS_LENGTH_REGEX = /^[A-Z0-9]{17}$/;
/** Letras que a ISO 3779 proíbe no VIN. */
export const CHASSIS_FORBIDDEN_LETTERS = /[IOQ]/;

/** Placa pronta para gravar: maiúscula, só alfanumérico, no máximo 7. */
export function cleanPlate(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, PLATE_LENGTH);
}

/**
 * Aplica a máscara posicional, descartando o caractere que não cabe na posição.
 * Use na DIGITAÇÃO; `cleanPlate` basta para um valor que já veio pronto.
 */
export function maskPlateInput(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .split('')
    .filter((char, index) => index < PLATE_LENGTH && PLATE_MASK[index].test(char))
    .join('');
}

/** Chassi pronto para gravar: maiúsculo, só alfanumérico, no máximo 17. */
export function cleanChassis(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CHASSIS_LENGTH);
}

export function isValidPlate(value: string | null | undefined): boolean {
  return PLATE_REGEX.test(cleanPlate(value));
}

export function isValidChassis(value: string | null | undefined): boolean {
  return CHASSIS_REGEX.test(cleanChassis(value));
}

/** Exibição: `ABC-1234` no padrão antigo, `ABC1D23` no Mercosul. */
export function formatPlate(value: string | null | undefined): string {
  const cleaned = cleanPlate(value);
  if (!PLATE_REGEX.test(cleaned)) return cleaned; // parcial/inválida sai crua
  return PLATE_OLD_REGEX.test(cleaned) ? `${cleaned.slice(0, 3)}-${cleaned.slice(3)}` : cleaned;
}

/**
 * Exibição do chassi agrupado pela estrutura ISO 3779: WMI (3) · VDS (6) ·
 * VIS (8) — `9BM 979026 CS006622`. O agrupamento 3-5-2-6 usado antes somava 16
 * de 17 e deixava o último caractere colado no grupo final.
 */
export function formatChassis(value: string | null | undefined): string {
  const cleaned = cleanChassis(value);
  const groups = [cleaned.slice(0, 3), cleaned.slice(3, 9), cleaned.slice(9, 17)];
  return groups.filter(Boolean).join(' ');
}

export const PLATE_INVALID_MESSAGE = 'Formato de placa inválido (ex: ABC-1234 ou ABC1D23)';
export const CHASSIS_INVALID_MESSAGE =
  'Número do chassi deve ter exatamente 17 caracteres alfanuméricos';
export const CHASSIS_FORBIDDEN_LETTERS_MESSAGE =
  'Número do chassi não pode conter as letras I, O ou Q — confira se são os dígitos 1 ou 0';
