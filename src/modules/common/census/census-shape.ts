/**
 * G3 — CENSO DE FORMAS: o que os clientes REALMENTE mandam.
 *
 * Telemetria só de leitura. Por rota (método + padrão do Express, nunca a URL
 * crua), guarda os CAMINHOS DE CHAVE da consulta (include/select/where/orderBy e
 * o resto da query string) e do corpo, com a identidade do cliente
 * (`X-App-Version`, `X-App-Patch`, `X-App-Platform`, `X-Client` e a família do
 * `User-Agent`). Nunca guarda valor: de cada folha sai só a ESPÉCIE (`str`,
 * `num`, `bool`, `null`, `str[]`…). É o que o P11a precisa para saber quem ainda
 * manda a chave velha, e o que o `scripts/census-to-fixture.ts` transforma em
 * fixture do G4 — inclusive as formas do app instalado e do `AnkaaAero`, que
 * ninguém consegue extrair do código de hoje.
 *
 * Tudo aqui é puro (sem Nest, sem Express): o middleware só chama.
 *
 * Gramática do caminho (a mesma que o gerador de fixture lê):
 *   - segmentos separados por `.`;
 *   - elemento de lista: `[n]` quando a ordem importa (lista de `orderBy`, a da
 *     Agenda do app manda o 3º critério em `orderBy[2]`), `[]` nos demais (os
 *     elementos são fundidos: `where.OR[].name.contains`);
 *   - a folha termina em `:<espécie>`;
 *   - chave fora do formato de identificador vira `(?)` e chave só de dígitos
 *     vira `#` — a chave também vem do cliente e não pode carregar um valor.
 */

// ─── limites (o cliente controla tudo o que entra aqui) ─────────────────────

/** Formas distintas guardadas por processo; passado isso, tudo cai num balde. */
export const MAX_CENSUS_SHAPES = 2000;
/** Caminhos por forma (consulta e corpo contam separado). */
export const MAX_PATHS_PER_SHAPE = 300;
export const MAX_PATH_LENGTH = 200;
export const MAX_DEPTH = 12;
/** Índices preservados numa lista ordenada; depois disso o resto é ignorado. */
export const MAX_ORDERED_INDEX = 20;
/** Elementos lidos de uma lista fundida (`[]`). */
export const MAX_ARRAY_SCAN = 50;
/** Tamanho máximo de uma string que se tenta ler como JSON. */
export const MAX_JSON_STRING = 100_000;
/** Prefixo da linha do log; o gerador de fixture procura por ele. */
export const CENSUS_LOG_PREFIX = '[CENSO]';
export const OVERFLOW = '(outros)';
export const TRUNCATED = '(…)';

export type LeafKind =
  | 'str'
  | 'num'
  | 'bool'
  | 'null'
  | 'str[]'
  | 'num[]'
  | 'bool[]'
  | 'mix[]'
  | '[]'
  | '{}'
  | 'file'
  | 'outro';

export interface CensusClient {
  /** `X-App-Version` normalizado (`1.4.1+24`), `(inválido)` ou `null` */
  v: string | null;
  patch: string | null;
  plataforma: string | null;
  /** `X-Client` do web (`web@<build>`) */
  cliente: string | null;
  /** família do User-Agent: `Dart`, `AnkaaAero/1`, `Chrome`, `(sem)`… */
  ua: string;
}

export interface CensusShape extends CensusClient {
  /** `GET /tasks/:id` */
  rota: string;
  consulta: string[];
  corpo: string[];
}

// ─── caminhos ───────────────────────────────────────────────────────────────

const IDENT = /^[A-Za-z_$][\w$-]{0,63}$/;
/** Chaves cujos filhos em lista mantêm a posição. */
const ORDERED_KEYS = new Set(['orderBy']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Date) &&
    !Buffer.isBuffer(v)
  );
}

function safeKey(k: string): string {
  if (/^\d{1,9}$/.test(k)) return '#';
  return IDENT.test(k) ? k : '(?)';
}

function scalarKind(v: unknown): 'str' | 'num' | 'bool' | 'null' | 'outro' {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return 'str';
  if (typeof v === 'number' || typeof v === 'bigint') return 'num';
  if (typeof v === 'boolean') return 'bool';
  return 'outro';
}

