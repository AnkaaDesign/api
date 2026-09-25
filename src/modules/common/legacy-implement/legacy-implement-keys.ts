/**
 * JANELA BILÍNGUE DO IMPLEMENTO (PLANO §5.2/§5.4, P11a) — o TRADUTOR ÚNICO.
 *
 * Até a R-D (P32), três clientes instalados continuam falando o vocabulário
 * velho: o web em produção, o app 1.4.1 (Shorebird) e o `AnkaaAero` do iPad (sem
 * OTA). Este arquivo traduz o que eles mandam ANTES do zod — a API por dentro só
 * fala `implement`:
 *
 *   consulta (include/select/where/orderBy, em qualquer profundidade)
 *     `truck`                         → `implement`
 *     `implementType` (no implemento) → `type`
 *     `trucks{Left,Right,Back}Side`   → `implements{Left,Right,Back}Side`
 *     `truckVinPlates`                → `implementVinPlates`
 *     filtros da lista de tarefas: `hasTruck` → `implementIdentified`,
 *     `truckIds` → `implementIds`, `truckCategories` → `implementCategories`
 *
 *   corpo da tarefa (POST/PUT /tasks, /tasks/batch, /tasks/batch-with-quote)
 *     `truck: {…}`          → `implement: {…}`, `implementType` → `type`,
 *                             `*SideMeasureId` descartados (nunca foram gravados)
 *     `truck`/`implement: null` → 400 (o implemento não sai da tarefa, DD1)
 *     série no topo ≠ `implement.serialNumber` → 400
 *
 *   `truck` e `implement` no MESMO nó → 400 "Envie só "implement"".
 *
 * A tabela das chaves (com a data de expiração) mora em `DEPRECATED_QUERY_KEYS`
 * (G1): lá cada linha aponta para cá em `handledBy`. O contador por rota × versão
 * do app é do `ImplementLegacyMirrorInterceptor`, que vê o pedido inteiro.
 *
 * EXPIRA: 2027-03-31 (a mesma data das linhas de `DEPRECATED_QUERY_KEYS`).
 */
import { BadRequestException } from '@nestjs/common';

export const LEGACY_IMPLEMENT_EXPIRES_AT = '2027-03-31';

export const BOTH_IMPLEMENT_KEYS_MESSAGE = 'Envie só "implement" (o nome antigo e o novo vieram juntos).';
export const IMPLEMENT_NOT_REMOVABLE_MESSAGE =
  'O implemento não pode ser removido da tarefa; limpe os campos.';
export const SERIAL_TOP_AND_IMPLEMENT_MESSAGE =
  'Envie o número de série só em "implement" (o do topo e o do implemento vieram diferentes).';

/** Um uso de chave legada: o caminho onde veio e a tradução. */
export interface LegacyImplementUse {
  path: string;
  from: string;
  to: string | null;
}

const OLD = 'truck';
const NEW = 'implement';

/** Relações renomeadas fora do nó do implemento (inversas). */
const RENAMED_RELATIONS: Readonly<Record<string, string>> = {
  trucksLeftSide: 'implementsLeftSide',
  trucksRightSide: 'implementsRightSide',
  trucksBackSide: 'implementsBackSide',
  truckVinPlates: 'implementVinPlates',
};

/** Filtros de conveniência da lista de tarefas (topo da query). */
const RENAMED_TOP_FILTERS: Readonly<Record<string, string>> = {
  hasTruck: 'implementIdentified',
  truckIds: 'implementIds',
  truckCategories: 'implementCategories',
};

/** Campos do próprio implemento renomeados pela M1. */
const RENAMED_IMPLEMENT_FIELDS: Readonly<Record<string, string>> = {
  implementType: 'type',
};

/** Chaves que ficam no MESMO nível lógico do nó (o Prisma aninha por elas). */
const STRUCTURAL = new Set([
  'select',
  'include',
  'where',
  'is',
  'isNot',
  'some',
  'every',
  'none',
  'AND',
  'OR',
  'NOT',
]);

