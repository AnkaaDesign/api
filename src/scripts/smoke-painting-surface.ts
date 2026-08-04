/**
 * Smoke do Programa A (superfície / pintura geral): cria uma análise sem arte,
 * roda o PLAN e imprime os passos, sub-tarefas e a composição de custo.
 *
 * Uso: npx ts-node -r tsconfig-paths/register --transpile-only \
 *        src/scripts/smoke-painting-surface.ts [POLIESTER|ACRILICO|LACA|PU]
 */
import { PrismaClient } from '@prisma/client';
import { PaintingComputeService } from '../modules/paint/painting-analysis/painting-compute.service';

const prisma = new PrismaClient();

const money = (value: unknown) => `R$ ${Number(value).toFixed(2)}`;

async function main() {
  const systemKey = (process.argv[2] ?? 'POLIESTER').toUpperCase();
  const system = await prisma.paintingPaintSystem.findUnique({ where: { key: systemKey } });
  if (!system) throw new Error(`Sistema de pintura "${systemKey}" não existe. Rode npm run seed:painting.`);

  const target = await prisma.paint.findFirst({
    where: { paintTypeId: system.paintTypeId ?? undefined },
    select: { id: true, name: true, hex: true },
  });

  const analysis = await prisma.paintingAnalysis.create({
    data: {
      name: `SMOKE superfície ${systemKey} ${new Date().toISOString()}`,
      // Refrigerado ⇒ Thermo King inferido; largura/teto/chassi/frames idem.
      substrate: 'OUTRO',
      generalPaint: true,
      paintSystemKey: systemKey,
      targetPaintId: target?.id ?? null,
      lengthCm: 1400,
      heightCm: 260,
    },
  });

  // Quem liga a pintura geral é a ARTE: o smoke cria uma face com o fundo já
  // classificado como GENERAL_PAINT, que é o que o motor grava ao processar.
  const anyFile = await prisma.file.findFirst({ select: { id: true } });
  if (!anyFile) throw new Error('Nenhum File no banco para anexar a face do smoke.');
  await prisma.paintingAnalysisFace.create({
    data: {
      analysisId: analysis.id,
      view: 'LEFT_SIDE',
      fileId: anyFile.id,
      referenceKind: 'TOTAL_LENGTH',
      referenceValueCm: 1400,
      widthCm: 1400,
      heightCm: 260,
      areaM2: 36.4,
      backgroundMode: 'GENERAL_PAINT',
      backgroundPaintId: target?.id ?? null,
      backgroundHex: target?.hex ?? null,
      processedAt: new Date(),
    },
  });

  const service = new PaintingComputeService(prisma as any);
  await service.compute(analysis.id, { stages: ['PLAN'] });

  const plan = await prisma.paintingProductionPlan.findUnique({
    where: { analysisId: analysis.id },
    include: {
      steps: {
        include: { materials: { orderBy: { position: 'asc' } }, tasks: { orderBy: { position: 'asc' } } },
        orderBy: { position: 'asc' },
      },
    },
  });
  if (!plan) throw new Error('Plano não foi gerado.');

  console.log(`\nSistema: ${system.label} — cor alvo: ${target?.name ?? '(nenhuma)'}`);
  console.log(`Mistura: ${system.mixBase}:${system.mixCatalyst}:${system.mixThinner} (tinta:catalisador:diluente)\n`);

  for (const step of plan.steps) {
    console.log(`${String(step.position).padStart(2)} ${step.kind.padEnd(14)} ${step.title}`);
    for (const task of step.tasks) {
      const crew = task.crewSize > 1 ? ` (${task.crewSize} pessoas)` : '';
      console.log(`      · ${task.label}${crew} — ${task.minutes} min [${task.basisQuantity} ${task.basisUnit ?? ''}]`);
    }
    for (const material of step.materials) {
      console.log(
        `      • ${material.label.padEnd(38)} ${String(material.quantity).padStart(8)} ${material.unit.padEnd(3)}` +
          ` × ${money(material.unitPriceSnapshot)} = ${money(material.totalCost)}`,
      );
    }
    console.log(`      mão de obra ${money(step.laborCost)} | material ${money(step.materialCost)}\n`);
  }

  console.log(
    `TOTAIS: ${plan.totalMinutes} min de trabalho, ${plan.totalWaitMinutes} min de espera, ${plan.totalDays} dia(s)\n` +
      `material ${money(plan.materialCost)} + mão de obra ${money(plan.laborCost)} + indiretos ${money(plan.indirectCost)}\n` +
      `custo ${money(plan.totalCost)} → preço sugerido ${money(plan.suggestedPrice)}`,
  );

  const alerts = await prisma.paintingAnalysisAlert.findMany({ where: { analysisId: analysis.id } });
  for (const alert of alerts) console.log(`ALERTA [${alert.severity}] ${alert.code}: ${alert.message}`);

  await prisma.paintingAnalysis.delete({ where: { id: analysis.id } });
  console.log('\n(análise de smoke removida)');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
