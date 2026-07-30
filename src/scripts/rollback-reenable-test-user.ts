/**
 * rollback-reenable-test-user.ts
 * ---------------------------------------------------------------------------
 * Reverts `reenable-test-user.ts` — puts "Usuário Teste" (Funcionario 90) back
 * exactly as it was before 2026-07-29 17:24 (see backups
 * User_testbackup20260729 / EmploymentContract_testbackup20260729):
 *
 *   - single EmploymentContract, sequence 1, TERMINATED (2026-07-20), isCurrent;
 *   - User cache: currentContractId = a39f9771…, currentContractStatus = TERMINATED
 *     (so login is blocked again via isUserEmployed);
 *   - secullumSyncEnabled = false;
 *   - Secullum Funcionario 90: Demissao 2026-07-27, Invisivel true, FuncaoId 10.
 *
 * Three steps, in this order:
 *
 *   1) EmploymentContractService.delete() on the readmission contract (seq 2).
 *      DELETE rather than terminate: the contract was created 20 min ago by the
 *      re-enable script and has no Admission/Termination/Payroll/Vacation/
 *      Thirteenth attached (only its own ContractPhaseHistory row, ON DELETE
 *      CASCADE), so it is not real history — terminating it would instead leave
 *      a spurious seq-2 row and point the User cache at it. delete() runs
 *      syncUserCurrentContract, which re-elects seq 1 as current and restores
 *      currentContract* + the mirrored positionId/sectorId/payrollNumber.
 *
 *   2) UserService.update() -> secullumSyncEnabled = false. The bridge is still
 *      invoked but re-reads the user first and short-circuits on
 *      `!user.secullumSyncEnabled` ('sincronização desabilitada'), so this does
 *      NOT push anything to Secullum. Everything else (sector, position,
 *      secullumHorarioId = 1) already matches the pre-change row.
 *
 *   3) Secullum Funcionario 90 restored EXPLICITLY via
 *      SecullumCadastrosService.updateFuncionario. The bridge can't do it: it
 *      derives Demissao from `currentContract.terminationDate` (which is
 *      2026-07-20), whereas the pre-change dismissal date 2026-07-27 was set
 *      by hand on the Secullum side and never came from Ankaa. FuncaoId is put
 *      back to 10 (the stale pre-change value) for the same reason.
 *
 * Not touched (and never was): password, email, CPF, PIS, payrollNumber (200),
 * secullumEmployeeId (90), the TERMINATED seq-1 contract.
 *
 * ChangeLog entries and User.updatedAt from both runs remain — the audit trail
 * of the re-enable + rollback is intentionally not erased.
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/rollback-reenable-test-user.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';
import { EmploymentContractService } from '../modules/personnel-department/employment-contract/employment-contract.service';
import { SecullumCadastrosService } from '../modules/integrations/secullum/secullum-cadastros.service';

const TEST_USER_ID = '680a0485-d1f4-4bcc-9422-235df670d037'; // Usuário Teste
const READMISSION_CONTRACT_ID = '06b6cbaa-6460-4757-b84a-9cdb63573340'; // seq 2, created by reenable-test-user.ts
const SECULLUM_FUNCIONARIO_ID = 90;

// Pre-change Secullum values, captured by the re-enable run's "BEFORE" log line:
// {"Id":90,"Demissao":"2026-07-27T00:00:00","Invisivel":true,"DepartamentoId":3,"FuncaoId":10,"NumeroFolha":"200"}
const PREV_DEMISSAO = '2026-07-27T00:00:00';
const PREV_INVISIVEL = true;
const PREV_FUNCAO_ID = 10;

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
  const logger = new Logger('RollbackReenableTestUser');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const employmentContractService = app.get(EmploymentContractService);
    const userService = app.get(UserService);
    const cadastros = app.get(SecullumCadastrosService);

    // 1) Drop the readmission contract; seq 1 (TERMINATED) becomes current again.
    logger.log(`Deleting readmission contract ${READMISSION_CONTRACT_ID}`);
    const deleted = await employmentContractService.delete(READMISSION_CONTRACT_ID);
    logger.log(`Contract delete result: ${JSON.stringify(deleted)}`);

    // 2) Turn the Secullum bridge back off (no push — onUserUpdated skips).
    logger.log(`Updating user ${TEST_USER_ID}: secullumSyncEnabled -> false`);
    const user = await userService.update(TEST_USER_ID, {
      secullumSyncEnabled: false,
    } as any);
    const u = (user as any)?.data ?? user;
    logger.log(
      `User after rollback: ${JSON.stringify({
        currentContractId: u?.currentContractId,
        currentContractStatus: u?.currentContractStatus,
        currentContractType: u?.currentContractType,
        currentEmployeeType: u?.currentEmployeeType,
        sectorId: u?.sectorId,
        positionId: u?.positionId,
        payrollNumber: u?.payrollNumber,
        secullumSyncEnabled: u?.secullumSyncEnabled,
        secullumHorarioId: u?.secullumHorarioId,
        secullumEmployeeId: u?.secullumEmployeeId,
      })}`,
    );
    logger.log(
      `Secullum bridge result (expected: skipped): ${JSON.stringify(
        (user as any)?.secullumSync ?? null,
      )}`,
    );

    // 3) Put Funcionario 90 back to its pre-change dismissed state.
    const current = await cadastros.getFuncionarioFull(SECULLUM_FUNCIONARIO_ID);
    logger.log(`Secullum BEFORE rollback: ${describeFuncionario(current)}`);

    await cadastros.updateFuncionario(SECULLUM_FUNCIONARIO_ID, {
      ...current,
      Demissao: PREV_DEMISSAO,
      Invisivel: PREV_INVISIVEL,
      FuncaoId: PREV_FUNCAO_ID,
    } as any);

    const after = await cadastros.getFuncionarioFull(SECULLUM_FUNCIONARIO_ID);
    logger.log(`Secullum AFTER rollback: ${describeFuncionario(after)}`);
  } catch (err) {
    exitCode = 1;
    logger.error('Failed', err instanceof Error ? err.stack : String(err));
  } finally {
    await app.close();
    process.exit(exitCode);
  }
}

void main();
