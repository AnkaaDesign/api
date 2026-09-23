/**
 * O LAYOUT APROVADO POR VEÍCULO — e o tamanho que é do orçamento.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Orçamento nº 990 (Carlotti, 22/09/2026): dois caminhões, 39088 e 39089, com o
 * mesmo preço e pinturas diferentes. O layout aprovado era UM para o orçamento:
 * escolher a arte A pela 39088 e depois a B pela 39089 REPROVAVA a A na galeria
 * da 39088; escolher as duas deixava as duas aprovadas nos dois caminhões; três
 * veículos com três artes não cabiam no limite de duas. E os portões só
 * perguntavam "o orçamento tem algum layout?".
 *
 * Três partes:
 *   1. PURAS — normalização do pedido `layouts`, mensagens dos portões, e a
 *      prova de que um orçamento `SHARED` produz o MESMO snapshot, o mesmo hash
 *      material (todas as versões) e o MESMO HTML de antes (hashes medidos
 *      contra o código da `main` 2bc5eccf, antes desta feature).
 *   2. CONTRA O BANCO, pelos serviços que as telas chamam — gravação, galeria
 *      por veículo, o defeito da Carlotti, portas legadas, portões, veículo que
 *      sai do orçamento.
 *   3. AS MEDIDAS — medir um veículo mede os irmãos, por cópia.
 *
 *   pnpm test:layout-per-vehicle
 *
 * ⚠️ Escreve no banco de `DATABASE_URL` e APAGA o que criou no fim (`finally`).
 * Os arquivos de imagem nascem numa pasta temporária; aponte `FILES_ROOT` para
 * uma pasta gravável (o clone de layout copia bytes de verdade). Roda sob
 * `ts-node` pelo mesmo motivo de `tests/multitask-quote-e2e.test.ts`.
 */

// O HTML formata datas; o hash de referência foi medido neste fuso.
process.env.TZ = 'America/Sao_Paulo';

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  describeVehicleList,
  layoutGateFailure,
  planLayoutCoverage,
} from '../src/utils/quote-layout-coverage';
import { QuoteSnapshotService } from '../src/modules/common/signature/services/quote-snapshot.service';
import { buildQuoteHtml } from '../src/modules/common/signature/document/quote-html.builder';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function throwsWith(fn: () => unknown, fragment: string): boolean {
  try {
    fn();
    return false;
  } catch (e: any) {
    return String(e?.message ?? e).includes(fragment);
  }
}

