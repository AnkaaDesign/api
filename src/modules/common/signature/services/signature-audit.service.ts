/**
 * Trilha de auditoria da assinatura — append-only e encadeada por hash.
 *
 * Cada evento carrega `prevHash` (o hash do evento anterior do MESMO envelope) e
 * `hash = SHA256(prevHash || JCS(campos canônicos))`. Consequência: remover,
 * reordenar ou editar qualquer evento quebra todos os elos seguintes, e a quebra
 * é *demonstrável* por qualquer perito com o arquivo em mãos — sem precisar
 * confiar em nós.
 *
 * A cadeia é POR ENVELOPE, não global. Uma cadeia global serializaria toda
 * escrita do sistema atrás de uma única linha quente; por envelope, a contenção
 * fica restrita a uma cerimônia, que é exatamente o escopo que um juiz examina.
 *
 * Complementos que a migration instala: trigger que rejeita UPDATE/DELETE, e
 * CHECK de sequence não-negativa. O teto honesto é que um superusuário pode
 * desabilitar o trigger — por isso a cadeia de hash existe: ela não torna a
 * adulteração impossível, torna-a provável de ser detectada.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SignatureEventType } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CHAIN_GENESIS_HASH, chainHash, canonicalize, type CanonicalValue } from '../utils/canonical';

export type SignatureActorType = 'SIGNER' | 'OPERATOR' | 'SYSTEM';

export interface AuditEventInput {
  eventType: SignatureEventType;
  actorType: SignatureActorType;
  actorId?: string | null;
  actorLabel?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  documentHash?: string | null;
  /**
   * Metadados livres, em JSON canonizável (`CanonicalValue`): escalares, listas
   * e objetos aninhados. A lista de recortes congelados numa emissão é uma lista
   * de objetos, e achatá-la numa string a tornaria ilegível justamente onde ela
   * precisa ser lida — na trilha que descreve quem recebeu o quê.
   *
   * NADA DE DECIMAL, e a razão não mudou: o JSONB do Postgres renormaliza
   * números decimais na ida e volta, o que faria o hash divergir sem que nada
   * tivesse sido adulterado. Dinheiro vai como string de 2 casas, e
   * `canonicalize` LANÇA em `Prisma.Decimal`, `BigInt` e instâncias de classe —
   * a barreira é de runtime, não de tipo.
   */
  payload?: Record<string, CanonicalValue> | null;
}

export interface ChainVerificationResult {
  valid: boolean;
  eventCount: number;
  /** Primeiro índice cujo hash não confere; null quando a cadeia está íntegra. */
  brokenAtSequence: number | null;
  reason: string | null;
}

