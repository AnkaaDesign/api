/**
 * "EM NEGOCIAÇÃO" NUM ORÇAMENTO DE VÁRIOS VEÍCULOS.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * O orçamento é do NEGÓCIO; a O.S. "Em Negociação" é de cada TAREFA. Enquanto um
 * orçamento tinha uma tarefa só, os dois eram a mesma coisa, e toda mudança de
 * estado do orçamento reconciliava a O.S. assim:
 *
 *     const task = await prisma.task.findFirst({ where: { quoteId } })
 *     await syncEmNegociacaoForTask(prisma, task.id)
 *
 * Com o orçamento multi-tarefa esse `findFirst` virou um SORTEIO. Orçamento 604,
 * quatro veículos, 15/09 21:56:42: aprovado, UMA "Em Negociação" fechou, as
 * outras TRÊS ficaram em "Em Andamento" — a tela mostrava "Orçamento Aprovado" e
 * o comercial ainda negociando o mesmo negócio, em três caminhões.
 *
 * A propriedade que este arquivo fixa é simples e vale nos dois sentidos:
 *
 *     o estado do ORÇAMENTO alcança TODAS as tarefas que ele cobre.
 *
 * Aprovar fecha as N; desaprovar reabre as N. Sem banco e sem rede — o que se
 * verifica é o ALCANCE da reconciliação, não a regra de destino (essa é a
 * tabela do `syncEmNegociacaoForTask`, exercida aqui de passagem).
 */

import {
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE,
  TASK_QUOTE_STATUS,
} from '../src/constants/enums';
import {
  syncEmNegociacaoForQuote,
  syncEmNegociacaoForTask,
  syncEmNegociacaoForTaskAndSiblings,
} from '../src/utils/em-negociacao-sync';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const QUOTE_ID = 'quote-604';

type Options = {
  quoteStatus: TASK_QUOTE_STATUS;
  /** O layout renderizado no editor de orçamento (Step 2), se houver. */
  quoteHasLayoutFile?: boolean;
  /** Estado inicial da "Em Negociação", por índice de tarefa. */
  initial?: Partial<Record<number, SERVICE_ORDER_STATUS>>;
  taskCount?: number;
};

/**
 * Banco de mentira com o mínimo que o sync lê: quatro tarefas do MESMO
 * orçamento, cada uma com a "Em Negociação" comercial e as O.S. de Arte que a
 * agenda cria por padrão.
 */
function makeDb(opts: Options) {
  const taskCount = opts.taskCount ?? 4;
  const quote = {
    status: opts.quoteStatus,
    layoutFiles: opts.quoteHasLayoutFile ? [{ id: 'layout-file-1' }] : [],
  };

  const serviceOrders: any[] = [];
  const tasks: any[] = [];

  for (let i = 0; i < taskCount; i++) {
    const taskId = `task-${i}`;
    serviceOrders.push({
      id: `so-neg-${i}`,
      taskId,
      type: SERVICE_ORDER_TYPE.COMMERCIAL,
      description: 'Em Negociação',
      status: opts.initial?.[i] ?? SERVICE_ORDER_STATUS.IN_PROGRESS,
      startedAt: new Date('2026-09-15T21:56:03Z'),
      lastStartedAt: null,
      totalActiveTimeSeconds: 0,
      finishedAt: null,
    });
    serviceOrders.push({
      id: `so-arte-${i}`,
      taskId,
      type: SERVICE_ORDER_TYPE.ARTWORK,
      description: 'Elaborar Layout',
      status: SERVICE_ORDER_STATUS.PENDING,
      startedAt: null,
      lastStartedAt: null,
      totalActiveTimeSeconds: 0,
      finishedAt: null,
    });
    tasks.push({ id: taskId, quoteId: QUOTE_ID, createdAt: new Date(2026, 8, 15, 18, 56, i) });
  }

  const prisma = {
    task: {
      findMany: async ({ where }: any) =>
        tasks.filter(t => t.quoteId === where.quoteId).map(t => ({ ...t })),
      findUnique: async ({ where }: any) => {
        const task = tasks.find(t => t.id === where.id);
        if (!task) return null;
        return {
          ...task,
          quote,
          // Cópias, não referências: o sync loga o estado ANTERIOR da O.S., e
          // devolver o objeto vivo faria o log mentir "COMPLETED → COMPLETED".
          serviceOrders: serviceOrders
            .filter(so => so.taskId === task.id)
            .map(so => ({ ...so })),
          layouts: [],
        };
      },
    },
    serviceOrder: {
      update: async ({ where, data }: any) => {
        const so = serviceOrders.find(s => s.id === where.id);
        Object.assign(so, data);
        return { ...so };
      },
    },
    layout: {},
  } as any;

  const negociacaoOf = (i: number) =>
    serviceOrders.find(so => so.id === `so-neg-${i}`)!.status as SERVICE_ORDER_STATUS;
  const allNegociacao = () => tasks.map((_, i) => negociacaoOf(i));

  return { prisma, negociacaoOf, allNegociacao, taskCount };
}

const every = (list: SERVICE_ORDER_STATUS[], status: SERVICE_ORDER_STATUS) =>
  list.every(s => s === status);

