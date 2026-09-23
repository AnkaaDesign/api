/**
 * G11 — EXPORTA OS "HASHES DE OURO" DAS ASSINATURAS (somente leitura).
 *
 * Lê do banco de DATABASE_URL (o clone local; NUNCA produção sem autorização do
 * dono) todo `SignatureEnvelope` e grava `contracts/signature-golden/envelopes.json`:
 *
 *   - prova, no banco, que o snapshot congelado de cada envelope reproduz o
 *     `quoteSnapshotSha256` gravado e, quando há `quoteTermsSha256`, em QUAL
 *     versão do recorte material ele casa (`matchesFrozenTerms`);
 *   - ANONIMIZA o snapshot (nome, documento, placa, chassi, série, nº do
 *     pedido, telefone, e-mail e texto livre viram pseudônimos determinísticos —
 *     o mesmo valor vira sempre o mesmo pseudônimo, então as relações de
 *     igualdade que as tolerâncias usam ficam de pé; ids, valores, datas e
 *     enums ficam);
 *   - recalcula os dois hashes SOBRE O ANONIMIZADO, na versão em que o real
 *     casou. São esses que o teste (`tests/signature-golden-hashes.test.ts`)
 *     reproduz: qualquer mudança no canonicalizador ou na projeção material que
 *     mexa num envelope já emitido reprova.
 *
 * Também grava dois casos SINTÉTICOS de `PER_VEHICLE` (cobertura uniforme e
 * não uniforme), porque o clone de 23/09 não tem nenhum envelope assim e a DD6
 * exige que o G11 os cubra.
 *
 * Rodar: npx tsx scripts/export-signature-golden.ts
 */
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import {
  QUOTE_MATERIAL_SCHEMA_VERSION,
  QuoteSnapshotService,
  type QuoteSnapshot,
} from '../src/modules/common/signature/services/quote-snapshot.service';

const OUT = join(__dirname, '../contracts/signature-golden/envelopes.json');

function h(v: string, n = 10): string {
  return createHash('sha256').update(`ankaa-golden:${v}`).digest('hex').slice(0, n);
}

function digits(v: string, len: number): string {
  const hex = createHash('sha256').update(`ankaa-golden-d:${v}`).digest('hex');
  let out = '';
  for (let i = 0; out.length < len; i++) out += (parseInt(hex[i % hex.length], 16) % 10).toString();
  return out;
}

const TEXT_KEYS = new Set([
  'corporateName',
  'fantasyName',
  'name',
  'taskName',
  'description',
  'observation',
  'customPaymentText',
  'customGuaranteeText',
  'reference',
]);
const UPPER_KEYS = new Set(['plate', 'chassisNumber', 'serialNumber', 'orderNumber']);

function anonValue(key: string, v: unknown): unknown {
  if (typeof v !== 'string' || v === '') return v;
  if (key === 'document') return digits(v, v.replace(/\D/g, '').length || 14);
  if (key === 'phoneDigits') return digits(v, v.length);
  if (key === 'emailNormalized' || key === 'email') return `anon-${h(v, 8)}@exemplo.invalid`;
  if (UPPER_KEYS.has(key)) return `ANON${h(v, 6).toUpperCase()}`;
  if (TEXT_KEYS.has(key)) return `Texto ${h(v, 8)}`;
  return v;
}

