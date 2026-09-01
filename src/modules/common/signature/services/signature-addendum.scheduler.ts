/**
 * Varredura que emite o ADITIVO DE IDENTIFICAÇÃO DO VEÍCULO.
 *
 * QUANDO: na finalização do serviço — a tarefa em `COMPLETED`.
 *
 *   Não quando o chassi é cadastrado: naquele instante a placa pode ainda não
 *   ter chegado, e sairiam dois aditivos contando metade da história cada. Na
 *   entrega tudo o que ia chegar já chegou, e a folha vai junto com o resto.
 *
 * POR QUE UMA VARREDURA, E NÃO UM GANCHO NA CONCLUSÃO DA TAREFA
 *   É a mesma razão que fez a checagem de frescor da assinatura sair dos hooks e
 *   virar pergunta no ato: a tarefa é concluída por vários caminhos de escrita
 *   (`PUT /tasks/:id`, conclusão em lote, o auto-preenchimento que fecha a tarefa
 *   quando a última ordem de serviço termina), e perseguir call site por call
 *   site não se sustenta. A varredura pergunta pelo ESTADO — "esta tarefa está
 *   concluída e o aditivo dela ainda não saiu?" — e por isso alcança também as
 *   tarefas concluídas antes deste recurso existir.
 *
 * `issueVehicleAddendum` é idempotente e devolve `null` sem erro quando não há o
 * que aditar (a maioria dos orçamentos), então a varredura pode ser generosa.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SignatureEnvelopeService } from './signature-envelope.service';

@Injectable()
export class SignatureAddendumScheduler {
  private readonly logger = new Logger(SignatureAddendumScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envelopes: SignatureEnvelopeService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweepFinishedServices(): Promise<void> {
    let candidates: Array<{ quoteId: string; budgetNumber: number }>;
    try {
      // O filtro pesado fica no banco: coleta com artefato selado, sem aditivo,
      // e com lacuna reservada. O que sobra é pouco, e `issueVehicleAddendum`
      // decide caso a caso se há algo de fato a declarar.
      const rows = await this.prisma.signatureEnvelope.findMany({
        where: {
          finalFileId: { not: null },
          addendumFileId: null,
          quote: { task: { status: 'COMPLETED' } },
          // `Prisma.DbNull`, e não `null`: num campo Json anulável o Prisma
          // distingue o NULL do banco do `null` de JSON, e `{ not: null }` ali
          // é um no-op silencioso. Sem este filtro os envelopes SEM lacuna
          // nenhuma — que nunca vão render aditivo — ficariam candidatos para
          // sempre e ocupariam o `take` de toda rodada, impedindo a fila de
          // andar.
          NOT: [{ lateSlots: { equals: Prisma.DbNull } }, { lateSlots: { equals: {} } }],
        },
        orderBy: { sealedAt: 'asc' },
        // Teto por rodada: a primeira execução depois do deploy encontra o
        // passivo inteiro, e selar tudo de uma vez são N chamadas ao carimbo do
        // tempo em rajada. O resto sai na hora seguinte.
        take: 25,
        select: { quoteId: true, quote: { select: { budgetNumber: true } } },
      });
      candidates = rows.map(r => ({ quoteId: r.quoteId, budgetNumber: r.quote.budgetNumber }));
    } catch (error) {
      this.logger.error(
        `Falha ao procurar orçamentos para aditivo: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return;
    }

    if (candidates.length === 0) return;

    let issued = 0;
    for (const candidate of candidates) {
      try {
        const result = await this.envelopes.issueVehicleAddendum(candidate.quoteId);
        if (result) issued++;
      } catch (error) {
        // Um orçamento problemático não pode travar a fila dos outros.
        this.logger.error(
          `Falha ao emitir o aditivo do orçamento nº ${candidate.budgetNumber}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    if (issued) {
      this.logger.log(`${issued} aditivo(s) de identificação emitido(s).`);
    }
  }
}
