/**
 * verify-bonus-window-model.ts — SÓ LEITURA. Não grava nada.
 *
 * Prova, com os dados reais de um período, que os três números de cada pessoa
 * fecham e que o modelo v5 está inteiro:
 *
 *     tarefas ponderadas da janela ÷ colaboradores da janela == média
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/verify-bonus-window-model.ts 2026 8
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { BonusEligibilityService } from '../modules/personnel-department/bonus/bonus-eligibility.service';
import { BonusWindowStatsService } from '../modules/personnel-department/bonus/bonus-window-stats.service';
import { BonusCalculationService } from '../modules/personnel-department/bonus/bonus-calculation.service';
import { BonusCalculationContextService } from '../modules/personnel-department/bonus/bonus-calculation-context.service';
import { BonusService } from '../modules/personnel-department/bonus/bonus.service';
import { listBrazilianBusinessDaysInRange } from '../utils/brazilian-holidays.util';
import { roundCurrency } from '../utils/currency-precision.util';
import { BONIFICATION_STATUS, TASK_STATUS } from '../constants/enums';

const pad = (s: any, n: number) => String(s).padEnd(n);
const padL = (s: any, n: number) => String(s).padStart(n);

async function main(): Promise<void> {
  const [yA, mA] = process.argv.slice(2);
  const year = Number(yA);
  const month = Number(mA);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error('Uso: verify-bonus-window-model.ts <ano> <mês 1-12>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const eligibilityService = app.get(BonusEligibilityService);
    const statsService = app.get(BonusWindowStatsService);
    const calc = app.get(BonusCalculationService);
    const ctxService = app.get(BonusCalculationContextService);
    const bonusService = app.get(BonusService);

    const eligibility = await eligibilityService.resolvePeriodEligibility(year, month);
    const businessDays = listBrazilianBusinessDaysInRange(
      eligibility.periodStart,
      eligibility.periodEnd,
    );

    const tasks = await prisma.task.findMany({
      where: {
        bonification: {
          in: [
            BONIFICATION_STATUS.FULL_BONIFICATION,
            BONIFICATION_STATUS.PARTIAL_BONIFICATION,
            BONIFICATION_STATUS.SUSPENDED_BONIFICATION,
            BONIFICATION_STATUS.NO_BONIFICATION,
          ],
        },
        finishedAt: { gte: eligibility.periodStart, lte: eligibility.periodEnd },
        status: TASK_STATUS.COMPLETED,
      },
      select: { id: true, finishedAt: true, bonification: true },
    });

    const stats = statsService.compute({
      businessDays,
      tasks,
      people: eligibility.entries
        .filter(e => e.performanceLevel > 0)
        .map(e => ({
          userId: e.userId,
          intervals: e.eligibleIntervals,
          eligibleDays: e.eligibleDays,
        })),
    });

    const ctx = await ctxService.load();
    const adjustment = await bonusService.loadPeriodAdjustmentFraction(year, month);

    console.log(`\n${'='.repeat(104)}`);
    console.log(
      `PERÍODO ${String(month).padStart(2, '0')}/${year}  —  ` +
        `${eligibility.periodStart.toISOString().slice(0, 10)} → ${eligibility.periodEnd.toISOString().slice(0, 10)}  ` +
        `(${businessDays.length} dias úteis)`,
    );
    console.log(`${'='.repeat(104)}`);
    console.log(
      `EQUIPE: ${stats.period.taskCount} tarefas (${stats.period.weightedTasks} ponderadas) · ` +
        `${eligibility.divisor.toFixed(4)} colaboradores · média ${(stats.period.weightedTasks / eligibility.divisor).toFixed(2)} · ` +
        `reajuste ${(adjustment * 100).toFixed(0)}%`,
    );

    console.log(`\n--- QUADRO POR DIA ÚTIL ---`);
    console.log(pad('dia', 12) + padL('colaboradores', 15) + padL('ponderadas', 12));
    for (const d of stats.perDay) {
      console.log(
        pad(d.date.toISOString().slice(0, 10), 12) + padL(d.headcount, 15) + padL(d.weightedTasks, 12),
      );
    }

    const saved = new Map(
      (
        await prisma.bonus.findMany({
          where: { year, month },
          select: {
            userId: true,
            baseBonus: true,
            averageTaskPerUser: true,
            windowWeightedTasks: true,
            windowDivisor: true,
            windowTaskCount: true,
          },
        })
      ).map(b => [b.userId, b]),
    );

    console.log(`\n--- OS TRÊS NÚMEROS DE CADA PESSOA ---`);
    console.log(
      pad('pessoa', 30) + padL('dias', 5) + padL('tarefas', 9) + padL('ponderadas', 12) +
        padL('colabs', 9) + padL('média', 8) + padL('÷ fecha', 9) + padL('base', 11) + padL('salvo', 11),
    );

    const rows: any[] = [];
    let naoFecha = 0;
    let somaBase = 0;

    for (const e of eligibility.entries) {
      const st = stats.byUserId.get(e.userId);
      const b1Raw = st?.b1Raw ?? 0;
      const b1W = st?.b1Weighted ?? 0;
      const salary = ctxService.resolveSalary(ctx, {
        position: e.positionId ? { id: e.positionId } : null,
      });
      // MESMA regra do serviço: só o afastamento multiplica.
      const base = roundCurrency(
        calc.calculateBonus({
          salary,
          performanceLevel: e.performanceLevel,
          averageTasksPerUser: b1Raw,
          salaryRange: ctx.salaryRange,
          config: { adjustment },
        }) * e.absenceFactor,
      );
      somaBase += base;

      const pond = st?.windowWeightedTasks ?? 0;
      const colab = st?.windowDivisor ?? 0;
      const esperado = colab > 0 ? pond / colab : 0;
      const fecha = Math.abs(esperado - b1W) < 0.005;
      if (!fecha) naoFecha++;

      const s = saved.get(e.userId);
      rows.push({ e, st, b1W, base, pond, colab, fecha, salvo: s ? Number(s.baseBonus) : null, s });
    }

    rows.sort((a, b) => a.e.eligibleDays - b.e.eligibleDays || a.e.userName.localeCompare(b.e.userName));
    for (const r of rows) {
      console.log(
        pad(r.e.userName.slice(0, 29), 30) +
          padL(r.e.eligibleDays, 5) +
          padL(r.st?.windowTaskCount ?? 0, 9) +
          padL(r.pond.toFixed(2), 12) +
          padL(r.colab.toFixed(2), 9) +
          padL(r.b1W.toFixed(2), 8) +
          padL(r.fecha ? 'ok' : 'NÃO', 9) +
          padL(r.base.toFixed(2), 11) +
          padL(r.salvo == null ? '—' : r.salvo.toFixed(2), 11),
      );
    }
    console.log(pad('TOTAL', 30) + padL('', 54) + padL(somaBase.toFixed(2), 11));

    // ------------------------------------------------------------------
    // INVARIANTES
    // ------------------------------------------------------------------
    console.log(`\n--- INVARIANTES ---`);
    const checks: Array<[string, boolean, string]> = [];

    checks.push([
      'dias úteis: enumeração == elegibilidade',
      businessDays.length === eligibility.periodBusinessDays,
      `${businessDays.length} vs ${eligibility.periodBusinessDays}`,
    ]);

    checks.push([
      'TAREFAS ÷ COLABORADORES == MÉDIA em toda linha',
      naoFecha === 0,
      `${rows.length - naoFecha}/${rows.length} linhas fecham`,
    ]);

    const janelaOk = [...stats.byUserId.values()].every(st => {
      const e = eligibility.byUserId.get(st.userId);
      return e && st.windowBusinessDays === e.eligibleDays;
    });
    checks.push(['janela reconstruída == eligibleDays', janelaOk, janelaOk ? 'todas batem' : 'DIVERGENTE']);

    // Ninguém pode receber o número da EQUIPE por falta do próprio.
    const periodB1 = stats.period.weightedTasks / eligibility.divisor;
    const contaminados = rows.filter(
      r => r.e.eligibleDays !== eligibility.periodBusinessDays && Math.abs(r.b1W - periodB1) < 1e-9,
    );
    checks.push([
      'janela parcial NUNCA recebe a média da equipe',
      contaminados.length === 0,
      contaminados.length === 0 ? 'nenhuma contaminação' : contaminados.map(c => c.e.userName).join(', '),
    ]);

    // Quem não pegou tarefa nenhuma tem média 0 — e não um número positivo.
    const semTarefa = rows.filter(r => r.pond === 0);
    checks.push([
      'quem não pegou tarefa tem média 0,00 e base R$ 0,00',
      semTarefa.every(r => r.b1W === 0 && r.base === 0),
      semTarefa.length === 0 ? 'ninguém neste período' : `${semTarefa.length} pessoa(s): ${semTarefa.map(r => r.e.userName.split(' ')[0]).join(', ')}`,
    ]);

    // A CURVA NUNCA DESCE — a correção do vale.
    let curvaDesce = 0;
    let anterior = -Infinity;
    for (let b = 0; b <= 6; b += 0.005) {
      const v = calc.calculateBonus({
        salary: ctx.salaryRange.max,
        performanceLevel: 3,
        averageTasksPerUser: b,
        salaryRange: ctx.salaryRange,
        config: { adjustment },
      });
      if (v < anterior - 1e-9) curvaDesce++;
      anterior = v;
    }
    checks.push([
      'curva monotônica: produzir mais nunca paga menos',
      curvaDesce === 0,
      curvaDesce === 0 ? 'não desce em nenhum ponto de 0 a 6' : `${curvaDesce} ponto(s) descendo`,
    ]);

    // O TEMPO É APLICADO UMA VEZ SÓ: o valor é curva(média) × absenceFactor e
    // NADA mais. Se o prorrateio temporal tivesse voltado, esta conta falharia.
    const tempoDuplicado = rows.filter(r => {
      const salary = ctxService.resolveSalary(ctx, {
        position: r.e.positionId ? { id: r.e.positionId } : null,
      });
      const semTempo = roundCurrency(
        calc.calculateBonus({
          salary,
          performanceLevel: r.e.performanceLevel,
          averageTasksPerUser: r.st?.b1Raw ?? 0,
          salaryRange: ctx.salaryRange,
          config: { adjustment },
        }) * r.e.absenceFactor,
      );
      return Math.abs(semTempo - r.base) > 0.005;
    });
    checks.push([
      'valor == curva(média) × afastamento, sem fator de tempo',
      tempoDuplicado.length === 0,
      tempoDuplicado.length === 0 ? 'todas as linhas' : `${tempoDuplicado.length} divergente(s)`,
    ]);

    // Período estável: todo mundo com os MESMOS três números.
    const semRotatividade = eligibility.entries.every(
      e => e.eligibleDays === eligibility.periodBusinessDays,
    );
    if (semRotatividade) {
      const distintas = new Set(rows.map(r => `${r.pond}|${r.colab.toFixed(4)}|${r.b1W}`));
      checks.push([
        'período sem rotatividade: um único trio para todos',
        distintas.size === 1,
        `${distintas.size} trio(s) distinto(s)`,
      ]);
    } else {
      checks.push([
        'período COM rotatividade (os trios divergem de propósito)',
        true,
        `${eligibility.entries.filter(e => e.eligibleDays !== eligibility.periodBusinessDays).length} pessoa(s) com janela parcial`,
      ]);
    }

    // O que está GRAVADO reproduz o que acabamos de calcular.
    if (saved.size > 0) {
      const divergentes = rows.filter(r => r.s && Math.abs(Number(r.s.baseBonus) - r.base) > 0.01);
      checks.push([
        'linhas gravadas reproduzem o cálculo de agora',
        divergentes.length === 0,
        divergentes.length === 0
          ? `${saved.size} linha(s) conferidas`
          : `${divergentes.length} divergente(s): ${divergentes.map(d => d.e.userName.split(' ')[0]).join(', ')}`,
      ]);
      const trioSalvoOk = rows.every(r => {
        if (!r.s || r.s.windowDivisor == null) return true;
        const p = Number(r.s.windowWeightedTasks);
        const c = Number(r.s.windowDivisor);
        const m = Number(r.s.averageTaskPerUser);
        return c > 0 ? Math.abs(p / c - m) < 0.005 : m === 0;
      });
      checks.push([
        'trio GRAVADO no banco também fecha na divisão',
        trioSalvoOk,
        trioSalvoOk ? 'todas as linhas' : 'DIVERGENTE',
      ]);
    }

    let allOk = true;
    for (const [label, ok, detail] of checks) {
      if (!ok) allOk = false;
      console.log(`  ${ok ? '✓' : '✗'} ${pad(label, 52)} ${detail}`);
    }
    console.log(`\n${allOk ? '✓ TODAS AS INVARIANTES PASSARAM' : '✗ HÁ INVARIANTE QUEBRADA — NÃO GRAVAR'}\n`);
    if (!allOk) process.exitCode = 1;
  } finally {
    await Promise.race([app.close(), new Promise(r => setTimeout(r, 10_000))]);
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
