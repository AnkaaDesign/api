/**
 * Demo data for "Advertências" (workplace disciplinary warnings).
 *
 * Creates a realistic, Brazilian-Portuguese set of warnings across active
 * collaborators, covering every severity (VERBAL → WRITTEN → SUSPENSION →
 * FINAL_WARNING) and a spread of categories, with a mix of active ("Ativa")
 * and resolved ("Resolvida") statuses so the feature looks populated.
 *
 * Idempotent: every row is tagged with [SEED-DEMO] in `hrNotes` and is wiped +
 * recreated on each run. Safe to re-run.
 *
 * Run:  cd api && npx tsx scripts/seed-warnings-demo.ts
 */
import { PrismaClient, WarningSeverity, WarningCategory } from '@prisma/client';

const prisma = new PrismaClient();
const TAG = '[SEED-DEMO]';

const today = new Date();
const addDays = (base: Date, n: number) => new Date(base.getTime() + n * 86400000);

const SEVERITY_ORDER: Record<WarningSeverity, number> = {
  VERBAL: 1,
  WRITTEN: 2,
  SUSPENSION: 3,
  FINAL_WARNING: 4,
};

// Realistic disciplinary scenarios in pt-BR. `daysAgo` is when it was emitted.
type Scenario = {
  severity: WarningSeverity;
  category: WarningCategory;
  reason: string;
  description: string;
  hrNotes: string;
  daysAgo: number;
  followUpInDays: number; // relative to emission date
  resolved: boolean;
  suspensionDays?: number;
};

const SCENARIOS: Scenario[] = [
  {
    severity: 'VERBAL',
    category: 'ATTENDANCE',
    reason: 'Atrasos recorrentes no início do expediente',
    description:
      'O colaborador registrou três atrasos superiores a 15 minutos na última semana, sem justificativa prévia ' +
      'comunicada à liderança. Orientado verbalmente quanto à importância da pontualidade e do registro correto do ponto.',
    hrNotes: 'Primeira ocorrência formal. Acompanhar batidas de ponto nas próximas duas semanas.',
    daysAgo: 8,
    followUpInDays: 15,
    resolved: false,
  },
  {
    severity: 'VERBAL',
    category: 'BEHAVIOR',
    reason: 'Uso de celular durante a operação de máquina',
    description:
      'Identificado uso de telefone pessoal durante a operação de equipamento, contrariando a orientação da equipe. ' +
      'Conversa de alinhamento realizada no próprio dia, reforçando as regras de uso de dispositivos no setor produtivo.',
    hrNotes: 'Colaborador receptivo à orientação. Sem reincidência até o momento.',
    daysAgo: 22,
    followUpInDays: 20,
    resolved: true,
  },
  {
    severity: 'WRITTEN',
    category: 'SAFETY',
    reason: 'Não utilização de Equipamento de Proteção Individual (EPI)',
    description:
      'Colaborador flagrado executando atividade na cabine de pintura sem máscara respiratória e sem óculos de proteção, ' +
      'mesmo após orientação verbal anterior. Conduta expõe o colaborador a risco à saúde e descumpre a NR-6.',
    hrNotes: 'Reincidência após advertência verbal. Encaminhada cópia ao prontuário. Reforçar treinamento de EPIs.',
    daysAgo: 12,
    followUpInDays: 30,
    resolved: false,
  },
  {
    severity: 'WRITTEN',
    category: 'PERFORMANCE',
    reason: 'Queda de produtividade e retrabalho acima do aceitável',
    description:
      'Índice de retrabalho do colaborador ultrapassou a meta do setor por dois meses consecutivos, gerando atraso ' +
      'na entrega de pedidos. Definido plano de acompanhamento com a liderança para recuperação dos indicadores.',
    hrNotes: 'Plano de desenvolvimento (PDI) iniciado. Reavaliar no fim do período de acompanhamento.',
    daysAgo: 30,
    followUpInDays: 30,
    resolved: false,
  },
  {
    severity: 'WRITTEN',
    category: 'POLICY_VIOLATION',
    reason: 'Saída do setor sem autorização da liderança',
    description:
      'Colaborador ausentou-se do posto de trabalho por período prolongado, sem comunicar o supervisor, ' +
      'descumprindo o regulamento interno de circulação entre setores.',
    hrNotes: 'Documento assinado pelo colaborador com ressalvas. Arquivado no DP.',
    daysAgo: 45,
    followUpInDays: 25,
    resolved: true,
  },
  {
    severity: 'SUSPENSION',
    category: 'INSUBORDINATION',
    reason: 'Recusa em cumprir orientação direta do supervisor',
    description:
      'Após advertência escrita anterior, o colaborador recusou-se a executar tarefa solicitada pelo supervisor e ' +
      'manteve postura desrespeitosa diante da equipe. Aplicada suspensão disciplinar nos termos do art. 474 da CLT.',
    hrNotes: 'Terceira ocorrência. Suspensão de 2 dias. Testemunhas registradas. Acompanhar reintegração.',
    daysAgo: 18,
    followUpInDays: 30,
    resolved: false,
    suspensionDays: 2,
  },
  {
    severity: 'SUSPENSION',
    category: 'MISCONDUCT',
    reason: 'Dano a equipamento por negligência',
    description:
      'Operação inadequada de empilhadeira resultou em dano ao equipamento e à mercadoria armazenada. ' +
      'Apuração interna concluiu por negligência. Aplicada suspensão de 3 dias e reciclagem obrigatória de operação.',
    hrNotes: 'Suspensão de 3 dias cumprida. Treinamento de reciclagem concluído. Caso encerrado.',
    daysAgo: 60,
    followUpInDays: 20,
    resolved: true,
    suspensionDays: 3,
  },
  {
    severity: 'FINAL_WARNING',
    category: 'MISCONDUCT',
    reason: 'Reincidência grave após suspensão disciplinar',
    description:
      'Apesar de advertências verbal, escrita e suspensão anteriores pelos mesmos motivos, o colaborador manteve ' +
      'conduta inadequada. Esta é a última advertência antes de eventual desligamento por justa causa.',
    hrNotes: 'ATENÇÃO: última advertência. Próxima ocorrência pode fundamentar rescisão por justa causa (art. 482 CLT).',
    daysAgo: 5,
    followUpInDays: 30,
    resolved: false,
  },
];