const QUERY_CLAUSES = ['include', 'select', 'where', 'orderBy'] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function conflict(path: string): never {
  throw new BadRequestException({
    message: BOTH_IMPLEMENT_KEYS_MESSAGE,
    errors: [`${BOTH_IMPLEMENT_KEYS_MESSAGE} (em ${path})`],
    statusCode: 400,
  });
}

/**
 * Percorre um nó de consulta. `inImplement` = o nó é o valor de uma relação
 * `implement` (ou `truck`), onde `implementType` vira `type`.
 */
function walkQueryNode(
  node: unknown,
  path: string,
  inImplement: boolean,
  uses: LegacyImplementUse[],
): unknown {
  if (Array.isArray(node)) {
    return node.map((v, i) => walkQueryNode(v, `${path}[${i}]`, inImplement, uses));
  }
  if (!isPlainObject(node)) return node;

  if (OLD in node && NEW in node) conflict(path);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    let target = key;
    let childInImplement = false;
    if (key === OLD) {
      target = NEW;
      childInImplement = true;
      uses.push({ path: `${path}.${key}`, from: key, to: NEW });
    } else if (key === NEW) {
      childInImplement = true;
    } else if (key in RENAMED_RELATIONS) {
      target = RENAMED_RELATIONS[key];
      uses.push({ path: `${path}.${key}`, from: key, to: target });
    } else if (inImplement && key in RENAMED_IMPLEMENT_FIELDS) {
      target = RENAMED_IMPLEMENT_FIELDS[key];
      if (target in node) conflict(`${path}.${key}`);
      uses.push({ path: `${path}.${key}`, from: key, to: target });
    } else if (STRUCTURAL.has(key)) {
      // `select`/`include`/`is`/`AND`… continuam no mesmo modelo
      childInImplement = inImplement;
    }
    out[target] = walkQueryNode(value, `${path}.${key}`, childInImplement, uses);
  }
  return out;
}

/** A query string pode trazer a cláusula em JSON (o app e o web mandam assim). */
function parseMaybeJson(value: unknown): { parsed: unknown; wasJson: boolean } {
  if (typeof value !== 'string') return { parsed: value, wasJson: false };
  const t = value.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return { parsed: value, wasJson: false };
  try {
    return { parsed: JSON.parse(t), wasJson: true };
  } catch {
    return { parsed: value, wasJson: false };
  }
}

/**
 * Traduz uma query (já com as cláusulas em objeto ou ainda em JSON). Devolve uma
 * CÓPIA; a cláusula que veio em JSON volta em JSON (o pipe a abre depois).
 */
export function translateLegacyImplementQuery<T>(
  query: T,
  uses: LegacyImplementUse[] = [],
): T {
  if (!isPlainObject(query)) return query;
  const out: Record<string, unknown> = { ...query };
  for (const clause of QUERY_CLAUSES) {
    if (out[clause] === undefined) continue;
    const { parsed, wasJson } = parseMaybeJson(out[clause]);
    if (!isPlainObject(parsed) && !Array.isArray(parsed)) continue;
    const translated = walkQueryNode(parsed, clause, false, uses);
    out[clause] = wasJson ? JSON.stringify(translated) : translated;
  }
  for (const [from, to] of Object.entries(RENAMED_TOP_FILTERS)) {
    if (!(from in out)) continue;
    if (to in out) conflict(from);
    out[to] = out[from];
    delete out[from];
    uses.push({ path: from, from, to });
  }
  return out as T;
}

const DISCARDED_IMPLEMENT_BODY_KEYS = new Set([
  'leftSideMeasureId',
  'rightSideMeasureId',
  'backSideMeasureId',
]);

function normalizeSerial(v: unknown): unknown {
  return v === '' ? null : v;
}

