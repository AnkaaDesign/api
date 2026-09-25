/**
 * G1 — A ÚNICA TABELA DE CHAVES DE CONSULTA QUE O PRISMA NÃO CONHECE.
 *
 * Duas espécies, e nenhuma outra lista paralela no código:
 *
 * 1. `DEPRECATED_QUERY_KEYS` — legado que um cliente INSTALADO ainda manda
 *    (app 1.4.1, bundle velho do web, AnkaaAero). Cada linha diz o que fazer
 *    (`translate` para a chave nova ou `discard`) e tem DATA DE EXPIRAÇÃO: o
 *    teste de contrato reprova quando a data passa, e aí alguém decide, com o
 *    censo (G3) na mão, se a linha sai ou se a data anda. Cada uso conta e loga
 *    (`query-key-telemetry.ts`).
 *
 * 2. `COMPUTED_QUERY_KEYS` — chaves que a API resolve sozinha antes do Prisma
 *    (ordenação calculada em memória, por exemplo). Não expiram: são contrato.
 *
 * O validador (`dmmf-query-validator.ts`) deixa passar as duas; o tradutor
 * (`rewriteDeprecatedQueryKeys`) troca/descarta as da primeira antes da
 * consulta chegar ao repositório.
 */
import type { QueryClause, QueryKeyAllowance } from './dmmf-query-validator';
import { getField } from './dmmf-query-validator';

export interface DeprecatedQueryKey {
  model: string;
  key: string;
  clauses: QueryClause[];
  action: 'translate' | 'discard';
  /** chave nova, quando `action === 'translate'` */
  to?: string;
  /** desde quando a chave é legado (AAAA-MM-DD) */
  since: string;
  /** até quando a janela vale (AAAA-MM-DD); passou, o teste de contrato reprova */
  expiresAt: string;
  /**
   * Quem faz a tradução. `'g1'` = `rewriteDeprecatedQueryKeys`, na porta da rota.
   * Outro valor = o ponto do código que já a fazia antes do G1 (a linha está aqui
   * para a tabela ser a ÚNICA lista do legado; o G1 só a deixa passar).
   */
  handledBy: 'g1' | string;
  reason: string;
}

