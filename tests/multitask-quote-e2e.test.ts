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
 * ⚠️ Escreve no banco apontado por `DATABASE_URL` e APAGA o que criou no fim
 * (`finally`), inclusive quando uma verificação falha. Use contra o dev.
 */

import { NestFactory } from '@nestjs/core';
// `AppModule` inteiro, de propósito. Montar um módulo enxuto com `TaskModule`
// levou a reconstruir à mão metade do que o `AppModule` registra como GLOBAL
// (EventEmitter, Config, Jwt, …) — e um grafo de DI diferente do de produção não
// prova o que este arquivo existe para provar.
//
// Roda sob `ts-node-dev`, o mesmo runner do `npm run dev`: sob `tsx` o baileys
// (WhatsApp) não resolve `exports`.
import { AppModule } from '../src/app.module';
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
    const created = await tasks.batchCreateWithQuote(
      {
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
            },
          ],
          services: [{ description: 'Logomarca Lateral', amount: 100 }],
        } as any,
      } as any,
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
        customerConfigs: { select: { id: true, taskId: true, billingApprovedAt: true } },
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
    check(
      '`JOINT` produz UMA fatia, com `taskId` nulo',
      quote?.customerConfigs.length === 1 && quote?.customerConfigs[0].taskId === null,
      JSON.stringify(quote?.customerConfigs),
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
        customerConfigs: { select: { taskId: true } },
      },
    });
    check(
      '`billingSplit` gravado',
      perTask?.billingSplit === 'PER_TASK',
      String(perTask?.billingSplit),
    );
    check(
      'quatro fatias, uma por veículo (o índice parcial não recusou nenhuma)',
      perTask?.customerConfigs.length === 4 &&
        perTask.customerConfigs.every(c => c.taskId !== null),
      JSON.stringify(perTask?.customerConfigs),
    );

    // ═══════════════════════════════════════════════════════════════════════
    console.log('\nO app antigo ainda pode mandar `orderNumber` na fatia');
    // ═══════════════════════════════════════════════════════════════════════
    //
    // O aparelho instalado não se atualiza junto com a API. O campo tem de ser
    // ACEITO e traduzido para as tarefas — nunca recusado, e nunca escrito numa
    // coluna que não existe.
    const legacy = await tasks.batchCreateWithQuote(
      {
        tasks: [
          {
            status: 'PREPARATION',
            name: `${TASK_NAME}-LEGADO`,
            customerId: customer.id,
            serialNumber: `ZZ${SUFFIX}L`,
          },
        ] as any,
        quote: {
          expiresAt: new Date(Date.now() + 30 * 86400000),
          status: 'PENDING',
          subtotal: 50,
          total: 50,
          customerConfigs: [
            { customerId: customer.id, subtotal: 50, total: 50, orderNumber: 'PED-LEGADO' },
          ],
          services: [{ description: 'Logomarca Lateral', amount: 50 }],
        } as any,
      } as any,
      undefined,
      user.id,
    );
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