async function rejectsWith(p: Promise<unknown>, fragment: string): Promise<string | null> {
  try {
    await p;
    return 'não recusou';
  } catch (e: any) {
    const msg = String(e?.response?.message ?? e?.message ?? e);
    return msg.includes(fragment) ? null : msg;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PURAS
// ═══════════════════════════════════════════════════════════════════════════

function pureChecks() {
  const t1 = { id: 't1', serialNumber: '39088', createdAt: new Date('2026-09-22T17:04:39.924Z') };
  const t2 = { id: 't2', serialNumber: '39089', createdAt: new Date('2026-09-22T17:04:39.996Z') };
  const t3 = {
    id: 't3',
    serialNumber: null,
    truck: { plate: 'ABC1D23' },
    createdAt: new Date('2026-09-22T17:05:00Z'),
  };
  const t4 = {
    id: 't4',
    serialNumber: null,
    truck: null,
    createdAt: new Date('2026-09-22T17:06:00Z'),
  };

  console.log('\nNormalização do pedido `layouts`');
  {
    const p = planLayoutCoverage([{ fileId: 'A' }, { fileId: 'B', taskIds: null }], [t1, t2]);
    check(
      'todas as artes para todos ⇒ SHARED, sem linhas',
      p.scope === 'SHARED' && p.files.every(f => f.taskIds.length === 0),
      JSON.stringify(p),
    );
  }
  {
    const p = planLayoutCoverage([{ fileId: 'A', taskIds: ['t2', 't1'] }], [t1, t2]);
    check(
      'cobertura explícita de TODOS também normaliza para SHARED',
      p.scope === 'SHARED',
      JSON.stringify(p),
    );
  }
  {
    const p = planLayoutCoverage(
      [
        { fileId: 'A', taskIds: ['t1'] },
        { fileId: 'B', taskIds: ['t2'] },
      ],
      [t2, t1],
    );
    check(
      'A só na 39088, B só na 39089 ⇒ PER_VEHICLE com as linhas explícitas',
      p.scope === 'PER_VEHICLE' &&
        JSON.stringify(p.files) ===
          JSON.stringify([
            { fileId: 'A', taskIds: ['t1'] },
            { fileId: 'B', taskIds: ['t2'] },
          ]),
      JSON.stringify(p),
    );
  }
  {
    const p = planLayoutCoverage(
      [
        { fileId: 'A', taskIds: null },
        { fileId: 'B', taskIds: ['t2'] },
      ],
      [t1, t2],
    );
    check(
      'arte "para todos" num PER_VEHICLE ganha uma linha por veículo ATUAL',
      p.scope === 'PER_VEHICLE' &&
        JSON.stringify(p.files[0]) === JSON.stringify({ fileId: 'A', taskIds: ['t1', 't2'] }),
      JSON.stringify(p),
    );
  }
  {
    const p = planLayoutCoverage(
      [
        { fileId: 'A', taskIds: ['t1'] },
        { fileId: 'A', taskIds: ['t2'] },
      ],
      [t1, t2, t3],
    );
    check(
      '`fileId` repetido junta as coberturas',
      p.files.length === 1 && p.files[0].taskIds.join() === 't1,t2',
      JSON.stringify(p),
    );
  }
  {
    const p = planLayoutCoverage(
      [
        { fileId: 'A', taskIds: [] },
        { fileId: 'B', taskIds: ['t1'] },
      ],
      [t1, t2],
    );
    check(
      'arte com cobertura vazia não cobre ninguém e sai',
      p.files.map(f => f.fileId).join() === 'B',
      JSON.stringify(p),
    );
  }
  check(
    '`[]` limpa e volta a SHARED',
    planLayoutCoverage([], [t1, t2]).scope === 'SHARED' &&
      planLayoutCoverage([], [t1]).files.length === 0,
  );
  check(
    'veículo que não é do orçamento ⇒ recusa clara',
    throwsWith(
      () => planLayoutCoverage([{ fileId: 'A', taskIds: ['tX'] }], [t1, t2]),
      'não pertence a este orçamento',
    ),
  );
  check(
    'veículo SAINDO na mesma gravação é descartado, não recusado',
    planLayoutCoverage(
      [
        { fileId: 'A', taskIds: ['t1', 'tX'] },
        { fileId: 'B', taskIds: ['t2'] },
      ],
      [t1, t2],
      {
        leavingTaskIds: ['tX'],
      },
    ).files[0].taskIds.join() === 't1',
  );
  check(
    'SHARED continua com no máximo 2 artes',
    throwsWith(
      () => planLayoutCoverage([{ fileId: 'A' }, { fileId: 'B' }, { fileId: 'C' }], [t1, t2]),
      'No máximo 2',
    ),
  );
  check(
    'PER_VEHICLE: no máximo 2 por veículo, e a recusa nomeia o veículo',
    throwsWith(
      () =>
        planLayoutCoverage(
          [
            { fileId: 'A', taskIds: ['t1'] },
            { fileId: 'B', taskIds: ['t1'] },
            { fileId: 'C', taskIds: ['t1'] },
          ],
          [t1, t2],
        ),
      '39088',
    ),
  );
  {
    const many = Array.from({ length: 21 }, (_, i) => ({
      id: `v${i}`,
      serialNumber: `S${i}`,
      createdAt: new Date(1000 + i),
    }));
    check(
      'PER_VEHICLE: no máximo 20 artes distintas',
      throwsWith(
        () =>
          planLayoutCoverage(
            many.map((t, i) => ({ fileId: `F${i}`, taskIds: [t.id] })),
            many,
          ),
        'No máximo 20',
      ),
    );
    const ok = planLayoutCoverage(
      many.slice(0, 20).map((t, i) => ({ fileId: `F${i}`, taskIds: [t.id] })),
      many,
    );
    check(
      'três (ou vinte) veículos com artes distintas cabem',
      ok.scope === 'PER_VEHICLE' && ok.files.length === 20,
    );
  }

  console.log('\nMensagens dos portões');
  const perVehicle = (files: any[], tasks: any[]) => ({
    layoutScope: 'PER_VEHICLE',
    layoutFiles: files,
    tasks,
  });
  {
    const g = layoutGateFailure(
      perVehicle([{ id: 'A', quoteLayoutTasks: [{ taskId: 't1' }] }], [t1, t2]),
    );
    check(
      'PER_VEHICLE sem a arte do 39089 ⇒ "Falta o layout aprovado do veículo 39089."',
      g?.scope === 'PER_VEHICLE' && g.message === 'Falta o layout aprovado do veículo 39089.',
      JSON.stringify(g),
    );
  }
  {
    const g = layoutGateFailure(
      perVehicle([{ id: 'A', quoteLayoutTasks: [{ taskId: 't1' }] }], [t1, t2, t3, t4]),
    );
    check(
      'série, senão placa, senão a posição do veículo',
      g?.scope === 'PER_VEHICLE' &&
        g.message === 'Falta o layout aprovado dos veículos 39089, ABC1D23, 4.',
      JSON.stringify(g),
    );
  }
  check(
    'PER_VEHICLE com todo veículo coberto passa',
    layoutGateFailure(
      perVehicle(
        [
          { id: 'A', quoteLayoutTasks: [{ taskId: 't1' }] },
          { id: 'B', quoteLayoutTasks: [{ taskId: 't2' }] },
        ],
        [t1, t2],
      ),
    ) === null,
  );
  check(
    'linha de veículo que NÃO é do orçamento não conta como cobertura',
    layoutGateFailure(
      perVehicle(
        [{ id: 'A', quoteLayoutTasks: [{ taskId: 't1' }, { taskId: 'tFora' }] }],
        [t1, t2],
      ),
    )?.scope === 'PER_VEHICLE',
  );
  check(
    'SHARED: a pergunta de sempre — alguma arte',
    layoutGateFailure({ layoutScope: 'SHARED', layoutFiles: [], tasks: [t1, t2] })?.scope ===
      'SHARED' &&
      layoutGateFailure({ layoutScope: 'SHARED', layoutFiles: [{ id: 'A' }], tasks: [t1, t2] }) ===
        null,
  );
  check(
    'lista longa tem teto',
    describeVehicleList(Array.from({ length: 13 }, (_, i) => String(i))).endsWith('e mais 3'),
  );

  console.log('\nSHARED: snapshot, hash material e HTML iguais aos de antes (main 2bc5eccf)');
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
  const graph = (layoutScope: string, files: any[]): any => ({
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
    layoutFiles: files,
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
        serialNumber: '39089',
        createdAt: t2.createdAt,
        customerOrderNumber: null,
        customer,
        truck: { plate: null, chassisNumber: null, category: null, implementType: null },
        responsibles,
      },
      {
        id: 'task-1',
        name: 'Carlotti',
        serialNumber: '39088',
        createdAt: t1.createdAt,
        customerOrderNumber: null,
        customer,
        truck: { plate: 'ABC1D23', chassisNumber: null, category: null, implementType: null },
        responsibles,
      },
    ],
  });
  const sharedFiles = [
    { id: 'file-b', originalName: 'b.png', size: 20, quoteLayoutTasks: [] },
    { id: 'file-a', originalName: 'a.png', size: 10, quoteLayoutTasks: [] },
  ];
  const shared = snapshots.build(graph('SHARED', sharedFiles));
  // Medidos rodando o `build`/`materialHash` da main 2bc5eccf sobre este mesmo grafo.
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
  check('o snapshot SHARED não tem a chave `layoutCoverage`', !('layoutCoverage' in shared));
  check(
    'hash do snapshot SHARED = o de antes',
    snapshots.hash(shared) === BASELINE.snapshot,
    snapshots.hash(shared),
  );
  for (const v of [7, 6, 5, 4, 3, 2, 1]) {
    check(
      `hash material v${v} SHARED = o de antes`,
      snapshots.materialHash(shared, v) === BASELINE.material[v],
    );
  }
  check(
    'a projeção SHARED continua na versão 7',
    snapshots.materialProjection(shared).materialVersion === 7,
  );

  const perVehicleFiles = [
    { id: 'file-b', originalName: 'b.png', size: 20, quoteLayoutTasks: [{ taskId: 'task-2' }] },
    { id: 'file-a', originalName: 'a.png', size: 10, quoteLayoutTasks: [{ taskId: 'task-1' }] },
  ];
  const pv = snapshots.build(graph('PER_VEHICLE', perVehicleFiles));
  check(
    'PER_VEHICLE congela a cobertura, ordenada',
    JSON.stringify(pv.layoutCoverage) ===
      JSON.stringify([
        ['file-a', ['task-1']],
        ['file-b', ['task-2']],
      ]),
    JSON.stringify(pv.layoutCoverage),
  );
  check(
    'passar de SHARED a PER_VEHICLE (mesmas imagens) é mudança MATERIAL — inclusive para envelope v6',
    snapshots.materialHash(pv) !== snapshots.materialHash(shared) &&
      snapshots.materialHash(pv, 6) !== snapshots.materialHash(shared, 6),
  );
  const swapped = snapshots.build(
    graph('PER_VEHICLE', [
      { id: 'file-b', originalName: 'b.png', size: 20, quoteLayoutTasks: [{ taskId: 'task-1' }] },
      { id: 'file-a', originalName: 'a.png', size: 10, quoteLayoutTasks: [{ taskId: 'task-2' }] },
    ]),
  );
  check(
    'trocar a arte de veículo é mudança MATERIAL',
    snapshots.materialHash(swapped) !== snapshots.materialHash(pv),
  );
  const { diffQuoteSnapshots } = require('../src/modules/common/signature/services/quote-diff');
  const changes = diffQuoteSnapshots(pv, swapped);
  check(
    'e o diff explica a invalidação ("Layout aprovado por veículo", MATERIAL)',
    changes.some((c: any) => c.key === 'layoutCoverage' && c.severity === 'MATERIAL'),
    JSON.stringify(changes.map((c: any) => c.key)),
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
        `HTML SHARED byte a byte igual (${part}, arte no corpo=${inContent})`,
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
      'PER_VEHICLE: legenda acima de cada imagem, DENTRO da .layout-grid',
      iGrid > 0 && iGrid < i1 && i1 < iA && iA < i2 && i2 < iB && iB < iClose,
      JSON.stringify({ iGrid, i1, iA, i2, iB, iClose }),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 e 3. CONTRA O BANCO
// ═══════════════════════════════════════════════════════════════════════════

const SUFFIX = Date.now().toString().slice(-6);
const NAME_PREFIX = `zz-layout-veiculo-${SUFFIX}`;

async function dbChecks() {
  // Carregados aqui, e não no topo: as checagens puras rodam sem banco nem Nest.
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../src/app.module');
  const { PrismaService } = require('../src/modules/common/prisma/prisma.service');
  const { BudgetService } = require('../src/modules/production/budget/budget.service');
  const { TaskService } = require('../src/modules/production/task/task.service');
  const {
    ImplementMeasureService,
  } = require('../src/modules/production/implement-measure/implement-measure.service');
  const {
    SignatureEnvelopeService,
  } = require('../src/modules/common/signature/services/signature-envelope.service');
  const {
    QuoteSnapshotService: SnapshotSvc,
  } = require('../src/modules/common/signature/services/quote-snapshot.service');
  const { budgetCreateSchema, budgetUpdateSchema } = require('../src/schemas/budget');
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

    // ── Os dois caminhões da Carlotti ─────────────────────────────────────
    const t1 = await prisma.task.create({
      data: { name: NAME_PREFIX, serialNumber: `L${SUFFIX}1`, customerId: customer.id },
    });
    const t2 = await prisma.task.create({
      data: { name: NAME_PREFIX, serialNumber: `L${SUFFIX}2`, customerId: customer.id },
    });
    createdTaskIds.push(t1.id, t2.id);

    // Três artes de verdade (o clone de layout copia bytes).
    const dir = resolve(process.env.LAYOUT_TEST_DIR || join(tmpdir(), `layout-veiculo-${SUFFIX}`));
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
    // A galeria: a arte A numa linha `Layout` ligada aos DOIS caminhões (é o que
    // o SHARED de antes deixava), B só na 39089 e aprovada, C só na 39089 e rascunho.
    const lA = await prisma.layout.create({ data: { fileId: fA.id, status: 'APPROVED' } });
    const lB = await prisma.layout.create({ data: { fileId: fB.id, status: 'APPROVED' } });
    const lC = await prisma.layout.create({ data: { fileId: fC.id, status: 'DRAFT' } });
    await prisma.task.update({
      where: { id: t1.id },
      data: { layouts: { connect: [{ id: lA.id }] } },
    });
    await prisma.task.update({
      where: { id: t2.id },
      data: { layouts: { connect: [{ id: lA.id }, { id: lB.id }, { id: lC.id }] } },
    });
    const statusOf = async (layoutId: string) =>
      (await prisma.layout.findUnique({ where: { id: layoutId }, select: { status: true } }))
        ?.status;
    const rowsOf = async (quoteId: string) =>
      (
        await prisma.budgetLayoutTask.findMany({
          where: { file: { quoteLayoutId: quoteId } },
          select: { fileId: true, taskId: true },
        })
      ).map((r: any) => `${r.fileId}>${r.taskId}`);
    const quoteOf = (id: string) =>
      prisma.budget.findUnique({
        where: { id },
        select: {
          layoutScope: true,
          layoutFiles: {
            select: {
              id: true,
              originalName: true,
              quoteLayoutTasks: { select: { taskId: true } },
            },
          },
        },
      });
    const ownFileByTag = (q: any, tag: string) =>
      q.layoutFiles.find((f: any) => f.originalName === `${NAME_PREFIX}-${tag}.png`);

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nSHARED pela porta legada — o comportamento de hoje');
    // ═════════════════════════════════════════════════════════════════════
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
        layoutFileIds: [fA.id],
      }),
      user.id,
    );
    const quoteId: string = created.data.id;
    createdQuoteIds.push(quoteId);
    let q: any = await quoteOf(quoteId);
    check(
      'nasce SHARED, sem linha de cobertura',
      q.layoutScope === 'SHARED' && (await rowsOf(quoteId)).length === 0,
    );
    check('a arte A (clone do orçamento) está em layoutFiles', !!ownFileByTag(q, 'A'));
    check(
      'SHARED reprova o que não é a seleção em TODAS as galerias (o de hoje): B vira REPROVED',
      (await statusOf(lB.id)) === 'REPROVED' && (await statusOf(lA.id)) === 'APPROVED',
    );
    const cloneA = ownFileByTag(q, 'A').id as string;

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nPER_VEHICLE: A só na 39088, B só na 39089');
    // ═════════════════════════════════════════════════════════════════════
    let r = await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, {
        layouts: [
          { fileId: cloneA, taskIds: [t1.id] },
          { fileId: fB.id, taskIds: [t2.id] }, // da GALERIA: vira clone do orçamento
        ],
      }),
      user.id,
      false,
      'ADMIN',
    );
    q = await quoteOf(quoteId);
    const cloneB = ownFileByTag(q, 'B')?.id as string;
    check('grava PER_VEHICLE', q.layoutScope === 'PER_VEHICLE', q.layoutScope);
    check(
      'a cobertura da arte da galeria caiu no CLONE do orçamento',
      !!cloneB && cloneB !== fB.id,
    );
    check(
      'linhas exatamente: A→39088, B→39089',
      JSON.stringify((await rowsOf(quoteId)).sort()) ===
        JSON.stringify([`${cloneA}>${t1.id}`, `${cloneB}>${t2.id}`].sort()),
      JSON.stringify(await rowsOf(quoteId)),
    );
    check(
      'a resposta traz `layoutScope` e `layoutFiles[].quoteLayoutTasks`',
      r.data?.layoutScope === 'PER_VEHICLE' &&
        Array.isArray(r.data?.layoutFiles?.[0]?.quoteLayoutTasks),
    );
    check(
      'B volta a APPROVED na galeria da 39089 (seleção dela)',
      (await statusOf(lB.id)) === 'APPROVED',
    );
    check(
      'A continua APPROVED — a linha é compartilhada com a 39088, que a seleciona',
      (await statusOf(lA.id)) === 'APPROVED',
    );
    const galeria1 = await prisma.task.findUnique({
      where: { id: t1.id },
      select: { layouts: { select: { file: { select: { originalName: true } } } } },
    });
    check(
      'a arte B NÃO foi materializada na galeria da 39088',
      !galeria1.layouts.some((l: any) => l.file.originalName.endsWith('-B.png')),
      JSON.stringify(galeria1.layouts),
    );
    const trilha = await prisma.changeLog.findFirst({
      where: { entityId: quoteId, field: 'layouts' },
      orderBy: { createdAt: 'desc' },
      select: { oldValue: true, newValue: true },
    });
    check(
      'a trilha registra o arranjo por veículo',
      !!trilha &&
        String(trilha.newValue).includes(`L${SUFFIX}1`) &&
        String(trilha.newValue).includes('-B.png'),
      JSON.stringify(trilha),
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nO defeito da Carlotti: trocar a seleção do veículo 2 não toca no 1');
    // ═════════════════════════════════════════════════════════════════════
    await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, {
        layouts: [
          { fileId: cloneA, taskIds: [t1.id] },
          { fileId: fC.id, taskIds: [t2.id] },
        ],
      }),
      user.id,
      false,
      'ADMIN',
    );
    check(
      'A (do 39088) CONTINUA APPROVED',
      (await statusOf(lA.id)) === 'APPROVED',
      await statusOf(lA.id),
    );
    check('C (rascunho) vira APPROVED na 39089', (await statusOf(lC.id)) === 'APPROVED');
    check('B sai da seleção da 39089 e é REPROVED', (await statusOf(lB.id)) === 'REPROVED');
    q = await quoteOf(quoteId);
    const cloneC = ownFileByTag(q, 'C')?.id as string;
    check('a arte B saiu de layoutFiles', !ownFileByTag(q, 'B'));

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nNada mudou ⇒ nada muda');
    // ═════════════════════════════════════════════════════════════════════
    r = await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, {
        layouts: [
          { fileId: cloneA, taskIds: [t1.id] },
          { fileId: cloneC, taskIds: [t2.id] },
        ],
      }),
      user.id,
      false,
      'ADMIN',
    );
    check(
      'mesmo arranjo ⇒ "Nenhuma alteração detectada."',
      r.message === 'Nenhuma alteração detectada.',
      r.message,
    );
    r = await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, {
        layouts: [
          { fileId: cloneA, taskIds: [t1.id] },
          { fileId: fC.id, taskIds: [t2.id] }, // o id da GALERIA de uma arte que o orçamento já tem
        ],
      }),
      user.id,
      false,
      'ADMIN',
    );
    check(
      'id da galeria de uma arte que o orçamento já tem NÃO clona de novo',
      r.message === 'Nenhuma alteração detectada.',
      r.message,
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nPortas legadas num orçamento por veículo');
    // ═════════════════════════════════════════════════════════════════════
    const antes = JSON.stringify((await rowsOf(quoteId)).sort());
    r = await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, { layoutFileIds: [cloneC, cloneA] }),
      user.id,
      false,
      'ADMIN',
    );
    check(
      '`layoutFileIds` com o MESMO conjunto passa sem tocar em nada',
      JSON.stringify((await rowsOf(quoteId)).sort()) === antes &&
        (await quoteOf(quoteId)).layoutScope === 'PER_VEHICLE',
      r.message,
    );
    let err = await rejectsWith(
      budgets.update(
        quoteId,
        parse(budgetUpdateSchema, { layoutFileIds: [cloneA] }),
        user.id,
        false,
        'ADMIN',
      ),
      'Este orçamento tem layout por veículo. Altere o layout aprovado pela tela do orçamento, no passo Informações.',
    );
    check(
      '`layoutFileIds` com conjunto DIFERENTE ⇒ 400 com o endereço certo',
      err === null,
      err ?? '',
    );
    // O formulário da tarefa manda o bloco `quote` INTEIRO (o zod exige
    // serviços, validade e pagadores); os campos iguais aos gravados são
    // descartados antes do repositório, e sobra só o layout mudado.
    const gravado = await prisma.budget.findUnique({
      where: { id: quoteId },
      select: {
        expiresAt: true,
        services: {
          orderBy: { position: 'asc' },
          select: { description: true, amount: true, observation: true },
        },
        customerConfigs: {
          select: {
            customerId: true,
            subtotal: true,
            total: true,
            discountType: true,
            generateInvoice: true,
            generateBankSlip: true,
            paymentConfig: true,
          },
        },
      },
    });
    const blocoQuote = {
      expiresAt: gravado.expiresAt,
      status: 'PENDING',
      services: gravado.services.map((sv: any) => ({ ...sv, amount: Number(sv.amount) })),
      customerConfigs: gravado.customerConfigs.map((c: any) => ({
        ...c,
        subtotal: Number(c.subtotal),
        total: Number(c.total),
      })),
    };
    err = await rejectsWith(
      tasks.update(
        t1.id,
        parse(taskUpdateSchema, { quote: { ...blocoQuote, layoutFileIds: [cloneA] } }),
        undefined,
        user.id,
        'ADMIN',
      ),
      'Este orçamento tem layout por veículo',
    );
    check('pela TAREFA (bloco `quote`) também', err === null, err ?? '');
    err = await rejectsWith(
      budgets.update(
        quoteId,
        parse(budgetUpdateSchema, {
          layouts: [{ fileId: cloneA, taskIds: [t1.id] }],
          layoutFileIds: [cloneA],
        }),
        user.id,
        false,
        'ADMIN',
      ),
      'não pelos dois',
    );
    check('`layouts` junto com `layoutFileIds` ⇒ 400', err === null, err ?? '');
    const estranho = await prisma.task.findFirst({
      where: { quoteId: { not: quoteId } },
      select: { id: true },
    });
    err = await rejectsWith(
      budgets.update(
        quoteId,
        parse(budgetUpdateSchema, { layouts: [{ fileId: cloneA, taskIds: [estranho.id] }] }),
        user.id,
        false,
        'ADMIN',
      ),
      'não pertence a este orçamento',
    );
    check('veículo de outro orçamento ⇒ 400', err === null, err ?? '');

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nPortões: todo veículo tem o seu');
    // ═════════════════════════════════════════════════════════════════════
    await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, { layouts: [{ fileId: cloneA, taskIds: [t1.id] }] }),
      user.id,
      false,
      'ADMIN',
    );
    q = await quoteOf(quoteId);
    check('só a 39088 com arte ⇒ PER_VEHICLE (não normaliza)', q.layoutScope === 'PER_VEHICLE');
    const falta = `Falta o layout aprovado do veículo L${SUFFIX}2.`;
    err = await rejectsWith(budgets.budgetApprove(quoteId, user.id), falta);
    check('aprovação comercial recusa nomeando o veículo', err === null, err ?? '');
    const preflight = await envelopes.getDeliveryPreflight(quoteId);
    check(
      'a prévia da assinatura acusa o mesmo',
      preflight.blockers.some((b: string) => b.startsWith(falta)),
      JSON.stringify(preflight.blockers),
    );
    const graph = await snapshotSvc.loadQuoteGraph(quoteId);
    const snap = snapshotSvc.build(graph);
    check(
      'o snapshot congela a cobertura gravada',
      JSON.stringify(snap.layoutCoverage) === JSON.stringify([[cloneA, [t1.id]]]),
      JSON.stringify(snap.layoutCoverage),
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nVeículo que sai do orçamento leva a cobertura junto');
    // ═════════════════════════════════════════════════════════════════════
    await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, {
        layouts: [
          { fileId: cloneA, taskIds: [t1.id] },
          { fileId: cloneC, taskIds: [t2.id] },
        ],
      }),
      user.id,
      false,
      'ADMIN',
    );
    // Só `taskIds`: a poda roda sozinha (é o caminho de toda troca de vínculo).
    await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, { taskIds: [t1.id] }),
      user.id,
      false,
      'ADMIN',
    );
    q = await quoteOf(quoteId);
    check(
      'a linha da 39089 sumiu',
      !(await rowsOf(quoteId)).some(x => x.endsWith(t2.id)),
      JSON.stringify(await rowsOf(quoteId)),
    );
    check(
      'a arte que era SÓ dela saiu do orçamento',
      !q.layoutFiles.some((f: any) => f.id === cloneC),
    );
    check(
      'nenhuma linha órfã da 39089 em lugar nenhum',
      (await prisma.budgetLayoutTask.count({ where: { taskId: t2.id } })) === 0,
    );
    check(
      'o orçamento continua PER_VEHICLE (a poda não normaliza)',
      q.layoutScope === 'PER_VEHICLE',
      q.layoutScope,
    );
    await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, { taskIds: [t1.id, t2.id] }),
      user.id,
      false,
      'ADMIN',
    );
    q = await quoteOf(quoteId);
    check(
      'voltando ao orçamento, a 39089 NÃO ganha cobertura implícita',
      q.layoutScope === 'PER_VEHICLE' &&
        (await prisma.budgetLayoutTask.count({ where: { taskId: t2.id } })) === 0,
    );
    err = await rejectsWith(budgets.budgetApprove(quoteId, user.id), falta);
    check('e o portão acusa', err === null, err ?? '');

    // A tela reenvia `layouts` junto com a retirada — o eco ainda cita a 39089.
    await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, {
        layouts: [
          { fileId: cloneA, taskIds: [t1.id] },
          { fileId: fC.id, taskIds: [t2.id] },
        ],
      }),
      user.id,
      false,
      'ADMIN',
    );
    const cloneC2 = ownFileByTag(await quoteOf(quoteId), 'C')?.id as string;
    await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, {
        taskIds: [t1.id],
        layouts: [
          { fileId: cloneA, taskIds: [t1.id] },
          { fileId: cloneC2, taskIds: [t2.id] },
        ],
      }),
      user.id,
      false,
      'ADMIN',
    );
    q = await quoteOf(quoteId);
    check(
      'retirada + eco de `layouts`: nenhuma linha órfã da 39089 (nem da arte que saiu)',
      (await prisma.budgetLayoutTask.count({ where: { taskId: t2.id } })) === 0 &&
        (await prisma.budgetLayoutTask.count({ where: { fileId: cloneC2 } })) === 0,
    );
    check(
      'e a arte restante cobre o único veículo ⇒ normaliza para SHARED (regra do pedido)',
      q.layoutScope === 'SHARED' &&
        q.layoutFiles.length === 1 &&
        (await rowsOf(quoteId)).length === 0,
      JSON.stringify(q),
    );
    await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, { taskIds: [t1.id, t2.id] }),
      user.id,
      false,
      'ADMIN',
    );
    await budgets.update(
      quoteId,
      parse(budgetUpdateSchema, { layouts: [] }),
      user.id,
      false,
      'ADMIN',
    );
    q = await quoteOf(quoteId);
    check(
      '`layouts: []` limpa e volta a SHARED',
      q.layoutScope === 'SHARED' &&
        q.layoutFiles.length === 0 &&
        (await rowsOf(quoteId)).length === 0,
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nCriação por veículo: `layouts` já faz nascer PER_VEHICLE');
    // ═════════════════════════════════════════════════════════════════════
    //
    // Na `main` este bloco também conferia a O.S. "Em Negociação" por veículo.
    // Na `feat/portal-do-responsavel` essa O.S. deixou de existir (591a9281:
    // o estado do orçamento é do orçamento) e `em-negociacao-sync.ts` foi
    // apagado; `tests/orcamento-sem-os-negociacao.test.ts` guarda a ausência.
    // Fica a parte que não depende dela: a criação com `layouts` por veículo.
    const t3 = await prisma.task.create({
      data: { name: NAME_PREFIX, serialNumber: `L${SUFFIX}3`, customerId: customer.id },
    });
    const t4 = await prisma.task.create({
      data: { name: NAME_PREFIX, serialNumber: `L${SUFFIX}4`, customerId: customer.id },
    });
    createdTaskIds.push(t3.id, t4.id);
    const q2 = await budgets.create(
      parse(budgetCreateSchema, {
        taskIds: [t3.id, t4.id],
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
        layouts: [{ fileId: fA.id, taskIds: [t3.id] }],
      }),
      user.id,
    );
    createdQuoteIds.push(q2.data.id);
    check(
      'a criação já nasce PER_VEHICLE pelo `layouts`',
      q2.data.layoutScope === 'PER_VEHICLE',
      q2.data.layoutScope,
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nMedir um veículo mede o outro (mesmo orçamento)');
    // ═════════════════════════════════════════════════════════════════════
    const truck1 = await prisma.truck.create({ data: { taskId: t1.id } });
    const truck2 = await prisma.truck.create({ data: { taskId: t2.id } });
    const medida = {
      height: 2.6,
      sections: [
        { width: 4.2, isDoor: false, doorHeight: null, position: 0 },
        { width: 1.1, isDoor: true, doorHeight: 2.1, position: 1 },
      ],
    };
    await measures.createOrUpdateTruckImplementMeasure(truck1.id, 'left', medida as any, user.id);
    const leftOf = (truckId: string) =>
      prisma.truck.findUnique({
        where: { id: truckId },
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
    let m1 = await leftOf(truck1.id);
    let m2 = await leftOf(truck2.id);
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
      log?.reason === `Medidas replicadas do veículo L${SUFFIX}1 (mesmo orçamento)`,
      log?.reason,
    );
    const idAntes = m2.leftSideMeasure.id;
    await measures.createOrUpdateTruckImplementMeasure(truck1.id, 'left', medida as any, user.id);
    m2 = await leftOf(truck2.id);
    check(
      'regravar a mesma medida não reescreve o irmão (só o lado que DIFERE)',
      m2.leftSideMeasure.id === idAntes,
    );

    await tasks.update(
      t2.id,
      parse(taskUpdateSchema, {
        truck: {
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
    m1 = await leftOf(truck1.id);
    check(
      'pela edição da TAREFA também (lado direito da 39089 → 39088)',
      m1?.rightSideMeasure?.height === 2.4,
      JSON.stringify(m1),
    );

    await tasks.update(
      t1.id,
      parse(taskUpdateSchema, { truck: { leftSideMeasure: null } }),
      undefined,
      user.id,
      'ADMIN',
    );
    m1 = await leftOf(truck1.id);
    m2 = await leftOf(truck2.id);
    check(
      'exclusão NÃO replica',
      !m1.leftSideMeasure && !!m2.leftSideMeasure,
      JSON.stringify({ m1, m2 }),
    );
  } finally {
    try {
      const measureIds = (
        await prisma.truck.findMany({
          where: { taskId: { in: createdTaskIds } },
          select: { leftSideMeasureId: true, rightSideMeasureId: true, backSideMeasureId: true },
        })
      )
        .flatMap((t: any) => [t.leftSideMeasureId, t.rightSideMeasureId, t.backSideMeasureId])
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
      // Os arquivos de teste e TODOS os clones deles (mesmo `originalName`). O
      // banco recusa apagar arquivo referenciado (trigger) — a válvula é
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
  if (process.env.LAYOUT_TEST_PURE_ONLY === '1') return;
  await dbChecks();
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? '\n✅ Layout por veículo: todas as verificações passaram.\n'
        : `\n❌ ${failures} verificação(ões) falharam.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ O teste estourou:', err?.stack ?? err);
    process.exit(1);
  });
