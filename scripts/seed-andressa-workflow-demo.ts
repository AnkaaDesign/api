/**
 * Demo data for the "Área Andressa" workflow review: airbrushing painter payments,
 * medical exams (admissional / periódico / demissional), terminations (rescisões) in
 * various stages, and a few leaves (afastamentos). Lets the financial Contas a Pagar +
 * the Medicina/DP screens be exercised end-to-end.
 *
 * Idempotent: demo rows are tagged ([SEED-DEMO]) and wiped + recreated on each run.
 * Also cleans the empty "Agendado" exam stubs left by the old create-on-click bug.
 *
 * Run:  npx tsx scripts/seed-andressa-workflow-demo.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TAG = '[SEED-DEMO]';
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400000);

async function cleanup() {
  // Demo-tagged records (delete exams first — they FK to terminations via SetNull).
  await prisma.medicalExam.deleteMany({ where: { notes: { contains: TAG } } });
  // Empty exam stubs from the old "Agendar" create-on-click bug.
  await prisma.medicalExam.deleteMany({
    where: { status: 'SCHEDULED', examDate: null, physicianName: null, scheduledAt: null, notes: null },
  });
  await prisma.termination.deleteMany({ where: { reason: { contains: TAG } } });
  await prisma.leave.deleteMany({ where: { notes: { contains: TAG } } });
  // Airbrushing has no text field; it is demo-only in this DB, so wipe all.
  await prisma.airbrushing.deleteMany({});
}

async function seedAirbrushing() {
  const tasks = await prisma.task.findMany({ select: { id: true, name: true }, take: 8, orderBy: { createdAt: 'desc' } });
  const painters = await prisma.user.findMany({ select: { id: true, name: true }, take: 4 });
  if (tasks.length === 0) return console.log('  airbrushing: no tasks, skipped');

  const rows = [
    { price: 850, paymentStatus: 'PENDING', status: 'COMPLETED', painter: 0 },
    { price: 1200, paymentStatus: 'PENDING', status: 'COMPLETED', painter: 1 },
    { price: 600, paymentStatus: 'PARTIALLY_PAID', status: 'COMPLETED', painter: 2 },
    { price: 450, paymentStatus: 'PENDING', status: 'COMPLETED', painter: null }, // sem pintor
    { price: 2000, paymentStatus: 'PAID', status: 'COMPLETED', painter: 0 }, // já pago (não aparece em CaP)
    { price: 320, paymentStatus: 'PENDING', status: 'IN_PRODUCTION', painter: 3 },
  ] as const;

  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const task = tasks[i % tasks.length];
    const painterId = r.painter !== null && painters[r.painter] ? painters[r.painter].id : null;
    await prisma.airbrushing.create({
      data: {
        taskId: task.id,
        price: r.price,
        paymentStatus: r.paymentStatus as any,
        status: r.status as any,
        painterId,
        startDate: daysFromNow(-10),
        finishDate: daysFromNow(i - 3),
        finishedAt: r.status === 'COMPLETED' ? daysFromNow(-2) : null,
      },
    });
    n++;
  }
  console.log(`  airbrushing: ${n} created (painters: ${painters.map(p => p.name).join(', ') || 'none'})`);
}

async function seedTerminations() {
  // Users with an active employment contract that are not already terminated.
  const contracts = await prisma.employmentContract.findMany({
    where: { status: 'ACTIVE' as any },
    select: { id: true, userId: true, user: { select: { name: true } } },
    take: 30,
  });
  const used = new Set<string>();
  const pick = () => contracts.find(c => !used.has(c.userId) && (used.add(c.userId), true));

  const plans = [
    { type: 'RESIGNATION', status: 'INITIATED', notice: 'WORKED', withExam: false },
    { type: 'WITHOUT_CAUSE', status: 'NOTICE_PERIOD', notice: 'INDEMNIFIED', withExam: false },
    { type: 'WITHOUT_CAUSE', status: 'MEDICAL_EXAM', notice: 'INDEMNIFIED', withExam: 'SCHEDULED' },
    { type: 'MUTUAL_AGREEMENT', status: 'CALCULATION', notice: 'WORKED', withExam: 'COMPLETED' },
    { type: 'EXPERIENCE_END', status: 'COMPLETED', notice: 'WAIVED', withExam: 'COMPLETED' },
  ] as const;

  let n = 0;
  for (const plan of plans) {
    const c = pick();
    if (!c) break;
    const term = await prisma.termination.create({
      data: {
        userId: c.userId,
        contractId: c.id,
        type: plan.type as any,
        status: plan.status as any,
        noticeType: plan.notice as any,
        noticeReduction: 'NONE',
        reason: `${TAG} rescisão de demonstração (${plan.type})`,
        terminationDate: daysFromNow(-(n * 5)),
      },
    });
    if (plan.withExam) {
      await prisma.medicalExam.create({
        data: {
          userId: c.userId,
          type: 'DISMISSAL',
          terminationId: term.id,
          status: plan.withExam as any,
          result: plan.withExam === 'COMPLETED' ? 'FIT' : 'PENDING',
          scheduledAt: daysFromNow(-3),
          examDate: plan.withExam === 'COMPLETED' ? daysFromNow(-1) : null,
          physicianName: plan.withExam === 'COMPLETED' ? 'Dra. Helena Martins' : null,
          crm: plan.withExam === 'COMPLETED' ? 'CRM/PR 45.221' : null,
          clinic: 'Clínica SaúdeOcupacional',
          notes: TAG,
        },
      });
    }
    n++;
  }
  console.log(`  terminations: ${n} created (+ dismissal exams)`);
}

async function seedAdmissionExams() {
  // Link admissional exams to existing admissions (admissionId FK).
  const admissions = await prisma.admission.findMany({
    where: { admissionExam: null },
    select: { id: true, userId: true },
    take: 6,
  });
  let n = 0;
  for (let i = 0; i < admissions.length; i++) {
    const a = admissions[i];
    const completed = i < 4; // 4 completed-fit, 2 scheduled
    await prisma.medicalExam.create({
      data: {
        userId: a.userId,
        type: 'ADMISSION',
        admissionId: a.id,
        status: completed ? 'COMPLETED' : 'SCHEDULED',
        result: completed ? 'FIT' : 'PENDING',
        scheduledAt: daysFromNow(-7 + i),
        examDate: completed ? daysFromNow(-5 + i) : null,
        physicianName: completed ? 'Dr. Rafael Souza' : null,
        crm: completed ? 'CRM/PR 38.110' : null,
        clinic: 'Clínica SaúdeOcupacional',
        expiresAt: completed ? daysFromNow(358) : null,
        notes: TAG,
      },
    });
    n++;
  }
  console.log(`  admissional exams: ${n} created (linked to admissions)`);
}

async function seedPeriodicExams() {
  const users = await prisma.user.findMany({ select: { id: true }, take: 20 });
  const specs = [
    { status: 'COMPLETED', result: 'FIT', expires: 120 },
    { status: 'COMPLETED', result: 'FIT_WITH_RESTRICTIONS', expires: 30 }, // vencendo
    { status: 'EXPIRED', result: 'FIT', expires: -20 }, // vencido
    { status: 'SCHEDULED', result: 'PENDING', expires: null },
    { status: 'COMPLETED', result: 'FIT', expires: 200 },
  ] as const;
  let n = 0;
  for (let i = 0; i < specs.length && i < users.length; i++) {
    const s = specs[i];
    await prisma.medicalExam.create({
      data: {
        userId: users[i].id,
        type: 'PERIODIC',
        status: s.status as any,
        result: s.result as any,
        periodicityMonths: 12,
        scheduledAt: daysFromNow(-30 + i),
        examDate: s.status === 'SCHEDULED' ? null : daysFromNow(s.expires != null ? s.expires - 365 : -10),
        expiresAt: s.expires != null ? daysFromNow(s.expires) : null,
        physicianName: s.status === 'SCHEDULED' ? null : 'Dr. Rafael Souza',
        clinic: 'Clínica SaúdeOcupacional',
        notes: TAG,
      },
    });
    n++;
  }
  console.log(`  periodic exams: ${n} created`);
}

async function seedLeaves() {
  const contracts = await prisma.employmentContract.findMany({
    where: { status: 'ACTIVE' as any },
    select: { userId: true },
    take: 40,
  });
  const ids = contracts.map(c => c.userId);
  const specs = [
    { type: 'ILLNESS_INSS', status: 'ACTIVE', cid: 'M54.5', start: -20, end: 40 },
    { type: 'MATERNITY', status: 'SCHEDULED', cid: null, start: 10, end: 130 },
    { type: 'ILLNESS_UP_TO_15', status: 'COMPLETED', cid: 'J11', start: -30, end: -22 },
    { type: 'WORK_ACCIDENT', status: 'ACTIVE', cid: 'S62.6', start: -5, end: 25 },
  ] as const;
  let n = 0;
  for (let i = 0; i < specs.length && i < ids.length; i++) {
    const s = specs[i];
    await prisma.leave.create({
      data: {
        userId: ids[ids.length - 1 - i], // pick from the end to avoid overlap with terminations
        type: s.type as any,
        status: s.status as any,
        startDate: daysFromNow(s.start),
        expectedEndDate: daysFromNow(s.end),
        actualEndDate: s.status === 'COMPLETED' ? daysFromNow(s.end) : null,
        cid: s.cid,
        notes: TAG,
      },
    });
    n++;
  }
  console.log(`  leaves: ${n} created`);
}

async function main() {
  console.log('\n=== Seed Andressa workflow demo ===\n');
  await cleanup();
  console.log('cleaned prior demo data + bug stubs');
  await seedAirbrushing();
  await seedTerminations();
  await seedAdmissionExams();
  await seedPeriodicExams();
  await seedLeaves();
  console.log('\nDone.\n');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
