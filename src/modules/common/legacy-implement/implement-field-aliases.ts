/**
 * Os nomes de campo do implemento gravados no HISTÓRICO (ChangeLog /
 * TaskFieldChangeLog) antes da M1 — `truck.plate`, `truck.implementType`,
 * `implementType` — e a coluna de hoje. O histórico NÃO é reescrito (PLANO §6.8):
 * quem lê o nome gravado (o "desfazer" do histórico, os rótulos) passa por aqui.
 *
 * Nome que não traduz para uma coluna do implemento → `null`, e quem chama
 * recusa com 400 e mensagem (nunca 500 do Prisma com a coluna inexistente).
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

/** Nome antigo da COLUNA → nome de hoje (a M1 renomeou `implementType`). */
export const LEGACY_FIELD_ALIASES: Readonly<Record<string, ImplementRevertibleColumn>> = {
  implementType: 'type',
};

const PREFIXES = ['truck.', 'implement.'];

/**
 * `truck.implementType` → `type`; `implement.plate` → `plate`; `implementType` →
 * `type`; `plate` → `plate`. Qualquer outro → `null`.
 */
export function resolveImplementColumn(field: string | null | undefined): ImplementRevertibleColumn | null {
  if (!field) return null;
  let f = field;
  for (const p of PREFIXES) {
    if (f.startsWith(p)) {
      f = f.slice(p.length);
      break;
    }
  }
  const column = LEGACY_FIELD_ALIASES[f] ?? f;
  return (IMPLEMENT_REVERTIBLE_COLUMNS as readonly string[]).includes(column)
    ? (column as ImplementRevertibleColumn)
    : null;
}

/** O campo do histórico é do implemento pelo prefixo (`truck.*` ou `implement.*`)? */
export function isImplementHistoryField(field: string | null | undefined): boolean {
  return !!field && PREFIXES.some(p => field.startsWith(p));
}
