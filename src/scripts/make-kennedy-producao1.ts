/**
 * make-kennedy-producao1.ts
 * ---------------------------------------------------------------------------
 * Makes the Kennedy Campos account (the Secullum smoke-test identity,
 * Funcionario 18) look like a genuine "Produção 1" sector employee, with its
 * employment contract aligned to that sector and the Secullum Funcionario
 * mirrored to Produção 1's department.
 *
 * Two steps, both through the services (NOT raw SQL) so all invariants,
 * mirrors and the Secullum push fire correctly:
 *
 *   1) EmploymentContractService.update() on the sole ACTIVE contract
 *      (TERCEIRIZADO, e1b9a682) -> sectorId = Produção 1. This makes
 *      syncUserCurrentContract mirror sectorId/positionId/payrollNumber from
 *      the contract onto the User row, so the sector change is DURABLE — a
 *      later contract-touching update won't stomp User.sectorId back to
 *      Administração (the mirror-stomp bug we hit before).
 *
 *   2) UserService.update() -> sectorId = Produção 1 + secullumHorarioId = 1.
 *      UserSecullumSyncService.onUserUpdated fires and pushes the sector's
 *      secullumDepartamentoId (3) to Funcionario 18. secullumHorarioId is set
 *      on the User for consistency with the Produção 1 sector (Secullum's
 *      schedule/horario itself is not part of this Funcionario upsert).
 *
 * Reversible via restore-kennedy-original-state.ts (moves the contract + user
 * back to Administração). CPF (11516167961), payrollNumber (150),
 * secullumEmployeeId (18) and secullumSyncEnabled are all left untouched.
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/make-kennedy-producao1.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';
import { EmploymentContractService } from '../modules/personnel-department/employment-contract/employment-contract.service';

const KENNEDY_USER_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100';
const ACTIVE_CONTRACT_ID = 'e1b9a682-99f7-46ab-9cc3-f288fd526ee0'; // TERCEIRIZADO, sole ACTIVE
const PRODUCAO_1_SECTOR_ID = '21ba944d-b722-48d7-b2ae-a158f2f33b19'; // PRODUCTION, secullumDepartamentoId=3, secullumHorarioId=1
const PRODUCAO_1_SECULLUM_HORARIO_ID = 1;

async function main(): Promise<void> {
  const logger = new Logger('MakeKennedyProducao1');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const employmentContractService = app.get(EmploymentContractService);
    const userService = app.get(UserService);

    // 1) Align the active contract's sector -> Produção 1 (mirrors onto User).
    logger.log(
      `Updating active contract ${ACTIVE_CONTRACT_ID}: sectorId -> ${PRODUCAO_1_SECTOR_ID} (Produção 1)`,
    );
    const contract = await employmentContractService.update(ACTIVE_CONTRACT_ID, {
      sectorId: PRODUCAO_1_SECTOR_ID,
    } as any);
    logger.log(
      `Contract update result: ${JSON.stringify((contract as any)?.data ?? contract)}`,
    );

    // 2) User update -> fires Secullum department push + sets horario.
    logger.log(
      `Updating user ${KENNEDY_USER_ID}: sectorId -> Produção 1, secullumHorarioId -> ${PRODUCAO_1_SECULLUM_HORARIO_ID}`,
    );
    const user = await userService.update(KENNEDY_USER_ID, {
      sectorId: PRODUCAO_1_SECTOR_ID,
      secullumHorarioId: PRODUCAO_1_SECULLUM_HORARIO_ID,
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