export const DEPRECATED_QUERY_KEYS: readonly DeprecatedQueryKey[] = [
  {
    model: 'BudgetPayer',
    key: 'responsible',
    clauses: ['include', 'select'],
    action: 'discard',
    since: '2026-09-18',
    expiresAt: '2027-03-31',
    handledBy: 'g1',
    reason:
      'A relação saiu de BudgetPayer na migration 20260918120000 (quem responde pelo ' +
      'orçamento é Task.responsibles). O app 1.4.1 ainda pede ' +
      '`customerConfigs.include.responsible` (budget.dart:1187); repassada ao Prisma, ' +
      'derrubava a consulta inteira com 500.',
  },
  {
    model: 'Budget',
    key: 'task',
    clauses: ['include', 'select'],
    action: 'translate',
    to: 'tasks',
    since: '2026-09-17',
    expiresAt: '2027-03-31',
    handledBy: 'g1',
    reason:
      'Forma anterior ao orçamento multitarefa (Budget tinha UMA task). O app instalado ' +
      'e o `kTaskQuoteDetailInclude` em cache ainda mandam `task`; schemas/budget.ts ' +
      'aceita as duas e o repositório traduz para a relação de lista `tasks`.',
  },
  {
    model: 'Budget',
    key: 'task',
    clauses: ['where'],
    action: 'translate',
    to: 'tasks',
    since: '2026-09-17',
    expiresAt: '2027-03-31',
    handledBy: 'budget-prisma.repository.ts#translateLegacyTaskFilter',
    reason:
      '`where.task` (de-UM) vira `tasks: { some | none }`. O app instalado filtra a lista ' +
      'de Orçamentos por `task`.',
  },
  {
    model: 'Budget',
    key: 'taskId',
    clauses: ['where'],
    action: 'translate',
    to: 'tasks',
    since: '2026-09-17',
    expiresAt: '2027-03-31',
    handledBy: 'budget-prisma.repository.ts#translateLegacyTaskFilter',
    reason: 'A coluna saiu de Budget (a FK mora em Task.quoteId); `taskId` vira `tasks.some.id`.',
  },
  {
    model: 'Budget',
    key: 'task',
    clauses: ['orderBy'],
    action: 'discard',
    since: '2026-09-17',
    expiresAt: '2027-03-31',
    handledBy: 'budget-prisma.repository.ts#stripUnorderableTaskEntries',
    reason:
      'Ordenar orçamento por campo de UMA das N tarefas não tem resposta; o app ' +
      'instalado manda `{task:{term:"asc"}}` e a entrada é descartada.',
  },
  {
    model: 'Budget',
    key: 'taskId',
    clauses: ['orderBy'],
    action: 'discard',
    since: '2026-09-17',
    expiresAt: '2027-03-31',
    handledBy: 'budget-prisma.repository.ts#stripUnorderableTaskEntries',
    reason: 'A coluna saiu de Budget; ordenar por ela era o mesmo 500 de `task`.',
  },
  {
    model: 'ServiceOrder',
    key: 'name',
    clauses: ['select'],
    action: 'translate',
    to: 'description',
    since: '2026-09-23',
    expiresAt: '2027-03-31',
    handledBy: 'task-prisma.repository.ts#sanitizeSelectFields',
    reason:
      'ServiceOrder não tem `name`; o repositório de tarefa troca ' +
      '`include.serviceOrders.select.name` por `description` antes do Prisma (herança ' +
      'do app RN). Nenhum cliente atual manda (web, app main, v1.4.1+24 e AnkaaAero ' +
      'conferidos no P01); a linha existe para o G1 não recusar com 400 o que a API ' +
      'respondia com 200. Vencida, o censo (G3) decide se o sanitizador sai junto.',
  },
  // ── Janela bilíngue do implemento (P11a, M1: `Truck` → `Implement`) ──
  // Quem traduz é `translateLegacyImplementQuery`, ANTES do zod, no pipe de toda
  // rota; as linhas estão aqui para esta tabela continuar sendo a ÚNICA lista do
  // legado, com a data de expiração. O contador por rota × versão do app é do
  // `ImplementLegacyMirrorInterceptor`, que também espelha a resposta.
  {
    model: 'Task',
    key: 'truck',
    clauses: ['include', 'select', 'where', 'orderBy'],
    action: 'translate',
    to: 'implement',
    since: '2026-09-24',
    expiresAt: '2027-03-31',
    handledBy: 'legacy-implement-keys.ts#translateLegacyImplementQuery',
    reason:
      'M1 renomeou a relação. O web em produção, o app 1.4.1 (inclusive o orderBy ' +
      'da Agenda) e o AnkaaAero pedem `truck`; a resposta devolve `truck` e `implement` ' +
      'iguais (espelho).',
  },
  {
    model: 'Implement',
    key: 'implementType',
    clauses: ['select', 'where', 'orderBy'],
    action: 'translate',
    to: 'type',
    since: '2026-09-24',
    expiresAt: '2027-03-31',
    handledBy: 'legacy-implement-keys.ts#translateLegacyImplementQuery',
    reason: 'M1 renomeou a coluna `implementType` → `type` (só dentro do nó do implemento).',
  },
  ...(['LeftSide', 'RightSide', 'BackSide'] as const).map(face => ({
    model: 'ImplementMeasure',
    key: `trucks${face}`,
    clauses: ['include', 'select', 'where'] as QueryClause[],
    action: 'translate' as const,
    to: `implements${face}`,
    since: '2026-09-24',
    expiresAt: '2027-03-31',
    handledBy: 'legacy-implement-keys.ts#translateLegacyImplementQuery',
    reason: 'M1 renomeou a inversa da medida (o nome da relação acompanha o modelo).',
  })),
  {
    model: 'File',
    key: 'truckVinPlates',
    clauses: ['include', 'select', 'where'],
    action: 'translate',
    to: 'implementVinPlates',
    since: '2026-09-24',
    expiresAt: '2027-03-31',
    handledBy: 'legacy-implement-keys.ts#translateLegacyImplementQuery',
    reason: 'M1 renomeou a inversa da plaqueta.',
  },
];

export interface ComputedQueryKey {
  model: string;
  key: string;
  clauses: QueryClause[];
  resolvedBy: string;
}

export const COMPUTED_QUERY_KEYS: readonly ComputedQueryKey[] = [
  {
    model: 'Task',
    key: 'currentInstallmentDueDate',
    clauses: ['orderBy'],
    resolvedBy:
      'task-prisma.repository.ts (DUE_DATE_SORT_KEY): "Vencimento" do faturamento, ' +
      'ordenado em memória sobre o conjunto inteiro antes de paginar.',
  },
];

function keyOf(model: string, clause: QueryClause, key: string): string {
  return `${model}.${clause}.${key}`;
}

