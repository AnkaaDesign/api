/**
 * Teste ponta a ponta da emissão automática de NFS-e do aerografista, em
 * HOMOLOGAÇÃO (ambiente 2 — produção restrita).
 *
 * Cria uma tarefa e uma aerografia PRÓPRIAS, nunca toca em trabalho real, e as
 * conclui pelo caminho de verdade (AirbrushingService.update), que é o que dispara
 * o registro de intenção e o flush pós-commit. Depois confere o que a SEFIN
 * devolveu e quais artefatos foram arquivados.
 *
 * `--limpar` desfaz tudo o que o `--criar` criou, na ordem certa das FKs.
 *
 * TRAVA: recusa rodar se o perfil do pintor estiver em ambiente 1 (Produção). Um
 * "teste" que emite nota com validade jurídica não é teste — e não dá para
 * desfazer, só cancelar.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/nfse-homolog-test.ts --criar
 *   npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/nfse-homolog-test.ts --limpar
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { AirbrushingService } from '../modules/production/airbrushing/airbrushing.service';
import { getAirbrushingStatusOrder, getTaskStatusOrder } from '../utils/sortOrder';

/** Nome deliberadamente gritante: ninguém confunde com tarefa real na agenda. */
const TASK_NAME = 'HOMOLOGACAO NFS-e — NAO USAR';
const PAINTER_EMAIL = 'marcos@gmail.com';
const PRICE = 5;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const airbrushings = app.get(AirbrushingService);

  try {
    if (flag('limpar')) {
      const task = await prisma.task.findFirst({
        where: { name: TASK_NAME },
        select: { id: true, airbrushings: { select: { id: true } } },
      });
      if (!task) {
        console.log('Nada a limpar — a tarefa de homologação não existe.');
        return;
      }

      for (const ab of task.airbrushings) {
        const nfse = await prisma.airbrushingNfse.findUnique({
          where: { airbrushingId: ab.id },
          select: { id: true, pdfFileId: true, xmlFileId: true, fiscalDocumentId: true, accessKey: true },
        });
        if (nfse) {
          console.log(`  nota ${nfse.accessKey ?? '(sem chave)'} — removendo artefatos`);
          await prisma.airbrushingNfse.delete({ where: { id: nfse.id } });
          if (nfse.fiscalDocumentId) {
            await prisma.fiscalDocument
              .delete({ where: { id: nfse.fiscalDocumentId } })
              .catch(() => console.log('    (documento fiscal já removido)'));
          }
          for (const fileId of [nfse.pdfFileId, nfse.xmlFileId]) {
            if (!fileId) continue;
            await prisma.file
              .delete({ where: { id: fileId } })
              .catch(() => console.log(`    (arquivo ${fileId} já removido)`));
          }
        }
        await prisma.fiscalDpsSequence.deleteMany({ where: {} }).catch(() => undefined);
      }

      // A aerografia cai por cascade da tarefa (onDelete: Cascade em Airbrushing.task).
      await prisma.task.delete({ where: { id: task.id } });
      console.log(`Tarefa de homologação removida (${task.id}) com sua aerografia.`);
      return;
    }

    // ── criar ────────────────────────────────────────────────────────────────
    const painter = await prisma.user.findFirst({
      where: { email: { equals: PAINTER_EMAIL, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (!painter) throw new Error(`Pintor ${PAINTER_EMAIL} não encontrado.`);

    const profile = await prisma.fiscalEmitterProfile.findUnique({
      where: { userId: painter.id },
      select: { environment: true, emissionEnabled: true, cnpj: true },
    });
    if (!profile) throw new Error('Pintor sem perfil fiscal — rode o provisionamento antes.');
    if (profile.environment !== 2) {
      throw new Error(
        `RECUSADO: perfil está em ambiente ${profile.environment} (Produção). Teste só roda em ambiente 2 (produção restrita) — emitir nota real não é teste.`,
      );
    }
    if (!profile.emissionEnabled) throw new Error('Emissão desligada no perfil do pintor.');

    console.log(`Pintor: ${painter.name} · CNPJ ${profile.cnpj} · ambiente ${profile.environment}`);

    let task = await prisma.task.findFirst({ where: { name: TASK_NAME }, select: { id: true } });
    if (!task) {
      task = await prisma.task.create({
        data: {
          name: TASK_NAME,
          details: 'Tarefa de homologação da NFS-e do aerografista. Pode ser excluída.',
          status: 'IN_PRODUCTION',
          statusOrder: getTaskStatusOrder('IN_PRODUCTION'),
          entryDate: new Date(),
          startedAt: new Date(),
        },
        select: { id: true },
      });
      console.log(`Tarefa criada: ${task.id}`);
    } else {
      console.log(`Tarefa reaproveitada: ${task.id}`);
    }

    let ab = await prisma.airbrushing.findFirst({ where: { taskId: task.id }, select: { id: true } });
    if (!ab) {
      ab = await prisma.airbrushing.create({
        data: {
          taskId: task.id,
          painterId: painter.id,
          price: PRICE,
          description: 'Aerografia de homologação — emissão de NFS-e',
          status: 'IN_PRODUCTION',
          statusOrder: getAirbrushingStatusOrder('IN_PRODUCTION'),
          startedAt: new Date(),
        },
        select: { id: true },
      });
      console.log(`Aerografia criada: ${ab.id} (R$ ${PRICE})`);
    } else {
      await prisma.airbrushing.update({
        where: { id: ab.id },
        data: { status: 'IN_PRODUCTION', statusOrder: getAirbrushingStatusOrder('IN_PRODUCTION'), finishedAt: null },
      });
      await prisma.airbrushingNfse.deleteMany({ where: { airbrushingId: ab.id } });
      console.log(`Aerografia reposta em produção: ${ab.id}`);
    }

    console.log('\nConcluindo a aerografia pelo caminho real (dispara intenção + emissão)...');
    await airbrushings.update(ab.id, { status: 'COMPLETED' } as never);

    // A emissão é pós-commit e best-effort; esperar é o jeito de observar.
    for (let i = 0; i < 20; i++) {
      const row = await prisma.airbrushingNfse.findUnique({
        where: { airbrushingId: ab.id },
        select: { status: true, accessKey: true, errorMessage: true, nDps: true, environment: true, pdfFileId: true, xmlFileId: true, fiscalDocumentId: true },
      });
      if (row && row.status !== 'PENDING' && row.status !== 'PROCESSING') {
        console.log('\n── RESULTADO ──────────────────────────────────────────────');
        console.log(`status .......... ${row.status}`);
        console.log(`ambiente ........ ${row.environment} (2 = produção restrita)`);
        console.log(`nDPS ............ ${row.nDps ?? '-'}`);
        console.log(`chave ........... ${row.accessKey ?? '-'}`);
        console.log(`erro ............ ${row.errorMessage ?? '-'}`);
        console.log(`DANFSe (PDF) .... ${row.pdfFileId ?? 'não arquivado'}`);
        console.log(`XML ............. ${row.xmlFileId ?? 'não arquivado'}`);
        console.log(`documento fiscal  ${row.fiscalDocumentId ?? 'não criado'}`);
        console.log(`\naerografia ...... ${ab.id}`);
        console.log(`tarefa .......... ${task.id}`);
        return;
      }
      await sleep(3000);
    }
    console.log('Tempo esgotado esperando a nota sair de PENDING/PROCESSING.');
  } finally {
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`\nFALHOU: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
