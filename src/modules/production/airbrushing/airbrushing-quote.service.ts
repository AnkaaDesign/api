import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  AirbrushingQuoteNotificationService,
  type AirbrushingQuoteNotifyIntent,
} from '@modules/common/notification/airbrushing-quote-notification.service';
import {
  AIRBRUSHING_QUOTE_ACTION,
  AIRBRUSHING_QUOTE_PARTY,
  AIRBRUSHING_QUOTE_STATUS,
  AIRBRUSHING_STATUS,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  LAYOUT_STATUS,
  SECTOR_PRIVILEGES,
} from '../../../constants/enums';
import {
  OPEN_AIRBRUSHING_QUOTE_STATUSES,
  canCompanyCounter,
  canCompanySelect,
  canPainterAccept,
  canPainterDecline,
  canPainterPropose,
  computeExpectedFinishDate,
  isAirbrushingQuoting,
  mergeCounterTerms,
  normalizeQuoteAmount,
  painterQuoteStage,
} from '../../../utils/airbrushing-quote';
import { getAirbrushingStatusOrder } from '../../../utils/sortOrder';
import { EMPLOYED_USER_WHERE } from '../../../utils/contract';
import type {
  AirbrushingQuoteAcceptFormData,
  AirbrushingQuoteCounterFormData,
  AirbrushingQuoteNoteFormData,
  AirbrushingQuoteProposeFormData,
  AirbrushingQuoteRequestsQuery,
} from '../../../schemas/airbrushing-quote';

/** Condições de uma negociação: valor e tempo de execução. */
export interface QuoteTerms {
  amount: number | null;
  executionTime: number | null;
  executionTimeUnit: string | null;
}

function termsOf(q: {
  amount: number | null;
  executionTime?: number | null;
  executionTimeUnit?: string | null;
}): QuoteTerms {
  return {
    amount: q.amount ?? null,
    executionTime: q.executionTime ?? null,
    executionTimeUnit: (q.executionTimeUnit as string | null | undefined) ?? null,
  };
}

/** Include canônico de uma negociação: aerografista (id/nome) e a linha do tempo. */
const QUOTE_INCLUDE = {
  painter: { select: { id: true, name: true, avatarId: true } },
  events: {
    orderBy: { createdAt: 'asc' as const },
    include: { user: { select: { id: true, name: true } } },
  },
};

/** Papéis que enxergam e decidem a cotação inteira. */
export const AIRBRUSHING_QUOTE_COMPANY_ROLES = [
  SECTOR_PRIVILEGES.ADMIN,
  SECTOR_PRIVILEGES.COMMERCIAL,
] as const;

/** Papéis que enxergam os valores de todas as negociações (leitura). */
export const AIRBRUSHING_QUOTE_VIEW_ROLES: string[] = [
  SECTOR_PRIVILEGES.ADMIN,
  SECTOR_PRIVILEGES.COMMERCIAL,
  SECTOR_PRIVILEGES.FINANCIAL,
];

/**
 * Recorta as negociações ao que este papel pode ver. O aerografista vê só a
 * DELE — o lance de um nunca chega ao outro, nem por `?include={"quotes":true}`.
 * Papéis sem acesso a dinheiro não recebem negociação nenhuma.
 */
export function filterAirbrushingQuotesForRole<T extends { quotes?: any[] | null }>(
  entity: T,
  userRole?: string,
  userId?: string,
): T {
  if (!entity || !Array.isArray(entity.quotes)) return entity;
  if (userRole && AIRBRUSHING_QUOTE_VIEW_ROLES.includes(userRole)) return entity;
  if (userRole === SECTOR_PRIVILEGES.AIRBRUSHING && userId) {
    return { ...entity, quotes: entity.quotes.filter(q => q.painterId === userId) };
  }
  return { ...entity, quotes: [] };
}

/**
 * Encerra, dentro da transação, as negociações de uma aerografia.
 *
 * Exportada solta (e não como método) porque o TaskService também cancela
 * aerografias pelo formulário da tarefa, falando com `tx.airbrushing` cru — a
 * regra de encerramento precisa ser a MESMA nos dois caminhos.
 *
 * Devolve os aerografistas que tinham negociação viva, para o aviso de
 * "cotação encerrada" pós-commit.
 */
