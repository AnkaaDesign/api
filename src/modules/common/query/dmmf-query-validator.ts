/**
 * G1 — VALIDADOR DE CONSULTA DERIVADO DO DMMF.
 *
 * Percorre `include`, `select`, `where` e `orderBy` contra
 * `Prisma.dmmf.datamodel.models` e devolve cada CHAVE que o Prisma não conhece
 * (campo que não existe no modelo, escalar pedido como relação). É a mesma
 * pergunta que o Prisma faz na hora de executar — só que feita ANTES, com o nome
 * da chave e o caminho, para a rota responder 400 em vez do 500 que o
 * `PrismaClientValidationError` embrulhado virava.
 *
 * O validador é deliberadamente CONSERVADOR: só acusa NOME de campo. Não valida
 * operador de filtro escalar (`contains`, `mode`, `in`…), nem a forma dos
 * argumentos aninhados (`take`, `skip`, `cursor`) — nesses pontos ele se cala e
 * deixa o Prisma decidir. Um falso positivo aqui derrubaria uma tela que hoje
 * funciona; um falso negativo só mantém o comportamento de hoje. O teste de
 * contrato (`tests/query-contract.test.ts`) cruza, para cada forma real que os
 * clientes mandam, o veredito deste validador com o do Prisma no banco clonado.
 *
 * As chaves que a API conhece mas o Prisma não (legado em janela, campos
 * resolvidos pelo repositório) moram em `deprecated-query-keys.ts` — a ÚNICA
 * tabela, com data de expiração.
 */
import { Prisma } from '@prisma/client';

export type QueryClause = 'include' | 'select' | 'where' | 'orderBy';

export type QueryKeyIssueReason =
  /** a chave não é campo do modelo */
  | 'unknown-field'
  /** a chave é campo, mas escalar, numa posição que exige relação (include) */
  | 'not-a-relation';

export interface QueryKeyIssue {
  clause: QueryClause;
  /** modelo em que a chave foi procurada */
  model: string;
  key: string;
  /** caminho completo desde a raiz da consulta, ex.: `include.customer.include.tasks` */
  path: string;
  reason: QueryKeyIssueReason;
}

export interface DmmfField {
  name: string;
  kind: 'scalar' | 'object' | 'enum' | 'unsupported';
  type: string;
  isList: boolean;
}

type ModelIndex = Map<string, Map<string, DmmfField>>;

let modelIndex: ModelIndex | null = null;

function index(): ModelIndex {
  if (modelIndex) return modelIndex;
  const out: ModelIndex = new Map();
  for (const model of Prisma.dmmf.datamodel.models) {
    const fields = new Map<string, DmmfField>();
    for (const f of model.fields) {
      fields.set(f.name, {
        name: f.name,
        kind: f.kind as DmmfField['kind'],
        type: f.type,
        isList: f.isList,
      });
    }
    out.set(model.name, fields);
  }
  modelIndex = out;
  return out;
}

export function hasModel(model: string): boolean {
  return index().has(model);
}

export function getModelFields(model: string): Map<string, DmmfField> | undefined {
  return index().get(model);
}

export function getField(model: string, key: string): DmmfField | undefined {
  return index().get(model)?.get(key);
}

export function listModels(): string[] {
  return [...index().keys()];
}

/**
 * Chaves que a API aceita num modelo e o Prisma não conhece, e que por isso o
 * validador deve deixar passar (o chamador as resolve antes do Prisma).
 * Vem de `deprecated-query-keys.ts`; aqui é só a interface.
 */
export interface QueryKeyAllowance {
  isAllowed(model: string, clause: QueryClause, key: string): boolean;
}

const NO_ALLOWANCE: QueryKeyAllowance = { isAllowed: () => false };

/** Argumentos que um nó de relação aceita dentro de include/select. */
const RELATION_ARG_KEYS = new Set([
  'select',
  'include',
  'omit',
  'where',
  'orderBy',
  'take',
  'skip',
  'cursor',
  'distinct',
]);

