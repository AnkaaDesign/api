/**
 * G3 → G4 — do log do censo às fixtures do contrato de consultas.
 *
 * O censo guarda só CAMINHOS de chave e a espécie da folha (nunca valor). Para
 * virar fixture do G4 (`contracts/queries/*.json`, que o
 * `tests/query-contract.test.ts` passa pelo zod da rota, pelo G1 e pelo Prisma),
 * a consulta é REMONTADA: include/select viram `true`, orderBy vira `'asc'`, e a
 * folha de `where` ganha um valor sintético do TIPO do campo, lido do DMMF
 * (enum → o primeiro valor; id → um UUID; data → uma data ISO…). Chave que o
 * DMMF não conhece (a velha, a calculada, a inventada) ganha um valor pela
 * espécie que o censo registrou — e é justamente o G4 quem vai julgá-la.
 *
 * Puro, sem banco: o `scripts/census-to-fixture.ts` lê o log e o arquivo.
 */
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { getField, type DmmfField } from '../query/dmmf-query-validator';
import {
  CENSUS_LOG_PREFIX,
  OVERFLOW,
  TRUNCATED,
  type CensusShape,
  type LeafKind,
} from './census-shape';

// ─── leitura do log ─────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** Uma linha do log (journalctl, arquivo, com ou sem cor do Nest) → a forma. */
export function parseCensusLine(line: string): CensusShape | null {
  const clean = line.replace(ANSI, '');
  const at = clean.indexOf(`${CENSUS_LOG_PREFIX} `);
  if (at < 0) return null;
  const json = clean.slice(at + CENSUS_LOG_PREFIX.length + 1).trim();
  try {
    const s = JSON.parse(json) as CensusShape;
    if (typeof s?.rota !== 'string' || !Array.isArray(s.consulta) || !Array.isArray(s.corpo))
      return null;
    return s;
  } catch {
    return null;
  }
}

// ─── árvore de caminhos ─────────────────────────────────────────────────────

interface PathNode {
  kind?: LeafKind;
  /** `k:<chave>`, `i:<n>` (lista ordenada) ou `i:` (lista fundida) */
  children: Map<string, PathNode>;
}

const newNode = (): PathNode => ({ children: new Map() });

