/**
 * Recorte canônico do orçamento — a definição operacional de "alteração material".
 *
 * REGRA CENTRAL: o snapshot contém **exatamente o que o documento exibe**, nada a
 * mais e nada a menos. Isso não é uma escolha estética; é o que torna a pergunta
 * "o orçamento mudou?" decidível por igualdade de hash em vez de por uma lista de
 * campos mantida à mão, que inevitavelmente ficaria dessincronizada do template.
 *
 * Se algo aparece no PDF, entra aqui. Se entra aqui e muda, o envelope é
 * invalidado e as assinaturas coletadas param de valer — o cliente jamais fica
 * vinculado a um documento que se moveu por baixo dele (CC art. 431: aceitação
 * com modificações importa nova proposta; OWASP Transaction Authorization §2.6).
 *
 * O que fica DE FORA de propósito: status, statusOrder, billingApprovedAt,
 * createdAt/updatedAt, ids internos de linha. Nada disso é exibido, e incluí-los
 * geraria invalidações espúrias a cada toque administrativo no registro.
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { canonicalize, sha256Hex } from '../utils/canonical';
import { onlyDigits } from '../utils/identity';

/** Dinheiro sempre como string de 2 casas — nunca float. */
function money(value: Prisma.Decimal | number | null | undefined): string {
  if (value === null || value === undefined) return '0.00';
  const n = typeof value === 'number' ? value : Number(value.toString());
  return n.toFixed(2);
}

function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export interface QuoteSnapshotSigner {
  responsibleId: string;
  name: string;
  phoneDigits: string;
  roles: string[];
}

export interface QuoteSnapshot {
  /** Versão do formato. Incrementar quando o template mudar o que é exibido. */
  schemaVersion: number;
  budgetNumber: number;
  issuedAt: string;
  expiresAt: string;
  customer: {
    id: string | null;
    corporateName: string | null;
    fantasyName: string | null;
    document: string | null;
  } | null;
  task: {
    id: string;
    name: string | null;
    serialNumber: string | null;
  } | null;
  truck: {
    plate: string | null;
    chassisNumber: string | null;
    vinPlate: string | null;
    category: string | null;
    implementType: string | null;
  } | null;
  services: Array<{
    description: string;
    amount: string;
    observation: string | null;
    position: number;
  }>;
  subtotal: string;
  total: string;
  discount: {
    type: string;
    value: string | null;
    reference: string | null;
  };
  paymentCondition: string | null;
  customPaymentText: string | null;
  guaranteeYears: number | null;
  customGuaranteeText: string | null;
  customForecastDays: number | null;
  simultaneousTasks: number | null;
  layoutFileIds: string[];
  signers: QuoteSnapshotSigner[];
  commercialUserId: string | null;
}

export const QUOTE_SNAPSHOT_SCHEMA_VERSION = 1;

/** Include compartilhado — o renderizador e o snapshot precisam ver o MESMO grafo. */
export const QUOTE_SNAPSHOT_INCLUDE = {
  services: { orderBy: { position: 'asc' } },
  layoutFiles: { orderBy: { createdAt: 'asc' } },
  customerConfigs: {
    orderBy: { createdAt: 'asc' },
    include: { customer: true },
  },
  task: {
    include: {
      customer: true,
      truck: true,
      responsibles: { orderBy: { name: 'asc' } },
    },
  },
} satisfies Prisma.TaskQuoteInclude;

export type QuoteWithSnapshotGraph = Prisma.TaskQuoteGetPayload<{
  include: typeof QUOTE_SNAPSHOT_INCLUDE;
}>;