export async function closeAirbrushingQuotesInTx(
  tx: PrismaTransaction,
  airbrushingId: string,
  params: {
    actorUserId: string | null;
    /** Negociação que NÃO é encerrada (a selecionada). */
    exceptQuoteId?: string;
    /** Também encerra uma negociação SELECTED — usado ao reabrir a cotação. */
    includeSelected?: boolean;
    note: string;
  },
): Promise<string[]> {
  const statuses: AIRBRUSHING_QUOTE_STATUS[] = [...OPEN_AIRBRUSHING_QUOTE_STATUSES];
  if (params.includeSelected) statuses.push(AIRBRUSHING_QUOTE_STATUS.SELECTED);

  const toClose = await tx.airbrushingQuote.findMany({
    where: {
      airbrushingId,
      status: { in: statuses as any },
      ...(params.exceptQuoteId ? { id: { not: params.exceptQuoteId } } : {}),
    },
    select: { id: true, painterId: true },
  });
  if (!toClose.length) return [];

  await tx.airbrushingQuote.updateMany({
    where: { id: { in: toClose.map(q => q.id) } },
    data: { status: AIRBRUSHING_QUOTE_STATUS.NOT_SELECTED as any },
  });
  await tx.airbrushingQuoteEvent.createMany({
    data: toClose.map(q => ({
      quoteId: q.id,
      party: AIRBRUSHING_QUOTE_PARTY.COMPANY as any,
      action: AIRBRUSHING_QUOTE_ACTION.CLOSE as any,
      note: params.note,
      userId: params.actorUserId,
    })),
  });

  return toClose.map(q => q.painterId);
}

/**
 * Aplica, dentro da transação, a regra da cotação a uma aerografia EXISTENTE
 * gravada pelo formulário da tarefa (que fala com `tx.airbrushing` cru e cujo
 * schema aninhado tem `status` com default PREPARATION — sem esta guarda, todo
 * salvamento da tarefa tirava a aerografia de cotação em silêncio).
 *
 * - Em cotação: continua em cotação, sem aerografista e sem valor — a não ser
 *   que o formulário a CANCELE, o que encerra as negociações.
 * - Fora de cotação: não entra nela por aqui (isso é o "Reabrir cotação").
 *
 * Mutates `item`. Devolve os aerografistas a avisar do encerramento.
 */
export async function applyQuotingToNestedAirbrushingUpdate(
  tx: PrismaTransaction,
  existing: { id: string; status: string },
  item: Record<string, any>,
  actorUserId: string | null,
): Promise<string[]> {
  if (!isAirbrushingQuoting(existing.status)) {
    if (isAirbrushingQuoting(item.status)) item.status = existing.status;
    return [];
  }

  delete item.painterId;
  delete item.price;
  if (item.status !== AIRBRUSHING_STATUS.CANCELLED) {
    item.status = AIRBRUSHING_STATUS.QUOTING;
    return [];
  }

  await tx.airbrushing.update({
    where: { id: existing.id },
    data: { quotationClosedAt: new Date() },
  });
  return closeAirbrushingQuotesInTx(tx, existing.id, {
    actorUserId,
    note: 'A aerografia foi cancelada.',
  });
}

/**
 * =============================================================================
 * COTAÇÃO DA AEROGRAFIA — proposta, contraproposta, aceite, recusa e seleção
 * =============================================================================
 *
 * As regras de transição moram em utils/airbrushing-quote.ts (puras, testadas);
 * aqui fica a persistência, o recorte por papel e as notificações.
 *
 * CONCORRÊNCIA
 *   Toda ação trava a linha da aerografia (`SELECT … FOR UPDATE`) antes de ler
 *   o estado. Sem isso, um aerografista que aceita a contraproposta no mesmo
 *   instante em que o comercial seleciona outro deixaria duas negociações
 *   "vivas" numa aerografia já fechada.
 * =============================================================================
 */
@Injectable()
export class AirbrushingQuoteService {
  private readonly logger = new Logger(AirbrushingQuoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly notifier: AirbrushingQuoteNotificationService,
  ) {}

  // ===========================================================================
  // Leitura — lado do aerografista
  // ===========================================================================

