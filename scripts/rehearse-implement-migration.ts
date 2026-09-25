/**
 * ENSAIO DA R-B — as fatias de migração do rework do implemento, aplicadas numa
 * transação REVERTIDA (PLANO §4.1, §4.4, §4.6; nota docs/implemento/notas/P10.md).
 *
 * O que faz, em ordem:
 *   1. Descobre as fatias da R-B AINDA NÃO APLICADAS no banco (`_prisma_migrations`), lendo cada
 *      uma de `prisma/migrations/<fatia>/` se já foi promovida ou de `prisma/staged/r-b/<fatia>/`.
 *   2. Abre UMA transação, mede o "antes" (contagens e a arte/série que cada coleta
 *      RUNNING/COMPLETED congelou), aplica as fatias pendentes em ordem de carimbo e, depois de
 *      cada uma, roda as invariantes DELA (§4.6) e confere os objetos de banco dela (G25 da R-B,
 *      `prisma/sql/objetos-r-b.sql`).
 *   3. Imprime as contagens do §4.4 (achado × referência do clone e de produção), a triagem
 *      (`_Mig0924_Triage`: LEGACY_APPROVED_UNSIGNED, LEGACY_COMPLETED_NOT_APPROVED,
 *      QUOTE_ART_APPROVED_BY_LIVE_ENVELOPE, GALLERY_SUPERSEDED_BY_QUOTE, GALLERY_APPROVED_VS_QUOTE_PENDING…)
 *      e as séries fora da regex.
 *   4. G11-DADOS: para cada coleta RUNNING/COMPLETED, a arte (`layoutFileIds`, `layoutCoverage`) e os
 *      veículos (série, placa, chassi, categoria, tipo) que o banco daria ANTES e DEPOIS, contra o
 *      congelado. Critério: QUEM CASAVA ANTES CASA DEPOIS. É a régua da migração no nível do dado;
 *      o G11 com o código novo (`quoteArtworkOf` no `build()`) é do P12 — rode-o com `--deriva --comando`.
 *   5. REVERTE (ROLLBACK sempre, dê certo ou não) e grava o relatório em `.tmp/ensaio-r-b/<data>.json`.
 *
 * `--deriva` ("sem deriva"): cria `<banco>_ensaio_rb` com `CREATE DATABASE … TEMPLATE <banco>` (ligado
 * no banco `postgres`; exige ninguém conectado no banco de origem), aplica as fatias DE VERDADE com
 * `prisma migrate deploy` (pasta temporária = prisma/migrations + as fatias pendentes, esquema =
 * `schema.alvo.prisma`), roda as mesmas invariantes e o G25, e exige que
 * `prisma migrate diff --from-url <ensaio> --to-schema-datamodel schema.alvo.prisma` só acuse a deriva
 * que o banco JÁ tinha antes (a mesma comparação feita contra o `schema.prisma` de hoje) e os
 * SOBREVIVENTES NOMEADOS (tabelas `_Mig0924_*`, `File.quoteLayoutId` + FK + índice e `BudgetLayoutTask`,
 * que caem na M4). `--comando "<cmd>"` roda um comando com DATABASE_URL apontando para o banco
 * migrado (ex.: o G11 com o código novo, no P12). O banco descartável é APAGADO no fim, mesmo com erro.
 *
 * Uso (SEMPRE com o banco da Fase B: `source …/scratchpad/implemento-env.sh`):
 *   npx tsx scripts/rehearse-implement-migration.ts                 ensaio revertido
 *   npx tsx scripts/rehearse-implement-migration.ts --saida x.json  idem, relatório em x.json
 *   npx tsx scripts/rehearse-implement-migration.ts --deriva [--comando "npm run -s test:signature-golden"]
 *   … --banco-de-producao   obrigatório quando o nome do banco contém "production"/"veiculos"
 *                           (em produção, P30: o dono roda o MESMO script; a transação é revertida)
 *
 * Saída: 0 = todas as invariantes no esperado; 1 = alguma fora (ou fatia que falhou); 2 = uso errado.
 */
import { spawnSync } from 'child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

