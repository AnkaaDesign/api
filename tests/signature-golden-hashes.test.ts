/**
 * G11 (base) — HASHES DE OURO DAS ASSINATURAS.
 *
 * A invariante que o rework do implemento não pode quebrar: QUEM CASAVA ANTES
 * CASA DEPOIS. Um envelope emitido é a prova do que o cliente viu; se a
 * projeção material ou o canonicalizador mudarem o hash de um envelope já
 * emitido, toda coleta em curso é invalidada em massa (e as concluídas passam a
 * acusar deriva).
 *
 * Duas partes:
 *   A. OURO (sem banco): cada envelope de
 *      `contracts/signature-golden/envelopes.json` (anonimizado do clone, mais os
 *      sintéticos PER_VEHICLE) reproduz, com o código de HOJE, o hash do
 *      snapshot e o hash dos termos na versão gravada. E `matchesFrozenTerms`
 *      reconhece cada um (é o caminho que decide invalidação).
 *   B. BANCO (DATABASE_URL, só leitura): todo `SignatureEnvelope` do banco
 *      reproduz o `quoteSnapshotSha256` gravado, e todo `quoteTermsSha256`
 *      gravado casa em alguma versão do recorte. É o "antes" que o P10/P12/P30
 *      comparam com o "depois" da migração.
 *
 * Regravar o ouro (só quando o clone mudar, nunca para "consertar" o teste):
 *   npx tsx scripts/export-signature-golden.ts
 *
 * Rodar: npm run test:signature-golden   |   SEM_BANCO=1 … (só A)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import {
  QuoteSnapshotService,
  type QuoteSnapshot,
} from '../src/modules/common/signature/services/quote-snapshot.service';

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

interface Ouro {
  caso: string;
  status: string;
  layoutScope: string | null;
  snapshot: QuoteSnapshot;
  snapshotSha256: string;
  termsVersion: number | null;
  termsSha256: string | null;
}

const snapshots = new QuoteSnapshotService(null as any);

function parteA(): void {
  console.log('\n── A. ouro (sem banco)');
  const doc = JSON.parse(
    readFileSync(join(__dirname, '../contracts/signature-golden/envelopes.json'), 'utf8'),
  ) as { envelopes: Ouro[]; totais: Record<string, number> };

  check('o ouro tem envelopes', doc.envelopes.length > 0, `${doc.envelopes.length}`);
  check(
    'o ouro cobre PER_VEHICLE (DD6)',
    doc.envelopes.some(e => e.layoutScope === 'PER_VEHICLE'),
  );

  const snapErrados: string[] = [];
  const termosErrados: string[] = [];
  const naoReconhecidos: string[] = [];
  for (const e of doc.envelopes) {
    if (snapshots.hash(e.snapshot) !== e.snapshotSha256) snapErrados.push(e.caso);
    if (e.termsVersion !== null && e.termsSha256) {
      if (snapshots.materialHash(e.snapshot, e.termsVersion) !== e.termsSha256) {
        termosErrados.push(`${e.caso} (v${e.termsVersion})`);
      }
      if (snapshots.matchesFrozenTerms(e.snapshot, e.termsSha256, e.snapshot) === null) {
        naoReconhecidos.push(e.caso);
      }
    }
  }
  check(
    'todo snapshot de ouro reproduz o próprio hash (canonicalizador estável)',
    snapErrados.length === 0,
    snapErrados.join(', '),
  );
  check(
    'todo hash de termos de ouro se reproduz na versão gravada (projeção material estável)',
    termosErrados.length === 0,
    termosErrados.join(', '),
  );
  check(
    'matchesFrozenTerms reconhece todo envelope de ouro contra ele mesmo',
    naoReconhecidos.length === 0,
    naoReconhecidos.join(', '),
  );

  // o teste não é vazio: mexer no preço de um envelope de ouro TEM de divergir
  const alvo = doc.envelopes.find(e => e.termsSha256 && e.snapshot.services?.length);
  if (alvo) {
    const mexido = JSON.parse(JSON.stringify(alvo.snapshot)) as QuoteSnapshot;
    mexido.services[0].amount = `${Number(mexido.services[0].amount) + 1}.00`;
    check(
      'mudança material (preço) num envelope de ouro diverge do hash de termos',
      snapshots.matchesFrozenTerms(mexido, alvo.termsSha256!, alvo.snapshot) === null,
    );
  }
}

async function parteB(): Promise<void> {
  console.log('\n── B. banco (só leitura)');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.signatureEnvelope.findMany({
      select: { id: true, quoteSnapshot: true, quoteSnapshotSha256: true, quoteTermsSha256: true },
    });
    const snapErrados: string[] = [];
    const termosSemCasar: string[] = [];
    let comTermos = 0;
    for (const r of rows) {
      const s = r.quoteSnapshot as unknown as QuoteSnapshot;
      if (snapshots.hash(s) !== r.quoteSnapshotSha256) snapErrados.push(r.id);
      if (r.quoteTermsSha256) {
        comTermos++;
        if (snapshots.matchesFrozenTerms(s, r.quoteTermsSha256, s) === null) {
          termosSemCasar.push(r.id);
        }
      }
    }
    console.log(`   ${rows.length} envelopes, ${comTermos} com hash de termos`);
    check(
      'todo envelope do banco reproduz o quoteSnapshotSha256 gravado',
      snapErrados.length === 0,
      snapErrados.join(', '),
    );
    check(
      'todo quoteTermsSha256 gravado casa em alguma versão do recorte material',
      termosSemCasar.length === 0,
      termosSemCasar.join(', '),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  parteA();
  if (process.env.SEM_BANCO) console.log('\n(SEM_BANCO: parte B pulada)');
  else await parteB();
  console.log(`\n${ok} ok, ${fail} falha(s)`);
  if (fail > 0) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
