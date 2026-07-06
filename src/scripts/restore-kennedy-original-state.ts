/**
 * restore-kennedy-original-state.ts
 * ---------------------------------------------------------------------------
 * Reverts the Kennedy Campos test account back to its real-world state after
 * an earlier Secullum-testing script (update-kennedy-secullum-test-sector.ts)
 * moved him into "Produção 1" to exercise PRODUCTION-sector Secullum flows.
 *
 * Target end state:
 *   - CLT contract (d29c1735) → TERMINATED (WITHOUT_CAUSE) — he was actually
 *     dismissed from the CLT role; it had wrongly been left ACTIVE, which is
 *     what caused the contract-mirror sync to stomp on User.payrollNumber
 *     earlier (two simultaneously-open contracts is an invariant violation —
 *     createContractForUserWithTransaction's own guard rejects that state).
 *   - TERCEIRIZADO contract (e1b9a682) stays the sole open/current contract.
 *   - sectorId back to "Administração" (ADMIN).
 *   - secullumEmployeeId (18) and cpf (real value) are left untouched.
 *
 * Goes through EmploymentContractService.update() then UserService.update()
 * (not raw SQL) so the Secullum mirror (department 3 → 2) and the
 * contract-status-transition guards / changelog all fire correctly.
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/restore-kennedy-original-state.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';
import { EmploymentContractService } from '../modules/personnel-department/employment-contract/employment-contract.service';
import { CONTRACT_STATUS, TERMINATION_TYPE } from '../constants/enums';

const KENNEDY_USER_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100';
const CLT_CONTRACT_ID = 'd29c1735-ba7f-4f6e-ad68-77a352e51a45';
const ADMINISTRACAO_SECTOR_ID = '35ddaa9e-071d-465e-8589-96dd476e6259';

async function main(): Promise<void> {
  const logger = new Logger('RestoreKennedyOriginalState');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const employmentContractService = app.get(EmploymentContractService);
    const userService = app.get(UserService);

    logger.log(`Terminating CLT contract ${CLT_CONTRACT_ID} (WITHOUT_CAUSE)`);
    const terminated = await employmentContractService.update(CLT_CONTRACT_ID, {
      status: CONTRACT_STATUS.TERMINATED,
      terminationType: TERMINATION_TYPE.WITHOUT_CAUSE,
    } as any);
    logger.log(`Contract termination result: ${JSON.stringify((terminated as any)?.data ?? terminated)}`);

    logger.log(`Reverting sectorId to Administração (${ADMINISTRACAO_SECTOR_ID})`);
    const updated = await userService.update(KENNEDY_USER_ID, {
      sectorId: ADMINISTRACAO_SECTOR_ID,
    } as any);
    logger.log(`User update result: ${JSON.stringify((updated as any)?.data ?? updated)}`);
  } catch (err) {
    exitCode = 1;
    logger.error('Restore failed', err instanceof Error ? err.stack : String(err));
  } finally {
    await app.close();
    process.exit(exitCode);
  }
}

main();