// ─── pg sem tipos no repositório: a interface mínima que o ensaio usa ───
interface PgResult {
  rows: Array<Record<string, any>>;
  rowCount: number | null;
}
interface PgClient {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<any>;
  end(): Promise<void>;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = require('pg') as { Client: new (cfg: { connectionString: string }) => PgClient };

const ROOT = join(__dirname, '..');
// A R-B foi TODA promovida na integração do par [P14 ∥ P13b] (G36 = 0): as fatias
// moram em `prisma/migrations/`, o esquema-alvo É o `schema.prisma` e os objetos
// de banco de cada fatia (G25 da R-B) foram para `prisma/sql/objetos-r-b.sql`. O
// ensaio continua valendo para o P30: ele aplica, num banco que ainda não as
// tem (produção, o clone), as fatias que faltam — agora lidas das migrations.
const STAGED = join(ROOT, 'prisma/staged/r-b');
const MIGRATIONS = join(ROOT, 'prisma/migrations');
const ALVO = join(ROOT, 'prisma/schema.prisma');
const OBJETOS_RB = join(ROOT, 'prisma/sql/objetos-r-b.sql');
const M0 = '20260930100000_arte_estados_e_tipos';

export type FatiaId = 'M1' | 'M1s' | 'Mnom' | 'M5s' | 'M2' | 'M3' | 'M3o-a' | 'M3o-b';
export const FATIAS: ReadonlyArray<{ id: FatiaId; nome: string; promotor: string }> = [
  { id: 'M1', nome: '20260930120000_truck_vira_implement', promotor: 'P11a' },
  {
    id: 'M1s',
    nome: '20260930120050_serie_no_implemento_e_implemento_obrigatorio',
    promotor: 'P11a',
  },
  // DD13 (24/09): o nome antigo do implemento sai também dos dados.
  { id: 'Mnom', nome: '20260930120060_implemento_nomenclatura_completa', promotor: 'P11a (DD13)' },
  // Decisão de 25/09: a série só no implemento — o espelho da tarefa cai na mesma release.
  { id: 'M5s', nome: '20260930120070_serie_so_no_implemento', promotor: 'P11a (série)' },
  { id: 'M2', nome: '20260930120100_implemento_frente_e_porta_traseira', promotor: 'P11b' },
  { id: 'M3', nome: '20260930120200_arte_do_implemento_e_projeto_da_tarefa', promotor: 'P12' },
  {
    id: 'M3o-a',
    nome: '20260930120300_orcamento_eixo_da_assinatura',
    promotor: 'P14 (commit zero)',
  },
  { id: 'M3o-b', nome: '20260930120350_orcamento_valor_aprovado', promotor: 'P14 (fim)' },
];

// ─── argumentos ───
interface Opcoes {
  deriva: boolean;
  comando: string | null;
  saida: string | null;
  bancoDeProducao: boolean;
  silencioso: boolean;
}
function lerOpcoes(argv: string[]): Opcoes {
  const o: Opcoes = {
    deriva: false,
    comando: null,
    saida: null,
    bancoDeProducao: false,
    silencioso: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--deriva') o.deriva = true;
    else if (a === '--comando') o.comando = argv[++i] ?? null;
    else if (a === '--saida') o.saida = argv[++i] ?? null;
    else if (a === '--banco-de-producao') o.bancoDeProducao = true;
    else if (a === '--silencioso') o.silencioso = true;
    else {
      console.error(`argumento desconhecido: ${a}`);
      process.exit(2);
    }
  }
  if (o.comando && !o.deriva) {
    console.error('--comando só vale com --deriva (precisa de um banco migrado de verdade)');
    process.exit(2);
  }
  return o;
}

// ─── relatório ───
interface Invariante {
  fatia: FatiaId | 'geral' | 'G11-dados';
  nome: string;
  esperado: number | string;
  achado: number | string;
  ok: boolean;
}
interface Relatorio {
  geradoEm: string;
  banco: string;
  modo: 'ensaio' | 'deriva';
  fatias: Array<{
    id: FatiaId;
    nome: string;
    fonte: string;
    jaAplicada: boolean;
    ms?: number;
    erro?: string;
  }>;
  antes: Record<string, number>;
  depois: Record<string, number>;
  invariantes: Invariante[];
  anotadas: Array<{
    fatia: string;
    nome: string;
    achado: number | string;
    clone?: number | string;
    producao?: number | string;
  }>;
  triagem: Record<string, number>;
  seriesForaDaRegex: number;
  distribuicaoOrcamento: Array<{ status: string; signatureStatus: string; n: number }>;
  g11: {
    envelopes: Array<{
      envelopeId: string;
      budgetNumber: number | null;
      status: string;
      casavaAntes: boolean;
      casaDepois: boolean;
      diferencaAntes?: string;
      diferencaDepois?: string;
    }>;
    pararamDeCasar: string[];
    casosNomeados: Record<string, string>;
  } | null;
  g25: Array<{ fatia: string; objeto: string; existe: boolean }>;
  deriva?: { novas: string[]; sobreviventes: string[]; somemDaDeriva: number; ok: boolean };
  ok: boolean;
}

let silencioso = false;
const log = (s = '') => {
  if (!silencioso) console.log(s);
};

// ─── utilidades de banco ───
async function rows(
  c: PgClient,
  sql: string,
  params?: unknown[],
): Promise<Array<Record<string, any>>> {
  const r = (await c.query(sql, params)) as PgResult;
  return r.rows;
}
async function num(c: PgClient, sql: string, params?: unknown[]): Promise<number> {
  const r = await rows(c, sql, params);
  const v = r[0] ? Object.values(r[0])[0] : 0;
  return Number(v ?? 0);
}
async function existe(c: PgClient, rel: string): Promise<boolean> {
  return (
    (await num(c, `SELECT (to_regclass($1) IS NOT NULL)::int AS n`, [`public."${rel}"`])) === 1
  );
}
async function temColuna(c: PgClient, tabela: string, coluna: string): Promise<boolean> {
  return (
    (await num(
      c,
      `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
      [tabela, coluna],
    )) > 0
  );
}
function nomeDoBanco(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}
function urlComBanco(url: string, banco: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(banco)}`;
  return u.toString();
}
/** Linha (1-based) de uma posição de erro do Postgres dentro do SQL da fatia. */
function linhaDoErro(sql: string, posicao?: string | number): string {
  const p = Number(posicao);
  if (!p) return '';
  return ` (linha ${sql.slice(0, p).split('\n').length})`;
}
async function esperaErro(
  c: PgClient,
  sql: string,
  codigo: string | RegExp,
  params?: unknown[],
): Promise<string | null> {
  await c.query('SAVEPOINT ensaio_rb_erro');
  try {
    await c.query(sql, params);
    await c.query('ROLLBACK TO SAVEPOINT ensaio_rb_erro');
    return 'não falhou';
  } catch (e: any) {
    await c.query('ROLLBACK TO SAVEPOINT ensaio_rb_erro');
    const bate = typeof codigo === 'string' ? e.code === codigo : codigo.test(String(e.message));
    return bate ? null : `falhou com ${e.code}: ${e.message}`;
  }
}

// ─── estado do banco (o ensaio vale do P10 ao P30: parte das fatias pode já estar aplicada) ───
interface Estado {
  veiculo: 'Implement' | 'Truck';
  colunaTipo: 'type' | 'implementType';
  serieNoImplemento: boolean;
  /** `Task.serialNumber` ainda existe (antes da M5s) */
  serieNaTarefa: boolean;
  arteNoImplemento: boolean;
  temQuoteLayout: boolean;
  temBudgetLayoutTask: boolean;
}
async function lerEstado(c: PgClient): Promise<Estado> {
  const veiculo = (await existe(c, 'Implement')) ? 'Implement' : 'Truck';
  return {
    veiculo,
    colunaTipo: (await temColuna(c, veiculo, 'type')) ? 'type' : 'implementType',
    serieNoImplemento: veiculo === 'Implement' && (await temColuna(c, 'Implement', 'serialNumber')),
    serieNaTarefa: await temColuna(c, 'Task', 'serialNumber'),
    arteNoImplemento: await temColuna(c, 'Layout', 'implementId'),
    temQuoteLayout: await temColuna(c, 'File', 'quoteLayoutId'),
    temBudgetLayoutTask: await existe(c, 'BudgetLayoutTask'),
  };
}

async function contagens(c: PgClient): Promise<Record<string, number>> {
  const e = await lerEstado(c);
  const out: Record<string, number> = {
    Task: await num(c, `SELECT count(*) FROM "Task"`),
    [e.veiculo]: await num(c, `SELECT count(*) FROM "${e.veiculo}"`),
    File: await num(c, `SELECT count(*) FROM "File"`),
    Budget: await num(c, `SELECT count(*) FROM "Budget"`),
    Layout: await num(c, `SELECT count(*) FROM "Layout"`),
    LayoutAerografia: await num(
      c,
      `SELECT count(*) FROM "Layout" WHERE "airbrushingId" IS NOT NULL`,
    ),
    ImplementMeasure: await num(c, `SELECT count(*) FROM "ImplementMeasure"`),
    SignatureEnvelope: await num(c, `SELECT count(*) FROM "SignatureEnvelope"`),
    seriesPreenchidas: await num(
      c,
      e.serieNaTarefa
        ? `SELECT count(*) FROM "Task" WHERE "serialNumber" IS NOT NULL`
        : `SELECT count(*) FROM "Implement" WHERE "serialNumber" IS NOT NULL`,
    ),
  };
  if (await existe(c, '_TaskLayouts'))
    out._TaskLayouts = await num(c, `SELECT count(*) FROM "_TaskLayouts"`);
  if (e.temQuoteLayout)
    out.arquivosDeLayoutDoOrcamento = await num(
      c,
      `SELECT count(*) FROM "File" WHERE "quoteLayoutId" IS NOT NULL`,
    );
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// G11-DADOS — a arte e os veículos que o banco daria, contra o congelado
// ═══════════════════════════════════════════════════════════════════════════
interface VeiculoDado {
  serialNumber: string | null;
  plate: string | null;
  chassisNumber: string | null;
  category: string | null;
  implementType: string | null;
}
interface Leitura {
  layoutFileIds: string[];
  layoutCoverage: Array<[string, string[]]> | null;
  veiculos: Map<string, VeiculoDado>;
}
interface Congelado {
  envelopeId: string;
  quoteId: string;
  status: string;
  budgetNumber: number | null;
  layoutFileIds: string[];
  layoutCoverage: Array<[string, string[]]> | null;
  veiculos: Map<string, Partial<VeiculoDado>>;
}

async function congelados(c: PgClient): Promise<Congelado[]> {
  const rs = await rows(
    c,
    `SELECT e."id", e."quoteId", e."status"::text AS status, e."quoteSnapshot" AS snap, b."budgetNumber"
       FROM "SignatureEnvelope" e JOIN "Budget" b ON b."id" = e."quoteId"
      WHERE e."status" IN ('RUNNING','COMPLETED') ORDER BY e."id"`,
  );
  return rs.map(r => {
    const s = (r.snap ?? {}) as Record<string, any>;
    const veiculos = new Map<string, Partial<VeiculoDado>>();
    if (Array.isArray(s.vehicles)) {
      for (const v of s.vehicles) {
        veiculos.set(v.taskId, {
          serialNumber: v.serialNumber ?? null,
          plate: v.plate ?? null,
          chassisNumber: v.chassisNumber ?? null,
          category: v.category ?? null,
          implementType: v.implementType ?? null,
        });
      }
    } else if (s.task?.id) {
      // forma v1/v2: task/truck singulares
      veiculos.set(s.task.id, {
        serialNumber: s.task.serialNumber ?? null,
        ...(s.truck
          ? {
              plate: s.truck.plate ?? null,
              chassisNumber: s.truck.chassisNumber ?? null,
              category: s.truck.category ?? null,
              implementType: s.truck.implementType ?? null,
            }
          : {}),
      });
    }
    return {
      envelopeId: r.id,
      quoteId: r.quoteId,
      status: r.status,
      budgetNumber: r.budgetNumber ?? null,
      layoutFileIds: Array.isArray(s.layoutFileIds) ? [...s.layoutFileIds].sort() : [],
      layoutCoverage: Array.isArray(s.layoutCoverage) ? s.layoutCoverage : null,
      veiculos,
    };
  });
}

const uniqSort = (xs: string[]) => [...new Set(xs)].sort();

/**
 * O que o `build()` leria do banco NESTE estado.
 * Antes da M3: `Budget.layoutFiles` (+ `BudgetLayoutTask` em PER_VEHICLE), cobertura só em PER_VEHICLE.
 * Depois da M3 (`quoteArtworkOf`, §2A.9): a arte APPROVED dos implementos de TODAS as tarefas do
 * orçamento (canceladas inclusive); cobertura quando PER_VEHICLE ou quando não é uniforme (tarefa
 * cancelada sem arte fica fora do teste de uniformidade).
 */
async function leituras(c: PgClient, quoteIds: string[]): Promise<Map<string, Leitura>> {
  const e = await lerEstado(c);
  const out = new Map<string, Leitura>();
  if (quoteIds.length === 0) return out;
  const escopo = new Map<string, string>(
    (
      await rows(c, `SELECT "id", "layoutScope"::text AS s FROM "Budget" WHERE "id" = ANY($1)`, [
        quoteIds,
      ])
    ).map(r => [r.id, r.s]),
  );
  const tarefas = await rows(
    c,
    `SELECT t."id", t."quoteId", t."status"::text AS status,
            ${e.serieNaTarefa ? 't."serialNumber"' : 'NULL::text'} AS "taskSerial",
            v."plate", v."chassisNumber", v."category"::text AS category, v."${e.colunaTipo}"::text AS "implementType"
            ${e.serieNoImplemento ? ', v."serialNumber" AS "implSerial"' : ''}
       FROM "Task" t LEFT JOIN "${e.veiculo}" v ON v."taskId" = t."id"
      WHERE t."quoteId" = ANY($1)`,
    [quoteIds],
  );
  for (const q of quoteIds)
    out.set(q, { layoutFileIds: [], layoutCoverage: null, veiculos: new Map() });
  for (const t of tarefas) {
    out.get(t.quoteId)!.veiculos.set(t.id, {
      serialNumber: (e.serieNoImplemento ? t.implSerial : t.taskSerial) ?? null,
      plate: t.plate ?? null,
      chassisNumber: t.chassisNumber ?? null,
      category: t.category ?? null,
      implementType: t.implementType ?? null,
    });
  }

  if (e.arteNoImplemento) {
    const arte = await rows(
      c,
      `SELECT t."quoteId", t."id" AS "taskId", t."status"::text AS status, l."fileId"
         FROM "Task" t JOIN "Implement" i ON i."taskId" = t."id"
         JOIN "Layout" l ON l."implementId" = i."id" AND l."status" = 'APPROVED'
        WHERE t."quoteId" = ANY($1)`,
      [quoteIds],
    );
    const porTarefa = new Map<string, Map<string, string[]>>();
    for (const r of arte) {
      const m = porTarefa.get(r.quoteId) ?? new Map<string, string[]>();
      m.set(r.taskId, [...(m.get(r.taskId) ?? []), r.fileId]);
      porTarefa.set(r.quoteId, m);
    }
    for (const q of quoteIds) {
      const l = out.get(q)!;
      const m = porTarefa.get(q) ?? new Map<string, string[]>();
      l.layoutFileIds = uniqSort([...m.values()].flat());
      const status = new Map(
        tarefas.filter(t => t.quoteId === q).map(t => [t.id, t.status as string]),
      );
      const conjuntos = [...status.keys()]
        .filter(tid => !(status.get(tid) === 'CANCELLED' && !m.get(tid)?.length))
        .map(tid => uniqSort(m.get(tid) ?? []).join(','));
      const uniforme = new Set(conjuntos).size <= 1;
      if (escopo.get(q) === 'PER_VEHICLE' || !uniforme) {
        const cobertura = new Map<string, string[]>();
        for (const [tid, fs] of m)
          for (const f of uniqSort(fs)) cobertura.set(f, [...(cobertura.get(f) ?? []), tid]);
        l.layoutCoverage = [...cobertura.entries()]
          .map(([f, ts]) => [f, [...ts].sort()] as [string, string[]])
          .sort((a, b) => a[0].localeCompare(b[0]));
      }
    }
  } else if (e.temQuoteLayout) {
    const arquivos = await rows(
      c,
      `SELECT "id", "quoteLayoutId" FROM "File" WHERE "quoteLayoutId" = ANY($1)`,
      [quoteIds],
    );
    for (const f of arquivos) out.get(f.quoteLayoutId)!.layoutFileIds.push(f.id);
    for (const q of quoteIds) out.get(q)!.layoutFileIds.sort();
    if (e.temBudgetLayoutTask) {
      const pares = await rows(
        c,
        `SELECT c."fileId", c."taskId", f."quoteLayoutId" FROM "BudgetLayoutTask" c
           JOIN "File" f ON f."id" = c."fileId" WHERE f."quoteLayoutId" = ANY($1)`,
        [quoteIds],
      );
      for (const q of quoteIds) {
        if (escopo.get(q) !== 'PER_VEHICLE') continue;
        const cobertura = new Map<string, string[]>();
        for (const p of pares.filter(x => x.quoteLayoutId === q)) {
          cobertura.set(p.fileId, [...(cobertura.get(p.fileId) ?? []), p.taskId]);
        }
        out.get(q)!.layoutCoverage = [...cobertura.entries()]
          .map(([f, ts]) => [f, [...ts].sort()] as [string, string[]])
          .sort((a, b) => a[0].localeCompare(b[0]));
      }
    }
  }
  return out;
}

/** '' = casa; senão, o primeiro campo que difere. */
function diferenca(cong: Congelado, l: Leitura | undefined): string {
  if (!l) return 'orçamento sumiu';
  if (cong.layoutFileIds.join(',') !== l.layoutFileIds.join(',')) {
    return `layoutFileIds congelado [${cong.layoutFileIds.join(',')}] × banco [${l.layoutFileIds.join(',')}]`;
  }
  if (JSON.stringify(cong.layoutCoverage) !== JSON.stringify(l.layoutCoverage)) {
    return `layoutCoverage congelado ${JSON.stringify(cong.layoutCoverage)} × banco ${JSON.stringify(l.layoutCoverage)}`;
  }
  for (const [tid, v] of cong.veiculos) {
    const atual = l.veiculos.get(tid);
    if (!atual) return `veículo ${tid} saiu do orçamento`;
    for (const k of Object.keys(v) as Array<keyof VeiculoDado>) {
      if ((v[k] ?? null) !== (atual[k] ?? null))
        return `veículo ${tid}.${k}: congelado ${v[k]} × banco ${atual[k]}`;
    }
  }
  return '';
}

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANTES por fatia (§4.6). `esperado` numérico = asserção; 'anotar' = só relatório.
// ═══════════════════════════════════════════════════════════════════════════
type Checagem = (
  c: PgClient,
  antes: Record<string, number>,
  add: (i: Omit<Invariante, 'ok' | 'fatia'>) => void,
  anota: (
    nome: string,
    achado: number | string,
    clone?: number | string,
    producao?: number | string,
  ) => void,
) => Promise<void>;

const CHECAGENS: Record<FatiaId, Checagem> = {
  M1: async (c, antes, add) => {
    add({
      nome: 'tabela "Truck" não existe mais; "Implement" existe',
      esperado: 1,
      achado: await num(
        c,
        `SELECT ((to_regclass('public."Truck"') IS NULL) AND (to_regclass('public."Implement"') IS NOT NULL))::int`,
      ),
    });
    add({
      nome: 'nenhuma linha muda no rename (Implement = Truck de antes)',
      esperado: antes.Truck ?? antes.Implement,
      achado: await num(c, `SELECT count(*) FROM "Implement"`),
    });
    add({
      nome: 'nenhuma constraint/índice de "Implement" com nome Truck_*',
      esperado: 0,
      achado: await num(
        c,
        `SELECT (SELECT count(*) FROM pg_constraint WHERE conrelid='"Implement"'::regclass AND conname LIKE 'Truck\\_%')
                                 + (SELECT count(*) FROM pg_indexes WHERE tablename='Implement' AND indexname LIKE 'Truck\\_%')`,
      ),
    });
    add({
      nome: 'coluna "type" (era implementType) e tipo "ImplementCategory" (era TruckCategory)',
      esperado: 2,
      achado: await num(
        c,
        `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name='Implement' AND column_name='type')
                                 + (SELECT count(*) FROM pg_type WHERE typname='ImplementCategory' AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='TruckCategory'))`,
      ),
    });
  },

  M1s: async (c, antes, add, anota) => {
    add({
      nome: 'count(Task) − count(Implement)',
      esperado: 0,
      achado: await num(
        c,
        `SELECT (SELECT count(*) FROM "Task") - (SELECT count(*) FROM "Implement")`,
      ),
    });
    add({
      nome: 'tarefas sem implemento',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Task" t WHERE NOT EXISTS (SELECT 1 FROM "Implement" i WHERE i."taskId"=t.id)`,
      ),
    });
    anota(
      'implementos criados pela M1s (_Mig0924_SerialImplementCreated)',
      await num(c, `SELECT count(*) FROM "_Mig0924_SerialImplementCreated"`),
      1678,
      1676,
    );
    add({
      nome: 'implementos criados pela M1s com spot preenchido',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "_Mig0924_SerialImplementCreated" x JOIN "Implement" i ON i.id=x."implementId" WHERE i."spot" IS NOT NULL`,
      ),
    });
    add({
      nome: 'Task.serialNumber ≠ Implement.serialNumber',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Task" t JOIN "Implement" i ON i."taskId"=t.id WHERE t."serialNumber" IS DISTINCT FROM i."serialNumber"`,
      ),
    });
    add({
      nome: 'Task.serialNumber × _Mig0924_TaskSerial (cópia byte a byte)',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "_Mig0924_TaskSerial" o JOIN "Task" t ON t.id=o."taskId" WHERE t."serialNumber" IS DISTINCT FROM o."serialNumber"`,
      ),
    });
    add({
      nome: 'séries no implemento = séries da tarefa antes',
      esperado: antes.seriesPreenchidas,
      achado: await num(c, `SELECT count(*) FROM "Implement" WHERE "serialNumber" IS NOT NULL`),
    });
    add({
      nome: 'Task_serialNumber_key caiu; Implement_serialNumber_key existe',
      esperado: 1,
      achado: await num(
        c,
        `SELECT ((to_regclass('public."Task_serialNumber_key"') IS NULL) AND (to_regclass('public."Implement_serialNumber_key"') IS NOT NULL))::int`,
      ),
    });
    add({
      nome: 'Implement.spot sem default',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM information_schema.columns WHERE table_name='Implement' AND column_name='spot' AND column_default IS NOT NULL`,
      ),
    });

    // Gatilhos (dentro de SAVEPOINTs; tudo desfeito).
    const alvo = (
      await rows(
        c,
        `SELECT t.id, t."updatedAt"::text AS u, i.id AS iid FROM "Task" t JOIN "Implement" i ON i."taskId"=t.id
                                  WHERE t."serialNumber" IS NOT NULL ORDER BY t.id LIMIT 1`,
      )
    )[0];
    if (alvo) {
      const e1 = await esperaErro(
        c,
        `UPDATE "Task" SET "serialNumber"='ENSAIO-RB-X' WHERE id=$1`,
        '23514',
        [alvo.id],
      );
      add({
        nome: 'gatilho: escrever Task.serialNumber direto → 23514',
        esperado: 'erro 23514',
        achado: e1 ?? 'erro 23514',
      });
      await c.query('SAVEPOINT ensaio_rb_espelho');
      await c.query(`UPDATE "Implement" SET "serialNumber"='ENSAIO-RB-ESPELHO' WHERE id=$1`, [
        alvo.iid,
      ]);
      const espelho = (
        await rows(
          c,
          `SELECT "serialNumber" AS s, "updatedAt"::text AS u FROM "Task" WHERE id=$1`,
          [alvo.id],
        )
      )[0];
      await c.query('ROLLBACK TO SAVEPOINT ensaio_rb_espelho');
      add({
        nome: 'gatilho: série gravada no implemento aparece na tarefa, sem mexer em Task.updatedAt',
        esperado: 'espelhada',
        achado:
          espelho?.s === 'ENSAIO-RB-ESPELHO' && espelho?.u === alvo.u
            ? 'espelhada'
            : JSON.stringify(espelho),
      });
      const e2 = await esperaErro(
        c,
        `UPDATE "Task" SET "serialNumber"="serialNumber", "name"="name" WHERE id=$1`,
        'nenhum',
        [alvo.id],
      );
      add({
        nome: 'gatilho: UPDATE da tarefa que não muda a série passa',
        esperado: 'passa',
        achado: e2 === 'não falhou' ? 'passa' : String(e2),
      });
      const dup = (
        await rows(
          c,
          `SELECT "serialNumber" AS s FROM "Implement" WHERE "serialNumber" IS NOT NULL AND id<>$1 LIMIT 1`,
          [alvo.iid],
        )
      )[0];
      if (dup) {
        const e3 = await esperaErro(
          c,
          `UPDATE "Implement" SET "serialNumber"=$1 WHERE id=$2`,
          '23505',
          [dup.s, alvo.iid],
        );
        add({
          nome: 'série duplicada no implemento → 23505',
          esperado: 'erro 23505',
          achado: e3 ?? 'erro 23505',
        });
      }
    }
    const e4 = await esperaErro(
      c,
      `INSERT INTO "Task" (id, "updatedAt") VALUES ('ensaio-rb-sem-implemento', now());
       SET CONSTRAINTS "Task_has_implement", "Implement_keeps_task_covered" IMMEDIATE`,
      '23514',
    );
    await c.query(`SET CONSTRAINTS "Task_has_implement", "Implement_keeps_task_covered" DEFERRED`);
    add({
      nome: 'gatilho diferido: tarefa sem implemento → 23514 no COMMIT',
      esperado: 'erro 23514',
      achado: e4 ?? 'erro 23514',
    });
    await c.query('SAVEPOINT ensaio_rb_com_implemento');
    let e5: string | null = null;
    let spot: unknown = 'n/d';
    try {
      await c.query(
        `INSERT INTO "Task" (id, "updatedAt") VALUES ('ensaio-rb-com-implemento', now())`,
      );
      await c.query(
        `INSERT INTO "Implement" (id, "taskId", "updatedAt") VALUES ('ensaio-rb-impl', 'ensaio-rb-com-implemento', now())`,
      );
      await c.query(
        `SET CONSTRAINTS "Task_has_implement", "Implement_keeps_task_covered" IMMEDIATE`,
      );
      spot =
        (await rows(c, `SELECT "spot"::text AS s FROM "Implement" WHERE id='ensaio-rb-impl'`))[0]
          ?.s ?? null;
    } catch (err: any) {
      e5 = `${err.code}: ${err.message}`;
    }
    await c.query('ROLLBACK TO SAVEPOINT ensaio_rb_com_implemento');
    await c.query(`SET CONSTRAINTS "Task_has_implement", "Implement_keeps_task_covered" DEFERRED`);
    add({
      nome: 'tarefa + implemento na mesma transação passa (e o spot nasce NULO)',
      esperado: 'passa, spot nulo',
      achado: e5 ?? (spot === null ? 'passa, spot nulo' : `passa, spot ${String(spot)}`),
    });
    const alvo2 = (await rows(c, `SELECT i.id FROM "Implement" i ORDER BY i.id LIMIT 1`))[0];
    if (alvo2) {
      const e6 = await esperaErro(
        c,
        `DELETE FROM "Implement" WHERE id='${alvo2.id}';
         SET CONSTRAINTS "Task_has_implement", "Implement_keeps_task_covered" IMMEDIATE`,
        '23514',
      );
      await c.query(
        `SET CONSTRAINTS "Task_has_implement", "Implement_keeps_task_covered" DEFERRED`,
      );
      add({
        nome: 'gatilho diferido: apagar o implemento de uma tarefa viva → 23514',
        esperado: 'erro 23514',
        achado: e6 ?? 'erro 23514',
      });
    }
    const e7 = await esperaErro(
      c,
      `INSERT INTO "Task" (id, "updatedAt", "serialNumber") VALUES ('ensaio-rb-serie-direta', now(), 'ENSAIO-RB-Y')`,
      '23514',
    );
    add({
      nome: 'gatilho: criar tarefa com série direto na Task → 23514',
      esperado: 'erro 23514',
      achado: e7 ?? 'erro 23514',
    });
  },

  Mnom: async (c, _antes, add) => {
    add({
      nome: 'tipo TRUCK_SPOT renomeado (IMPLEMENT_SPOT existe, TRUCK_SPOT não)',
      esperado: 1,
      achado: await num(
        c,
        `SELECT (EXISTS (SELECT 1 FROM pg_type WHERE typname='IMPLEMENT_SPOT') AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='TRUCK_SPOT'))::int`,
      ),
    });
    add({
      nome: "ChangeLogEntityType sem o valor 'TRUCK' (virou 'IMPLEMENT')",
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='ChangeLogEntityType' AND e.enumlabel='TRUCK'`,
      ),
    });
    add({
      nome: 'histórico sem campo `truck.*` (TaskFieldChangeLog e ChangeLog)',
      esperado: 0,
      achado: await num(
        c,
        `SELECT (SELECT count(*) FROM "TaskFieldChangeLog" WHERE "field" LIKE 'truck.%') + (SELECT count(*) FROM "ChangeLog" WHERE "field" LIKE 'truck.%')`,
      ),
    });
    add({
      nome: 'nenhuma chave/evento de aviso com o nome antigo',
      esperado: 0,
      achado: await num(
        c,
        `SELECT (SELECT count(*) FROM "NotificationConfiguration" WHERE "key" ~ '(^|\\.)truck\\.' OR "eventType" ~ '(^|\\.)truck\\.')
              + (SELECT count(*) FROM "UserNotificationPreference" WHERE "eventType" ~ '(^|\\.)truck\\.')
              + (SELECT count(*) FROM "Notification" WHERE "metadata"->>'configKey' ~ '(^|\\.)truck\\.' OR "metadata"->>'fieldName' LIKE 'truck.%')`,
      ),
    });
    add({
      nome: 'preferências de tela sem id composto do nome antigo (o ícone "truck"/"Truck" fica)',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Preferences" WHERE concat_ws(' ', "dashboardLayoutWeb"::text, "dashboardLayoutMobile"::text, "tableConfigsWeb"::text, "detailConfigsWeb"::text, "tableConfigsMobile"::text, "detailConfigsMobile"::text) ~ '"(hasTruck|trucks?[A-Z][A-Za-z0-9_]*|truck\\.[A-Za-z])'`,
      ),
    });
    add({
      nome: "Atenção sem entidade 'TRUCK'",
      esperado: 0,
      achado: await num(c, `SELECT count(*) FROM "AttentionAck" WHERE "entityType" = 'TRUCK'`),
    });
  },

  M5s: async (c, antes, add) => {
    add({
      nome: 'Task.serialNumber e Task.serialNumberNormalized não existem mais',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM information_schema.columns WHERE table_name='Task' AND column_name IN ('serialNumber','serialNumberNormalized')`,
      ),
    });
    add({
      nome: 'o espelho e a guarda dele não existem mais (gatilhos e funções)',
      esperado: 0,
      achado: await num(
        c,
        `SELECT (SELECT count(*) FROM pg_trigger WHERE tgname IN ('Implement_serial_mirror','Task_serial_is_mirror'))
              + (SELECT count(*) FROM pg_proc WHERE proname IN ('implement_serial_mirror','task_serial_is_mirror'))`,
      ),
    });
    add({
      nome: 'nenhuma série perdida: séries no implemento = séries de antes',
      esperado: antes.seriesPreenchidas,
      achado: await num(c, `SELECT count(*) FROM "Implement" WHERE "serialNumber" IS NOT NULL`),
    });
  },

  M2: async (c, _antes, add, anota) => {
    add({
      nome: 'medidas compartilhadas restantes (4 faces)',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM (SELECT mid FROM (
          SELECT "backSideMeasureId" mid FROM "Implement" UNION ALL SELECT "leftSideMeasureId" FROM "Implement"
          UNION ALL SELECT "rightSideMeasureId" FROM "Implement" UNION ALL SELECT "frontSideMeasureId" FROM "Implement") z
        WHERE mid IS NOT NULL GROUP BY mid HAVING count(*) > 1) y`,
      ),
    });
    anota(
      'cópias de medida (_Mig0924_MeasureUnshare)',
      await num(c, `SELECT count(*) FROM "_Mig0924_MeasureUnshare"`),
      30,
      26,
    );
    add({
      nome: 'cópia de medida sem as seções da original',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "_Mig0924_MeasureUnshare" u
          WHERE (SELECT count(*) FROM "ImplementMeasureSection" s WHERE s."implementMeasureId"=u."newMid")
             <> (SELECT count(*) FROM "ImplementMeasureSection" s WHERE s."implementMeasureId"=u."oldMid")`,
      ),
    });
    add({
      nome: 'tabela "_IMPLEMENT_PROJECT_FILES" existe',
      esperado: 1,
      achado: (await existe(c, '_IMPLEMENT_PROJECT_FILES')) ? 1 : 0,
    });
    const id = (await rows(c, `SELECT id FROM "Implement" ORDER BY id LIMIT 1`))[0]?.id;
    if (id) {
      const e1 = await esperaErro(
        c,
        `UPDATE "Implement" SET "rearDoorBarCount"=5 WHERE id=$1`,
        '23514',
        [id],
      );
      const e2 = await esperaErro(
        c,
        `UPDATE "Implement" SET "rearDoorHatchCount"=7 WHERE id=$1`,
        '23514',
        [id],
      );
      const e3 = await esperaErro(
        c,
        `UPDATE "Implement" SET "rearDoorBarCount"=4, "rearDoorHatchCount"=0, "rearDoorLeaves"='TRIPARTITE' WHERE id=$1`,
        'nenhum',
        [id],
      );
      add({
        nome: 'CHECK da porta: 5 varões e 7 portinholas recusados; 4/0/tripartida aceito',
        esperado: 'ok',
        achado:
          e1 === null && e2 === null && e3 === 'não falhou' ? 'ok' : JSON.stringify({ e1, e2, e3 }),
      });
    }
  },

  M3: async (c, antes, add, anota) => {
    add({
      nome: 'count(File) inalterado (nenhum DELETE FROM "File")',
      esperado: antes.File,
      achado: await num(c, `SELECT count(*) FROM "File"`),
    });
    add({
      nome: '"_TaskLayouts" derrubada',
      esperado: 0,
      achado: (await existe(c, '_TaskLayouts')) ? 1 : 0,
    });
    add({
      nome: 'Layout com zero ou dois donos',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Layout" WHERE ("implementId" IS NULL) = ("airbrushingId" IS NULL)`,
      ),
    });
    add({
      nome: 'aerografia intocada (linhas e status iguais ao arquivo morto)',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "_Mig0924_Layout" o WHERE o."airbrushingId" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM "Layout" l WHERE l.id=o.id AND l."airbrushingId"=o."airbrushingId" AND l."fileId"=o."fileId" AND l."status"=o."status" AND l."implementId" IS NULL)`,
      ),
    });
    add({
      nome: 'PDF antes ligado a tarefa fora do projeto da tarefa',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "_Mig0924_TaskLayouts" x JOIN "_Mig0924_Layout" l ON l.id=x."A" JOIN "File" f ON f.id=l."fileId"
          WHERE f.mimetype='application/pdf' AND l."airbrushingId" IS NULL
            AND NOT EXISTS (SELECT 1 FROM "_TASK_PROJECT_FILES" p WHERE p."A"=l."fileId" AND p."B"=x."B")`,
      ),
    });
    add({
      nome: 'imagem antes ligada a tarefa que não virou arte do implemento (sem JOIN interno)',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "_Mig0924_TaskLayouts" x JOIN "_Mig0924_Layout" l ON l.id=x."A" JOIN "File" f ON f.id=l."fileId"
          LEFT JOIN "Implement" i ON i."taskId"=x."B"
          WHERE f.mimetype<>'application/pdf'
            AND (i.id IS NULL OR NOT EXISTS (SELECT 1 FROM "Layout" n WHERE n."implementId"=i.id AND n."fileId"=l."fileId"))`,
      ),
    });
    add({
      nome: 'projectFiles antigos da tarefa fora do projeto do implemento',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "_Mig0924_TaskProjectFiles" o JOIN "Implement" i ON i."taskId"=o."B"
          WHERE NOT EXISTS (SELECT 1 FROM "_IMPLEMENT_PROJECT_FILES" p WHERE p."A"=o."A" AND p."B"=i.id)`,
      ),
    });
    add({
      nome: 'arte do orçamento (M-A/M-D): implemento de orçamento vivo sem EXATAMENTE os File.id do layout dele',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "_Mig0924_QuoteLayout" q JOIN "Budget" b ON b.id=q."quoteLayoutId" JOIN "Task" t ON t."quoteId"=b.id
          JOIN "Implement" i ON i."taskId"=t.id JOIN "File" f ON f.id=q."fileId"
          WHERE (b.status::text NOT IN ('EXPIRED','CANCELLED') OR EXISTS (SELECT 1 FROM "SignatureEnvelope" e WHERE e."quoteId"=b.id AND e.status IN ('RUNNING','COMPLETED')))
            AND (f.mimetype <> 'application/pdf' OR EXISTS (SELECT 1 FROM "SignatureEnvelope" e WHERE e."quoteId"=b.id AND e.status IN ('RUNNING','COMPLETED')))
            AND (b."layoutScope" <> 'PER_VEHICLE' OR EXISTS (SELECT 1 FROM "BudgetLayoutTask" c WHERE c."fileId"=q."fileId" AND c."taskId"=t.id))
            AND NOT EXISTS (SELECT 1 FROM "Layout" l WHERE l."implementId"=i.id AND l."fileId"=q."fileId" AND l.status IN ('APPROVED','PENDING_APPROVAL'))`,
      ),
    });
    add({
      nome: 'M-B: orçamento com coleta RUNNING/COMPLETED com arte APPROVED fora do layout dele',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Budget" b JOIN "Task" t ON t."quoteId"=b.id JOIN "Implement" i ON i."taskId"=t.id
          JOIN "Layout" l ON l."implementId"=i.id AND l.status='APPROVED'
          WHERE EXISTS (SELECT 1 FROM "SignatureEnvelope" e WHERE e."quoteId"=b.id AND e.status IN ('RUNNING','COMPLETED'))
            AND NOT EXISTS (SELECT 1 FROM "_Mig0924_QuoteLayout" q WHERE q."quoteLayoutId"=b.id AND q."fileId"=l."fileId")`,
      ),
    });
    add({
      nome: 'M-C: arte do orçamento com coleta viva que não ficou APPROVED',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "_Mig0924_QuoteLayout" q JOIN "Task" t ON t."quoteId"=q."quoteLayoutId" JOIN "Implement" i ON i."taskId"=t.id
          JOIN "Budget" b ON b.id=q."quoteLayoutId"
          WHERE EXISTS (SELECT 1 FROM "SignatureEnvelope" e WHERE e."quoteId"=q."quoteLayoutId" AND e.status IN ('RUNNING','COMPLETED'))
            AND (b."layoutScope" <> 'PER_VEHICLE' OR EXISTS (SELECT 1 FROM "BudgetLayoutTask" c WHERE c."fileId"=q."fileId" AND c."taskId"=t.id))
            AND NOT EXISTS (SELECT 1 FROM "Layout" l WHERE l."implementId"=i.id AND l."fileId"=q."fileId" AND l.status='APPROVED')`,
      ),
    });
    add({
      nome: 'implementos criados por migração (M1s + passo 1b) com spot preenchido',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Implement" i WHERE i."spot" IS NOT NULL AND (
          i.id IN (SELECT "implementId" FROM "_Mig0924_SerialImplementCreated") OR i.id IN (SELECT "implementId" FROM "_Mig0924_ImplementCreated"))`,
      ),
    });
    anota(
      'passo 1b da M3 (implementos criados; esperado 0 com a M1s)',
      await num(c, `SELECT count(*) FROM "_Mig0924_ImplementCreated"`),
      0,
      0,
    );
    add({
      nome: 'arte migrada já decidida sem linha em LayoutDecision',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Layout" l WHERE l."approvalSource" IN ('MIGRATED_TASK','MIGRATED_BUDGET','MIGRATED_ENVELOPE')
          AND NOT EXISTS (SELECT 1 FROM "LayoutDecision" d WHERE d."layoutId"=l.id)`,
      ),
    });
    add({
      nome: 'PENDING_APPROVAL sem sentAt',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Layout" WHERE status='PENDING_APPROVAL' AND "sentAt" IS NULL`,
      ),
    });
    anota(
      'Layout antes (total / aerografia)',
      `${antes.Layout} / ${antes.LayoutAerografia}`,
      '481 / 0',
      '859 / 73',
    );
    anota('Layout depois (total)', await num(c, `SELECT count(*) FROM "Layout"`));
    anota(
      'Layout por status depois',
      (await rows(c, `SELECT status::text s, count(*) n FROM "Layout" GROUP BY 1 ORDER BY 1`))
        .map(r => `${r.s} ${r.n}`)
        .join(', '),
    );
    anota(
      'linhas Layout apagadas: órfãs + PDFs que viraram projeto da tarefa (o File fica)',
      await num(
        c,
        `SELECT count(*) FROM "_Mig0924_Layout" o WHERE NOT EXISTS (SELECT 1 FROM "Layout" l WHERE l.id=o.id)`,
      ),
      '108 + 177',
      '213 + 267',
    );
    anota(
      'linhas de fan-out (_Mig0924_LayoutOrigin FANOUT)',
      await num(c, `SELECT count(*) FROM "_Mig0924_LayoutOrigin" WHERE origin='FANOUT'`),
    );
    anota(
      'arte do orçamento em linha nova (_Mig0924_LayoutOrigin QUOTE)',
      await num(c, `SELECT count(*) FROM "_Mig0924_LayoutOrigin" WHERE origin='QUOTE'`),
    );
    anota(
      'vínculos em _IMPLEMENT_PROJECT_FILES',
      await num(c, `SELECT count(*) FROM "_IMPLEMENT_PROJECT_FILES"`),
    );
    anota(
      'vínculos em _TASK_PROJECT_FILES (PDFs de layout + PDFs de orçamento)',
      await num(c, `SELECT count(*) FROM "_TASK_PROJECT_FILES"`),
      214,
    );
    anota(
      'projectFiles antigos que ficaram na tarefa (0, salvo o mesmo PDF também ser layout)',
      await num(
        c,
        `SELECT count(*) FROM "_Mig0924_TaskProjectFiles" o JOIN "_TASK_PROJECT_FILES" p ON p."A"=o."A" AND p."B"=o."B"`,
      ),
      0,
      0,
    );
    // Exclusão de arquivo: o gatilho continua protegendo o que é referenciado e deixa apagar o resto.
    await c.query('SAVEPOINT ensaio_rb_arquivo');
    let apagou = 'não';
    try {
      await c.query(`INSERT INTO "File" (id, filename, "originalName", mimetype, path, size, "updatedAt")
                     VALUES ('ensaio-rb-arquivo', 'x.png', 'x.png', 'image/png', '/tmp/ensaio-rb/x.png', 1, now())`);
      const r = (await c.query(`DELETE FROM "File" WHERE id='ensaio-rb-arquivo'`)) as PgResult;
      apagou = r.rowCount === 1 ? 'sim' : 'não';
    } catch (err: any) {
      apagou = `${err.code}: ${err.message}`;
    }
    await c.query('ROLLBACK TO SAVEPOINT ensaio_rb_arquivo');
    add({ nome: 'arquivo sem referência continua apagável', esperado: 'sim', achado: apagou });
    const arte = (
      await rows(
        c,
        `SELECT "fileId" FROM "Layout" WHERE "implementId" IS NOT NULL ORDER BY id LIMIT 1`,
      )
    )[0];
    if (arte) {
      const e1 = await esperaErro(c, `DELETE FROM "File" WHERE id=$1`, /Layout\.fileId/, [
        arte.fileId,
      ]);
      add({
        nome: 'arquivo que é arte de implemento continua protegido contra exclusão',
        esperado: 'recusado',
        achado: e1 ?? 'recusado',
      });
    }
    const umArquivo = (await rows(c, `SELECT id FROM "File" ORDER BY id LIMIT 1`))[0];
    if (umArquivo) {
      const e2 = await esperaErro(
        c,
        `INSERT INTO "Layout" (id, "fileId", "updatedAt") VALUES ('ensaio-rb-layout', $1, now())`,
        '23514',
        [umArquivo.id],
      );
      add({
        nome: 'CHECK: Layout sem dono recusado',
        esperado: 'erro 23514',
        achado: e2 ?? 'erro 23514',
      });
    }
  },

  'M3o-a': async (c, _antes, add, anota) => {
    add({
      nome: 'eixo × envelope vigente (RUNNING/COMPLETED primeiro, senão o último; WAIVED para aprovado sem coleta): divergências',
      esperado: 0,
      achado: await num(
        c,
        `WITH v AS (
          SELECT DISTINCT ON ("quoteId") id, "quoteId", status::text AS st FROM "SignatureEnvelope"
          ORDER BY "quoteId", CASE WHEN status::text IN ('RUNNING','COMPLETED') THEN 0 ELSE 1 END, "createdAt" DESC, id),
        esperado AS (
          SELECT b.id, arq.status AS "statusAntes", CASE
            WHEN v.id IS NULL AND coalesce(arq.status, b."status"::text) = 'APPROVED' THEN 'WAIVED'
            WHEN v.id IS NULL THEN 'NOT_ISSUED'
            WHEN v.st = 'RUNNING' THEN CASE WHEN NOT EXISTS (SELECT 1 FROM "EnvelopeSigner" s WHERE s."envelopeId"=v.id AND s."orderGroup"=0 AND s.status::text<>'SIGNED')
                                            THEN 'AWAITING_ANKAA' ELSE 'AWAITING_CUSTOMER' END
            WHEN v.st = 'COMPLETED' THEN 'SIGNED'
            WHEN v.st IN ('REFUSED','EXPIRED','INVALIDATED') THEN v.st
            ELSE 'NOT_ISSUED' END AS eixo
          FROM "Budget" b LEFT JOIN v ON v."quoteId"=b.id LEFT JOIN "_Mig0924_BudgetStatus" arq ON arq.id=b.id)
        SELECT count(*) FROM "Budget" b JOIN esperado x ON x.id=b.id
        WHERE b."signatureStatus"::text <> x.eixo
          -- a M3o-b leva o SIGNED legado a APPROVED + AWAITING_ANKAA (§2A.10)
          AND NOT (x."statusAntes" = 'SIGNED' AND b."signatureStatus"::text = 'AWAITING_ANKAA')`,
      ),
    });
    add({
      nome: 'SIGNED_OFFLINE e BudgetOfflineSignature nascem vazios',
      esperado: 0,
      achado: await num(
        c,
        `SELECT (SELECT count(*) FROM "Budget" WHERE "signatureStatus"='SIGNED_OFFLINE') + (SELECT count(*) FROM "BudgetOfflineSignature")`,
      ),
    });
    anota(
      'WAIVED (aprovados sem coleta; faturáveis, DD7)',
      await num(c, `SELECT count(*) FROM "Budget" WHERE "signatureStatus"='WAIVED'`),
      427,
      504,
    );
    anota(
      'triagem LEGACY_APPROVED_UNSIGNED (aprovado cuja coleta vigente não concluiu)',
      await num(c, `SELECT count(*) FROM "_Mig0924_Triage" WHERE kind='LEGACY_APPROVED_UNSIGNED'`),
      1,
      2,
    );
    const e1 = await esperaErro(
      c,
      `INSERT INTO "BudgetValueApproval" (id, "budgetId", source) SELECT 'ensaio-rb-va', id, 'ON_BEHALF' FROM "Budget" LIMIT 1`,
      '23514',
    );
    const e2 = await esperaErro(
      c,
      `INSERT INTO "BudgetOfflineSignature" (id, "budgetId", "fileId", note, "createdById")
        SELECT 'ensaio-rb-os', b.id, f.id, '   ', u.id FROM "Budget" b, "File" f, "User" u LIMIT 1`,
      '23514',
    );
    add({
      nome: 'CHECKs: ON_BEHALF sem nota e assinatura fora do sistema com nota em branco recusadas',
      esperado: 'ok',
      achado: e1 === null && e2 === null ? 'ok' : JSON.stringify({ e1, e2 }),
    });
  },

  'M3o-b': async (c, _antes, add, anota) => {
    add({
      nome: "'PRE_APPROVED' fora do tipo BudgetStatus",
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='BudgetStatus' AND e.enumlabel='PRE_APPROVED'`,
      ),
    });
    add({
      nome: 'ordem do tipo: REQUESTED,EXPIRED,PENDING,IN_NEGOTIATION,APPROVED,SIGNED,CANCELLED',
      esperado: 'REQUESTED,EXPIRED,PENDING,IN_NEGOTIATION,APPROVED,SIGNED,CANCELLED',
      achado:
        (
          await rows(
            c,
            `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) s FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='BudgetStatus'`,
          )
        )[0]?.s ?? '',
    });
    add({
      nome: 'Budget.status = SIGNED (legado, nunca mais escrito)',
      esperado: 0,
      achado: await num(c, `SELECT count(*) FROM "Budget" WHERE status='SIGNED'`),
    });
    add({
      nome: 'REQUESTED com coleta em andamento',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Budget" WHERE status='REQUESTED' AND "signatureStatus" IN ('AWAITING_CUSTOMER','AWAITING_ANKAA')`,
      ),
    });
    add({
      nome: 'PENDING com coleta encerrada (recusada/vencida/concluída)',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Budget" WHERE status='PENDING' AND "signatureStatus" IN ('REFUSED','EXPIRED','SIGNED')`,
      ),
    });
    add({
      nome: 'APPROVED sem aprovação do valor vigente',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Budget" b WHERE b.status='APPROVED'
          AND NOT EXISTS (SELECT 1 FROM "BudgetValueApproval" v WHERE v."budgetId"=b.id AND v."revokedAt" IS NULL)`,
      ),
    });
    add({
      nome: 'statusOrder ≠ BUDGET_STATUS_ORDER novo (1,2,3,4,5,5,6)',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Budget" WHERE "statusOrder" <> CASE status WHEN 'REQUESTED' THEN 1 WHEN 'EXPIRED' THEN 2
          WHEN 'PENDING' THEN 3 WHEN 'IN_NEGOTIATION' THEN 4 WHEN 'APPROVED' THEN 5 WHEN 'SIGNED' THEN 5 WHEN 'CANCELLED' THEN 6 END`,
      ),
    });
    add({
      nome: 'defaults: status PENDING e statusOrder 3 (X8)',
      esperado: 2,
      achado: await num(
        c,
        `SELECT count(*) FROM information_schema.columns WHERE table_name='Budget'
          AND ((column_name='status' AND column_default LIKE '''PENDING''%') OR (column_name='statusOrder' AND column_default='3'))`,
      ),
    });
    add({
      nome: 'fila: sinal do queueRank fora do grupo (IN_NEGOTIATION mais antigo primeiro; o resto, mais recente)',
      esperado: 0,
      achado: await num(
        c,
        `SELECT count(*) FROM "Budget" WHERE ("queueRank" > 0) <> (status='IN_NEGOTIATION') AND extract(epoch FROM "createdAt") > 0`,
      ),
    });
    anota(
      'BudgetValueApproval MIGRATED',
      await num(c, `SELECT count(*) FROM "BudgetValueApproval" WHERE source='MIGRATED'`),
      430,
      536,
    );
    anota(
      'triagem LEGACY_COMPLETED_NOT_APPROVED (nº 591 no clone)',
      await num(
        c,
        `SELECT count(*) FROM "_Mig0924_Triage" WHERE kind='LEGACY_COMPLETED_NOT_APPROVED'`,
      ),
      1,
      0,
    );
    const e1 = await esperaErro(
      c,
      `UPDATE "Budget" SET status='PRE_APPROVED' WHERE id=(SELECT id FROM "Budget" LIMIT 1)`,
      '22P02',
    );
    add({
      nome: "gravar 'PRE_APPROVED' → 22P02",
      esperado: 'erro 22P02',
      achado: e1 ?? 'erro 22P02',
    });
  },
};