/** `include.customer:bool` → segmentos e espécie; `null` se não dá para remontar. */
export function parseCensusPath(entry: string): { segs: string[]; kind: LeafKind } | null {
  if (entry === TRUNCATED || entry.includes('(?)') || entry.includes(TRUNCATED)) return null;
  const colon = entry.lastIndexOf(':');
  if (colon < 0) return null;
  const path = entry.slice(0, colon);
  const kind = entry.slice(colon + 1) as LeafKind;
  const segs: string[] = [];
  const re = /([^.[\]]+)|\[(\d*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) segs.push(m[1] !== undefined ? `k:${m[1]}` : `i:${m[2]}`);
  if (!segs.length || segs.includes('k:#')) return null;
  return { segs, kind };
}

export function pathTree(entries: string[]): PathNode {
  const root = newNode();
  for (const e of entries) {
    const parsed = parseCensusPath(e);
    if (!parsed) continue;
    let node = root;
    for (const s of parsed.segs) {
      let next = node.children.get(s);
      if (!next) node.children.set(s, (next = newNode()));
      node = next;
    }
    node.kind = parsed.kind;
  }
  return root;
}

const isList = (n: PathNode) => [...n.children.keys()].some(k => k.startsWith('i:'));
const keyed = (n: PathNode) =>
  [...n.children.entries()]
    .filter(([k]) => k.startsWith('k:'))
    .map(([k, v]) => [k.slice(2), v] as const);
const listItems = (n: PathNode) =>
  [...n.children.entries()]
    .filter(([k]) => k.startsWith('i:'))
    .sort(([a], [b]) => Number(a.slice(2) || 0) - Number(b.slice(2) || 0))
    .map(([, v]) => v);

// ─── valores sintéticos ─────────────────────────────────────────────────────

export const FIXTURE_UUID = '00000000-0000-4000-8000-000000000001';
export const FIXTURE_DATE = '2026-01-01T00:00:00.000Z';

/** Pela espécie que o censo registrou (chave sem campo no DMMF). */
function byKind(kind: LeafKind | undefined): unknown {
  switch (kind) {
    case 'num':
      return 1;
    case 'bool':
      return true;
    case 'null':
    case 'outro':
    case undefined:
      return null;
    case 'str[]':
    case 'mix[]':
      return ['x'];
    case 'num[]':
      return [1];
    case 'bool[]':
      return [true];
    case '[]':
      return [];
    case '{}':
      return {};
    default:
      return 'x';
  }
}

/** Sem contexto de modelo: remonta a forma, folha pela espécie. */
function generic(node: PathNode): unknown {
  if (node.kind !== undefined && node.children.size === 0) return byKind(node.kind);
  if (isList(node)) return listItems(node).map(generic);
  return Object.fromEntries(keyed(node).map(([k, v]) => [k, generic(v)]));
}

function enumFirstValue(type: string): string | null {
  const e = Prisma.dmmf.datamodel.enums.find(en => en.name === type);
  return e?.values[0]?.name ?? null;
}

function scalarValue(field: DmmfField, kind: LeafKind | undefined): unknown {
  if (kind === 'null') return null;
  if (kind === '[]') return [];
  let v: unknown;
  if (field.kind === 'enum') v = enumFirstValue(field.type);
  else {
    switch (field.type) {
      case 'String':
        v = field.name === 'id' || /Id$/.test(field.name) ? FIXTURE_UUID : 'x';
        break;
      case 'Int':
      case 'BigInt':
      case 'Float':
      case 'Decimal':
        v = 1;
        break;
      case 'Boolean':
        v = true;
        break;
      case 'DateTime':
        v = FIXTURE_DATE;
        break;
      default:
        v = byKind(kind);
    }
  }
  return kind?.endsWith('[]') ? [v] : v;
}

const LIST_OPS = new Set(['in', 'notIn', 'hasSome', 'hasEvery']);
const RELATION_OPS = new Set(['some', 'every', 'none', 'is', 'isNot']);

function scalarFilter(node: PathNode, field: DmmfField): unknown {
  if (node.children.size === 0) return scalarValue(field, node.kind);
  const out: Record<string, unknown> = {};
  for (const [op, child] of keyed(node)) {
    if (op === 'mode') out[op] = 'insensitive';
    else if (op === 'not' && child.children.size) out[op] = scalarFilter(child, field);
    else if (LIST_OPS.has(op)) {
      const v = scalarValue(field, child.kind === '[]' ? '[]' : undefined);
      out[op] = Array.isArray(v) ? v : [v];
    } else out[op] = scalarValue(field, child.kind);
  }
  return out;
}

function whereOf(node: PathNode, model: string | null): unknown {
  if (!model || node.children.size === 0) return generic(node);
  const out: Record<string, unknown> = {};
  for (const [key, child] of keyed(node)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      out[key] = isList(child)
        ? listItems(child).map(el => whereOf(el, model))
        : child.children.size
          ? whereOf(child, model)
          : generic(child);
      continue;
    }
    const field = getField(model, key);
    if (!field) out[key] = generic(child);
    else if (field.kind === 'object') {
      if (child.children.size === 0) out[key] = byKind(child.kind);
      else if (keyed(child).every(([k]) => RELATION_OPS.has(k))) {
        out[key] = Object.fromEntries(
          keyed(child).map(([op, g]) => [
            op,
            g.children.size ? whereOf(g, field.type) : byKind(g.kind),
          ]),
        );
      } else out[key] = whereOf(child, field.type);
    } else out[key] = scalarFilter(child, field);
  }
  return out;
}

