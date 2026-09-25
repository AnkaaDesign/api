/**
 * A ARTE DO ORÇAMENTO É A ARTE APROVADA DOS IMPLEMENTOS (PLANO §2A.9, P12).
 *
 * O orçamento não escolhe mais arte (R1): a arte é do IMPLEMENTO (R2) e o
 * documento de assinatura imprime a arte APROVADA de cada veículo. Este arquivo
 * substitui o `layout-per-vehicle.test.ts` (a seleção de arte por veículo NO
 * orçamento, que saiu) e guarda o que dele continua valendo:
 *
 *   1. PURAS — `quoteArtworkOf` (a única fonte da arte do snapshot, do documento
 *      e da página pública), o portão `artworkGateFailure`, e a prova de que um
 *      orçamento com a MESMA arte em todos os veículos produz o MESMO snapshot, o
 *      mesmo hash material (todas as versões) e o MESMO HTML de antes (hashes
 *      medidos contra a `main` 2bc5eccf, quando a arte morava em
 *      `Budget.layoutFiles`). É a forma pura do G11: quem casava antes casa depois.
 *   2. CONTRA O BANCO — o portão da assinatura nomeando o veículo sem arte, o
 *      snapshot lendo a arte dos implementos, o filtro por papel (a produção só vê
 *      arte APROVADA, risco 25) e a exclusão de aerografia que não leva a arte de
 *      implemento sobre o mesmo arquivo (risco 29).
 *   3. AS MEDIDAS — medir um veículo mede os irmãos do mesmo orçamento, por cópia.
 *
 *   npm run test:quote-artwork
 *
 * ⚠️ Escreve no banco de `DATABASE_URL` e APAGA o que criou no fim (`finally`).
 * Rode com o ambiente da Fase B (`source .git/implemento-env.sh`): com o `.env`
 * de dev, um teste de banco dispara push de verdade.
 */

// O HTML formata datas; o hash de referência foi medido neste fuso.
process.env.TZ = 'America/Sao_Paulo';

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { artworkGateFailure, quoteArtworkOf } from '../src/utils/quote-artwork';
import { describeVehicleList } from '../src/utils/quote-tasks';
import { QuoteSnapshotService } from '../src/modules/common/signature/services/quote-snapshot.service';
import { buildQuoteHtml } from '../src/modules/common/signature/document/quote-html.builder';

let failures = 0;
let passes = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const approved = (...fileIds: string[]) =>
  fileIds.map(fileId => ({ fileId, status: 'APPROVED', file: { id: fileId } }));

// ═══════════════════════════════════════════════════════════════════════════
// 1. PURAS
// ═══════════════════════════════════════════════════════════════════════════

