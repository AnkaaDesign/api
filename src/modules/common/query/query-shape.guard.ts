/**
 * G1 — A PORTA ÚNICA: toda rota que aceita include/select/where/orderBy passa a
 * consulta por aqui DEPOIS do zod e ANTES do serviço.
 *
 *   1. Traduz/descarta o legado de `DEPRECATED_QUERY_KEYS` (e conta).
 *   2. Valida o que sobrou contra o DMMF: chave que o Prisma não conhece e que
 *      chegaria a ele → 400 NOMEADO (`Chave de include desconhecida: Task.x`).
 *      Hoje essas chaves viravam `PrismaClientValidationError`, que os serviços
 *      embrulhavam em 500 sem dizer qual chave era.
 *   3. MODO RELATÓRIO (Fase A): chave que veio no pedido cru e o schema zod
 *      DESCARTOU calado não é recusada — só conta e loga. Recusá-la mudaria o
 *      comportamento de um cliente instalado; o censo (G3) prova antes quem a
 *      manda.
 *
 * Plugar: `new ZodQueryValidationPipe(schema, { queryModel: 'Task' })`, ou
 * chamar `enforceQueryShape` direto onde a consulta não vem por pipe.
 */
import { BadRequestException } from '@nestjs/common';
import {
  describeQueryKeyIssue,
  findQueryKeyIssues,
  getField,
  type QueryArgs,
  type QueryClause,
  type QueryKeyIssue,
} from './dmmf-query-validator';
import {
  QUERY_KEY_ALLOWANCE,
  findDeprecatedQueryKey,
  rewriteDeprecatedQueryKeys,
} from './deprecated-query-keys';
import { recordQueryKeyEvent } from './query-key-telemetry';

export const UNKNOWN_QUERY_KEY_ERROR = 'UNKNOWN_QUERY_KEY';

const CLAUSES: QueryClause[] = ['include', 'select', 'where', 'orderBy'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** A exceção que a rota devolve: 400 com cada chave nomeada. */
export class UnknownQueryKeyException extends BadRequestException {
  constructor(readonly issues: QueryKeyIssue[]) {
    const errors = issues.map(describeQueryKeyIssue);
    super({
      message: errors.join('; '),
      error: UNKNOWN_QUERY_KEY_ERROR,
      errors,
      chaves: issues.map(i => ({
        modelo: i.model,
        chave: i.key,
        caminho: i.path,
        clausula: i.clause,
      })),
      statusCode: 400,
    });
  }
}

/** Só as quatro cláusulas que o validador entende. */
function pickClauses(q: Record<string, unknown>): QueryArgs {
  const out: QueryArgs = {};
  for (const c of CLAUSES) if (q[c] !== undefined) out[c] = q[c];
  return out;
}

/**
 * Chaves de include/select/orderBy presentes no pedido cru e ausentes depois do
 * zod: o que o schema da rota descartou calado. Devolve caminhos.
 */
export function droppedQueryKeyPaths(raw: unknown, parsed: unknown, path: string): string[] {
  if (Array.isArray(raw)) {
    if (!Array.isArray(parsed)) return [];
    return raw.flatMap((r, i) => droppedQueryKeyPaths(r, parsed[i], `${path}[${i}]`));
  }
  if (!isPlainObject(raw) || !isPlainObject(parsed)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in parsed)) {
      out.push(`${path}.${k}`);
      continue;
    }
    out.push(...droppedQueryKeyPaths(v, parsed[k], `${path}.${k}`));
  }
  return out;
}

export interface EnforceQueryShapeOptions {
  /** o pedido ANTES do zod — habilita o modo relatório das chaves descartadas */
  raw?: unknown;
  /**
   * O repositório do modelo IGNORA o argumento de uma relação do `include` do
   * topo que não traz `include` nem `select` (`{ serviceOrders: { where } }`
   * vira o include padrão — `task-prisma.repository.ts#mapIncludeToDatabaseInclude`).
   * Com esta opção, o G1 não julga esse argumento (ele nunca chega ao Prisma):
   * conta e loga como descartado, e a resposta continua a de antes.
   */
  bareRelationArgsIgnored?: boolean;
  /**
   * SÓ CONTA, nunca recusa nem traduz: a consulta sai exatamente como o zod a
   * deixou. É o G1 das rotas que ainda não foram plugadas de verdade
   * (clientes, arquivos, aerografias): a chave que o zod descarta calado e a
   * que chegaria ao Prisma passam a aparecer no contador e no log, sem mudar
   * nenhuma resposta na Fase A.
   */
  reportOnly?: boolean;
}

/**
 * Aplica o G1 à consulta já passada pelo zod. Devolve a consulta com o legado
 * traduzido; lança `UnknownQueryKeyException` se sobrar chave inventada.
 */