const WHERE_COMBINATORS = new Set(['AND', 'OR', 'NOT']);
const LIST_RELATION_FILTERS = new Set(['some', 'every', 'none']);
const TO_ONE_RELATION_FILTERS = new Set(['is', 'isNot']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Date) &&
    !(Prisma.Decimal && v instanceof Prisma.Decimal)
  );
}

class Walker {
  readonly issues: QueryKeyIssue[] = [];

  constructor(private readonly allowance: QueryKeyAllowance) {}

  private push(
    clause: QueryClause,
    model: string,
    key: string,
    path: string,
    reason: QueryKeyIssueReason,
  ) {
    this.issues.push({ clause, model, key, path, reason });
  }

  private allowed(model: string, clause: QueryClause, key: string): boolean {
    return this.allowance.isAllowed(model, clause, key);
  }

  /** Argumentos aninhados de uma relação (`{ include, select, where, orderBy, … }`). */
  relationArgs(model: string, value: unknown, path: string) {
    if (!isPlainObject(value)) return;
    for (const [k, v] of Object.entries(value)) {
      if (!RELATION_ARG_KEYS.has(k)) continue; // forma dos argumentos: o Prisma decide
      const p = `${path}.${k}`;
      if (k === 'include') this.include(model, v, p);
      else if (k === 'select') this.select(model, v, p);
      else if (k === 'where') this.where(model, v, p);
      else if (k === 'orderBy') this.orderBy(model, v, p);
    }
  }

  include(model: string, node: unknown, path: string) {
    if (!isPlainObject(node)) return;
    const fields = getModelFields(model);
    if (!fields) return;
    for (const [key, value] of Object.entries(node)) {
      const p = `${path}.${key}`;
      if (key === '_count') {
        this.count(model, value, p);
        continue;
      }
      if (this.allowed(model, 'include', key)) continue;
      const field = fields.get(key);
      if (!field) {
        this.push('include', model, key, p, 'unknown-field');
        continue;
      }
      if (field.kind !== 'object') {
        // `include: { name: false }` é aceito pelo tipo? Não: o Prisma recusa
        // escalar em include com qualquer valor.
        this.push('include', model, key, p, 'not-a-relation');
        continue;
      }
      this.relationArgs(field.type, value, p);
    }
  }

  select(model: string, node: unknown, path: string) {
    if (!isPlainObject(node)) return;
    const fields = getModelFields(model);
    if (!fields) return;
    for (const [key, value] of Object.entries(node)) {
      const p = `${path}.${key}`;
      if (key === '_count') {
        this.count(model, value, p);
        continue;
      }
      if (this.allowed(model, 'select', key)) continue;
      const field = fields.get(key);
      if (!field) {
        this.push('select', model, key, p, 'unknown-field');
        continue;
      }
      if (field.kind === 'object') this.relationArgs(field.type, value, p);
    }
  }

  /** `_count: true | { select: { relacaoDeLista: true | { where } } }` */
  private count(model: string, value: unknown, path: string) {
    if (!isPlainObject(value)) return;
    const sel = value.select;
    if (!isPlainObject(sel)) return;
    const fields = getModelFields(model);
    if (!fields) return;
    for (const [key, v] of Object.entries(sel)) {
      const p = `${path}.select.${key}`;
      const field = fields.get(key);
      if (!field) {
        this.push('select', model, key, p, 'unknown-field');
        continue;
      }
      if (field.kind !== 'object') {
        this.push('select', model, key, p, 'not-a-relation');
        continue;
      }
      if (isPlainObject(v) && 'where' in v) this.where(field.type, v.where, `${p}.where`);
    }
  }

