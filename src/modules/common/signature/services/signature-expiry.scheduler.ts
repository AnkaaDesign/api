/**
 * Varredura de envelopes vencidos.
 *
 * `EnvelopeStatus.EXPIRED` existia no enum e NUNCA era escrito por código algum:
 * um envelope passava do prazo e continuava RUNNING para sempre. Como
 * `createEnvelope` recusa abrir nova coleta enquanto houver uma RUNNING, um
 * orçamento vencido ficava travado — só um operador chamando `cancel()`
 * destravava. A checagem de prazo em `assertSignable` impedia a assinatura, mas
 * o estado mentia para todo o resto do sistema.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvelopeSignerStatus, EnvelopeStatus } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SignatureAuditService } from './signature-audit.service';
import { SigningChallengeService } from './signing-challenge.service';

@Injectable()
export class SignatureExpiryScheduler {
  private readonly logger = new Logger(SignatureExpiryScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: SignatureAuditService,
    private readonly challenges: SigningChallengeService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpired(): Promise<void> {
    const now = new Date();

    const expired = await this.prisma.signatureEnvelope.findMany({
      where: { status: EnvelopeStatus.RUNNING, deadlineAt: { lt: now } },
      select: { id: true, verificationCode: true },
    });
    if (expired.length === 0) return;

    for (const env of expired) {
      try {
        // Reivindicação atômica: um sweep concorrente (ou uma conclusão
        // acontecendo neste exato instante) não pode marcar como expirado algo
        // que já saiu de RUNNING.
        const claim = await this.prisma.signatureEnvelope.updateMany({
          where: { id: env.id, status: EnvelopeStatus.RUNNING },
          data: { status: EnvelopeStatus.EXPIRED },
        });
        if (claim.count === 0) continue;

        await this.prisma.envelopeSigner.updateMany({
          where: { envelopeId: env.id, status: { not: EnvelopeSignerStatus.SIGNED } },
          data: { status: EnvelopeSignerStatus.EXPIRED },
        });
        await this.challenges.supersedeAllForEnvelope(env.id);
        await this.audit.record(env.id, {
          eventType: 'ENVELOPE_EXPIRED',
          actorType: 'SYSTEM',
          payload: { verificationCode: env.verificationCode },
        });
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
