/**
 * make-kennedy-producao3-leader.ts
 * ---------------------------------------------------------------------------
 * Moves the Kennedy Campos account (Secullum smoke-test identity, Funcionario
 * 18) from "Produção 1" to "Produção 3" and makes him the LEADER of Produção 3,
 * keeping the ACTIVE CLT contract intact and the Secullum Funcionario mirrored.
 *
 * Two steps, both through the services (NOT raw SQL):
 *
 *   1) EmploymentContractService.update() on the active CLT contract (e1b9a682)
 *      -> sectorId = Produção 3. syncUserCurrentContract mirrors sectorId onto
 *      the User row, making the move DURABLE (a later contract-touching update
 *      won't stomp it back). employeeType=CLT / contractType=INDETERMINATE are
 *      left untouched.
 *
 *   2) UserService.update() -> sectorId = Produção 3, secullumHorarioId = 1,
 *      isSectorLeader = true. The isSectorLeader flag sets Sector.leaderId = this
 *      user on the target sector (Produção 3). onUserUpdated fires the Secullum
 *      push (Produção 3's secullumDepartamentoId = 3 -> Funcionario 18).
 *
 * Preserved: CPF, payrollNumber (150), secullumEmployeeId (18),
 * secullumSyncEnabled, the CLT/INDETERMINATE active contract, and the old
 * TERMINATED CLT contract (seq 1).
 *
 * Backups (pre-run): User_knp3backup20260706, EmploymentContract_knp3backup20260706,
 * Sector_knp3backup20260706.
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/make-kennedy-producao3-leader.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';
import { EmploymentContractService } from '../modules/personnel-department/employment-contract/employment-contract.service';

const KENNEDY_USER_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100';
const ACTIVE_CONTRACT_ID = 'e1b9a682-99f7-46ab-9cc3-f288fd526ee0'; // sole ACTIVE, CLT/INDETERMINATE
const PRODUCAO_3_SECTOR_ID = '74a9951d-9ecf-4ce9-8365-51680a0d45fa'; // PRODUCTION, secullumDepartamentoId=3, secullumHorarioId=1
const PRODUCAO_3_SECULLUM_HORARIO_ID = 1;

async function main(): Promise<void> {
  const logger = new Logger('MakeKennedyProducao3Leader');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const employmentContractService = app.get(EmploymentContractService);
    const userService = app.get(UserService);

    // 1) Move the active contract's sector -> Produção 3 (mirrors onto User).
    logger.log(
      `Updating active contract ${ACTIVE_CONTRACT_ID}: sectorId -> Produção 3`,
    );
    const contract = await employmentContractService.update(ACTIVE_CONTRACT_ID, {
      sectorId: PRODUCAO_3_SECTOR_ID,
    } as any);
    logger.log(
      `Contract update result: ${JSON.stringify((contract as any)?.data ?? contract)}`,
    );

    // 2) User update -> sector + horario + become leader of Produção 3.
    logger.log(
      `Updating user ${KENNEDY_USER_ID}: sectorId -> Produção 3, secullumHorarioId -> ${PRODUCAO_3_SECULLUM_HORARIO_ID}, isSectorLeader -> true`,
    );
    const user = await userService.update(KENNEDY_USER_ID, {
      sectorId: PRODUCAO_3_SECTOR_ID,
      secullumHorarioId: PRODUCAO_3_SECULLUM_HORARIO_ID,
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