  /**
   * Cotações do aerografista. `open`: toda aerografia em cotação (ele pode cotar
   * todas). `closed`: cotações de que ele participou e que já terminaram.
   */
  async listPainterRequests(painterId: string, query: AirbrushingQuoteRequestsQuery) {
    const where =
      query.scope === 'open'
        ? { status: AIRBRUSHING_STATUS.QUOTING as any }
        : {
            status: { not: AIRBRUSHING_STATUS.QUOTING as any },
            quotes: { some: { painterId } },
          };

    const rows = await this.prisma.airbrushing.findMany({
      where,
      select: this.painterAirbrushingSelect(painterId),
      orderBy:
        query.scope === 'open'
          ? [{ quotationOpenedAt: 'desc' }, { createdAt: 'desc' }]
          : [{ quotationClosedAt: 'desc' }, { updatedAt: 'desc' }],
      take: query.limit,
    });

    const data = rows.map(row => this.toPainterView(row));

    // O que pede ação dele primeiro: contraproposta recebida, depois sem proposta.
    if (query.scope === 'open') {
      const rank: Record<string, number> = {
        COUNTER_RECEIVED: 0,
        OFFER_RECEIVED: 1,
        AWAITING_PROPOSAL: 1,
        AWAITING_COMPANY: 2,
        ACCEPTED: 3,
        DECLINED: 4,
      };
      data.sort((a, b) => (rank[a.stage] ?? 9) - (rank[b.stage] ?? 9));
    }

    return {
      success: true,
      message: 'Cotações carregadas com sucesso.',
      data,
      meta: {
        awaitingAction: data.filter(
          d =>
            d.stage === 'COUNTER_RECEIVED' ||
            d.stage === 'OFFER_RECEIVED' ||
            d.stage === 'AWAITING_PROPOSAL',
        ).length,
      },
    };
  }

  /** Uma cotação, do ponto de vista do aerografista. */
  async getPainterRequest(airbrushingId: string, painterId: string) {
    const row = await this.prisma.airbrushing.findUnique({
      where: { id: airbrushingId },
      select: this.painterAirbrushingSelect(painterId),
    });
    // Fora de cotação, ele só enxerga as cotações de que participou.
    if (!row || (!isAirbrushingQuoting(row.status) && !row.quotes.length)) {
      throw new NotFoundException('Cotação não encontrada.');
    }
    return {
      success: true,
      message: 'Cotação carregada com sucesso.',
      data: this.toPainterView(row),
    };
  }

  // ===========================================================================
  // Leitura — lado do comercial
  // ===========================================================================

  /**
   * Todas as negociações de uma aerografia, mais os aerografistas que ainda não
   * responderam — o comercial precisa saber de quem está esperando.
   */
  async listForAirbrushing(airbrushingId: string) {
    const airbrushing = await this.prisma.airbrushing.findUnique({
      where: { id: airbrushingId },
      select: {
        id: true,
        status: true,
        price: true,
        painterId: true,
        startDate: true,
        executionTime: true,
        executionTimeUnit: true,
        quotationOpenedAt: true,
        quotationNotifiedAt: true,
        quotationClosedAt: true,
        quotationOfferAmount: true,
        quotationOfferExecutionTime: true,
        quotationOfferExecutionTimeUnit: true,
        quotes: { include: QUOTE_INCLUDE, orderBy: { updatedAt: 'desc' } },
      },
    });
    if (!airbrushing) throw new NotFoundException('Aerografia não encontrada.');

    const respondedIds = new Set(airbrushing.quotes.map(q => q.painterId));
    const pendingPainters = isAirbrushingQuoting(airbrushing.status)
      ? (await this.eligiblePainters()).filter(p => !respondedIds.has(p.id))
      : [];

    const { quotes, ...summary } = airbrushing;
    return {
      success: true,
      message: 'Cotação carregada com sucesso.',
      data: { airbrushing: summary, quotes, pendingPainters },
    };
  }

  // ===========================================================================
  // Ações do aerografista
  // ===========================================================================