@Injectable()
export class QuoteSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async loadQuoteGraph(quoteId: string): Promise<QuoteWithSnapshotGraph | null> {
    return this.prisma.taskQuote.findUnique({
      where: { id: quoteId },
      include: QUOTE_SNAPSHOT_INCLUDE,
    });
  }

  /**
   * Constrói o snapshot canônico.
   *
   * A primeira `customerConfig` (por createdAt) é a que governa desconto e
   * condição de pagamento exibidos — mesma regra que o gerador do web usa hoje
   * (`firstConfig`). Documentado aqui porque é uma escolha de negócio implícita
   * que agora tem consequência jurídica.
   */
  build(quote: QuoteWithSnapshotGraph): QuoteSnapshot {
    const task = quote.task ?? null;
    const customer = task?.customer ?? null;
    const truck = task?.truck ?? null;
    const firstConfig = quote.customerConfigs[0] ?? null;

    return {
      schemaVersion: QUOTE_SNAPSHOT_SCHEMA_VERSION,
      budgetNumber: quote.budgetNumber,
      // Data de emissão é a criação da quote, NUNCA `new Date()`. O gerador antigo
      // usava a data corrente em um dos caminhos, o que fazia o mesmo orçamento
      // renderizar diferente a cada dia.
      issuedAt: quote.createdAt.toISOString(),
      expiresAt: quote.expiresAt.toISOString(),
      customer: customer
        ? {
            id: customer.id,
            corporateName: customer.corporateName ?? null,
            fantasyName: customer.fantasyName ?? null,
            document: onlyDigits(customer.cnpj ?? customer.cpf ?? '') || null,
          }
        : null,
      task: task ? { id: task.id, name: task.name ?? null, serialNumber: task.serialNumber ?? null } : null,
      truck: truck
        ? {
            plate: truck.plate ?? null,
            chassisNumber: truck.chassisNumber ?? null,
            vinPlate: truck.vinPlate ?? null,
            category: truck.category ?? null,
            implementType: truck.implementType ?? null,
          }
        : null,
      services: quote.services.map(s => ({
        description: s.description,
        amount: money(s.amount),
        observation: s.observation ?? null,
        position: s.position,
      })),
      subtotal: money(quote.subtotal),
      total: money(quote.total),
      discount: {
        type: firstConfig?.discountType ?? 'NONE',
        value: firstConfig?.discountValue != null ? money(firstConfig.discountValue) : null,
        reference: firstConfig?.discountReference ?? null,
      },
      paymentCondition: firstConfig?.paymentCondition ?? null,
      customPaymentText: firstConfig?.customPaymentText ?? null,
      guaranteeYears: quote.guaranteeYears ?? null,
      customGuaranteeText: quote.customGuaranteeText ?? null,
      customForecastDays: quote.customForecastDays ?? null,
      simultaneousTasks: quote.simultaneousTasks ?? null,
      // Ordenado: a ordem de leitura do Prisma não é garantida entre versões, e
      // uma permutação mudaria o hash sem que nada tivesse mudado de fato.
      layoutFileIds: quote.layoutFiles.map(f => f.id).sort(),
      // Os signatários aparecem no documento (uma linha de assinatura cada), logo
      // adicionar ou remover um responsável É alteração material.
      signers: (task?.responsibles ?? [])
        .map(r => ({
          responsibleId: r.id,
          name: r.name,
          phoneDigits: onlyDigits(r.phone),
          roles: [...r.roles].sort(),
        }))
        .sort((a, b) => a.responsibleId.localeCompare(b.responsibleId)),
      commercialUserId: quote.commercialUserId ?? null,
    };
  }

  hash(snapshot: QuoteSnapshot): string {
    return sha256Hex(snapshot as unknown as object);
  }

  /** Carrega, monta e hasheia num passo — o caminho usado pela detecção de mudança. */
  async buildForQuote(
    quoteId: string,
  ): Promise<{ snapshot: QuoteSnapshot; hash: string; quote: QuoteWithSnapshotGraph } | null> {
    const quote = await this.loadQuoteGraph(quoteId);
    if (!quote) return null;
    const snapshot = this.build(quote);
    return { snapshot, hash: this.hash(snapshot), quote };
  }

  /**
   * Diferença legível entre dois snapshots, para dizer ao signatário o que mudou
   * em vez de um genérico "o documento foi alterado".
   */
  diff(before: QuoteSnapshot, after: QuoteSnapshot): string[] {
    const changes: string[] = [];
    // canonicalize(), NUNCA JSON.stringify: o snapshot anterior volta do JSONB do
    // Postgres com a ordem das chaves alterada, e uma comparação sensível à ordem
    // apontaria "cliente, veículo, responsáveis" como alterados quando só o preço
    // mudou. O hash sempre esteve certo (ele canonicaliza); era a mensagem ao
    // cliente que mentia — e é exatamente ela que sustenta a boa-fé da Ankaa.
    const cmp = (label: string, a: unknown, b: unknown) => {
      if (canonicalize(a ?? null) !== canonicalize(b ?? null)) changes.push(label);
    };

    cmp('valor total', before.total, after.total);
    cmp('subtotal', before.subtotal, after.subtotal);
    cmp('serviços', before.services, after.services);
    cmp('desconto', before.discount, after.discount);
    cmp('condição de pagamento', [before.paymentCondition, before.customPaymentText], [
      after.paymentCondition,
      after.customPaymentText,
    ]);
    cmp('garantia', [before.guaranteeYears, before.customGuaranteeText], [
      after.guaranteeYears,
      after.customGuaranteeText,
    ]);
    cmp('prazo de entrega', before.customForecastDays, after.customForecastDays);
    cmp('validade', before.expiresAt, after.expiresAt);
    cmp('veículo', before.truck, after.truck);
    cmp('cliente', before.customer, after.customer);
    cmp('layout', before.layoutFileIds, after.layoutFileIds);
    cmp('responsáveis', before.signers, after.signers);

    return changes;
  }
}
