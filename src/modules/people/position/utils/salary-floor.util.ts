// salary-floor.util.ts
// Piso salarial / salário-mínimo enforcement for reajustes e valores de cargo (Part F).
//
// A remuneração de um cargo nunca pode cair abaixo do MAIOR entre:
//   1) o salário-mínimo nacional vigente; e
//   2) o piso da categoria/sindicato (Position.salaryFloor), quando definido.
//
// Fonte do salário-mínimo nacional 2026: R$ 1.621,00 (Decreto 12.797/2025,
// vigente desde 01/01/2026; reajuste de 6,79% sobre R$ 1.518,00 de 2025).

/**
 * Salário-mínimo nacional vigente, por ano de competência.
 * Mantido como mapa para que a validação histórica use o mínimo do ano correto
 * e para facilitar a virada anual (adicionar a nova linha em dezembro/janeiro).
 */
export const NATIONAL_MINIMUM_WAGE_BY_YEAR: Record<number, number> = {
  2023: 1320.0,
  2024: 1412.0,
  2025: 1518.0,
  2026: 1621.0,
};

/** Ano-base do salário-mínimo corrente usado quando nenhum ano é informado. */
export const CURRENT_MINIMUM_WAGE_YEAR = 2026;

/** Salário-mínimo nacional corrente (2026): R$ 1.621,00. */
export const NATIONAL_MINIMUM_WAGE = NATIONAL_MINIMUM_WAGE_BY_YEAR[CURRENT_MINIMUM_WAGE_YEAR];

/**
 * Retorna o salário-mínimo nacional vigente em `date` (ou o corrente se omitido).
 * Usa o maior ano cadastrado que seja ≤ ao ano da data.
 */
export function getNationalMinimumWage(date?: Date): number {
  const year = date ? date.getFullYear() : CURRENT_MINIMUM_WAGE_YEAR;
  const years = Object.keys(NATIONAL_MINIMUM_WAGE_BY_YEAR)
    .map(Number)
    .filter(y => y <= year)
    .sort((a, b) => b - a);
  const resolvedYear = years[0] ?? CURRENT_MINIMUM_WAGE_YEAR;
  return NATIONAL_MINIMUM_WAGE_BY_YEAR[resolvedYear];
}

/** Converte o Decimal? do Prisma (salaryFloor) para number | null. */
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

export interface SalaryFloorCheck {
  /** O piso efetivo aplicado = max(salário-mínimo, piso da categoria). */
  effectiveFloor: number;
  /** Salário-mínimo nacional usado na comparação. */
  minimumWage: number;
  /** Piso da categoria considerado (ou null se não definido). */
  categoryFloor: number | null;
  /** true se `value` for menor que o piso efetivo. */
  belowFloor: boolean;
  /** Mensagem pronta para BadRequestException/aviso quando belowFloor. */
  message: string | null;
}

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Avalia um valor de remuneração contra o piso efetivo.
 * Não lança — devolve o diagnóstico para o chamador decidir bloquear ou avisar.
 *
 * @param value          novo valor proposto
 * @param categoryFloor  Position.salaryFloor (Decimal? convertido) ou null
 * @param date           data de competência (define qual salário-mínimo usar)
 */
export function checkSalaryFloor(
  value: number,
  categoryFloor: number | null,
  date?: Date,
): SalaryFloorCheck {
  const minimumWage = getNationalMinimumWage(date);
  const floor = categoryFloor != null && categoryFloor > 0 ? categoryFloor : null;
  const effectiveFloor = Math.max(minimumWage, floor ?? 0);
  const belowFloor = value < effectiveFloor;

  let message: string | null = null;
  if (belowFloor) {
    if (floor != null && floor > minimumWage) {
      message = `Remuneração ${fmt(value)} abaixo do piso da categoria (${fmt(floor)}).`;
    } else {
      message = `Remuneração ${fmt(value)} abaixo do salário-mínimo nacional (${fmt(minimumWage)}).`;
    }
  }

  return { effectiveFloor, minimumWage, categoryFloor: floor, belowFloor, message };
}
