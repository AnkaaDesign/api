/**
 * G15 — ESCRITOR × FACE: toda porta que grava medida de implemento passa pelo
 * escritor único e deixa cada face com a SUA linha.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Eram dez caminhos gravando `ImplementMeasure`, cada um com a sua regra para a
 * linha compartilhada. O pior: `PUT /implement-measure/:id` e a identificação
 * do portal editavam a linha NO LUGAR — o cliente corrigia o próprio furgão e
 * mudava o de outro cliente (produção, 23/09: 11 linhas compartilhadas por 15
 * implementos). E a face nova (a frente, no P11) teria de ser lembrada em dez
 * lugares; a que fosse esquecida "gravaria num e sumiria no outro".
 *
 * Aqui, contra o banco e pelos serviços que as telas chamam, para cada escritor
 * e cada uma das 3 faces: criar, atualizar, apagar e foto (quando o caminho tem
 * a operação), com asserção no banco — metros, `position` das seções em ordem,
 * foto, e NENHUMA linha usada por mais de uma face depois da escrita. Mais:
 *   - "editar a medida de A não altera B" quando A e B JÁ compartilhavam a
 *     linha (o dado legado que hoje corrompe), pela edição de tarefa, pelo lote,
 *     pelo portal e pelo módulo de medidas;
 *   - apagar não remove a linha apontada por uma `PaintingAnalysis`;
 *   - nenhum escritor fora do escritor único faz `create/update/delete` de
 *     medida (forma da fonte).
 *
 *   npm run test:implement-measure-writer
 *
 * ⚠️ Escreve no banco de `DATABASE_URL` (o clone local) e APAGA o que criou no
 * fim (`finally`). As fotos sobem para uma pasta temporária (`FILES_ROOT` é
 * trocado antes de a aplicação subir). Roda sob `ts-node` pelo mesmo motivo de
 * `tests/layout-per-vehicle.test.ts`.
 */

process.env.TZ = 'America/Sao_Paulo';

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { scanMeasureWrites, scanMeasureWriteSource } from './helpers/measure-write-scan';

const SUFFIX = Date.now().toString().slice(-6);
const NAME_PREFIX = `zz-g15-medida-${SUFFIX}`;
const TMP = resolve(join(tmpdir(), `g15-medida-${SUFFIX}`));
mkdirSync(join(TMP, 'files'), { recursive: true });
mkdirSync(join(TMP, 'uploads'), { recursive: true });
// As fotos enviadas por multipart são MOVIDAS para FILES_ROOT: nunca a pasta real.
process.env.FILES_ROOT = join(TMP, 'files');

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

type Face = 'left' | 'right' | 'back';
const FACES_T: Face[] = ['left', 'right', 'back'];
const FK: Record<Face, 'leftSideMeasureId' | 'rightSideMeasureId' | 'backSideMeasureId'> = {
  left: 'leftSideMeasureId',
  right: 'rightSideMeasureId',
  back: 'backSideMeasureId',
};
const REL: Record<Face, 'leftSideMeasure' | 'rightSideMeasure' | 'backSideMeasure'> = {
  left: 'leftSideMeasure',
  right: 'rightSideMeasure',
  back: 'backSideMeasure',
};
const PHOTO_KEY: Record<Face, string> = {
  left: 'implementMeasurePhotos.leftSide',
  right: 'implementMeasurePhotos.rightSide',
  back: 'implementMeasurePhotos.backSide',
};
const PORTAL_KEY: Record<Face, 'esquerda' | 'direita' | 'traseira'> = {
  left: 'esquerda',
  right: 'direita',
  back: 'traseira',
};

/** Uma medida em METROS: altura + larguras; a última seção é porta. */
function medida(height: number, widths: number[], photoId?: string | null) {
  return {
    height,
    sections: widths.map((width, position) => {
      const isDoor = position === widths.length - 1 && widths.length > 1;
      return { width, isDoor, doorHeight: isDoor ? Math.min(2, height) : null, position };
    }),
    ...(photoId !== undefined && { photoId }),
  };
}

/** A mesma medida em CENTÍMETROS, como o portal a recebe. */
function medidaCm(height: number, widths: number[]) {
  const m = medida(height, widths);
  return {
    height: Math.round(m.height * 100),
    sections: m.sections.map(s => ({
      width: Math.round(s.width * 100),
      isDoor: s.isDoor,
      doorHeight: s.doorHeight == null ? null : Math.round(s.doorHeight * 100),
      position: s.position,
    })),
  };
}

// Valores distintos por face, para que um lado trocado apareça.
const H: Record<Face, number> = { left: 2.6, right: 2.55, back: 2.4 };
const W: Record<Face, number[]> = { left: [4.2, 1.1], right: [3.9, 1.4], back: [2.45] };
const H2: Record<Face, number> = { left: 2.7, right: 2.65, back: 2.5 };
const W2: Record<Face, number[]> = { left: [3.1, 2.2, 1.05], right: [5.3], back: [2.35, 0.1] };

