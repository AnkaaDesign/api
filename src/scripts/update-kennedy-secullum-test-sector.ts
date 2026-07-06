/**
 * update-kennedy-secullum-test-sector.ts
 * ---------------------------------------------------------------------------
 * One-off: moves the Kennedy Campos test account into the "Produção 1" sector
 * and sets a real CPF, so the Secullum smoke-test account has all fields the
 * PRODUCTION sector needs to fully exercise Secullum sync (department mirror,
 * time-clock/schedule flows tied to a real production sector).
 *
 * Goes through UserService.update() (not raw SQL) so UserSecullumSyncService
 * .onUserUpdated fires and mirrors the sector's Secullum DepartamentoId to
 * the already-linked Funcionario (id 18).
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/update-kennedy-secullum-test-sector.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';

const KENNEDY_USER_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100';
const PRODUCAO_1_SECTOR_ID = '21ba944d-b722-48d7-b2ae-a158f2f33b19';
const KENNEDY_CPF = '11516167961';

async function main(): Promise<void> {
  const logger = new Logger('UpdateKennedySecullumTestSector');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const userService = app.get(UserService);

    logger.log(
      `Updating user ${KENNEDY_USER_ID}: sectorId -> ${PRODUCAO_1_SECTOR_ID} (Produção 1), cpf set`,
    );

    const result = await userService.update(KENNEDY_USER_ID, {
      sectorId: PRODUCAO_1_SECTOR_ID,
      cpf: KENNEDY_CPF,
    } as any);

    logger.log(`Update succeeded: ${JSON.stringify((result as any)?.data ?? result)}`);
  } catch (err) {
    exitCode = 1;
    logger.error('Update failed', err instanceof Error ? err.stack : String(err));
  } finally {
    await app.close();
    process.exit(exitCode);
  }
}

main();
