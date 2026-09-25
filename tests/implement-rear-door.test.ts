/**
 * A FRENTE E A PORTA TRASEIRA DO IMPLEMENTO (P11b) — G12 e a porta, de ponta a ponta.
 *
 *   G12  face desconhecida nas rotas de medida é 400 nomeado, nunca o 500 do
 *        escritor (`side` validado em runtime; o lote é estrito).
 *   —    porta traseira (DD4): varões 2|3|4 no total, portinholas 0..6, folhas
 *        bipartida/tripartida. Fora da faixa: 400 no zod (tarefa e
 *        `PUT /implements/:id`) e CHECK no banco (escrita por fora).
 *   —    a porta grava pela tarefa e pelo `PUT /implements/:id`, deixa trilha no
 *        IMPLEMENT, dispara `task.field.implement.rearDoor*` e se desfaz pelo
 *        histórico; o aviso diz "Bipartida", não `BIPARTITE`.
 *   —    o projeto do implemento (`PUT /implements/:id/project-files`): a lista
 *        inteira que fica, trilha, arquivo inexistente → 400, lista vazia tira
 *        todos, e o arquivo em uso não se apaga (G10).
 *
 * Contra o banco de `DATABASE_URL` (o da Fase B, com as migrations: os CHECKs só
 * existem nele). O despacho de avisos é INTERCEPTADO (nada sai), e o que o teste
 * cria é apagado no fim.
 *
 *   source .git/implemento-env.sh && npm run test:implement-rear-door
 */

process.env.TZ = 'America/Sao_Paulo';

import { mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const SUFFIX = Date.now().toString().slice(-6);
const NAME_PREFIX = `zz-porta-${SUFFIX}`;
const TMP = resolve(join(tmpdir(), `porta-${SUFFIX}`));
mkdirSync(join(TMP, 'files'), { recursive: true });
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

async function statusOf(fn: () => unknown): Promise<{ status: number; message: string }> {
  try {
    await fn();
    return { status: 200, message: '' };
  } catch (e: any) {
    const status = typeof e?.getStatus === 'function' ? e.getStatus() : 500;
    const resp = typeof e?.getResponse === 'function' ? e.getResponse() : null;
    return { status, message: JSON.stringify((resp as any)?.message ?? resp ?? e?.message ?? String(e)) };
  }
}

async function main() {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { ZodParamValidationPipe } = require('../src/modules/common/pipes/zod-validation.pipe');
  const {
    implementFaceSchema,
    implementMeasureBatchSchema,
    implementMeasureAssignSchema,
  } = require('../src/schemas/implement-measure');
  const { taskUpdateSchema } = require('../src/schemas/task');
  const { implementUpdateSchema } = require('../src/schemas/implement');
  /* eslint-enable @typescript-eslint/no-var-requires */

  console.log('\nG12 — a face nas rotas de medida');
  {
    const fonte = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/production/implement-measure/implement-measure.controller.ts'),
      'utf8',
    );
    check(
      "a rota valida `:side` com o pipe de PARÂMETRO (o de corpo pula `param`)",
      /@Param\('side', new ZodParamValidationPipe\(implementFaceSchema\)\)/.test(fonte),
    );
    // O MESMO pipe que a rota usa (`ZodValidationPipe` pula `param`: com ele a
    // face inválida passava e virava 500 no escritor).
    const pipe = new ZodParamValidationPipe(implementFaceSchema);
    const meta = { type: 'param' as const, metatype: String, data: 'side' };
    for (const bad of ['rear', 'FRONT', '', 'frente', 'batch']) {
      const r = await statusOf(() => pipe.transform(bad, meta));
      check(`side "${bad}" → 400 nomeado`, r.status === 400 && /Face inválida/.test(r.message), `${r.status} ${r.message}`);
    }
    for (const good of ['left', 'right', 'back', 'front']) {
      const r = await statusOf(() => pipe.transform(good, meta));
      check(`side "${good}" passa`, r.status === 200, r.message);
    }
    const lote = implementMeasureBatchSchema.safeParse({
      rear: { height: 2.4, sections: [{ width: 2.4, isDoor: false, doorHeight: null, position: 0 }] },
    });
    check('lote com face desconhecida ("rear") → recusado (estrito)', !lote.success);
    const loteFrente = implementMeasureBatchSchema.safeParse({
      front: { height: 2.4, sections: [{ width: 2.4, isDoor: false, doorHeight: null, position: 0 }] },
    });
    check('lote com a frente passa', loteFrente.success, JSON.stringify(loteFrente.error?.issues));
    const atribuir = implementMeasureAssignSchema.safeParse({ implementId: 'x', side: 'front' });
    check('atribuir com implementId que não é UUID → recusado', !atribuir.success);
  }

  console.log('\nPorta traseira — as faixas no zod (tarefa e PUT /implements)');
  {
    const casos: Array<[string, Record<string, unknown>, boolean]> = [
      ['varões 2', { rearDoorBarCount: 2 }, true],
      ['varões 4', { rearDoorBarCount: 4 }, true],
      ['varões 5', { rearDoorBarCount: 5 }, false],
      ['varões 1', { rearDoorBarCount: 1 }, false],
      ['varões 2,5', { rearDoorBarCount: 2.5 }, false],
      ['portinholas 0', { rearDoorHatchCount: 0 }, true],
      ['portinholas 6', { rearDoorHatchCount: 6 }, true],
      ['portinholas 7', { rearDoorHatchCount: 7 }, false],
      ['portinholas -1', { rearDoorHatchCount: -1 }, false],
      ['bipartida', { rearDoorLeaves: 'BIPARTITE' }, true],
      ['tripartida', { rearDoorLeaves: 'TRIPARTITE' }, true],
      ['quadripartida', { rearDoorLeaves: 'QUADRIPARTITE' }, false],
      ['apagar (null)', { rearDoorLeaves: null, rearDoorBarCount: null, rearDoorHatchCount: null }, true],
    ];
    for (const [rotulo, porta, ok] of casos) {
      const naTarefa = taskUpdateSchema.safeParse({ implement: porta }).success;
      const noImplemento = implementUpdateSchema.safeParse(porta).success;
      check(`${rotulo}: ${ok ? 'aceita' : 'recusada'} nos dois corpos`, naTarefa === ok && noImplemento === ok, `tarefa=${naTarefa} implemento=${noImplemento}`);
    }
  }

  /* eslint-disable @typescript-eslint/no-var-requires */
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../src/app.module');
  const { PrismaService } = require('../src/modules/common/prisma/prisma.service');
  const { TaskService } = require('../src/modules/production/task/task.service');
  const { ImplementService } = require('../src/modules/production/implement/implement.service');
  const {
    NotificationDispatchService,
  } = require('../src/modules/common/notification/notification-dispatch.service');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const tasks = app.get(TaskService);
  const implementos = app.get(ImplementService);
  const dispatch = app.get(NotificationDispatchService);

  const despachos: Array<{ key: string; data: any }> = [];
  dispatch.dispatchByConfiguration = async (key: string, _u: string, ctx: any) => {
    despachos.push({ key, data: ctx?.data ?? {} });
  };
  dispatch.dispatchByConfigurationToUsers = async (key: string, _u: string, ctx: any) => {
    despachos.push({ key, data: ctx?.data ?? {} });
  };
  const esperaDespacho = async (pred: (d: { key: string; data: any }) => boolean) => {
    for (let i = 0; i < 60; i++) {
      const hit = despachos.find(pred);
      if (hit) return hit;
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  };

  const createdTaskIds: string[] = [];
  const createdFileIds: string[] = [];
  try {
    const customer = await prisma.customer.findFirst({ select: { id: true } });
    const user = await prisma.user.findFirst({ where: { sector: { privileges: 'ADMIN' } }, select: { id: true } });
    if (!customer || !user) {
      check('banco com cliente e usuário ADMIN', false);
      return;
    }
    const t = await prisma.task.create({
      data: { name: `${NAME_PREFIX}-1`, customerId: customer.id, implement: { create: { spot: null } } },
      select: { id: true, implement: { select: { id: true } } },
    });
    createdTaskIds.push(t.id);
    const implementId = t.implement!.id;
    const porta = () =>
      prisma.implement.findUnique({
        where: { id: implementId },
        select: { rearDoorLeaves: true, rearDoorBarCount: true, rearDoorHatchCount: true },
      });

    console.log('\nO banco é a rede (escrita por fora do zod)');
    for (const [rotulo, data] of [
      ['varões 5', { rearDoorBarCount: 5 }],
      ['portinholas 7', { rearDoorHatchCount: 7 }],
    ] as Array<[string, Record<string, number>]>) {
      let code = '';
      try {
        await prisma.implement.update({ where: { id: implementId }, data });
      } catch (e: any) {
        code = String(e?.meta?.code ?? e?.code ?? e?.message);
      }
      check(`${rotulo} direto no Prisma → CHECK recusa (23514)`, /23514|check/i.test(code), code.slice(0, 120));
    }

    console.log('\nPela tarefa (PUT /tasks/:id)');
    {
      despachos.length = 0;
      await tasks.update(
        t.id,
        taskUpdateSchema.parse({ implement: { rearDoorLeaves: 'BIPARTITE', rearDoorBarCount: 3, rearDoorHatchCount: 2 } }),
        undefined,
        user.id,
        'ADMIN',
      );
      const p = await porta();
      check('a porta gravou no implemento', p?.rearDoorLeaves === 'BIPARTITE' && p?.rearDoorBarCount === 3 && p?.rearDoorHatchCount === 2, JSON.stringify(p));
      const trilha = await prisma.changeLog.findMany({
        where: { entityType: 'IMPLEMENT', entityId: implementId, field: { in: ['rearDoorLeaves', 'rearDoorBarCount', 'rearDoorHatchCount'] } },
        select: { field: true, newValue: true },
      });
      check('trilha IMPLEMENT das três colunas', new Set(trilha.map((l: any) => l.field)).size === 3, JSON.stringify(trilha));
      const aviso = await esperaDespacho(d => d.key === 'task.field.implement.rearDoorLeaves' && d.data?.taskId === t.id);
      check('dispara `task.field.implement.rearDoorLeaves`', !!aviso, JSON.stringify(despachos.map(d => d.key)));
      const bar = await esperaDespacho(d => d.key === 'task.field.implement.rearDoorBarCount' && d.data?.taskId === t.id);
      check('dispara `task.field.implement.rearDoorBarCount` com o número', bar?.data?.newValue === 3, JSON.stringify(bar?.data));
      const traduzido = (dispatch as any).normalizeEnumLabels('Task', {
        fieldName: 'implement.rearDoorLeaves',
        oldValue: null,
        newValue: 'BIPARTITE',
      });
      check('o aviso diz "Bipartida", não `BIPARTITE`', traduzido.newValue === 'Bipartida', JSON.stringify(traduzido));
      const semMexer = await statusOf(() =>
        tasks.update(t.id, taskUpdateSchema.parse({ implement: { rearDoorBarCount: 4 } }), undefined, user.id, 'ADMIN'),
      );
      const p2 = await porta();
      check('só o campo enviado muda (ausente não mexe)', semMexer.status === 200 && p2?.rearDoorLeaves === 'BIPARTITE' && p2?.rearDoorBarCount === 4, JSON.stringify(p2));
    }

    console.log('\nPelo implemento (PUT /implements/:id) e desfeito pelo histórico');
    {
      despachos.length = 0;
      await implementos.update(implementId, implementUpdateSchema.parse({ rearDoorLeaves: 'TRIPARTITE', rearDoorHatchCount: 0 }), undefined, user.id);
      const p = await porta();
      check('a porta gravou pelo implemento', p?.rearDoorLeaves === 'TRIPARTITE' && p?.rearDoorHatchCount === 0, JSON.stringify(p));
      const aviso = await esperaDespacho(d => d.key === 'task.field.implement.rearDoorLeaves' && d.data?.taskId === t.id);
      check('o PUT /implements também avisa', !!aviso, JSON.stringify(despachos.map(d => d.key)));
      const log = await prisma.changeLog.findFirst({
        where: { entityType: 'IMPLEMENT', entityId: implementId, field: 'rearDoorLeaves' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, oldValue: true, newValue: true },
      });
      check('trilha BIPARTITE → TRIPARTITE', log?.oldValue === 'BIPARTITE' && log?.newValue === 'TRIPARTITE', JSON.stringify(log));
      await tasks.rollbackFieldChange(log!.id, user.id);
      check('desfazer volta a bipartida', (await porta())?.rearDoorLeaves === 'BIPARTITE');
      const apagar = await statusOf(() =>
        implementos.update(implementId, implementUpdateSchema.parse({ rearDoorLeaves: null, rearDoorBarCount: null, rearDoorHatchCount: null }), undefined, user.id),
      );
      const p3 = await porta();
      check('null apaga as três', apagar.status === 200 && p3?.rearDoorLeaves === null && p3?.rearDoorBarCount === null && p3?.rearDoorHatchCount === null, JSON.stringify(p3));
    }

    console.log('\nO projeto do implemento (PUT /implements/:id/project-files)');
    {
      const pdf = await prisma.file.create({
        data: {
          filename: `${NAME_PREFIX}.pdf`,
          originalName: `${NAME_PREFIX} PROJETO.pdf`,
          mimetype: 'application/pdf',
          path: join(TMP, 'projeto.pdf'),
          size: 10,
        },
      });
      createdFileIds.push(pdf.id);
      const r = await implementos.setProjectFiles(implementId, [pdf.id], [], user.id);
      check('o projeto aponta o PDF', r.projectFiles?.length === 1 && r.projectFiles[0].id === pdf.id);
      const log = await prisma.changeLog.findFirst({
        where: { entityType: 'IMPLEMENT', entityId: implementId, field: 'projectFiles' },
        orderBy: { createdAt: 'desc' },
        select: { oldValue: true, newValue: true },
      });
      // o `ChangeLogService` grava lista como TEXTO JSON (a convenção da trilha)
      const lido = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
      check(
        'trilha IMPLEMENT/projectFiles (antes [], depois o PDF)',
        JSON.stringify(lido(log?.oldValue)) === '[]' && JSON.stringify(lido(log?.newValue)) === JSON.stringify([pdf.id]),
        JSON.stringify(log),
      );
      let bloqueado = false;
      try {
        await prisma.file.delete({ where: { id: pdf.id } });
      } catch {
        bloqueado = true;
      }
      check('o PDF em uso no projeto não se apaga (a referência protege, G10)', bloqueado);
      const inexistente = await statusOf(() =>
        implementos.setProjectFiles(implementId, ['00000000-0000-4000-8000-000000000000'], [], user.id),
      );
      check('arquivo que não existe → 400', inexistente.status === 400, `${inexistente.status} ${inexistente.message}`);
      await implementos.setProjectFiles(implementId, [], [], user.id);
      const vazio = await prisma.implement.findUnique({ where: { id: implementId }, select: { projectFiles: { select: { id: true } } } });
      check('lista vazia tira todos', vazio?.projectFiles.length === 0);
    }
  } finally {
    try {
      if (createdFileIds.length) {
        await prisma.$transaction(async (tx: any) => {
          await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_referenced_file_delete = 'on'`);
          await tx.file.deleteMany({ where: { id: { in: createdFileIds } } });
        });
      }
      const implementIds = (
        await prisma.implement.findMany({ where: { taskId: { in: createdTaskIds } }, select: { id: true } })
      ).map((i: any) => i.id);
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      await prisma.changeLog.deleteMany({ where: { entityId: { in: [...createdTaskIds, ...implementIds] } } });
    } catch (e) {
      console.log(`  ⚠️  limpeza falhou (${(e as Error)?.message}); procure tarefas "${NAME_PREFIX}*"`);
    }
    await app.close().catch(() => {});
  }
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? `\n✅ frente e porta traseira: ${passes} verificações passaram.\n`
        : `\n❌ ${failures} verificação(ões) falharam (${passes} passaram).\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ O teste estourou:', err?.stack ?? err);
    process.exit(1);
  });