async function main(): Promise<void> {
  console.log('=== Seed Advertências (demo) ===');

  // Wipe previously seeded rows (idempotent).
  const removed = await prisma.warning.deleteMany({ where: { hrNotes: { contains: TAG } } });
  if (removed.count > 0) console.log(`  Removidas ${removed.count} advertências de seed anteriores.`);

  const users = await prisma.user.findMany({
    where: { currentContractStatus: { not: 'TERMINATED' as any } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  if (users.length < 2) {
    console.log('  São necessários ao menos 2 colaboradores ativos. Nada a fazer.');
    return;
  }

  // Supervisor pool = first few collaborators; each warning's supervisor must differ
  // from the colaborador. Rotate collaborators and supervisors so data looks varied.
  const supervisorPool = users.slice(0, Math.min(3, users.length));

  let created = 0;
  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    const collaborator = users[i % users.length];
    const supervisor =
      supervisorPool.find((u) => u.id !== collaborator.id) ??
      users.find((u) => u.id !== collaborator.id)!;

    const emittedAt = addDays(today, -s.daysAgo);
    const followUpDate = addDays(emittedAt, s.followUpInDays);

    await prisma.warning.create({
      data: {
        collaboratorId: collaborator.id,
        supervisorId: supervisor.id,
        category: s.category,
        severity: s.severity,
        severityOrder: SEVERITY_ORDER[s.severity],
        reason: s.reason,
        description: s.description,
        suspensionDays: s.suspensionDays ?? null,
        isActive: !s.resolved,
        resolvedAt: s.resolved ? addDays(emittedAt, s.followUpInDays) : null,
        followUpDate,
        hrNotes: `${s.hrNotes} ${TAG}`,
        createdAt: emittedAt,
      },
    });
    created++;
    console.log(
      `  + ${s.severity.padEnd(13)} ${s.resolved ? 'Resolvida' : 'Ativa    '} — ${collaborator.name} (${s.category})`,
    );
  }

  console.log(`\nConcluído: ${created} advertências criadas.`);
}

main()
  .catch((error) => {
    console.error('Seed falhou:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