function anonymize(node: unknown, key = ''): unknown {
  if (Array.isArray(node)) return node.map(n => anonymize(n, key));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = anonymize(v, k);
    return out;
  }
  return anonValue(key, node);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const snapshots = new QuoteSnapshotService(null as any);
  try {
    const rows = await prisma.signatureEnvelope.findMany({
      select: {
        id: true,
        status: true,
        version: true,
        quoteSnapshot: true,
        quoteSnapshotSha256: true,
        quoteTermsSha256: true,
        quote: { select: { layoutScope: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const envelopes = rows.map((r, i) => {
      const real = r.quoteSnapshot as unknown as QuoteSnapshot;
      const snapshotCasa = snapshots.hash(real) === r.quoteSnapshotSha256;
      const versao = r.quoteTermsSha256
        ? snapshots.matchesFrozenTerms(real, r.quoteTermsSha256)
        : null;
      const anon = anonymize(real) as QuoteSnapshot;
      return {
        caso: `envelope-${String(i + 1).padStart(2, '0')}`,
        status: r.status,
        versaoEnvelope: r.version,
        layoutScope: r.quote?.layoutScope ?? null,
        schemaVersion: (real as any)?.schemaVersion ?? null,
        noBanco: {
          snapshotCasa,
          termosGravados: !!r.quoteTermsSha256,
          versaoMaterialQueCasa: versao,
        },
        snapshot: anon,
        snapshotSha256: snapshots.hash(anon),
        termsVersion: versao,
        termsSha256: versao ? snapshots.materialHash(anon, versao) : null,
      };
    });

    // Sintéticos PER_VEHICLE, a partir do primeiro v4 com dois ou mais veículos
    // (ou do primeiro v4, duplicando o veículo).
    const base = envelopes.find(e => e.schemaVersion === 4)?.snapshot as any;
    const sinteticos: any[] = [];
    if (base) {
      const veiculos =
        Array.isArray(base.vehicles) && base.vehicles.length >= 2
          ? base.vehicles
          : [
              ...(base.vehicles ?? []),
              { ...(base.vehicles?.[0] ?? {}), taskId: '00000000-0000-4000-8000-00000000c0de' },
            ];
      const ids: string[] = veiculos.map((v: any) => v.taskId);
      const arteA = '00000000-0000-4000-8000-00000000a001';
      const arteB = '00000000-0000-4000-8000-00000000b002';
      for (const [caso, coverage] of [
        ['sintetico-per-vehicle-uniforme', [[arteA, ids]]],
        [
          'sintetico-per-vehicle-nao-uniforme',
          [
            [arteA, [ids[0]]],
            [arteB, ids.slice(1)],
          ],
        ],
      ] as const) {
        const snap = {
          ...base,
          vehicles: veiculos,
          layoutFileIds: [...new Set((coverage as any[]).map(([f]) => f))],
          layoutCoverage: coverage,
        } as QuoteSnapshot;
        sinteticos.push({
          caso,
          status: 'SINTETICO',
          versaoEnvelope: 1,
          layoutScope: 'PER_VEHICLE',
          schemaVersion: 4,
          noBanco: null,
          snapshot: snap,
          snapshotSha256: snapshots.hash(snap),
          termsVersion: QUOTE_MATERIAL_SCHEMA_VERSION,
          termsSha256: snapshots.materialHash(snap, QUOTE_MATERIAL_SCHEMA_VERSION),
        });
      }
    }

    const doc = {
      descricao:
        'G11 — hashes de ouro das assinaturas. Snapshots ANONIMIZADOS do clone local; os hashes ' +
        'foram recalculados sobre o anonimizado, na versão do recorte material em que o envelope ' +
        'REAL casava no banco (noBanco). Gerado por scripts/export-signature-golden.ts; não editar ' +
        'à mão. Os 30 COMPLETED de produção entram no P30 (ou por exportação somente leitura ' +
        'autorizada pelo dono).',
      geradoEm: new Date().toISOString().slice(0, 10),
      versaoMaterialCorrente: QUOTE_MATERIAL_SCHEMA_VERSION,
      totais: {
        envelopes: envelopes.length,
        comTermos: envelopes.filter(e => e.noBanco.termosGravados).length,
        casamNoBanco: envelopes.filter(e => e.noBanco.versaoMaterialQueCasa !== null).length,
        snapshotCasaNoBanco: envelopes.filter(e => e.noBanco.snapshotCasa).length,
        perVehicleReais: envelopes.filter(e => e.layoutScope === 'PER_VEHICLE').length,
        sinteticos: sinteticos.length,
      },
      envelopes: [...envelopes, ...sinteticos],
    };
    mkdirSync(join(OUT, '..'), { recursive: true });
    writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
    console.log(`[G11] ${OUT}`);
    console.log(JSON.stringify(doc.totais));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
