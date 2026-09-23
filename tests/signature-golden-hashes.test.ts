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
 *   C. BUILD (DATABASE_URL, só leitura): as partes A e B só re-hasheiam
 *      snapshots CONGELADOS — uma mudança no que `build()` põe no snapshot
 *      passava invisível, e é ela que invalida em massa as coletas RUNNING
 *      (R-B-05). Aqui cada envelope RUNNING/COMPLETED é reconstruído do banco
 *      com `buildForQuote` (o mesmo caminho da invalidação e do selo) e
 *      comparado ao congelado por `matchesFrozenTerms`, com os signatários
 *      pendentes. O conjunto que casa hoje é o ouro "antes" do P12
 *      (`contracts/signature-golden/build-base.json`): quem casava tem de
 *      continuar casando; quem não casa (orçamento editado depois da emissão)
 *      está listado, e a lista só encolhe. Regravar a base:
 *      GRAVAR_BASE_BUILD=1 npm run test:signature-golden
 *
 * Regravar o ouro (só quando o clone mudar, nunca para "consertar" o teste):
 *   npx tsx scripts/export-signature-golden.ts
 *
 * Rodar: npm run test:signature-golden   |   SEM_BANCO=1 … (só A)
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
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

interface BaseBuild {
  descricao: string;
  geradaEm: string;
  /** envelopes RUNNING/COMPLETED cujo build de hoje casa com o congelado */
  casam: string[];
  /** envelopes cujo orçamento mudou depois da emissão (não casam) — só encolhe */
  naoCasam: Record<string, string>;
}

const BASE_BUILD = join(__dirname, '../contracts/signature-golden/build-base.json');

async function parteC(): Promise<void> {
  console.log('\n── C. build() de hoje × termos congelados (só leitura)');
  const prisma = new PrismaClient();
  try {
    const service = new QuoteSnapshotService(prisma as any);
    const envs = await prisma.signatureEnvelope.findMany({
      where: { status: { in: ['RUNNING', 'COMPLETED'] } },
      select: {
        id: true,
        quoteId: true,
        status: true,
        quoteSnapshot: true,
        quoteTermsSha256: true,
        signers: { select: { signedAt: true, responsibleId: true } },
      },
      orderBy: { id: 'asc' },
    });
    const casam: string[] = [];
    const naoCasam: Record<string, string> = {};
    for (const env of envs) {
      const frozen = env.quoteSnapshot as unknown as QuoteSnapshot;
      const fresh = await service.buildForQuote(env.quoteId);
      if (!fresh) {
        naoCasam[env.id] = `${env.status}: orçamento sumiu`;
        continue;
      }
      const pending = env.signers
        .filter(sg => !sg.signedAt)
        .map(sg => sg.responsibleId)
        .filter((id): id is string => !!id);
      const termos = env.quoteTermsSha256 ?? service.materialHash(frozen);
      const versao = service.matchesFrozenTerms(fresh.snapshot, termos, frozen, pending);
      if (versao === null) naoCasam[env.id] = `${env.status}: o orçamento mudou depois da emissão`;
      else casam.push(env.id);
    }
    console.log(
      `   ${envs.length} envelopes RUNNING/COMPLETED: ${casam.length} casam, ` +
        `${Object.keys(naoCasam).length} não casam`,
    );

    if (process.env.GRAVAR_BASE_BUILD) {
      const base: BaseBuild = {
        descricao:
          'G11 parte C: envelopes RUNNING/COMPLETED do clone cujo build() de hoje casa com os ' +
          'termos congelados (o ouro "antes" do P12) e os que não casam (orçamento editado ' +
          'depois da emissão; a lista só encolhe). Regravar: GRAVAR_BASE_BUILD=1 npm run ' +
          'test:signature-golden.',
        geradaEm: new Date().toISOString().slice(0, 10),
        casam,
        naoCasam,
      };
      writeFileSync(BASE_BUILD, `${JSON.stringify(base, null, 2)}\n`);
      console.log(`   base gravada em ${BASE_BUILD}`);
      return;
    }
    if (!existsSync(BASE_BUILD)) {
      check('a base do build existe (GRAVAR_BASE_BUILD=1 para criar)', false);
      return;
    }
    const base = JSON.parse(readFileSync(BASE_BUILD, 'utf8')) as BaseBuild;
    const existentes = new Set(envs.map(e => e.id));
    const pararamDeCasar = base.casam.filter(id => existentes.has(id) && !casam.includes(id));
    check(
      'quem casava antes casa depois: nenhum envelope da base deixou de casar com o build() de hoje',
      pararamDeCasar.length === 0,
      pararamDeCasar.join(', '),
    );
    const novosQueNaoCasam = Object.keys(naoCasam).filter(
      id => !(id in base.naoCasam) && !base.casam.includes(id),
    );
    check(
      'envelope novo no banco casa com o build() de hoje',
      novosQueNaoCasam.length === 0,
      novosQueNaoCasam.map(id => `${id} (${naoCasam[id]})`).join(', '),
    );
    const voltaramACasar = Object.keys(base.naoCasam).filter(id => casam.includes(id));
    check(
      'a lista dos que não casam não tem quem já casa (só encolhe; regrave a base)',
      voltaramACasar.length === 0,
      voltaramACasar.join(', '),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  parteA();
  if (process.env.SEM_BANCO) console.log('\n(SEM_BANCO: partes B e C puladas)');
  else {
    await parteB();
    await parteC();
  }
  console.log(`\n${ok} ok, ${fail} falha(s)`);
  if (fail > 0) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
