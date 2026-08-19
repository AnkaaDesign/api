/** Roda AGORA a rotina noturna das contas recorrentes (materializar horizonte,
 *  reaproveitar, liquidar do extrato, ligar NF, envelhecer vencidas) — a mesma
 *  do cron das 05:15. Usado depois de um replanejamento, para o horizonte não
 *  ficar vazio até a madrugada. */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RecurrentPayableScheduler } from '../modules/financial/recurrent-payable/recurrent-payable.scheduler';

async function main(): Promise<number> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await app.get(RecurrentPayableScheduler).runDue();
    console.log(`runDue: ${JSON.stringify(result)}`);
    return 0;
  } catch (e) {
    console.error(`FALHOU: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await Promise.race([app.close(), new Promise(r => setTimeout(r, 15_000))]).catch(() => undefined);
  }
}
main().then(c => process.exit(c));
