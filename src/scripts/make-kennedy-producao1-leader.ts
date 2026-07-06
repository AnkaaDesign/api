/**
 * make-kennedy-producao1-leader.ts
 * ---------------------------------------------------------------------------
 * Temporarily moves the Kennedy Campos account (Secullum smoke-test identity,
 * Funcionario 18) into "Produção 1" and makes him its LEADER, releasing his
 * previous Produção 3 leadership. CLT active contract stays intact.
 *
 * Steps (services, NOT raw SQL, except the leaderId clear which has no sync):
 *
 *   1) EmploymentContractService.update() on the active CLT contract (e1b9a682)
 *      -> sectorId = Produção 1 (mirrors onto User, durable).
 *
 *   2) UserService.update() -> sectorId = Produção 1, secullumHorarioId = 1,
 *      isSectorLeader = true. Sets Sector.leaderId = kennedy on Produção 1
 *      (DISPLACING its prior leader 207525c0…) and fires the Secullum push.
 *
 *   3) Release Produção 3 leadership -> leaderId = null (its original state).
 *      The isSectorLeader=true branch only sets the TARGET sector; it does not
 *      clear other sectors this user leads, so Produção 3 must be cleared
 *      explicitly. leaderId is a plain FK with no Secullum side effect.
 *
 * "For a while" = temporary. To restore: set Produção 1 leaderId back to
 * 207525c0-2b6d-4683-bd66-c81f44fb9862 (see Sector_knp1lead20260706 /
 * Sector_knp3backup20260706 backups) and move kennedy wherever he should live.
 *
 * Backups (pre-run): Sector_knp1lead20260706, User_knp1lead20260706.
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/make-kennedy-producao1-leader.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';
import { EmploymentContractService } from '../modules/personnel-department/employment-contract/employment-contract.service';
import { PrismaService } from '../modules/common/prisma/prisma.service';

const KENNEDY_USER_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100';
const ACTIVE_CONTRACT_ID = 'e1b9a682-99f7-46ab-9cc3-f288fd526ee0'; // sole ACTIVE, CLT/INDETERMINATE
const PRODUCAO_1_SECTOR_ID = '21ba944d-b722-48d7-b2ae-a158f2f33b19'; // secullumDepartamentoId=3, secullumHorarioId=1
const PRODUCAO_3_SECTOR_ID = '74a9951d-9ecf-4ce9-8365-51680a0d45fa';
const PRODUCAO_1_SECULLUM_HORARIO_ID = 1;

async function main(): Promise<void> {
  const logger = new Logger('MakeKennedyProducao1Leader');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const employmentContractService = app.get(EmploymentContractService);
    const userService = app.get(UserService);
    const prisma = app.get(PrismaService);

    // 1) Move the active contract's sector -> Produção 1 (mirrors onto User).
    //    Idempotent — safe if a prior partial run already set it.
    logger.log(`Updating active contract ${ACTIVE_CONTRACT_ID}: sectorId -> Produção 1`);
    const contract = await employmentContractService.update(ACTIVE_CONTRACT_ID, {
      sectorId: PRODUCAO_1_SECTOR_ID,
    } as any);
    logger.log(`Contract update result: ${JSON.stringify((contract as any)?.data ?? contract)}`);

    // 2) Release Produção 3 leadership FIRST. Sector.leaderId is UNIQUE (a user
    //    leads at most one sector), so we must vacate Produção 3 before claiming
    //    Produção 1 — otherwise the User update hits "leaderId já está em uso".
    const p3 = await prisma.sector.findUnique({
      where: { id: PRODUCAO_3_SECTOR_ID },
      select: { leaderId: true },
    });
    if (p3?.leaderId === KENNEDY_USER_ID) {
      await prisma.sector.update({
        where: { id: PRODUCAO_3_SECTOR_ID },
        data: { leaderId: null },
      });
      logger.log('Released Produção 3 leadership (leaderId -> null)');
    } else {
      logger.log(`Produção 3 leader is ${p3?.leaderId ?? 'null'} — nothing to release`);
    }

    // 3) User update -> sector + horario + become leader of Produção 1
    //    (displaces prior leader 207525c0…), fires the Secullum push.
    logger.log(
      `Updating user ${KENNEDY_USER_ID}: sectorId -> Produção 1, secullumHorarioId -> ${PRODUCAO_1_SECULLUM_HORARIO_ID}, isSectorLeader -> true`,
    );
    const user = await userService.update(KENNEDY_USER_ID, {
      sectorId: PRODUCAO_1_SECTOR_ID,
      secullumHorarioId: PRODUCAO_1_SECULLUM_HORARIO_ID,
      isSectorLeader: true,
    } as any);
    logger.log(`User update result: ${JSON.stringify((user as any)?.data ?? user)}`);
  } catch (err) {
    exitCode = 1;
    logger.error('Failed', err instanceof Error ? err.stack : String(err));
  } finally {
    await app.close();
    process.exit(exitCode);
  }
}

main();
