/**
 * O "desfazer" do histórico do implemento: qual COLUNA um campo gravado reverte.
 *
 * O histórico grava o campo do implemento de dois jeitos: `implement.<coluna>`
 * no `TaskFieldChangeLog` da tarefa e `<coluna>` pura no `ChangeLog` da entidade
 * `IMPLEMENT`. Campo que não é coluna revertível → `null`, e quem chama recusa
 * com 400 e mensagem (nunca o 500 do Prisma com uma coluna inexistente).
 */

/** As colunas do implemento que o histórico pode reverter. */
export const IMPLEMENT_REVERTIBLE_COLUMNS = [
  'serialNumber',
  'plate',
  'chassisNumber',
  'vinPlateId',
  'category',
  'type',
  'spot',
  'leftSideMeasureId',
  'rightSideMeasureId',
  'backSideMeasureId',
] as const;

export type ImplementRevertibleColumn = (typeof IMPLEMENT_REVERTIBLE_COLUMNS)[number];

const PREFIX = 'implement.';

/** `implement.plate` → `plate`; `plate` → `plate`; qualquer outro → `null`. */
export function resolveImplementColumn(
  field: string | null | undefined,
): ImplementRevertibleColumn | null {
  if (!field) return null;
  const column = field.startsWith(PREFIX) ? field.slice(PREFIX.length) : field;
  return (IMPLEMENT_REVERTIBLE_COLUMNS as readonly string[]).includes(column)
    ? (column as ImplementRevertibleColumn)
    : null;
}

/** O campo do histórico da TAREFA é do implemento (`implement.*`)? */
export function isImplementHistoryField(field: string | null | undefined): boolean {
  return !!field && field.startsWith(PREFIX);
}