function orderByOf(node: PathNode, model: string | null): unknown {
  if (node.children.size === 0) return 'asc';
  if (isList(node)) return listItems(node).map(el => orderByOf(el, model));
  const out: Record<string, unknown> = {};
  for (const [key, child] of keyed(node)) {
    if (key === 'sort') out[key] = 'asc';
    else if (key === 'nulls') out[key] = 'last';
    else {
      const field = model ? getField(model, key) : undefined;
      out[key] = orderByOf(child, field?.kind === 'object' ? field.type : null);
    }
  }
  return out;
}

/** O objeto de include/select de `model`: cada chave → `true` ou os argumentos da relação. */
function selectionOf(node: PathNode, model: string | null): unknown {
  if (node.children.size === 0) return byKind(node.kind);
  const out: Record<string, unknown> = {};
  for (const [key, child] of keyed(node)) {
    if (child.children.size === 0) {
      out[key] = true;
      continue;
    }
    if (key === '_count') {
      out[key] = relationArgsOf(child, model);
      continue;
    }
    const field = model ? getField(model, key) : undefined;
    out[key] = relationArgsOf(child, field?.kind === 'object' ? field.type : null);
  }
  return out;
}

/** `{ include, select, where, orderBy, take, skip }` de uma relação. */
function relationArgsOf(node: PathNode, model: string | null): unknown {
  const out: Record<string, unknown> = {};
  for (const [key, child] of keyed(node)) {
    if (key === 'include' || key === 'select') out[key] = selectionOf(child, model);
    else if (key === 'where') out[key] = whereOf(child, model);
    else if (key === 'orderBy') out[key] = orderByOf(child, model);
    else if (key === 'take') out[key] = 10;
    else if (key === 'skip') out[key] = 0;
    else out[key] = generic(child);
  }
  return out;
}

/** As chaves de topo da consulta que viram fixture; o resto vai listado à parte. */
const FIXTURE_TOP = new Set([
  'include',
  'select',
  'where',
  'orderBy',
  'page',
  'limit',
  'take',
  'skip',
]);

/**
 * Caminhos da query do censo → `consulta` da fixture do G4, no modelo da rota.
 * Devolve também as chaves de topo que ficaram de fora (filtros próprios da
 * rota, `searchingFor`…: o valor delas não se adivinha).
 */
export function rebuildQuery(
  model: string,
  consulta: string[],
): { consulta: Record<string, unknown>; outrasChaves: string[] } {
  const root = pathTree(consulta);
  const out: Record<string, unknown> = {};
  const outras: string[] = [];
  for (const [key, child] of keyed(root)) {
    if (!FIXTURE_TOP.has(key)) {
      outras.push(key);
      continue;
    }
    if (key === 'include' || key === 'select') out[key] = selectionOf(child, model);
    else if (key === 'where') out[key] = whereOf(child, model);
    else if (key === 'orderBy') out[key] = orderByOf(child, model);
    else if (key === 'page') out[key] = 1;
    else if (key === 'skip') out[key] = 0;
    else out[key] = 10;
  }
  return { consulta: out, outrasChaves: outras.sort() };
}

// ─── fixture ────────────────────────────────────────────────────────────────

export interface RouteSchema {
  modelo: string;
  schema: string;
}

export interface CensusFixtureForm {
  id: string;
  rota: string;
  modelo: string;
  schema: string;
  origem: string;
  consulta: Record<string, unknown>;
  outrasChaves?: string[];
}

export interface CensusFixture {
  cliente: 'censo';
  descricao: string;
  fonte: string;
  geradoEm: string;
  formas: CensusFixtureForm[];
  /** GET com cláusula de consulta numa rota que nenhuma fixture mapeou ainda */
  semSchema: { rota: string; consulta: string[]; clientes: string[] }[];
  /** corpos (POST/PUT/PATCH): entrada do tradutor do P11a, o G4 não lê */
  corpos: { rota: string; corpo: string[]; clientes: string[] }[];
  /** formas que caíram no balde do teto (algum processo passou de 2.000) */
  transbordou: boolean;
}

