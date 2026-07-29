/**
 * reenable-test-user.ts
 * ---------------------------------------------------------------------------
 * Readmits the "Usuário Teste" account (plotter.ankaa@gmail.com, Funcionario 90)
 * so it can be used again to exercise features end-to-end:
 *
 *   - ACTIVE employment contract (login is gated on
 *     `User.currentContractStatus === ACTIVE` — see `isUserEmployed` in
 *     `src/utils/contract.ts`, enforced by AuthService/AuthGuard);
 *   - PRODUCTION sector (Produção 1, secullumDepartamentoId = 3);
 *   - active (not dismissed) on the Secullum side.
 *
 * Three steps, all through the services (NOT raw SQL), because
 * `UserSecullumSyncService.onUserUpdated` only fires from inside
 * `UserService.update()` — a direct DB write would leave the Secullum
 * Funcionario record drifting.
 *
 *   1) EmploymentContractService.create() -> NEW contract, sequence 2.
 *      `TERMINATED -> ACTIVE` is an illegal status transition
 *      (CONTRACT_STATUS_TRANSITIONS), so a readmission is a NEW higher-sequence
 *      contract, never a revived one. The old seq-1 contract stays TERMINATED
 *      as history and is flipped isCurrent=false by the create path.
 *      CLT/INDETERMINATE (no experience period — this is a readmission of a
 *      test account, and INDETERMINATE avoids spurious experience-phase
 *      warnings). syncUserCurrentContract mirrors status/sector/position/
 *      payrollNumber onto the User row.
 *
 *   2) UserService.update() -> secullumSyncEnabled = true (+ sector/horario
 *      restated so the mirror is explicit). This fires the Secullum bridge,
 *      which recomputes `Demissao` from `currentContract.terminationDate`
 *      (now null) and clears `Invisivel` — i.e. un-dismisses Funcionario 90
 *      in the Secullum UI.
 *
 *   3) Re-read Funcionario 90 and print Demissao/Invisivel/DepartamentoId so
 *      the Secullum side is verified, not assumed.
 *
 * NOT touched: password, email, CPF (37071234566), PIS, payrollNumber (200),
 * secullumEmployeeId (90), the TERMINATED seq-1 contract.
 *
 * Backups (pre-run): User_testbackup20260729, EmploymentContract_testbackup20260729.
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/reenable-test-user.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';
import { EmploymentContractService } from '../modules/personnel-department/employment-contract/employment-contract.service';
import { SecullumCadastrosService } from '../modules/integrations/secullum/secullum-cadastros.service';

const TEST_USER_ID = '680a0485-d1f4-4bcc-9422-235df670d037'; // Usuário Teste
const PRODUCAO_1_SECTOR_ID = '21ba944d-b722-48d7-b2ae-a158f2f33b19'; // PRODUCTION, secullumDepartamentoId=3
const POSITION_ID = '561c3b25-c018-4275-aa9a-7bd211539afa'; // Junior IV, secullumFuncaoId=2
const PAYROLL_NUMBER = 200;
const SECULLUM_HORARIO_ID = 1;
const SECULLUM_FUNCIONARIO_ID = 90;

// Readmission date: today (America/Sao_Paulo midnight, matching how the other
// contract dates are stored).
const READMISSION_DATE = new Date('2026-07-29T03:00:00.000Z');

function describeFuncionario(f: any): string {
  return JSON.stringify({
    Id: f?.Id,
    Nome: f?.Nome,
    Demissao: f?.Demissao ?? null,
    Invisivel: f?.Invisivel ?? null,
    DepartamentoId: f?.DepartamentoId ?? null,
    FuncaoId: f?.FuncaoId ?? null,
    NumeroFolha: f?.NumeroFolha ?? null,
  });
}

async function main(): Promise<void> {
  const logger = new Logger('ReenableTestUser');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const employmentContractService = app.get(EmploymentContractService);
    const userService = app.get(UserService);
    const cadastros = app.get(SecullumCadastrosService);

    // 0) Secullum state BEFORE, so the diff is observable.
    try {
      const before = await cadastros.getFuncionarioFull(SECULLUM_FUNCIONARIO_ID);
      logger.log(`Secullum BEFORE: ${describeFuncionario(before)}`);
    } catch (err) {
      logger.warn(
        `Could not read Secullum Funcionario ${SECULLUM_FUNCIONARIO_ID} before the change: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // 1) New ACTIVE contract (readmission, sequence = max+1).
    logger.log(`Creating readmission contract for user ${TEST_USER_ID}`);
    const contract = await employmentContractService.create({
      userId: TEST_USER_ID,
      employeeType: 'CLT',
      contractType: 'INDETERMINATE',
      payrollNumber: PAYROLL_NUMBER,
      positionId: POSITION_ID,
      sectorId: PRODUCAO_1_SECTOR_ID,
      admissionDate: READMISSION_DATE,
      effectedAt: READMISSION_DATE,
    } as any);
    logger.log(
      `Contract create result: ${JSON.stringify((contract as any)?.data ?? contract)}`,
    );

    // 2) User update -> enables the Secullum push and clears Demissao/Invisivel.
    logger.log(
      `Updating user ${TEST_USER_ID}: secullumSyncEnabled -> true, sector -> Produção 1, horario -> ${SECULLUM_HORARIO_ID}`,
    );
    const user = await userService.update(TEST_USER_ID, {
      sectorId: PRODUCAO_1_SECTOR_ID,
      positionId: POSITION_ID,
      secullumSyncEnabled: true,
      secullumHorarioId: SECULLUM_HORARIO_ID,
    } as any);
    logger.log(`User update result: ${JSON.stringify((user as any)?.data ?? user)}`);
    logger.log(
      `Secullum bridge result: ${JSON.stringify((user as any)?.secullumSync ?? null)}`,
    );

    // 3) Secullum state AFTER — verify, don't assume.
    try {
      const after = await cadastros.getFuncionarioFull(SECULLUM_FUNCIONARIO_ID);
      logger.log(`Secullum AFTER: ${describeFuncionario(after)}`);
    } catch (err) {
      logger.warn(
        `Could not re-read Secullum Funcionario ${SECULLUM_FUNCIONARIO_ID}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } catch (err) {
    exitCode = 1;
    logger.error('Failed', err instanceof Error ? err.stack : String(err));
  } finally {
    await app.close();
    process.exit(exitCode);
  }
}

void main();
