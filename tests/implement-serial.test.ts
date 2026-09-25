/**
 * A SÉRIE SÓ NO IMPLEMENTO — G19, G20, G22, G23, G32 e a busca de tinta.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO IMPEDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A série mora em `Implement.serialNumber` e em nenhum outro lugar
 * (NOMENCLATURA.md §5; a M5s derrubou `Task.serialNumber`). Os modos de falhar:
 *
 *   G19 um ESCRITOR esquecido (W1–W6) grava em lugar nenhum e responde 200, ou a
 *       trilha `TASK/serialNumber` (S-5, lida pelo aditivo da assinatura) some;
 *       reverter uma série para uma que outro veículo já usa vira 500 (P2002).
 *   G20 um caminho de criação (C1–C5) deixa a tarefa sem implemento ou com
 *       `spot` preenchido; o gatilho diferido da M1s é a rede, e a fonte não pode
 *       ter `task.create` sem `implement`.
 *   G22 o contexto do aviso (`task.created`, `task.field.serialNumber`) sai sem a
 *       série e o `{{#if serialNumber}}` do modelo esconde a ausência.
 *   G23 o corpo que o app manda hoje (série DENTRO de `implement`, criar,
 *       criar com orçamento e editar) não grava; a série no TOPO passa calada.
 *   G32 a URL EXATA da Agenda do app (`orderBy[2].implement.serialNumber…`) dá
 *       500 ou não ordena; a URL do app antigo dá 500 em vez de 400 nomeado.
 *   —   a busca de tinta (SQL cru) deixa de achar por série ou por placa.
 *
 * Contra o banco de `DATABASE_URL` (o da Fase B, com as migrations: o gatilho
 * diferido só existe nele) e pelos serviços que as rotas chamam, com o corpo
 * passando pelo zod antes. O despacho de avisos é INTERCEPTADO (nada sai), e
 * tudo o que o teste cria é apagado no fim (`finally`).
 *
 *   source .git/implemento-env.sh && npm run test:implement-serial
 */

process.env.TZ = 'America/Sao_Paulo';

import { mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import { tmpdir } from 'os';
import * as ts from 'typescript';

const SUFFIX = Date.now().toString().slice(-6);
const NAME_PREFIX = `zz-serie-${SUFFIX}`;
const TMP = resolve(join(tmpdir(), `serie-${SUFFIX}`));
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

async function statusOf(fn: () => Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await fn();
    return { status: 200, message: '' };
  } catch (e: any) {
    const status = typeof e?.getStatus === 'function' ? e.getStatus() : 500;
    const resp = typeof e?.getResponse === 'function' ? e.getResponse() : null;
    const message = String((resp as any)?.message ?? e?.message ?? e);
    return { status, message };
  }
}