const CLAUSE_ROOTS = /^(include|select|where|orderBy)[.[:]/;

function clientLabel(s: CensusShape): string {
  return [s.ua, s.v, s.patch && `patch ${s.patch}`, s.plataforma, s.cliente]
    .filter(Boolean)
    .join(' ');
}

function slug(rota: string): string {
  return rota.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

const MAX_CLIENTS_LISTED = 12;
const listClients = (set: Set<string>) => {
  const all = [...set].sort();
  return all.length > MAX_CLIENTS_LISTED
    ? [...all.slice(0, MAX_CLIENTS_LISTED), `(+${all.length - MAX_CLIENTS_LISTED})`]
    : all;
};

/**
 * Formas do censo → a fixture `contracts/queries/censo.json`. Agrupa por rota +
 * caminhos (clientes diferentes mandando a mesma forma são UMA forma, com todos
 * os clientes na origem). `routes` vem das fixtures que já existem: rota →
 * modelo e schema zod registrados no G4.
 */
export function buildCensusFixture(
  shapes: CensusShape[],
  routes: Map<string, RouteSchema>,
  now: Date = new Date(),
): CensusFixture {
  const gets = new Map<string, { rota: string; consulta: string[]; clientes: Set<string> }>();
  const bodies = new Map<string, { rota: string; corpo: string[]; clientes: Set<string> }>();
  let transbordou = false;
  for (const s of shapes) {
    if (s.rota === OVERFLOW) {
      transbordou = true;
      continue;
    }
    const method = s.rota.split(' ')[0];
    if (method === 'GET') {
      const consulta = [...s.consulta].sort();
      if (!consulta.some(p => CLAUSE_ROOTS.test(p))) continue;
      const k = `${s.rota}\n${consulta.join('\n')}`;
      const g = gets.get(k) ?? { rota: s.rota, consulta, clientes: new Set<string>() };
      g.clientes.add(clientLabel(s));
      gets.set(k, g);
    } else if (s.corpo.length) {
      const corpo = [...s.corpo].sort();
      const k = `${s.rota}\n${corpo.join('\n')}`;
      const b = bodies.get(k) ?? { rota: s.rota, corpo, clientes: new Set<string>() };
      b.clientes.add(clientLabel(s));
      bodies.set(k, b);
    }
  }

  const formas: CensusFixtureForm[] = [];
  const semSchema: CensusFixture['semSchema'] = [];
  for (const [k, g] of [...gets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const route = routes.get(g.rota);
    if (!route) {
      semSchema.push({ rota: g.rota, consulta: g.consulta, clientes: listClients(g.clientes) });
      continue;
    }
    const { consulta, outrasChaves } = rebuildQuery(route.modelo, g.consulta);
    const hash = createHash('sha1').update(k).digest('hex').slice(0, 8);
    formas.push({
      id: `censo.${slug(g.rota)}.${hash}`,
      rota: g.rota,
      modelo: route.modelo,
      schema: route.schema,
      origem: `censo: ${listClients(g.clientes).join('; ')}`,
      consulta,
      ...(outrasChaves.length ? { outrasChaves } : {}),
    });
  }

  return {
    cliente: 'censo',
    descricao:
      'Formas que os clientes REALMENTE mandaram, lidas do log [CENSO] da API (G3). ' +
      'Gerado por scripts/census-to-fixture.ts — não editar à mão: os valores são sintéticos ' +
      '(só os caminhos de chave vieram do censo).',
    fonte: 'log [CENSO] da API (src/modules/common/census)',
    geradoEm: now.toISOString(),
    formas,
    semSchema,
    corpos: [...bodies.values()]
      .sort((a, b) => a.rota.localeCompare(b.rota) || a.corpo.join().localeCompare(b.corpo.join()))
      .map(b => ({ rota: b.rota, corpo: b.corpo, clientes: listClients(b.clientes) })),
    transbordou,
  };
}