export function enforceQueryShape<T>(
  model: string,
  parsed: T,
  options: EnforceQueryShapeOptions = {},
): T {
  if (!isPlainObject(parsed)) return parsed;

  if (options.reportOnly) {
    rewriteDeprecatedQueryKeys(model, parsed, use =>
      recordQueryKeyEvent('deprecated', model, use.path, 'modo relatório: não traduzida'),
    );
    for (const i of findQueryKeyIssues(model, pickClauses(parsed), QUERY_KEY_ALLOWANCE)) {
      recordQueryKeyEvent('rejected', model, i.path, `${i.reason} (modo relatório: não recusada)`);
    }
    if (isPlainObject(options.raw)) {
      reportDroppedKeys(model, options.raw, parsed as Record<string, unknown>);
    }
    return parsed;
  }

  const translated = rewriteDeprecatedQueryKeys(model, parsed, use =>
    recordQueryKeyEvent(
      'deprecated',
      model,
      use.path,
      use.translated
        ? `traduzida para ${use.entry.to}`
        : use.entry.action === 'translate'
          ? `descartada (${use.entry.to} também veio)`
          : 'descartada',
    ),
  );

  const toValidate = pickClauses(translated);
  if (options.bareRelationArgsIgnored && isPlainObject(toValidate.include)) {
    const include: Record<string, unknown> = { ...toValidate.include };
    for (const [key, value] of Object.entries(include)) {
      if (!isPlainObject(value) || 'include' in value || 'select' in value) continue;
      if (!getField(model, key)) continue; // relação inventada: o validador recusa
      for (const arg of Object.keys(value)) {
        recordQueryKeyEvent(
          'dropped',
          model,
          `include.${key}.${arg}`,
          'ignorado pelo repositório (relação sem include/select)',
        );
      }
      include[key] = true;
    }
    toValidate.include = include;
  }

  const issues = findQueryKeyIssues(model, toValidate, QUERY_KEY_ALLOWANCE);
  if (issues.length > 0) {
    for (const i of issues) recordQueryKeyEvent('rejected', model, i.path, i.reason);
    throw new UnknownQueryKeyException(issues);
  }

  if (isPlainObject(options.raw)) {
    reportDroppedKeys(model, options.raw, parsed as Record<string, unknown>);
  }

  return translated as T;
}

function reportDroppedKeys(
  model: string,
  raw: Record<string, unknown>,
  parsed: Record<string, unknown>,
): void {
  // `where` fica de fora: no topo ele é `.strict()` nas rotas que têm where
  // enumerado (recusa, não descarta), e as conveniências (`hasTruck`…) viram
  // where no transform, o que faria toda chave parecer "descartada".
  for (const clause of ['include', 'select', 'orderBy'] as const) {
    const r = raw[clause];
    if (r === undefined) continue;
    const p = parsed[clause];
    if (p === undefined) {
      recordQueryKeyEvent('dropped', model, clause, 'cláusula inteira descartada pelo zod');
      continue;
    }
    for (const path of droppedQueryKeyPaths(r, p, clause)) {
      const where = resolveDroppedKey(model, path);
      if (where && findDeprecatedQueryKey(where.model, where.clause, where.key)) {
        // legado conhecido que o zod já tirava: conta como legado, não como surpresa
        recordQueryKeyEvent('deprecated', model, path, 'descartada pelo zod (legado da tabela)');
        continue;
      }
      recordQueryKeyEvent('dropped', model, path, describeDropped(where));
    }
  }
}

interface DroppedKey {
  model: string;
  clause: QueryClause;
  key: string;
  exists: boolean;
}

/** Em que modelo e cláusula mora a chave do caminho (`include.quote.include.x`). */
function resolveDroppedKey(model: string, path: string): DroppedKey | null {
  const parts = path.split('.').map(p => p.replace(/\[\d+\]$/, ''));
  let current = model;
  let clause: QueryClause = parts[0] as QueryClause;
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (CLAUSES.includes(seg as QueryClause)) {
      clause = seg as QueryClause;
      continue;
    }
    const f = getField(current, seg);
    if (i === parts.length - 1) return { model: current, clause, key: seg, exists: !!f };
    if (!f) return null;
    if (f.kind === 'object') current = f.type;
  }
  return null;
}

/** "relação conhecida" × "inventada", para o log dizer se é esquecimento do zod. */
function describeDropped(where: DroppedKey | null): string {
  if (!where) return 'descartada pelo zod';
  return where.exists
    ? `descartada pelo zod; ${where.model}.${where.key} EXISTE no DMMF (o schema da rota não a conhece)`
    : `descartada pelo zod; ${where.model}.${where.key} não existe no DMMF`;
}
