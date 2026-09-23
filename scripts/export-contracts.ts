/**
 * G5 — O FIM DOS ESPELHOS À MÃO: a API exporta o que web e app copiavam.
 *
 * Web e app mantinham cópias escritas à mão de enums, rótulos, do grafo de
 * status do orçamento e das chaves que a API aceita — e cada cópia divergia em
 * silêncio (a prévia do boleto no web usava as palavras da NFS-e; o app tinha
 * três mapas de tipo de implemento). Este script lê as FONTES da API e grava:
 *
 *   contracts/labels.json
 *     - `perfis`: os rótulos de categoria e de implemento por DOCUMENTO
 *       (`src/constants/document-labels.ts`, D-18) — tela, NFS-e da tarefa,
 *       NFS-e do aerografista, boleto, fatura, changelog do web;
 *     - `tela`: todo mapa `*_LABELS` de `src/constants/enum-labels.ts`, com o
 *       enum que ele rotula quando o nome casa (`X_LABELS` ↔ `X`).
 *
 *   contracts/enums.json
 *     - `enums`: todo enum de texto de `src/constants/enums.ts`, na ordem;
 *     - `orcamento`: as transições MANUAIS de `Budget.status` como a API as
 *       aceita hoje (derivadas chamando o validador real, par a par) e a ordem
 *       de listagem (`TASK_QUOTE_STATUS_ORDER`);
 *     - `notificacoes`: as chaves de configuração do seed
 *       (`prisma/scripts/seed-notification-configs.ts`);
 *     - `multipart`: os campos de arquivo que cada rota aceita
 *       (`FileInterceptor`/`FilesInterceptor`/`FileFieldsInterceptor`);
 *     - `fileContexts`: os `fileContext` que o armazenamento reconhece
 *       (`folderMapping` de `files-storage.service.ts`).
 *
 * Faces do implemento NÃO entram na Fase A (a constante é do P04; entram no
 * P11 junto com `'front'`).
 *
 * A saída é DETERMINÍSTICA (sem data, chaves na ordem das fontes): o teste
 * `tests/labels-exhaustive.test.ts` regera em memória e exige igualdade com o
 * que está versionado — contrato velho reprova.
 *
 * Uso:
 *   npx tsx scripts/export-contracts.ts                 grava contracts/{labels,enums}.json
 *   npx tsx scripts/export-contracts.ts --check         só confere (sai 1 se desatualizado)
 *   npx tsx scripts/export-contracts.ts --out <dir>     também copia os dois JSON para <dir>
 *                                                       (web: ../web/src/generated/contracts)
 *   npx tsx scripts/export-contracts.ts --dart <file>   também gera o .dart do app
 *                                                       (../mobile-flutter/lib/generated/contracts/labels.dart)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import * as ts from 'typescript';
import { Logger } from '@nestjs/common';
import * as ENUMS from '../src/constants/enums';
import * as ENUM_LABELS from '../src/constants/enum-labels';
import {
  IMPLEMENT_TYPE_PROFILE_LABELS,
  LABEL_PROFILES,
  LABEL_PROFILE_READERS,
  TRUCK_CATEGORY_PROFILE_LABELS,
} from '../src/constants/document-labels';
import { TASK_QUOTE_STATUS_ORDER } from '../src/constants/sortOrders';
import { BudgetService } from '../src/modules/production/budget/budget.service';
import { FilesStorageService } from '../src/modules/common/file/services/files-storage.service';

const ROOT = join(__dirname, '..');
export const CONTRACTS_DIR = join(ROOT, 'contracts');
const GENERATED_BY =
  'GERADO por api/scripts/export-contracts.ts — NÃO EDITE À MÃO. Regerar: npx tsx scripts/export-contracts.ts';

type StringMap = Record<string, string>;

// ─── enums ──────────────────────────────────────────────────────────────────

/** Todo enum de TEXTO de `src/constants/enums.ts`, com os valores na ordem. */
function collectEnums(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(ENUMS)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) continue;
    // Enum de texto: todo valor é string (enum numérico tem o mapa reverso).
    if (!entries.every(([, v]) => typeof v === 'string')) continue;
    out[name] = entries.map(([, v]) => v as string);
  }
  return out;
}

// ─── rótulos ────────────────────────────────────────────────────────────────

function isStringMap(value: unknown): value is StringMap {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value as object).length > 0 &&
    Object.values(value as object).every(v => typeof v === 'string')
  );
}

