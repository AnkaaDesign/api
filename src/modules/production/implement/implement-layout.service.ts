/**
 * A ARTE DO IMPLEMENTO (PLANO §5.1, §7.1; D-08, D-21, D-31; DD3, DD9, DD10).
 *
 * A arte é do IMPLEMENTO (R2) e quem a aprova é o cliente — no portal, ou a
 * Ankaa "em nome do cliente", com nota. A máquina:
 *
 *   upload ─▶ DRAFT ─(send)─▶ PENDING_APPROVAL ─(cliente aprova)─▶ APPROVED
 *                 │                    └─(cliente reprova, motivo)─▶ REPROVED
 *                 └─(aprovar em nome do cliente, nota)──────────────▶ APPROVED
 *   APPROVED nunca volta: a correção é VERSÃO NOVA (`supersedesId`), e a
 *   anterior só vira SUPERSEDED quando a nova é aprovada (D-21).
 *
 * Toda decisão grava uma linha em `LayoutDecision` (quem, de onde, por quê) e, nas
 * de aprovação/reprovação, o `fileSha256` dos bytes NO ATO. A troca de estado é
 * `updateMany … where status`: se outro caminho decidiu antes, nada muda e a
 * resposta é 409 (a corrida do portal, G17).
 *
 * Depois de uma APROVAÇÃO: as O.S. "Aprovar com o Cliente" abertas e as de ARTE
 * em `WAITING_APPROVE` fecham (DD3), a tarefa é liberada para produção se era só
 * a arte que faltava (DD3/DD10, sem outro clique), e o orçamento da tarefa é
 * reavaliado pelo motor de assinatura (D-31: coleta RUNNING cai; contrato
 * COMPLETED não cai e registra deriva). Uma REPROVAÇÃO devolve essas O.S. a
 * `IN_PROGRESS`. O fechamento das O.S. passa pelo `ServiceOrderService` (tempo
 * trabalhado, trilha, liberação automática), cada uma na transação dele, DEPOIS
 * da decisão gravada: a decisão é o ato; o resto é consequência e nunca a desfaz.
 */
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FileService } from '@modules/common/file/file.service';
import { PortalNotificationService } from '@modules/common/notification/portal-notification.service';
import { SignatureEnvelopeService } from '@modules/common/signature/services/signature-envelope.service';
import {
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  LAYOUT_APPROVAL_SOURCE,
  LAYOUT_STATUS,
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE,
  TASK_STATUS,
} from '@constants';
import { ServiceOrderService } from '../service-order/service-order.service';
import { artworkGateFor } from '../../../utils/artwork-gate';
import { isReadyForProductionRelease } from '../../../utils/task-service-order-sync';
import { getTaskStatusOrder } from '../../../utils';
import {
  LayoutApprovedEvent,
  LayoutReprovedEvent,
  type LayoutActor,
  type LayoutEventContext,
} from '../task/layout.events';

/** O que sai do serviço: a linha com o arquivo e a última decisão. */
const LAYOUT_RESPONSE_INCLUDE = {
  file: true,
  decisions: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} as const;

/** "Aprovar com o Cliente" pela descrição normalizada (a coluna gerada é `lower(unaccent)`). */
const APPROVE_WITH_CUSTOMER_WHERE = {
  AND: [
    { descriptionNormalized: { contains: 'aprovar com' } },
    { descriptionNormalized: { contains: 'cliente' } },
  ],
};

interface DecisionInput {
  layoutId: string;
  implementId: string;
  from: LAYOUT_STATUS[];
  to: LAYOUT_STATUS.APPROVED | LAYOUT_STATUS.REPROVED;
  source: LAYOUT_APPROVAL_SOURCE;
  actor: LayoutActor;
  note: string | null;
}

