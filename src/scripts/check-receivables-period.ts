/** Smoke: Contas a Receber com período — a lista precisa devolver as parcelas
 *  RECEBIDAS do mês pedido, e não só as dos últimos 60 dias. */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReceivablesService } from '../modules/financial/reconciliation/receivables.service';

async function main(): Promise<number> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const svc = app.get(ReceivablesService);
    for (const period of [null, { year: 2026, months: ['03'] }, { year: 2026, months: ['05'] }]) {
      const res = await svc.getReceivables(period as any);
      const amendo = res.data.rows.filter(r => (r.customerName ?? '').toLowerCase().includes('amendol'));
      console.log(
        `período=${period ? `${period.year}-${period.months.join(',')}` : 'padrão(60d)'} ` +
          `→ ${res.data.rows.length} linha(s), Amendolândia: ${amendo.length}` +
          (amendo.length ? ` [${amendo.map(a => `${a.state} ${a.paidAt ? new Date(a.paidAt).toISOString().slice(0, 10) : '—'} R$${a.amount}`).join(' | ')}]` : ''),
      );
    }
    return 0;
  } catch (e) {
    console.error(`FALHOU: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await Promise.race([app.close(), new Promise(r => setTimeout(r, 15_000))]).catch(() => undefined);
  }
}
main().then(c => process.exit(c));
