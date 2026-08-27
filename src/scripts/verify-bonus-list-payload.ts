/**
 * verify-bonus-list-payload.ts — SÓ LEITURA.
 *
 * Chama EXATAMENTE o que o endpoint da lista chama
 * (`getBonusesWithLiveCalculation`) e imprime, por pessoa, os campos que a
 * tabela da web renderiza. Existe porque os três erros encontrados nesta área
 * não estavam no cálculo — estavam no que chegava à TELA: valor certo no banco,
 * número do período no payload.
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/verify-bonus-list-payload.ts 2026 8
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BonusService } from '../modules/personnel-department/bonus/bonus.service';

const n = (v: any): number =>
  v == null ? 0 : typeof v === 'object' && v.toNumber ? v.toNumber() : Number(v) || 0;
const pad = (s: any, w: number) => String(s).padEnd(w);
const padL = (s: any, w: number) => String(s).padStart(w);

async function main(): Promise<void> {
  const [yA, mA] = process.argv.slice(2);
  const year = Number(yA);
  const month = Number(mA);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const svc = app.get(BonusService);
    const res: any = await svc.getBonusesWithLiveCalculation({
      where: { year, month },
      take: 200,
      include: { user: { include: { position: true } } },
    });
    const rows: any[] = res?.data ?? res?.bonuses ?? res ?? [];

    console.log(`\nPAYLOAD DA LISTA — ${String(month).padStart(2, '0')}/${year} — ${rows.length} linha(s)\n`);
    console.log(
      pad('pessoa', 30) + padL('dias', 6) + padL('tarefas', 9) + padL('pond.', 8) +
        padL('colab.', 9) + padL('crédito', 9) + padL('média', 8) + padL('base', 11) +
        padL('equipe', 9) + '  marcos',
    );

    let bad = 0;
    for (const b of rows.sort((a, c) => n(a.eligibleDays) - n(c.eligibleDays))) {
      const dias = n(b.eligibleDays);
      const pbd = n(b.periodBusinessDays);
      const tarefas = b.windowTaskCount != null ? n(b.windowTaskCount) : NaN;
      const pond = b.windowWeightedTasks != null ? n(b.windowWeightedTasks) : NaN;
      const colab = b.windowDivisor != null ? n(b.windowDivisor) : NaN;
      const media = n(b.averageTaskPerUser);
      const equipe = n(b.periodAverageTasks);

      // A CONTA TEM QUE FECHAR NA MÃO: ponderadas ÷ colaboradores = média
      const esperado = colab > 0 ? pond / colab : 0;
      const fecha = Math.abs(esperado - media) < 0.006;
      if (!fecha) bad++;

      const marcos =
        (b.effectedAt ? `efetivado ${String(b.effectedAt).slice(0, 10)} ` : '') +
        (b.terminatedAt ? `desligado ${String(b.terminatedAt).slice(0, 10)}` : '');

      console.log(
        pad(String(b.user?.name ?? b.userId).slice(0, 29), 30) +
          padL(`${dias}/${pbd}`, 6) +
          padL(Number.isNaN(tarefas) ? 'AUSENTE' : tarefas, 9) +
          padL(Number.isNaN(pond) ? 'AUSENTE' : pond.toFixed(1), 8) +
          padL(Number.isNaN(colab) ? 'AUSENTE' : colab.toFixed(2), 9) +
          padL(media.toFixed(2), 8) +
          padL(n(b.baseBonus).toFixed(2), 11) +
          padL(equipe.toFixed(2), 9) +
          (fecha ? '  ' : '  ✗NÃO FECHA ') + marcos,
      );
    }

    const ausentes = rows.filter(
      (b: any) =>
        b.windowTaskCount == null ||
        b.windowWeightedTasks == null ||
        b.windowDivisor == null ||
        b.periodAverageTasks == null,
    );
    const periodoPond = Math.max(...rows.map((b: any) => n(b.weightedTasks)));

    console.log(`\n--- CONFERÊNCIAS DO PAYLOAD ---`);
    console.log(`  ${ausentes.length === 0 ? '✓' : '✗'} todos os campos por pessoa presentes  ${ausentes.length === 0 ? '' : ausentes.map((a: any) => a.user?.name).join(', ')}`);
    console.log(`  ${bad === 0 ? '✓' : '✗'} ponderadas ÷ colaboradores == média em todas as linhas  (${rows.length - bad}/${rows.length})`);
    const maiorPond = Math.max(...rows.map((b: any) => n(b.windowWeightedTasks)));
    console.log(
      `  ${maiorPond <= periodoPond + 1e-9 ? '✓' : '✗'} nenhuma janela excede o período  (maior ${maiorPond.toFixed(2)} vs ${periodoPond.toFixed(2)})`,
    );
    const distintas = new Set(rows.map((b: any) => n(b.windowWeightedTasks).toFixed(2)));
    console.log(
      `  ${distintas.size > 1 ? '✓' : '✗'} "Tarefas Ponderadas" VARIA por pessoa  (${distintas.size} valores distintos: ${[...distintas].join(', ')})`,
    );
    const colabs = new Set(rows.map((b: any) => n(b.windowDivisor).toFixed(2)));
    console.log(
      `  ${colabs.size > 1 ? '✓' : '✗'} "Colaboradores" VARIA por pessoa  (${colabs.size} valores distintos: ${[...colabs].join(', ')})`,
    );
    if (bad > 0 || ausentes.length > 0) process.exitCode = 1;
  } finally {
    await Promise.race([app.close(), new Promise(r => setTimeout(r, 10_000))]);
  }
}
main().then(() => process.exit(process.exitCode ?? 0)).catch(e => { console.error(e); process.exit(1); });