  /** Envia, revisa ou contrapõe com as suas condições: valor e tempo de execução. */
  async propose(airbrushingId: string, painterId: string, input: AirbrushingQuoteProposeFormData) {
    const terms: QuoteTerms = {
      amount: normalizeQuoteAmount(input.amount),
      executionTime: input.executionTime,
      executionTimeUnit: input.executionTimeUnit,
    };
    const intents: AirbrushingQuoteNotifyIntent[] = [];

    const quote = await this.prisma.$transaction(async tx => {
      await this.lockQuotingAirbrushing(tx, airbrushingId);
      const existing = await tx.airbrushingQuote.findUnique({
        where: { airbrushingId_painterId: { airbrushingId, painterId } },
      });

      if (!canPainterPropose(existing?.status as any)) {
        throw new BadRequestException(
          'Você já aceitou as condições desta aerografia. Para mudá-las, recuse primeiro.',
        );
      }

      // Responder a uma contraproposta com outras condições é uma contraproposta
      // do aerografista; o resto é proposta (primeira, revisão ou reconsideração).
      const action =
        existing?.status === AIRBRUSHING_QUOTE_STATUS.COUNTERED
          ? AIRBRUSHING_QUOTE_ACTION.COUNTER
          : AIRBRUSHING_QUOTE_ACTION.PROPOSAL;

      const saved = await this.saveQuote(tx, airbrushingId, painterId, {
        status: AIRBRUSHING_QUOTE_STATUS.PROPOSED,
        ...terms,
      });
      await this.recordEvent(tx, saved.id, AIRBRUSHING_QUOTE_PARTY.PAINTER, action, {
        ...terms,
        note: input.note,
        userId: painterId,
      });

      intents.push({
        kind: 'proposed',
        airbrushingId,
        painterId,
        actorUserId: painterId,
        terms,
        note: input.note ?? null,
      });
      return this.reloadQuote(tx, saved.id);
    });

    await this.notifier.flush(intents);
    return { success: true, message: 'Proposta enviada.', data: quote };
  }

  /**
   * Aceita as condições da empresa — a contraproposta, ou o orçamento com que a
   * cotação abriu. NÃO seleciona: o comercial ainda escolhe.
   *
   * Orçamento SEM tempo de execução: o aerografista informa o próprio prazo, e
   * isso vira uma proposta (valor da empresa + prazo dele), porque o comercial
   * ainda não concordou com o prazo.
   */
  async accept(airbrushingId: string, painterId: string, input: AirbrushingQuoteAcceptFormData) {
    const intents: AirbrushingQuoteNotifyIntent[] = [];

    const quote = await this.prisma.$transaction(async tx => {
      const airbrushing = await this.lockQuotingAirbrushing(tx, airbrushingId);
      const existing = await tx.airbrushingQuote.findUnique({
        where: { airbrushingId_painterId: { airbrushingId, painterId } },
      });
      const hasOffer = airbrushing.quotationOfferAmount != null;

      if (!canPainterAccept(existing?.status as any, hasOffer)) {
        throw new BadRequestException('Não há proposta da empresa aguardando a sua resposta.');
      }

      // 1) Contraproposta: as condições em jogo são as da empresa.
      if (existing?.status === AIRBRUSHING_QUOTE_STATUS.COUNTERED) {
        const terms = termsOf(existing);
        await tx.airbrushingQuote.update({
          where: { id: existing.id },
          data: { status: AIRBRUSHING_QUOTE_STATUS.ACCEPTED as any },
        });
        await this.recordEvent(
          tx,
          existing.id,
          AIRBRUSHING_QUOTE_PARTY.PAINTER,
          AIRBRUSHING_QUOTE_ACTION.ACCEPT,
          { ...terms, note: input.note, userId: painterId },
        );
        intents.push({
          kind: 'accepted',
          airbrushingId,
          painterId,
          actorUserId: painterId,
          terms,
          note: input.note ?? null,
        });
        return this.reloadQuote(tx, existing.id);
      }

      // 2) Orçamento de abertura.
      const offerHasTime =
        airbrushing.quotationOfferExecutionTime != null &&
        airbrushing.quotationOfferExecutionTimeUnit != null;
      if (!offerHasTime && (input.executionTime == null || input.executionTimeUnit == null)) {
        throw new BadRequestException(
          'O orçamento não define o tempo de execução — informe em quantas horas ou dias você faz.',
        );
      }
      const terms: QuoteTerms = {
        amount: airbrushing.quotationOfferAmount,
        executionTime: offerHasTime
          ? airbrushing.quotationOfferExecutionTime
          : (input.executionTime ?? null),
        executionTimeUnit: offerHasTime
          ? airbrushing.quotationOfferExecutionTimeUnit
          : (input.executionTimeUnit ?? null),
      };
      const status = offerHasTime
        ? AIRBRUSHING_QUOTE_STATUS.ACCEPTED
        : AIRBRUSHING_QUOTE_STATUS.PROPOSED;

      const saved = await this.saveQuote(tx, airbrushingId, painterId, { status, ...terms });
      await this.recordEvent(
        tx,
        saved.id,
        AIRBRUSHING_QUOTE_PARTY.PAINTER,
        AIRBRUSHING_QUOTE_ACTION.ACCEPT,
        { ...terms, note: input.note, userId: painterId },
      );
      intents.push({
        kind: offerHasTime ? 'accepted' : 'proposed',
        airbrushingId,
        painterId,
        actorUserId: painterId,
        terms,
        note: input.note ?? null,
      });
      return this.reloadQuote(tx, saved.id);
    });

    await this.notifier.flush(intents);
    return { success: true, message: 'Condições aceitas.', data: quote };
  }

