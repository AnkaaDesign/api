/**
 * restore-kennedy-session-changes.ts
 * ---------------------------------------------------------------------------
 * Fully reverts every change made to the Kennedy Campos account (Secullum
 * smoke-test identity, Funcionario 18) during the 2026-07-06 session, back to
 * the session-start state:
 *
 *   User:      sectorId = Administração (35ddaa9e), secullumHorarioId = null,
 *              currentEmployeeType = TERCEIRIZADO.
 *   Contract:  active vínculo e1b9a682 -> employeeType TERCEIRIZADO,
 *              contractType null, sectorId Administração, effectedAt null.
 *   Sectors:   Produção 1 leaderId -> 207525c0… (original leader restored);
 *              Produção 3 leaderId -> null (its original state).
 *
 * All other fields (CPF, payrollNumber 150, secullumEmployeeId 18,
 * secullumSyncEnabled, admissionDate 2024-04-01, the TERMINATED CLT seq-1
 * contract) are untouched — they were already at session-start values.
 *
 * Order matters (Sector.leaderId is UNIQUE — a user leads at most one sector):
 *   1) Restore Produção 1 leader -> 207525c0… (this removes kennedy as leader;
 *      207525c0 leads no other sector, so no uniqueness conflict). Produção 3 is
 *      already null. Done first so kennedy leads nothing before the user update.
 *   2) Revert the active contract to off-folha TERCEIRIZADO (mirrors sectorId
 *      Administração + employeeType TERCEIRIZADO onto the User).
 *   3) UserService.update -> sectorId Administração + secullumHorarioId null,
 *      firing the Secullum push (departamento 2 -> Funcionario 18).
 *
 * Backups already on disk: User_kncltbackup20260706,
 * EmploymentContract_kncltbackup20260706, Sector_knp3backup20260706 (pristine),
 * plus User_knp3backup20260706 / Sector_knp1lead20260706 (intermediate).
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/restore-kennedy-session-changes.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';
import { EmploymentContractService } from '../modules/personnel-department/employment-contract/employment-contract.service';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { EMPLOYEE_TYPE } from '../constants';

const KENNEDY_USER_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100';
const ACTIVE_CONTRACT_ID = 'e1b9a682-99f7-46ab-9cc3-f288fd526ee0';
const ADMINISTRACAO_SECTOR_ID = '35ddaa9e-071d-465e-8589-96dd476e6259'; // secullumDepartamentoId=2
const PRODUCAO_1_SECTOR_ID = '21ba944d-b722-48d7-b2ae-a158f2f33b19';
const PRODUCAO_3_SECTOR_ID = '74a9951d-9ecf-4ce9-8365-51680a0d45fa';
const PRODUCAO_1_ORIGINAL_LEADER_ID = '207525c0-2b6d-4683-bd66-c81f44fb9862';

async function main(): Promise<void> {
  const logger = new Logger('RestoreKennedySessionChanges');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const employmentContractService = app.get(EmploymentContractService);
    const userService = app.get(UserService);
    const prisma = app.get(PrismaService);

    // 1) Restore Produção 1's original leader (removes kennedy). Produção 3 -> null.
    await prisma.sector.update({
      where: { id: PRODUCAO_1_SECTOR_ID },
      data: { leaderId: PRODUCAO_1_ORIGINAL_LEADER_ID },
    });
    logger.log(`Produção 1 leaderId restored -> ${PRODUCAO_1_ORIGINAL_LEADER_ID}`);
    const p3 = await prisma.sector.findUnique({
      where: { id: PRODUCAO_3_SECTOR_ID },
      select: { leaderId: true },
    });
    if (p3?.leaderId) {
      await prisma.sector.update({
        where: { id: PRODUCAO_3_SECTOR_ID },
        data: { leaderId: null },
      });
      logger.log('Produção 3 leaderId cleared -> null');
    } else {
      logger.log('Produção 3 already has no leader — nothing to clear');
    }

    // 2) Revert the active contract to off-folha TERCEIRIZADO (mirrors onto User).
    logger.log(
      `Reverting contract ${ACTIVE_CONTRACT_ID}: employeeType -> TERCEIRIZADO, contractType -> null, sectorId -> Administração, effectedAt -> null`,
    );
    const contract = await employmentContractService.update(ACTIVE_CONTRACT_ID, {
      employeeType: EMPLOYEE_TYPE.TERCEIRIZADO,
      contractType: null,
      sectorId: ADMINISTRACAO_SECTOR_ID,
      effectedAt: null,
    } as any);
    logger.log(`Contract revert result: ${JSON.stringify((contract as any)?.data ?? contract)}`);

    // 3) User update -> Administração + clear horario, fires Secullum push (dept 2).
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