/** String que é JSON de objeto/lista (query e multipart mandam assim) → o valor. */
function parseJsonString(v: string): unknown {
  const t = v.trim();
  if (t.length < 2 || t.length > MAX_JSON_STRING) return undefined;
  if (!((t[0] === '{' && t.endsWith('}')) || (t[0] === '[' && t.endsWith(']')))) return undefined;
  try {
    const parsed = JSON.parse(t);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

interface WalkOptions {
  /** lê string com cara de JSON como objeto (query string e multipart) */
  jsonStrings: boolean;
}

class PathCollector {
  readonly paths = new Set<string>();
  truncated = false;

  add(path: string, kind: LeafKind): void {
    if (this.truncated) return;
    const cut =
      path.length > MAX_PATH_LENGTH ? `${path.slice(0, MAX_PATH_LENGTH)}${TRUNCATED}` : path;
    const entry = `${cut}:${kind}`;
    if (this.paths.has(entry)) return;
    if (this.paths.size >= MAX_PATHS_PER_SHAPE) {
      this.truncated = true;
      return;
    }
    this.paths.add(entry);
  }

  list(): string[] {
    const out = [...this.paths].sort();
    if (this.truncated) out.push(TRUNCATED);
    return out;
  }
}

function join(prefix: string, seg: string): string {
  if (!prefix) return seg;
  return seg.startsWith('[') ? `${prefix}${seg}` : `${prefix}.${seg}`;
}

function walk(
  value: unknown,
  path: string,
  parentKey: string | null,
  depth: number,
  out: PathCollector,
  opts: WalkOptions,
): void {
  if (out.truncated) return;
  if (depth > MAX_DEPTH) {
    out.add(join(path, TRUNCATED), 'outro');
    return;
  }
  if (typeof value === 'string' && opts.jsonStrings) {
    const parsed = parseJsonString(value);
    if (parsed !== undefined) {
      walk(parsed, path, parentKey, depth, out, opts);
      return;
    }
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.add(path, '[]');
      return;
    }
    const objects = value.filter(isPlainObject);
    if (objects.length === 0) {
      const kinds = new Set(value.slice(0, MAX_ARRAY_SCAN).map(scalarKind));
      const only = kinds.size === 1 ? [...kinds][0] : null;
      out.add(path, only === 'str' || only === 'num' || only === 'bool' ? `${only}[]` : 'mix[]');
      return;
    }
    if (parentKey !== null && ORDERED_KEYS.has(parentKey)) {
      value.slice(0, MAX_ORDERED_INDEX).forEach((el, i) => {
        if (isPlainObject(el)) walk(el, join(path, `[${i}]`), null, depth + 1, out, opts);
      });
    } else {
      for (const el of objects.slice(0, MAX_ARRAY_SCAN))
        walk(el, join(path, '[]'), null, depth + 1, out, opts);
    }
    return;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      out.add(path, '{}');
      return;
    }
    for (const [k, v] of entries) {
      if (v === undefined) continue;
      walk(v, join(path, safeKey(k)), k, depth + 1, out, opts);
    }
    return;
  }
  out.add(path, scalarKind(value));
}

/** Caminhos de chave da query string (já passada pelo `qs`). */
export function queryPaths(query: unknown): string[] {
  const out = new PathCollector();
  if (isPlainObject(query)) walk(query, '', null, 0, out, { jsonStrings: true });
  return out.list();
}

/**
 * Caminhos de chave do corpo. JSON: como veio. Multipart: os nomes de campo que
 * o multer montou (`jsonStrings`: o web manda objeto como JSON dentro do campo)
 * e cada arquivo como `<campo>:file`.
 */
export function bodyPaths(
  body: unknown,
  opts: { multipart?: boolean; fileFields?: string[] } = {},
): string[] {
  const out = new PathCollector();
  if (isPlainObject(body) || Array.isArray(body)) {
    walk(body, '', null, 0, out, { jsonStrings: !!opts.multipart });
  }
  for (const field of opts.fileFields ?? []) {
    // `files[0]`, `layouts[2][file]`: o índice do multer não é forma
    const segs = field
      .split(/[[\]]+/)
      .filter(Boolean)
      .map(s => (/^\d+$/.test(s) ? '[]' : safeKey(s)));
    out.add(
      segs.reduce((p, s) => join(p, s), ''),
      'file',
    );
  }
  return out.list();
}

