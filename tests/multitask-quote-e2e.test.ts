/**
 * O ORÇAMENTO MULTITAREFA, CONTRA O BANCO DE VERDADE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `TaskQuoteService.create` montava a fatia de faturamento com
 * `orderNumber: (config as any).orderNumber || null`. A coluna saiu do modelo na
 * migração `20260909170000` — o pedido de compra é do VEÍCULO
 * (`Task.customerOrderNumber`) — mas `x || null` emite a chave SEMPRE, mesmo
 * quando o cliente não a manda. O Prisma respondia "Unknown argument
 * `orderNumber`" e **toda criação de orçamento morria em 500**.
 *
 * Nada disso aparece num `tsc` limpo: `(config as any)` apaga o tipo, o zod
 * aceita a chave (ela segue no contrato por compatibilidade com o app instalado)
 * e o erro só existe no momento em que o Prisma fala com o Postgres.
 *
 * Os outros testes desta pasta são sobre FUNÇÕES PURAS — aritmética da fatia,
 * tradução de consulta, mapeamento de campo. Nenhum deles toca o banco, e é
 * exatamente por isso que nenhum deles viu. Este aqui sobe o container de DI e
 * chama o MESMO método que a tela chama.
 *
 *   npm run test:multitask-quote
 *
 * O script exporta `BACKUP_PATH` para um diretório local: o `BackupService` cria
 * a árvore de backup no bootstrap e `/mnt/backup` — o padrão de produção — não
 * existe na máquina de desenvolvimento. Sem isso o `AppModule` não sobe, e este
 * arquivo passou semanas marcado como "não roda no ambiente local" por causa de
 * um `mkdir` sem permissão. Roda sob `ts-node`, não `ts-node-dev`: o watcher
 * REINICIA o teste a cada arquivo salvo, e o relatório final some no meio.
 *
 * ⚠️ Escreve no banco apontado por `DATABASE_URL` e APAGA o que criou no fim
 * (`finally`), inclusive quando uma verificação falha. Use contra o dev.
 */

import { NestFactory } from '@nestjs/core';
// `AppModule` inteiro, de propósito. Montar um módulo enxuto com `TaskModule`
// levou a reconstruir à mão metade do que o `AppModule` registra como GLOBAL
// (EventEmitter, Config, Jwt, …) — e um grafo de DI diferente do de produção não
// prova o que este arquivo existe para provar.
//
// Roda sob `ts-node` (não `tsx`: ali o baileys, do WhatsApp, não resolve
// `exports`; e não `ts-node-dev`: o watcher reinicia o teste a cada save).
import { AppModule } from '../src/app.module';
import { taskBatchCreateWithQuoteSchema } from '../src/schemas/task';
import { taskQuoteUpdateSchema } from '../src/schemas/task-quote';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import { TaskService } from '../src/modules/production/task/task.service';
import { TaskQuoteService } from '../src/modules/production/task-quote/task-quote.service';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * O MESMO portão do controller: `ZodValidationPipe(taskBatchCreateWithQuoteSchema)`.
 *
 * Chamar o serviço com um objeto literal pularia a validação — e o zod não só
 * valida, ele TRANSFORMA (aplica defaults, coage datas) e DESCARTA o que não
 * está declarado. Um teste que pula esta etapa não vê um campo removido do
 * contrato.
 */
