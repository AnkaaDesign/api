/** Roda agora a varredura de conciliação de ENTRADAS (a mesma do cron), para os
 *  scores "Pendente · NN%" do Extrato saírem já na régua nova — crédito de
 *  cobrança pontua contra boleto, e só. */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReceivableMatchService } from '../modules/financial/reconciliation/receivable-match.service';

async function main(): Promise<number> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const matched = await app.get(ReceivableMatchService).matchInflowAll();
    console.log(`Entradas conciliadas automaticamente: ${matched}`);
    await new Promise(r => setTimeout(r, 3000)); // deixa os stamps de score irem ao banco
    return 0;
  } catch (e) {
    console.error(`FALHOU: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await Promise.race([app.close(), new Promise(r => setTimeout(r, 15_000))]).catch(() => undefined);
  }
}
main().then(c => process.exit(c));