@Injectable()
export class ImplementLayoutService {
  private readonly logger = new Logger(ImplementLayoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
    private readonly changeLogService: ChangeLogService,
    private readonly portalNotifications: PortalNotificationService,
    private readonly serviceOrders: ServiceOrderService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    @Inject(forwardRef(() => SignatureEnvelopeService))
    private readonly signatureEnvelopes: SignatureEnvelopeService,
  ) {}

  // ─── leitura ─────────────────────────────────────────────────────────────

  /** A arte do implemento, a mais velha primeiro. Fora dos papéis de arte, só a APROVADA. */
  async list(implementId: string, seeAll: boolean) {
    await this.implementOrThrow(implementId);
    return this.prisma.layout.findMany({
      where: { implementId, ...(seeAll ? {} : { status: LAYOUT_STATUS.APPROVED }) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: LAYOUT_RESPONSE_INCLUDE,
    });
  }

  // ─── gestos internos ─────────────────────────────────────────────────────

  /** Sobe arte nova: sempre RASCUNHO, só imagem (o PDF cotado vai em "Projeto da tarefa"). */
  async upload(implementId: string, files: Express.Multer.File[], userId: string) {
    this.assertImages(files);
    const implement = await this.implementOrThrow(implementId);
    const created = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const rows = [];
      for (const file of files) {
        const record = await this.fileService.createFromUploadWithTransaction(
          tx,
          file,
          'implementLayouts',
          userId,
          {
            entityId: implementId,
            entityType: 'IMPLEMENT',
            customerName: implement.task?.customer?.fantasyName ?? undefined,
          },
        );
        const layout = await tx.layout.create({
          data: {
            fileId: record.id,
            implementId,
            status: LAYOUT_STATUS.DRAFT,
            createdById: userId,
          },
          include: LAYOUT_RESPONSE_INCLUDE,
        });
        await this.logImplementArt(
          tx,
          implementId,
          userId,
          CHANGE_ACTION.CREATE,
          null,
          {
            layoutId: layout.id,
            fileId: record.id,
            status: LAYOUT_STATUS.DRAFT,
          },
          'Arte enviada (rascunho)',
        );
        rows.push(layout);
      }
      return rows;
    });
    return created;
  }

  /**
   * Versão NOVA de uma arte (D-21): nasce rascunho com `supersedesId`; a anterior
   * continua valendo até a nova ser aprovada. Uma versão nova por arte.
   */
  async newVersion(
    implementId: string,
    layoutId: string,
    files: Express.Multer.File[],
    userId: string,
  ) {
    if (files.length !== 1)
      throw new BadRequestException('Envie exatamente uma imagem para a versão nova.');
    this.assertImages(files);
    const implement = await this.implementOrThrow(implementId);
    const previous = await this.layoutOrThrow(implementId, layoutId);
    if (previous.status === LAYOUT_STATUS.SUPERSEDED) {
      throw new ConflictException(
        'Esta arte já foi substituída: mande a versão nova a partir da vigente.',
      );
    }
    const successor = await this.prisma.layout.findUnique({ where: { supersedesId: layoutId } });
    if (successor) {
      throw new ConflictException('Esta arte já tem uma versão nova: continue por ela.');
    }
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const record = await this.fileService.createFromUploadWithTransaction(
        tx,
        files[0],
        'implementLayouts',
        userId,
        {
          entityId: implementId,
          entityType: 'IMPLEMENT',
          customerName: implement.task?.customer?.fantasyName ?? undefined,
        },
      );
      const layout = await tx.layout.create({
        data: {
          fileId: record.id,
          implementId,
          status: LAYOUT_STATUS.DRAFT,
          version: previous.version + 1,
          supersedesId: previous.id,
          createdById: userId,
        },
        include: LAYOUT_RESPONSE_INCLUDE,
      });
      await this.logImplementArt(
        tx,
        implementId,
        userId,
        CHANGE_ACTION.CREATE,
        null,
        {
          layoutId: layout.id,
          fileId: record.id,
          status: LAYOUT_STATUS.DRAFT,
          supersedesId: previous.id,
          version: layout.version,
        },
        `Versão ${layout.version} da arte enviada (rascunho)`,
      );
      return layout;
    });
  }

  /** Só rascunho se apaga; o que já foi ao cliente fica na trilha. */
  async remove(implementId: string, layoutId: string, userId: string) {
    await this.layoutOrThrow(implementId, layoutId);
    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const deleted = await tx.layout.deleteMany({
        where: { id: layoutId, implementId, status: LAYOUT_STATUS.DRAFT },
      });
      if (deleted.count === 0) {
        throw new ConflictException('Só a arte em rascunho pode ser apagada.');
      }
      await this.logImplementArt(
        tx,
        implementId,
        userId,
        CHANGE_ACTION.DELETE,
        { layoutId },
        null,
        'Arte em rascunho apagada',
      );
    });
    return { id: layoutId };
  }

  /** A mesma arte (arquivo já no sistema) para N implementos: uma linha RASCUNHO por implemento. */
  async bulk(implementIds: string[], fileId: string, userId: string) {
    const ids = [...new Set(implementIds)];
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: { mimetype: true },
    });
    if (!file) throw new NotFoundException('Arquivo da arte não encontrado.');
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException(this.notAnImageMessage(file.mimetype));
    }
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const found = await tx.implement.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      if (found.length !== ids.length) {
        const missing = ids.filter(id => !found.some(f => f.id === id));
        throw new NotFoundException(`Implemento não encontrado: ${missing.join(', ')}.`);
      }
      let created = 0;
      let alreadyThere = 0;
      for (const implementId of ids) {
        const existing = await tx.layout.findUnique({
          where: { implementId_fileId: { implementId, fileId } },
          select: { id: true },
        });
        if (existing) {
          alreadyThere++;
          continue;
        }
        const layout = await tx.layout.create({
          data: { fileId, implementId, status: LAYOUT_STATUS.DRAFT, createdById: userId },
        });
        await this.logImplementArt(
          tx,
          implementId,
          userId,
          CHANGE_ACTION.CREATE,
          null,
          {
            layoutId: layout.id,
            fileId,
            status: LAYOUT_STATUS.DRAFT,
          },
          'Arte adicionada em lote (rascunho)',
        );
        created++;
      }
      return { created, alreadyThere, total: ids.length };
    });
  }

  /** DRAFT → PENDING_APPROVAL: a arte vai ao cliente. */
  async send(implementId: string, layoutId: string, userId: string) {
    const layout = await this.layoutOrThrow(implementId, layoutId);
    const actor = await this.userActor(userId);
    const updated = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const moved = await tx.layout.updateMany({
        where: { id: layoutId, implementId, status: LAYOUT_STATUS.DRAFT },
        data: { status: LAYOUT_STATUS.PENDING_APPROVAL, sentAt: new Date() },
      });
      if (moved.count === 0) {
        throw new ConflictException(
          `A arte não está em rascunho (está "${layout.status}"): só o rascunho vai ao cliente.`,
        );
      }
      await tx.layoutDecision.create({
        data: {
          layoutId,
          toStatus: LAYOUT_STATUS.PENDING_APPROVAL,
          source: LAYOUT_APPROVAL_SOURCE.INTERNAL,
          userId,
        },
      });
      await this.logImplementArt(
        tx,
        implementId,
        userId,
        CHANGE_ACTION.UPDATE,
        { layoutId, status: LAYOUT_STATUS.DRAFT },
        { layoutId, status: LAYOUT_STATUS.PENDING_APPROVAL },
        'Arte enviada ao cliente para aprovação',
      );
      return tx.layout.findUniqueOrThrow({
        where: { id: layoutId },
        include: LAYOUT_RESPONSE_INCLUDE,
      });
    });

    const context = await this.eventContext(updated);
    if (context.task) {
      // A O.S. "Aprovar com o Cliente" aberta passa a esperar o cliente.
      await this.moveServiceOrders(context.task.id, 'SEND', userId);
      await this.portalNotifications
        .notifyArtworkPendingApproval({ taskId: context.task.id, layoutIds: [layoutId] })
        .catch(error =>
          this.logger.error(
            `Aviso da arte ${layoutId} ao cliente falhou: ${error?.message ?? error}`,
          ),
        );
    }
    this.logger.log(
      `Arte ${layoutId} do implemento ${implementId} enviada ao cliente por ${actor.name ?? userId}.`,
    );
    return updated;
  }

  /** "Aprovar em nome do cliente" (COMMERCIAL/ADMIN), com nota obrigatória. */
  async approveOnBehalf(implementId: string, layoutId: string, note: string, userId: string) {
    await this.layoutOrThrow(implementId, layoutId);
    return this.decide({
      layoutId,
      implementId,
      from: [LAYOUT_STATUS.DRAFT, LAYOUT_STATUS.PENDING_APPROVAL],
      to: LAYOUT_STATUS.APPROVED,
      source: LAYOUT_APPROVAL_SOURCE.ON_BEHALF,
      actor: await this.userActor(userId),
      note,
    });
  }

  /** Reprovação interna (COMMERCIAL/ADMIN), com nota. Aprovada não se reprova (D-21). */
  async reprove(implementId: string, layoutId: string, note: string, userId: string) {
    await this.layoutOrThrow(implementId, layoutId);
    return this.decide({
      layoutId,
      implementId,
      from: [LAYOUT_STATUS.DRAFT, LAYOUT_STATUS.PENDING_APPROVAL],
      to: LAYOUT_STATUS.REPROVED,
      source: LAYOUT_APPROVAL_SOURCE.INTERNAL,
      actor: await this.userActor(userId),
      note,
    });
  }

  // ─── o portal (P13b chama; o escopo e a capacidade são conferidos lá) ────

  /** O contato aprova a arte que recebeu (só PENDING_APPROVAL). */
  async approveFromPortal(layoutId: string, responsible: { id: string; name: string | null }) {
    const layout = await this.prisma.layout.findUnique({
      where: { id: layoutId },
      select: { implementId: true },
    });
    if (!layout?.implementId) throw new NotFoundException('Arte não encontrada.');
    return this.decide({
      layoutId,
      implementId: layout.implementId,
      from: [LAYOUT_STATUS.PENDING_APPROVAL],
      to: LAYOUT_STATUS.APPROVED,
      source: LAYOUT_APPROVAL_SOURCE.PORTAL,
      actor: { kind: 'RESPONSIBLE', id: responsible.id, name: responsible.name },
      note: null,
    });
  }

  /** O contato reprova, com motivo obrigatório (CHECK `Layout_decision_note_check`). */
  async reproveFromPortal(
    layoutId: string,
    reason: string,
    responsible: { id: string; name: string | null },
  ) {
    const note = (reason ?? '').trim();
    if (note.length < 3) throw new BadRequestException('Diga o motivo da reprovação.');
    const layout = await this.prisma.layout.findUnique({
      where: { id: layoutId },
      select: { implementId: true },
    });
    if (!layout?.implementId) throw new NotFoundException('Arte não encontrada.');
    return this.decide({
      layoutId,
      implementId: layout.implementId,
      from: [LAYOUT_STATUS.PENDING_APPROVAL],
      to: LAYOUT_STATUS.REPROVED,
      source: LAYOUT_APPROVAL_SOURCE.PORTAL,
      actor: { kind: 'RESPONSIBLE', id: responsible.id, name: responsible.name },
      note,
    });
  }

  // ─── o núcleo da decisão ─────────────────────────────────────────────────

  private async decide(input: DecisionInput) {
    const prepared = await this.prepareDecision(input);
    const decided = await this.prisma.$transaction((tx: PrismaTransaction) =>
      this.decideInTx(tx, input, prepared),
    );
    await this.afterDecision(decided, input.to, input.actor, input.note);
    return decided;
  }

  /**
   * O LOTE DO PORTAL, ATÔMICO (P13b; fechado na integração do par [P14 ∥ P13b]).
   *
   * Cada decisão numa transação só com as outras: se uma delas já foi decidida
   * por outra pessoa entre a conferência do portal e a gravação, o 409 dela
   * DESFAZ o lote inteiro — nenhuma fica aprovada pela metade. As consequências
   * (O.S., liberação, aviso, reavaliação da assinatura) vêm depois do commit,
   * uma por arte, como na decisão avulsa.
   */
  async approveManyFromPortal(
    layoutIds: readonly string[],
    responsible: { id: string; name: string | null },
  ) {
    const inputs: DecisionInput[] = [];
    for (const layoutId of layoutIds) {
      const layout = await this.prisma.layout.findUnique({
        where: { id: layoutId },
        select: { implementId: true },
      });
      if (!layout?.implementId) throw new NotFoundException('Arte não encontrada.');
      inputs.push({
        layoutId,
        implementId: layout.implementId,
        from: [LAYOUT_STATUS.PENDING_APPROVAL],
        to: LAYOUT_STATUS.APPROVED,
        source: LAYOUT_APPROVAL_SOURCE.PORTAL,
        actor: { kind: 'RESPONSIBLE', id: responsible.id, name: responsible.name },
        note: null,
      });
    }
    const prepared = await Promise.all(inputs.map(i => this.prepareDecision(i)));
    const decided = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const out = [];
      for (let i = 0; i < inputs.length; i++) out.push(await this.decideInTx(tx, inputs[i], prepared[i]));
      return out;
    });
    for (const d of decided) await this.afterDecision(d, LAYOUT_STATUS.APPROVED, inputs[0].actor, null);
    return decided;
  }

  /** O que se lê ANTES da transação: a linha e o hash dos bytes da arte. */
  private async prepareDecision(input: DecisionInput) {
    const current = await this.prisma.layout.findUniqueOrThrow({
      where: { id: input.layoutId },
      include: { file: { select: { path: true } } },
    });
    const fileSha256 = await this.sha256Of(current.file?.path, input.layoutId);
    return { current, fileSha256, now: new Date() };
  }

  /** O núcleo da decisão, DENTRO de uma transação (avulsa ou do lote). */
  private async decideInTx(
    tx: PrismaTransaction,
    input: DecisionInput,
    prepared: { current: any; fileSha256: string | null; now: Date },
  ) {
    const { layoutId, implementId, to, source, actor, note } = input;
    const byUser = actor.kind === 'USER' ? actor.id : null;
    const byResponsible = actor.kind === 'RESPONSIBLE' ? actor.id : null;
    const { current, fileSha256, now } = prepared;
    // A corrida (G17): só muda se ainda está num dos estados de origem.
    const moved = await tx.layout.updateMany({
      where: { id: layoutId, implementId, status: { in: input.from } },
      data: {
        status: to,
        decidedAt: now,
        decisionNote: note,
        fileSha256,
        decidedByUserId: byUser,
        decidedByResponsibleId: byResponsible,
        // `approvalSource` é de quem APROVOU (e do portal, na reprovação com motivo).
        approvalSource:
          to === LAYOUT_STATUS.APPROVED || source === LAYOUT_APPROVAL_SOURCE.PORTAL
            ? source
            : null,
      },
    });
    if (moved.count === 0) {
      const now2 = await tx.layout.findUnique({
        where: { id: layoutId },
        select: { status: true },
      });
      throw new ConflictException(
        `Esta arte já foi decidida (está "${now2?.status ?? '—'}"): recarregue para ver a decisão.`,
      );
    }
    await tx.layoutDecision.create({
      data: {
        layoutId,
        toStatus: to,
        source,
        userId: byUser,
        responsibleId: byResponsible,
        note,
        fileSha256,
      },
    });

    // Versão nova aprovada: a anterior sai de cena (D-21).
    if (to === LAYOUT_STATUS.APPROVED && current.supersedesId) {
      const superseded = await tx.layout.updateMany({
        where: { id: current.supersedesId, status: { not: LAYOUT_STATUS.SUPERSEDED } },
        data: { status: LAYOUT_STATUS.SUPERSEDED },
      });
      if (superseded.count > 0) {
        await tx.layoutDecision.create({
          data: {
            layoutId: current.supersedesId,
            toStatus: LAYOUT_STATUS.SUPERSEDED,
            source: LAYOUT_APPROVAL_SOURCE.INTERNAL,
            userId: byUser,
            responsibleId: byResponsible,
            note: `Substituída pela versão ${current.version}.`,
          },
        });
      }
    }

    await this.logImplementArt(
      tx,
      implementId,
      byUser,
      CHANGE_ACTION.UPDATE,
      { layoutId, status: current.status },
      { layoutId, status: to, source, note },
      to === LAYOUT_STATUS.APPROVED
        ? source === LAYOUT_APPROVAL_SOURCE.PORTAL
          ? `Arte aprovada pelo cliente no portal (${actor.name ?? 'contato'})`
          : `Arte aprovada em nome do cliente: ${note}`
        : source === LAYOUT_APPROVAL_SOURCE.PORTAL
          ? `Arte reprovada pelo cliente no portal: ${note}`
          : `Arte reprovada: ${note}`,
      byUser ? CHANGE_TRIGGERED_BY.USER_ACTION : CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
    );

    return tx.layout.findUniqueOrThrow({
      where: { id: layoutId },
      include: LAYOUT_RESPONSE_INCLUDE,
    });
  }

  /** As consequências — nenhuma delas desfaz a decisão, que já está gravada. */
  private async afterDecision(
    layout: { id: string; fileId: string; status: string; implementId: string | null },
    to: LAYOUT_STATUS.APPROVED | LAYOUT_STATUS.REPROVED,
    actor: LayoutActor,
    note: string | null,
  ): Promise<void> {
    const context = await this.eventContext(layout);
    const actorUserId = actor.kind === 'USER' ? actor.id : null;
    const task = context.task;

    if (task) {
      await this.moveServiceOrders(
        task.id,
        to === LAYOUT_STATUS.APPROVED ? 'APPROVE' : 'REPROVE',
        actorUserId,
      );
      if (to === LAYOUT_STATUS.APPROVED) {
        await this.releaseIfOnlyArtworkWasMissing(task.id, actorUserId);
        // D-31: a arte do documento mudou — a coleta viva cai; o contrato selado registra deriva.
        const quote = await this.prisma.task.findUnique({
          where: { id: task.id },
          select: { quoteId: true },
        });
        if (quote?.quoteId) {
          await this.signatureEnvelopes
            .onQuoteContentChanged(quote.quoteId, actorUserId)
            .catch(error =>
              this.logger.error(
                `Arte ${layout.id} aprovada, mas a reavaliação da assinatura do orçamento ${quote.quoteId} falhou: ${error?.message ?? error}`,
              ),
            );
        }
      }
    }

    this.eventEmitter.emit(
      to === LAYOUT_STATUS.APPROVED ? 'artwork.approved' : 'artwork.reproved',
      to === LAYOUT_STATUS.APPROVED
        ? new LayoutApprovedEvent(context, actor, note)
        : new LayoutReprovedEvent(context, actor, note),
    );
  }

  /**
   * As O.S. que a arte move (DD3): "Aprovar com o Cliente" (achada pela descrição
   * normalizada) e as de ARTE em `WAITING_APPROVE`.
   *   SEND:    "Aprovar com o Cliente" aberta → WAITING_APPROVE
   *   APPROVE: as duas → COMPLETED
   *   REPROVE: as duas → IN_PROGRESS
   * Pelo `ServiceOrderService` (sem privilégio: é o sistema agindo pela decisão),
   * cada uma na transação dele. Falha é registrada e não desfaz a decisão.
   */
  private async moveServiceOrders(
    taskId: string,
    gesture: 'SEND' | 'APPROVE' | 'REPROVE',
    userId: string | null,
  ) {
    const open = [
      SERVICE_ORDER_STATUS.PENDING,
      SERVICE_ORDER_STATUS.IN_PROGRESS,
      SERVICE_ORDER_STATUS.PAUSED,
    ];
    const where =
      gesture === 'SEND'
        ? {
            taskId,
            type: SERVICE_ORDER_TYPE.ARTWORK,
            status: { in: open },
            ...APPROVE_WITH_CUSTOMER_WHERE,
          }
        : {
            taskId,
            type: SERVICE_ORDER_TYPE.ARTWORK,
            OR: [
              { status: SERVICE_ORDER_STATUS.WAITING_APPROVE },
              ...(gesture === 'APPROVE'
                ? [{ status: { in: open }, ...APPROVE_WITH_CUSTOMER_WHERE }]
                : []),
            ],
          };
    const targets = await this.prisma.serviceOrder.findMany({
      where: where as any,
      select: { id: true, status: true, description: true },
      orderBy: { position: 'asc' },
    });
    const next =
      gesture === 'SEND'
        ? SERVICE_ORDER_STATUS.WAITING_APPROVE
        : gesture === 'APPROVE'
          ? SERVICE_ORDER_STATUS.COMPLETED
          : SERVICE_ORDER_STATUS.IN_PROGRESS;
    for (const so of targets) {
      // WAITING_APPROVE só se chega de IN_PROGRESS; uma "Aprovar com o Cliente"
      // ainda pendente passa por lá primeiro (o tempo trabalhado conta direito).
      try {
        if (
          next === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
          so.status !== SERVICE_ORDER_STATUS.IN_PROGRESS
        ) {
          await this.serviceOrders.update(
            so.id,
            { status: SERVICE_ORDER_STATUS.IN_PROGRESS } as any,
            undefined,
            userId ?? undefined,
          );
        }
        await this.serviceOrders.update(
          so.id,
          { status: next } as any,
          undefined,
          userId ?? undefined,
        );
      } catch (error: any) {
        this.logger.error(
          `A O.S. "${so.description}" (${so.id}) da tarefa ${taskId} não foi para ${next} pela arte: ${error?.message ?? error}`,
        );
      }
    }
  }

  /**
   * A arte era a última peça? (DD3: aprovar libera sem outro clique.) Quando a O.S.
   * de ARTE já estava concluída e a tarefa ficou em preparação só pelo portão da
   * arte, nenhuma O.S. muda agora — e sem isto a tarefa esperaria alguém mexer.
   */
  private async releaseIfOnlyArtworkWasMissing(
    taskId: string,
    userId: string | null,
  ): Promise<void> {
    let released = false;
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const task = await tx.task.findUnique({
          where: { id: taskId },
          select: { status: true, serviceOrders: { select: { status: true, type: true } } },
        });
        if (!task || task.status !== TASK_STATUS.PREPARATION) return;
        const ready = isReadyForProductionRelease(
          task.serviceOrders.map(so => ({
            status: so.status as SERVICE_ORDER_STATUS,
            type: so.type as SERVICE_ORDER_TYPE,
          })),
          await artworkGateFor(tx, taskId),
        );
        if (!ready) return;
        await tx.task.update({
          where: { id: taskId },
          data: {
            status: TASK_STATUS.WAITING_PRODUCTION,
            statusOrder: getTaskStatusOrder(TASK_STATUS.WAITING_PRODUCTION),
          },
        });
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: taskId,
          action: CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: TASK_STATUS.PREPARATION,
          newValue: TASK_STATUS.WAITING_PRODUCTION,
          reason:
            'Tarefa liberada automaticamente para produção quando a arte do implemento foi aprovada',
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
          triggeredById: taskId,
          userId: userId || null,
          transaction: tx,
        });
        released = true;
      });
    } catch (error: any) {
      this.logger.error(
        `Liberação da tarefa ${taskId} pela arte aprovada falhou: ${error?.message ?? error}`,
      );
      return;
    }
    if (!released) return;
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        name: true,
        implement: { select: { serialNumber: true } },
        status: true,
        sectorId: true,
      },
    });
    const changedBy = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true },
        })
      : null;
    if (task) {
      this.eventEmitter.emit('task.status.changed', {
        task,
        oldStatus: TASK_STATUS.PREPARATION,
        newStatus: TASK_STATUS.WAITING_PRODUCTION,
        changedBy: changedBy || { id: 'system', name: 'Sistema' },
      });
    }
  }

  // ─── apoio ───────────────────────────────────────────────────────────────

  private async implementOrThrow(implementId: string) {
    const implement = await this.prisma.implement.findUnique({
      where: { id: implementId },
      select: {
        id: true,
        taskId: true,
        task: { select: { customer: { select: { fantasyName: true } } } },
      },
    });
    if (!implement) throw new NotFoundException('Implemento não encontrado.');
    return implement;
  }

  private async layoutOrThrow(implementId: string, layoutId: string) {
    const layout = await this.prisma.layout.findFirst({ where: { id: layoutId, implementId } });
    if (!layout) throw new NotFoundException('Arte não encontrada neste implemento.');
    return layout;
  }

  private notAnImageMessage(mimetype: string): string {
    return mimetype === 'application/pdf'
      ? 'PDF cotado vai em Projeto da tarefa: a arte do implemento é imagem.'
      : `A arte do implemento é imagem (recebido: ${mimetype}).`;
  }

  private assertImages(files: Express.Multer.File[]): void {
    if (!files.length) throw new BadRequestException('Envie ao menos uma imagem da arte.');
    const wrong = files.find(f => !f.mimetype?.startsWith('image/'));
    if (wrong) throw new BadRequestException(this.notAnImageMessage(wrong.mimetype));
  }

  private async userActor(userId: string): Promise<LayoutActor> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    return { kind: 'USER', id: userId, name: user?.name ?? null };
  }

  /** O hash dos bytes NO ATO da decisão; arquivo sumido do disco fica registrado sem hash. */
  private async sha256Of(path: string | undefined, layoutId: string): Promise<string | null> {
    if (!path) return null;
    try {
      return createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
    } catch (error: any) {
      this.logger.warn(
        `Arte ${layoutId}: bytes não lidos (${path}) — decisão gravada sem hash: ${error?.message ?? error}`,
      );
      return null;
    }
  }

  private async eventContext(layout: {
    id: string;
    fileId: string;
    status: string;
    implementId: string | null;
  }): Promise<LayoutEventContext> {
    const implement = layout.implementId
      ? await this.prisma.implement.findUnique({
          where: { id: layout.implementId },
          select: { serialNumber: true, task: { select: { id: true, name: true } } },
        })
      : null;
    return {
      layout: { id: layout.id, fileId: layout.fileId, status: layout.status },
      implementId: layout.implementId ?? '',
      task: implement?.task
        ? {
            id: implement.task.id,
            name: implement.task.name,
            serialNumber: implement.serialNumber ?? null,
          }
        : null,
    };
  }

  private async logImplementArt(
    tx: PrismaTransaction,
    implementId: string,
    userId: string | null,
    action: CHANGE_ACTION,
    oldValue: unknown,
    newValue: unknown,
    reason: string,
    triggeredBy: CHANGE_TRIGGERED_BY = CHANGE_TRIGGERED_BY.USER_ACTION,
  ): Promise<void> {
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.IMPLEMENT,
      entityId: implementId,
      action,
      field: 'layouts',
      oldValue: oldValue as any,
      newValue: newValue as any,
      reason,
      triggeredBy,
      triggeredById: userId || implementId,
      userId: userId || null,
      transaction: tx,
    });
  }
}