function collectScreenLabels(enums: Record<string, string[]>): Record<string, { enum: string | null; labels: StringMap }> {
  const out: Record<string, { enum: string | null; labels: StringMap }> = {};
  for (const [name, value] of Object.entries(ENUM_LABELS)) {
    if (!name.endsWith('_LABELS') || !isStringMap(value)) continue;
    const enumName = name.slice(0, -'_LABELS'.length);
    out[name] = { enum: enums[enumName] ? enumName : null, labels: { ...value } };
  }
  return out;
}

function collectProfiles() {
  const byProfile = (source: Readonly<Record<string, Readonly<StringMap>>>) =>
    Object.fromEntries(LABEL_PROFILES.map(p => [p, { ...source[p] }]));
  return {
    leitores: { ...LABEL_PROFILE_READERS },
    TRUCK_CATEGORY: byProfile(TRUCK_CATEGORY_PROFILE_LABELS),
    IMPLEMENT_TYPE: byProfile(IMPLEMENT_TYPE_PROFILE_LABELS),
  };
}

// ─── orçamento: grafo manual e ordem ────────────────────────────────────────

/**
 * As transições que `PUT /budgets/:id/status` aceita HOJE, derivadas do
 * validador real (`BudgetService.validateStatusTransition`) par a par — a
 * tabela `ALLOWED` é privada de propósito, e ler o comportamento é mais
 * honesto do que copiá-la.
 */
function collectBudgetGraph(statuses: string[]): Record<string, string[]> {
  const validate = (BudgetService.prototype as any).validateStatusTransition as (
    from: string,
    to: string,
  ) => void;
  const graph: Record<string, string[]> = {};
  for (const from of statuses) {
    graph[from] = statuses.filter(to => {
      if (to === from) return false;
      try {
        validate.call({}, from, to);
        return true;
      } catch {
        return false;
      }
    });
  }
  return graph;
}

// ─── notificações ───────────────────────────────────────────────────────────