function pureChecks() {
  const t1 = {
    id: 't1',
    implement: { serialNumber: '39088', layouts: approved('A') },
    createdAt: new Date('2026-09-22T17:04:39.924Z'),
  };
  const t2 = {
    id: 't2',
    implement: { serialNumber: '39089', layouts: [] as any[] },
    createdAt: new Date('2026-09-22T17:04:39.996Z'),
  };
  const t3 = {
    id: 't3',
    implement: { serialNumber: null, plate: 'ABC1D23', layouts: [] as any[] },
    createdAt: new Date('2026-09-22T17:05:00Z'),
  };
  const t4 = { id: 't4', implement: null, createdAt: new Date('2026-09-22T17:06:00Z') };

  console.log('\nquoteArtworkOf — a arte do orçamento');
  {
    const a = quoteArtworkOf({
      layoutScope: 'SHARED',
      tasks: [
        { id: 't2', implement: { layouts: approved('B', 'A') } },
        { id: 't1', implement: { layouts: approved('A', 'B') } },
      ],
    });
    check('mesma arte em todos ⇒ sem cobertura', a.coverage === null, JSON.stringify(a.coverage));
    check(
      'fileIds sem repetição e ORDENADOS (a ordem de leitura não muda o hash)',
      JSON.stringify(a.fileIds) === JSON.stringify(['A', 'B']),
      JSON.stringify(a.fileIds),
    );
    check(
      'files na ordem da primeira aparição (a do documento)',
      JSON.stringify(a.files.map((f: any) => f.id)) === JSON.stringify(['B', 'A']),
    );
    check(
      'tasksByFile na ordem das tarefas recebidas',
      JSON.stringify(a.tasksByFile.get('A')) === JSON.stringify(['t2', 't1']),
    );
  }
  {
    const a = quoteArtworkOf({
      layoutScope: 'PER_VEHICLE',
      tasks: [
        { id: 't2', implement: { layouts: approved('A') } },
        { id: 't1', implement: { layouts: approved('A') } },
      ],
    });
    check(
      'PER_VEHICLE congela a cobertura mesmo com a arte igual (honra o layoutScope)',
      JSON.stringify(a.coverage) === JSON.stringify([['A', ['t1', 't2']]]),
      JSON.stringify(a.coverage),
    );
  }
  {
    const a = quoteArtworkOf({
      layoutScope: 'SHARED',
      tasks: [
        { id: 't2', implement: { layouts: approved('B') } },
        { id: 't1', implement: { layouts: approved('A') } },
      ],
    });
    check(
      'arte diferente por veículo ⇒ cobertura, ordenada por arquivo',
      JSON.stringify(a.coverage) ===
        JSON.stringify([
          ['A', ['t1']],
          ['B', ['t2']],
        ]),
      JSON.stringify(a.coverage),
    );
  }
  {
    const a = quoteArtworkOf({
      layoutScope: 'SHARED',
      tasks: [
        { id: 't1', implement: { layouts: approved('A') } },
        { id: 't2', status: 'CANCELLED', implement: { layouts: [] } },
      ],
    });
    check('veículo CANCELADO sem arte não quebra a uniformidade', a.coverage === null);
  }
  {
    const a = quoteArtworkOf({
      layoutScope: 'SHARED',
      tasks: [
        { id: 't1', implement: { layouts: approved('A') } },
        { id: 't2', status: 'CANCELLED', implement: { layouts: approved('B') } },
      ],
    });
    check(
      'veículo CANCELADO com arte continua no documento (o assinado não muda)',
      JSON.stringify(a.fileIds) === JSON.stringify(['A', 'B']) && a.coverage !== null,
      JSON.stringify(a),
    );
  }
  {
    const a = quoteArtworkOf({
      tasks: [
        {
          id: 't1',
          implement: {
            layouts: [
              { fileId: 'R', status: 'DRAFT' },
              { fileId: 'P', status: 'PENDING_APPROVAL' },
              { fileId: 'X', status: 'REPROVED' },
              { fileId: 'S', status: 'SUPERSEDED' },
            ],
          },
        },
      ],
    });
    check('só a arte APROVADA conta', a.fileIds.length === 0 && a.files.length === 0);
  }

  console.log('\nO portão da arte');
  {
    const g = artworkGateFailure({ tasks: [t1, t2] });
    check(
      'falta a arte do 39089 ⇒ "Falta a arte aprovada do veículo 39089."',
      g?.message === 'Falta a arte aprovada do veículo 39089.' &&
        JSON.stringify(g.missingTaskIds) === JSON.stringify(['t2']),
      JSON.stringify(g),
    );
  }
  {
    const g = artworkGateFailure({ tasks: [t4, t3, t2, t1] });
    check(
      'série, senão placa, senão a posição do veículo — na ordem canônica',
      g?.message === 'Falta a arte aprovada dos veículos 39089, ABC1D23, 4.',
      JSON.stringify(g),
    );
  }
  check(
    'todo veículo com arte aprovada passa',
    artworkGateFailure({
      tasks: [t1, { ...t2, implement: { ...t2.implement, layouts: approved('B') } }],
    }) === null,
  );
  check(
    'veículo CANCELADO não precisa de arte',
    artworkGateFailure({ tasks: [t1, { ...t2, status: 'CANCELLED' }] }) === null,
  );
  check(
    'arte só em rascunho não passa',
    artworkGateFailure({
      tasks: [{ ...t1, implement: { layouts: [{ fileId: 'A', status: 'DRAFT' }] } }],
    }) !== null,
  );
  check('orçamento sem veículo não passa', artworkGateFailure({ tasks: [] }) !== null);
  check(
    'lista longa tem teto',
    describeVehicleList(Array.from({ length: 13 }, (_, i) => String(i))).endsWith('e mais 3'),
  );

  console.log('\nArte igual em todos: snapshot, hash material e HTML iguais aos de antes (main 2bc5eccf)');
  const snapshots = new QuoteSnapshotService(null as never);
  const customer = {
    id: 'cust-1',
    corporateName: 'CARLOTTI LTDA',
    fantasyName: 'Carlotti',
    cnpj: '12345678000199',
    cpf: null,
  };
  const responsibles = [
    { id: 'r1', name: 'Fulano', phone: '11999990000', email: 'a@b.c', roles: ['OWNER'] },
  ];
  const fileA = { id: 'file-a', originalName: 'a.png', size: 10 };
  const fileB = { id: 'file-b', originalName: 'b.png', size: 20 };
  const art = (...files: any[]) =>
    files.map(f => ({ fileId: f.id, status: 'APPROVED', file: f }));
  // O mesmo grafo que o teste antigo media, com a arte agora nos implementos
  // (a M3 copiou a arte do orçamento para cada implemento com o MESMO File.id).
  const graph = (layoutScope: string, art1: any[], art2: any[]): any => ({
    id: 'quote-990',
    budgetNumber: 990,
    createdAt: new Date('2026-09-22T17:05:00Z'),
    expiresAt: new Date('2026-10-22T17:05:00Z'),
    subtotal: 5000,
    total: 10000,
    billingSplit: 'JOINT',
    guaranteeYears: 2,
    customGuaranteeText: null,
    customForecastDays: 15,
    simultaneousTasks: 1,
    commercialUserId: null,
    layoutScope,
    services: [{ description: 'Pintura geral', amount: 5000, observation: null, position: 0 }],
    customerConfigs: [
      {
        customerId: 'cust-1',
        discountType: 'NONE',
        discountValue: null,
        discountReference: null,
        paymentCondition: null,
        customPaymentText: null,
        billing: { tasks: [{ taskId: 'task-1' }, { taskId: 'task-2' }] },
      },
    ],
    tasks: [
      {
        id: 'task-2',
        name: 'Carlotti',
        createdAt: t2.createdAt,
        customerOrderNumber: null,
        customer,
        implement: {
          serialNumber: '39089',
          plate: null,
          chassisNumber: null,
          category: null,
          type: null,
          layouts: art2,
        },
        responsibles,
      },
      {
        id: 'task-1',
        name: 'Carlotti',
        createdAt: t1.createdAt,
        customerOrderNumber: null,
        customer,
        implement: {
          serialNumber: '39088',
          plate: 'ABC1D23',
          chassisNumber: null,
          category: null,
          type: null,
          layouts: art1,
        },
        responsibles,
      },
    ],
  });
  const shared = snapshots.build(graph('SHARED', art(fileB, fileA), art(fileB, fileA)));
  // Medidos rodando o `build`/`materialHash` da main 2bc5eccf sobre o grafo de
  // antes (`layoutFiles: [file-b, file-a]`, SHARED).
  const BASELINE = {
    snapshot: 'dfba6dd74c6cc1f430cfcfe8c3859f2f95dfbb51d8bc583d5bf84fe5d95a6e5c',
    material: {
      7: 'e5890cccbe2d0f16ca9c577466f29e206906d227a0669d97457f79d52864c4cb',
      6: '7307ded2955ea42637ad439ce53b3e1baac63b22ce94f68e56f4f59be42273e0',
      5: '64b96cb1ad2be643965f9aa49a76b4a936e3929a3900bc36e439e0c714697556',
      4: '76a9a0e050873585db9283660814b5b2deb35617bb1a99d144cba91d445461ce',
      3: '8b48359ab27f2347ed8ab469ea285ef0e29e95626c50a82a887540c8e15af803',
      2: '7a1aeaf476e2b903044b3386b4851001d7110a51ee4a6fa32010658dc15fb59a',
      1: 'dc7a61c1cd820c40a4c5b0127b421637d3dc0dfa2fe58dfe4d82102e573849c4',
    } as Record<number, string>,
  };
  check('arte igual em todos: o snapshot não tem a chave `layoutCoverage`', !('layoutCoverage' in shared));
  check(
    'hash do snapshot = o de antes',
    snapshots.hash(shared) === BASELINE.snapshot,
    snapshots.hash(shared),
  );
  for (const v of [7, 6, 5, 4, 3, 2, 1]) {
    check(
      `hash material v${v} = o de antes`,
      snapshots.materialHash(shared, v) === BASELINE.material[v],
    );
  }
  check('a projeção continua na versão 7', snapshots.materialProjection(shared).materialVersion === 7);

  const pv = snapshots.build(graph('PER_VEHICLE', art(fileA), art(fileB)));
  check(
    'arte por veículo congela a cobertura, ordenada',
    JSON.stringify(pv.layoutCoverage) ===
      JSON.stringify([
        ['file-a', ['task-1']],
        ['file-b', ['task-2']],
      ]),
    JSON.stringify(pv.layoutCoverage),
  );
  check(
    'de "a mesma para todos" a "cada um com a sua" (mesmas imagens) é MATERIAL — inclusive v6',
    snapshots.materialHash(pv) !== snapshots.materialHash(shared) &&
      snapshots.materialHash(pv, 6) !== snapshots.materialHash(shared, 6),
  );
  const swapped = snapshots.build(graph('PER_VEHICLE', art(fileB), art(fileA)));
  check('trocar a arte de veículo é mudança MATERIAL', snapshots.materialHash(swapped) !== snapshots.materialHash(pv));
  const { diffQuoteSnapshots } = require('../src/modules/common/signature/services/quote-diff');
  const changes = diffQuoteSnapshots(pv, swapped);
  check(
    'e o diff explica a invalidação (`layoutCoverage`, MATERIAL)',
    changes.some((c: any) => c.key === 'layoutCoverage' && c.severity === 'MATERIAL'),
    JSON.stringify(changes.map((c: any) => c.key)),
  );
  const nonUniformShared = snapshots.build(graph('SHARED', art(fileA), art(fileB)));
  check(
    'orçamento SHARED com arte diferente por veículo também congela a cobertura',
    JSON.stringify(nonUniformShared.layoutCoverage) === JSON.stringify(pv.layoutCoverage),
    JSON.stringify(nonUniformShared.layoutCoverage),
  );

  const htmlFixture: any = {
    budgetNumber: 990,
    issuedAt: new Date('2026-09-01T12:00:00Z'),
    expiresAt: new Date('2026-10-01T12:00:00Z'),
    corporateName: 'CARLOTTI',
    customerDocumentFormatted: '12.345.678/0001-99',
    contactName: 'Fulano',
    vehicles: [
      {
        taskId: 'task-1',
        serialNumber: '39088',
        plate: null,
        chassisNumber: null,
        orderNumber: null,
        categoryLabel: null,
        implementLabel: null,
      },
    ],
    services: [{ description: 'Pintura', amount: 5000, observation: null }],
    subtotal: 5000,
    total: 5000,
    discountLabel: null,
    discountPercent: null,
    discountReference: null,
    discountAmount: null,
    deliveryDays: 20,
    simultaneousTasks: 1,
    paymentText: 'À vista.',
    guaranteeText: '2 anos.',
    layoutImages: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'],
    logoDataUri: null,
    fontDataUri: null,
    signers: [{ id: 's1', name: 'Fulano', subtitle: 'Carlotti', side: 'CUSTOMER' }],
    acceptanceClause: 'ACEITE.',
    verificationCode: 'X',
    verificationUrl: 'u',
  };
  const HTML_BASELINE: Record<string, string> = {
    'content/false': 'c05cd5ffde6faa6fa2d393ff23bb2f87aad96ff9f7c2978667e8eaa04e44bd2b',
    'content/true': '2f1ea7618eec9770dbaa6ff03318fe6f00abd07c7d520814f66db1e448314d9b',
    'signatures/false': 'b36e2bb89d9bfdb4788d3087fbae251262f15103e8049617612dab410ceb7810',
    'signatures/true': 'dd3d3eab542410268d45a74a9f04aee6c12bf274ea0af1eeaf790931e06d55ff',
    'fused/false': '9a4dab854eb519a35b721181e25ab465e31482064f5589c6299da17a4ebc7b51',
    'fused/true': '9a4dab854eb519a35b721181e25ab465e31482064f5589c6299da17a4ebc7b51',
  };
  for (const part of ['content', 'signatures', 'fused'] as const) {
    for (const inContent of [false, true]) {
      const html = buildQuoteHtml({ ...htmlFixture, layoutInContent: inContent }, part);
      const h = createHash('sha256').update(html).digest('hex');
      check(
        `HTML sem legenda byte a byte igual (${part}, arte no corpo=${inContent})`,
        h === HTML_BASELINE[`${part}/${inContent}`],
        h,
      );
    }
  }
  {
    const html = buildQuoteHtml(
      { ...htmlFixture, layoutCaptions: ['Veículo 39088', 'Veículo 39089'] },
      'fused',
    );
    const iGrid = html.indexOf('<div class="layout-grid">');
    const i1 = html.indexOf('>Veículo 39088</div>', iGrid);
    const iA = html.indexOf('AAAA', iGrid);
    const i2 = html.indexOf('>Veículo 39089</div>', iGrid);
    const iB = html.indexOf('BBBB', iGrid);
    const iClose = html.indexOf('</section>', iGrid);
    check(
      'por veículo: legenda acima de cada imagem, DENTRO da .layout-grid',
      iGrid > 0 && iGrid < i1 && i1 < iA && iA < i2 && i2 < iB && iB < iClose,
      JSON.stringify({ iGrid, i1, iA, i2, iB, iClose }),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 e 3. CONTRA O BANCO
// ═══════════════════════════════════════════════════════════════════════════

const SUFFIX = Date.now().toString().slice(-6);
const NAME_PREFIX = `zz-arte-orcamento-${SUFFIX}`;

async function dbChecks() {
  // Carregados aqui, e não no topo: as checagens puras rodam sem banco nem Nest.
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../src/app.module');
  const { PrismaService } = require('../src/modules/common/prisma/prisma.service');
  const { BudgetService } = require('../src/modules/production/budget/budget.service');
  const { TaskService } = require('../src/modules/production/task/task.service');
  const { AirbrushingService } = require('../src/modules/production/airbrushing/airbrushing.service');
  const {
    ImplementMeasureService,
  } = require('../src/modules/production/implement-measure/implement-measure.service');
  const {
    SignatureEnvelopeService,
  } = require('../src/modules/common/signature/services/signature-envelope.service');
  const {
    QuoteSnapshotService: SnapshotSvc,
  } = require('../src/modules/common/signature/services/quote-snapshot.service');
  const { budgetCreateSchema } = require('../src/schemas/budget');
  const { taskUpdateSchema } = require('../src/schemas/task');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const parse = (schema: any, body: unknown) => {
    const r = schema.safeParse(body);
    if (!r.success) throw new Error(`zod recusou: ${JSON.stringify(r.error.issues)}`);
    return r.data;
  };

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const budgets = app.get(BudgetService);
  const tasks = app.get(TaskService);
  const airbrushings = app.get(AirbrushingService);
  const measures = app.get(ImplementMeasureService);
  const envelopes = app.get(SignatureEnvelopeService);
  const snapshotSvc = app.get(SnapshotSvc);

  const createdTaskIds: string[] = [];
  const createdQuoteIds: string[] = [];

  try {
    const customer = await prisma.customer.findFirst({ select: { id: true } });
    const user = await prisma.user.findFirst({
      where: { sector: { privileges: 'ADMIN' } },
      select: { id: true },
    });
    if (!customer || !user) {
      check('banco com cliente e usuário ADMIN', false);
      return;
    }

    // ── Os dois caminhões ─────────────────────────────────────────────────
    const t1 = await prisma.task.create({
      data: {
        name: NAME_PREFIX,
        customerId: customer.id,
        implement: { create: { serialNumber: `A${SUFFIX}1`, spot: null } },
      },
    });
    const t2 = await prisma.task.create({
      data: {
        name: NAME_PREFIX,
        customerId: customer.id,
        implement: { create: { serialNumber: `A${SUFFIX}2`, spot: null } },
      },
    });
    createdTaskIds.push(t1.id, t2.id);
    const implement1 = await prisma.implement.findUniqueOrThrow({ where: { taskId: t1.id } });
    const implement2 = await prisma.implement.findUniqueOrThrow({ where: { taskId: t2.id } });

    const dir = resolve(process.env.LAYOUT_TEST_DIR || join(tmpdir(), `arte-orcamento-${SUFFIX}`));
    mkdirSync(dir, { recursive: true });
    const mkFile = async (tag: string, bytes: number) => {
      const path = join(dir, `${tag}.png`);
      writeFileSync(path, Buffer.alloc(bytes, tag.charCodeAt(0)));
      return prisma.file.create({
        data: {
          filename: `${tag}.png`,
          originalName: `${NAME_PREFIX}-${tag}.png`,
          mimetype: 'image/png',
          path,
          size: bytes,
        },
      });
    };
    const fA = await mkFile('A', 101);
    const fB = await mkFile('B', 202);
    const fC = await mkFile('C', 303);

    const created = await budgets.create(
      parse(budgetCreateSchema, {
        taskIds: [t1.id, t2.id],
        expiresAt: new Date(Date.now() + 30 * 86400000),
        subtotal: 100,
        total: 200,
        status: 'PENDING',
        services: [{ description: 'Pintura geral', amount: 100 }],
        customerConfigs: [
          {
            customerId: customer.id,
            subtotal: 100,
            total: 200,
            discountType: 'NONE',
            generateInvoice: true,
            generateBankSlip: true,
            paymentConfig: { type: 'CASH', method: 'BANK_SLIP', cashDays: 5 },
          },
        ],
      }),
      user.id,
    );
    const quoteId: string = created.data.id;
    createdQuoteIds.push(quoteId);

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nO portão da assinatura: todo veículo tem a sua arte aprovada');
    // ═════════════════════════════════════════════════════════════════════
    const artBlocker = async () =>
      ((await envelopes.getDeliveryPreflight(quoteId)).blockers as string[]).find(b =>
        b.startsWith('Falta a arte aprovada'),
      ) ?? null;
    let blocker = await artBlocker();
    check(
      'sem arte nenhuma: a prévia nomeia os dois veículos',
      blocker?.startsWith(`Falta a arte aprovada dos veículos A${SUFFIX}1, A${SUFFIX}2.`) === true,
      blocker ?? 'sem bloqueio',
    );
    await prisma.layout.create({
      data: { fileId: fA.id, implementId: implement1.id, status: 'APPROVED' },
    });
    await prisma.layout.create({
      data: { fileId: fC.id, implementId: implement2.id, status: 'DRAFT' },
    });
    blocker = await artBlocker();
    check(
      'com a arte do primeiro aprovada (e a do segundo em rascunho): nomeia só o segundo',
      blocker?.startsWith(`Falta a arte aprovada do veículo A${SUFFIX}2.`) === true,
      blocker ?? 'sem bloqueio',
    );
    await prisma.layout.create({
      data: { fileId: fB.id, implementId: implement2.id, status: 'APPROVED' },
    });
    blocker = await artBlocker();
    check('com as duas aprovadas: nenhum bloqueio de arte', blocker === null, blocker ?? '');

    const graph = await snapshotSvc.loadQuoteGraph(quoteId);
    const snap = snapshotSvc.build(graph);
    check(
      'o snapshot lê a arte APROVADA dos implementos (sem o rascunho)',
      JSON.stringify(snap.layoutFileIds) === JSON.stringify([fA.id, fB.id].sort()),
      JSON.stringify(snap.layoutFileIds),
    );
    check(
      'e, com arte diferente por veículo, congela a cobertura',
      JSON.stringify(snap.layoutCoverage) ===
        JSON.stringify(
          [
            [fA.id, [t1.id]],
            [fB.id, [t2.id]],
          ].sort((a: any, b: any) => a[0].localeCompare(b[0])),
        ),
      JSON.stringify(snap.layoutCoverage),
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nO filtro por papel: a produção só vê arte APROVADA (risco 25)');
    // ═════════════════════════════════════════════════════════════════════
    const include = { implement: { include: { layouts: true } } };
    const asProduction = await tasks.findById(t2.id, include, 'PRODUCTION');
    const asDesigner = await tasks.findById(t2.id, include, 'DESIGNER');
    const statuses = (r: any) =>
      (r.data?.implement?.layouts ?? []).map((l: any) => l.status).sort().join(',');
    check('PRODUCTION: só APPROVED', statuses(asProduction) === 'APPROVED', statuses(asProduction));
    check('DESIGNER: todas', statuses(asDesigner) === 'APPROVED,DRAFT', statuses(asDesigner));
    const listed = await tasks.findMany(
      { where: { id: { in: [t2.id] } }, include } as any,
      'PRODUCTION',
    );
    check(
      'a lista aplica o mesmo filtro',
      (listed.data ?? []).every((t: any) =>
        (t.implement?.layouts ?? []).every((l: any) => l.status === 'APPROVED'),
      ),
      JSON.stringify(listed.data?.map((t: any) => t.implement?.layouts)),
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nExcluir uma aerografia não leva a arte do implemento (risco 29)');
    // ═════════════════════════════════════════════════════════════════════
    const aero = await prisma.airbrushing.create({
      data: {
        taskId: t1.id,
        layouts: { create: [{ fileId: fA.id, status: 'APPROVED' }] },
      },
    });
    await airbrushings.delete(aero.id, user.id);
    const stillThere = await prisma.layout.count({
      where: { fileId: fA.id, implementId: implement1.id },
    });
    const fileStill = await prisma.file.count({ where: { id: fA.id } });
    check(
      'a arte do implemento sobre o MESMO arquivo continua, e o arquivo também',
      stillThere === 1 && fileStill === 1,
      JSON.stringify({ stillThere, fileStill }),
    );
    check(
      'a linha da aerografia saiu',
      (await prisma.layout.count({ where: { airbrushingId: aero.id } })) === 0,
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nMedir um veículo mede o outro (mesmo orçamento)');
    // ═════════════════════════════════════════════════════════════════════
    const medida = {
      height: 2.6,
      sections: [
        { width: 4.2, isDoor: false, doorHeight: null, position: 0 },
        { width: 1.1, isDoor: true, doorHeight: 2.1, position: 1 },
      ],
    };
    await measures.createOrUpdateImplementMeasure(implement1.id, 'left', medida as any, user.id);
    const leftOf = (implementId: string) =>
      prisma.implement.findUnique({
        where: { id: implementId },
        select: {
          leftSideMeasure: {
            select: {
              id: true,
              height: true,
              sections: {
                orderBy: { position: 'asc' },
                select: { width: true, isDoor: true, doorHeight: true },
              },
            },
          },
          rightSideMeasure: { select: { id: true, height: true } },
        },
      });
    let m1 = await leftOf(implement1.id);
    let m2 = await leftOf(implement2.id);
    check(
      'o irmão recebeu a MESMA medida (altura e seções)',
      !!m2?.leftSideMeasure &&
        m2.leftSideMeasure.height === 2.6 &&
        JSON.stringify(m2.leftSideMeasure.sections) === JSON.stringify(m1.leftSideMeasure.sections),
      JSON.stringify(m2),
    );
    check(
      'por CÓPIA — outra linha, não a compartilhada',
      m2?.leftSideMeasure?.id !== m1?.leftSideMeasure?.id,
    );
    const log = await prisma.changeLog.findFirst({
      where: { entityId: t2.id, field: 'implementMeasures' },
      orderBy: { createdAt: 'desc' },
      select: { reason: true },
    });
    check(
      'trilha no irmão: "Medidas replicadas do veículo …"',
      log?.reason === `Medidas replicadas do veículo A${SUFFIX}1 (mesmo orçamento)`,
      log?.reason,
    );
    const idAntes = m2.leftSideMeasure.id;
    await measures.createOrUpdateImplementMeasure(implement1.id, 'left', medida as any, user.id);
    m2 = await leftOf(implement2.id);
    check(
      'regravar a mesma medida não reescreve o irmão (só o lado que DIFERE)',
      m2.leftSideMeasure.id === idAntes,
    );

    await tasks.update(
      t2.id,
      parse(taskUpdateSchema, {
        implement: {
          rightSideMeasure: {
            height: 2.4,
            sections: [{ width: 5.3, isDoor: false, doorHeight: null, position: 0 }],
          },
        },
      }),
      undefined,
      user.id,
      'ADMIN',
    );
    m1 = await leftOf(implement1.id);
    check(
      'pela edição da TAREFA também (lado direito do 2º → 1º)',
      m1?.rightSideMeasure?.height === 2.4,
      JSON.stringify(m1),
    );

    await tasks.update(
      t1.id,
      parse(taskUpdateSchema, { implement: { leftSideMeasure: null } }),
      undefined,
      user.id,
      'ADMIN',
    );
    m1 = await leftOf(implement1.id);
    m2 = await leftOf(implement2.id);
    check('exclusão NÃO replica', !m1.leftSideMeasure && !!m2.leftSideMeasure, JSON.stringify({ m1, m2 }));
  } finally {
    try {
      const measureIds = (
        await prisma.implement.findMany({
          where: { taskId: { in: createdTaskIds } },
          select: {
            leftSideMeasureId: true,
            rightSideMeasureId: true,
            backSideMeasureId: true,
            frontSideMeasureId: true,
          },
        })
      )
        .flatMap((t: any) => [
          t.leftSideMeasureId,
          t.rightSideMeasureId,
          t.backSideMeasureId,
          t.frontSideMeasureId,
        ])
        .filter(Boolean);
      if (createdQuoteIds.length) {
        await prisma.task.updateMany({
          where: { id: { in: createdTaskIds } },
          data: { quoteId: null },
        });
        await prisma.budget.deleteMany({ where: { id: { in: createdQuoteIds } } });
      }
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      if (measureIds.length) {
        await prisma.implementMeasure.deleteMany({ where: { id: { in: measureIds } } });
      }
      // O banco recusa apagar arquivo referenciado (trigger) — a válvula é
      // deliberada, dentro da transação, e as linhas `Layout` saem antes.
      await prisma.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_referenced_file_delete = 'on'`);
        await tx.layout.deleteMany({
          where: { file: { originalName: { startsWith: NAME_PREFIX } } },
        });
        await tx.file.deleteMany({ where: { originalName: { startsWith: NAME_PREFIX } } });
      });
      await prisma.changeLog.deleteMany({
        where: { entityId: { in: [...createdTaskIds, ...createdQuoteIds] } },
      });
    } catch (e) {
      console.log(
        `  ⚠️  limpeza falhou (${(e as Error)?.message}); sobraram tarefas ${createdTaskIds.join(', ')}`,
      );
    }
    await app.close().catch(() => {});
  }
}

async function main() {
  pureChecks();
  if (process.env.QUOTE_ARTWORK_PURE_ONLY === '1') return;
  await dbChecks();
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? `\n✅ A arte do orçamento: ${passes} verificações passaram.\n`
        : `\n❌ ${failures} verificação(ões) falharam (${passes} passaram).\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ O teste estourou:', err?.stack ?? err);
    process.exit(1);
  });
