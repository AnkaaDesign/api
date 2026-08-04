/**
 * Smoke E2E do motor de custo de pintura, sem subir o servidor HTTP:
 * cria análise -> registra face apontando para uma arte real do layout database
 * -> roda o engine Python -> materializa -> MATCH -> STRATEGY -> PLAN -> imprime resumo.
 *
 * Run: npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/smoke-painting-analysis.ts [caminho-da-arte] [comprimento-cm]
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { PaintingAnalysisService } from '../modules/paint/painting-analysis/painting-analysis.service';
import { PaintingComputeService } from '../modules/paint/painting-analysis/painting-compute.service';
import { PaintingEngineRunnerService } from '../modules/paint/painting-analysis/engine-runner.service';

async function main() {
  const artPath = resolve(
    process.argv[2] ?? '../layout database/AVGLOG lateral.png',
  );
  const lengthCm = Number(process.argv[3] ?? 1470);
  if (!existsSync(artPath)) {
    throw new Error(`arte não encontrada: ${artPath}`);
  }

  const prisma = new PrismaService();
  const engineRunner = new PaintingEngineRunnerService();
  const computeService = new PaintingComputeService(prisma);
  const analysisService = new PaintingAnalysisService(prisma, {} as any, engineRunner, computeService);

  // file row pointing at the real artwork on disk (no upload needed for smoke)
  const file = await prisma.file.create({
    data: {
      filename: 'smoke-painting-art.png',
      originalName: artPath.split('/').pop() ?? 'art.png',
      mimetype: 'image/png',
      path: artPath,
      size: 0,
    },
  });

  const created = await analysisService.create({
    name: `SMOKE ${new Date().toISOString()}`,
    serviceContext: 'NEW_IMPLEMENT',
    substrate: 'CHAPA_FRISOS',
    alreadyPrepared: false,
  } as any);
  const analysisId = created.data.id;

  await analysisService.addFace(analysisId, {
    view: 'LEFT_SIDE',
    referenceKind: 'TOTAL_LENGTH',
    referenceValueCm: lengthCm,
    fileId: file.id,
  } as any);

  console.log('processando (engine Python)...');
  await analysisService.process(analysisId, {} as any);
  // process é assíncrono — aguardar status
  for (let i = 0; i < 240; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const current = await prisma.paintingAnalysis.findUnique({
      where: { id: analysisId },
      select: { status: true, processingError: true },
    });
    if (current?.status === 'REVIEW') break;
    if (current?.status === 'FAILED') {
      throw new Error(`engine falhou: ${current.processingError}`);
    }
  }

  // MATCH/STRATEGY/PLAN rodam automaticamente ao final do processamento.
  void computeService; // mantido para uso manual em depuração

  const full = await prisma.paintingAnalysis.findUnique({
    where: { id: analysisId },
    include: {
      faces: { include: { regions: { include: { paint: true } }, boundaries: true } },
      plan: { include: { steps: { include: { materials: true }, orderBy: { position: 'asc' } } } },
      alerts: true,
    },
  });

  const face = full!.faces[0];
  console.log('\n===== RESULTADO =====');
  console.log(`status: ${full!.status} | engine: ${full!.engineVersion}`);
  console.log(
    `face: ${face.widthCm?.toFixed(0)}x${face.heightCm?.toFixed(0)} cm | ` +
      `área ${face.areaM2?.toFixed(1)} m² | fundo ${face.backgroundMode} ${face.backgroundHex}`,
  );
  console.log(`regiões: ${face.regions.length} | fronteiras: ${face.boundaries.length} | alertas: ${full!.alerts.length}`);
  for (const region of face.regions.slice(0, 12)) {
    console.log(
      `  - ${region.engineId} ${region.colorHex} ${region.kind}/${region.strategy ?? '-'} ` +
        `${region.areaM2.toFixed(2)} m² -> tinta: ${region.paint?.name ?? '—'}`,
    );
  }
  const plan = full!.plan!;
  console.log(
    `\nplano: ${plan.steps.length} passos | ${plan.totalDays} dia(s) | ` +
      `${(plan.totalMinutes / 60).toFixed(1)} h trabalho + ${(plan.totalWaitMinutes / 60).toFixed(1)} h espera`,
  );
  console.log(
    `custos: material R$ ${plan.materialCost} | MO R$ ${plan.laborCost} (R$ ${plan.laborRatePerHour}/h) | ` +
      `indireto R$ ${plan.indirectCost} | TOTAL R$ ${plan.totalCost} | sugerido R$ ${plan.suggestedPrice}`,
  );
  for (const step of plan.steps) {
    const mats = step.materials.map((m) => `${m.label} ${m.quantity}${m.unit}`).join(', ');
    console.log(
      `  D${step.day} #${step.position} [${step.kind}] ${step.title} — ` +
        `${step.quantity}${step.quantityUnit ?? ''} | ${step.minutes.toFixed(0)} min` +
        `${step.waitMinutes ? ` (+${step.waitMinutes} min espera)` : ''} | R$ ${step.laborCost} MO` +
        (mats ? ` | ${mats}` : ''),
    );
  }

  // cleanup do registro smoke (mantém o File por FK — remove junto)
  await prisma.paintingAnalysis.delete({ where: { id: analysisId } });
  await prisma.file.delete({ where: { id: file.id } }).catch(() => undefined);
  await prisma.$disconnect();
  console.log('\nsmoke OK (registros de teste removidos)');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
