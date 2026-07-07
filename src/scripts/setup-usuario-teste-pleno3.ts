/**
 * setup-usuario-teste-pleno3.ts
 * ---------------------------------------------------------------------------
 * Turns the "Usuário Teste" account (plotter.ankaa@gmail.com) into a
 * realistic Pleno III / Produção 1 employee:
 *
 *   1) EmploymentContractService.update() on the sole ACTIVE contract
 *      (a39f9771) -> positionId = Pleno III, payrollNumber = 200. This mirrors
 *      positionId/payrollNumber onto the User row durably (syncUserCurrentContract).
 *
 *   2) UserService.update() -> positionId = Pleno III, payrollNumber = 200,
 *      performanceLevel = 3, a valid unique CPF + PIS, a realistic birth date,
 *      secullumHorarioId = 1, secullumSyncEnabled = true. (onUserUpdated will
 *      SKIP the Secullum push here because there is no secullumEmployeeId yet.)
 *
 *   3) UserSecullumSyncService.onUserCreated({ userId }) -> the create path.
 *      POSTs a real Funcionario to Secullum (Nome/Cpf/NumeroFolha=200/FuncaoId=10/
 *      DepartamentoId=3/HorarioId=1/Admissao) and persists secullumEmployeeId back
 *      onto the User. Idempotent + never throws.
 *
 *   4) Seed a 2-month bonus history (May + June 2026) directly, computing
 *      baseBonus with the real BonusCalculationService formula (verified to
 *      reproduce existing peer bonuses to the cent). We do NOT run
 *      calculateAndSaveBonuses because that recomputes EVERY user for the
 *      period and would overwrite the existing historical rows. netBonus =
 *      baseBonus (no fabricated discount lines, so the numbers reconcile).
 *      May uses the period's real constants (B1/weightedTasks/adjustment) read
 *      from an existing peer row; June has no peer period yet, so it reuses
 *      May's constants as a plausible stand-in.
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/setup-usuario-teste-pleno3.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { UserService } from '../modules/people/user/user.service';
import { EmploymentContractService } from '../modules/personnel-department/employment-contract/employment-contract.service';
import { UserSecullumSyncService } from '../modules/integrations/secullum/user-secullum-sync.service';
import { BonusCalculationService } from '../modules/personnel-department/bonus/bonus-calculation.service';
import { BonusCalculationContextService } from '../modules/personnel-department/bonus/bonus-calculation-context.service';

const USER_ID = '680a0485-d1f4-4bcc-9422-235df670d037';
const CONTRACT_ID = 'a39f9771-b463-4f87-a4ef-6644b5d305a9';
const PLENO_III_POSITION_ID = 'c324dd90-6002-470d-b4d0-1a52fa58dc04';
const PAYROLL_NUMBER = 200;
const PERFORMANCE_LEVEL = 3;
const HORARIO_ID = 1;
const BIRTH = new Date('1995-03-12T00:00:00.000Z');

// ---- valid-document helpers (Brazilian CPF / PIS check digits) -------------
function cpfCheckDigits(base9: string): string {
  const digits = base9.split('').map(Number);
  const dv = (arr: number[], startWeight: number): number => {
    const sum = arr.reduce((acc, d, i) => acc + d * (startWeight - i), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(digits, 10);
  const d2 = dv([...digits, d1], 11);
  return `${d1}${d2}`;
}
function makeCpf(base9: string): string {
  return base9 + cpfCheckDigits(base9);
}
function pisCheckDigit(base10: string): string {
  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = base10
    .split('')
    .map(Number)
    .reduce((acc, d, i) => acc + d * weights[i], 0);
  const r = sum % 11;
  const dv = r < 2 ? 0 : 11 - r;
  return `${dv}`;
}
function makePis(base10: string): string {
  return base10 + pisCheckDigit(base10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function main(): Promise<void> {
  const logger = new Logger('SetupUsuarioTeste');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const prisma = app.get(PrismaService);
    const userService = app.get(UserService);
    const contractService = app.get(EmploymentContractService);
    const secullumSync = app.get(UserSecullumSyncService);
    const bonusCalc = app.get(BonusCalculationService);
    const bonusCtx = app.get(BonusCalculationContextService);

    // ---- pick a valid, unused CPF + PIS -----------------------------------
    let cpf = '';
    for (const base of ['70712345', '70712346', '70712347', '70712348']) {
      const candidate = makeCpf('3' + base); // 9-digit base -> 11-digit CPF
      const clash = await prisma.user.findFirst({ where: { cpf: candidate } });
      if (!clash) {
        cpf = candidate;
        break;
      }
    }
    if (!cpf) throw new Error('could not find a free CPF');

    let pis = '';
    for (const base of ['1234567890', '1234567891', '1234567892', '1234567893']) {
      const candidate = makePis(base);
      const clash = await prisma.user.findFirst({ where: { pis: candidate } });
      if (!clash) {
        pis = candidate;
        break;
      }
    }
    if (!pis) throw new Error('could not find a free PIS');
    logger.log(`Using CPF=${cpf} PIS=${pis}`);

    // ---- 1) Align contract (mirrors positionId/payrollNumber onto User) ----
    logger.log(
      `Contract ${CONTRACT_ID}: positionId -> Pleno III, payrollNumber -> ${PAYROLL_NUMBER}`,
    );
    await contractService.update(CONTRACT_ID, {
      positionId: PLENO_III_POSITION_ID,
      payrollNumber: PAYROLL_NUMBER,
    } as any);

    // ---- 2) User update (sets identity + enables Secullum sync) ------------
    logger.log(`User ${USER_ID}: Pleno III + payroll ${PAYROLL_NUMBER} + perf ${PERFORMANCE_LEVEL} + Secullum enabled`);
    await userService.update(USER_ID, {
      positionId: PLENO_III_POSITION_ID,
      payrollNumber: PAYROLL_NUMBER,
      performanceLevel: PERFORMANCE_LEVEL,
      cpf,
      pis,
      birth: BIRTH,
      secullumHorarioId: HORARIO_ID,
      secullumSyncEnabled: true,
    } as any);

    // ---- 3) Create the Funcionario in Secullum (create path) --------------
    logger.log('Pushing create to Secullum via onUserCreated...');
    const secResult = await secullumSync.onUserCreated({ userId: USER_ID });
    logger.log(`Secullum result: ${JSON.stringify(secResult)}`);
    if (secResult.status === 'error') {
      logger.error(
        `Secullum create returned error — user is configured but NOT linked. ` +
          `Re-run after Secullum is reachable, or use backfillSecullumEmployeeIds.`,
      );
    }

    // ---- 4) Seed May + June 2026 bonus history ----------------------------
    const ctx = await bonusCtx.load();
    const salary = bonusCtx.resolveSalary(ctx, {
      position: { id: PLENO_III_POSITION_ID },
    } as any);
    logger.log(`Resolved Pleno III salary = ${salary}; salaryRange = ${JSON.stringify(ctx.salaryRange)}`);

    // Real May period constants from an existing peer row.
    const mayPeer = await prisma.bonus.findFirst({
      where: { year: 2026, month: 5, performanceLevel: 3 },
    });
    if (!mayPeer) throw new Error('no May 2026 peer bonus found to source period constants');
    const mayAvg = Number(mayPeer.averageTaskPerUser);
    const mayWeighted = Number(mayPeer.weightedTasks);
    const mayAdjustment =
      (mayPeer.calculationParams as any)?.config?.adjustment ?? 0.3;
    logger.log(`May period constants: B1=${mayAvg} weighted=${mayWeighted} adjustment=${mayAdjustment}`);

    const periods = [
      { year: 2026, month: 5, avg: mayAvg, weighted: mayWeighted, adjustment: mayAdjustment, note: 'real May constants' },
      { year: 2026, month: 6, avg: mayAvg, weighted: mayWeighted, adjustment: mayAdjustment, note: 'June stand-in (no peer period yet)' },
    ];

    for (const p of periods) {
      const breakdown = bonusCalc.calculate({
        salary,
        performanceLevel: PERFORMANCE_LEVEL,
        averageTasksPerUser: p.avg,
        salaryRange: ctx.salaryRange,
        config: { adjustment: p.adjustment },
      });
      const baseBonus = round2(breakdown.bonus);
      const netBonus = baseBonus; // no discounts -> reconciles exactly
      const paramsSnapshot = bonusCalc.buildParamsSnapshot({
        salary,
        salaryRange: ctx.salaryRange,
        averageTasksPerUser: p.avg,
        config: { adjustment: p.adjustment },
      });

      await prisma.bonus.upsert({
        where: { userId_year_month: { userId: USER_ID, year: p.year, month: p.month } },
        create: {
          userId: USER_ID,
          year: p.year,
          month: p.month,
          performanceLevel: PERFORMANCE_LEVEL,
          baseBonus,
          netBonus,
          weightedTasks: p.weighted,
          averageTaskPerUser: p.avg,
          salaryUsed: salary,
          calculationVersion: paramsSnapshot.version,
          calculationParams: paramsSnapshot as any,
        },
        update: {
          performanceLevel: PERFORMANCE_LEVEL,
          baseBonus,
          netBonus,
          weightedTasks: p.weighted,
          averageTaskPerUser: p.avg,
          salaryUsed: salary,
          calculationVersion: paramsSnapshot.version,
          calculationParams: paramsSnapshot as any,
        },
      });
      logger.log(
        `Bonus ${p.month}/${p.year}: base=${baseBonus} net=${netBonus} (${p.note})`,
      );
    }

    // ---- Verification ------------------------------------------------------
    const finalUser = await prisma.user.findUnique({
      where: { id: USER_ID },
      include: { position: true, sector: true },
    });
    const bonuses = await prisma.bonus.findMany({
      where: { userId: USER_ID },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
      select: { year: true, month: true, baseBonus: true, netBonus: true, performanceLevel: true },
    });
    logger.log('=== FINAL STATE ===');
    logger.log(
      JSON.stringify(
        {
          name: finalUser?.name,
          position: finalUser?.position?.name,
          sector: finalUser?.sector?.name,
          payrollNumber: finalUser?.payrollNumber,
          performanceLevel: finalUser?.performanceLevel,
          cpf: finalUser?.cpf,
          pis: finalUser?.pis,
          secullumEmployeeId: finalUser?.secullumEmployeeId,
          secullumSyncEnabled: finalUser?.secullumSyncEnabled,
          secullumHorarioId: finalUser?.secullumHorarioId,
          bonuses,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    exitCode = 1;
    logger.error('Failed', err instanceof Error ? err.stack : String(err));
  } finally {
    await app.close();
    process.exit(exitCode);
  }
}

main();