function collectNotificationKeys(): string[] {
  const seed = readFileSync(join(ROOT, 'prisma/scripts/seed-notification-configs.ts'), 'utf8');
  const keys = new Set<string>();
  for (const m of seed.matchAll(/\bkey:\s*["'`]([^"'`]+)["'`]/g)) keys.add(m[1]);
  return [...keys].sort();
}

// ─── multipart ──────────────────────────────────────────────────────────────

interface MultipartRoute {
  rota: string;
  arquivo: string;
  interceptor: string;
  /** `null` quando o interceptor aceita qualquer campo (`AnyFilesInterceptor`). */
  campos: Array<{ nome: string; maxCount: number | null }> | null;
  /** Campos que o leitor estático não conseguiu resolver (montados por código). */
  naoResolvido?: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

function literalText(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function numberOf(node: ts.Expression | undefined): number | null {
  if (node && ts.isNumericLiteral(node)) return Number(node.text);
  return null;
}

function decoratorsOf(node: ts.Node): ts.Decorator[] {
  return (ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined)?.slice() ?? [];
}

function callName(expr: ts.Expression): string | null {
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) return expr.expression.text;
  return null;
}

/** O caminho de `@Controller('x')` / `@Controller({ path: 'x' })`. */
function controllerPath(cls: ts.ClassDeclaration): string {
  for (const d of decoratorsOf(cls)) {
    const e = d.expression;
    if (!ts.isCallExpression(e) || callName(e) !== 'Controller') continue;
    const arg = e.arguments[0];
    const lit = literalText(arg);
    if (lit !== null) return lit;
    // `@Controller(['budgets', 'task-quotes'])`: o primeiro é o nome canônico.
    if (arg && ts.isArrayLiteralExpression(arg)) return literalText(arg.elements[0]) ?? '';
    if (arg && ts.isObjectLiteralExpression(arg)) {
      for (const p of arg.properties) {
        if (ts.isPropertyAssignment(p) && p.name.getText() === 'path') {
          return literalText(p.initializer) ?? '';
        }
      }
    }
    return '';
  }
  return '';
}

const HTTP = ['Get', 'Post', 'Put', 'Patch', 'Delete'];

function joinPath(base: string, sub: string): string {
  const parts = [base, sub].map(s => s.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return `/${parts.join('/')}`;
}

function fieldsOf(call: ts.CallExpression, name: string): Pick<MultipartRoute, 'campos' | 'naoResolvido'> {
  if (name === 'AnyFilesInterceptor') return { campos: null };
  if (name === 'FileInterceptor' || name === 'FilesInterceptor') {
    const field = literalText(call.arguments[0]);
    if (field === null) return { campos: [], naoResolvido: call.arguments[0]?.getText() ?? '' };
    const max = name === 'FileInterceptor' ? 1 : numberOf(call.arguments[1]);
    return { campos: [{ nome: field, maxCount: max }] };
  }
  // FileFieldsInterceptor([{ name, maxCount }, ...])
  const arr = call.arguments[0];
  if (!arr || !ts.isArrayLiteralExpression(arr)) {
    return { campos: [], naoResolvido: arr?.getText() ?? '' };
  }
  const campos: Array<{ nome: string; maxCount: number | null }> = [];
  const unresolved: string[] = [];
  for (const el of arr.elements) {
    if (!ts.isObjectLiteralExpression(el)) {
      unresolved.push(el.getText());
      continue;
    }
    let nome: string | null = null;
    let maxCount: number | null = null;
    for (const p of el.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const key = p.name.getText();
      if (key === 'name') nome = literalText(p.initializer);
      if (key === 'maxCount') maxCount = numberOf(p.initializer);
    }
    if (nome === null) unresolved.push(el.getText());
    else campos.push({ nome, maxCount });
  }
  return unresolved.length > 0 ? { campos, naoResolvido: unresolved.join(', ') } : { campos };
}

function collectMultipart(): MultipartRoute[] {
  const out: MultipartRoute[] = [];
  const files = walk(join(ROOT, 'src/modules')).sort();
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node)) {
        const base = controllerPath(node);
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          const decorators = decoratorsOf(member);
          let verb: string | null = null;
          let sub = '';
          for (const d of decorators) {
            const n = callName(d.expression);
            if (n && HTTP.includes(n)) {
              verb = n.toUpperCase();
              sub = literalText((d.expression as ts.CallExpression).arguments[0]) ?? '';
            }
          }
          for (const d of decorators) {
            if (callName(d.expression) !== 'UseInterceptors') continue;
            for (const arg of (d.expression as ts.CallExpression).arguments) {
              if (!ts.isCallExpression(arg)) continue;
              const name = callName(arg);
              if (
                !name ||
                !['FileInterceptor', 'FilesInterceptor', 'FileFieldsInterceptor', 'AnyFilesInterceptor'].includes(name)
              ) {
                continue;
              }
              out.push({
                rota: `${verb ?? '?'} ${joinPath(base, sub)}`,
                arquivo: relative(ROOT, file),
                interceptor: name,
                ...fieldsOf(arg, name),
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

// ─── fileContext ────────────────────────────────────────────────────────────

function collectFileContexts(): string[] {
  const storage = new FilesStorageService({} as any);
  return storage.getKnownFileContexts();
}

// ─── montagem ───────────────────────────────────────────────────────────────

export interface Contracts {
  labels: Record<string, unknown>;
  enums: Record<string, unknown>;
}

export function buildContracts(): Contracts {
  const enums = collectEnums();
  const quoteStatuses = enums.TASK_QUOTE_STATUS ?? [];
  return {
    labels: {
      _gerado: GENERATED_BY,
      _fontes: ['src/constants/document-labels.ts', 'src/constants/enum-labels.ts'],
      perfis: collectProfiles(),
      tela: collectScreenLabels(enums),
    },
    enums: {
      _gerado: GENERATED_BY,
      _fontes: [
        'src/constants/enums.ts',
        'src/modules/production/budget/budget.service.ts (validateStatusTransition)',
        'src/constants/sortOrders.ts (TASK_QUOTE_STATUS_ORDER)',
        'prisma/scripts/seed-notification-configs.ts',
        'src/modules/**/*.controller.ts (interceptadores de arquivo)',
        'src/modules/common/file/services/files-storage.service.ts (folderMapping)',
      ],
      enums,
      orcamento: {
        status: quoteStatuses,
        transicoesManuais: collectBudgetGraph(quoteStatuses),
        ordem: { ...TASK_QUOTE_STATUS_ORDER },
      },
      notificacoes: collectNotificationKeys(),
      multipart: collectMultipart(),
      fileContexts: collectFileContexts(),
    },
  };
}

export const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

// ─── Dart (app) ─────────────────────────────────────────────────────────────

/** Mapas de TELA que o app consome do contrato (além dos perfis). */
const DART_SCREEN_MAPS: Array<{ map: string; dartName: string }> = [
  { map: 'TASK_STATUS_LABELS', dartName: 'kContractTaskStatusLabels' },
];

const PROFILE_DART_SUFFIX: Record<string, string> = {
  screen: 'Screen',
  nfseTask: 'NfseTask',
  nfsePainter: 'NfsePainter',
  boleto: 'Boleto',
  invoice: 'Invoice',
  webChangelog: 'WebChangelog',
};

function dartString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')}'`;
}

function dartMap(name: string, map: StringMap, doc: string): string {
  const body = Object.entries(map)
    .map(([k, v]) => `  ${dartString(k)}: ${dartString(v)},`)
    .join('\n');
  return `/// ${doc}\nconst Map<String, String> ${name} = {\n${body}\n};\n`;
}

function dartList(name: string, values: string[], doc: string): string {
  const body = values.map(v => `  ${dartString(v)},`).join('\n');
  return `/// ${doc}\nconst List<String> ${name} = [\n${body}\n];\n`;
}

export function buildDart(contracts: Contracts): string {
  const labels = contracts.labels as any;
  const enums = (contracts.enums as any).enums as Record<string, string[]>;
  const chunks: string[] = [
    '// GERADO por api/scripts/export-contracts.ts --dart — NÃO EDITE À MÃO.',
    '// Fonte: api/src/constants/document-labels.ts (perfis por documento, D-18)',
    '// e api/src/constants/enum-labels.ts. Regerar a partir do repositório da api:',
    '//   npx tsx scripts/export-contracts.ts --dart ../mobile-flutter/lib/generated/contracts/labels.dart',
    '//',
    '// É .dart e não asset de propósito: asset novo não viaja em patch OTA.',
    '// ignore_for_file: lines_longer_than_80_chars',
    'library;',
    '',
    dartList('kContractTruckCategoryValues', enums.TRUCK_CATEGORY, 'Os valores de `TRUCK_CATEGORY`, na ordem da API.'),
    dartList('kContractImplementTypeValues', enums.IMPLEMENT_TYPE, 'Os valores de `IMPLEMENT_TYPE`, na ordem da API.'),
    dartList('kContractTaskStatusValues', enums.TASK_STATUS, 'Os valores de `TASK_STATUS`, na ordem da API.'),
  ];
  for (const [kind, prefix] of [
    ['TRUCK_CATEGORY', 'kContractTruckCategoryLabels'],
    ['IMPLEMENT_TYPE', 'kContractImplementTypeLabels'],
  ] as const) {
    for (const profile of LABEL_PROFILES) {
      chunks.push(
        dartMap(
          `${prefix}${PROFILE_DART_SUFFIX[profile]}`,
          labels.perfis[kind][profile],
          `\`${kind}\`, perfil \`${profile}\`: ${labels.perfis.leitores[profile]}.`,
        ),
      );
    }
  }
  for (const { map, dartName } of DART_SCREEN_MAPS) {
    chunks.push(dartMap(dartName, labels.tela[map].labels, `\`${map}\` (tela).`));
  }
  return `${chunks.join('\n')}`;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function writeIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}

function main(): void {
  Logger.overrideLogger(false);
  const contracts = buildContracts();
  const files: Array<[string, string]> = [
    [join(CONTRACTS_DIR, 'labels.json'), serialize(contracts.labels)],
    [join(CONTRACTS_DIR, 'enums.json'), serialize(contracts.enums)],
  ];

  if (process.argv.includes('--check')) {
    const stale = files.filter(([p, c]) => !existsSync(p) || readFileSync(p, 'utf8') !== c);
    if (stale.length > 0) {
      console.error(
        `Contratos desatualizados: ${stale.map(([p]) => relative(ROOT, p)).join(', ')}. ` +
          'Rode: npx tsx scripts/export-contracts.ts',
      );
      process.exit(1);
    }
    console.log('Contratos em dia.');
    return;
  }

  const out = argValue('--out');
  if (out) {
    files.push([join(out, 'labels.json'), serialize(contracts.labels)]);
    files.push([join(out, 'enums.json'), serialize(contracts.enums)]);
  }
  const dart = argValue('--dart');
  if (dart) files.push([dart, buildDart(contracts)]);

  for (const [path, content] of files) {
    const changed = writeIfChanged(path, content);
    console.log(`${changed ? 'gravado ' : 'igual   '} ${path}`);
  }
  const multipart = (contracts.enums as any).multipart as MultipartRoute[];
  const unresolved = multipart.filter(m => m.naoResolvido);
  if (unresolved.length > 0) {
    console.log(`\n${unresolved.length} rota(s) com campo multipart montado por código:`);
    for (const m of unresolved) console.log(`  ${m.rota} (${m.arquivo}): ${m.naoResolvido}`);
  }
}

if (require.main === module) main();