function translateImplementBody(
  value: unknown,
  path: string,
  uses: LegacyImplementUse[],
): unknown {
  if (value === null) {
    throw new BadRequestException({
      message: IMPLEMENT_NOT_REMOVABLE_MESSAGE,
      errors: [`${IMPLEMENT_NOT_REMOVABLE_MESSAGE} (em ${path})`],
      statusCode: 400,
    });
  }
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key in RENAMED_IMPLEMENT_FIELDS) {
      const to = RENAMED_IMPLEMENT_FIELDS[key];
      if (to in value) conflict(`${path}.${key}`);
      out[to] = v;
      uses.push({ path: `${path}.${key}`, from: key, to });
      continue;
    }
    if (DISCARDED_IMPLEMENT_BODY_KEYS.has(key)) {
      uses.push({ path: `${path}.${key}`, from: key, to: null });
      continue;
    }
    out[key] = v;
  }
  return out;
}

function walkBody(node: unknown, path: string, uses: LegacyImplementUse[]): unknown {
  if (Array.isArray(node)) return node.map((v, i) => walkBody(v, `${path}[${i}]`, uses));
  if (!isPlainObject(node)) return node;

  const hasOld = OLD in node;
  const hasNew = NEW in node;
  if (hasOld && hasNew) conflict(path || 'corpo');

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === OLD || key === NEW) {
      if (key === OLD) uses.push({ path: `${path}${path ? '.' : ''}${key}`, from: key, to: NEW });
      out[NEW] = translateImplementBody(value, `${path}${path ? '.' : ''}${NEW}`, uses);
      continue;
    }
    // o corpo da tarefa só aninha tarefa em listas (`tasks[]`) e em `data`
    // (`PUT /tasks/batch`); o resto é dado de outro modelo e passa intacto.
    out[key] =
      key === 'tasks' || key === 'data' || key === 'modifications'
        ? walkBody(value, `${path}${path ? '.' : ''}${key}`, uses)
        : value;
  }

  // série no topo × no implemento (D-32): iguais passam; diferentes, 400.
  const implement = out[NEW];
  if (
    'serialNumber' in out &&
    isPlainObject(implement) &&
    'serialNumber' in implement &&
    normalizeSerial(out.serialNumber) !== normalizeSerial(implement.serialNumber)
  ) {
    throw new BadRequestException({
      message: SERIAL_TOP_AND_IMPLEMENT_MESSAGE,
      errors: [`${SERIAL_TOP_AND_IMPLEMENT_MESSAGE} (em ${path || 'corpo'})`],
      statusCode: 400,
    });
  }
  return out;
}

/**
 * Traduz o corpo de escrita da TAREFA (criação, edição, lotes). Devolve CÓPIA.
 * Só é ligado nas rotas de tarefa (`ZodValidationPipe` com `legacyImplementBody`):
 * outro corpo com uma chave `truck` (preferência salva, por exemplo) não é tocado.
 */
export function translateLegacyImplementBody<T>(body: T, uses: LegacyImplementUse[] = []): T {
  return walkBody(body, '', uses) as T;
}

/**
 * Quais chaves legadas um pedido trouxe (query + corpo), sem traduzir nem lançar.
 * Para o contador e para decidir o espelho da resposta.
 */
export function detectLegacyImplementKeys(query: unknown, body: unknown): {
  legacy: string[];
  mentionsNew: boolean;
} {
  const legacy = new Set<string>();
  let mentionsNew = false;
  const legacyNames = new Set<string>([
    OLD,
    ...Object.keys(RENAMED_RELATIONS),
    ...Object.keys(RENAMED_TOP_FILTERS),
  ]);
  const visit = (node: unknown, depth: number): void => {
    if (depth > 12) return;
    if (typeof node === 'string') {
      const { parsed, wasJson } = parseMaybeJson(node);
      if (wasJson) visit(parsed, depth + 1);
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) visit(v, depth + 1);
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (legacyNames.has(k)) legacy.add(k);
      if (k === NEW) mentionsNew = true;
      visit(v, depth + 1);
    }
  };
  visit(query, 0);
  visit(body, 0);
  return { legacy: [...legacy].sort(), mentionsNew };
}