  /** Recusa: sem interesse no serviço, ou discordando das condições da empresa. */
  async decline(airbrushingId: string, painterId: string, input: AirbrushingQuoteNoteFormData) {
    const intents: AirbrushingQuoteNotifyIntent[] = [];

    const quote = await this.prisma.$transaction(async tx => {
      await this.lockQuotingAirbrushing(tx, airbrushingId);
      const existing = await tx.airbrushingQuote.findUnique({
        where: { airbrushingId_painterId: { airbrushingId, painterId } },
      });
      if (!canPainterDecline(existing?.status as any)) {
        throw new BadRequestException('Você já recusou esta aerografia.');
      }

      const saved = existing
        ? await tx.airbrushingQuote.update({
            where: { id: existing.id },
            data: { status: AIRBRUSHING_QUOTE_STATUS.DECLINED as any },
          })
        : await tx.airbrushingQuote.create({
            data: {
              airbrushingId,
              painterId,
              status: AIRBRUSHING_QUOTE_STATUS.DECLINED as any,
              amount: null,
            },
          });
      await this.recordEvent(
        tx,
        saved.id,
        AIRBRUSHING_QUOTE_PARTY.PAINTER,
        AIRBRUSHING_QUOTE_ACTION.DECLINE,
        {
          amount: null,
          executionTime: null,
          executionTimeUnit: null,
          note: input.note,
          userId: painterId,
        },
      );

      intents.push({
        kind: 'declined',
        airbrushingId,
        painterId,
        actorUserId: painterId,
        terms: termsOf(saved),
        note: input.note ?? null,
      });
      return this.reloadQuote(tx, saved.id);
    });

    await this.notifier.flush(intents);
    return { success: true, message: 'Recusa registrada.', data: quote };
  }

  // ===========================================================================
  // Ações do comercial
  // ===========================================================================

  /**
   * Contraproposta para TODOS os aerografistas que já enviaram proposta — a forma
   * normal de contrapor. Vale para as negociações em que a empresa responde a um
   * lance (PROPOSED) ou revisa a própria contraproposta (COUNTERED); quem já
   * aceitou fica de fora. Valor, tempo ou os dois: o que não vier continua o que
   * cada um tinha em jogo.
   */
  async counterAll(airbrushingId: string, userId: string, input: AirbrushingQuoteCounterFormData) {
    const intents: AirbrushingQuoteNotifyIntent[] = [];

    await this.prisma.$transaction(async tx => {
      await this.lockQuotingAirbrushing(tx, airbrushingId);
      const targets = await tx.airbrushingQuote.findMany({
        where: {
          airbrushingId,
          status: {
            in: [AIRBRUSHING_QUOTE_STATUS.PROPOSED, AIRBRUSHING_QUOTE_STATUS.COUNTERED] as any,
          },
        },
      });
      if (!targets.length) {
        throw new BadRequestException(
          'Nenhum aerografista com proposta aguardando resposta — a contraproposta vale para quem já enviou a sua.',
        );
      }
      for (const current of targets) {
        intents.push(await this.applyCounter(tx, current, userId, input));
      }
    });

    await this.notifier.flush(intents);
    const result = await this.listForAirbrushing(airbrushingId);
    return {
      ...result,
      message:
        intents.length === 1
          ? 'Contraproposta enviada para 1 aerografista.'
          : `Contraproposta enviada para ${intents.length} aerografistas.`,
    };
  }

  /** Contraproposta a UMA negociação (mantida para integrações; a tela usa counterAll). */
  async counter(quoteId: string, userId: string, input: AirbrushingQuoteCounterFormData) {
    const intents: AirbrushingQuoteNotifyIntent[] = [];

    const quote = await this.prisma.$transaction(async tx => {
      const existing = await this.findQuoteOrThrow(tx, quoteId);
      await this.lockQuotingAirbrushing(tx, existing.airbrushingId);
      // Relê depois da trava: o estado pode ter mudado enquanto esperávamos.
      const current = await this.findQuoteOrThrow(tx, quoteId);

      if (!canCompanyCounter(current.status as any)) {
        throw new BadRequestException(
          current.status === AIRBRUSHING_QUOTE_STATUS.DECLINED
            ? 'O aerografista recusou esta aerografia.'
            : current.status === AIRBRUSHING_QUOTE_STATUS.ACCEPTED
              ? 'O aerografista já aceitou estas condições. Selecione-o ou escolha outra proposta.'
              : 'Esta negociação já foi encerrada.',
        );
      }

      intents.push(await this.applyCounter(tx, current, userId, input));
      return this.reloadQuote(tx, quoteId);
    });

    await this.notifier.flush(intents);
    return { success: true, message: 'Contraproposta enviada.', data: quote };
  }