function parseBody(body: unknown): any {
  const parsed = taskBatchCreateWithQuoteSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`o zod recusou o corpo: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

/**
 * O portão de `PUT /task-quotes/:id` — `ZodValidationPipe(taskQuoteUpdateSchema)`.
 *
 * Existe pela mesma razão que `parseBody`: é aqui que a cobertura (`taskIds` de
 * cada fatia) e o `id` da fatia atravessam — ou não — o contrato. Foi assim que
 * o `id` se perdeu antes: o objeto não é `.strict()`, então uma chave que falte
 * no schema não é RECUSADA, é APAGADA, e o servidor recebe quatro faturamentos
 * do mesmo cliente sem nada que os distinga.
 */
function parseQuoteUpdate(body: unknown): any {
  const parsed = taskQuoteUpdateSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`o zod recusou a atualização: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

const SUFFIX = Date.now().toString().slice(-6);
const TASK_NAME = `ZZ-TESTE-MULTITAREFA-${SUFFIX}`;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  const prisma = app.get(PrismaService);
  const tasks = app.get(TaskService);
  const quotes = app.get(TaskQuoteService);

  const createdQuoteIds: string[] = [];
  const createdTaskIds: string[] = [];

  try {
    // Um cliente e um usuário REAIS — o serviço conecta as duas FKs, e inventar
    // uuids faria o teste falhar por P2003 em vez de pelo que ele mede.
    //
    // O usuário precisa de setor ADMIN: a criação passa pela mesma guarda de
    // privilégio por campo que a tela enfrenta, e um usuário sem setor recebe
    // "Campos permitidos: nenhum" — que é um erro sobre o teste, não sobre o
    // código que ele mede.
    const customer = await prisma.customer.findFirst({ select: { id: true } });
    const user = await prisma.user.findFirst({
      where: { sector: { privileges: 'ADMIN' } },
      select: { id: true },
    });
    if (!customer || !user) {
      console.log('\n⚠️  Banco sem cliente ou usuário ADMIN — nada a exercitar.\n');
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    console.log('\nQuatro veículos e um orçamento, numa transação só');
    // ═══════════════════════════════════════════════════════════════════════
    //
    // A forma EXATA que a tela de criação envia: quatro tarefas com o mesmo
    // `customerOrderNumber` (o campo do passo 1 vale para todas as que nascem) e
    // um orçamento com uma configuração de cliente.
    // ⚠️ O CORPO PASSA PELO ZOD ANTES DO SERVIÇO — é o que o controller faz
    // (`@Body(new ZodValidationPipe(taskBatchCreateWithQuoteSchema))`). Chamar o
    // serviço direto pularia a validação, e um campo APAGADO do schema (o objeto
    // não é `.strict()`: ele não recusa, ele descarta) passaria despercebido
    // aqui e sumiria em produção entre o botão e o banco.
    const created = await tasks.batchCreateWithQuote(
      parseBody({
        tasks: [1, 2, 3, 4].map(n => ({
          status: 'PREPARATION',
          name: TASK_NAME,
          customerId: customer.id,
          serialNumber: `ZZ${SUFFIX}${n}`,
          customerOrderNumber: '4888888',
        })) as any,
        quote: {
          billingSplit: 'JOINT',
          expiresAt: new Date(Date.now() + 30 * 86400000),
          status: 'PENDING',
          subtotal: 100,
          total: 100,
          customerConfigs: [
            {
              customerId: customer.id,
              subtotal: 100,
              total: 100,
              discountType: 'NONE',
              generateInvoice: true,
              generateBankSlip: true,
              paymentConfig: { type: 'CASH', method: 'BANK_SLIP', cashDays: 5 },
              // A TELA MANDA ISTO. `customerData` é o cadastro fiscal que o
              // formulário edita junto — não é campo da fatia, e o zod (não
              // `.strict()`) o descarta. Está aqui porque o corpo real o traz:
              // se um dia ele passar, vira "Unknown argument `customerData`" no
              // Prisma, que é exatamente como `orderNumber` derrubou tudo.
              customerData: { corporateName: 'Teste', cnpj: '12345678000199' },
            } as any,
          ],
          services: [{ description: 'Logomarca Lateral', amount: 100 }],
        },
      }),
      undefined,
      user.id,
    );

    const quoteId = (created as any)?.data?.quote?.id as string | undefined;
    const taskIds = ((created as any)?.data?.tasks ?? []).map((t: any) => t.id) as string[];
    if (quoteId) createdQuoteIds.push(quoteId);
    createdTaskIds.push(...taskIds);

    check('a criação não estoura (era 500: Unknown argument `orderNumber`)', !!quoteId);
    check('nasceram QUATRO tarefas', taskIds.length === 4, String(taskIds.length));

    if (!quoteId) return;

    const quote = await prisma.taskQuote.findUnique({
      where: { id: quoteId },
      select: {
        vehicleCount: true,
        billingSplit: true,
        total: true,
        tasks: { select: { id: true, customerOrderNumber: true } },
        customerConfigs: {
          select: {
            id: true,
            billingApprovedAt: true,
            coveredTasks: { select: { taskId: true } },
          },
        },
      },
    });

    check(
      '`vehicleCount` gravado = 4 (o divisor de toda leitura por tarefa)',
      quote?.vehicleCount === 4,
      String(quote?.vehicleCount),
    );
    check(
      'as quatro tarefas ficaram ligadas ao orçamento',
      (quote?.tasks.length ?? 0) === 4,
      String(quote?.tasks.length),
    );
    check(
      'o total é o CONTRATO: preço por veículo × 4',
      Number(quote?.total) === 400,
      String(quote?.total),
    );
    check(
      'o N° do Pedido do passo 1 chegou aos QUATRO veículos',
      (quote?.tasks ?? []).every(t => t.customerOrderNumber === '4888888'),
      JSON.stringify((quote?.tasks ?? []).map(t => t.customerOrderNumber)),
    );
    // `JOINT` = UMA fatia que COBRE OS QUATRO. A cobertura é linha em
    // `QuoteBillingTask`, não mais a coluna `taskId` nula querendo dizer
    // "todos": a pergunta "de quais veículos é esta fatura?" passou a ter
    // resposta gravada, e é isso que o lote precisava.
    check(
      '`JOINT` produz UMA fatia, cobrindo os QUATRO veículos',
      quote?.customerConfigs.length === 1 &&
        quote.customerConfigs[0].coveredTasks.length === 4,
      JSON.stringify(quote?.customerConfigs),
    );
    check(
      'a cobertura do `JOINT` é exatamente o conjunto de veículos do orçamento',
      new Set((quote?.customerConfigs[0]?.coveredTasks ?? []).map(r => r.taskId)).size === 4 &&
        (quote?.customerConfigs[0]?.coveredTasks ?? []).every(r => taskIds.includes(r.taskId)),
      JSON.stringify(quote?.customerConfigs[0]?.coveredTasks),
    );

    // ═══════════════════════════════════════════════════════════════════════
    console.log('\nO pedido de compra se corrige veículo a veículo');
    // ═══════════════════════════════════════════════════════════════════════
    //
    // É o contrato que a tela promete: um número para todos na criação, e depois
    // cada tarefa editável sozinha. `PUT /tasks/:id` respondia 200 sem gravar
    // nada enquanto o campo faltou na desestruturação do repositório.
    await tasks.update(taskIds[1], { customerOrderNumber: '999' } as any, undefined, user.id);
    const afterOne = await prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, customerOrderNumber: true },
      orderBy: { serialNumber: 'asc' },
    });
    check(
      'o segundo caminhão mudou',
      afterOne.find(t => t.id === taskIds[1])?.customerOrderNumber === '999',
      JSON.stringify(afterOne.map(t => t.customerOrderNumber)),
    );
    check(
      'os outros três NÃO mudaram',
      afterOne.filter(t => t.id !== taskIds[1]).every(t => t.customerOrderNumber === '4888888'),
      JSON.stringify(afterOne.map(t => t.customerOrderNumber)),
    );

    // Limpar é uma ESCRITA: um `if (value)` trataria `null` como "não mexeu" e o
    // número de um pedido cancelado ficaria de pé na nota.
    await tasks.update(taskIds[2], { customerOrderNumber: null } as any, undefined, user.id);
    const cleared = await prisma.task.findUnique({
      where: { id: taskIds[2] },
      select: { customerOrderNumber: true },
    });
    check(
      'limpar o campo grava `null`',
      cleared?.customerOrderNumber === null,
      String(cleared?.customerOrderNumber),
    );

    // ═══════════════════════════════════════════════════════════════════════
    console.log('\nTrocar para faturamento por veículo cria uma fatia por caminhão');
    // ═══════════════════════════════════════════════════════════════════════
    await quotes.update(quoteId, { billingSplit: 'PER_TASK', status: 'PENDING' } as any, user.id);
    const perTask = await prisma.taskQuote.findUnique({
      where: { id: quoteId },
      select: {
        billingSplit: true,
        vehicleCount: true,
        customerConfigs: {
          select: { id: true, total: true, coveredTasks: { select: { taskId: true } } },
        },
      },
    });
    check(
      '`billingSplit` gravado',
      perTask?.billingSplit === 'PER_TASK',
      String(perTask?.billingSplit),
    );
    check(
      'quatro fatias, cada uma cobrindo UM veículo',
      perTask?.customerConfigs.length === 4 &&
        perTask.customerConfigs.every(c => c.coveredTasks.length === 1),
      JSON.stringify(perTask?.customerConfigs),
    );
    // A PARTIÇÃO — a propriedade que o índice único `(taskId, customerId)`
    // garante e que a aritmética da fatura depende: todo veículo coberto uma
    // vez, e uma só.
    check(
      'os quatro veículos, cada um em exatamente uma fatia',
      (() => {
        const covered = (perTask?.customerConfigs ?? []).flatMap(c =>
          c.coveredTasks.map(r => r.taskId),
        );
        return covered.length === 4 && new Set(covered).size === 4;
      })(),
      JSON.stringify((perTask?.customerConfigs ?? []).map(c => c.coveredTasks)),
    );
    // `total da fatia = por veículo × cobertos`. Trocar só o modo tem de
    // RECALCULAR: enquanto `billingSplit` não estava na condição de
    // `recalcQuoteTotals`, as fatias novas nasciam com o total do CONTRATO
    // INTEIRO cada uma — sessenta boletos de R$ 730.224,00.
    check(
      'cada fatia de um veículo cobra 100, não os 400 do contrato',
      (perTask?.customerConfigs ?? []).every(c => Number(c.total) === 100),
      JSON.stringify((perTask?.customerConfigs ?? []).map(c => String(c.total))),
    );

    // ═══════════════════════════════════════════════════════════════════════
    console.log('\nLOTES: dois caminhões num pedido, dois noutro');
    // ═══════════════════════════════════════════════════════════════════════
    //
    // O caso que derrubou o modelo anterior. "Os vinte primeiros no pedido 8842
    // e os quarenta restantes no 9013" — que é como o cliente de sessenta
    // caminhões paga — não é `JOINT` nem `PER_TASK`, e não havia coluna capaz de
    // dizê-lo: `taskId` guarda UMA tarefa, e o nulo dele significava "todas".
    //
    // Aqui, na escala do teste: 2 + 2.
    const lotA = [taskIds[0], taskIds[1]];
    const lotB = [taskIds[2], taskIds[3]];

    await quotes.update(
      quoteId,
      parseQuoteUpdate({
        status: 'PENDING',
        billingSplit: 'CUSTOM',
        customerConfigs: [
          { customerId: customer.id, taskIds: lotA },
          { customerId: customer.id, taskIds: lotB },
        ],
      }),
      user.id,
    );

    const readLots = async () =>
      (
        await prisma.taskQuoteCustomerConfig.findMany({
          where: { quoteId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            total: true,
            coveredTasks: { select: { taskId: true }, orderBy: { createdAt: 'asc' } },
          },
        })
      ).map(c => ({
        id: c.id,
        total: Number(c.total),
        covered: c.coveredTasks.map(r => r.taskId),
      }));

    const lots = await readLots();
    check('dois faturamentos — um por lote', lots.length === 2, JSON.stringify(lots));
    check(
      'cada lote cobre exatamente os SEUS dois veículos',
      lots.length === 2 &&
        lots.every(l => l.covered.length === 2) &&
        lots.some(l => l.covered.slice().sort().join() === lotA.slice().sort().join()) &&
        lots.some(l => l.covered.slice().sort().join() === lotB.slice().sort().join()),
      JSON.stringify(lots.map(l => l.covered)),
    );
    // A ARITMÉTICA PERDEU O "SE": total da fatura = por veículo × COBERTOS. Não
    // é mais uma escolha entre o contrato inteiro e um caminhão — é uma conta,
    // e a soma das faturas reconstrói o contrato nos três modos.
    check(
      'cada lote cobra 200 = 100 por veículo × 2 cobertos',
      lots.every(l => l.total === 200),
      JSON.stringify(lots.map(l => l.total)),
    );
    check(
      'a soma dos lotes reconstrói o contrato (400)',
      lots.reduce((s, l) => s + l.total, 0) === 400,
      String(lots.reduce((s, l) => s + l.total, 0)),
    );

    // ── O BANCO é quem garante a partição ────────────────────────────────────
    //
    // `@@unique([taskId, customerId])`. Não é convenção nem guarda de serviço: é
    // o índice que torna IMPOSSÍVEL o mesmo caminhão ser cobrado por duas notas
    // do mesmo cliente — o erro que ninguém percebe até o cliente receber duas.
    const otherLotId = lots.find(l => !l.covered.includes(taskIds[0]))!.id;
    let refused = false;
    try {
      await prisma.quoteBillingTask.create({
        data: { configId: otherLotId, taskId: taskIds[0], customerId: customer.id },
      });
    } catch {
      refused = true;
    }
    if (!refused) {
      await prisma.quoteBillingTask
        .delete({ where: { configId_taskId: { configId: otherLotId, taskId: taskIds[0] } } })
        .catch(() => {});
    }
    check('o banco RECUSA cobrar o mesmo veículo em duas faturas do cliente', refused);

    // ── Regravar os MESMOS lotes não recria nada ─────────────────────────────
    //
    // A fatia é o pai `onDelete: Cascade` da fatura e das parcelas: recriá-la a
    // cada save levava junto a fatura emitida e a assinatura do cliente. Os ids
    // têm de sobreviver — é o casamento por identidade em ação.
    const idsBefore = lots.map(l => l.id).sort();
    await quotes.update(
      quoteId,
      parseQuoteUpdate({
        status: 'PENDING',
        billingSplit: 'CUSTOM',
        customerConfigs: lots.map(l => ({
          id: l.id,
          customerId: customer.id,
          taskIds: l.covered,
        })),
      }),
      user.id,
    );
    const resaved = await readLots();
    check(
      'regravar os mesmos lotes PRESERVA as fatias (id a id)',
      JSON.stringify(resaved.map(l => l.id).sort()) === JSON.stringify(idsBefore),
      `${JSON.stringify(idsBefore)} → ${JSON.stringify(resaved.map(l => l.id).sort())}`,
    );

    // ── Redividir um lote mantém a fatia viva ────────────────────────────────
    //
    // Os vinte viram dez e dez: o faturamento dos vinte segue sendo o dos dez
    // primeiros (maior sobreposição) em vez de ser apagado e recriado. Aqui: o
    // lote A de dois vira dois de um.
    const lotAId = resaved.find(l => l.covered.includes(taskIds[0]))!.id;
    await quotes.update(
      quoteId,
      parseQuoteUpdate({
        status: 'PENDING',
        billingSplit: 'CUSTOM',
        customerConfigs: [
          { customerId: customer.id, taskIds: [taskIds[0]] },
          { customerId: customer.id, taskIds: [taskIds[1]] },
          { customerId: customer.id, taskIds: lotB },
        ],
      }),
      user.id,
    );
    const split = await readLots();
    check('redividir 2 em 1+1 produz TRÊS faturamentos', split.length === 3, JSON.stringify(split));
    check(
      'a fatia do lote redividido SOBREVIVE (o mesmo id cobre o primeiro veículo)',
      split.find(l => l.covered.join() === taskIds[0])?.id === lotAId,
      `${lotAId} → ${JSON.stringify(split.map(l => ({ id: l.id, cov: l.covered })))}`,
    );
    check(
      'e os veículos continuam repartidos sem sobra nem repetição',
      (() => {
        const all = split.flatMap(l => l.covered);
        return all.length === 4 && new Set(all).size === 4;
      })(),
      JSON.stringify(split.map(l => l.covered)),
    );

    // ── COBERTURA CONGELADA ──────────────────────────────────────────────────
    //
    // Uma fatia já APROVADA não muda de cobertura, em nenhum modo. Sem isto,
    // trocar o fatiamento depois de faturar mudaria, retroativamente, de quais
    // caminhões é uma NFS-e que já foi autorizada.
    const frozenId = split.find(l => l.covered.join() === taskIds[0])!.id;
    await prisma.taskQuoteCustomerConfig.update({
      where: { id: frozenId },
      data: { billingApprovedAt: new Date() },
    });

    // Trocar o MODO com faturamento aprovado é RECUSADO — e a recusa é a
    // resposta honesta: a reconciliação respeitaria o congelamento em silêncio,
    // e a tela mostraria "separado" sobre uma fatura única já emitida.
    let modeRefused = false;
    try {
      await quotes.update(
        quoteId,
        parseQuoteUpdate({ status: 'PENDING', billingSplit: 'JOINT' }),
        user.id,
      );
    } catch (err) {
      modeRefused = /faturamento aprovado/i.test((err as Error)?.message ?? '');
    }
    check('trocar o fatiamento depois de faturar é RECUSADO', modeRefused);

    // O que NÃO é recusado: refatiar o resto. A fatia aprovada não se mexe, e os
    // veículos dela saem do bolo que os outros repartem — é isso que impede uma
    // regravação de mudar, retroativamente, de quais caminhões é uma NFS-e que
    // já foi autorizada.
    await quotes.update(
      quoteId,
      parseQuoteUpdate({
        status: 'PENDING',
        billingSplit: 'CUSTOM',
        customerConfigs: [
          { customerId: customer.id, taskIds: [taskIds[1], taskIds[2], taskIds[3]] },
        ],
      }),
      user.id,
    );
    const afterFreeze = await readLots();
    const frozen = afterFreeze.find(l => l.id === frozenId);
    check(
      'a fatia aprovada continua de pé, cobrindo o MESMO veículo',
      !!frozen && frozen.covered.join() === taskIds[0],
      JSON.stringify(afterFreeze.map(l => ({ id: l.id, cov: l.covered }))),
    );
    check(
      'o lote novo reparte só os TRÊS que sobraram — o aprovado não entra',
      (() => {
        const rest = afterFreeze.filter(l => l.id !== frozenId);
        const covered = rest.flatMap(l => l.covered);
        return rest.length === 1 && covered.length === 3 && !covered.includes(taskIds[0]);
      })(),
      JSON.stringify(afterFreeze.map(l => ({ id: l.id, cov: l.covered }))),
    );
    check(
      'a soma das faturas continua sendo o contrato: 100 + 300',
      afterFreeze.reduce((s, l) => s + l.total, 0) === 400,
      JSON.stringify(afterFreeze.map(l => l.total)),
    );

    // A aprovação sai do caminho para não travar as verificações seguintes nem
    // a limpeza (uma fatia congelada é, de propósito, difícil de mexer).
    await prisma.taskQuoteCustomerConfig.update({
      where: { id: frozenId },
      data: { billingApprovedAt: null },
    });

    // ═══════════════════════════════════════════════════════════════════════
    console.log('\nO app antigo ainda pode mandar `orderNumber` na fatia');
    // ═══════════════════════════════════════════════════════════════════════
    //
    // O aparelho instalado não se atualiza junto com a API. O campo tem de ser
    // ACEITO e traduzido para as tarefas — nunca recusado, e nunca escrito numa
    // coluna que não existe.
    const legacyBody = parseBody({
      tasks: [
        {
          status: 'PREPARATION',
          name: `${TASK_NAME}-LEGADO`,
          customerId: customer.id,
          serialNumber: `ZZ${SUFFIX}L`,
        },
      ],
      quote: {
        expiresAt: new Date(Date.now() + 30 * 86400000),
        status: 'PENDING',
        subtotal: 50,
        total: 50,
        customerConfigs: [
          { customerId: customer.id, subtotal: 50, total: 50, orderNumber: 'PED-LEGADO' },
        ],
        services: [{ description: 'Logomarca Lateral', amount: 50 }],
      },
    });

    // O zod NÃO é `.strict()`: tirar a chave do schema não recusa o corpo, apaga
    // o valor. Sem esta verificação, remover `orderNumber` do
    // `taskQuoteCustomerConfigCreateNestedSchema` passaria por todos os portões
    // e o pedido de compra do aparelho instalado sumiria em silêncio.
    check(
      'o zod PRESERVA `orderNumber` na fatia (não é `.strict()`: ele apagaria)',
      (legacyBody as any)?.quote?.customerConfigs?.[0]?.orderNumber === 'PED-LEGADO',
      JSON.stringify((legacyBody as any)?.quote?.customerConfigs?.[0]),
    );

    const legacy = await tasks.batchCreateWithQuote(legacyBody, undefined, user.id);
    const legacyQuoteId = (legacy as any)?.data?.quote?.id as string | undefined;
    const legacyTaskIds = ((legacy as any)?.data?.tasks ?? []).map((t: any) => t.id) as string[];
    if (legacyQuoteId) createdQuoteIds.push(legacyQuoteId);
    createdTaskIds.push(...legacyTaskIds);

    check('o corpo legado não é recusado', !!legacyQuoteId);
    if (legacyQuoteId) {
      const legacyTask = await prisma.task.findUnique({
        where: { id: legacyTaskIds[0] },
        select: { customerOrderNumber: true },
      });
      check(
        '`customerConfigs[].orderNumber` foi traduzido para a TAREFA',
        legacyTask?.customerOrderNumber === 'PED-LEGADO',
        String(legacyTask?.customerOrderNumber),
      );
    }
  } finally {
    // Apaga o que nasceu aqui, inclusive se uma verificação falhou. As fatias,
    // os serviços e as O.S. caem por cascade do orçamento/tarefa.
    //
    // A limpeza tem de ser à prova de erro: se ela estourar, o que fica para
    // trás é lixo num banco compartilhado, e a mensagem do estouro esconde a
    // verificação que realmente falhou.
    try {
      if (createdQuoteIds.length > 0) {
        await prisma.task.updateMany({
          where: { id: { in: createdTaskIds } },
          data: { quoteId: null },
        });
        await prisma.taskQuote.deleteMany({ where: { id: { in: createdQuoteIds } } });
      }
      if (createdTaskIds.length > 0) {
        await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      }
    } catch (err) {
      console.log(
        `  ⚠️  limpeza falhou (${(err as Error)?.message}); sobraram: ` +
          `orçamentos ${createdQuoteIds.join(', ') || '—'} / tarefas ${createdTaskIds.join(', ') || '—'}`,
      );
    }
    // `app.close()` derruba filas, agendadores e conexões que este teste nem
    // usou; um deles já ter fechado a sua não é notícia, e deixar o erro subir
    // trocaria "14 verificações passaram" por "o teste estourou".
    await app.close().catch(() => {});
  }
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? '\n✅ Orçamento multitarefa contra o banco: todas as verificações passaram.\n'
        : `\n❌ ${failures} verificação(ões) falharam.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ O teste estourou:', err?.message ?? err);
    process.exit(1);
  });