  where(model: string, node: unknown, path: string) {
    if (Array.isArray(node)) {
      node.forEach((n, i) => this.where(model, n, `${path}[${i}]`));
      return;
    }
    if (!isPlainObject(node)) return;
    const fields = getModelFields(model);
    if (!fields) return;
    for (const [key, value] of Object.entries(node)) {
      const p = `${path}.${key}`;
      if (WHERE_COMBINATORS.has(key)) {
        this.where(model, value, p);
        continue;
      }
      if (this.allowed(model, 'where', key)) continue;
      const field = fields.get(key);
      if (!field) {
        this.push('where', model, key, p, 'unknown-field');
        continue;
      }
      if (field.kind !== 'object') continue; // operador escalar: o Prisma decide
      if (!isPlainObject(value)) continue; // `relacao: null`
      if (field.isList) {
        for (const [op, sub] of Object.entries(value)) {
          if (LIST_RELATION_FILTERS.has(op)) this.where(field.type, sub, `${p}.${op}`);
        }
        continue;
      }
      const keys = Object.keys(value);
      if (keys.length > 0 && keys.every(k => TO_ONE_RELATION_FILTERS.has(k))) {
        for (const [op, sub] of Object.entries(value)) this.where(field.type, sub, `${p}.${op}`);
      } else {
        // atalho do Prisma: `customer: { fantasyName: … }` == `customer: { is: {…} }`
        this.where(field.type, value, p);
      }
    }
  }

  orderBy(model: string, node: unknown, path: string) {
    if (Array.isArray(node)) {
      node.forEach((n, i) => this.orderBy(model, n, `${path}[${i}]`));
      return;
    }
    if (!isPlainObject(node)) return;
    const fields = getModelFields(model);
    if (!fields) return;
    for (const [key, value] of Object.entries(node)) {
      const p = `${path}.${key}`;
      if (key === '_relevance' || key === '_count') continue;
      if (this.allowed(model, 'orderBy', key)) continue;
      const field = fields.get(key);
      if (!field) {
        this.push('orderBy', model, key, p, 'unknown-field');
        continue;
      }
      if (field.kind !== 'object') continue; // 'asc' | { sort, nulls }
      if (field.isList) continue; // `{ _count: 'asc' }`
      this.orderBy(field.type, value, p);
    }
  }
}

export interface QueryArgs {
  include?: unknown;
  select?: unknown;
  where?: unknown;
  orderBy?: unknown;
}

/**
 * Todas as chaves de `args` que o Prisma não conhece no `model`. Lista vazia =
 * nenhuma chave inventada (não garante que a consulta é válida: o Prisma ainda
 * julga operadores e forma).
 */
export function findQueryKeyIssues(
  model: string,
  args: QueryArgs,
  allowance: QueryKeyAllowance = NO_ALLOWANCE,
): QueryKeyIssue[] {
  if (!hasModel(model)) {
    throw new Error(`[G1] modelo desconhecido no DMMF: ${model}`);
  }
  const w = new Walker(allowance);
  if (args.include !== undefined) w.include(model, args.include, 'include');
  if (args.select !== undefined) w.select(model, args.select, 'select');
  if (args.where !== undefined) w.where(model, args.where, 'where');
  if (args.orderBy !== undefined) w.orderBy(model, args.orderBy, 'orderBy');
  return w.issues;
}

const CLAUSE_LABEL: Record<QueryClause, string> = {
  include: 'include',
  select: 'select',
  where: 'filtro (where)',
  orderBy: 'ordenação (orderBy)',
};

/** `Chave de include desconhecida: Task.cutRequest (em include.cutRequest)` */
export function describeQueryKeyIssue(issue: QueryKeyIssue): string {
  const what =
    issue.reason === 'not-a-relation'
      ? `Chave de ${CLAUSE_LABEL[issue.clause]} não é relação`
      : `Chave de ${CLAUSE_LABEL[issue.clause]} desconhecida`;
  return `${what}: ${issue.model}.${issue.key} (em ${issue.path})`;
}
