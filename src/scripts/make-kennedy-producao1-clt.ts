/**
 * make-kennedy-producao1-clt.ts
 * ---------------------------------------------------------------------------
 * Makes the Kennedy Campos account (the Secullum smoke-test identity,
 * Funcionario 18) a genuine "Produção 1" sector employee under an ACTIVE CLT
 * contract, with the Secullum Funcionario mirrored to Produção 1's department.
 *
 * Starting state (2026-07-06): the sole ACTIVE contract is the TERCEIRIZADO one
 * (e1b9a682, seq 2) in Administração; the original CLT contract (d29c1735, seq 1)
 * is TERMINATED. The status machine forbids reviving a TERMINATED vínculo
 * (TERMINATED → ACTIVE is illegal), and readmission would spawn a 3rd contract.
 * So the cleanest single-active-CLT result is to convert the current active
 * contract IN PLACE to CLT / INDETERMINATE and align its sector — no dual-open
 * contract, no extra rows.
 *
 * Two steps, both through the services (NOT raw SQL) so all invariants, the
 * User mirror (syncUserCurrentContract) and the Secullum push fire correctly:
 *
 *   1) EmploymentContractService.update() on the active contract (e1b9a682):
 *        employeeType  TERCEIRIZADO -> CLT
 *        contractType  null         -> INDETERMINATE   (CLT requires a modality)
 *        sectorId                   -> Produção 1
 *        effectedAt                 -> admissionDate    (reads as fully effective)
 *      syncUserCurrentContract then mirrors employeeType=CLT, contractType,
 *      sectorId=Produção 1 and payrollNumber onto the User row, making the change
 *      DURABLE (a later contract-touching update won't stomp it back — the
 *      mirror-stomp bug we hit before).
 *
 *   2) UserService.update() -> sectorId = Produção 1 + secullumHorarioId = 1.
 *      UserSecullumSyncService.onUserUpdated fires and pushes the sector's
 *      secullumDepartamentoId (3) to Funcionario 18. Secullum prerequisites
 *      (cpf, payrollNumber, admissionDate-from-contract, sector, position) are
 *      all already satisfied.
 *
 * Preserved untouched: CPF (11516167961), payrollNumber (150),
 * secullumEmployeeId (18), secullumSyncEnabled. The old TERMINATED CLT contract
 * (seq 1) is left as-is.
 *
 * Backups (pre-run): User_kncltbackup20260706, EmploymentContract_kncltbackup20260706.
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/make-kennedy-producao1-clt.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';
import { EmploymentContractService } from '../modules/personnel-department/employment-contract/employment-contract.service';
import { CONTRACT_TYPE, EMPLOYEE_TYPE } from '../constants';

const KENNEDY_USER_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100';
const ACTIVE_CONTRACT_ID = 'e1b9a682-99f7-46ab-9cc3-f288fd526ee0'; // sole ACTIVE (was TERCEIRIZADO)
const PRODUCAO_1_SECTOR_ID = '21ba944d-b722-48d7-b2ae-a158f2f33b19'; // PRODUCTION, secullumDepartamentoId=3
const PRODUCAO_1_SECULLUM_HORARIO_ID = 1;
const CONTRACT_ADMISSION_DATE = new Date('2024-04-01T03:00:00.000Z'); // existing seq-2 admissionDate

async function main(): Promise<void> {
  const logger = new Logger('MakeKennedyProducao1Clt');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const employmentContractService = app.get(EmploymentContractService);
    const userService = app.get(UserService);

    // 1) Convert the active contract -> CLT / INDETERMINATE, sector Produção 1.
    logger.log(
      `Updating active contract ${ACTIVE_CONTRACT_ID}: employeeType -> CLT, ` +
        `contractType -> INDETERMINATE, sectorId -> Produção 1, effectedAt -> admissionDate`,
    );
    const contract = await employmentContractService.update(ACTIVE_CONTRACT_ID, {
      employeeType: EMPLOYEE_TYPE.CLT,
      contractType: CONTRACT_TYPE.INDETERMINATE,
      sectorId: PRODUCAO_1_SECTOR_ID,
      effectedAt: CONTRACT_ADMISSION_DATE,
    } as any);
    logger.log(
      `Contract update result: ${JSON.stringify((contract as any)?.data ?? contract)}`,
    );

    // 2) User update -> fires Secullum department push (3) + sets horario.
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