async function main() {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../src/app.module');
  const { PrismaService } = require('../src/modules/common/prisma/prisma.service');
  const { TaskService } = require('../src/modules/production/task/task.service');
  const {
    ImplementMeasureService,
  } = require('../src/modules/production/implement-measure/implement-measure.service');
  const {
    PortalIdentityService,
  } = require('../src/modules/people/portal/portal-identity.service');
  const { PortalRequestService } = require('../src/modules/people/portal/portal-request.service');
  const writer = require('../src/modules/production/implement-measure/implement-measure-writer');
  const {
    taskCreateSchema,
    taskUpdateSchema,
    taskBatchCreateSchema,
    taskBatchUpdateSchema,
  } = require('../src/schemas/task');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const parse = (schema: any, body: unknown) => {
    const r = schema.safeParse(body);
    if (!r.success) throw new Error(`zod recusou: ${JSON.stringify(r.error.issues)}`);
    return r.data;
  };

  // ── Forma da fonte: ninguém fora do escritor escreve medida ───────────────
  // Pelo AST (tests/helpers/measure-write-scan.ts), em src/, scripts/ e prisma/:
  // escrita direta no modelo, chave de face dentro de uma escrita (inclusive
  // aninhada e com a FK literal), operação aninhada numa face, atribuição a
  // coluna de face, chave computada sem o desvio pelo FACE_FK e SQL cru.
  console.log('\nA FONTE — só o escritor único grava `ImplementMeasure`');
  {
    const raiz = resolve(__dirname, '..', 'src');
    const fora = scanMeasureWrites(resolve(__dirname, '..'));
    check(
      'nenhuma escrita de medida fora de implement-measure-writer.ts (src/, scripts/, prisma/)',
      fora.length === 0,
      fora.map(h => `${h.file}:${h.line} [${h.rule}] ${h.text}`).join(' | '),
    );
    // A varredura pega o que promete: cada forma abaixo TEM de ser acusada.
    const CANARIOS: Array<[string, string]> = [
      [
        'FK literal copiada',
        'tx.implement.update({ where: { id }, data: { leftSideMeasureId: outro.leftSideMeasureId } })',
      ],
      ['FK na criação', 'tx.implement.create({ data: { taskId, backSideMeasureId: x } })'],
      [
        'connect aninhado',
        'tx.implement.update({ where: { id }, data: { rightSideMeasure: { connect: { id: x } } } })',
      ],
      [
        'create aninhado',
        'tx.task.create({ data: { implement: { create: { backSideMeasure: { create: {} } } } } })',
      ],
      [
        'face do P11',
        'tx.task.update({ where: { id }, data: { implement: { update: { frontSideMeasureId: x } } } })',
      ],
      ['objeto montado fora', 'const payload = { leftSideMeasure: { connectOrCreate: {} } }'],
      ['escrita direta', 'tx.implementMeasure.update({ where: { id }, data: {} })'],
      ['escrita por colchete', "tx['implementMeasure'].delete({ where: { id } })"],
      ['atribuição', 'implementData.rightSideMeasureId = null'],
      ['chave computada sem desvio', 'tx.implement.update({ where: { id }, data: { [campo]: v } })'],
      ['SQL cru', 'tx.$executeRaw`UPDATE "Implement" SET "leftSideMeasureId" = ${x}`'],
    ];
    const cegos = CANARIOS.filter(([, src]) => scanMeasureWriteSource('canario.ts', src).length === 0);
    check(
      `a varredura acusa as ${CANARIOS.length} formas de escrita (canários)`,
      cegos.length === 0,
      cegos.map(([n]) => n).join(', '),
    );
    const LEITURAS = [
      'tx.implement.findMany({ select: { leftSideMeasureId: true }, where: { backSideMeasureId: x } })',
      'z.object({ leftSideMeasure: implementMeasureSideSchema })',
      'function f() { return { leftSideMeasure: implement.leftSideMeasure } }',
      'if (face && FACE_FK[face] === campo) { a() } ' +
        'else { tx.implement.update({ where: { id }, data: { [campo]: v } }) }',
    ];
    const falsos = LEITURAS.filter(src => scanMeasureWriteSource('leitura.ts', src).length > 0);
    check(
      'leitura, schema, resposta e a reversão desviada pelo FACE_FK não são acusados',
      falsos.length === 0,
      falsos.join(' | '),
    );
    const portal = readFileSync(
      join(raiz, 'modules/people/portal/portal-identity.service.ts'),
      'utf8',
    );
    check(
      'portal-identity: sem `.catch(` na escrita de medida dentro da transação',
      !/implementMeasure[\s\S]{0,120}\.catch\(/.test(portal),
    );
    check(
      'a lista de faces da API é UMA (constants/implement-faces.ts)',
      JSON.stringify(writer.FACES) === JSON.stringify(['left', 'right', 'back']),
      JSON.stringify(writer.FACES),
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const tasks = app.get(TaskService);
  const measures = app.get(ImplementMeasureService);
  const identity = app.get(PortalIdentityService);
  const request = app.get(PortalRequestService);

  const startedAt = new Date(Date.now() - 1000);
  const createdTaskIds: string[] = [];
  const createdQuoteIds: string[] = [];
  const createdAnalysisIds: string[] = [];
  let serial = 0;

  try {
    const customer = await prisma.customer.findFirst({ select: { id: true, fantasyName: true } });
    const user = await prisma.user.findFirst({
      where: { sector: { privileges: 'ADMIN' } },
      select: { id: true },
    });
    const responsible = await prisma.responsible.findFirst({ select: { id: true } });
    if (!customer || !user || !responsible) {
      check('banco com cliente, usuário ADMIN e um responsável', false);
      return;
    }

    // ── Ajudantes ────────────────────────────────────────────────────────────
    const nextSerial = () => `G15${SUFFIX}${++serial}`;
    const mkTask = async (quoteId?: string) => {
      const t = await prisma.task.create({
        data: {
          name: `${NAME_PREFIX}-${serial + 1}`,
          customerId: customer.id,
          ...(quoteId && { quoteId }),
          // DD1: toda tarefa nasce com implemento, e a série mora nele
          implement: { create: { serialNumber: nextSerial(), spot: null } },
        },
      });
      createdTaskIds.push(t.id);
      return t;
    };
    const mkTaskWithImplement = async (quoteId?: string) => {
      const t = await mkTask(quoteId);
      const implement = await prisma.implement.findUnique({ where: { taskId: t.id } });
      return { task: t, implement };
    };
    const mkPhoto = async (tag: string) =>
      prisma.file.create({
        data: {
          filename: `${tag}.png`,
          originalName: `${NAME_PREFIX}-${tag}.png`,
          mimetype: 'image/png',
          path: join(TMP, `${tag}.png`),
          size: 10,
        },
      });
    /** Um arquivo de multipart de verdade (o upload MOVE o arquivo). */
    const mkUpload = (tag: string) => {
      const path = join(TMP, 'uploads', `${tag}.png`);
      writeFileSync(path, Buffer.alloc(64, 7));
      return {
        fieldname: 'photo',
        originalname: `${NAME_PREFIX}-${tag}.png`,
        encoding: '7bit',
        mimetype: 'image/png',
        destination: join(TMP, 'uploads'),
        filename: `${tag}.png`,
        path,
        size: 64,
      } as any;
    };
    const faceRow = async (implementId: string | undefined, face: Face) => {
      if (!implementId) return null;
      const t = await prisma.implement.findUnique({
        where: { id: implementId },
        select: {
          [FK[face]]: true,
          [REL[face]]: {
            select: {
              id: true,
              height: true,
              photoId: true,
              sections: {
                orderBy: { position: 'asc' },
                select: { width: true, isDoor: true, doorHeight: true, position: true },
              },
            },
          },
        },
      });
      return (t as any)?.[REL[face]] ?? null;
    };
    const implementOfTask = async (taskId: string) =>
      prisma.implement.findUnique({ where: { taskId }, select: { id: true } });
    /** Metros, ordem e posição das seções, e (opcional) a foto. */
    const expectFace = async (
      label: string,
      implementId: string | undefined,
      face: Face,
      height: number,
      widths: number[],
      photoId?: string | null,
    ) => {
      const row = await faceRow(implementId, face);
      const ok =
        !!row &&
        row.height === height &&
        JSON.stringify(row.sections.map((s: any) => s.width)) === JSON.stringify(widths) &&
        JSON.stringify(row.sections.map((s: any) => s.position)) ===
          JSON.stringify(widths.map((_, i) => i)) &&
        (photoId === undefined || row.photoId === photoId);
      check(label, ok, JSON.stringify(row));
      return row;
    };
    /** Toda linha usada pelas faces destes caminhões é usada por UMA face só, no banco inteiro. */
    const expectNoSharing = async (label: string, implementIds: string[]) => {
      const implementList = await prisma.implement.findMany({
        where: { id: { in: implementIds } },
        select: { leftSideMeasureId: true, rightSideMeasureId: true, backSideMeasureId: true },
      });
      const ids = implementList
        .flatMap((t: any) => [t.leftSideMeasureId, t.rightSideMeasureId, t.backSideMeasureId])
        .filter(Boolean);
      const shared: string[] = [];
      for (const id of new Set(ids)) {
        const n = await prisma.implement.count({
          where: {
            OR: [
              { leftSideMeasureId: id as string },
              { rightSideMeasureId: id as string },
              { backSideMeasureId: id as string },
            ],
          },
        });
        const sameImplementTwice = implementList.filter(
          (t: any) =>
            [t.leftSideMeasureId, t.rightSideMeasureId, t.backSideMeasureId].filter(x => x === id)
              .length > 1,
        ).length;
        if (n > 1 || sameImplementTwice > 0) shared.push(id as string);
      }
      check(label, shared.length === 0, `compartilhadas: ${shared.join(', ')}`);
    };
    const measureExists = async (id: string) =>
      !!(await prisma.implementMeasure.findUnique({ where: { id }, select: { id: true } }));
    /** Duas faces compartilhando a MESMA linha — o dado legado (produção: 11 linhas). */
    const mkSharedPair = async (face: Face, quoteId?: string) => {
      const a = await mkTaskWithImplement(quoteId);
      const b = await mkTaskWithImplement(quoteId);
      const legacy = await prisma.implementMeasure.create({
        data: {
          height: 2.3,
          sections: { create: [{ width: 6.0, isDoor: false, doorHeight: null, position: 0 }] },
        },
      });
      await prisma.implement.update({ where: { id: a.implement.id }, data: { [FK[face]]: legacy.id } });
      await prisma.implement.update({ where: { id: b.implement.id }, data: { [FK[face]]: legacy.id } });
      return { a, b, legacyId: legacy.id };
    };
    const expectBUntouched = async (label: string, implementId: string, face: Face, legacyId: string) => {
      const row = await faceRow(implementId, face);
      check(
        label,
        !!row && row.id === legacyId && row.height === 2.3 && row.sections[0]?.width === 6.0,
        JSON.stringify(row),
      );
    };

    const photos: Record<string, any> = {};
    for (const face of FACES_T) {
      photos[face] = await mkPhoto(`foto-${face}`);
      photos[`${face}2`] = await mkPhoto(`foto-${face}-2`);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n#1 POST /tasks — criar (3 faces) + foto por `photoId`');
    // ═════════════════════════════════════════════════════════════════════
    {
      const created = await tasks.create(
        parse(taskCreateSchema, {
          name: `${NAME_PREFIX}-create`,
          customerId: customer.id,
          implement: {
            serialNumber: nextSerial(),
            ...Object.fromEntries(FACES_T.map(f => [REL[f], medida(H[f], W[f], photos[f].id)])),
          },
        }),
        undefined,
        user.id,
      );
      const taskId = created?.data?.id;
      if (taskId) createdTaskIds.push(taskId);
      const implement = taskId ? await implementOfTask(taskId) : null;
      for (const f of FACES_T) {
        await expectFace(`#1 ${f}: criada em metros, seções em ordem, foto`, implement?.id, f, H[f], W[f], photos[f].id);
      }
      await expectNoSharing('#1 sem compartilhamento', implement ? [implement.id] : []);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n#2 POST /tasks/batch — criar (3 faces × 2 tarefas iguais) + foto');
    // ═════════════════════════════════════════════════════════════════════
    {
      const body = () => ({
        name: `${NAME_PREFIX}-batch`,
        customerId: customer.id,
        implement: {
          serialNumber: nextSerial(),
          ...Object.fromEntries(FACES_T.map(f => [REL[f], medida(H[f], W[f], photos[f].id)])),
        },
      });
      const result = await tasks.batchCreate(
        parse(taskBatchCreateSchema, { tasks: [body(), body()] }),
        undefined,
        user.id,
      );
      const ids: string[] = (result?.data?.success ?? []).map((t: any) => t.id);
      createdTaskIds.push(...ids);
      check('#2 duas tarefas criadas', ids.length === 2, JSON.stringify(result?.data?.failed));
      const implementIds: string[] = [];
      for (const id of ids) {
        const implement = await implementOfTask(id);
        if (!implement) continue;
        implementIds.push(implement.id);
        for (const f of FACES_T) {
          await expectFace(`#2 ${f} da tarefa ${ids.indexOf(id) + 1}`, implement.id, f, H[f], W[f], photos[f].id);
        }
      }
      await expectNoSharing('#2 o MESMO payload em duas tarefas não compartilha linha', implementIds);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n#3 PUT /tasks/:id — criar, atualizar, foto (multipart), apagar');
    // ═════════════════════════════════════════════════════════════════════
    let updateTaskId = '';
    {
      const { task, implement } = await mkTaskWithImplement();
      updateTaskId = task.id;
      await tasks.update(
        task.id,
        parse(taskUpdateSchema, {
          implement: Object.fromEntries(FACES_T.map(f => [REL[f], medida(H[f], W[f])])),
        }),
        undefined,
        user.id,
        'ADMIN',
      );
      const firstIds: Record<string, string> = {};
      for (const f of FACES_T) {
        const row = await expectFace(`#3 criar ${f}`, implement.id, f, H[f], W[f], null);
        firstIds[f] = row?.id;
      }
      await tasks.update(
        task.id,
        parse(taskUpdateSchema, {
          implement: Object.fromEntries(FACES_T.map(f => [REL[f], medida(H2[f], W2[f])])),
        }),
        undefined,
        user.id,
        'ADMIN',
      );
      for (const f of FACES_T) {
        const row = await expectFace(`#3 atualizar ${f}`, implement.id, f, H2[f], W2[f]);
        check(`#3 atualizar ${f}: a linha é só dela ⇒ editada NO LUGAR (mesmo id)`, row?.id === firstIds[f]);
      }
      // Seções vazias numa edição = manter as atuais (o defeito "as medidas sumiram").
      await tasks.update(
        task.id,
        parse(taskUpdateSchema, { implement: { leftSideMeasure: { height: 2.75, sections: [] } } }),
        undefined,
        user.id,
        'ADMIN',
      );
      await expectFace('#3 lista de seções vazia mantém as seções (só a altura muda)', implement.id, 'left', 2.75, W2.left);
      await tasks.update(
        task.id,
        parse(taskUpdateSchema, {
          implement: { leftSideMeasure: medida(H2.left, W2.left) },
        }),
        undefined,
        user.id,
        'ADMIN',
      );

      const files: Record<string, any> = {};
      for (const f of FACES_T) files[PHOTO_KEY[f]] = [mkUpload(`upload-${f}`)];
      await tasks.update(task.id, parse(taskUpdateSchema, { implement: {} }), undefined, user.id, 'ADMIN', files);
      for (const f of FACES_T) {
        const row = await faceRow(implement.id, f);
        const file = row?.photoId
          ? await prisma.file.findUnique({ where: { id: row.photoId }, select: { originalName: true } })
          : null;
        check(
          `#3 foto ${f} (multipart implementMeasurePhotos.*) pendurada na face`,
          file?.originalName === `${NAME_PREFIX}-upload-${f}.png`,
          JSON.stringify({ row, file }),
        );
      }
      await expectNoSharing('#3 sem compartilhamento', [implement.id]);

      await tasks.update(
        task.id,
        parse(taskUpdateSchema, {
          implement: Object.fromEntries(FACES_T.map(f => [REL[f], null])),
        }),
        undefined,
        user.id,
        'ADMIN',
      );
      for (const f of FACES_T) {
        const row = await faceRow(implement.id, f);
        check(`#3 apagar ${f}: face vazia e a linha (sem outro uso) removida`, !row && !(await measureExists(firstIds[f])));
      }

      console.log('  — linha compartilhada (legado): editar A não altera B');
      for (const f of FACES_T) {
        const { a, b, legacyId } = await mkSharedPair(f);
        await tasks.update(
          a.task.id,
          parse(taskUpdateSchema, { implement: { [REL[f]]: medida(H2[f], W2[f]) } }),
          undefined,
          user.id,
          'ADMIN',
        );
        const rowA = await expectFace(`#3 ${f}: A recebeu a edição`, a.implement.id, f, H2[f], W2[f]);
        check(`#3 ${f}: A ganhou linha própria (copy-on-write)`, rowA?.id !== legacyId);
        await expectBUntouched(`#3 ${f}: B intacto`, b.implement.id, f, legacyId);
        await expectNoSharing(`#3 ${f}: nada compartilhado depois`, [a.implement.id, b.implement.id]);

        // Apagar a face de B: a linha é só de B agora ⇒ sai.
        await tasks.update(b.task.id, parse(taskUpdateSchema, { implement: { [REL[f]]: null } }), undefined, user.id, 'ADMIN');
        check(`#3 ${f}: apagar B remove a linha que ficou só dele`, !(await measureExists(legacyId)));
      }

      console.log('  — apagar com análise de pintura apontando');
      {
        const { implement: t2, task: task2 } = await mkTaskWithImplement();
        await tasks.update(task2.id, parse(taskUpdateSchema, { implement: { backSideMeasure: medida(H.back, W.back) } }), undefined, user.id, 'ADMIN');
        const row = await faceRow(t2.id, 'back');
        const analysis = await prisma.paintingAnalysis.create({
          data: { name: `${NAME_PREFIX}-analise`, implementMeasureId: row.id },
        });
        createdAnalysisIds.push(analysis.id);
        await tasks.update(task2.id, parse(taskUpdateSchema, { implement: { backSideMeasure: null } }), undefined, user.id, 'ADMIN');
        const still = await prisma.paintingAnalysis.findUnique({ where: { id: analysis.id }, select: { implementMeasureId: true } });
        check(
          '#3 apagar a face NÃO remove a linha apontada por PaintingAnalysis (o vínculo fica)',
          !(await faceRow(t2.id, 'back')) && (await measureExists(row.id)) && still?.implementMeasureId === row.id,
          JSON.stringify(still),
        );
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n#4 PUT /tasks/batch — criar, atualizar, foto (`photoId`); `null` não apaga');
    // ═════════════════════════════════════════════════════════════════════
    {
      const { task, implement } = await mkTaskWithImplement();
      const run = (implementBody: any) =>
        tasks.batchUpdate(
          parse(taskBatchUpdateSchema, { tasks: [{ id: task.id, data: { implement: implementBody } }] }),
          undefined,
          user.id,
        );
      await run(Object.fromEntries(FACES_T.map(f => [REL[f], medida(H[f], W[f])])));
      const ids: Record<string, string> = {};
      for (const f of FACES_T) ids[f] = (await expectFace(`#4 criar ${f}`, implement.id, f, H[f], W[f]))?.id;
      await run(Object.fromEntries(FACES_T.map(f => [REL[f], medida(H2[f], W2[f], photos[`${f}2`].id)])));
      for (const f of FACES_T) {
        const row = await expectFace(`#4 atualizar + foto ${f}`, implement.id, f, H2[f], W2[f], photos[`${f}2`].id);
        check(`#4 ${f}: no lugar (I38: o id não troca a cada lote)`, row?.id === ids[f]);
      }
      const log = await prisma.changeLog.findFirst({
        where: { entityId: task.id, field: 'implementMeasures', triggeredBy: 'BATCH_UPDATE' },
        orderBy: { createdAt: 'desc' },
        select: { oldValue: true, newValue: true },
      });
      const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as any;
      const oldLeft = json(log?.oldValue)?.leftSideMeasureId;
      check(
        '#4 trilha do lote: o ANTES é o de antes da escrita (não o valor novo)',
        oldLeft?.height === H.left && json(log?.newValue)?.leftSideMeasureId?.height === H2.left,
        JSON.stringify(log),
      );
      await run({ leftSideMeasure: null });
      await expectFace('#4 `null` no lote é ignorado, como sempre (não apaga)', implement.id, 'left', H2.left, W2.left);
      await expectNoSharing('#4 sem compartilhamento', [implement.id]);

      for (const f of FACES_T) {
        const { a, b, legacyId } = await mkSharedPair(f);
        await tasks.batchUpdate(
          parse(taskBatchUpdateSchema, { tasks: [{ id: a.task.id, data: { implement: { [REL[f]]: medida(H[f], W[f]) } } }] }),
          undefined,
          user.id,
        );
        await expectFace(`#4 ${f}: A editada pelo lote`, a.implement.id, f, H[f], W[f]);
        await expectBUntouched(`#4 ${f}: B intacto`, b.implement.id, f, legacyId);
        await expectNoSharing(`#4 ${f}: nada compartilhado depois`, [a.implement.id, b.implement.id]);
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n#5 Reverter pelo histórico — atualizar, apagar e recriar');
    // ═════════════════════════════════════════════════════════════════════
    {
      const { task, implement } = await mkTaskWithImplement();
      const upd = (body: any) => tasks.update(task.id, parse(taskUpdateSchema, { implement: body }), undefined, user.id, 'ADMIN');
      await upd(Object.fromEntries(FACES_T.map(f => [REL[f], medida(H[f], W[f], photos[f].id)])));
      await upd(Object.fromEntries(FACES_T.map(f => [REL[f], medida(H2[f], W2[f])])));
      for (const f of FACES_T) {
        const log = await prisma.changeLog.findFirst({
          where: { entityId: task.id, field: 'implementMeasures', reason: `ImplementMeasure ${FK[f]} atualizado` },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        const before = await faceRow(implement.id, f);
        await tasks.rollbackFieldChange(log.id, user.id);
        const row = await expectFace(`#5 reverter a edição de ${f}: valores de antes`, implement.id, f, H[f], W[f]);
        check(`#5 ${f}: edição foi no lugar ⇒ reverte na mesma linha, foto preservada`, row?.id === before?.id && row?.photoId === photos[f].id);
      }
      // Reverter a remoção: a face volta (recriada pelas seções do histórico).
      await upd({ rightSideMeasure: null });
      const logDel = await prisma.changeLog.findFirst({
        where: { entityId: task.id, field: 'implementMeasures', reason: 'ImplementMeasure rightSideMeasureId removido' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      await tasks.rollbackFieldChange(logDel.id, user.id);
      await expectFace('#5 reverter a remoção: a face volta', implement.id, 'right', H.right, W.right);
      // Reverter a criação: a face esvazia.
      const logCreate = await prisma.changeLog.findFirst({
        where: { entityId: task.id, field: 'implementMeasures', reason: 'ImplementMeasure backSideMeasureId criado' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      await tasks.rollbackFieldChange(logCreate.id, user.id);
      check('#5 reverter a criação: a face fica vazia', !(await faceRow(implement.id, 'back')));
      await expectNoSharing('#5 sem compartilhamento', [implement.id]);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n#6 PUT /tasks/:id/copy-from — copiar as 3 faces (linhas NOVAS)');
    // ═════════════════════════════════════════════════════════════════════
    {
      const src = await mkTaskWithImplement();
      for (const f of FACES_T) {
        await writer.setFace(prisma, src.implement.id, f, medida(H[f], W[f], photos[f].id));
      }
      const dst = await mkTaskWithImplement();
      await prisma.$transaction((tx: any) => writer.setFace(tx, dst.implement.id, 'left', medida(1.5, [1.0])));
      const oldDstLeft = (await faceRow(dst.implement.id, 'left'))?.id;
      await tasks.copyFromTask(dst.task.id, src.task.id, ['implementMeasures'], user.id, 'ADMIN');
      for (const f of FACES_T) {
        const row = await expectFace(`#6 ${f} copiada (metros, ordem, foto)`, dst.implement.id, f, H[f], W[f], photos[f].id);
        const srcRow = await faceRow(src.implement.id, f);
        check(`#6 ${f}: linha nova, não a da origem`, row?.id && row.id !== srcRow?.id);
      }
      check('#6 a linha anterior do destino (sem outro uso) saiu', !(await measureExists(oldDstLeft)));
      await expectNoSharing('#6 sem compartilhamento', [src.implement.id, dst.implement.id]);

      // Destino recém-criado, sem nenhuma medida (o implemento existe: DD1).
      const bare = await mkTask();
      await tasks.copyFromTask(bare.id, src.task.id, ['implementMeasures'], user.id, 'ADMIN');
      const bareImplement = await implementOfTask(bare.id);
      for (const f of FACES_T) await expectFace(`#6 destino sem medida recebe: ${f}`, bareImplement?.id, f, H[f], W[f]);
      await expectNoSharing('#6 sem compartilhamento (destino sem medida)', [src.implement.id, bareImplement?.id]);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n#7 módulo /implement-measure — criar, substituir, foto, atribuir, PUT /:id, DELETE /:id');
    // ═════════════════════════════════════════════════════════════════════
    {
      const { implement } = await mkTaskWithImplement();
      const first: Record<string, string> = {};
      for (const f of FACES_T) {
        const upload = f === 'back' ? mkUpload(`modulo-${f}`) : undefined;
        const data = medida(H[f], W[f], f === 'back' ? undefined : photos[f].id);
        await measures.createOrUpdateImplementMeasure(implement.id, f, data, user.id, upload, undefined, true);
        const row = await expectFace(`#7 criar ${f}`, implement.id, f, H[f], W[f]);
        first[f] = row?.id;
        if (f === 'back') {
          const file = row?.photoId ? await prisma.file.findUnique({ where: { id: row.photoId }, select: { originalName: true } }) : null;
          check('#7 foto back por multipart (`photo`)', file?.originalName === `${NAME_PREFIX}-modulo-back.png`, JSON.stringify(file));
        } else {
          check(`#7 foto ${f} por \`photoId\``, row?.photoId === photos[f].id);
        }
      }
      for (const f of FACES_T) {
        await measures.createOrUpdateImplementMeasure(implement.id, f, medida(H2[f], W2[f]), user.id, undefined, undefined, true);
        const row = await expectFace(`#7 substituir ${f}`, implement.id, f, H2[f], W2[f]);
        check(`#7 ${f}: linha nova e a anterior (sem outro uso) removida`, row?.id !== first[f] && !(await measureExists(first[f])));
      }
      await expectNoSharing('#7 sem compartilhamento', [implement.id]);

      console.log('  — atribuir (POST /:id/assign-to-implement)');
      const other = await mkTaskWithImplement();
      for (const f of FACES_T) {
        const used = await faceRow(implement.id, f);
        await measures.assignImplementMeasureToImplement(other.implement.id, f, used.id, user.id);
        const row = await expectFace(`#7 atribuir ${f} de outra face`, other.implement.id, f, H2[f], W2[f]);
        check(`#7 atribuir ${f}: linha em uso ⇒ CÓPIA, não a mesma`, row?.id !== used.id);
      }
      const library = await measures.create(medida(1.9, [2.0, 0.5]), user.id);
      await measures.assignImplementMeasureToImplement(other.implement.id, 'left', library.id, user.id);
      check('#7 atribuir uma linha SEM uso (biblioteca): a face passa a apontá-la', (await faceRow(other.implement.id, 'left'))?.id === library.id);
      await expectNoSharing('#7 sem compartilhamento depois de atribuir', [implement.id, other.implement.id]);

      console.log('  — PUT /implement-measure/:id numa linha compartilhada (legado)');
      for (const f of FACES_T) {
        const { a, b, legacyId } = await mkSharedPair(f);
        await measures.update(legacyId, { height: 2.9, sections: medida(2.9, [7.1]).sections } as any, user.id);
        const rowA = await expectFace(`#7 PUT ${f}: A com o valor novo`, a.implement.id, f, 2.9, [7.1]);
        const rowB = await expectFace(`#7 PUT ${f}: B com o valor novo (a edição pelo id vale para quem usava)`, b.implement.id, f, 2.9, [7.1]);
        check(`#7 PUT ${f}: cada um com a SUA linha depois`, rowA?.id !== rowB?.id);
        await expectNoSharing(`#7 PUT ${f}: nada compartilhado depois`, [a.implement.id, b.implement.id]);
      }

      console.log('  — DELETE /implement-measure/:id');
      const orphan = await measures.create(medida(1.2, [1.0]), user.id);
      await measures.delete(orphan.id, user.id);
      check('#7 DELETE de linha sem uso: sai', !(await measureExists(orphan.id)));
      const pinned = await measures.create(medida(1.2, [1.0]), user.id);
      const analysis = await prisma.paintingAnalysis.create({ data: { name: `${NAME_PREFIX}-analise-2`, implementMeasureId: pinned.id } });
      createdAnalysisIds.push(analysis.id);
      let refused = false;
      try {
        await measures.delete(pinned.id, user.id);
      } catch {
        refused = true;
      }
      check('#7 DELETE de linha apontada por PaintingAnalysis: recusado, a linha fica', refused && (await measureExists(pinned.id)));
      let refusedInUse = false;
      try {
        await measures.delete((await faceRow(implement.id, 'left')).id, user.id);
      } catch {
        refusedInUse = true;
      }
      check('#7 DELETE de linha em uso: recusado (como sempre)', refusedInUse);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n#8 portal: identificação do veículo — criar, atualizar, apagar (cm → m)');
    // ═════════════════════════════════════════════════════════════════════
    {
      const readTask = (id: string) =>
        prisma.task.findUnique({
          where: { id },
          select: {
            id: true,
            forecastDate: true,
            implement: {
              select: {
                id: true,
                serialNumber: true,
                plate: true,
                chassisNumber: true,
                category: true,
                type: true,
                leftSideMeasureId: true,
                rightSideMeasureId: true,
                backSideMeasureId: true,
                vinPlateId: true,
              },
            },
          },
        });
      const gravar = async (id: string, medidas: any) =>
        identity['gravar'](await readTask(id), { medidas }, null, responsible.id);

      const { task, implement } = await mkTaskWithImplement();
      await gravar(task.id, Object.fromEntries(FACES_T.map(f => [PORTAL_KEY[f], medidaCm(H[f], W[f])])));
      const ids: Record<string, string> = {};
      for (const f of FACES_T) ids[f] = (await expectFace(`#8 criar ${f} (cm → m)`, implement.id, f, H[f], W[f]))?.id;
      await gravar(task.id, Object.fromEntries(FACES_T.map(f => [PORTAL_KEY[f], medidaCm(H2[f], W2[f])])));
      for (const f of FACES_T) {
        const row = await expectFace(`#8 atualizar ${f}`, implement.id, f, H2[f], W2[f]);
        check(`#8 ${f}: só dela ⇒ no lugar`, row?.id === ids[f]);
      }
      await expectNoSharing('#8 sem compartilhamento', [implement.id]);
      await gravar(task.id, Object.fromEntries(FACES_T.map(f => [PORTAL_KEY[f], null])));
      for (const f of FACES_T) {
        check(`#8 apagar ${f}: face vazia e linha removida`, !(await faceRow(implement.id, f)) && !(await measureExists(ids[f])));
      }

      console.log('  — o caso que corrompia: o cliente corrige o próprio furgão');
      for (const f of FACES_T) {
        const { a, b, legacyId } = await mkSharedPair(f);
        await gravar(a.task.id, { [PORTAL_KEY[f]]: medidaCm(H[f], W[f]) });
        await expectFace(`#8 ${f}: A corrigido pelo portal`, a.implement.id, f, H[f], W[f]);
        await expectBUntouched(`#8 ${f}: B (outro cliente) intacto`, b.implement.id, f, legacyId);
        await expectNoSharing(`#8 ${f}: nada compartilhado depois`, [a.implement.id, b.implement.id]);
        // Apagar a face compartilhada: sem `.catch` na transação, e B continua com a dele.
        const c = await mkTaskWithImplement();
        await prisma.implement.update({ where: { id: c.implement.id }, data: { [FK[f]]: legacyId } });
        await gravar(c.task.id, { [PORTAL_KEY[f]]: null });
        check(`#8 ${f}: apagar a face compartilhada só desconecta (a transação não aborta)`, !(await faceRow(c.implement.id, f)) && (await measureExists(legacyId)));
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n#9 portal: requisição — criar as 3 faces no veículo novo (cm → m)');
    // ═════════════════════════════════════════════════════════════════════
    let quoteId = '';
    {
      const max = await prisma.budget.aggregate({ _max: { budgetNumber: true } });
      const quote = await prisma.budget.create({
        data: {
          budgetNumber: (max._max.budgetNumber ?? 0) + 100000 + Math.floor(Math.random() * 1000),
          subtotal: 0,
          total: 0,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      createdQuoteIds.push(quote.id);
      quoteId = quote.id;
      const criado = await prisma.$transaction((tx: any) =>
        request['criarVeiculo'](tx, {
          indice: 0,
          veiculo: {
            serialNumber: nextSerial(),
            medidas: Object.fromEntries(FACES_T.map(f => [PORTAL_KEY[f], medidaCm(H[f], W[f])])),
          },
          budgetId: quote.id,
          customerId: customer.id,
          customerName: customer.fantasyName,
          paintId: null,
          responsibleId: responsible.id,
        }),
      );
      createdTaskIds.push(criado.taskId);
      for (const f of FACES_T) {
        const row = await expectFace(`#9 criar ${f} (cm → m)`, criado.implementId, f, H[f], W[f]);
        check(`#9 ${f}: o id devolvido é o da face`, criado.measureIds[PORTAL_KEY[f]] === row?.id);
      }
      await expectNoSharing('#9 sem compartilhamento', [criado.implementId]);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n#10 réplica aos irmãos do orçamento — criar, atualizar, foto; apagar NÃO replica');
    // ═════════════════════════════════════════════════════════════════════
    {
      const a = await mkTaskWithImplement(quoteId);
      const b = await mkTaskWithImplement(quoteId);
      // B já tinha uma medida própria: a réplica a troca e a antiga sai.
      await writer.setFace(prisma, b.implement.id, 'left', medida(1.0, [1.0]));
      const oldB = (await faceRow(b.implement.id, 'left'))?.id;
      for (const f of FACES_T) {
        await measures.createOrUpdateImplementMeasure(a.implement.id, f, medida(H[f], W[f], photos[f].id), user.id, undefined, undefined, true);
        const rowB = await expectFace(`#10 criar ${f}: o irmão recebe (metros, ordem, foto)`, b.implement.id, f, H[f], W[f], photos[f].id);
        const rowA = await faceRow(a.implement.id, f);
        check(`#10 ${f}: por CÓPIA (outra linha)`, rowA?.id !== rowB?.id);
      }
      check('#10 a medida anterior do irmão (sem outro uso) saiu', !(await measureExists(oldB)));
      for (const f of FACES_T) {
        await tasks.update(a.task.id, parse(taskUpdateSchema, { implement: { [REL[f]]: medida(H2[f], W2[f], photos[`${f}2`].id) } }), undefined, user.id, 'ADMIN');
        await expectFace(`#10 atualizar + foto ${f} pela tarefa: o irmão acompanha`, b.implement.id, f, H2[f], W2[f], photos[`${f}2`].id);
      }
      await expectNoSharing('#10 sem compartilhamento entre os irmãos', [a.implement.id, b.implement.id]);
      await tasks.update(a.task.id, parse(taskUpdateSchema, { implement: { backSideMeasure: null } }), undefined, user.id, 'ADMIN');
      check('#10 apagar em A NÃO apaga no irmão', !(await faceRow(a.implement.id, 'back')) && !!(await faceRow(b.implement.id, 'back')));

      // Irmão novo, sem nenhuma medida: o implemento existe (DD1), então o
      // módulo E a tarefa replicam para ele (não há mais "irmão sem caminhão").
      const c = await mkTask(quoteId);
      await measures.createOrUpdateImplementMeasure(a.implement.id, 'right', medida(H.right, W.right), user.id, undefined, undefined, true);
      await expectFace('#10 pelo módulo, o irmão sem medida recebe', (await implementOfTask(c.id))?.id, 'right', H.right, W.right);
      await tasks.update(a.task.id, parse(taskUpdateSchema, { implement: { rightSideMeasure: medida(H2.right, W2.right) } }), undefined, user.id, 'ADMIN');
      const cImplement = await implementOfTask(c.id);
      await expectFace('#10 pela tarefa, o irmão acompanha', cImplement?.id, 'right', H2.right, W2.right);
      await expectNoSharing('#10 sem compartilhamento (3 irmãos)', [a.implement.id, b.implement.id, cImplement?.id]);
    }

    console.log('\nO ESCRITOR direto — `setFace` em modo `patch` com a linha usada pela OUTRA face do mesmo caminhão');
    {
      const { implement } = await mkTaskWithImplement();
      const row = await prisma.implementMeasure.create({
        data: { height: 2.0, sections: { create: [{ width: 3, isDoor: false, position: 0 }] } },
      });
      await prisma.implement.update({ where: { id: implement.id }, data: { leftSideMeasureId: row.id, rightSideMeasureId: row.id } });
      const r = await prisma.$transaction((tx: any) => writer.setFace(tx, implement.id, 'left', { height: 2.2 }));
      check('mesma linha em duas faces do MESMO caminhão também é compartilhamento ⇒ copia', r.action === 'forked');
      await expectFace('a face editada muda (seções herdadas)', implement.id, 'left', 2.2, [3]);
      await expectFace('a outra face não muda', implement.id, 'right', 2.0, [3]);
      await expectNoSharing('nada compartilhado depois', [implement.id]);
    }
  } finally {
    try {
      const implementList = await prisma.implement.findMany({
        where: { taskId: { in: createdTaskIds } },
        select: { id: true, leftSideMeasureId: true, rightSideMeasureId: true, backSideMeasureId: true },
      });
      const implementIds = implementList.map((t: any) => t.id);
      // As linhas desta rodada: as das faces dos caminhões do teste, e as criadas
      // desde o início que nenhum OUTRO caminhão usa (biblioteca, legado, órfãs).
      const faceIds = implementList
        .flatMap((t: any) => [t.leftSideMeasureId, t.rightSideMeasureId, t.backSideMeasureId])
        .filter(Boolean);
      const recent = await prisma.implementMeasure.findMany({
        where: { createdAt: { gte: startedAt } },
        select: { id: true },
      });
      const measureIds: string[] = [];
      for (const m of [...new Set([...faceIds, ...recent.map((r: any) => r.id)])]) {
        const outside = await prisma.implement.count({
          where: {
            id: { notIn: implementIds },
            OR: [{ leftSideMeasureId: m }, { rightSideMeasureId: m }, { backSideMeasureId: m }],
          },
        });
        if (outside === 0) measureIds.push(m as string);
      }
      await prisma.paintingAnalysis.deleteMany({ where: { id: { in: createdAnalysisIds } } });
      if (createdQuoteIds.length) {
        await prisma.task.updateMany({ where: { id: { in: createdTaskIds } }, data: { quoteId: null } });
        await prisma.budget.deleteMany({ where: { id: { in: createdQuoteIds } } });
      }
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      if (measureIds.length) {
        await prisma.implementMeasure.deleteMany({ where: { id: { in: measureIds } } });
      }
      const fileIds = (
        await prisma.file.findMany({
          where: { originalName: { startsWith: NAME_PREFIX } },
          select: { id: true },
        })
      ).map((f: any) => f.id);
      await prisma.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_referenced_file_delete = 'on'`);
        await tx.file.deleteMany({ where: { id: { in: fileIds } } });
      });
      await prisma.changeLog.deleteMany({
        where: {
          entityId: {
            in: [...createdTaskIds, ...createdQuoteIds, ...implementIds, ...measureIds, ...fileIds, ...createdAnalysisIds],
          },
        },
      });
      // A trilha das linhas que os escritores apagaram no caminho (copy-on-write,
      // substituir, apagar): a entidade não existe mais.
      await prisma.$executeRawUnsafe(
        `DELETE FROM "ChangeLog" c WHERE c."createdAt" >= $1 AND c."entityType" = 'IMPLEMENT_MEASURE'
           AND NOT EXISTS (SELECT 1 FROM "ImplementMeasure" m WHERE m.id = c."entityId")`,
        startedAt,
      );
    } catch (e) {
      console.log(
        `  ⚠️  limpeza falhou (${(e as Error)?.message}); sobraram tarefas ${createdTaskIds.join(', ')}`,
      );
    }
    await app.close().catch(() => {});
  }
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? `\n✅ G15 escritor × face: ${passes} verificações passaram.\n`
        : `\n❌ ${failures} verificação(ões) falharam (${passes} passaram).\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ O teste estourou:', err?.stack ?? err);
    process.exit(1);
  });