@Injectable()
export class SignatureAuditService {
  private readonly logger = new Logger(SignatureAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava um evento e devolve o hash resultante. **Lança em caso de falha.**
   *
   * Diferença deliberada em relação ao serviço de auditoria de EPI, que engole
   * toda exceção: aqui o evento *é* a prova. Para atos probatórios
   * (SIGNATURE_APPLIED, OTP_VERIFIED, DECLARATIONS_ACCEPTED) perder o registro em
   * silêncio é pior do que falhar a operação — o cliente ficaria vinculado a um
   * documento cuja cerimônia não podemos reconstituir.
   */
  async record(
    envelopeId: string,
    input: AuditEventInput,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const run = async (client: Prisma.TransactionClient): Promise<string> => {
      // Serializa a atribuição de `sequence` por envelope. Sem o lock, dois
      // eventos concorrentes leem o mesmo max(sequence) e um deles viola
      // @@unique([envelopeId, sequence]) — ou pior, encadeiam do mesmo prevHash
      // e bifurcam a cadeia.
      await client.$queryRaw`SELECT id FROM "SignatureEnvelope" WHERE id = ${envelopeId} FOR UPDATE`;

      const last = await client.signatureAuditEvent.findFirst({
        where: { envelopeId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true, hash: true },
      });

      const sequence = last ? last.sequence + 1 : 0;
      const prevHash = last ? last.hash : CHAIN_GENESIS_HASH;
      const occurredAt = new Date();

      const canonicalFields = this.buildCanonicalFields({
        envelopeId,
        sequence,
        occurredAt,
        input,
      });
      const hash = chainHash(prevHash, canonicalFields);

      await client.signatureAuditEvent.create({
        data: {
          envelopeId,
          sequence,
          eventType: input.eventType,
          occurredAt,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          actorLabel: input.actorLabel ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          documentHash: input.documentHash ?? null,
          payload: (input.payload ?? null) as Prisma.InputJsonValue,
          prevHash,
          hash,
        },
      });

      return hash;
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }

  /**
   * Variante que não lança, para eventos de telemetria cuja perda não
   * compromete a prova da autoria (DOCUMENT_VIEWED, DOCUMENT_DOWNLOADED,
   * VERIFICATION_VIEWED). Nunca use para atos probatórios.
   */
  async recordBestEffort(envelopeId: string, input: AuditEventInput): Promise<void> {
    try {
      await this.record(envelopeId, input);
    } catch (error) {
      this.logger.error(
        `Falha ao registrar evento ${input.eventType} do envelope ${envelopeId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  /**
   * Recomputa a cadeia inteira e aponta o primeiro elo divergente.
   *
   * É isto que se roda diante de uma alegação de adulteração, e o que alimenta o
   * selo "trilha íntegra" da página de verificação pública.
   */
  async verifyChain(envelopeId: string): Promise<ChainVerificationResult> {
    const events = await this.prisma.signatureAuditEvent.findMany({
      where: { envelopeId },
      orderBy: { sequence: 'asc' },
    });

    if (events.length === 0) {
      return { valid: true, eventCount: 0, brokenAtSequence: null, reason: null };
    }

    let prevHash = CHAIN_GENESIS_HASH;

    for (const [index, event] of events.entries()) {
      if (event.sequence !== index) {
        return {
          valid: false,
          eventCount: events.length,
          brokenAtSequence: event.sequence,
          reason: `Sequência descontínua: esperado ${index}, encontrado ${event.sequence} (evento removido?)`,
        };
      }

      if (event.prevHash !== prevHash) {
        return {
          valid: false,
          eventCount: events.length,
          brokenAtSequence: event.sequence,
          reason: 'Elo anterior não confere — evento inserido, removido ou reordenado.',
        };
      }

      const expected = chainHash(
        prevHash,
        this.buildCanonicalFields({
          envelopeId,
          sequence: event.sequence,
          occurredAt: event.occurredAt,
          input: {
            eventType: event.eventType,
            actorType: event.actorType as SignatureActorType,
            actorId: event.actorId,
            actorLabel: event.actorLabel,
            ipAddress: event.ipAddress,
            userAgent: event.userAgent,
            documentHash: event.documentHash,
            payload: event.payload as AuditEventInput['payload'],
          },
        }),
      );

      if (expected !== event.hash) {
        return {
          valid: false,
          eventCount: events.length,
          brokenAtSequence: event.sequence,
          reason: 'Conteúdo do evento foi alterado após a gravação.',
        };
      }

      prevHash = event.hash;
    }

    return { valid: true, eventCount: events.length, brokenAtSequence: null, reason: null };
  }

  async getTrail(envelopeId: string) {
    return this.prisma.signatureAuditEvent.findMany({
      where: { envelopeId },
      orderBy: { sequence: 'asc' },
    });
  }

  /** Hash do último elo — o que se ancora externamente (WORM / OpenTimestamps). */
  async getChainTip(envelopeId: string): Promise<string> {
    const last = await this.prisma.signatureAuditEvent.findFirst({
      where: { envelopeId },
      orderBy: { sequence: 'desc' },
      select: { hash: true },
    });
    return last?.hash ?? CHAIN_GENESIS_HASH;
  }

  /**
   * Recorte canônico usado no encadeamento.
   *
   * Lista de campos EXPLÍCITA e fixa, nunca a linha do Prisma inteira: um campo
   * novo no modelo mudaria retroativamente o hash de todos os eventos antigos e
   * invalidaria cadeias íntegras.
   */
  private buildCanonicalFields(args: {
    envelopeId: string;
    sequence: number;
    occurredAt: Date;
    input: AuditEventInput;
  }): Record<string, unknown> {
    const { envelopeId, sequence, occurredAt, input } = args;
    return {
      envelopeId,
      sequence,
      eventType: input.eventType,
      occurredAt: occurredAt.toISOString(),
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      actorLabel: input.actorLabel ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      documentHash: input.documentHash ?? null,
      // canonicalize() ordena as chaves, então a reordenação do JSONB na volta do
      // banco é irrelevante — desde que o payload não contenha decimais.
      payload: input.payload ?? null,
    };
  }

  /** Exposto para testes e para o assinador do dossiê. */
  static canonicalPreview(fields: Record<string, unknown>): string {
    return canonicalize(fields);
  }
}