// ─── cliente ────────────────────────────────────────────────────────────────

const HEADER_TOKEN = /^[\w.@+\-/]{1,64}$/;
const INVALID = '(inválido)';

/** Valor de cabeçalho curto (versão, patch, plataforma, X-Client): formato ou `(inválido)`. */
export function headerToken(v: string | string[] | undefined): string | null {
  const value = Array.isArray(v) ? v[0] : v;
  if (value === undefined || value === null) return null;
  const t = String(value).trim();
  if (!t) return null;
  return HEADER_TOKEN.test(t) ? t : INVALID;
}

/**
 * Família do User-Agent, nunca a string inteira (ela carrega versão de SO e de
 * aparelho, que não servem ao censo e incham o log). `AnkaaAero` guarda o build
 * porque é o único jeito de saber qual está instalado no iPad.
 */
export function uaFamily(ua: string | string[] | undefined): string {
  const s = (Array.isArray(ua) ? ua[0] : ua)?.trim();
  if (!s) return '(sem)';
  const aero = /^AnkaaAero\/([\w.]{1,16})/.exec(s);
  if (aero) return `AnkaaAero/${aero[1]}`;
  if (/^Dart\//.test(s)) return 'Dart';
  if (/^Expo\//.test(s)) return 'Expo';
  if (/^okhttp\//i.test(s)) return 'okhttp';
  if (/^curl\//.test(s)) return 'curl';
  if (/^PostmanRuntime\//.test(s)) return 'Postman';
  if (/^(node|undici|axios)\b/i.test(s)) return 'node';
  const mobile = /Mobile|Android|iPhone|iPad/.test(s) ? ' (móvel)' : '';
  if (/Edg(A|iOS)?\//.test(s)) return `Edge${mobile}`;
  if (/OPR\//.test(s)) return `Opera${mobile}`;
  if (/Firefox\/|FxiOS\//.test(s)) return `Firefox${mobile}`;
  if (/Chrome\/|CriOS\//.test(s)) return `Chrome${mobile}`;
  if (/Safari\//.test(s)) return `Safari${mobile}`;
  return 'outro';
}

type Headers = Record<string, string | string[] | undefined>;

export function censusClient(headers: Headers, appVersionRaw: string | null): CensusClient {
  const versionHeader = headerToken(headers['x-app-version']);
  return {
    v: appVersionRaw ?? (versionHeader === null ? null : INVALID),
    patch: headerToken(headers['x-app-patch']),
    plataforma: headerToken(headers['x-app-platform']),
    cliente: headerToken(headers['x-client']),
    ua: uaFamily(headers['user-agent']),
  };
}

// ─── registro por processo ──────────────────────────────────────────────────

/**
 * Conjunto em memória das formas já vistas neste processo. `record` devolve a
 * forma quando ela é NOVA (é a linha que vai ao log) e `null` quando já foi
 * vista. Passado o teto, toda forma nova cai no balde `(outros)`, que é logado
 * uma vez — o censo nunca cresce sem fim nem inunda o log.
 */
export class CensusRegistry {
  private readonly counts = new Map<string, number>();

  constructor(private readonly max = MAX_CENSUS_SHAPES) {}

  record(shape: CensusShape): CensusShape | null {
    let key = JSON.stringify(shape);
    let emitted: CensusShape = shape;
    if (!this.counts.has(key) && this.counts.size >= this.max) {
      key = OVERFLOW;
      emitted = {
        rota: OVERFLOW,
        v: null,
        patch: null,
        plataforma: null,
        cliente: null,
        ua: OVERFLOW,
        consulta: [],
        corpo: [],
      };
    }
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n === 1 ? emitted : null;
  }

  /** forma (JSON) → quantas vezes; para teste e para quem quiser um retrato */
  counters(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  get size(): number {
    return this.counts.size;
  }

  reset(): void {
    this.counts.clear();
  }
}

/** O registro do processo (um por instância da API). */
export const censusRegistry = new CensusRegistry();
