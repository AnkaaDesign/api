/**
 * probe-secullum-absences.ts
 *
 * Diagnóstico (SÓ LEITURA) para desenhar a regra de afastamento na bonificação.
 *
 * Despeja, para o período 26→25 pedido:
 *   • a tabela de Justificativas do Secullum (id + descrição), que é o que
 *     permite separar "doença/INSS/acidente" de "férias/folga/compensação";
 *   • os afastamentos (/FuncionariosAfastamentos) de cada elegível do período;
 *   • quantos dias úteis do período cada afastamento cobre.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/probe-secullum-absences.ts 2026 8
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { SecullumService } from '../modules/integrations/secullum/secullum.service';
import { BonusEligibilityService } from '../modules/personnel-department/bonus/bonus-eligibility.service';
import { countBrazilianBusinessDaysInRange } from '../utils/brazilian-holidays.util';

async function main(): Promise<void> {
  const [yearArg, monthArg] = process.argv.slice(2);
  const year = Number(yearArg);
  const month = Number(monthArg);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error('Uso: probe-secullum-absences.ts <ano> <mês 1-12>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const prisma = app.get(PrismaService);
    const secullum = app.get(SecullumService);
    const eligibility = app.get(BonusEligibilityService);

    // ---- 1. Justificativas ------------------------------------------------
    const just = await secullum.getJustifications();
    console.log('\n===== JUSTIFICATIVAS =====');
    console.log(`success=${just.success} ${just.message ?? ''}`);
    for (const j of (just.data ?? []) as any[]) {
      console.log(JSON.stringify(j));
    }

    // ---- 2. Elegíveis do período -----------------------------------------
    const period = await eligibility.resolvePeriodEligibility(year, month);
    console.log(
      `\n===== PERÍODO ${month}/${year} =====\n` +
        `${period.periodStart.toISOString()} .. ${period.periodEnd.toISOString()}\n` +
        `dias úteis=${period.periodBusinessDays} divisor=${period.divisor} pessoas=${period.entries.length}`,
    );

    const users = await prisma.user.findMany({
      where: { id: { in: period.entries.map(e => e.userId) } },
      select: { id: true, name: true, secullumEmployeeId: true },
    });
    const byId = new Map(users.map(u => [u.id, u]));

    // ---- 3. Afastamentos por pessoa --------------------------------------
    console.log('\n===== AFASTAMENTOS =====');
    for (const entry of period.entries) {
      const u = byId.get(entry.userId);
      const empId = u?.secullumEmployeeId ?? null;
      const head =
        `\n--- ${entry.userName} (secullumId=${empId ?? 'NULL'}) ` +
        `peso=${entry.weight} dias=${entry.eligibleDays} ` +
        `janela=${entry.eligibleFrom?.toISOString().slice(0, 10)}..${entry.eligibleUntil
          ?.toISOString()
          .slice(0, 10)}`;
      if (empId == null) {
        console.log(`${head}  [sem vínculo Secullum — nada a consultar]`);
        continue;
      }

      const res = await secullum.getAbsencesByEmployee(empId);
      if (!res.success) {
        console.log(`${head}\n    ERRO: ${res.message}`);
        continue;
      }
      const rows = res.data ?? [];
      // Só o que toca o período.
      const touching = rows.filter(a => {
        const ini = new Date(a.Inicio);
        const fim = new Date(a.Fim);
        return fim >= period.periodStart && ini <= period.periodEnd;
      });
      console.log(`${head}\n    total=${rows.length} tocando o período=${touching.length}`);
      for (const a of touching) {
        const ini = new Date(a.Inicio);
        const fim = new Date(a.Fim);
        const from = ini > period.periodStart ? ini : period.periodStart;
        const until = fim < period.periodEnd ? fim : period.periodEnd;
        const dias = countBrazilianBusinessDaysInRange(from, until);
        console.log(
          `      Id=${a.Id} ${a.Inicio.slice(0, 10)}..${a.Fim.slice(0, 10)} ` +
            `justId=${a.JustificativaId} desc="${a.JustificativaDescricao ?? ''}" ` +
            `motivo="${a.Motivo ?? ''}" diasÚteisNoPeríodo=${dias}`,
        );
      }
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
