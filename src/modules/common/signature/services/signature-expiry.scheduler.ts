/**
 * Varredura de envelopes vencidos.
 *
 * `EnvelopeStatus.EXPIRED` existia no enum e NUNCA era escrito por código algum:
 * um envelope passava do prazo e continuava RUNNING para sempre. Como
 * `createEnvelope` recusa abrir nova coleta enquanto houver uma RUNNING, um
 * orçamento vencido ficava travado — só um operador chamando `cancel()`
 * destravava. A checagem de prazo em `assertSignable` impedia a assinatura, mas
 * o estado mentia para todo o resto do sistema.
 *
 * O QUE ESTA VARREDURA PASSOU A FAZER (11/09/2026)
 *   Marcar o envelope nunca foi o bastante. O ORÇAMENTO continuava PENDING,
 *   indistinguível de um criado naquela manhã: ninguém no comercial era avisado
 *   de que havia um valor para reanalisar, e o cliente que estava decidindo
 *   ficava sem notícia. Agora a varredura fecha o ciclo — avisa quem assinaria,
 *   avisa quem vende, e move o orçamento para `EXPIRED`.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BudgetSignatureStatus, EnvelopeSignerStatus, EnvelopeStatus } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SignatureAuditService } from './signature-audit.service';
import { SignatureEnvelopeService } from './signature-envelope.service';
import { SigningChallengeService } from './signing-challenge.service';

@Injectable()
export class SignatureExpiryScheduler {
  private readonly logger = new Logger(SignatureExpiryScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: SignatureAuditService,
    private readonly challenges: SigningChallengeService,
    private readonly envelopes: SignatureEnvelopeService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpired(): Promise<void> {
    const now = new Date();

    const candidates = await this.prisma.signatureEnvelope.findMany({
      where: { status: EnvelopeStatus.RUNNING, deadlineAt: { lt: now } },
      select: {
        id: true,
        quoteId: true,
        verificationCode: true,
        quote: { select: { budgetNumber: true, expiryNoticeSentAt: true } },
        signers: { select: { orderGroup: true, status: true } },
      },
    });
    if (candidates.length === 0) return;

    // ─────────────────────────────────────────────────────────────────────────
    // O PRAZO É DO CLIENTE, NÃO DA NOSSA BUROCRACIA.
    //
    // Um envelope em que TODOS os responsáveis do cliente já assinaram e só
    // falta a contra-assinatura da Ankaa continua RUNNING — e, até hoje, era
    // varrido como qualquer outro assim que a data virava. Quer dizer: o cliente
    // aceitava a proposta dentro da validade, a Ankaa demorava dois dias para
    // contra-assinar, e o sistema anulava as assinaturas DELE por atraso NOSSO.
    //
    // A validade limita a janela em que a proposta pode ser aceita. Aceita ela,
    // o relógio parou. O que falta vira cobrança interna — ver o estado SIGNED
    // do orçamento e a notificação de contra-assinatura pendente.
    // ─────────────────────────────────────────────────────────────────────────
    const expired = candidates.filter(env => {
      const customerPending = env.signers.filter(
        s => s.orderGroup === 0 && s.status !== EnvelopeSignerStatus.SIGNED,
      ).length;
      if (customerPending === 0) {
        this.logger.log(
          `Envelope ${env.id} passou do prazo com o cliente INTEIRO assinado — ` +
            'mantido vivo à espera da contra-assinatura da Ankaa.',
        );
        return false;
      }
      return true;
    });
    if (expired.length === 0) return;

    for (const env of expired) {
      try {
        // Reivindicação atômica: um sweep concorrente (ou uma conclusão
        // acontecendo neste exato instante) não pode marcar como expirado algo
        // que já saiu de RUNNING.
        //
        // Envelope, signatários e o EIXO DA ASSINATURA (D-28) no mesmo commit:
        // antes eram três escritas soltas, e um processo morrendo entre elas
        // deixava o envelope vencido com o orçamento "aguardando o cliente".
        const claimed = await this.prisma.$transaction(async tx => {
          const claim = await tx.signatureEnvelope.updateMany({
            where: { id: env.id, status: EnvelopeStatus.RUNNING },
            data: { status: EnvelopeStatus.EXPIRED },
          });
          if (claim.count === 0) return false;

          await tx.envelopeSigner.updateMany({
            where: { envelopeId: env.id, status: { not: EnvelopeSignerStatus.SIGNED } },
            data: { status: EnvelopeSignerStatus.EXPIRED },
          });
          await this.envelopes.writeSignatureAxis(tx, {
            quoteId: env.quoteId,
            to: BudgetSignatureStatus.EXPIRED,
            onlyFrom: [BudgetSignatureStatus.AWAITING_CUSTOMER],
            reason: 'A validade venceu com assinatura do cliente faltando.',
          });
          return true;
        });
        if (!claimed) continue;

        await this.challenges.supersedeAllForEnvelope(env.id);
        await this.audit.record(env.id, {
          eventType: 'ENVELOPE_EXPIRED',
          actorType: 'SYSTEM',
          payload: { verificationCode: env.verificationCode },
        });

        // ─────────────────────────────────────────────────────────────────────
        // AVISA O CLIENTE — uma vez por ORÇAMENTO.
        //
        // O carimbo é do orçamento e não do envelope porque é do orçamento que
        // o cliente é avisado. Ele existe para que a rodada da HORA SEGUINTE não
        // reavise quem já recebeu quando este laço morre no meio.
        //
        // Não é "uma vez na vida": `createEnvelope` o zera a cada nova coleta.
        // Um orçamento reformulado que vença outra vez é outra proposta, e
        // silenciar o segundo vencimento seria o cliente descobrir sozinho.
        // ─────────────────────────────────────────────────────────────────────
        // ⚠️ TRY PRÓPRIO. O aviso ao cliente fala com dois transportes de rede;
        // a mudança de estado do orçamento é uma escrita local. Debaixo do mesmo
        // `catch`, um WhatsApp que não sai deixaria o orçamento em PENDING para
        // sempre — e ele nunca mais entraria nesta varredura, porque o envelope
        // já saiu de RUNNING na reivindicação acima. O envio é best-effort; a
        // mudança de estado, não.
        if (!env.quote?.expiryNoticeSentAt) {
          try {
            const outcome = await this.envelopes.notifyExpiry(env.id);
            await this.prisma.budget.update({
              where: { id: env.quoteId },
              data: { expiryNoticeSentAt: new Date() },
            });
            this.logger.log(
              `Orçamento nº ${env.quote?.budgetNumber ?? env.quoteId}: aviso de vencimento — ` +
                `${outcome.notified} entregue(s), ${outcome.failed} falha(s).`,
            );
          } catch (noticeError) {
            this.logger.error(
              `Falha ao avisar o cliente do vencimento do orçamento ${env.quoteId}: ${
                noticeError instanceof Error ? noticeError.message : noticeError
              }`,
            );
          }
        }

        // Move o orçamento para "Aguardando Reanálise" e avisa o comercial. O
        // gancho é registrado pelo `BudgetModule`: a cerimônia não conhece o
        // domínio de orçamento, pelo mesmo motivo do `onEnvelopeCompleted`.
        await this.envelopes.notifyQuoteExpired(env.quoteId, env.id);
      } catch (error) {
        this.logger.error(
          `Falha ao expirar o envelope ${env.id}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    this.logger.log(`${expired.length} envelope(s) marcados como expirados.`);
  }

  /** Higieniza desafios OTP vencidos — evita PENDING eterno na tabela. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweepChallenges(): Promise<void> {
    try {
      await this.prisma.signingChallenge.updateMany({
        where: { status: 'PENDING', expiresAt: { lt: new Date() } },
        data: { status: 'EXPIRED' },
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao higienizar desafios: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