async function main() {
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nO defeito: reconciliar só a primeira tarefa');
  {
    const db = makeDb({
      quoteStatus: TASK_QUOTE_STATUS.BUDGET_APPROVED,
      quoteHasLayoutFile: true,
    });
    // Exatamente o que o código fazia: uma tarefa, sorteada.
    await syncEmNegociacaoForTask(db.prisma, 'task-0');
    check(
      'a tarefa sorteada fecha',
      db.negociacaoOf(0) === SERVICE_ORDER_STATUS.COMPLETED,
      db.negociacaoOf(0),
    );
    check(
      'e as outras três ficam negociando um orçamento já aprovado',
      [1, 2, 3].every(i => db.negociacaoOf(i) === SERVICE_ORDER_STATUS.IN_PROGRESS),
      db.allNegociacao().join(', '),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nAprovar o orçamento fecha a Em Negociação de TODOS os veículos');
  {
    const db = makeDb({
      quoteStatus: TASK_QUOTE_STATUS.BUDGET_APPROVED,
      quoteHasLayoutFile: true,
    });
    await syncEmNegociacaoForQuote(db.prisma, QUOTE_ID);
    check(
      'as quatro fecham',
      every(db.allNegociacao(), SERVICE_ORDER_STATUS.COMPLETED),
      db.allNegociacao().join(', '),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nSem layout, as quatro esperam a arte — nenhuma fica "Em Andamento"');
  {
    const db = makeDb({
      quoteStatus: TASK_QUOTE_STATUS.BUDGET_APPROVED,
      quoteHasLayoutFile: false,
    });
    await syncEmNegociacaoForQuote(db.prisma, QUOTE_ID);
    check(
      'as quatro vão para Aguardando Arte',
      every(db.allNegociacao(), SERVICE_ORDER_STATUS.WAITING_ARTWORK),
      db.allNegociacao().join(', '),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nDesaprovar reabre as quatro (o sentido inverso vale igual)');
  {
    const db = makeDb({
      quoteStatus: TASK_QUOTE_STATUS.PENDING,
      quoteHasLayoutFile: true,
      initial: {
        0: SERVICE_ORDER_STATUS.COMPLETED,
        1: SERVICE_ORDER_STATUS.COMPLETED,
        2: SERVICE_ORDER_STATUS.COMPLETED,
        3: SERVICE_ORDER_STATUS.COMPLETED,
      },
    });
    await syncEmNegociacaoForQuote(db.prisma, QUOTE_ID);
    check(
      'as quatro voltam para Em Andamento',
      every(db.allNegociacao(), SERVICE_ORDER_STATUS.IN_PROGRESS),
      db.allNegociacao().join(', '),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nConcluir a O.S. de UM veículo alcança as irmãs do mesmo orçamento');
  {
    const db = makeDb({
      quoteStatus: TASK_QUOTE_STATUS.BUDGET_APPROVED,
      quoteHasLayoutFile: true,
    });
    // O gatilho nasce numa tarefa (a O.S. concluída na mão), mas a aprovação que
    // ele dispara é do orçamento inteiro.
    await syncEmNegociacaoForTaskAndSiblings(db.prisma, 'task-2');
    check(
      'as quatro fecham, não só a de origem',
      every(db.allNegociacao(), SERVICE_ORDER_STATUS.COMPLETED),
      db.allNegociacao().join(', '),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nO que é manual continua manual, em todos os veículos');
  {
    const db = makeDb({
      quoteStatus: TASK_QUOTE_STATUS.BUDGET_APPROVED,
      quoteHasLayoutFile: true,
      initial: {
        1: SERVICE_ORDER_STATUS.PAUSED,
        2: SERVICE_ORDER_STATUS.CANCELLED,
      },
    });
    await syncEmNegociacaoForQuote(db.prisma, QUOTE_ID);
    check('a pausada segue pausada', db.negociacaoOf(1) === SERVICE_ORDER_STATUS.PAUSED);
    check('a cancelada segue cancelada', db.negociacaoOf(2) === SERVICE_ORDER_STATUS.CANCELLED);
    check(
      'as demais fecham',
      db.negociacaoOf(0) === SERVICE_ORDER_STATUS.COMPLETED &&
        db.negociacaoOf(3) === SERVICE_ORDER_STATUS.COMPLETED,
      db.allNegociacao().join(', '),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nOrçamento cancelado não mexe em nada, em nenhum veículo');
  {
    const db = makeDb({
      quoteStatus: TASK_QUOTE_STATUS.CANCELLED,
      quoteHasLayoutFile: true,
      initial: {
        0: SERVICE_ORDER_STATUS.COMPLETED,
        1: SERVICE_ORDER_STATUS.COMPLETED,
      },
    });
    await syncEmNegociacaoForQuote(db.prisma, QUOTE_ID);
    check(
      'as concluídas não reabrem e as abertas não fecham',
      db.negociacaoOf(0) === SERVICE_ORDER_STATUS.COMPLETED &&
        db.negociacaoOf(1) === SERVICE_ORDER_STATUS.COMPLETED &&
        db.negociacaoOf(2) === SERVICE_ORDER_STATUS.IN_PROGRESS &&
        db.negociacaoOf(3) === SERVICE_ORDER_STATUS.IN_PROGRESS,
      db.allNegociacao().join(', '),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nIdempotência: rodar duas vezes não muda nada');
  {
    const db = makeDb({
      quoteStatus: TASK_QUOTE_STATUS.BUDGET_APPROVED,
      quoteHasLayoutFile: true,
    });
    await syncEmNegociacaoForQuote(db.prisma, QUOTE_ID);
    const first = db.allNegociacao().join(',');
    await syncEmNegociacaoForQuote(db.prisma, QUOTE_ID);
    check('o segundo passe é inerte', db.allNegociacao().join(',') === first, first);
  }

  if (failures > 0) {
    console.log(`\n❌ ${failures} verificação(ões) falharam.`);
    process.exit(1);
  }
  console.log('\n✅ Em Negociação multitarefa: todas as verificações passaram.');
}

void main();
