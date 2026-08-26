/**
 * Portão do serviço de comunicados recorrentes, sem banco.
 *
 * O `PrismaService` é substituído por um dublê em memória, de modo que os
 * caminhos perigosos possam ser exercitados de verdade — em especial a trava do
 * PÚBLICO VAZIO, que é a única falha deste desenho capaz de transformar um aviso
 * de setor em comunicado para a empresa inteira.
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/check-message-schedule-service.ts
 */
import { MessageScheduleService } from '../src/modules/system/message/message-schedule.service';
import { SCHEDULE_RUN_STATUS } from '../src/constants/enums';

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Dublê de PrismaService com só o que o serviço encosta. */
function makePrisma(opts: {
  schedule: any;
  users: Array<{ id: string }>;
  /** Simula a colisão da @@unique (outro worker já materializou a data). */
  throwUniqueOnCreate?: boolean;
}) {
  const created: any[] = [];
  const targets: any[] = [];
  const updates: any[] = [];

  const tx = {
    message: {
      create: async ({ data }: any) => {
        if (opts.throwUniqueOnCreate) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
        const row = { id: `msg-${created.length + 1}`, ...data };
        created.push(row);
        return row;
      },
    },
    messageTarget: {
      createMany: async ({ data }: any) => {
        targets.push(...data);
        return { count: data.length };
      },
    },
  };

  return {
    created,
    targets,
    updates,
    prisma: {
      messageSchedule: {
        findUnique: async () => opts.schedule,
        update: async ({ data }: any) => {
          updates.push(data);
          return { ...opts.schedule, ...data };
        },
      },
      user: {
        findMany: async ({ where }: any) => {
          // O dublê confere que o serviço SEMPRE cruza com o vínculo ativo.
          if (where.currentContractStatus !== 'ACTIVE') {
            throw new Error('resolveAudience não filtrou por vínculo ativo!');
          }
          return opts.users;
        },
      },
      $transaction: async (fn: any) => fn(tx),
    } as any,
  };
}

const emitted: any[] = [];
const emitter: any = { emit: (name: string, ev: any) => emitted.push({ name, ev }) };

const baseSchedule = {
  id: 'sched-1',
  name: 'Aviso semanal',
  title: 'Aviso semanal de segurança',
  content: { blocks: [{ id: 'b1', type: 'paragraph', content: 'Use o EPI.' }] },
  isDismissible: true,
  requiresView: false,
  createdById: 'user-admin',
  displayDurationDays: 7,
  publishHour: 8,
  frequency: 'WEEKLY',
  frequencyCount: 1,
  weeklyConfig: {
    monday: true,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
  },
  monthlyConfig: null,
  yearlyConfig: null,
  targetType: 'SECTOR',
  targetUserIds: [],
  targetSectorIds: ['sector-1'],
  targetPositionIds: [],
  isActive: true,
  startsOn: null,
  endsOn: null,
  maxOccurrences: null,
  occurrenceCount: 0,
  nextRun: null,
};

