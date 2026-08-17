import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

/**
 * Impede que um script de manutenção vire uma SEGUNDA INSTÂNCIA DE PRODUÇÃO.
 *
 * 69 arquivos em `src/scripts/` sobem o contexto inteiro com
 * `NestFactory.createApplicationContext(AppModule)`. Isso não instancia só o
 * provider que o script quer: instancia TODOS os ~30 schedulers da aplicação, e
 * o `ScheduleExplorer` registra cada `@Cron` deles. Enquanto o script estiver
 * vivo, ele emite NFS-e, entrega notificação, mexe em boleto e roda a limpeza de
 * órfãos — em paralelo com a API, sobre o mesmo banco.
 *
 * Não é hipotético. Em 2026-08-14 o `provision-painter-nfse.ts` terminou o
 * trabalho em 13 minutos e ficou pendurado no `app.close()` por 2 dias e 17
 * horas. Nesse período ele duplicou ~1300 entregas de notificação em um único
 * dia e, às 03:00 de 17/08, rodou o `FileCleanupSchedulerService` junto com a
 * API — as duas varreram a mesma lista, uma apagou 58 arquivos do estúdio e a
 * outra levou ENOENT nos outros 107. Os logs do script iam para um pipe que
 * ninguém lia, então nada disso apareceu no journal.
 *
 * FALHA PARA O LADO SEGURO: só desliga quando reconhece o entrypoint como
 * script. Se a detecção errar, o comportamento é o de hoje (cron ligado) — nunca
 * o contrário, porque o modo silencioso de errar aqui seria a produção inteira
 * ficar sem cron.
 *
 * Roda como provider do AppModule de propósito: o Nest dispara
 * `onApplicationBootstrap` de baixo para cima, então a raiz é chamada DEPOIS do
 * `ScheduleExplorer` — os jobs já existem no registry quando chegamos aqui.
 */
@Injectable()
export class SchedulerGuardService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulerGuardService.name);

  constructor(private readonly schedulerRegistry: SchedulerRegistry) {}

  onApplicationBootstrap(): void {
    if (!SchedulerGuardService.isScriptEntrypoint()) return;

    // Escotilha para o script que de fato precisa de um job agendado.
    if (process.env.ANKAA_ENABLE_SCHEDULERS_IN_SCRIPT === '1') {
      this.logger.warn(
        'Entrypoint é script, mas ANKAA_ENABLE_SCHEDULERS_IN_SCRIPT=1 — schedulers MANTIDOS.',
      );
      return;
    }

    let stopped = 0;

    for (const [name, job] of this.schedulerRegistry.getCronJobs()) {
      try {
        job.stop();
        this.schedulerRegistry.deleteCronJob(name);
        stopped++;
      } catch (error: any) {
        this.logger.warn(`Não consegui parar o cron "${name}": ${error.message}`);
      }
    }

    // `@Interval` e `@Timeout` são o mesmo risco por outro decorator.
    for (const name of [...this.schedulerRegistry.getIntervals()]) {
      try {
        this.schedulerRegistry.deleteInterval(name);
        stopped++;
      } catch (error: any) {
        this.logger.warn(`Não consegui parar o intervalo "${name}": ${error.message}`);
      }
    }
    for (const name of [...this.schedulerRegistry.getTimeouts()]) {
      try {
        this.schedulerRegistry.deleteTimeout(name);
        stopped++;
      } catch (error: any) {
        this.logger.warn(`Não consegui parar o timeout "${name}": ${error.message}`);
      }
    }

    this.logger.warn(
      `Entrypoint é script (${SchedulerGuardService.entrypoint()}) — ${stopped} job(s) agendado(s) desligado(s). ` +
        'Use ANKAA_ENABLE_SCHEDULERS_IN_SCRIPT=1 para manter.',
    );
  }

  private static entrypoint(): string {
    // Sob ts-node, `require.main.filename` é o .ts alvo (o argv[1] é o bin do
    // ts-node), então ele é a fonte confiável nas duas formas de invocação.
    return require.main?.filename || process.argv[1] || '';
  }

  private static isScriptEntrypoint(): boolean {
    const entry = SchedulerGuardService.entrypoint().replace(/\\/g, '/');
    return /\/(src|dist)\/scripts\//.test(entry);
  }
}
