/**
 * Dispara a organização de arquivos AGORA, chamando o serviço real.
 *
 *   npx tsx scripts/run-file-organization.ts
 *
 * Usa `createApplicationContext` (mesmo padrão de src/scripts/backfill-fiscal-xml.ts):
 * sobe o container de DI sem abrir servidor HTTP e executa exatamente o mesmo método que
 * o cron das 04:00 executa — nada de reimplementar a lógica de mover num script paralelo,
 * que é como as duas definições de "órfão" divergiram em 2026-06.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { FileOrganizationSchedulerService } from '../src/modules/common/file/services/file-organization-scheduler.service';

async function main() {
  const logger = new Logger('RunFileOrganization');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const organizer = app.get(FileOrganizationSchedulerService);
    const stats = await organizer.performFileOrganization();
    logger.log('--- RESULTADO ---');
    logger.log(`arquivos varridos ....... ${stats.filesScanned}`);
    logger.log(`fora do lugar ........... ${stats.misplacedFilesFound}`);
    logger.log(`movidos ................. ${stats.filesMoved}`);
    logger.log(`pulados ................. ${stats.filesSkipped}`);
    logger.log(`erros ................... ${stats.errors.length}`);
    stats.errors.slice(0, 20).forEach(e => logger.warn(`  ${e}`));
  } finally {
    await app.close();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