const deprecatedByKey = new Map<string, DeprecatedQueryKey>();
for (const d of DEPRECATED_QUERY_KEYS) {
  for (const c of d.clauses) {
    const k = keyOf(d.model, c, d.key);
    if (deprecatedByKey.has(k))
      throw new Error(`[G1] linha duplicada em DEPRECATED_QUERY_KEYS: ${k}`);
    deprecatedByKey.set(k, d);
  }
}
const computedByKey = new Map<string, ComputedQueryKey>();
for (const c of COMPUTED_QUERY_KEYS) {
  for (const cl of c.clauses) computedByKey.set(keyOf(c.model, cl, c.key), c);
}

export function findDeprecatedQueryKey(
  model: string,
  clause: QueryClause,
  key: string,
): DeprecatedQueryKey | undefined {
  return deprecatedByKey.get(keyOf(model, clause, key));
}

export function isComputedQueryKey(model: string, clause: QueryClause, key: string): boolean {
  return computedByKey.has(keyOf(model, clause, key));
}

/** O que o validador deixa passar: legado da tabela + chaves calculadas. */
export const QUERY_KEY_ALLOWANCE: QueryKeyAllowance = {
  isAllowed: (model, clause, key) =>
    !!findDeprecatedQueryKey(model, clause, key) || isComputedQueryKey(model, clause, key),
};

export interface DeprecatedKeyUse {
  entry: DeprecatedQueryKey;
  clause: QueryClause;
  path: string;
  /** `false` quando a chave nova também veio: a velha foi só descartada */
  translated: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * Devolve uma CÓPIA de `args` com o legado da tabela traduzido ou descartado,
 * em qualquer profundidade de include/select. `onUse` é chamado uma vez por
 * chave legada encontrada (o chamador conta e loga).
 *
 * Tradução não sobrescreve: se a chave nova também veio, a nova vence e a velha
 * é só descartada (e contada).
 */
export function rewriteDeprecatedQueryKeys<T extends Record<string, unknown>>(
  model: string,
  args: T,
  onUse?: (use: DeprecatedKeyUse) => void,
): T {
  const out: Record<string, unknown> = { ...args };
  for (const clause of ['include', 'select'] as const) {
    if (isPlainObject(out[clause])) {
      out[clause] = rewriteNode(
        model,
        clause,
        out[clause] as Record<string, unknown>,
        clause,
        onUse,
      );
    }
  }
  return out as T;
}

function rewriteNode(
  model: string,
  clause: QueryClause,
  node: Record<string, unknown>,
  path: string,
  onUse?: (use: DeprecatedKeyUse) => void,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // chaves novas primeiro, para a tradução saber se a nova já veio
  const entries = Object.entries(node);
  const g1 = (key: string) => {
    const dep = findDeprecatedQueryKey(model, clause, key);
    return dep && dep.handledBy === 'g1' ? dep : undefined;
  };
  for (const [key, value] of entries) {
    if (g1(key)) continue;
    out[key] = rewriteRelationValue(model, key, value, `${path}.${key}`, onUse);
  }
  for (const [key, value] of entries) {
    const dep = g1(key);
    if (!dep) continue;
    const translate = dep.action === 'translate' && !!dep.to && !(dep.to in out);
    onUse?.({ entry: dep, clause, path: `${path}.${key}`, translated: translate });
    if (translate && dep.to) {
      out[dep.to] = rewriteRelationValue(model, dep.to, value, `${path}.${dep.to}`, onUse);
    }
  }
  return out;
}

function rewriteRelationValue(
  model: string,
  key: string,
  value: unknown,
  path: string,
  onUse?: (use: DeprecatedKeyUse) => void,
): unknown {
  if (!isPlainObject(value)) return value;
  const field = getField(model, key);
  if (!field || field.kind !== 'object') return value;
  const out: Record<string, unknown> = { ...value };
  for (const clause of ['include', 'select'] as const) {
    if (isPlainObject(out[clause])) {
      out[clause] = rewriteNode(
        field.type,
        clause,
        out[clause] as Record<string, unknown>,
        `${path}.${clause}`,
        onUse,
      );
    }
  }
  return out;
}

/** Entradas cuja janela já passou (o teste de contrato reprova com elas). */
export function expiredDeprecatedQueryKeys(today = new Date()): DeprecatedQueryKey[] {
  const iso = today.toISOString().slice(0, 10);
  return DEPRECATED_QUERY_KEYS.filter(d => d.expiresAt < iso);
}
