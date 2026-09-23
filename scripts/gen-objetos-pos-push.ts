/**
 * G25 — GERA `prisma/sql/objetos-pos-push.sql` a partir de um banco MIGRADO.
 *
 * `prisma db push` cria tabelas e colunas a partir do schema.prisma, mas não
 * sabe nada do que as migrations fazem à mão: colunas GERADAS (os `*Normalized`
 * da busca sem acento), gatilhos (arquivo referenciado não se apaga, trilha da
 * assinatura só cresce, signatário assinado congela), funções, índices GIN
 * (trigram) e CHECKs. Um teste que roda num banco de `db push` passa verde sem
 * nada disso — e o defeito só aparece em produção.
 *
 * Este script lê o catálogo do banco de DATABASE_URL (SOMENTE LEITURA; use um
 * banco que subiu por `migrate deploy`, como o clone local) e escreve um SQL
 * IDEMPOTENTE que, rodado depois de um `db push`, deixa o banco com os mesmos
 * objetos:
 *
 *   psql "$URL_DO_BANCO_DE_TESTE" -v ON_ERROR_STOP=1 -f prisma/sql/objetos-pos-push.sql
 *
 * Regerar sempre que uma migration criar um desses objetos:
 *   npx tsx scripts/gen-objetos-pos-push.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

const OUT = join(__dirname, '../prisma/sql/objetos-pos-push.sql');

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const exts = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname`;

    // Funções de usuário no schema public (fora das de migração de dados, `_mig_*`,
    // e das que vêm de extensão).
    const funcs = await prisma.$queryRaw<{ name: string; def: string }[]>`
      SELECT p.proname AS name, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prokind = 'f'
        AND p.proname NOT LIKE '\\_mig\\_%'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      ORDER BY p.proname`;

    const generated = await prisma.$queryRaw<
      { table: string; column: string; type: string; expr: string }[]
    >`
      SELECT c.table_name AS "table", c.column_name AS "column",
             format_type(a.atttypid, a.atttypmod) AS type,
             c.generation_expression AS expr
      FROM information_schema.columns c
      JOIN pg_attribute a
        ON a.attrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
       AND a.attname = c.column_name
      WHERE c.table_schema = 'public' AND c.is_generated = 'ALWAYS'
      ORDER BY c.table_name, c.column_name`;

    const triggers = await prisma.$queryRaw<{ table: string; name: string; def: string }[]>`
      SELECT c.relname AS "table", t.tgname AS name, pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
      ORDER BY c.relname, t.tgname`;

    // Índices que o schema.prisma não descreve (GIN/GiST e de expressão) E todo
    // índice sobre coluna gerada: o DROP COLUMN abaixo leva junto os índices da
    // coluna, inclusive os btree que o `db push` tinha criado.
    const allIndexes = await prisma.$queryRaw<{ table: string; name: string; def: string }[]>`
      SELECT i.tablename AS "table", i.indexname AS name, i.indexdef AS def
      FROM pg_indexes i
      WHERE i.schemaname = 'public'
      ORDER BY i.indexname`;

    const checks = await prisma.$queryRaw<{ table: string; name: string; def: string }[]>`
      SELECT c.relname AS "table", con.conname AS name, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND con.contype = 'c'
      ORDER BY c.relname, con.conname`;

    const generatedByTable = new Map<string, string[]>();
    for (const g of generated) {
      generatedByTable.set(g.table, [...(generatedByTable.get(g.table) ?? []), g.column]);
    }
    const indexes = allIndexes.filter(i => {
      if (/ USING (gin|gist) /i.test(i.def)) return true;
      if (/\(\s*(lower|upper|immutable_unaccent|unaccent|coalesce)\(/i.test(i.def)) return true;
      const cols = generatedByTable.get(i.table) ?? [];
      return cols.some(c => i.def.includes(`"${c}"`) || new RegExp(`[(, ]${c}[), ]`).test(i.def));
    });

    const out: string[] = [];
    out.push(
      '-- G25 — OBJETOS DE BANCO QUE `prisma db push` NÃO CRIA.',
      '--',
      '-- GERADO por scripts/gen-objetos-pos-push.ts a partir de um banco migrado',
      `-- (${new Date().toISOString().slice(0, 10)}). NÃO EDITAR À MÃO: regerar quando uma migration`,
      '-- criar coluna gerada, gatilho, função, índice GIN/expressão ou CHECK.',
      '--',
      '-- Uso, num banco de TESTE que subiu por `db push`:',
      '--   psql "$URL" -v ON_ERROR_STOP=1 -f prisma/sql/objetos-pos-push.sql',
      '-- Idempotente. NUNCA rodar em produção (lá tudo vem das migrations).',
      '--',
      `-- ${exts.length} extensões, ${funcs.length} funções, ${generated.length} colunas geradas,`,
      `-- ${triggers.length} gatilhos, ${indexes.length} índices, ${checks.length} CHECKs.`,
      '',
      'BEGIN;',
      '',
      '-- ── extensões ──',
    );
    for (const e of exts) out.push(`CREATE EXTENSION IF NOT EXISTS ${q(e.extname)};`);

    out.push('', '-- ── funções ──');
    for (const f of funcs) out.push(`${f.def.trim()};`, '');

    out.push(
      '-- ── colunas geradas ──',
      '-- `db push` as cria como colunas comuns; aqui viram GENERATED de novo (o valor',
      '-- é recalculado pelo banco, e escrever nelas à mão passa a ser erro — como em produção).',
    );
    for (const g of generated) {
      out.push(
        `ALTER TABLE ${q(g.table)} DROP COLUMN IF EXISTS ${q(g.column)};`,
        `ALTER TABLE ${q(g.table)} ADD COLUMN ${q(g.column)} ${g.type} GENERATED ALWAYS AS (${g.expr}) STORED;`,
      );
    }

    out.push('', '-- ── gatilhos ──');
    for (const t of triggers) {
      out.push(`DROP TRIGGER IF EXISTS ${q(t.name)} ON ${q(t.table)};`, `${t.def.trim()};`);
    }

    out.push('', '-- ── índices (GIN/GiST, de expressão e sobre coluna gerada) ──');
    for (const i of indexes) {
      out.push(`${i.def.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ')};`);
    }

    out.push('', '-- ── CHECKs ──');
    for (const c of checks) {
      out.push(
        `ALTER TABLE ${q(c.table)} DROP CONSTRAINT IF EXISTS ${q(c.name)};`,
        `ALTER TABLE ${q(c.table)} ADD CONSTRAINT ${q(c.name)} ${c.def};`,
      );
    }

    out.push('', 'COMMIT;', '');
    writeFileSync(OUT, out.join('\n'));
    console.log(
      `[G25] ${OUT}: ${exts.length} extensões, ${funcs.length} funções, ${generated.length} colunas geradas, ` +
        `${triggers.length} gatilhos, ${indexes.length} índices, ${checks.length} CHECKs`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