  /**
   * Seleciona a negociação: grava aerografista, valor e tempo de execução na
   * aerografia (tudo da negociação — nunca digitado), deriva o término previsto,
   * encerra as demais e tira a aerografia de cotação para Em Preparação.
   */
  async select(quoteId: string, userId: string, input: AirbrushingQuoteNoteFormData) {
    const intents: AirbrushingQuoteNotifyIntent[] = [];

    const quote = await this.prisma.$transaction(async tx => {
      const initial = await this.findQuoteOrThrow(tx, quoteId);
      const airbrushingBefore = await this.lockQuotingAirbrushing(tx, initial.airbrushingId);
      const current = await this.findQuoteOrThrow(tx, quoteId);

      if (!canCompanySelect(current.status as any)) {
        throw new BadRequestException(
          current.status === AIRBRUSHING_QUOTE_STATUS.COUNTERED
            ? 'Aguarde a resposta do aerografista à contraproposta antes de selecioná-lo.'
            : 'Esta negociação não pode ser selecionada.',
        );
      }
      if (current.amount === null || current.amount === undefined) {
        throw new BadRequestException('Esta negociação não tem valor definido.');
      }

      const terms = termsOf(current);
      const now = new Date();
      await tx.airbrushingQuote.update({
        where: { id: quoteId },
        data: { status: AIRBRUSHING_QUOTE_STATUS.SELECTED as any },
      });
      await this.recordEvent(
        tx,
        quoteId,
        AIRBRUSHING_QUOTE_PARTY.COMPANY,
        AIRBRUSHING_QUOTE_ACTION.SELECT,
        { ...terms, note: input.note, userId },
      );

      const closedPainterIds = await closeAirbrushingQuotesInTx(tx, current.airbrushingId, {
        actorUserId: userId,
        exceptQuoteId: quoteId,
        note: 'Outra proposta foi selecionada.',
      });

      // Negociações antigas (antes do tempo de execução) não trazem prazo: aí o
      // término previsto que já estava na aerografia é mantido.
      const hasTime = terms.executionTime != null && terms.executionTimeUnit != null;
      const finishDate = hasTime
        ? computeExpectedFinishDate(
            airbrushingBefore.startDate,
            terms.executionTime,
            terms.executionTimeUnit as any,
          )
        : undefined;

      const airbrushingAfter = await tx.airbrushing.update({
        where: { id: current.airbrushingId },
        data: {
          painterId: current.painterId,
          price: current.amount,
          ...(hasTime
            ? {
                executionTime: terms.executionTime,
                executionTimeUnit: terms.executionTimeUnit as any,
                ...(finishDate ? { finishDate } : {}),
              }
            : {}),
          status: AIRBRUSHING_STATUS.PREPARATION as any,
          statusOrder: getAirbrushingStatusOrder(AIRBRUSHING_STATUS.PREPARATION),
          quotationClosedAt: now,
        },
      });

      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.AIRBRUSHING,
        entityId: current.airbrushingId,
        action: CHANGE_ACTION.UPDATE,
        field: null,
        oldValue: airbrushingBefore,
        newValue: airbrushingAfter,
        reason: 'Proposta da cotação selecionada',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: current.airbrushingId,
        userId,
        transaction: tx,
      });

      intents.push({
        kind: 'selected',
        airbrushingId: current.airbrushingId,
        painterId: current.painterId,
        actorUserId: userId,
        terms,
      });
      intents.push({
        kind: 'closed',
        airbrushingId: current.airbrushingId,
        painterIds: closedPainterIds,
        actorUserId: userId,
        reason: 'OTHER_SELECTED',
      });
      return this.reloadQuote(tx, quoteId);
    });

    await this.notifier.flush(intents);
    return { success: true, message: 'Aerografista selecionado.', data: quote };
  }

  /**
   * Reabre a cotação de uma aerografia que ainda não começou — o aerografista
   * selecionado desistiu, ou é uma aerografia antiga criada sem ninguém. Tira o
   * aerografista e o valor, encerra a negociação selecionada e avisa todos de novo.
   */
  async reopen(airbrushingId: string, userId: string) {
    const intents: AirbrushingQuoteNotifyIntent[] = [];

    await this.prisma.$transaction(async tx => {
      const before = await this.lockAirbrushing(tx, airbrushingId);
      const reopenable = [
        AIRBRUSHING_STATUS.PREPARATION,
        AIRBRUSHING_STATUS.WAITING_PRODUCTION,
      ] as string[];
      if (!reopenable.includes(before.status)) {
        throw new BadRequestException(
          isAirbrushingQuoting(before.status)
            ? 'Esta aerografia já está em cotação.'
            : 'Só é possível reabrir a cotação de uma aerografia que ainda não entrou em produção.',
        );
      }
      if (before.paymentStatus !== 'PENDING') {
        throw new BadRequestException('Esta aerografia já tem pagamento registrado.');
      }

      const closedPainterIds = await closeAirbrushingQuotesInTx(tx, airbrushingId, {
        actorUserId: userId,
        includeSelected: true,
        note: 'A cotação foi reaberta.',
      });

      const after = await tx.airbrushing.update({
        where: { id: airbrushingId },
        data: {
          painterId: null,
          price: null,
          status: AIRBRUSHING_STATUS.QUOTING as any,
          statusOrder: getAirbrushingStatusOrder(AIRBRUSHING_STATUS.QUOTING),
          quotationOpenedAt: new Date(),
          quotationNotifiedAt: null,
          quotationClosedAt: null,
        },
      });

      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.AIRBRUSHING,
        entityId: airbrushingId,
        action: CHANGE_ACTION.UPDATE,
        field: null,
        oldValue: before,
        newValue: after,
        reason: 'Cotação reaberta',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: airbrushingId,
        userId,
        transaction: tx,
      });

      // Quem tinha o serviço (ou ainda negociava) fica sabendo que ele voltou
      // para cotação; o aviso de "novo serviço para cotar" vai a todos logo abaixo.
      intents.push({
        kind: 'closed',
        airbrushingId,
        painterIds: closedPainterIds,
        actorUserId: userId,
        reason: 'REOPENED',
      });
    });

    await this.notifier.flush(intents);
    await this.notifier.notifyPendingRequests([airbrushingId], userId);
    return this.listForAirbrushing(airbrushingId);
  }

  // ===========================================================================
  // Internos
  // ===========================================================================

  /** Aerografistas que recebem a cotação: setor Aerografia com vínculo ativo. */
  private eligiblePainters() {
    return this.prisma.user.findMany({
      where: {
        sector: { privileges: SECTOR_PRIVILEGES.AIRBRUSHING as any },
        ...EMPLOYED_USER_WHERE,
      },
      select: { id: true, name: true, avatarId: true },
      orderBy: { name: 'asc' },
    });
  }

  private async lockAirbrushing(tx: PrismaTransaction, airbrushingId: string) {
    await tx.$queryRaw`SELECT 1 FROM "Airbrushing" WHERE "id" = ${airbrushingId} FOR UPDATE`;
    const airbrushing = await tx.airbrushing.findUnique({ where: { id: airbrushingId } });
    if (!airbrushing) throw new NotFoundException('Aerografia não encontrada.');
    return airbrushing;
  }

  /** Trava a aerografia e exige que ela esteja em cotação. */
  private async lockQuotingAirbrushing(tx: PrismaTransaction, airbrushingId: string) {
    const airbrushing = await this.lockAirbrushing(tx, airbrushingId);
    if (!isAirbrushingQuoting(airbrushing.status)) {
      throw new BadRequestException('A cotação desta aerografia já foi encerrada.');
    }
    return airbrushing;
  }

  private async findQuoteOrThrow(tx: PrismaTransaction, quoteId: string) {
    const quote = await tx.airbrushingQuote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException('Proposta não encontrada.');
    return quote;
  }

  private reloadQuote(tx: PrismaTransaction, quoteId: string) {
    return tx.airbrushingQuote.findUnique({ where: { id: quoteId }, include: QUOTE_INCLUDE });
  }

  private recordEvent(
    tx: PrismaTransaction,
    quoteId: string,
    party: AIRBRUSHING_QUOTE_PARTY,
    action: AIRBRUSHING_QUOTE_ACTION,
    params: QuoteTerms & { note?: string | null; userId: string },
  ) {
    return tx.airbrushingQuoteEvent.create({
      data: {
        quoteId,
        party: party as any,
        action: action as any,
        amount: params.amount,
        executionTime: params.executionTime,
        executionTimeUnit: (params.executionTimeUnit ?? null) as any,
        note: params.note ?? null,
        userId: params.userId,
      },
    });
  }

  /** Cria ou atualiza a negociação deste aerografista com as condições dadas. */
  private saveQuote(
    tx: PrismaTransaction,
    airbrushingId: string,
    painterId: string,
    data: QuoteTerms & { status: AIRBRUSHING_QUOTE_STATUS },
  ) {
    const fields = {
      status: data.status as any,
      amount: data.amount,
      executionTime: data.executionTime,
      executionTimeUnit: (data.executionTimeUnit ?? null) as any,
    };
    return tx.airbrushingQuote.upsert({
      where: { airbrushingId_painterId: { airbrushingId, painterId } },
      create: { airbrushingId, painterId, ...fields },
      update: fields,
    });
  }

  /**
   * Aplica uma contraproposta a uma negociação (já travada): o que a empresa
   * mandou vence, o resto continua o que estava em jogo.
   */
  private async applyCounter(
    tx: PrismaTransaction,
    current: { id: string; airbrushingId: string; painterId: string } & QuoteTerms,
    userId: string,
    input: AirbrushingQuoteCounterFormData,
  ): Promise<AirbrushingQuoteNotifyIntent> {
    const terms = mergeCounterTerms(termsOf(current), input) as QuoteTerms;
    await tx.airbrushingQuote.update({
      where: { id: current.id },
      data: {
        status: AIRBRUSHING_QUOTE_STATUS.COUNTERED as any,
        amount: terms.amount,
        executionTime: terms.executionTime,
        executionTimeUnit: (terms.executionTimeUnit ?? null) as any,
      },
    });
    await this.recordEvent(
      tx,
      current.id,
      AIRBRUSHING_QUOTE_PARTY.COMPANY,
      AIRBRUSHING_QUOTE_ACTION.COUNTER,
      { ...terms, note: input.note, userId },
    );
    return {
      kind: 'countered',
      airbrushingId: current.airbrushingId,
      painterId: current.painterId,
      actorUserId: userId,
      terms,
      note: input.note ?? null,
    };
  }

  /**
   * O que o aerografista vê de uma aerografia em cotação: o serviço (tarefa,
   * cliente, veículo, layouts, datas esperadas) e SÓ a negociação dele.
   */
  private painterAirbrushingSelect(painterId: string) {
    return {
      id: true,
      status: true,
      description: true,
      startDate: true,
      finishDate: true,
      createdAt: true,
      quotationOpenedAt: true,
      quotationClosedAt: true,
      quotationOfferAmount: true,
      quotationOfferExecutionTime: true,
      quotationOfferExecutionTimeUnit: true,
      task: {
        select: {
          id: true,
          name: true,
          serialNumber: true,
          term: true,
          customer: { select: { id: true, fantasyName: true } },
          truck: { select: { id: true, plate: true, chassisNumber: true } },
        },
      },
      layouts: {
        where: { status: { not: LAYOUT_STATUS.REPROVED as any } },
        include: { file: true },
        orderBy: { createdAt: 'asc' as const },
      },
      quotes: { where: { painterId }, include: QUOTE_INCLUDE },
    } as const;
  }

  private toPainterView(row: any) {
    const {
      quotes,
      layouts,
      quotationOfferAmount,
      quotationOfferExecutionTime,
      quotationOfferExecutionTimeUnit,
      ...rest
    } = row;
    const myQuote = quotes?.[0] ?? null;
    // O orçamento de abertura é a proposta da empresa para quem ainda não negociou.
    const offer =
      quotationOfferAmount != null
        ? {
            amount: quotationOfferAmount,
            executionTime: quotationOfferExecutionTime ?? null,
            executionTimeUnit: quotationOfferExecutionTimeUnit ?? null,
          }
        : null;
    return {
      ...rest,
      offer,
      // Mesmo achatamento do repositório: o cliente espera o File com `status` do layout.
      layouts: (layouts ?? []).map((layout: any) => ({
        ...layout.file,
        id: layout.file?.id ?? layout.fileId,
        layoutId: layout.id,
        status: layout.status,
      })),
      myQuote,
      stage: painterQuoteStage(row.status, myQuote?.status, offer != null),
    };
  }
}