// ─── A fonte: toda criação de tarefa leva implemento (G20, C6/C7) ──────────
//
// `X.task.create({ data })` sem `implement` no objeto de dados só falha no
// COMMIT (gatilho diferido) — num script de madrugada, ou num teste que ninguém
// roda. `task.createMany` não aceita relação aninhada: é sempre sem implemento.
function scanTaskCreates(root: string): string[] {
  const achados: string[] = [];
  for (const file of listSources(root, ['src', 'scripts', 'tests', 'prisma'])) {
    const text = readFileSync(file, 'utf8');
    if (!/\.task\s*\.\s*create(Many)?\s*\(/.test(text)) continue;
    achados.push(...scanTaskCreateSource(relative(root, file), text));
  }
  return achados;
}

function scanTaskCreateSource(name: string, text: string): string[] {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ['create', 'createMany'].includes(n.expression.name.text) &&
      ts.isPropertyAccessExpression(n.expression.expression) &&
      n.expression.expression.name.text === 'task'
    ) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      if (n.expression.name.text === 'createMany') {
        out.push(`${name}:${line} task.createMany (sem implemento)`);
      } else {
        const arg = n.arguments[0];
        const data =
          arg && ts.isObjectLiteralExpression(arg)
            ? arg.properties.find(
                p => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'data',
              )
            : undefined;
        const dataObj =
          data && ts.isPropertyAssignment(data) && ts.isObjectLiteralExpression(data.initializer)
            ? data.initializer
            : null;
        // Objeto montado fora (`data: taskData`): o mapeador do repositório
        // (W1) é quem põe `implement` — a asserção dele é o C1/C3 abaixo.
        if (dataObj) {
          const temImplement = dataObj.properties.some(
            p =>
              (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
              p.name.getText(sf) === 'implement',
          );
          const espalha = dataObj.properties.some(p => ts.isSpreadAssignment(p));
          if (!temImplement && !espalha) out.push(`${name}:${line} task.create sem implement`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// ─── G24: ninguém lê a série pela tarefa ───────────────────────────────────
//
// Com a coluna fora do Prisma, o `tsc` pega toda leitura TIPADA. Sobram as que
// ele não vê: `(x as any).serialNumber` e o SQL cru que lê `"Task"."serialNumber"`
// (ou um apelido de "Task"). Leitura de DTO (`vehicles[].serialNumber`, o
// `task.serialNumber` do DTO da NFS-e) é tipada e não passa por aqui.
function scanSerialReadsSource(name: string, text: string): string[] {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const linha = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const semTipo = (e: ts.Expression): boolean => {
    let x: ts.Expression = e;
    while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
    return ts.isAsExpression(x) && x.type.kind === ts.SyntaxKind.AnyKeyword;
  };
  const sqlDaTarefa = (sql: string): boolean => {
    if (/"Task"\s*\.\s*"serialNumber(Normalized)?"/.test(sql)) return true;
    const apelidos = [...sql.matchAll(/"Task"\s+(?:AS\s+)?([a-z_][a-z0-9_]*)/gi)].map(m => m[1]);
    return apelidos.some(a => new RegExp(`\\b${a}\\s*\\.\\s*"serialNumber(Normalized)?"`).test(sql));
  };
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'serialNumber' && semTipo(n.expression)) {
      out.push(`${name}:${linha(n)} leitura sem tipo: ${n.getText(sf)}`);
    }
    if (
      (ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || ts.isStringLiteral(n)) &&
      /serialNumber/.test(n.getText(sf)) &&
      sqlDaTarefa(n.getText(sf))
    ) {
      out.push(`${name}:${linha(n)} SQL lê a série da tarefa`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function listSources(root: string, dirs: string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue; // link quebrado (artefatos de e2e)
      }
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|js|mjs|cjs)$/.test(e) && !/\.d\.ts$/.test(e)) files.push(p);
    }
  };
  dirs.map(d => join(root, d)).forEach(walk);
  return files;
}

async function main() {
  console.log('\nG24 — ninguém lê a série pela tarefa (o que o tsc não vê)');
  {
    const raiz = resolve(__dirname, '..');
    // O ensaio da migração mede o ANTES (a coluna ainda existe no banco de
    // origem até a M5s): é a exceção nomeada de NOMENCLATURA.md §4.
    const EXCECOES = new Set(['scripts/rehearse-implement-migration.ts']);
    const fora = listSources(raiz, ['src', 'scripts', 'prisma'])
      .filter(f => !EXCECOES.has(relative(raiz, f)))
      .flatMap(f => scanSerialReadsSource(relative(raiz, f), readFileSync(f, 'utf8')));
    check('nenhuma leitura sem tipo nem SQL cru da série na tarefa (src/, scripts/, prisma/)', fora.length === 0, fora.join(' | '));
    const canarios: Array<[string, string]> = [
      ['as any', 'const s = (task as any).serialNumber;'],
      ['as any opcional', 'const s = (row as any)?.serialNumber;'],
      ['SQL qualificado', 'prisma.$queryRaw`SELECT "Task"."serialNumber" FROM "Task"`'],
      ['SQL com apelido', 'prisma.$queryRaw`SELECT t."serialNumber" FROM "Task" t WHERE t.id = ${id}`'],
    ];
    const cegos = canarios.filter(([, src]) => scanSerialReadsSource('c.ts', src).length === 0);
    check(`a varredura acusa as ${canarios.length} formas (canários)`, cegos.length === 0, cegos.map(c => c[0]).join(', '));
    const ok = [
      'const s = (task as any).implement?.serialNumber;',
      'prisma.$queryRaw`SELECT i."serialNumber" FROM "Task" t JOIN "Implement" i ON i."taskId" = t.id`',
      'const s = invoice.task.serialNumber;',
    ];
    const falsos = ok.filter(src => scanSerialReadsSource('ok.ts', src).length > 0);
    check('série do implemento (tipada, sem tipo ou no SQL) e DTO tipado não são acusados', falsos.length === 0, falsos.join(' | '));
  }

  console.log('\nA FONTE — toda criação de tarefa leva implemento (G20, C6/C7)');
  {
    const fora = scanTaskCreates(resolve(__dirname, '..'));
    check(
      'nenhum `task.create` sem `implement` nem `task.createMany` (src/, scripts/, tests/, prisma/)',
      fora.length === 0,
      fora.join(' | '),
    );
    const canarios: Array<[string, string]> = [
      ['sem implement', 'await prisma.task.create({ data: { name: "x" } })'],
      ['createMany', 'await tx.task.createMany({ data: [{ name: "x" }] })'],
    ];
    const cegos = canarios.filter(([, src]) => scanTaskCreateSource('c.ts', src).length === 0);
    check('a varredura acusa as duas formas (canários)', cegos.length === 0, cegos.map(c => c[0]).join(', '));
    check(
      'com implement, a varredura cala',
      scanTaskCreateSource('ok.ts', 'prisma.task.create({ data: { name: "x", implement: { create: {} } } })')
        .length === 0,
    );
  }

  /* eslint-disable @typescript-eslint/no-var-requires */
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../src/app.module');
  const { PrismaService } = require('../src/modules/common/prisma/prisma.service');
  const { TaskService } = require('../src/modules/production/task/task.service');
  const { PortalIdentityService } = require('../src/modules/people/portal/portal-identity.service');
  const { PortalRequestService } = require('../src/modules/people/portal/portal-request.service');
  const { PaintService } = require('../src/modules/paint/paint.service');
  const {
    NotificationDispatchService,
  } = require('../src/modules/common/notification/notification-dispatch.service');
  const { ZodQueryValidationPipe } = require('../src/modules/common/pipes/zod-validation.pipe');
  const { TASK_QUERY_SHAPE } = require('../src/modules/production/task/task-query-shape');
  const { parseQueryString } = require('../src/common/http/query-string-parser');
  const {
    taskCreateSchema,
    taskUpdateSchema,
    taskBatchCreateSchema,
    taskBatchCreateWithQuoteSchema,
    taskGetManySchema,
  } = require('../src/schemas/task');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const parse = (schema: any, body: unknown) => {
    const r = schema.safeParse(body);
    if (!r.success) throw new Error(`zod recusou: ${JSON.stringify(r.error.issues)}`);
    return r.data;
  };

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const tasks = app.get(TaskService);
  const identity = app.get(PortalIdentityService);
  const request = app.get(PortalRequestService);
  const paints = app.get(PaintService);
  const dispatch = app.get(NotificationDispatchService);

  // Nada sai: o despacho só é GRAVADO para o G22.
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

  const startedAt = new Date(Date.now() - 1000);
  const createdQuoteIds: string[] = [];
  let n = 0;
  let m = 0;
  const serie = () => `S${SUFFIX}${String(++n).padStart(2, '0')}`;
  const nome = () => `${NAME_PREFIX}-${++m}`;
  const doTeste = () =>
    prisma.task.findMany({
      where: { name: { startsWith: NAME_PREFIX } },
      select: { id: true },
    });

  try {
    const customer = await prisma.customer.findFirst({ select: { id: true, fantasyName: true } });
    const user = await prisma.user.findFirst({
      where: { sector: { privileges: 'ADMIN' } },
      select: { id: true },
    });
    const responsible = await prisma.responsible.findFirst({ select: { id: true } });
    const paint = await prisma.paint.findFirst({ select: { id: true } });
    if (!customer || !user || !responsible || !paint) {
      check('banco com cliente, usuário ADMIN, responsável e tinta', false);
      return;
    }

    const implementOf = (taskId: string) =>
      prisma.implement.findUnique({
        where: { taskId },
        select: { id: true, serialNumber: true, spot: true },
      });
    const taskBySerial = async (s: string) =>
      (await prisma.implement.findUnique({ where: { serialNumber: s }, select: { taskId: true } }))
        ?.taskId ?? null;
    const trilha = (taskId: string) =>
      prisma.changeLog.findFirst({
        where: { entityType: 'TASK', entityId: taskId, field: 'serialNumber' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, oldValue: true, newValue: true },
      });
    /** C1–C5: implemento existe, com a série pedida, e `spot` nulo. */
    const nasceuCerto = async (rotulo: string, taskId: string | null, s: string | null) => {
      const imp = taskId ? await implementOf(taskId) : null;
      check(
        `${rotulo}: tarefa nasceu com implemento, série ${s ?? '—'} nele e spot nulo`,
        !!imp && imp.serialNumber === s && imp.spot === null,
        JSON.stringify(imp),
      );
    };

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG19/G20 — W1/C1: POST /tasks com `implement.serialNumber`');
    // ═════════════════════════════════════════════════════════════════════
    const s1 = serie();
    await tasks.create(
      parse(taskCreateSchema, { name: nome(), customerId: customer.id, implement: { serialNumber: s1 } }),
      undefined,
      user.id,
    );
    const t1 = await taskBySerial(s1);
    await nasceuCerto('C1', t1, s1);

    console.log('\nG22 — o aviso de criação leva a série');
    {
      const d = await esperaDespacho(x => x.key === 'task.created' && x.data?.taskId === t1);
      check('task.created: `data.serialNumber` é a série do implemento', d?.data?.serialNumber === s1, JSON.stringify(d?.data));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG19/G20 — W3/C2: faixa de séries');
    // ═════════════════════════════════════════════════════════════════════
    {
      const base = 900_000_000 + Number(SUFFIX) * 10;
      await tasks.create(
        parse(taskCreateSchema, {
          name: nome(),
          customerId: customer.id,
          serialNumberFrom: base,
          serialNumberTo: base + 2,
        }),
        undefined,
        user.id,
      );
      for (const s of [base, base + 1, base + 2].map(String)) await nasceuCerto(`C2 ${s}`, await taskBySerial(s), s);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG19/G20 — W1/C3: POST /tasks/batch');
    // ═════════════════════════════════════════════════════════════════════
    {
      const sa = serie();
      const nomeSem = nome();
      await tasks.batchCreate(
        parse(taskBatchCreateSchema, {
          tasks: [
            { name: nome(), customerId: customer.id, implement: { serialNumber: sa } },
            { name: nomeSem, customerId: customer.id },
          ],
        }),
        undefined,
        user.id,
      );
      await nasceuCerto('C3 com série', await taskBySerial(sa), sa);
      const sem = await prisma.task.findFirst({ where: { name: nomeSem }, select: { id: true } });
      await nasceuCerto('C3 sem nada do implemento', sem?.id ?? null, null);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG23/G20 — C4: o corpo do app (POST /tasks/batch-with-quote)');
    // ═════════════════════════════════════════════════════════════════════
    // A forma de `task_form_screen.dart#_buildPayload`: série DENTRO do implemento,
    // em maiúsculas; o implemento vai mesmo vazio.
    {
      const sApp = serie();
      const nomeVazio = nome();
      const r = await tasks.batchCreateWithQuote(
        parse(taskBatchCreateWithQuoteSchema, {
          tasks: [
            { name: nome(), customerId: customer.id, implement: { serialNumber: sApp } },
            { name: nomeVazio, customerId: customer.id, implement: {} },
          ],
          quote: {
            expiresAt: new Date(Date.now() + 30 * 86_400_000),
            status: 'PENDING',
            subtotal: 10,
            total: 10,
            customerConfigs: [{ customerId: customer.id, subtotal: 10, total: 10 }],
            services: [{ description: 'Logomarca Lateral', amount: 10 }],
          },
        }),
        undefined,
        user.id,
      );
      if (r?.data?.quote?.id) createdQuoteIds.push(r.data.quote.id);
      await nasceuCerto('C4 com série', await taskBySerial(sApp), sApp);
      const vazio = await prisma.task.findFirst({ where: { name: nomeVazio }, select: { id: true } });
      await nasceuCerto('C4 `implement: {}`', vazio?.id ?? null, null);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG23 — a série no TOPO é recusada (não passa calada)');
    // ═════════════════════════════════════════════════════════════════════
    for (const [rotulo, schema, body] of [
      ['POST /tasks', taskCreateSchema, { name: nome(), customerId: customer.id, serialNumber: 'X1' }],
      ['PUT /tasks/:id', taskUpdateSchema, { serialNumber: 'X1' }],
      ['POST /tasks/batch', taskBatchCreateSchema, { tasks: [{ name: nome(), serialNumber: 'X1' }] }],
    ] as Array<[string, any, unknown]>) {
      const r = schema.safeParse(body);
      check(
        `${rotulo} com \`serialNumber\` no topo → recusado pelo zod`,
        !r.success && JSON.stringify(r.error.issues).includes('serialNumber'),
        r.success ? 'passou' : JSON.stringify(r.error.issues).slice(0, 160),
      );
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG19 — W2: PUT /tasks/:id com `implement.serialNumber` (o corpo de edição do app)');
    // ═════════════════════════════════════════════════════════════════════
    const s1b = serie();
    {
      despachos.length = 0;
      await tasks.update(t1!, parse(taskUpdateSchema, { implement: { serialNumber: s1b } }), undefined, user.id, 'ADMIN');
      const imp = await implementOf(t1!);
      check('W2: a série nova está no implemento', imp?.serialNumber === s1b, JSON.stringify(imp));
      const log = await trilha(t1!);
      check(
        'W2: trilha TASK/serialNumber com antes e depois',
        log?.oldValue === s1 && log?.newValue === s1b,
        JSON.stringify(log),
      );
      const d = await esperaDespacho(x => x.key === 'task.field.serialNumber' && x.data?.taskId === t1);
      check(
        'G22: trocar a série dispara `task.field.serialNumber` com a série no contexto',
        d?.data?.serialNumber === s1b && d?.data?.newValue === s1b,
        JSON.stringify(d?.data ?? despachos.map(x => x.key)),
      );
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG19 — unicidade: série de outro veículo → 400 nomeado');
    // ═════════════════════════════════════════════════════════════════════
    const s2 = serie();
    await tasks.create(
      parse(taskCreateSchema, { name: nome(), customerId: customer.id, implement: { serialNumber: s2 } }),
      undefined,
      user.id,
    );
    const t2 = await taskBySerial(s2);
    {
      const r = await statusOf(() =>
        tasks.update(t2!, parse(taskUpdateSchema, { implement: { serialNumber: s1b } }), undefined, user.id, 'ADMIN'),
      );
      check('W2 com série em uso → 400 "Número de série já está em uso."', r.status === 400 && /já está em uso/.test(r.message), `${r.status} ${r.message}`);
      check('e nada muda no implemento', (await implementOf(t2!))?.serialNumber === s2);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG19 — W6: reverter a série pelo histórico');
    // ═════════════════════════════════════════════════════════════════════
    {
      const log = await trilha(t1!);
      await tasks.rollbackFieldChange(log!.id, user.id);
      check('W6: a série volta no implemento', (await implementOf(t1!))?.serialNumber === s1);

      // A série antiga agora é de OUTRO veículo: reverter não pode virar P2002/500.
      const s1c = serie();
      await tasks.update(t1!, parse(taskUpdateSchema, { implement: { serialNumber: s1c } }), undefined, user.id, 'ADMIN');
      const logTroca = await trilha(t1!);
      await tasks.update(t2!, parse(taskUpdateSchema, { implement: { serialNumber: s1 } }), undefined, user.id, 'ADMIN');
      const r = await statusOf(() => tasks.rollbackFieldChange(logTroca!.id, user.id));
      check('W6 para série que outro veículo usa → 400, não 500', r.status === 400, `${r.status} ${r.message}`);
      check('e os dois implementos ficam como estavam', (await implementOf(t1!))?.serialNumber === s1c && (await implementOf(t2!))?.serialNumber === s1);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG19/G20 — W4/C5: portal, veículo novo na requisição');
    // ═════════════════════════════════════════════════════════════════════
    const s5 = serie();
    let t5: string | null = null;
    {
      const max = await prisma.budget.aggregate({ _max: { budgetNumber: true } });
      const quote = await prisma.budget.create({
        data: {
          budgetNumber: (max._max.budgetNumber ?? 0) + 200000 + Math.floor(Math.random() * 1000),
          subtotal: 0,
          total: 0,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      createdQuoteIds.push(quote.id);
      const criado = await prisma.$transaction((tx: any) =>
        request['criarVeiculo'](tx, {
          indice: 0,
          veiculo: { serialNumber: s5 },
          budgetId: quote.id,
          customerId: customer.id,
          customerName: `${NAME_PREFIX}-portal`,
          paintId: null,
          responsibleId: responsible.id,
        }),
      );
      t5 = criado.taskId;
      await prisma.task.update({ where: { id: t5! }, data: { name: `${NAME_PREFIX}-portal` } });
      await nasceuCerto('C5', t5, s5);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG19 — W5: portal, o cliente corrige a série');
    // ═════════════════════════════════════════════════════════════════════
    {
      const readTask = (id: string) =>
        prisma.task.findUnique({
          where: { id },
          select: {
            id: true,
            forecastDate: true,
            customerOrderNumber: true,
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
      const s5b = serie();
      await identity['gravar'](await readTask(t5!), { serialNumber: s5b }, null, responsible.id);
      check('W5: a série nova está no implemento', (await implementOf(t5!))?.serialNumber === s5b);
      const log = await trilha(t5!);
      check('W5: trilha TASK/serialNumber com antes e depois', log?.oldValue === s5 && log?.newValue === s5b, JSON.stringify(log));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG20 — a rede do banco: tarefa sem implemento não chega ao COMMIT');
    // ═════════════════════════════════════════════════════════════════════
    {
      let codigo = '';
      try {
        await prisma.task.create({ data: { name: `${NAME_PREFIX}-sem-implemento`, customerId: customer.id } } as any);
      } catch (e: any) {
        codigo = String(e?.meta?.code ?? e?.code ?? e?.message ?? e);
      }
      check('Prisma `task.create` sem implemento → recusado (23514)', /23514|implemento/i.test(codigo), codigo.slice(0, 160));
      const orfas = await prisma.task.count({ where: { name: { startsWith: NAME_PREFIX }, implement: null } });
      check('nenhuma tarefa deste teste sem implemento', orfas === 0, String(orfas));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG32 — a URL EXATA da Agenda do app');
    // ═════════════════════════════════════════════════════════════════════
    {
      // Uma série nula e duas séries fora de ordem, com o mesmo prazo e o mesmo
      // nome: quem decide é o terceiro critério (a série, nulos por último).
      const agendaNome = `${NAME_PREFIX}-agenda`;
      const forecast = new Date('2031-01-15T12:00:00Z');
      const ids: string[] = [];
      for (const s of [`${s2}Z`, null, `${s2}A`]) {
        const t = await prisma.task.create({
          data: {
            name: agendaNome,
            customerId: customer.id,
            forecastDate: forecast,
            implement: { create: { serialNumber: s, spot: null } },
          },
          select: { id: true },
        });
        ids.push(t.id);
      }
      const pipe = new ZodQueryValidationPipe(taskGetManySchema, TASK_QUERY_SHAPE);
      const meta = { type: 'query' as const, metatype: Object, data: undefined };
      const filtro = `where[name]=${encodeURIComponent(agendaNome)}&include[implement]=true&page=1&limit=40`;
      // task_schedule_view.dart, modo status.
      const agenda =
        'orderBy[0].forecastDate.sort=asc&orderBy[0].forecastDate.nulls=last&orderBy[1].name=asc' +
        '&orderBy[2].implement.serialNumber.sort=asc&orderBy[2].implement.serialNumber.nulls=last';
      let ordem: Array<string | null> = [];
      const r = await statusOf(async () => {
        const q = pipe.transform(parseQueryString(`${agenda}&${filtro}`), meta);
        const res = await tasks.findMany(q, 'ADMIN');
        ordem = (res?.data ?? []).map((t: any) => t.implement?.serialNumber ?? null);
      });
      check('a URL da Agenda → 200', r.status === 200, `${r.status} ${r.message}`);
      check(
        'e ordenada pela série do implemento, nulos por último',
        JSON.stringify(ordem) === JSON.stringify([`${s2}A`, `${s2}Z`, null]),
        JSON.stringify(ordem),
      );

      // O app de antes da DD13/DD14 mandava a série no topo: 400 nomeado, nunca 500.
      const antiga =
        'orderBy[0].forecastDate.sort=asc&orderBy[1].name=asc' +
        '&orderBy[2].serialNumber.sort=asc&orderBy[2].serialNumber.nulls=last';
      const r2 = await statusOf(async () => {
        const q = pipe.transform(parseQueryString(`${antiga}&${filtro}`), meta);
        await tasks.findMany(q, 'ADMIN');
      });
      check('a URL do app antigo (série no topo) → 400 que nomeia a chave', r2.status === 400 && /serialNumber/.test(r2.message), `${r2.status} ${r2.message}`);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nBusca de tinta por série e por placa (SQL cru no implemento)');
    // ═════════════════════════════════════════════════════════════════════
    {
      const placa = `Q${SUFFIX}Z`;
      await prisma.implement.update({ where: { taskId: t2! }, data: { plate: placa } });
      await prisma.task.update({ where: { id: t2! }, data: { paintId: paint.id } });
      const achou = async (termo: string) => {
        const res = await paints.findMany({ searchingFor: termo, limit: 1000 } as any);
        return (res?.data ?? []).some((p: any) => p.id === paint.id);
      };
      check('pela série do implemento', await achou(s1));
      check('pela placa, digitada com hífen', await achou(`${placa.slice(0, 3)}-${placa.slice(3)}`));
    }
  } finally {
    try {
      const ids = (await doTeste()).map((t: any) => t.id);
      const implementIds = (
        await prisma.implement.findMany({ where: { taskId: { in: ids } }, select: { id: true } })
      ).map((i: any) => i.id);
      if (createdQuoteIds.length) {
        await prisma.task.updateMany({ where: { id: { in: ids } }, data: { quoteId: null } });
        await prisma.budget.deleteMany({ where: { id: { in: createdQuoteIds } } });
      }
      await prisma.task.deleteMany({ where: { id: { in: ids } } });
      await prisma.changeLog.deleteMany({
        where: { entityId: { in: [...ids, ...implementIds, ...createdQuoteIds] } },
      });
      await prisma.changeLog.deleteMany({
        where: { createdAt: { gte: startedAt }, entityType: 'TASK', field: 'serialNumber', entityId: { in: ids } },
      });
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
        ? `\n✅ série só no implemento: ${passes} verificações passaram.\n`
        : `\n❌ ${failures} verificação(ões) falharam (${passes} passaram).\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ O teste estourou:', err?.stack ?? err);
    process.exit(1);
  });
