/**
 * ENSAIO DA R-B NA RÉGUA — o ensaio das fatias do rework do implemento roda verde E reverte.
 *
 * Duas promessas, as duas precisam valer para o ensaio servir do P10 ao P30:
 *   1. VERDE: `scripts/rehearse-implement-migration.ts` aplica as fatias ainda não aplicadas
 *      (prisma/staged/r-b/ ou prisma/migrations/, conforme o pacote que as promoveu) numa transação,
 *      e todas as invariantes do §4.6, o G25 da R-B e o G11-dados ("quem casava antes casa
 *      depois") ficam no esperado.
 *   2. REVERTE: o banco sai do ensaio EXATAMENTE como entrou — mesmas contagens, mesmo catálogo
 *      (tabelas, colunas, tipos e valores de enum, gatilhos, índices, constraints). Um ensaio que
 *      deixasse resto (um `_Mig0924_*`, um gatilho, um valor de enum) contaminaria o banco da Fase B
 *      e esconderia o defeito do próximo pacote.
 *
 *   npm run test:rehearse-r-b      (com DATABASE_URL do banco da Fase B)
 *
 * Só lê o banco fora do ensaio; o ensaio escreve dentro de uma transação que sempre dá ROLLBACK.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = require('pg') as {
  Client: new (cfg: { connectionString: string }) => {
    connect(): Promise<void>;
    query(sql: string): Promise<{ rows: Array<Record<string, any>> }>;
    end(): Promise<void>;
  };
};

let ok = 0;
let fail = 0;
function check(nome: string, cond: boolean, detalhe = ''): void {
  if (cond) {
    ok++;
    console.log(`[  ok  ] ${nome}`);
  } else {
    fail++;
    console.log(`[ FAIL ] ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

/** Contagens e uma impressão digital do catálogo inteiro do schema public. */
async function fotografia(
  url: string,
): Promise<{ contagens: Record<string, number>; catalogo: string; migracoes: number }> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const um = async (sql: string) =>
      Number(Object.values((await c.query(sql)).rows[0] ?? { n: 0 })[0] ?? 0);
    const veiculo = (await um(`SELECT (to_regclass('public."Implement"') IS NOT NULL)::int`))
      ? 'Implement'
      : 'Truck';
    const contagens: Record<string, number> = {
      Task: await um(`SELECT count(*) FROM "Task"`),
      [veiculo]: await um(`SELECT count(*) FROM "${veiculo}"`),
      Budget: await um(`SELECT count(*) FROM "Budget"`),
      Layout: await um(`SELECT count(*) FROM "Layout"`),
      File: await um(`SELECT count(*) FROM "File"`),
      ImplementMeasure: await um(`SELECT count(*) FROM "ImplementMeasure"`),
      ImplementMeasureSection: await um(`SELECT count(*) FROM "ImplementMeasureSection"`),
      _TASK_PROJECT_FILES: await um(`SELECT count(*) FROM "_TASK_PROJECT_FILES"`),
    };
    const catalogo = (
      await c.query(`SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
        SELECT 'rel:' || c.relname::text || ':' || c.relkind::text AS x FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
        UNION ALL SELECT 'col:' || table_name || '.' || column_name || ':' || udt_name || ':' || coalesce(column_default,'') || ':' || is_generated
          FROM information_schema.columns WHERE table_schema='public'
        UNION ALL SELECT 'enum:' || t.typname::text || ':' || e.enumlabel::text || ':' || e.enumsortorder::text FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
        UNION ALL SELECT 'tg:' || tgname::text || ':' || tgrelid::regclass::text FROM pg_trigger WHERE NOT tgisinternal
        UNION ALL SELECT 'con:' || conname::text || ':' || conrelid::regclass::text FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'
        UNION ALL SELECT 'fn:' || p.proname::text || ':' || md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      ) z`)
    ).rows[0].h as string;
    const migracoes = await um(`SELECT count(*) FROM _prisma_migrations`);
    return { contagens, catalogo, migracoes };
  } finally {
    await c.end();
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL vazio (source …/scratchpad/implemento-env.sh)');
    process.exit(2);
  }
  const antes = await fotografia(url);
  const dir = mkdtempSync(join(tmpdir(), 'ensaio-rb-'));
  const saida = join(dir, 'relatorio.json');
  try {
    const r = spawnSync(
      'npx',
      ['tsx', 'scripts/rehearse-implement-migration.ts', '--saida', saida],
      {
        cwd: join(__dirname, '..'),
        env: process.env,
        stdio: 'inherit',
      },
    );
    check('o ensaio termina verde (saída 0)', r.status === 0, `saída ${r.status}`);

    const rel = JSON.parse(readFileSync(saida, 'utf8')) as {
      ok: boolean;
      fatias: Array<{ id: string; jaAplicada: boolean; erro?: string }>;
      invariantes: Array<{
        fatia: string;
        nome: string;
        ok: boolean;
        achado: unknown;
        esperado: unknown;
      }>;
      g25: Array<{ existe: boolean }>;
      g11: { pararamDeCasar: string[] } | null;
      triagem: Record<string, number>;
    };
    check('o relatório diz ok', rel.ok === true);
    check(
      'as seis fatias da R-B estão no relatório, em ordem de carimbo',
      rel.fatias.map(f => f.id).join(',') === 'M1,M1s,M2,M3,M3o-a,M3o-b',
      rel.fatias.map(f => f.id).join(','),
    );
    check(
      'nenhuma fatia falhou ao aplicar',
      rel.fatias.every(f => !f.erro),
      rel.fatias
        .filter(f => f.erro)
        .map(f => `${f.id}: ${f.erro}`)
        .join('; '),
    );
    const pendentes = rel.fatias.filter(f => !f.jaAplicada).map(f => f.id);
    for (const id of pendentes) {
      check(
        `a fatia pendente ${id} tem invariantes próprias no relatório`,
        rel.invariantes.some(i => i.fatia === id),
      );
    }
    const ruins = rel.invariantes.filter(i => !i.ok);
    check(
      'todas as invariantes no esperado',
      ruins.length === 0,
      ruins
        .map(i => `[${i.fatia}] ${i.nome}: ${String(i.achado)} (esperado ${String(i.esperado)})`)
        .join('; '),
    );
    check(
      'G25 da R-B: todo objeto das fatias aplicadas existe',
      rel.g25.length > 0 && rel.g25.every(o => o.existe),
    );
    check(
      'G11-dados rodou e ninguém parou de casar',
      !!rel.g11 && rel.g11.pararamDeCasar.length === 0,
    );
    if (pendentes.includes('M3o-a')) {
      check(
        'a triagem LEGACY_APPROVED_UNSIGNED é gerada (DD7/DD11)',
        'LEGACY_APPROVED_UNSIGNED' in rel.triagem,
        JSON.stringify(rel.triagem),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const depois = await fotografia(url);
  check(
    'REVERTE: contagens iguais antes e depois do ensaio',
    JSON.stringify(antes.contagens) === JSON.stringify(depois.contagens),
    `${JSON.stringify(antes.contagens)} → ${JSON.stringify(depois.contagens)}`,
  );
  check(
    'REVERTE: catálogo idêntico (tabelas, colunas, enums, gatilhos, constraints, funções)',
    antes.catalogo === depois.catalogo,
  );
  check('REVERTE: nenhuma migração registrada pelo ensaio', antes.migracoes === depois.migracoes);

  console.log(`\n${ok} ok, ${fail} falha(s)`);
  if (fail > 0) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