async function main() {
  console.log('\n== A TRAVA: público que resolve para vazio ==');
  {
    const h = makePrisma({ schedule: { ...baseSchedule }, users: [] });
    emitted.length = 0;
    const svc = new MessageScheduleService(h.prisma, emitter);
    const r = await svc.materializeOccurrence('sched-1', new Date(2026, 7, 31));

    ok('devolve SKIPPED_NO_ITEMS', r.status === SCHEDULE_RUN_STATUS.SKIPPED_NO_ITEMS, r.status);
    ok('NENHUMA mensagem criada', h.created.length === 0, `criadas=${h.created.length}`);
    ok('NENHUM evento emitido (sem push)', emitted.length === 0, `eventos=${emitted.length}`);
    ok('motivo registrado', !!r.reason);
  }

  console.log('\n== Setor com gente: publica e endereça ==');
  {
    const h = makePrisma({
      schedule: { ...baseSchedule },
      users: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }],
    });
    emitted.length = 0;
    const svc = new MessageScheduleService(h.prisma, emitter);
    const r = await svc.materializeOccurrence('sched-1', new Date(2026, 7, 31));

    ok('SUCCESS', r.status === SCHEDULE_RUN_STATUS.SUCCESS);
    ok('uma mensagem criada', h.created.length === 1);
    ok('3 alvos gravados', h.targets.length === 3, `alvos=${h.targets.length}`);
    ok('mensagem nasce ACTIVE e publicada', h.created[0]?.status === 'ACTIVE' && !!h.created[0]?.publishedAt);
    ok('vinculada ao agendamento', h.created[0]?.scheduleId === 'sched-1');
    ok('evento message.published emitido', emitted[0]?.name === 'message.published');
    ok(
      'evento carrega os 3 alvos (não broadcast)',
      emitted[0]?.ev?.targetUserIds?.length === 3,
      `alvos no evento=${emitted[0]?.ev?.targetUserIds?.length}`,
    );

    const start: Date = h.created[0].startDate;
    const end: Date = h.created[0].endDate;
    ok('janela abre no dia da ocorrência', ymd(start) === '2026-08-31', ymd(start));
    // 7 dias CONTADOS A PARTIR do dia da ocorrência: 31/08 … 06/09.
    ok('janela fecha 7 dias depois, inclusive', ymd(end) === '2026-09-06', ymd(end));
    ok('janela fecha no último instante do dia', end.getHours() === 23 && end.getMinutes() === 59);
  }

  console.log('\n== Broadcast (targetType ALL) ==');
  {
    const h = makePrisma({
      schedule: { ...baseSchedule, targetType: 'ALL', targetSectorIds: [] },
      users: [],
    });
    emitted.length = 0;
    const svc = new MessageScheduleService(h.prisma, emitter);
    const r = await svc.materializeOccurrence('sched-1', new Date(2026, 7, 31));

    ok('SUCCESS', r.status === SCHEDULE_RUN_STATUS.SUCCESS);
    ok('mensagem criada', h.created.length === 1);
    ok('NENHUM MessageTarget (é assim que "todos" se representa)', h.targets.length === 0);
    ok('evento com lista vazia = broadcast', emitted[0]?.ev?.targetUserIds?.length === 0);
  }

  console.log('\n== Idempotência: a mesma data duas vezes ==');
  {
    const h = makePrisma({
      schedule: { ...baseSchedule },
      users: [{ id: 'u1' }],
      throwUniqueOnCreate: true,
    });
    emitted.length = 0;
    const svc = new MessageScheduleService(h.prisma, emitter);
    const r = await svc.materializeOccurrence('sched-1', new Date(2026, 7, 31));

    ok('P2002 vira SUCCESS silencioso', r.status === SCHEDULE_RUN_STATUS.SUCCESS);
    ok('nenhuma mensagem duplicada', r.message === null);
    ok('nenhum push repetido', emitted.length === 0);
  }

  console.log('\n== computeNextRun: hora de publicação e vigência ==');
  {
    const h = makePrisma({ schedule: { ...baseSchedule }, users: [] });
    const svc = new MessageScheduleService(h.prisma, emitter);

    // Quarta 26/08/2026, 10h → próxima segunda 31/08 às 8h.
    const next = svc.computeNextRun(
      { ...baseSchedule, publishHour: 8 } as any,
      null,
      new Date(2026, 7, 26, 10, 0, 0),
    );
    ok('próxima segunda', next ? ymd(next) === '2026-08-31' : false, next ? ymd(next) : 'null');
    ok('às 8h de São Paulo', next?.getHours() === 8, String(next?.getHours()));

    // No próprio dia da ocorrência, mas depois da hora: não repete hoje.
    const after = svc.computeNextRun(
      { ...baseSchedule, publishHour: 8 } as any,
      null,
      new Date(2026, 7, 31, 9, 0, 0),
    );
    ok(
      'já passou das 8h da segunda → vai para a seguinte',
      after ? ymd(after) === '2026-09-07' : false,
      after ? ymd(after) : 'null',
    );

    // Vigência começando no futuro.
    const later = svc.computeNextRun(
      { ...baseSchedule, publishHour: 8, startsOn: new Date(2026, 9, 1) } as any,
      null,
      new Date(2026, 7, 26, 10, 0, 0),
    );
    ok(
      'startsOn no futuro empurra o primeiro disparo',
      later ? later.getTime() >= new Date(2026, 9, 1).getTime() : false,
      later ? ymd(later) : 'null',
    );
  }

  console.log('\n== previewOccurrences: os três pedidos, ponta a ponta ==');
  {
    const h = makePrisma({ schedule: { ...baseSchedule }, users: [] });
    const svc = new MessageScheduleService(h.prisma, emitter);

    const weekly = svc.previewOccurrences(
      {
        name: 'x',
        title: 'x',
        contentBlocks: [{ id: 'a', type: 'paragraph' }],
        targetType: 'SECTOR' as any,
        targetSectorIds: ['s1'],
        frequency: 'WEEKLY' as any,
        weeklyConfig: { monday: true },
        publishHour: 8,
      } as any,
      3,
    );
    ok('semanal devolve 3 datas', weekly.length === 3, weekly.map(ymd).join(' '));
    ok('todas são segunda-feira', weekly.every(d => d.getDay() === 1));

    const firstMonday = svc.previewOccurrences(
      {
        name: 'x',
        title: 'x',
        contentBlocks: [{ id: 'a', type: 'paragraph' }],
        targetType: 'ALL' as any,
        frequency: 'MONTHLY' as any,
        monthlyConfig: { occurrence: 'FIRST', dayOfWeek: 'MONDAY' },
        publishHour: 8,
      } as any,
      3,
    );
    ok('1ª segunda devolve 3 datas', firstMonday.length === 3, firstMonday.map(ymd).join(' '));
    ok(
      'todas são segunda e caem nos 7 primeiros dias',
      firstMonday.every(d => d.getDay() === 1 && d.getDate() <= 7),
    );

    const dayFive = svc.previewOccurrences(
      {
        name: 'x',
        title: 'x',
        contentBlocks: [{ id: 'a', type: 'paragraph' }],
        targetType: 'ALL' as any,
        frequency: 'MONTHLY' as any,
        monthlyConfig: { dayOfMonth: 5 },
        publishHour: 8,
      } as any,
      3,
    );
    ok('dia 5 devolve 3 datas', dayFive.length === 3, dayFive.map(ymd).join(' '));
    ok('todas caem no dia 5', dayFive.every(d => d.getDate() === 5));

    // maxOccurrences limita a prévia tanto quanto limita a execução.
    const capped = svc.previewOccurrences(
      {
        name: 'x',
        title: 'x',
        contentBlocks: [{ id: 'a', type: 'paragraph' }],
        targetType: 'ALL' as any,
        frequency: 'WEEKLY' as any,
        weeklyConfig: { monday: true },
        maxOccurrences: 2,
      } as any,
      5,
    );
    ok('maxOccurrences corta a prévia', capped.length === 2, `${capped.length}`);
  }

  console.log('\n== Validação recusa configuração que nunca dispararia ==');
  {
    const h = makePrisma({ schedule: { ...baseSchedule }, users: [] });
    const svc = new MessageScheduleService(h.prisma, emitter);

    const cases: Array<[string, any]> = [
      ['semanal sem dia marcado', { frequency: 'WEEKLY', weeklyConfig: {} }],
      ['mensal sem dia nem ocorrência', { frequency: 'MONTHLY', monthlyConfig: {} }],
      ['ONCE não é recorrência', { frequency: 'ONCE' }],
      ['personalizada sem meses', { frequency: 'CUSTOM', customMonths: [] }],
    ];

    for (const [label, patch] of cases) {
      let threw = false;
      try {
        svc.previewOccurrences({
          name: 'x',
          title: 'x',
          contentBlocks: [{ id: 'a', type: 'paragraph' }],
          targetType: 'ALL',
          ...patch,
        } as any);
      } catch {
        threw = true;
      }
      ok(`recusa: ${label}`, threw);
    }
  }

  console.log(`\n${pass} ok, ${fail} falha(s)\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
