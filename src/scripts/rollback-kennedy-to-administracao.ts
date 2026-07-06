/**
 * rollback-kennedy-to-administracao.ts
 * ---------------------------------------------------------------------------
 * Reverts the Kennedy Campos account (Secullum smoke-test identity, Funcionario
 * 18) out of "Produção 1" back to its normal "Administração" (ADMIN) state,
 * undoing make-kennedy-producao1.ts.
 *
 * Unlike the older restore-kennedy-original-state.ts, this ALSO moves the
 * active contract's sector back — otherwise the contract mirror
 * (syncUserCurrentContract) would stomp User.sectorId back to Produção 1 on the
 * next contract-touching update.
 *
 * Two steps, both through the services (NOT raw SQL):
 *   1) EmploymentContractService.update() on the sole ACTIVE contract
 *      (TERCEIRIZADO, e1b9a682) -> sectorId = Administração. Mirrors onto User.
 *   2) UserService.update() -> sectorId = Administração + secullumHorarioId = null
 *      (its original value). Fires the Secullum bridge, pushing the sector's
 *      secullumDepartamentoId (2) back to Funcionario 18.
 *
 * Leaves untouched: CPF (11516167961), payrollNumber (150),
 * secullumEmployeeId (18), secullumSyncEnabled, currentEmployeeType
 * (TERCEIRIZADO), and the already-TERMINATED CLT contract.
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/rollback-kennedy-to-administracao.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';
import { EmploymentContractService } from '../modules/personnel-department/employment-contract/employment-contract.service';

const KENNEDY_USER_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100';
const ACTIVE_CONTRACT_ID = 'e1b9a682-99f7-46ab-9cc3-f288fd526ee0'; // TERCEIRIZADO, sole ACTIVE
const ADMINISTRACAO_SECTOR_ID = '35ddaa9e-071d-465e-8589-96dd476e6259'; // ADMIN, secullumDepartamentoId=2

async function main(): Promise<void> {
  const logger = new Logger('RollbackKennedyToAdministracao');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const employmentContractService = app.get(EmploymentContractService);
    const userService = app.get(UserService);

    // 1) Move the active contract's sector back -> Administração (mirrors onto User).
    logger.log(
      `Updating active contract ${ACTIVE_CONTRACT_ID}: sectorId -> ${ADMINISTRACAO_SECTOR_ID} (Administração)`,
    );
    const contract = await employmentContractService.update(ACTIVE_CONTRACT_ID, {
      sectorId: ADMINISTRACAO_SECTOR_ID,
    } as any);
    logger.log(
      `Contract update result: ${JSON.stringify((contract as any)?.data ?? contract)}`,
    );

    // 2) User update -> fires Secullum department push (2) + clears horario.
    logger.log(
      `Updating user ${KENNEDY_USER_ID}: sectorId -> Administração, secullumHorarioId -> null`,
    );
    const user = await userService.update(KENNEDY_USER_ID, {
      sectorId: ADMINISTRACAO_SECTOR_ID,
      secullumHorarioId: null,
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