// ─── G25 da R-B: os objetos de cada bloco existem depois da fatia ───
function objetosPorFatia(): Map<string, Array<{ tipo: string; nome: string; tabela?: string }>> {
  const texto = readFileSync(OBJETOS_RB, 'utf8');
  const out = new Map<string, Array<{ tipo: string; nome: string; tabela?: string }>>();
  let atual = '';
  for (const linha of texto.split('\n')) {
    const bloco = linha.match(/^-- ════ (M\S+) \(/);
    if (bloco) {
      atual = bloco[1];
      out.set(atual, []);
      continue;
    }
    if (!atual) continue;
    const lista = out.get(atual)!;
    let m: RegExpMatchArray | null;
    if ((m = linha.match(/^CREATE OR REPLACE FUNCTION public\.(\w+)\(/)))
      lista.push({ tipo: 'função', nome: m[1] });
    else if ((m = linha.match(/^CREATE (?:CONSTRAINT )?TRIGGER "([^"]+)" .* ON public\."([^"]+)"/)))
      lista.push({ tipo: 'gatilho', nome: m[1], tabela: m[2] });
    else if ((m = linha.match(/^CREATE INDEX IF NOT EXISTS "([^"]+)"/)))
      lista.push({ tipo: 'índice', nome: m[1] });
    else if ((m = linha.match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/)))
      lista.push({ tipo: 'CHECK', nome: m[2], tabela: m[1] });
    else if ((m = linha.match(/^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)" .* GENERATED ALWAYS/)))
      lista.push({ tipo: 'coluna gerada', nome: m[2], tabela: m[1] });
  }
  return out;
}
async function conferirObjetos(c: PgClient, fatia: FatiaId, rel: Relatorio): Promise<void> {
  for (const o of objetosPorFatia().get(fatia) ?? []) {
    let n = 0;
    if (o.tipo === 'função')
      n = await num(
        c,
        `SELECT count(*) FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='public' AND p.proname=$1`,
        [o.nome],
      );
    else if (o.tipo === 'gatilho')
      n = await num(
        c,
        `SELECT count(*) FROM pg_trigger WHERE tgname=$1 AND tgrelid=to_regclass($2)`,
        [o.nome, `public."${o.tabela}"`],
      );
    else if (o.tipo === 'índice')
      n = await num(
        c,
        `SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname=$1`,
        [o.nome],
      );
    else if (o.tipo === 'CHECK')
      n = await num(
        c,
        `SELECT count(*) FROM pg_constraint WHERE conname=$1 AND contype='c' AND conrelid=to_regclass($2)`,
        [o.nome, `public."${o.tabela}"`],
      );
    else if (o.tipo === 'coluna gerada')
      n = await num(
        c,
        `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 AND is_generated='ALWAYS'`,
        [o.tabela, o.nome],
      );
    rel.g25.push({
      fatia,
      objeto: `${o.tipo} ${o.tabela ? `${o.tabela}.` : ''}${o.nome}`,
      existe: n > 0,
    });
  }
}

// ─── idempotência (§4.5): a segunda rodada de cada fatia não falha e não muda nada ───
async function impressaoDoDado(c: PgClient): Promise<string> {
  const partes: string[] = [];
  const h = async (rotulo: string, sql: string) => {
    partes.push(`${rotulo}=${(await rows(c, sql))[0]?.h ?? 'vazio'}`);
  };
  const e = await lerEstado(c);
  await h(
    'tarefa',
    e.serieNaTarefa
      ? `SELECT md5(string_agg(id || ':' || coalesce("serialNumber",'∅'), ',' ORDER BY id)) h FROM "Task"`
      : `SELECT md5(string_agg(id, ',' ORDER BY id)) h FROM "Task"`,
  );
  await h(
    'veiculo',
    `SELECT md5(string_agg(to_jsonb(v)::text, ',' ORDER BY v.id)) h FROM "${e.veiculo}" v`,
  );
  await h('medida', `SELECT count(*)::text h FROM "ImplementMeasure"`);
  await h('arte', `SELECT md5(string_agg(to_jsonb(l)::text, ',' ORDER BY l.id)) h FROM "Layout" l`);
  await h(
    'orcamento',
    `SELECT md5(string_agg(to_jsonb(b)::text, ',' ORDER BY b.id)) h FROM "Budget" b`,
  );
  await h(
    'projetoTarefa',
    `SELECT md5(string_agg("A" || ':' || "B", ',' ORDER BY "A","B")) h FROM "_TASK_PROJECT_FILES"`,
  );
  for (const t of [
    '_IMPLEMENT_PROJECT_FILES',
    'LayoutDecision',
    'BudgetValueApproval',
    '_Mig0924_Triage',
  ]) {
    if (await existe(c, t)) await h(t, `SELECT count(*)::text h FROM "${t}"`);
  }
  return partes.join(' | ');
}
async function conferirIdempotencia(c: PgClient, rel: Relatorio): Promise<void> {
  const aplicadasAgora = rel.fatias.filter(f => !f.jaAplicada && f.ms !== undefined);
  if (aplicadasAgora.length === 0) return;
  const antes = await impressaoDoDado(c);
  await c.query('SAVEPOINT ensaio_rb_idempotencia');
  let achado = 'sem mudança';
  try {
    for (const f of aplicadasAgora) {
      const sql = readFileSync(join(ROOT, f.fonte), 'utf8');
      try {
        await c.query(sql);
      } catch (err: any) {
        achado = `${f.id} falhou na 2ª rodada: ${err.code} ${err.message}${linhaDoErro(sql, err.position)}`;
        break;
      }
    }
    if (achado === 'sem mudança') {
      const depois = await impressaoDoDado(c);
      if (depois !== antes) {
        const a = antes.split(' | ');
        const d = depois.split(' | ');
        achado = `mudou: ${d
          .filter((x, i) => x !== a[i])
          .map(x => x.split('=')[0])
          .join(', ')}`;
      }
    }
  } finally {
    await c.query('ROLLBACK TO SAVEPOINT ensaio_rb_idempotencia');
  }
  rel.invariantes.push({
    fatia: 'geral',
    nome: 'idempotência (§4.5): 2ª rodada das fatias não falha e não muda o dado',
    esperado: 'sem mudança',
    achado,
    ok: achado === 'sem mudança',
  });
  log(`\n── idempotência: ${achado}`);
}

// ─── fatias ───
async function descobrirFatias(c: PgClient): Promise<Relatorio['fatias']> {
  const temTabela = await existe(c, '_prisma_migrations');
  const aplicadas = new Set(
    temTabela
      ? (
          await rows(
            c,
            `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
          )
        ).map(r => r.migration_name as string)
      : [],
  );
  if (!aplicadas.has(M0))
    throw new Error(`a M0 (${M0}) não está aplicada neste banco: ela vai antes (release R-A)`);
  return FATIAS.map(f => {
    const promovida = join(MIGRATIONS, f.nome, 'migration.sql');
    const encenada = join(STAGED, f.nome, 'migration.sql');
    const fonte = existsSync(promovida) ? promovida : encenada;
    if (!existsSync(fonte))
      throw new Error(
        `fatia ${f.id} (${f.nome}) não está nem em prisma/migrations nem em prisma/staged/r-b`,
      );
    return {
      id: f.id,
      nome: f.nome,
      fonte: fonte.replace(`${ROOT}/`, ''),
      jaAplicada: aplicadas.has(f.nome),
    };
  });
}

function novoRelatorio(banco: string, modo: Relatorio['modo']): Relatorio {
  return {
    geradoEm: new Date().toISOString(),
    banco,
    modo,
    fatias: [],
    antes: {},
    depois: {},
    invariantes: [],
    anotadas: [],
    triagem: {},
    seriesForaDaRegex: 0,
    distribuicaoOrcamento: [],
    g11: null,
    g25: [],
    ok: false,
  };
}

/**
 * O miolo: dentro de uma transação já aberta em `c`, aplica (ou não, se `aplicar` = false: o banco
 * já foi migrado por fora, modo --deriva) as fatias pendentes e confere tudo.
 */
async function ensaiarDentro(
  c: PgClient,
  rel: Relatorio,
  aplicar: boolean,
  antesExterno?: {
    antes: Record<string, number>;
    leiturasAntes: Map<string, Leitura>;
  },
): Promise<void> {
  const antes = antesExterno?.antes ?? (await contagens(c));
  rel.antes = antes;
  const cong = await congelados(c);
  const quoteIds = [...new Set(cong.map(x => x.quoteId))];
  const leiturasAntes = antesExterno?.leiturasAntes ?? (await leituras(c, quoteIds));

  const pendentes = rel.fatias.filter(f => !f.jaAplicada);
  log(`\n── fatias (${pendentes.length} pendente(s) de ${rel.fatias.length})`);
  for (const f of rel.fatias) {
    if (f.jaAplicada) {
      log(`   ·  ${f.id.padEnd(6)} já aplicada (${f.nome})`);
      continue;
    }
    if (aplicar) {
      const sql = readFileSync(join(ROOT, f.fonte), 'utf8');
      const t0 = Date.now();
      try {
        await c.query(sql);
      } catch (e: any) {
        f.erro = `${e.code ?? ''} ${e.message}${linhaDoErro(sql, e.position)}${e.where ? ` — ${e.where}` : ''}`;
        log(`   ✗  ${f.id.padEnd(6)} FALHOU: ${f.erro}`);
        rel.invariantes.push({
          fatia: f.id,
          nome: 'a fatia aplica sem erro',
          esperado: 'sem erro',
          achado: f.erro,
          ok: false,
        });
        return;
      }
      f.ms = Date.now() - t0;
      log(`   ▶  ${f.id.padEnd(6)} aplicada em ${f.ms} ms (${f.fonte})`);
    } else {
      // --deriva: as fatias já entraram todas por `migrate deploy`; as invariantes POR FATIA medem o
      // passo logo depois dele (contagens de rename, testes de gatilho) e são do ensaio transacional.
      // Aqui ficam o G25, os gatilhos diferidos, o G11-dados, as contagens e a triagem.
      log(`   ▶  ${f.id.padEnd(6)} aplicada por migrate deploy`);
      await conferirObjetos(c, f.id, rel);
      continue;
    }
    const add = (i: Omit<Invariante, 'ok' | 'fatia'>) => {
      const ok = String(i.esperado) === String(i.achado);
      rel.invariantes.push({ ...i, fatia: f.id, ok });
      log(
        `      ${ok ? 'ok  ' : 'FAIL'} ${i.nome}: ${i.achado}${ok ? '' : ` (esperado ${i.esperado})`}`,
      );
    };
    const anota = (
      nome: string,
      achado: number | string,
      clone?: number | string,
      producao?: number | string,
    ) => {
      rel.anotadas.push({ fatia: f.id, nome, achado, clone, producao });
      const ref = [
        clone !== undefined ? `clone 23/09: ${clone}` : '',
        producao !== undefined ? `produção 23/09: ${producao}` : '',
      ]
        .filter(Boolean)
        .join('; ');
      log(`      ·    ${nome}: ${achado}${ref ? `  [${ref}]` : ''}`);
    };
    await CHECAGENS[f.id](c, antes, add, anota);
    await conferirObjetos(c, f.id, rel);
  }

  if (aplicar) await conferirIdempotencia(c, rel);

  // Fim: os gatilhos diferidos aceitam o estado migrado inteiro.
  if (await existe(c, 'Implement')) {
    const temGatilho = await num(
      c,
      `SELECT count(*) FROM pg_trigger WHERE tgname='Task_has_implement'`,
    );
    if (temGatilho > 0) {
      let achado = 'aceita';
      await c.query('SAVEPOINT ensaio_rb_fim');
      try {
        await c.query(
          `SET CONSTRAINTS "Task_has_implement", "Implement_keeps_task_covered" IMMEDIATE`,
        );
      } catch (e: any) {
        achado = `${e.code}: ${e.message}`;
      }
      await c.query('ROLLBACK TO SAVEPOINT ensaio_rb_fim');
      rel.invariantes.push({
        fatia: 'geral',
        nome: 'gatilhos diferidos aceitam o banco migrado',
        esperado: 'aceita',
        achado,
        ok: achado === 'aceita',
      });
    }
  }

  // G25 da R-B
  const faltam = rel.g25.filter(o => !o.existe);
  rel.invariantes.push({
    fatia: 'geral',
    nome: 'G25 da R-B: objetos de banco de cada fatia aplicada existem',
    esperado: 0,
    achado: faltam.length,
    ok: faltam.length === 0,
  });
  log(
    `\n── G25 da R-B: ${rel.g25.length} objetos conferidos${faltam.length ? `, FALTAM: ${faltam.map(o => o.objeto).join(', ')}` : ', todos presentes'}`,
  );

  // Contagens, triagem, séries fora da regex
  rel.depois = await contagens(c);
  if (await existe(c, '_Mig0924_Triage')) {
    for (const r of await rows(
      c,
      `SELECT kind, count(*)::int n FROM "_Mig0924_Triage" GROUP BY 1 ORDER BY 1`,
    ))
      rel.triagem[r.kind] = r.n;
  }
  const serieDe = (await lerEstado(c)).serieNoImplemento ? `"Implement"` : `"Task"`;
  rel.seriesForaDaRegex = await num(
    c,
    `SELECT count(*) FROM ${serieDe} WHERE "serialNumber" IS NOT NULL AND "serialNumber" !~ '^[A-Z0-9-]+$'`,
  );
  if (await temColuna(c, 'Budget', 'signatureStatus')) {
    rel.distribuicaoOrcamento = (await rows(
      c,
      `SELECT status::text AS status, "signatureStatus"::text AS "signatureStatus", count(*)::int AS n
      FROM "Budget" GROUP BY 1,2 ORDER BY 1,2`,
    )) as Relatorio['distribuicaoOrcamento'];
  }
  log('\n── contagens (antes → depois)');
  for (const k of new Set([...Object.keys(rel.antes), ...Object.keys(rel.depois)])) {
    log(
      `   ${k.padEnd(34)} ${String(rel.antes[k] ?? '—').padStart(7)} → ${String(rel.depois[k] ?? '—').padStart(7)}`,
    );
  }
  log(
    `   séries fora de ^[A-Z0-9-]+$ (migram como estão, S-7)  ${rel.seriesForaDaRegex}  [clone 23/09: 42; produção 23/09: 42]`,
  );
  if (rel.distribuicaoOrcamento.length) {
    log('\n── orçamento: status × signatureStatus (§2A.10)');
    for (const d of rel.distribuicaoOrcamento)
      log(`   ${d.status.padEnd(15)} ${d.signatureStatus.padEnd(18)} ${d.n}`);
  }
  log('\n── triagem (_Mig0924_Triage: levar ao dono)');
  for (const [k, n] of Object.entries(rel.triagem)) log(`   ${k.padEnd(38)} ${n}`);
  if (rel.triagem.LEGACY_APPROVED_UNSIGNED) {
    const nums = await rows(
      c,
      `SELECT b."budgetNumber" n FROM "_Mig0924_Triage" x JOIN "Budget" b ON b.id=x.note
      WHERE x.kind='LEGACY_APPROVED_UNSIGNED' ORDER BY 1`,
    );
    log(
      `   LEGACY_APPROVED_UNSIGNED: nº ${nums.map(r => r.n).join(', ')} — saída por coleta nova ou "Assinado fora do sistema" (DD11)`,
    );
  }

  // G11-DADOS
  const depois = await leituras(c, quoteIds);
  const envs = cong.map(x => {
    const da = diferenca(x, leiturasAntes.get(x.quoteId));
    const dd = diferenca(x, depois.get(x.quoteId));
    return {
      envelopeId: x.envelopeId,
      budgetNumber: x.budgetNumber,
      status: x.status,
      casavaAntes: da === '',
      casaDepois: dd === '',
      ...(da ? { diferencaAntes: da } : {}),
      ...(dd ? { diferencaDepois: dd } : {}),
    };
  });
  const pararam = envs.filter(x => x.casavaAntes && !x.casaDepois);
  const nomeados: Record<string, string> = {};
  for (const n of [584, 591, 594]) {
    const e = envs.filter(x => x.budgetNumber === n);
    nomeados[`nº ${n}`] = e.length
      ? e
          .map(
            x =>
              `${x.status}: ${x.casavaAntes ? 'casava' : 'não casava'} antes, ${x.casaDepois ? 'casa' : 'não casa'} depois`,
          )
          .join('; ')
      : 'ausente neste banco';
  }
  rel.g11 = {
    envelopes: envs,
    pararamDeCasar: pararam.map(x => x.envelopeId),
    casosNomeados: nomeados,
  };
  rel.invariantes.push({
    fatia: 'G11-dados',
    nome: 'quem casava antes casa depois (arte, cobertura e veículos de cada coleta RUNNING/COMPLETED)',
    esperado: 0,
    achado: pararam.length,
    ok: pararam.length === 0,
  });
  const baseBuild = join(ROOT, 'contracts/signature-golden/build-base.json');
  const casamNoBuild: string[] = existsSync(baseBuild)
    ? (JSON.parse(readFileSync(baseBuild, 'utf8')).casam ?? [])
    : [];
  const buildSemDado = casamNoBuild.filter(id =>
    envs.some(x => x.envelopeId === id && !x.casavaAntes),
  );
  rel.invariantes.push({
    fatia: 'G11-dados',
    nome: 'todo envelope que o G11 (build) casa hoje também casa no nível do dado antes da migração',
    esperado: 0,
    achado: buildSemDado.length,
    ok: buildSemDado.length === 0,
  });
  log(
    `\n── G11-dados: ${envs.length} coletas RUNNING/COMPLETED; ${envs.filter(x => x.casavaAntes).length} casavam antes, ` +
      `${envs.filter(x => x.casaDepois).length} casam depois; pararam de casar: ${pararam.length}`,
  );
  for (const x of pararam) log(`   ✗ ${x.envelopeId} (nº ${x.budgetNumber}): ${x.diferencaDepois}`);
  for (const [k, v] of Object.entries(nomeados)) log(`   ${k}: ${v}`);
}

function fecharRelatorio(rel: Relatorio, saida: string | null): string {
  rel.ok =
    rel.invariantes.length > 0 &&
    rel.invariantes.every(i => i.ok) &&
    rel.fatias.every(f => !f.erro) &&
    (rel.deriva?.ok ?? true);
  const dir = join(ROOT, '.tmp/ensaio-r-b');
  const arquivo =
    saida ??
    join(
      dir,
      `${rel.geradoEm.replace(/[:.]/g, '-')}${rel.modo === 'deriva' ? '-deriva' : ''}.json`,
    );
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, `${JSON.stringify(rel, null, 2)}\n`);
  return arquivo;
}

function resumo(rel: Relatorio): void {
  const falhas = rel.invariantes.filter(i => !i.ok);
  log(
    `\n════ ensaio da R-B (${rel.modo}) — banco ${rel.banco}: ${rel.invariantes.length - falhas.length}/${rel.invariantes.length} invariantes ok`,
  );
  for (const f of falhas)
    log(`   FAIL [${f.fatia}] ${f.nome}: ${f.achado} (esperado ${f.esperado})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO ENSAIO — uma transação, sempre revertida
// ═══════════════════════════════════════════════════════════════════════════
async function ensaio(url: string, o: Opcoes): Promise<Relatorio> {
  const rel = novoRelatorio(nomeDoBanco(url), 'ensaio');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    rel.fatias = await descobrirFatias(c);
    await c.query('BEGIN');
    try {
      await ensaiarDentro(c, rel, true);
    } finally {
      // o "throw" do plano: nada do ensaio sobrevive, dê certo ou não
      await c.query('ROLLBACK');
    }
    const aindaTruck = rel.fatias.some(f => f.id === 'M1' && !f.jaAplicada)
      ? await existe(c, 'Truck')
      : true;
    rel.invariantes.push({
      fatia: 'geral',
      nome: 'ROLLBACK: o banco saiu do ensaio como entrou',
      esperado: 1,
      achado: aindaTruck ? 1 : 0,
      ok: aindaTruck,
    });
  } finally {
    await c.end();
  }
  resumo(rel);
  return rel;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO DERIVA — banco descartável, fatias aplicadas de verdade, migrate diff contra o alvo
// ═══════════════════════════════════════════════════════════════════════════

/** Sobreviventes NOMEADOS: o que o banco migrado tem e o esquema-alvo não declara, de propósito. */
const SOBREVIVENTES: Array<{ padrao: RegExp; porque: string }> = [
  { padrao: /"_Mig0924_/, porque: 'arquivo morto das fatias (fica até limpeza explícita, §4.8)' },
  {
    padrao: /"File".*"quoteLayoutId"|"File_quoteLayoutId_/,
    porque:
      'File.quoteLayoutId + FK + índice caem na M4 (R-D): o processo velho lê a coluna na janela do deploy',
  },
  {
    padrao: /"BudgetLayoutTask"/,
    porque: 'BudgetLayoutTask cai na M4 (DD6: a M3 já a transformou em arte de cada implemento)',
  },
  {
    padrao: /^ALTER TABLE "Implement" ALTER COLUMN "(serialNumber|plate|chassisNumber)Normalized" DROP DEFAULT$/,
    porque:
      'colunas GERADAS (série da M1s; placa e chassi já eram de "Truck") que o Prisma vê como default — a ' +
      'mesma deriva das 170 colunas *Normalized de hoje. Placa e chassi só aparecem aqui quando o banco de ' +
      'origem ainda tem "Truck": o diff de ANTES é contra o schema.prisma, que já diz "Implement", e vê ' +
      'tabela nova em vez da deriva antiga',
  },
  {
    padrao: /^DROP INDEX "Implement_serialNumberNormalized_trgm_idx"$/,
    porque: 'índice GIN (M1s) fora do Prisma — a mesma deriva dos outros índices trigram de hoje',
  },
];

function sh(cmd: string, args: string[], env: NodeJS.ProcessEnv): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** "ALTER TABLE x a, b;" vira ["ALTER TABLE x a", "ALTER TABLE x b"]; comentários e ruído do npm saem. */
function itensDoDiff(script: string, trocarTruck: boolean): string[] {
  const limpo = script
    .split('\n')
    .filter(l => !/^\s*--/.test(l) && !/^npm notice/.test(l) && l.trim() !== '')
    .join('\n');
  const itens: string[] = [];
  for (const bruto of limpo.split(/;\s*(?:\n|$)/)) {
    let st = bruto.replace(/\s+/g, ' ').trim();
    if (!st) continue;
    if (trocarTruck) {
      st = st
        .replace(/"Truck"/g, '"Implement"')
        .replace(/"Truck_/g, '"Implement_')
        .replace(/"TruckCategory"/g, '"ImplementCategory"');
    }
    const m = st.match(/^(ALTER TABLE "[^"]+") (.*)$/);
    if (m && /, (ALTER|ADD|DROP) /.test(m[2])) {
      for (const cl of m[2].split(/, (?=(?:ALTER|ADD|DROP) )/)) itens.push(`${m[1]} ${cl.trim()}`);
    } else itens.push(st);
  }
  return itens;
}

async function deriva(url: string, o: Opcoes): Promise<Relatorio> {
  const origem = nomeDoBanco(url);
  const ensaioDb = `${origem}_ensaio_rb`;
  const urlEnsaio = urlComBanco(url, ensaioDb);
  const urlPostgres = urlComBanco(url, 'postgres');
  const rel = novoRelatorio(ensaioDb, 'deriva');
  const tmp = join(ROOT, '.tmp/ensaio-r-b/deriva');
  const admin = new Client({ connectionString: urlPostgres });
  await admin.connect();
  let criado = false;
  try {
    const outros = await rows(
      admin,
      `SELECT pid, usename, application_name, state FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()`,
      [origem],
    );
    if (outros.length) {
      throw new Error(
        `há ${outros.length} conexão(ões) no ${origem} (CREATE DATABASE … TEMPLATE exige nenhuma): ` +
          outros.map(r => `pid ${r.pid} ${r.application_name || r.usename} ${r.state}`).join('; '),
      );
    }
    await admin.query(`DROP DATABASE IF EXISTS "${ensaioDb}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${ensaioDb}" TEMPLATE "${origem}"`);
    criado = true;
    log(`── banco descartável ${ensaioDb} criado a partir de ${origem}`);

    // "antes", lido no banco descartável antes de migrar
    const c0 = new Client({ connectionString: urlEnsaio });
    await c0.connect();
    let antes: Record<string, number>;
    let leiturasAntes: Map<string, Leitura>;
    try {
      rel.fatias = await descobrirFatias(c0);
      antes = await contagens(c0);
      leiturasAntes = await leituras(c0, [...new Set((await congelados(c0)).map(x => x.quoteId))]);
    } finally {
      await c0.end();
    }

    // Deriva ANTES: o banco de hoje × o schema.prisma de hoje (colunas geradas, GIN etc. — conhecida).
    const env = { ...process.env, DATABASE_URL: urlEnsaio };
    const d0 = sh(
      'npx',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-url',
        urlEnsaio,
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--script',
      ],
      env,
    );
    if (!d0.ok) throw new Error(`migrate diff (antes) falhou:\n${d0.out}`);

    // Aplica DE VERDADE: pasta temporária com as migrações de hoje + as fatias pendentes, esquema = alvo.
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(join(tmp, 'migrations'), { recursive: true });
    cpSync(MIGRATIONS, join(tmp, 'migrations'), { recursive: true });
    for (const f of rel.fatias.filter(x => !x.jaAplicada)) {
      mkdirSync(join(tmp, 'migrations', f.nome), { recursive: true });
      cpSync(join(ROOT, f.fonte), join(tmp, 'migrations', f.nome, 'migration.sql'));
    }
    cpSync(ALVO, join(tmp, 'schema.prisma'));
    const t0 = Date.now();
    const dep = sh(
      'npx',
      ['prisma', 'migrate', 'deploy', '--schema', join(tmp, 'schema.prisma')],
      env,
    );
    log(
      dep.out
        .split('\n')
        .filter(l => /Applying|applied|migrations found|All migrations|Error/.test(l))
        .map(l => `   ${l}`)
        .join('\n'),
    );
    if (!dep.ok) {
      rel.invariantes.push({
        fatia: 'geral',
        nome: 'prisma migrate deploy das fatias',
        esperado: 'ok',
        achado: dep.out.slice(-2000),
        ok: false,
      });
      resumo(rel);
      return rel;
    }
    log(`   migrate deploy em ${Date.now() - t0} ms`);
    const st = sh(
      'npx',
      ['prisma', 'migrate', 'status', '--schema', join(tmp, 'schema.prisma')],
      env,
    );
    rel.invariantes.push({
      fatia: 'geral',
      nome: 'prisma migrate status limpo depois das fatias',
      esperado: 'limpo',
      achado: st.ok && /up to date/i.test(st.out) ? 'limpo' : st.out.slice(-800),
      ok: st.ok && /up to date/i.test(st.out),
    });

    // Invariantes e G25 no banco migrado (numa transação revertida: os testes de gatilho escrevem).
    const c = new Client({ connectionString: urlEnsaio });
    await c.connect();
    try {
      await c.query('BEGIN');
      try {
        await ensaiarDentro(c, rel, false, { antes: antes!, leiturasAntes: leiturasAntes! });
      } finally {
        await c.query('ROLLBACK');
      }
    } finally {
      await c.end();
    }

    // Deriva DEPOIS: o banco migrado × o esquema-alvo.
    const d1 = sh(
      'npx',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-url',
        urlEnsaio,
        '--to-schema-datamodel',
        ALVO,
        '--script',
      ],
      env,
    );
    if (!d1.ok) throw new Error(`migrate diff (depois) falhou:\n${d1.out}`);
    const conhecidos = new Set(itensDoDiff(d0.out, true));
    const depoisItens = itensDoDiff(d1.out, false);
    const novos = depoisItens.filter(i => !conhecidos.has(i));
    const sobreviventes = novos.filter(i => SOBREVIVENTES.some(s => s.padrao.test(i)));
    const inesperados = novos.filter(i => !SOBREVIVENTES.some(s => s.padrao.test(i)));
    const somem = [...conhecidos].filter(i => !depoisItens.includes(i)).length;
    rel.deriva = {
      novas: inesperados,
      sobreviventes,
      somemDaDeriva: somem,
      ok: inesperados.length === 0,
    };
    log(
      `\n── sem deriva: ${depoisItens.length} itens no diff banco migrado × alvo; ${conhecidos.size} já existiam antes ` +
        `(banco × schema.prisma de hoje); ${sobreviventes.length} sobreviventes nomeados; ${somem} itens da deriva antiga sumiram; ` +
        `${inesperados.length} inesperado(s)`,
    );
    for (const s of sobreviventes) log(`   · sobrevivente: ${s}`);
    for (const i of inesperados) log(`   ✗ DERIVA: ${i}`);
    rel.invariantes.push({
      fatia: 'geral',
      nome: 'sem deriva: só a deriva antiga e os sobreviventes nomeados',
      esperado: 0,
      achado: inesperados.length,
      ok: inesperados.length === 0,
    });

    if (o.comando) {
      log(`\n── comando contra o banco migrado: ${o.comando}`);
      const r = spawnSync('bash', ['-c', o.comando], { cwd: ROOT, env, stdio: 'inherit' });
      rel.invariantes.push({
        fatia: 'geral',
        nome: `comando: ${o.comando}`,
        esperado: 0,
        achado: r.status ?? -1,
        ok: r.status === 0,
      });
    }
  } finally {
    if (criado) {
      await admin.query(`DROP DATABASE IF EXISTS "${ensaioDb}" WITH (FORCE)`);
      log(`── banco descartável ${ensaioDb} apagado`);
    }
    await admin.end();
    rmSync(tmp, { recursive: true, force: true });
  }
  resumo(rel);
  return rel;
}

async function main(): Promise<void> {
  const o = lerOpcoes(process.argv.slice(2));
  silencioso = o.silencioso;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'DATABASE_URL vazio: rode `source …/scratchpad/implemento-env.sh` antes (banco da Fase B)',
    );
    process.exit(2);
  }
  const banco = nomeDoBanco(url);
  if (/production|veiculos/i.test(banco) && !o.bancoDeProducao) {
    console.error(
      `recusado: o banco "${banco}" parece de produção ou de outra sessão; passe --banco-de-producao se é isso mesmo (P30)`,
    );
    process.exit(2);
  }
  if (o.deriva && /production/i.test(banco)) {
    console.error(
      'recusado: --deriva cria e apaga um banco ao lado do de origem; não se usa em produção',
    );
    process.exit(2);
  }
  const rel = o.deriva ? await deriva(url, o) : await ensaio(url, o);
  const arquivo = fecharRelatorio(rel, o.saida);
  log(`   relatório: ${arquivo.replace(`${ROOT}/`, '')}`);
  log(rel.ok ? '   ✓ ensaio verde' : '   ✗ ensaio VERMELHO');
  process.exit(rel.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
