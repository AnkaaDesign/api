import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  Inject,
  forwardRef,
  HttpException,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { FileService } from '@modules/common/file/file.service';
import { FilesStorageService } from '@modules/common/file/services/files-storage.service';
import type {
  Task,
  ServiceOrder,
  TaskBatchCreateResponse,
  TaskBatchDeleteResponse,
  TaskBatchUpdateResponse,
  TaskCreateResponse,
  TaskDeleteResponse,
  TaskGetManyResponse,
  TaskGetUniqueResponse,
  TaskUpdateResponse,
} from '../../../types';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
  getEssentialFields,
  hasValueChanged,
  extractEssentialFields,
  translateFieldName,
} from '@modules/common/changelog/utils/changelog-helpers';
import { logQuoteServiceChanges } from '@modules/common/changelog/utils/quote-service-changelog';
import { serializeChangelogValue } from '@modules/common/changelog/utils/serialize-changelog-value';
import {
  TASK_STATUS,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
  IMPLEMENT_SPOT,
  SECTOR_PRIVILEGES,
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE,
  CUT_STATUS,
  AIRBRUSHING_STATUS,
  AIRBRUSHING_DUE_DATE_RULE,
  TASK_QUOTE_STATUS,
  INVOICE_STATUS,
  pickPrimaryResponsible,
} from '../../../constants/enums';
import { TASK_QUOTE_STATUS_ORDER } from '@constants';
import { validateSectorFieldAccess } from './task.permissions';
import {
  BILLING_FROZEN_WHERE,
  isQuoteMoneyLocked,
  QUOTE_VALUE_REVERTABLE_STATUSES,
  QUOTE_SAFE_AFTER_BILLING_FIELDS,
  validateQuoteStatusChangeRole,
} from '../budget/budget.guards';
import { SERIAL_NUMBER_PATTERN, SERIAL_NUMBER_PATTERN_MESSAGE } from '../../../schemas/task';
import {
  isImplementHistoryField,
  resolveImplementColumn,
} from '../implement/implement-history-field';
import { IMPLEMENT_NOT_REMOVABLE_MESSAGE } from '../../../schemas/implement';
import { syncImplementSpotWithCleared } from '../../../utils/task-implement-spot';
import { hasEntered } from '../../../utils/task-cleared';
import { allocateBudgetNumber } from '../../../utils/budget-number';
import { TaskRepository, PrismaTransaction } from './repositories/task.repository';
import {
  TaskCreateFormData,
  TaskUpdateFormData,
  TaskInclude,
  TaskOrderBy,
  TaskBatchUpdateFormData,
  TaskGetManyFormData,
  TaskBatchDeleteFormData,
  TaskBatchCreateFormData,
  TaskBulkPositionUpdateFormData,
} from '../../../schemas/task';
import { COPYABLE_TASK_FIELDS, type CopyableTaskField } from '../../../schemas/task-copy';
import {
  isValidTaskStatusTransition,
  getTaskStatusLabel,
  getTaskStatusOrder,
  getAirbrushingStatusOrder,
  getBonificationStatusOrder,
  generateBaseFileName,
} from '../../../utils';
import {
  getServiceOrderUpdatesForTaskStatusChange,
  getTaskUpdateForServiceOrderStatusChange,
  getTaskUpdateForLayoutServiceOrderStatusChange,
  calculateCorrectTaskStatus,
  areCommercialServiceOrdersComplete,
} from '../../../utils/task-service-order-sync';
import {
  ARTWORK_GATE_BLOCKED_MESSAGE,
  artworkGateFor,
  entersProduction,
} from '../../../utils/artwork-gate';
import { getServiceOrderStatusOrder, getTaskQuoteStatusOrder } from '../../../utils/sortOrder';
import {
  getBidirectionalSyncActions,
  combineServiceOrderToQuoteDescription,
  normalizeDescription,
  makeDescObsKey,
  type SyncServiceOrder,
  type SyncQuoteItem,
} from '../../../utils/budget-service-order-sync';
import { recalcQuoteTotals } from '../../../utils/budget-totals';
import {
  reconcileQuoteCustomerConfigs,
  resliceQuoteCoverage,
} from '../../../utils/budget-customer-config-sync';
import {
  replicateImplementMeasuresToQuoteSiblings,
  type ReplicationLogEntry,
} from '../../../utils/implement-measure-replication';
import {
  FACES,
  FACE_FK,
  FACE_REL,
  attachMeasure,
  cloneFaces,
  faceOf,
  facesIn,
  setFace,
  setFacePhoto,
  type FaceRel,
  type FaceWriteResult,
  type ImplementFace,
} from '../implement-measure/implement-measure-writer';
import { IMPLEMENT_FACE_LABELS, IMPLEMENT_REAR_DOOR_FIELDS } from '../../../constants/implement-faces';
import { TaskCreatedEvent, TaskStatusChangedEvent } from './task.events';
import { LayoutApprovedEvent, LayoutReprovedEvent } from './layout.events';
import { CutCreatedEvent, CutsAddedToTaskEvent } from '../cut/cut.events';
import { TaskFieldTrackerService } from './task-field-tracker.service';
import { NfseEmissionScheduler } from '@modules/integrations/nfse/nfse-emission.scheduler';
import { PainterNfseService } from '@modules/integrations/nfse/painter/painter-nfse.service';
import {
  AirbrushingNotificationService,
  type AirbrushingNotifyIntent,
} from '@modules/common/notification/airbrushing-notification.service';
// Fonte única do vencimento da aerografia — a mesma que o AirbrushingService usa.
import { resolveAirbrushingDueDate } from '../../../utils/airbrushing';
// Cotação da aerografia: o formulário da tarefa cria e edita aerografias por
// fora do AirbrushingService, então as regras da cotação são repetidas aqui.
import {
  computeExpectedFinishDate,
  resolveNewAirbrushingStatus,
} from '../../../utils/airbrushing-quote';
import { AirbrushingQuoteNotificationService } from '@modules/common/notification/airbrushing-quote-notification.service';
import { applyQuotingToNestedAirbrushingUpdate } from '../airbrushing/airbrushing-quote.service';
import { BudgetService } from '../budget/budget.service';
import { SignatureDeletionService } from '@modules/common/signature/services/signature-deletion.service';
import { SignatureEnvelopeService } from '@modules/common/signature/services/signature-envelope.service';
import { describePrismaFailure } from '../../../utils/quote-tasks';
import {
  rethrowPrismaValidationAsBadRequest,
  unknownPrismaKeyOf,
} from '../../common/query/prisma-validation-error';
// NOTE: TaskNotificationService import removed - legacy notification path was deprecated

/**
 * Converts a implementMeasure + sections into a displayable summary for changelog entries.
 */
function formatImplementMeasureForChangelog(implementMeasure: any) {
  if (!implementMeasure) return null;
  const sections = implementMeasure.sections || [];
  return {
    id: implementMeasure.id || null,
    height: implementMeasure.height || 0,
    totalWidth: sections.reduce((sum: number, s: any) => sum + (s.width || 0), 0),
    doorCount: sections.filter((s: any) => s.isDoor).length,
    sectionCount: sections.length,
    sections: sections.map((s: any) => ({
      width: s.width,
      isDoor: s.isDoor,
      doorHeight: s.doorHeight,
      position: s.position,
    })),
  };
}

/**
 * Task Service
 *
 * Handles task operations. Bonification creation logic has been removed.
 * The task's bonification status field is maintained for reference but
 * no bonification entries are automatically created.
 */

/** A medida de uma face como a cópia de tarefa a lê (para clonar e para o histórico). */
const FACE_MEASURE_COPY_SELECT = {
  id: true,
  height: true,
  photoId: true,
  sections: { select: { width: true, isDoor: true, doorHeight: true, position: true } },
} as const;

/** As medidas de TODAS as faces com as seções (include do implemento). */
const FACE_MEASURES_WITH_SECTIONS = Object.fromEntries(
  FACES.map(face => [FACE_REL[face], { include: { sections: true } }]),
) as Record<FaceRel, { include: { sections: true } }>;

/** Quem vê a arte do implemento em todos os estados; os demais só a APROVADA. */
const ROLES_THAT_SEE_ALL_ART = [
  'COMMERCIAL',
  'DESIGNER',
  'LOGISTIC',
  'PRODUCTION_MANAGER',
  'ADMIN',
];

/**
 * O FILTRO POR PAPEL DA ARTE (plano §6.12, risco 25): fora de COMMERCIAL,
 * DESIGNER, LOGISTIC, PRODUCTION_MANAGER e ADMIN, só a arte APROVADA. Era o
 * filtro de `task.layouts`; sem ele sobre `implement.layouts`, a produção veria,
 * calada, rascunho, arte aguardando o cliente e arte reprovada. Muta a tarefa.
 */
function filterImplementArtForRole(task: any, userRole?: string): void {
  if (!userRole || ROLES_THAT_SEE_ALL_ART.includes(userRole)) return;
  const layouts = task?.implement?.layouts;
  if (Array.isArray(layouts)) {
    task.implement.layouts = layouts.filter((l: { status?: string }) => l.status === 'APPROVED');
  }
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksRepository: TaskRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
    private readonly filesStorageService: FilesStorageService,
    private readonly fieldTracker: TaskFieldTrackerService,
    // NOTE: TaskNotificationService injection removed - legacy notification path was deprecated
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly nfseEmissionScheduler: NfseEmissionScheduler,
    // NFS-e do aerografista: o formulário de tarefa escreve em tx.airbrushing.*
    // diretamente, sem passar pelo AirbrushingService, então o gancho de emissão
    // precisa ser repetido aqui.
    private readonly painterNfseService: PainterNfseService,
    // Mesmo motivo do painterNfseService acima: a seção de aerografia deste
    // formulário grava painterId/paymentStatus por fora do AirbrushingService,
    // então o gancho que avisa o pintor precisa ser repetido aqui.
    private readonly airbrushingNotifier: AirbrushingNotificationService,
    // Aviso "novo serviço para cotar" e "cotação encerrada" — ver a cotação da aerografia.
    private readonly airbrushingQuoteNotifier: AirbrushingQuoteNotificationService,
    @Inject(forwardRef(() => BudgetService))
    private readonly budgetService: BudgetService,
    @Inject(forwardRef(() => SignatureDeletionService))
    private readonly signatureDeletion: SignatureDeletionService,
    // O "Desfazer" do Histórico reescreve `BudgetItem` e recalcula totais por
    // fora de `BudgetService.update` — então tem de fazer a mesma pergunta que
    // ela faz ao final: o documento assinado ainda descreve este orçamento?
    @Inject(forwardRef(() => SignatureEnvelopeService))
    private readonly signatureEnvelopes: SignatureEnvelopeService,
  ) {}

  /**
   * DD10: a liberação MANUAL ("Disponibilizar para produção", ou qualquer troca de
   * status que ENTRE em produção) também respeita o portão da arte — trabalho novo
   * só vai para o chão de fábrica com a arte do implemento aprovada. Sem dispensa
   * (DD9): quem precisa liberar sem o cliente aprova a arte em nome dele, com nota.
   */
  private async assertArtworkAllowsRelease(
    tx: PrismaTransaction,
    taskId: string,
    fromStatus: TASK_STATUS,
    toStatus: TASK_STATUS,
  ): Promise<void> {
    if (!entersProduction(fromStatus, toStatus)) return;
    if ((await artworkGateFor(tx, taskId)) === 'PENDING') {
      throw new BadRequestException(ARTWORK_GATE_BLOCKED_MESSAGE);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Inline-quote no-op filter
  //
  // task.update({ quote: { ... } }) is the mobile/inline path. The form
  // re-submits the full quote snapshot on every save, even when the user
  // only changed a Task field. We canonicalize each field and pass through
  // only the ones that materially differ from the persisted quote.
  // Returns `null` when nothing changed — caller should drop the whole
  // quote block in that case.
  // ───────────────────────────────────────────────────────────────────────
  private canonicalizeQuoteService(s: any): string {
    return JSON.stringify({
      description: (s.description ?? '').trim(),
      amount: Number(s.amount ?? 0).toFixed(2),
      observation: s.observation ?? null,
      invoiceToCustomerId: s.invoiceToCustomerId ?? null,
    });
  }

  private canonicalizeQuoteCustomerConfig(c: any): string {
    return JSON.stringify({
      customerId: c.customerId ?? null,
      subtotal: Number(c.subtotal ?? 0).toFixed(2),
      total: Number(c.total ?? 0).toFixed(2),
      discountType: c.discountType ?? 'NONE',
      discountValue: c.discountValue != null ? Number(c.discountValue).toFixed(2) : null,
      discountReference: c.discountReference ?? null,
      paymentCondition: c.paymentCondition ?? null,
      customPaymentText: c.customPaymentText ?? null,
      generateInvoice: c.generateInvoice !== false,
      generateBankSlip: c.generateBankSlip !== false,
      paymentConfig: c.paymentConfig ?? null,
    });
  }

  private quoteArrayChanged(
    existing: any[] | undefined | null,
    incoming: any[],
    canon: (v: any) => string,
  ): boolean {
    if ((existing?.length ?? 0) !== incoming.length) return true;
    const a = (existing || []).map(canon).sort();
    const b = incoming.map(canon).sort();
    return a.some((v, i) => v !== b[i]);
  }

  private quoteScalarChanged(existing: any, incoming: any): boolean {
    if (incoming === undefined) return false;
    if (existing === incoming) return false;
    if (existing == null && incoming == null) return false;
    if (existing && typeof existing === 'object' && 'toNumber' in existing) {
      return Number(existing) !== Number(incoming);
    }
    if (existing instanceof Date || incoming instanceof Date) {
      const a = existing ? new Date(existing as any).getTime() : null;
      const b = incoming ? new Date(incoming as any).getTime() : null;
      return a !== b;
    }
    return existing !== incoming;
  }

  /**
   * Recomputes a quote's per-customer-config subtotals/totals (applying each
   * config's discount) and the aggregate Budget.subtotal/total from the
   * current BudgetItem rows. Use after any operation that adds/removes
   * quote services (cascade delete, SO↔quote sync) so the aggregate and the
   * customer configs never drift apart — the bug where Budget dropped to the
   * raw remaining-services sum while CustomerConfig kept the old approved total.
   */
  /**
   * Photo-driven checklist sync. Checkin/checkout PHOTOS live on each PRODUCTION
   * service order (before/after per station). The two LOGISTIC checklist SOs —
   * "Checklist Entrada" (checkin) and "Checklist Saída" (checkout) — are the
   * task-level gate and are completed automatically from those photos:
   *   • any active PRODUCTION SO has ≥1 checkin photo  → "Checklist Entrada" COMPLETED
   *   • any active PRODUCTION SO has ≥1 checkout photo → "Checklist Saída"   COMPLETED
   * Reversible: if all the photos are removed the checklist SO reopens to PENDING,
   * so the task finish-gate can never pass without the photos actually present.
   * Manual PAUSED / CANCELLED states are respected and never auto-touched.
   * Runs inside the task-update transaction whenever SO checkin/checkout files
   * were touched in the request.
   */
  private async syncChecklistServiceOrdersFromPhotos(
    tx: PrismaTransaction,
    taskId: string,
    userId?: string | null,
  ): Promise<void> {
    const sos = await tx.serviceOrder.findMany({
      where: { taskId },
      select: {
        id: true,
        type: true,
        description: true,
        status: true,
        _count: { select: { checkinFiles: true, checkoutFiles: true } },
      },
    });

    const activeProduction = sos.filter(
      so =>
        so.type === SERVICE_ORDER_TYPE.PRODUCTION && so.status !== SERVICE_ORDER_STATUS.CANCELLED,
    );
    const anyCheckinPhotos = activeProduction.some(so => so._count.checkinFiles > 0);
    const anyCheckoutPhotos = activeProduction.some(so => so._count.checkoutFiles > 0);

    // Accent-insensitive normalize so "Checklist Saída" matches regardless of how
    // the description was stored ("saída"/"saida").
    const norm = (s?: string | null) =>
      (s ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const reconcile = async (matchDescription: string, hasPhotos: boolean): Promise<void> => {
      const checklist = sos.find(
        so => so.type === SERVICE_ORDER_TYPE.LOGISTIC && norm(so.description) === matchDescription,
      );
      if (!checklist) return;
      // Respect manual terminal/pause states — never auto-touch them.
      if (
        checklist.status === SERVICE_ORDER_STATUS.CANCELLED ||
        checklist.status === SERVICE_ORDER_STATUS.PAUSED
      ) {
        return;
      }
      const target = hasPhotos ? SERVICE_ORDER_STATUS.COMPLETED : SERVICE_ORDER_STATUS.PENDING;
      if (checklist.status === target) return; // idempotent

      const now = new Date();
      const patch: any = {
        status: target,
        statusOrder: getServiceOrderStatusOrder(target),
      };
      if (target === SERVICE_ORDER_STATUS.COMPLETED) {
        patch.finishedAt = now;
        if (userId) patch.completedById = userId;
      } else {
        patch.finishedAt = null;
        patch.completedById = null;
      }

      await tx.serviceOrder.update({ where: { id: checklist.id }, data: patch });
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.SERVICE_ORDER,
        entityId: checklist.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'status',
        oldValue: checklist.status,
        newValue: target,
        reason:
          target === SERVICE_ORDER_STATUS.COMPLETED
            ? 'Concluído automaticamente pelo envio das fotos de check-in/out'
            : 'Reaberto automaticamente — fotos de check-in/out removidas',
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
        triggeredById: taskId,
        userId: userId || '',
        transaction: tx,
      });
      this.logger.log(
        `[CHECKLIST SYNC] Task ${taskId}: "${checklist.description}" ${checklist.status} → ${target} (hasPhotos=${hasPhotos})`,
      );
    };

    await reconcile('checklist entrada', anyCheckinPhotos);
    await reconcile('checklist saida', anyCheckoutPhotos);
  }

  private async recalcQuoteTotals(tx: PrismaTransaction, quoteId: string): Promise<void> {
    // Delegates to the shared single-source-of-truth implementation so every
    // flow that mutates quote services (cascade-delete, SO↔quote sync, the
    // service-order module) recomputes totals identically.
    await recalcQuoteTotals(tx, quoteId);
  }

  /**
   * Shared quote ⇄ PRODUCTION ServiceOrder bidirectional sync-create.
   *
   * Refetches the task's current quote services + service orders, computes the
   * non-destructive bidirectional sync actions (getBidirectionalSyncActions),
   * then:
   *  - creates missing quote services from PRODUCTION SOs (+ recalc totals),
   *  - creates missing PRODUCTION SOs from quote services (skipping any
   *    description the caller explicitly deleted in the same request),
   *  - propagates observation-only updates onto matched SOs.
   *
   * Both the single-update and batch-update paths call this so a bulk edit keeps
   * SOs ⇄ quote services + discount-aware totals in sync exactly like a single
   * edit. It only ADDS rows (never deletes) — deletions stay with each caller's
   * own delete/cascade logic. Errors are swallowed (logged) so a sync hiccup
   * never rolls back the primary update, mirroring the single-update path.
   *
   * @returns true if any sync action was performed (caller may want to refetch).
   */
  private async syncQuoteServicesAndServiceOrders(
    tx: PrismaTransaction,
    taskId: string,
    userId: string | undefined,
    persistedTaskStatus: TASK_STATUS,
    deletedServiceOrderDescriptions?: Set<string>,
  ): Promise<boolean> {
    try {
      const taskWithQuote = await tx.task.findUnique({
        where: { id: taskId },
        include: {
          quote: { include: { services: true } },
          serviceOrders: true,
        },
      });

      const currentQuote = taskWithQuote?.quote;
      const currentServiceOrders = taskWithQuote?.serviceOrders || [];

      // Nothing to sync if neither side has rows.
      if (!currentQuote?.services && currentServiceOrders.length === 0) {
        return false;
      }

      const quoteItems: SyncQuoteItem[] = (currentQuote?.services || []).map((item: any) => ({
        id: item.id,
        description: item.description,
        observation: item.observation,
        amount: item.amount,
      }));

      const serviceOrders: SyncServiceOrder[] = currentServiceOrders.map((so: any) => ({
        id: so.id,
        description: so.description,
        observation: so.observation,
        type: so.type,
      }));

      const syncActions = getBidirectionalSyncActions(quoteItems, serviceOrders);

      this.logger.log(
        `[QUOTE↔SO SYNC] Task ${taskId}: ${syncActions.quoteItemsToCreate.length} quote service(s) to create, ` +
          `${syncActions.serviceOrdersToCreate.length} service order(s) to create, ` +
          `${syncActions.serviceOrdersToUpdate.length} service order(s) to update`,
      );

      // Create missing quote services from service orders.
      if (syncActions.quoteItemsToCreate.length > 0 && currentQuote?.id) {
        for (const itemToCreate of syncActions.quoteItemsToCreate) {
          await tx.budgetItem.create({
            data: {
              quoteId: currentQuote.id,
              description: itemToCreate.description,
              observation: itemToCreate.observation || null,
              amount: itemToCreate.amount,
            },
          });

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK_QUOTE_SERVICE,
            entityId: currentQuote.id,
            action: CHANGE_ACTION.CREATE,
            field: null,
            newValue: serializeChangelogValue({
              description: itemToCreate.description,
              amount: Number(itemToCreate.amount),
              observation: itemToCreate.observation || null,
            }),
            userId: userId || null,
            reason: `Item '${itemToCreate.description}' adicionado via sincronização com O.S.`,
            triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
            triggeredById: null,
            transaction: tx,
            metadata: { itemDescription: itemToCreate.description },
          });
        }

        // Discount-aware recompute keeps Budget + every CustomerConfig in sync.
        await this.recalcQuoteTotals(tx, currentQuote.id);
      }

      // Create missing service orders from quote services — skipping any that
      // the caller explicitly deleted in the same request.
      if (syncActions.serviceOrdersToCreate.length > 0) {
        const isTaskCompleted = persistedTaskStatus === TASK_STATUS.COMPLETED;
        for (const soToCreate of syncActions.serviceOrdersToCreate) {
          const normalizedDesc = (soToCreate.description || '').toLowerCase().trim();
          if (deletedServiceOrderDescriptions?.has(normalizedDesc)) {
            this.logger.log(
              `[QUOTE↔SO SYNC] SKIPPING service order creation for "${soToCreate.description}" - was explicitly deleted by user`,
            );
            continue;
          }

          const newServiceOrder = await tx.serviceOrder.create({
            data: {
              taskId,
              description: soToCreate.description,
              observation: soToCreate.observation,
              type: SERVICE_ORDER_TYPE.PRODUCTION,
              status: isTaskCompleted
                ? SERVICE_ORDER_STATUS.COMPLETED
                : SERVICE_ORDER_STATUS.PENDING,
              statusOrder: isTaskCompleted
                ? 4
                : getServiceOrderStatusOrder(SERVICE_ORDER_STATUS.PENDING),
              createdById: userId || '',
              ...(isTaskCompleted && {
                startedAt: new Date(),
                startedById: userId || '',
                finishedAt: new Date(),
                completedById: userId || '',
              }),
            },
          });

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.SERVICE_ORDER,
            entityId: newServiceOrder.id,
            action: CHANGE_ACTION.CREATE,
            reason: 'Ordem de serviço criada automaticamente a partir do item de precificação',
            triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
            triggeredById: taskId,
            userId: userId || '',
            transaction: tx,
          });
        }
      }

      // Propagate observation-only updates onto matched service orders.
      if (syncActions.serviceOrdersToUpdate.length > 0) {
        for (const soToUpdate of syncActions.serviceOrdersToUpdate) {
          const oldSo = currentServiceOrders.find((so: any) => so.id === soToUpdate.id);

          await tx.serviceOrder.update({
            where: { id: soToUpdate.id },
            data: { observation: soToUpdate.observation },
          });

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.SERVICE_ORDER,
            entityId: soToUpdate.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'observation',
            oldValue: (oldSo as any)?.observation || null,
            newValue: soToUpdate.observation,
            reason: 'Observação atualizada automaticamente a partir do item de precificação',
            triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
            triggeredById: taskId,
            userId: userId || '',
            transaction: tx,
          });
        }
      }

      return (
        syncActions.quoteItemsToCreate.length > 0 ||
        syncActions.serviceOrdersToCreate.length > 0 ||
        syncActions.serviceOrdersToUpdate.length > 0
      );
    } catch (syncError) {
      this.logger.error('[QUOTE↔SO SYNC] Error during bidirectional sync:', syncError);
      // Don't throw — sync errors shouldn't block the main update.
      return false;
    }
  }

  /**
   * Regenerate a task's PRODUCTION service orders to match its (freshly copied) quote's services.
   *
   * A PRODUCTION service order is tied to a quote service ONLY by matching description(+observation) —
   * there is no FK between them. The normal quote create/edit paths keep the two sides in sync, but
   * `copyFromTask` REPLACES the whole quote and never re-ran that sync, so the destination kept its OLD
   * quote's service orders and got none for the new services (the "SO didn't update" bug). We can't use
   * `syncQuoteServicesAndServiceOrders` here — it's bidirectional and would recreate quote services from
   * the stale old SOs, polluting the just-copied quote.
   *
   * This is the same delete-orphaned + create-missing diff the quote UPDATE path runs, but driven by the
   * new quote: DELETE production SOs the new quote no longer contains, CREATE one for every new service
   * that has no matching SO, and PRESERVE any SO that still matches (keeps its in-progress status).
   * COMMERCIAL/LOGISTIC/ARTWORK service orders are never touched. Non-fatal — a sync error must not roll
   * back the copy (mirrors `syncQuoteServicesAndServiceOrders`).
   */
  private async regenerateProductionServiceOrdersFromQuote(
    tx: PrismaTransaction,
    taskId: string,
    quoteId: string,
    userId: string | undefined,
    persistedTaskStatus: TASK_STATUS,
  ): Promise<void> {
    try {
      const quote = await tx.budget.findUnique({
        where: { id: quoteId },
        include: { services: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
      });
      const services = quote?.services ?? [];

      const existingProductionSOs = await tx.serviceOrder.findMany({
        where: { taskId, type: SERVICE_ORDER_TYPE.PRODUCTION },
      });

      // Desc/obs keys the new quote expects. `coveredKeys` tracks which are already satisfied by a
      // preserved SO (or an earlier duplicate service) so we neither delete a still-valid SO nor create
      // two SOs for two identically-described services.
      const quoteKeys = new Set(
        services.map((s: any) => makeDescObsKey(s.description, s.observation)),
      );
      const coveredKeys = new Set<string>();

      // DELETE the production SOs the new quote no longer contains (orphaned by the replacement).
      for (const so of existingProductionSOs) {
        const key = makeDescObsKey(so.description, so.observation);
        if (quoteKeys.has(key)) {
          coveredKeys.add(key);
          continue;
        }
        await tx.serviceOrder.delete({ where: { id: so.id } });
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.SERVICE_ORDER,
          entityId: so.id,
          action: CHANGE_ACTION.DELETE,
          reason: 'Ordem de serviço removida — orçamento copiado de outra tarefa',
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
          triggeredById: taskId,
          userId: userId || '',
          transaction: tx,
        });
      }

      // CREATE a production SO for every new service still missing one.
      const isTaskCompleted = persistedTaskStatus === TASK_STATUS.COMPLETED;
      for (let i = 0; i < services.length; i++) {
        const service: any = services[i];
        if (!service.description) continue;
        const key = makeDescObsKey(service.description, service.observation);
        if (coveredKeys.has(key)) continue;
        coveredKeys.add(key);

        const newServiceOrder = await tx.serviceOrder.create({
          data: {
            taskId,
            description: service.description,
            observation: service.observation ?? null,
            type: SERVICE_ORDER_TYPE.PRODUCTION,
            status: isTaskCompleted ? SERVICE_ORDER_STATUS.COMPLETED : SERVICE_ORDER_STATUS.PENDING,
            statusOrder: isTaskCompleted
              ? 4
              : getServiceOrderStatusOrder(SERVICE_ORDER_STATUS.PENDING),
            position: service.position ?? i,
            createdById: userId || '',
            ...(isTaskCompleted && {
              startedAt: new Date(),
              startedById: userId || '',
              finishedAt: new Date(),
              completedById: userId || '',
            }),
          },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.SERVICE_ORDER,
          entityId: newServiceOrder.id,
          action: CHANGE_ACTION.CREATE,
          reason: 'Ordem de serviço criada automaticamente a partir do orçamento copiado',
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
          triggeredById: taskId,
          userId: userId || '',
          transaction: tx,
        });
      }
    } catch (error) {
      this.logger.error(
        '[copyFromTask] Error regenerating production service orders from copied quote:',
        error,
      );
      // Non-fatal — SO regeneration must not roll back the quote copy.
    }
  }

  private filterNoOpQuoteFields(existing: any, incoming: any): any | null {
    const filtered: any = {};
    for (const key of Object.keys(incoming)) {
      const value = incoming[key];
      if (value === undefined) continue;
      if (key === 'customerConfigs') {
        if (
          Array.isArray(value) &&
          this.quoteArrayChanged(existing.customerConfigs, value, v =>
            this.canonicalizeQuoteCustomerConfig(v),
          )
        ) {
          filtered[key] = value;
        }
      } else if (key === 'services') {
        if (
          Array.isArray(value) &&
          this.quoteArrayChanged(existing.services, value, v => this.canonicalizeQuoteService(v))
        ) {
          filtered[key] = value;
        }
      } else {
        if (this.quoteScalarChanged(existing[key], value)) {
          filtered[key] = value;
        }
      }
    }
    return Object.keys(filtered).length === 0 ? null : filtered;
  }

  /**
   * Resolves the acting user's sector privilege from the database.
   * Least-privilege: when the user (or their sector) cannot be resolved,
   * the operation is denied instead of assuming any privilege.
   */
  private async getActingUserPrivilege(
    userId: string | undefined,
    tx?: PrismaTransaction,
  ): Promise<SECTOR_PRIVILEGES> {
    if (!userId) {
      throw new ForbiddenException(
        'Usuário não identificado. Não é possível validar as permissões da operação.',
      );
    }
    const client: any = tx || this.prisma;
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { sector: { select: { privileges: true } } },
    });
    const privilege = user?.sector?.privileges;
    if (!privilege) {
      throw new ForbiddenException(
        'Não foi possível determinar o setor do usuário. Operação negada.',
      );
    }
    return privilege as SECTOR_PRIVILEGES;
  }

  /**
   * Enforces BudgetService.update guards on a NESTED quote write coming
   * through the task update paths (single + batch), so PUT /tasks cannot be
   * used to bypass quote status locks, per-stage role gates, or the
   * approved→PENDING auto-revert.
   *
   * `quoteData` must already be filtered by filterNoOpQuoteFields (only
   * material changes present). `clientProvidedStatus` must be captured BEFORE
   * that filter: pinning the current status (even as a no-op) is the designed
   * signal to KEEP the approval while editing values (user decision — do not
   * change).
   */
  private enforceNestedQuoteGuards(
    existingQuote: any,
    quoteData: any,
    userPrivilege: SECTOR_PRIVILEGES | string | undefined,
    clientProvidedStatus: boolean,
  ): void {
    const currentStatus = existingQuote.status as TASK_QUOTE_STATUS;

    // A guarda contra "aprovar faturamento por escrita aninhada de tarefa" perdeu
    // o alvo: aprovação de cobrança não é mais um status do orçamento, é `PUT
    // /billings/:id/approve`. O schema do status já recusa qualquer valor fora
    // do ciclo do orçamento.

    // Orçamento travado pelo DINHEIRO (alguma cobrança já aprovada): só metadados
    // seguros mudam; status vai pelos endpoints dedicados.
    if (isQuoteMoneyLocked(existingQuote?.billings)) {
      for (const key of Object.keys(quoteData)) {
        if (quoteData[key] === undefined) continue;
        if (!QUOTE_SAFE_AFTER_BILLING_FIELDS.has(key)) {
          throw new BadRequestException(
            'Após a aprovação do faturamento os valores deste orçamento não podem mais ser ' +
              'alterados: a fatura, os boletos e a nota fiscal saíram sobre o preço atual. ' +
              'Para mudar, use "Reverter Faturamento" na tela de Faturamento e grave de novo.',
          );
        }
        if (key === 'status') {
          throw new BadRequestException(
            'Use o endpoint de atualização de status para alterar o status do orçamento.',
          );
        }
      }
    }

    // Explicit status changes mirror the per-stage roles of the dedicated
    // /budgets status endpoints.
    if (quoteData.status !== undefined && quoteData.status !== currentStatus) {
      validateQuoteStatusChangeRole(quoteData.status as TASK_QUOTE_STATUS, userPrivilege);
    }

    // Auto-revert approved → PENDING when values change, unless the client
    // pinned a status (same semantics as BudgetService.update).
    if (
      !clientProvidedStatus &&
      QUOTE_VALUE_REVERTABLE_STATUSES.includes(currentStatus) &&
      (quoteData.services !== undefined || quoteData.customerConfigs !== undefined)
    ) {
      this.logger.log(
        `[Task Update] Auto-reverting nested quote from ${currentStatus} → PENDING due to value-affecting edits`,
      );
      quoteData.status = TASK_QUOTE_STATUS.PENDING;
    }
  }

  /**
   * Guards for a nested quote CREATE (POST /tasks with a `quote` block):
   * a brand-new quote cannot be born in a billing-lifecycle status, and
   * starting it directly at an approval stage requires the same roles as the
   * dedicated approval endpoints.
   */
  private enforceNestedQuoteCreateGuards(
    quoteData: any,
    userPrivilege: SECTOR_PRIVILEGES | string | undefined,
  ): void {
    if (!quoteData?.status || quoteData.status === TASK_QUOTE_STATUS.PENDING) return;
    // A checagem "não pode nascer em estágio de faturamento" perdeu o objeto: os
    // estados de cobrança não existem mais neste enum, e o zod recusa o valor
    // antes de chegar aqui. Um orçamento novo não tem cobrança nenhuma.

    if (userPrivilege !== SECTOR_PRIVILEGES.ADMIN) {
      validateQuoteStatusChangeRole(quoteData.status as TASK_QUOTE_STATUS, userPrivilege);
    }
  }

  /**
   * A ARTE DA AEROGRAFIA: as linhas de `Layout` (dono `airbrushingId`) para os
   * arquivos pedidos, criando como RASCUNHO as que faltam.
   *
   * A arte das TAREFAS saiu daqui: ela é do implemento (R2) e só se escreve por
   * `/implements/:id/layouts/*`. A unicidade é (dono, arquivo): o mesmo arquivo
   * pode ser arte de N aerografias, cada uma com a SUA linha — por isso não há
   * mais o clone que evitava "roubar" a linha de outro dono.
   */
  private async airbrushingLayoutIds(
    fileIds: string[],
    airbrushingId: string,
    tx?: PrismaTransaction,
  ): Promise<string[]> {
    const prisma = tx || this.prisma;
    const ids: string[] = [];
    for (const fileId of fileIds) {
      const existing = await prisma.layout.findFirst({
        where: { airbrushingId, fileId },
        select: { id: true },
      });
      const layout =
        existing ??
        (await prisma.layout.create({
          data: { fileId, airbrushingId, status: 'DRAFT' },
          select: { id: true },
        }));
      ids.push(layout.id);
    }
    return ids;
  }

  /**
   * Create a new task with complete changelog tracking and file uploads
   */
  async create(
    data: TaskCreateFormData,
    include?: TaskInclude,
    userId?: string,
    files?: {
      budgets?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      receipts?: Express.Multer.File[];
      bankSlips?: Express.Multer.File[];
      cutFiles?: Express.Multer.File[];
      baseFiles?: Express.Multer.File[];
      projectFiles?: Express.Multer.File[];
      checkinFiles?: Express.Multer.File[];
      checkoutFiles?: Express.Multer.File[];
      /** Foto da plaqueta de identificação (VIN) — imagem única, gravada no implemento. */
      implementVinPlate?: Express.Multer.File[];
    },
  ): Promise<TaskCreateResponse> {
    try {
      // Field-level access control per sector also applies on CREATE (B6) —
      // the create payload admits the same sensitive nested entities (quote,
      // financial docs, bonification...) as update. ADMIN bypasses inside the
      // validator; the privilege is resolved from the database (deny when
      // unresolvable). Covers the serial-range path too (it branches below).
      const creatorPrivilege = await this.getActingUserPrivilege(userId);
      validateSectorFieldAccess(creatorPrivilege, data as Record<string, unknown>, 'create');

      // A nested quote may not be born in a billing-lifecycle status, and
      // starting it at an approval stage requires the matching approval roles.
      if ((data as any).quote) {
        this.enforceNestedQuoteCreateGuards((data as any).quote, creatorPrivilege);
      }

      // Capture pre-uploaded file IDs before any processing
      // These come from the web form when files are pre-uploaded (e.g., serial range creation).
      // A ARTE não vem mais aqui: ela é do implemento (R2) — `/implements/:id/layouts/*`.
      const preUploadedBaseFileIds = (data as any).baseFileIds
        ? [...((data as any).baseFileIds as string[])]
        : [];
      const preUploadedProjectFileIds = (data as any).projectFileIds
        ? [...((data as any).projectFileIds as string[])]
        : [];
      const preUploadedCheckinFileIds = (data as any).checkinFileIds
        ? [...((data as any).checkinFileIds as string[])]
        : [];
      const preUploadedCheckoutFileIds = (data as any).checkoutFileIds
        ? [...((data as any).checkoutFileIds as string[])]
        : [];

      this.logger.log(`[Task Create] Incoming data keys: ${Object.keys(data).join(', ')}`);
      this.logger.log(
        `[Task Create] preUploadedBaseFileIds: ${JSON.stringify(preUploadedBaseFileIds)}`,
      );

      // Check if this is a bulk create from serial number range
      const serialNumberFrom = (data as any).serialNumberFrom;
      const serialNumberTo = (data as any).serialNumberTo;

      if (serialNumberFrom !== undefined && serialNumberTo !== undefined) {
        // Bulk create multiple tasks with sequential serial numbers
        return this.createTasksFromSerialRange(
          data,
          serialNumberFrom,
          serialNumberTo,
          include,
          userId,
          files,
        );
      }

      // Create task within transaction with file uploads
      const task = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validate task data
        await this.validateTask(data, undefined, tx);

        // Process cut files BEFORE creating the task (so fileIds are available for cut creation)
        if (files?.cutFiles && files.cutFiles.length > 0 && data.cuts) {
          const customerName = data.customerId
            ? (
                await tx.customer.findUnique({
                  where: { id: data.customerId },
                  select: { fantasyName: true },
                })
              )?.fantasyName
            : undefined;

          // Upload each cut file and update the corresponding cut with its fileId
          for (let i = 0; i < Math.min(files.cutFiles.length, data.cuts.length); i++) {
            const cutFile = files.cutFiles[i];
            const cutRecord = await this.fileService.createFromUploadWithTransaction(
              tx,
              cutFile,
              'cutFiles',
              userId,
              {
                entityId: '', // Will be updated after task creation
                entityType: 'CUT',
                customerName,
              },
            );
            // Update the cut with the uploaded file's ID
            data.cuts[i].fileId = cutRecord.id;
          }
        }

        // The pre-uploaded file ids are connected AFTER task creation (post-create
        // update), so they are stripped before repository processing to avoid
        // double-processing. Add createdById to data for service orders creation.
        const dataWithCreator = { ...data, createdById: userId } as typeof data;
        delete (dataWithCreator as any).baseFileIds;
        delete (dataWithCreator as any).projectFileIds;
        delete (dataWithCreator as any).checkinFileIds;
        delete (dataWithCreator as any).checkoutFileIds;
        const newTask = await this.tasksRepository.createWithTransaction(tx, dataWithCreator, {
          include: {
            ...include,
            customer: true, // Always include customer for file path organization
          },
        });

        // ======= EXPLICIT POST-CREATION: Connect pre-uploaded files =======
        // This guarantees the connection happens even if mapCreateFormDataToDatabaseCreateInput
        // doesn't handle these fields (e.g., when sent as JSON from serial range creation).
        this.logger.log(
          `[Task Create] Post-creation check: baseFileIds=${preUploadedBaseFileIds.length}`,
        );
        const hasPreUploadedFiles =
          preUploadedBaseFileIds.length > 0 ||
          preUploadedProjectFileIds.length > 0 ||
          preUploadedCheckinFileIds.length > 0 ||
          preUploadedCheckoutFileIds.length > 0;
        if (hasPreUploadedFiles) {
          const postCreateUpdates: any = {};

          // Connect base files directly (they're already File IDs)
          if (preUploadedBaseFileIds.length > 0) {
            postCreateUpdates.baseFiles = { connect: preUploadedBaseFileIds.map(id => ({ id })) };
          }

          // Connect project files
          if (preUploadedProjectFileIds.length > 0) {
            postCreateUpdates.projectFiles = {
              connect: preUploadedProjectFileIds.map(id => ({ id })),
            };
          }

          // Connect checkin files
          if (preUploadedCheckinFileIds.length > 0) {
            postCreateUpdates.checkinFiles = {
              connect: preUploadedCheckinFileIds.map(id => ({ id })),
            };
          }

          // Connect checkout files
          if (preUploadedCheckoutFileIds.length > 0) {
            postCreateUpdates.checkoutFiles = {
              connect: preUploadedCheckoutFileIds.map(id => ({ id })),
            };
          }

          if (Object.keys(postCreateUpdates).length > 0) {
            await tx.task.update({
              where: { id: newTask.id },
              data: postCreateUpdates,
            });
          }
        }

        // =====================================================================
        // QUOTE → PRODUCTION SO SYNC (create path)
        // A task created with a nested quote must mirror its quote services into
        // PRODUCTION ServiceOrders, exactly like update() and the standalone
        // quote-create do. Without this, a task born with a priced quote had no
        // matching production SOs (the bidirectional sync only ran on edits).
        // The shared helper is non-destructive (adds rows on either side) and
        // swallows its own errors so it never rolls back the create.
        // =====================================================================
        const createNestedQuote = (data as any).quote;
        const createHasQuoteServices =
          createNestedQuote &&
          typeof createNestedQuote === 'object' &&
          Array.isArray(createNestedQuote.services) &&
          createNestedQuote.services.length > 0;
        if (createHasQuoteServices) {
          await this.syncQuoteServicesAndServiceOrders(
            tx,
            newTask.id,
            userId,
            (newTask.status as TASK_STATUS) ?? TASK_STATUS.PREPARATION,
          );
        }

        // Medidas do implemento: uma linha NOVA por face. O implemento em si
        // (série, placa, chassi, vaga, categoria, tipo) nasceu com a tarefa no
        // repositório (W1, DD1) — SEMPRE, mesmo sem nenhum campo.
        const implementData = (data as any).implement;
        const hasImplementMeasures = facesIn(implementData).length > 0;

        if (hasImplementMeasures) {
          const implement = await tx.implement.findUnique({ where: { taskId: newTask.id } });
          if (!implement) {
            throw new InternalServerErrorException(
              'Tarefa criada sem implemento: toda tarefa tem exatamente um implemento.',
            );
          }

          // Uma face por vez, pelo escritor único (a tarefa é nova: toda face
          // nasce com a SUA linha). A trilha continua a de sempre.
          for (const face of FACES) {
            const implementMeasureData = implementData[FACE_REL[face]];
            if (!implementMeasureData) continue;
            const implementMeasureField = FACE_FK[face];

            this.logger.log(`[Task Create] Creating ${face} implementMeasure`);
            const written = await setFace(tx, implement.id, face, implementMeasureData);
            const implementMeasure = written.after!;

            // Create changelog for implementMeasure creation
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.IMPLEMENT_MEASURE,
              entityId: implementMeasure.id,
              action: CHANGE_ACTION.CREATE,
              entity: implementMeasure,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              reason: `ImplementMeasure ${implementMeasureField} criado`,
              transaction: tx,
            });

            this.logger.log(
              `[Task Create] ${face} implementMeasure created: ${implementMeasure.id} with changelog`,
            );
          }

          this.logger.log(`[Task Create] ImplementMeasures created for implement ${implement.id}`);
        }

        // Log task creation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TASK,
          entityId: newTask.id,
          action: CHANGE_ACTION.CREATE,
          entity: extractEssentialFields(
            newTask,
            getEssentialFields(ENTITY_TYPE.TASK) as (keyof Task)[],
          ),
          reason: 'Nova tarefa criada no sistema',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Process and save files WITHIN the transaction
        // This ensures files are only created if the task creation succeeds
        if (files) {
          const fileUpdates: any = {};
          const customerName = newTask.customer?.fantasyName;

          // Budget files (multiple)
          if (files.budgets && files.budgets.length > 0) {
            const budgetIds: string[] = [];
            for (const budgetFile of files.budgets) {
              const budgetRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                budgetFile,
                'taskBudgets',
                userId,
                {
                  entityId: newTask.id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              budgetIds.push(budgetRecord.id);
            }
            fileUpdates.budgets = { connect: budgetIds.map(id => ({ id })) };
          }

          // Invoice files (multiple)
          if (files.invoices && files.invoices.length > 0) {
            const invoiceIds: string[] = [];
            for (const invoiceFile of files.invoices) {
              const invoiceRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                invoiceFile,
                'taskInvoices',
                userId,
                {
                  entityId: newTask.id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              invoiceIds.push(invoiceRecord.id);
            }
            fileUpdates.invoices = { connect: invoiceIds.map(id => ({ id })) };
          }

          // Receipt files (multiple)
          if (files.receipts && files.receipts.length > 0) {
            const receiptIds: string[] = [];
            for (const receiptFile of files.receipts) {
              const receiptRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                receiptFile,
                'taskReceipts',
                userId,
                {
                  entityId: newTask.id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              receiptIds.push(receiptRecord.id);
            }
            fileUpdates.receipts = { connect: receiptIds.map(id => ({ id })) };
          }

          // Bank slip files (multiple)
          if (files.bankSlips && files.bankSlips.length > 0) {
            const bankSlipIds: string[] = [];
            for (const bankSlipFile of files.bankSlips) {
              const bankSlipRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                bankSlipFile,
                'taskBankSlips',
                userId,
                {
                  entityId: newTask.id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              bankSlipIds.push(bankSlipRecord.id);
            }
            fileUpdates.bankSlips = { connect: bankSlipIds.map(id => ({ id })) };
          }

          // Base files (files used as base for layout design)
          // Files are renamed to match task name with measures format
          if (files.baseFiles && files.baseFiles.length > 0) {
            const baseFileIds: string[] = [];

            // Get task name for file renaming
            const taskNameForFile = newTask.name || 'Tarefa';

            // Construct task-like object with implement implementMeasure data for measures calculation
            // The implement implementMeasures come from the input data (implementData)
            const taskWithImplement = {
              implement: implementData
                ? {
                    leftSideMeasure: implementData.leftSideMeasure || null,
                    rightSideMeasure: implementData.rightSideMeasure || null,
                  }
                : null,
            };

            for (let i = 0; i < files.baseFiles.length; i++) {
              const baseFile = files.baseFiles[i];

              // Generate new filename with task name and measures
              // Pass file index (1-based) to add suffix for multiple files
              const newFilename = generateBaseFileName(
                taskNameForFile,
                taskWithImplement,
                baseFile.originalname,
                i + 1, // 1-based index for file numbering
              );

              this.logger.log(
                `[Task Create] Renaming base file from "${baseFile.originalname}" to "${newFilename}"`,
              );

              // Update the file's originalname before upload
              baseFile.originalname = newFilename;

              const baseFileRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                baseFile,
                'taskBaseFiles',
                userId,
                {
                  entityId: newTask.id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              baseFileIds.push(baseFileRecord.id);
            }
            fileUpdates.baseFiles = { connect: baseFileIds.map(id => ({ id })) };
          }

          // Foto da plaqueta de identificação (VIN). Imagem ÚNICA e gravada no Implement, não na
          // Task — por isso não entra em `fileUpdates` (que conecta arquivos à tarefa).
          const vinPlateUpload = files.implementVinPlate?.[0];
          if (vinPlateUpload) {
            const implementForVinPlate = await tx.implement.findUnique({
              where: { taskId: newTask.id },
              select: { id: true },
            });

            if (implementForVinPlate) {
              const vinPlateFile = await this.fileService.createFromUploadWithTransaction(
                tx,
                vinPlateUpload,
                'implementVinPlate',
                userId,
                { entityId: implementForVinPlate.id, entityType: 'IMPLEMENT', customerName },
              );
              await tx.implement.update({
                where: { id: implementForVinPlate.id },
                data: { vinPlateId: vinPlateFile.id },
              });
              this.logger.log(
                `[Task Create] Foto da plaqueta ${vinPlateFile.id} vinculada ao implemento ${implementForVinPlate.id}`,
              );
            } else {
              this.logger.warn(
                `[Task Create] Foto da plaqueta enviada para a tarefa ${newTask.id}, mas nenhum implemento foi criado — arquivo ignorado`,
              );
            }
          }

          // Airbrushing files - process files for each airbrushing
          const airbrushingFileFields = Object.keys(files).filter(key =>
            key.startsWith('airbrushings['),
          );
          if (airbrushingFileFields.length > 0 && newTask.airbrushings) {
            console.log(
              '[TaskService] Processing airbrushing files:',
              airbrushingFileFields.length,
              'fields',
            );

            for (const fieldName of airbrushingFileFields) {
              // Parse field name: airbrushings[0].receipts -> index: 0, type: receipts
              const match = fieldName.match(/airbrushings\[(\d+)\]\.(receipts|invoices|layouts)/);
              if (!match) continue;

              const index = parseInt(match[1], 10);
              const fileType = match[2] as 'receipts' | 'invoices' | 'layouts';
              const airbrushingFiles = (files as any)[fieldName] as Express.Multer.File[];

              if (!airbrushingFiles || airbrushingFiles.length === 0) continue;
              if (!newTask.airbrushings[index]) {
                console.warn(`[TaskService] Airbrushing at index ${index} not found`);
                continue;
              }

              const airbrushing = newTask.airbrushings[index];
              console.log(
                `[TaskService] Processing ${airbrushingFiles.length} ${fileType} for airbrushing ${index} (ID: ${airbrushing.id})`,
              );

              // For layouts, we need to create both File AND Layout entities
              if (fileType === 'layouts') {
                const layoutEntityIds: string[] = [];
                for (const file of airbrushingFiles) {
                  // Create File entity
                  const fileRecord = await this.fileService.createFromUploadWithTransaction(
                    tx,
                    file,
                    'airbrushingLayouts',
                    userId,
                    {
                      entityId: airbrushing.id,
                      entityType: 'AIRBRUSHING',
                      customerName,
                    },
                  );
                  // A linha de arte da aerografia (rascunho)
                  layoutEntityIds.push(
                    ...(await this.airbrushingLayoutIds([fileRecord.id], airbrushing.id, tx)),
                  );
                }

                // Update the airbrushing with Layout entity IDs
                if (layoutEntityIds.length > 0) {
                  await tx.airbrushing.update({
                    where: { id: airbrushing.id },
                    data: {
                      layouts: { connect: layoutEntityIds.map(id => ({ id })) },
                    },
                  });
                  console.log(
                    `[TaskService] Connected ${layoutEntityIds.length} Layout entities to airbrushing ${airbrushing.id}`,
                  );
                }
              } else {
                // For receipts and invoices, handle as before (File entities only)
                const fileIds: string[] = [];
                for (const file of airbrushingFiles) {
                  const fileRecord = await this.fileService.createFromUploadWithTransaction(
                    tx,
                    file,
                    `airbrushing${fileType.charAt(0).toUpperCase() + fileType.slice(1)}` as any,
                    userId,
                    {
                      entityId: airbrushing.id,
                      entityType: 'AIRBRUSHING',
                      customerName,
                    },
                  );
                  fileIds.push(fileRecord.id);
                }

                // Update the airbrushing with file IDs
                if (fileIds.length > 0) {
                  await tx.airbrushing.update({
                    where: { id: airbrushing.id },
                    data: {
                      [fileType]: { connect: fileIds.map(id => ({ id })) },
                    },
                  });
                  console.log(
                    `[TaskService] Connected ${fileIds.length} ${fileType} to airbrushing ${airbrushing.id}`,
                  );
                }
              }
            }
          }

          // Update task with file IDs if any files were uploaded
          if (Object.keys(fileUpdates).length > 0) {
            const updatedTask = await tx.task.update({
              where: { id: newTask.id },
              data: fileUpdates,
              include: include,
            });
            return updatedTask;
          }
        }

        // Create initial forecast history entry if forecastDate was set on creation
        if (data.forecastDate && userId) {
          await tx.taskForecastHistory.create({
            data: {
              taskId: newTask.id,
              previousDate: null,
              newDate: data.forecastDate,
              source: 'INITIAL',
              changedById: userId,
            },
          });
        }

        // Re-fetch task if implementMeasures or baseFiles were created/connected so response includes them
        if (hasImplementMeasures || preUploadedBaseFileIds.length > 0) {
          const refetchedTask = await this.tasksRepository.findByIdWithTransaction(
            tx,
            newTask.id,
            include,
          );
          if (refetchedTask) return refetchedTask;
        }

        return newTask!;
      });

      // Emit task created event
      if (userId) {
        try {
          const createdByUser = await this.prisma.user.findUnique({
            where: { id: userId },
          });
          if (createdByUser) {
            this.eventEmitter.emit(
              'task.created',
              new TaskCreatedEvent(task as Task, createdByUser as any),
            );
          }
        } catch (error) {
          this.logger.error('Error emitting task created event:', error);
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // H9: Task-create with PLAN cuts must alert the cutting queue. This is the
      // most common entry point for cuts, yet it fired no cut notification (only
      // the standalone/edit-add paths did). After the transaction commits, emit
      // cut.created per created cut + one cuts.added.to.task — mirroring
      // CutService.create / batchCreate. Wrapped in try/catch so a notification
      // failure never breaks task creation.
      // ─────────────────────────────────────────────────────────────────────
      if (userId && Array.isArray(data.cuts) && data.cuts.length > 0) {
        try {
          const createdByUser = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true, email: true },
          });

          const taskForEvent = await this.prisma.task.findUnique({
            where: { id: (task as any).id },
            select: { id: true, name: true, sectorId: true, status: true },
          });

          if (createdByUser && taskForEvent) {
            const createdCuts = await this.prisma.cut.findMany({
              where: { taskId: taskForEvent.id },
            });

            if (createdCuts.length > 0) {
              for (const cut of createdCuts) {
                this.eventEmitter.emit(
                  'cut.created',
                  new CutCreatedEvent(cut as any, taskForEvent as any, createdByUser as any),
                );
              }

              this.eventEmitter.emit(
                'cuts.added.to.task',
                new CutsAddedToTaskEvent(
                  taskForEvent as any,
                  createdCuts as any,
                  createdByUser as any,
                ),
              );

              this.logger.debug(
                `[Task Create] Emitted cut.created x${createdCuts.length} + cuts.added.to.task for task ${taskForEvent.id}`,
              );
            }
          }
        } catch (cutEventError) {
          this.logger.warn('[Task Create] Failed to emit cut created events:', cutEventError);
        }
      }

      // Aerografias criadas junto com a tarefa sem aerografista entram em cotação:
      // anuncia aos aerografistas (idempotente; o cron repete se isto falhar).
      await this.airbrushingQuoteNotifier.notifyPendingRequests(undefined, userId);

      return {
        success: true,
        message: 'Tarefa criada com sucesso.',
        data: task as Task,
      };
    } catch (error) {
      this.logger.error('Erro ao criar tarefa:', error);

      // Clean up uploaded files if task creation failed
      if (files) {
        const allFiles = [
          ...(files.budgets || []),
          ...(files.invoices || []),
          ...(files.receipts || []),
          ...(files.bankSlips || []),
          ...(files.cutFiles || []),
          ...(files.implementVinPlate || []),
        ];

        for (const file of allFiles) {
          try {
            const fs = await import('fs');
            fs.unlinkSync(file.path);
          } catch (cleanupError) {
            this.logger.warn(`Failed to cleanup temp file: ${file.path}`);
          }
        }
      }

      if (error instanceof BadRequestException) {
        throw error;
      }
      rethrowPrismaValidationAsBadRequest(error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao criar a tarefa. Tente novamente.',
      );
    }
  }

  /**
   * Create multiple tasks from a serial number range
   * Example: serialNumberFrom=1, serialNumberTo=5 creates tasks with serial numbers 1, 2, 3, 4, 5
   */
  private async createTasksFromSerialRange(
    data: TaskCreateFormData,
    serialNumberFrom: number,
    serialNumberTo: number,
    include?: TaskInclude,
    userId?: string,
    files?: {
      budgets?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      receipts?: Express.Multer.File[];
      bankSlips?: Express.Multer.File[];
      cutFiles?: Express.Multer.File[];
      baseFiles?: Express.Multer.File[];
      /** Foto da plaqueta de identificação (VIN) — imagem única, gravada no implemento. */
      implementVinPlate?: Express.Multer.File[];
    },
  ): Promise<TaskCreateResponse> {
    // Calculate number of tasks to create
    const taskCount = serialNumberTo - serialNumberFrom + 1;

    if (taskCount > 100) {
      throw new BadRequestException(
        `O intervalo não pode exceder 100 tarefas (tentando criar ${taskCount} tarefas de ${serialNumberFrom} a ${serialNumberTo})`,
      );
    }

    this.logger.log(
      `Creating ${taskCount} tasks with serial numbers from ${serialNumberFrom} to ${serialNumberTo}`,
    );

    // Create task data for each serial number
    const tasks: TaskCreateFormData[] = [];
    for (let serialNum = serialNumberFrom; serialNum <= serialNumberTo; serialNum++) {
      const taskData = { ...data };
      // Remove the range fields and set the actual serial number
      delete (taskData as any).serialNumberFrom;
      delete (taskData as any).serialNumberTo;
      // W3 (DD1): a série da faixa vai para o implemento de CADA tarefa — objeto
      // próprio por tarefa (a cópia rasa acima compartilharia o do corpo).
      (taskData as any).implement = {
        ...((data as any).implement ?? {}),
        serialNumber: String(serialNum),
      };
      tasks.push(taskData);
    }

    // Use the existing batchCreate logic
    const batchResult = await this.batchCreate({ tasks }, include, userId);

    // Return all created tasks in the response
    if (batchResult.success && batchResult.data.success.length > 0) {
      return {
        success: true,
        message: `${taskCount} tarefas criadas com sucesso com números de série de ${serialNumberFrom} a ${serialNumberTo}`,
        data: batchResult.data.success as any, // Array of tasks when creating from range
      };
    } else {
      throw new InternalServerErrorException(
        `Falha ao criar tarefas em lote: ${batchResult.data.failed.length} falharam`,
      );
    }
  }

  /**
   * Batch create tasks
   */
  /**
   * Cria N tarefas numa transação só.
   *
   * `externalTx`: usado pela criação ATÔMICA de tarefas + orçamento
   * (`batchCreateWithQuote`), onde as tarefas e o orçamento têm de nascer no
   * mesmo commit. Quando ela vem, os eventos `task.created` NÃO são emitidos
   * aqui — quem abriu a transação os emite depois do commit, porque um ouvinte
   * que lê o banco antes dele não encontraria a tarefa.
   */
  async batchCreate(
    data: TaskBatchCreateFormData,
    include?: TaskInclude,
    userId?: string,
    externalTx?: PrismaTransaction,
  ): Promise<TaskBatchCreateResponse<TaskCreateFormData>> {
    try {
      // Field-level access control per sector also applies on CREATE (B6).
      // Resolved once — enforced per item inside the loop below.
      const creatorPrivilege = await this.getActingUserPrivilege(userId);

      const runBatch = async (tx: PrismaTransaction) => {
        // Process each task individually - "best effort" approach
        const successfulTasks: Task[] = [];
        const failedTasks: Array<{ index: number; error: string; data: any }> = [];

        // Save implementMeasure data from each task before it gets deleted by the repository
        const taskImplementMeasureDataMap = new Map<number, Partial<Record<FaceRel, any>>>();
        for (const [index, task] of data.tasks.entries()) {
          const implementData = (task as any).implement;
          if (facesIn(implementData).length > 0) {
            const saved: Partial<Record<FaceRel, any>> = {};
            for (const face of FACES) {
              const rel = FACE_REL[face];
              saved[rel] = implementData[rel] ? { ...implementData[rel] } : null;
              // Remove implementMeasure data from implement so repository doesn't try to handle it
              delete implementData[rel];
            }
            taskImplementMeasureDataMap.set(index, saved);
          }
        }

        for (const [index, task] of data.tasks.entries()) {
          try {
            // Field-level access control per sector (B6) + nested quote create guards
            validateSectorFieldAccess(creatorPrivilege, task as Record<string, unknown>, 'create');
            if ((task as any).quote) {
              this.enforceNestedQuoteCreateGuards((task as any).quote, creatorPrivilege);
            }

            // Validate task
            await this.validateTask(task, undefined, tx);

            // Create the task with createdById for service orders
            const taskWithCreator = { ...task, createdById: userId } as typeof task;
            const createdTask = await this.tasksRepository.createWithTransaction(
              tx,
              taskWithCreator,
              {
                include,
              },
            );

            // Create individual implementMeasures for this task and connect to the implement
            // (escritor único: cada tarefa do lote ganha as SUAS linhas).
            const savedImplementMeasureData = taskImplementMeasureDataMap.get(index);
            if (savedImplementMeasureData) {
              const implement = await tx.implement.findUnique({ where: { taskId: createdTask.id } });
              if (implement) {
                let wroteAny = false;
                for (const face of FACES) {
                  const implementMeasureData = savedImplementMeasureData[FACE_REL[face]];
                  if (!implementMeasureData || !implementMeasureData.sections) continue;
                  const written = await setFace(tx, implement.id, face, implementMeasureData);
                  wroteAny = true;
                  this.logger.log(
                    `[batchCreate] Individual ${face} implementMeasure created: ${written.measureId} for task index ${index}`,
                  );
                }
                if (wroteAny) {
                  this.logger.log(
                    `[batchCreate] Created individual implementMeasures for implement ${implement.id} on task ${createdTask.id}`,
                  );
                }
              }
            }

            // Mirror the single-create path: a batched/serial task carrying a quote
            // with services must get its matching PRODUCTION service orders (the sync
            // also keeps totals consistent). Without this, batch/serial-created tasks
            // with a priced quote had no mirrored production SOs.
            const batchNestedQuote = (task as any).quote;
            if (
              batchNestedQuote &&
              typeof batchNestedQuote === 'object' &&
              Array.isArray(batchNestedQuote.services) &&
              batchNestedQuote.services.length > 0
            ) {
              await this.syncQuoteServicesAndServiceOrders(
                tx,
                createdTask.id,
                userId,
                (createdTask.status as TASK_STATUS) ?? TASK_STATUS.PREPARATION,
              );
            }

            // Log successful task creation
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.TASK,
              entityId: createdTask.id,
              action: CHANGE_ACTION.CREATE,
              entity: extractEssentialFields(
                createdTask,
                getEssentialFields(ENTITY_TYPE.TASK) as (keyof Task)[],
              ),
              reason: 'Tarefa criada em operação de lote',
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              transaction: tx,
            });

            successfulTasks.push(createdTask);
          } catch (error) {
            // Collect validation/creation errors but continue processing
            const errorMessage =
              error instanceof BadRequestException ||
              error instanceof NotFoundException ||
              error instanceof ForbiddenException
                ? error.message
                : 'Erro desconhecido ao criar tarefa';

            failedTasks.push({
              index,
              error: errorMessage,
              data: task,
            });
          }
        }

        return {
          success: successfulTasks,
          failed: failedTasks,
          totalCreated: successfulTasks.length,
          totalFailed: failedTasks.length,
        };
      };

      const result = externalTx
        ? await runBatch(externalTx)
        : await this.prisma.$transaction(runBatch);

      // Emit task.created events for all successfully created tasks (outside transaction).
      // Com transação externa quem emite é o dono dela, DEPOIS do commit.
      if (!externalTx) {
        await this.emitTaskCreatedEvents(result.success as Task[], userId);
      }

      const successMessage =
        result.totalCreated === 1
          ? '1 tarefa criada com sucesso'
          : `${result.totalCreated} tarefas criadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalCreated + result.totalFailed,
        totalSuccess: result.totalCreated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na criação em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      rethrowPrismaValidationAsBadRequest(error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na criação em lote. Tente novamente.',
      );
    }
  }

  /**
   * AS TAREFAS E O ORÇAMENTO, NUM COMMIT SÓ.
   *
   * A tela de criação fazia N+1 requisições: uma por tarefa (cada uma com o seu
   * aviso de sucesso na tela) e uma última para o orçamento. Quando a última
   * falhava — e ela falha por motivos banais, um cliente que sumiu, uma migração
   * pendente —, as N tarefas já estavam gravadas, o operador via N avisos verdes
   * seguidos de um vermelho, e a orientação era "abra uma delas e crie o
   * orçamento por ela": o que criaria um orçamento de UM veículo e deixaria os
   * outros N-1 de fora, refazendo à mão o problema que o orçamento multitarefa
   * existe para resolver.
   *
   * Aqui é tudo ou nada. Uma tarefa que falha derruba o lote inteiro, e o
   * orçamento nasce ligado às N tarefas dentro da mesma transação.
   *
   * O tempo limite é maior que o padrão da casa (60s) porque o trabalho cresce
   * com o número de veículos: sessenta implementos são sessenta tarefas com
   * implemento, layouts, responsáveis e seis ordens de serviço cada, mais o
   * orçamento com as suas fatias — e uma transação que estoura o relógio no meio
   * é indistinguível, para quem está na tela, de um defeito de regra.
   */
  async batchCreateWithQuote(
    data: { tasks: any[]; quote: any },
    include?: TaskInclude,
    userId?: string,
  ): Promise<{
    success: true;
    message: string;
    data: { tasks: Task[]; quote: any };
  }> {
    try {
      const result = await this.prisma.$transaction(
        async (tx: PrismaTransaction) => {
          // ─── RESPONSÁVEIS NOVOS: CRIADOS UMA VEZ PARA O LOTE ───────────────
          //
          // `newResponsibles` no payload de uma tarefa cria os contatos junto
          // com ela. Com N tarefas do mesmo orçamento, mandá-los em todas
          // criaria N cópias do mesmo responsável — e é por isso que a tela
          // fazia o passo em duas etapas: mandava os novos só na primeira
          // requisição e reaproveitava os ids nas seguintes, uma dança que só
          // existia porque as tarefas nasciam uma a uma.
          //
          // Aqui eles são criados uma vez, deduplicados por nome + telefone (o
          // mesmo critério que a tela usava para reencontrá-los), e o id entra
          // em TODAS as tarefas do lote.
          const uniqueNewResponsibles = new Map<string, any>();
          for (const t of data.tasks) {
            for (const r of ((t as any).newResponsibles ?? []) as any[]) {
              uniqueNewResponsibles.set(`${r.name ?? ''}::${r.phone ?? ''}`, r);
            }
          }
          const sharedResponsibleIds: string[] = [];
          for (const r of uniqueNewResponsibles.values()) {
            const created = await tx.responsible.create({
              data: {
                ...r,
                companyId: r.companyId || (data.tasks[0] as any)?.customerId || null,
              },
              select: { id: true },
            });
            sharedResponsibleIds.push(created.id);
          }

          const tasksToCreate = data.tasks.map(t => {
            const { newResponsibles: _hoisted, ...rest } = t as any;
            return sharedResponsibleIds.length > 0
              ? {
                  ...rest,
                  responsibleIds: [
                    ...((rest.responsibleIds ?? []) as string[]),
                    ...sharedResponsibleIds,
                  ],
                }
              : rest;
          });

          const batch = await this.batchCreate(
            { tasks: tasksToCreate } as any,
            include,
            userId,
            tx,
          );
          const created = ((batch.data as any)?.success ?? []) as Task[];
          const failed = ((batch.data as any)?.failed ?? []) as Array<{
            index: number;
            error: string;
          }>;

          // TUDO OU NADA. `batchCreate` é "melhor esforço" por item — devolve o
          // que deu certo e o que não deu. Aqui a falha de uma tarefa desfaz as
          // outras e o orçamento: um orçamento que cobre 10 dos 11 implementos que
          // o operador digitou é pior do que nenhum, porque ninguém confere o
          // que não aparece.
          if (failed.length > 0 || created.length !== data.tasks.length) {
            const first = failed[0];
            throw new BadRequestException(
              failed.length > 0
                ? `Falha ao criar a tarefa ${(first.index ?? 0) + 1} de ${data.tasks.length}: ${first.error}`
                : 'Não foi possível criar todas as tarefas do orçamento.',
            );
          }

          const quote = await this.budgetService.create(
            { ...data.quote, taskIds: created.map(t => t.id) },
            userId as string,
            tx,
          );

          return { tasks: created, quote: quote.data };
        },
        { timeout: 180000, maxWait: 20000 },
      );

      // Depois do commit, como em `batchCreate`.
      await this.emitTaskCreatedEvents(result.tasks, userId);

      const count = result.tasks.length;
      return {
        success: true,
        message:
          count === 1
            ? 'Tarefa e orçamento criados com sucesso.'
            : `${count} tarefas e o orçamento criados com sucesso.`,
        data: result,
      };
    } catch (error) {
      this.logger.error('Erro na criação atômica de tarefas + orçamento:', error);
      if (error instanceof HttpException) throw error;
      const detail = describePrismaFailure(error);
      rethrowPrismaValidationAsBadRequest(error);
      throw new InternalServerErrorException(
        detail
          ? `Erro ao criar as tarefas e o orçamento: ${detail}`
          : 'Erro ao criar as tarefas e o orçamento.',
      );
    }
  }

  /**
   * Emite `task.created` para cada tarefa criada — sempre DEPOIS do commit.
   *
   * Extraído de `batchCreate` porque a criação atômica de tarefas + orçamento
   * abre a transação por fora e precisa emitir os mesmos eventos no mesmo ponto
   * do ciclo: um ouvinte que lê o banco antes do commit não acha a tarefa.
   */
  private async emitTaskCreatedEvents(tasks: Task[], userId?: string): Promise<void> {
    if (!userId || tasks.length === 0) return;
    try {
      const createdByUser = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!createdByUser) return;
      for (const task of tasks) {
        this.eventEmitter.emit('task.created', new TaskCreatedEvent(task, createdByUser as any));
      }
      this.logger.log(`Emitted ${tasks.length} task.created events for batch creation`);
    } catch (error) {
      this.logger.error('Error emitting task.created events for batch creation:', error);
    }
  }

  /**
   * Update an existing task with comprehensive changelog tracking and file uploads
   */
  async update(
    id: string,
    data: TaskUpdateFormData,
    include?: TaskInclude,
    userId?: string,
    userPrivilege?: SECTOR_PRIVILEGES | string,
    files?: {
      budgets?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      receipts?: Express.Multer.File[];
      bankSlips?: Express.Multer.File[];
      cutFiles?: Express.Multer.File[];
      observationFiles?: Express.Multer.File[];
      baseFiles?: Express.Multer.File[];
      projectFiles?: Express.Multer.File[];
      checkinFiles?: Express.Multer.File[];
      checkoutFiles?: Express.Multer.File[];
      soCheckinFiles?: Express.Multer.File[];
      soCheckoutFiles?: Express.Multer.File[];
      /** Foto da plaqueta de identificação (VIN) — imagem única, gravada no implemento. */
      implementVinPlate?: Express.Multer.File[];
    },
  ): Promise<TaskUpdateResponse> {
    try {
      // Optimistic-concurrency precondition. Split off BEFORE anything else: it is
      // a control field, not a column, and would blow up Prisma as an unknown arg.
      const expectedUpdatedAt = (data as { expectedUpdatedAt?: Date })?.expectedUpdatedAt;
      if (expectedUpdatedAt) {
        const { expectedUpdatedAt: _omit, ...rest } = data as TaskUpdateFormData & {
          expectedUpdatedAt?: Date;
        };
        data = rest as TaskUpdateFormData;
      }

      // DEBUG: Log what data actually enters the service
      this.logger.log('[Task Update] === SERVICE METHOD ENTRY ===');
      this.logger.log('[Task Update] Full data received:', JSON.stringify(data, null, 2));
      this.logger.log(`[Task Update] customerId: ${data.customerId}`);
      this.logger.log(`[Task Update] quote: ${JSON.stringify((data as any).quote)}`);
      this.logger.log('[Task Update] === END SERVICE METHOD ENTRY ===');

      // Track if task was auto-transitioned to WAITING_PRODUCTION for notification after transaction
      let taskAutoTransitionedToWaitingProduction = false;
      // Capture the task's status at entry so the post-commit step can detect a
      // transition INTO CANCELLED (from ANY cause — a direct cancel or the
      // all-COMMERCIAL-SOs-cancelled auto-cancel) and cascade-cancel the quote
      // (set it CANCELLED + tear down invoices/boletos/NFS-e). The teardown does
      // external Sicredi/Elotech calls and must run AFTER the tx commits.
      let taskOldStatusForQuoteCancel: TASK_STATUS | null = null;

      // Aerografias que ESTA atualização concluiu. A intenção da NFS-e é gravada
      // dentro da transação; a emissão é rede e roda depois do commit, pelo mesmo
      // gancho que o AirbrushingService usa.
      const completedAirbrushingIds: string[] = [];

      // Notificações do aerografista (serviço atribuído / pagamento recebido)
      // geradas por ESTA atualização. Mesma divisão da NFS-e: a decisão é feita
      // dentro da transação, onde o estado anterior existe, e o despacho roda
      // depois do commit — ver AirbrushingNotificationService.
      const airbrushingNotifyIntents: AirbrushingNotifyIntent[] = [];
      // Aerografistas cujas negociações foram encerradas por um cancelamento feito
      // pelo formulário da tarefa, por aerografia.
      const closedQuotePainters: Array<{ airbrushingId: string; painterIds: string[] }> = [];

      const transactionResult = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // ── Optimistic concurrency (opt-in) ──────────────────────────────────
        // `SELECT … FOR UPDATE` rather than a plain read-then-compare: under READ
        // COMMITTED a bare comparison leaves a window where both writers see the
        // same `updatedAt`, both pass, and the second still clobbers the first.
        // The lock serialises writers on this row for the rest of the transaction,
        // so the check and the write are genuinely atomic.
        //
        // Only taken when the caller opted in, so every existing code path — and
        // every client that has not shipped the field yet — behaves exactly as it
        // did, with no new lock contention and no deadlock surface.
        if (expectedUpdatedAt) {
          const locked = await tx.$queryRaw<Array<{ updatedAt: Date }>>`
            SELECT "updatedAt" FROM "Task" WHERE "id" = ${id} FOR UPDATE
          `;
          if (locked.length === 0) {
            throw new NotFoundException('Tarefa não encontrada.');
          }
          if (locked[0].updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
            throw new ConflictException(
              'Esta tarefa foi alterada por outra pessoa enquanto você editava. Recarregue para ver a versão atual antes de salvar.',
            );
          }
        }

        // Get existing task - always include customer for file organization
        // Also include file relations for changelog tracking
        // Include implement implementMeasures with sections for file naming with measures
        const existingTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
          include: {
            ...include,
            customer: true, // Always include customer for file path organization
            baseFiles: true, // Include for changelog tracking
            projectFiles: true, // Include for changelog tracking
            checkinFiles: true, // Include for changelog tracking
            checkoutFiles: true, // Include for changelog tracking
            logoPaints: true, // Include for changelog tracking
            observation: { include: { files: true } }, // Include for changelog tracking
            implement: {
              include: {
                leftSideMeasure: { include: { sections: true } },
                rightSideMeasure: { include: { sections: true } },
              },
            }, // Include implement with its measures for file naming with measures
            serviceOrders: {
              include: {
                checkinFiles: { select: { id: true } },
                checkoutFiles: { select: { id: true } },
              },
            }, // Include for services field changelog tracking (with checkin/checkout files for validation)
            // ⚠️ `billings` é obrigatório: `isQuoteMoneyLocked` responde `false`
            // sem ele, e a trava do dinheiro deixa de existir na escrita
            // aninhada de tarefa — que é justamente o caminho que o app usa.
            quote: {
              include: {
                services: { orderBy: { position: 'asc' } },
                billings: { select: { approvedAt: true, status: true } },
              },
            }, // Include for quote changelog tracking
          },
        });

        if (!existingTask) {
          throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
        }

        taskOldStatusForQuoteCancel = existingTask.status as TASK_STATUS;

        // ───────────────────────────────────────────────────────────────────
        // Strip a no-op nested `quote` block before any side-effect runs.
        //
        // Mobile (and any client using task.update({ quote: ... })) re-submits
        // the entire quote snapshot on every save, even when only a Task field
        // changed. Without this filter the repo would delete+recreate
        // services/customerConfigs on every no-op save, emit spurious
        // changelogs, and (when this update runs at BILLING_APPROVED+)
        // overwrite locked quote fields. Direct callers of the dedicated
        // budget endpoint go through BudgetService.update which has
        // the same protection.
        // ───────────────────────────────────────────────────────────────────
        if ((data as any).quote && existingTask.quote) {
          // Captured BEFORE the no-op filter: pinning the current status (even
          // as a no-op) signals "keep this status" and must suppress the
          // auto-revert inside enforceNestedQuoteGuards.
          const quoteStatusPinned = (data as any).quote.status !== undefined;
          const filteredQuote = this.filterNoOpQuoteFields(existingTask.quote, (data as any).quote);
          if (filteredQuote === null) {
            delete (data as any).quote;
          } else {
            (data as any).quote = filteredQuote;
            // Nested quote writes must honor the same guards as
            // BudgetService.update (status locks, role gates, auto-revert).
            this.enforceNestedQuoteGuards(
              existingTask.quote,
              filteredQuote,
              userPrivilege,
              quoteStatusPinned,
            );
          }
        } else if ((data as any).quote && !existingTask.quote) {
          // Task has no quote yet — the repository will CREATE one from this
          // block, so the nested-create guards apply (no billing-stage births,
          // approval stages role-gated).
          this.enforceNestedQuoteCreateGuards((data as any).quote, userPrivilege);
        }

        // Field-level access control per sector (centralized in task.permissions.ts).
        // Always enforce: if the caller didn't thread a privilege (internal
        // endpoints like /prepare, /start, /finish), resolve it from the
        // database — never skip the check (skipping would let an unresolved
        // privilege bypass the per-sector field allowlist). getActingUserPrivilege
        // throws when the privilege cannot be determined, so access is denied.
        const effectiveFieldPrivilege: SECTOR_PRIVILEGES =
          (userPrivilege as SECTOR_PRIVILEGES) || (await this.getActingUserPrivilege(userId, tx));
        validateSectorFieldAccess(effectiveFieldPrivilege, data as Record<string, unknown>);

        // Validate task data
        await this.validateTask(data, id, tx);

        // Handle implement and implementMeasure updates (consolidated in single implement object)
        const implementData = (data as any).implement;

        // Foto NOVA da plaqueta vence o `implement.vinPlateId` do payload. O front manda o objeto
        // `implement` inteiro quando QUALQUER campo dele muda (chassi, placa...), e nesse objeto o
        // `vinPlateId` de um arquivo ainda não enviado vem null. Sem isso, o upsert do
        // repositório (que roda DEPOIS do upload) gravava null por cima do id recém-criado —
        // salvar chassi + foto juntos perdia a foto, e só o segundo save é que a gravava.
        if (files?.implementVinPlate?.[0] && implementData && typeof implementData === 'object') {
          delete implementData.vinPlateId;
        }
        if (implementData !== undefined) {
          if (implementData === null) {
            // DD1: o implemento não sai da tarefa (o tradutor já recusa o corpo
            // velho `implement: null`; isto é a segunda cerca, antes do gatilho
            // diferido que daria 500 no COMMIT).
            throw new BadRequestException(IMPLEMENT_NOT_REMOVABLE_MESSAGE);
          }
          {
            // O implemento SEMPRE existe (DD1): o ramo que o criava aqui saiu.
            const implementId = existingTask.implement?.id;
            const existingImplement = existingTask.implement;
            if (!implementId) {
              throw new InternalServerErrorException(
                'Tarefa sem implemento: toda tarefa tem exatamente um implemento.',
              );
            }

            {
              // Campos do implemento (a SÉRIE fica de fora: ela vai pelo
              // repositório, W2, e a trilha dela é TASK/serialNumber, S-5).
              const updateFields: any = {};
              if (implementData.plate !== undefined) updateFields.plate = implementData.plate;
              if (implementData.chassisNumber !== undefined)
                updateFields.chassisNumber = implementData.chassisNumber;
              if (implementData.vinPlateId !== undefined)
                updateFields.vinPlateId = implementData.vinPlateId;
              if (implementData.category !== undefined) updateFields.category = implementData.category;
              if (implementData.type !== undefined) updateFields.type = implementData.type;
              if (implementData.spot !== undefined) updateFields.spot = implementData.spot;
              for (const field of IMPLEMENT_REAR_DOOR_FIELDS) {
                if (implementData[field] !== undefined) updateFields[field] = implementData[field];
              }

              if (Object.keys(updateFields).length > 0) {
                const updatedImplement = await tx.implement.update({
                  where: { id: implementId },
                  data: updateFields,
                });
                this.logger.log(`[Task Update] implement basic fields updated`);

                // Create changelog for each changed field
                for (const [field, newValue] of Object.entries(updateFields)) {
                  const oldValue = (existingImplement as any)?.[field];
                  if (oldValue !== newValue) {
                    await logEntityChange({
                      changeLogService: this.changeLogService,
                      entityType: ENTITY_TYPE.IMPLEMENT,
                      entityId: implementId,
                      action: CHANGE_ACTION.UPDATE,
                      entity: updatedImplement,
                      userId: userId || '',
                      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                      reason: `Implemento atualizado`,
                      field,
                      oldValue,
                      newValue,
                      transaction: tx,
                    });
                  }
                }

                this.logger.log(`[Task Update] implement field changes logged to changelog`);
              }
            }

            // Handle implementMeasures — uma face por vez, pelo escritor único
            // (editar a própria linha; copiar se ela é de mais alguém; criar se
            // não há; `null` desconecta e só apaga a linha que ficou sem uso).
            const processImplementMeasure = async (
              implementMeasureData: any,
              face: ImplementFace,
            ) => {
              if (implementMeasureData === undefined) return; // Not in payload, skip
              const implementMeasureField = FACE_FK[face];

              if (implementMeasureData === null) {
                const removed = await setFace(tx, implementId!, face, null);
                if (removed.action !== 'removed') return;
                this.logger.log(`[Task Update] Removing ${implementMeasureField} from implement`);

                if (removed.before) {
                  // Log implementMeasure removal to TASK entity changelog
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'implementMeasures',
                    oldValue: {
                      [implementMeasureField]: formatImplementMeasureForChangelog(removed.before),
                    },
                    newValue: { [implementMeasureField]: null },
                    reason: `ImplementMeasure ${implementMeasureField} removido`,
                    triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                    triggeredById: id,
                    userId: userId || '',
                    transaction: tx,
                  });
                }

                if (removed.previous === 'deleted') {
                  await logEntityChange({
                    changeLogService: this.changeLogService,
                    entityType: ENTITY_TYPE.IMPLEMENT_MEASURE,
                    entityId: removed.previousId!,
                    action: CHANGE_ACTION.DELETE,
                    entity: removed.before,
                    userId: userId || '',
                    triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                    reason: `ImplementMeasure ${implementMeasureField} removido`,
                    transaction: tx,
                  });
                  this.logger.log(
                    `[Task Update] Deleted ${implementMeasureField} (no other references)`,
                  );
                } else {
                  this.logger.log(
                    `[Task Update] ImplementMeasure ${removed.previousId} still in use elsewhere, only disconnected`,
                  );
                }
                return;
              }

              const written = await setFace(tx, implementId!, face, implementMeasureData);

              if (written.action === 'created') {
                const newImplementMeasure = written.after!;
                // Create changelog for new implementMeasure creation
                await logEntityChange({
                  changeLogService: this.changeLogService,
                  entityType: ENTITY_TYPE.IMPLEMENT_MEASURE,
                  entityId: newImplementMeasure.id,
                  action: CHANGE_ACTION.CREATE,
                  entity: newImplementMeasure,
                  userId: userId || '',
                  triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                  reason: `ImplementMeasure ${implementMeasureField} criado`,
                  transaction: tx,
                });

                // Log implementMeasure creation to TASK entity changelog
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'implementMeasures',
                  oldValue: { [implementMeasureField]: null },
                  newValue: {
                    [implementMeasureField]: formatImplementMeasureForChangelog(newImplementMeasure),
                  },
                  reason: `ImplementMeasure ${implementMeasureField} criado`,
                  triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                  triggeredById: id,
                  userId: userId || '',
                  transaction: tx,
                });

                this.logger.log(
                  `[Task Update] ${implementMeasureField} created: ${newImplementMeasure.id} with changelog`,
                );
                return;
              }

              if (written.action === 'forked') {
                this.logger.log(
                  `[Task Update] ${implementMeasureField} in use elsewhere; forked to ${written.measureId} (copy-on-write)`,
                );
              }

              // Create changelog for implementMeasure update
              await logEntityChange({
                changeLogService: this.changeLogService,
                entityType: ENTITY_TYPE.IMPLEMENT_MEASURE,
                entityId: written.previousId!,
                action: CHANGE_ACTION.UPDATE,
                entity: written.after,
                userId: userId || '',
                triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                reason: `ImplementMeasure ${implementMeasureField} atualizado`,
                transaction: tx,
              });

              // Log implementMeasure update to TASK entity changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: 'implementMeasures',
                oldValue: {
                  [implementMeasureField]: formatImplementMeasureForChangelog(written.before),
                },
                newValue: {
                  [implementMeasureField]: formatImplementMeasureForChangelog(written.after),
                },
                reason: `ImplementMeasure ${implementMeasureField} atualizado`,
                triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              this.logger.log(
                `[Task Update] ${implementMeasureField} updated (${written.action}): ${written.measureId} with changelog`,
              );
            };

            // Process each implementMeasure side
            for (const face of FACES) {
              await processImplementMeasure(implementData[FACE_REL[face]], face);
            }

            // Handle implementMeasure photo uploads (a foto é da face: linha usada
            // por outra face ganha cópia, como qualquer edição)
            if (files) {
              const customerName = existingTask.customer?.fantasyName;
              const implementMeasurePhotoKeys = Object.keys(files).filter(k =>
                k.startsWith('implementMeasurePhotos.'),
              );

              for (const key of implementMeasurePhotoKeys) {
                const face = faceOf(key.replace('implementMeasurePhotos.', ''));
                const photoFile = Array.isArray((files as any)[key])
                  ? (files as any)[key][0]
                  : (files as any)[key];

                if (photoFile && face) {
                  const uploadedPhoto = await this.fileService.createFromUploadWithTransaction(
                    tx,
                    photoFile,
                    'implementMeasurePhotos',
                    userId,
                    { entityId: id, entityType: 'IMPLEMENT_MEASURE', customerName },
                  );

                  await setFacePhoto(tx, implementId!, face, uploadedPhoto.id);
                }
              }
            }

            // ── O TAMANHO É DO ORÇAMENTO ─────────────────────────────────────
            //
            // Os lados que ESTA gravação criou ou alterou (objeto no payload, ou
            // foto nova) vão para os demais veículos do mesmo orçamento — por
            // cópia, na mesma transação. `null` (remover o lado) não replica.
            // Esta porta cria o implemento quando ele falta, então o irmão sem
            // implemento ganha um. Ver `utils/implement-measure-replication.ts`.
            const ladosEscritos = new Set<ImplementFace>();
            for (const face of FACES) {
              const v = (implementData as any)[FACE_REL[face]];
              if (v !== undefined && v !== null) ladosEscritos.add(face);
            }
            for (const key of Object.keys(files ?? {})) {
              if (!key.startsWith('implementMeasurePhotos.')) continue;
              const lado = faceOf(key.replace('implementMeasurePhotos.', ''));
              if (lado) ladosEscritos.add(lado);
            }
            if (ladosEscritos.size > 0) {
              await replicateImplementMeasuresToQuoteSiblings(tx, {
                sourceTaskId: id,
                sides: [...ladosEscritos],
                logChange: (entry: ReplicationLogEntry) =>
                  this.logReplicatedMeasure(entry, id, userId, tx),
              });
            }
          }

          // After processing implementMeasures in service, remove implementMeasure fields from implement data
          // so the repository doesn't try to process them again
          if (implementData) {
            for (const face of FACES) delete implementData[FACE_REL[face]];
          }
        }

        // Foto da plaqueta de identificação (VIN) enviada por multipart. Fica FORA do bloco
        // `implementData !== undefined` de propósito: trocar só a foto é uma edição legítima e o
        // payload não precisa carregar um objeto `implement` de fachada só para o upload valer.
        //
        // Substitui a anterior — o campo é uma imagem só. O arquivo antigo NÃO é apagado:
        // continua acessível pelo changelog e o File pode estar referenciado em outro lugar.
        const vinPlateUpload = files?.implementVinPlate?.[0];
        if (vinPlateUpload) {
          const vinPlateImplementId =
            (await tx.implement.findUnique({ where: { taskId: id }, select: { id: true } }))?.id ??
            null;

          if (vinPlateImplementId) {
            const previousVinPlateId = existingTask.implement?.vinPlateId ?? null;
            const vinPlateFile = await this.fileService.createFromUploadWithTransaction(
              tx,
              vinPlateUpload,
              'implementVinPlate',
              userId,
              {
                entityId: vinPlateImplementId,
                entityType: 'IMPLEMENT',
                customerName: existingTask.customer?.fantasyName,
              },
            );
            const implementWithVinPlate = await tx.implement.update({
              where: { id: vinPlateImplementId },
              data: { vinPlateId: vinPlateFile.id },
            });

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.IMPLEMENT,
              entityId: vinPlateImplementId,
              action: CHANGE_ACTION.UPDATE,
              entity: implementWithVinPlate,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              reason: 'Foto da plaqueta atualizada',
              field: 'vinPlateId',
              oldValue: previousVinPlateId,
              newValue: vinPlateFile.id,
              transaction: tx,
            });

            this.logger.log(
              `[Task Update] Foto da plaqueta ${vinPlateFile.id} vinculada ao implemento ${vinPlateImplementId}`,
            );
          } else {
            this.logger.warn(
              `[Task Update] Foto da plaqueta enviada para a tarefa ${id}, que não tem implemento — arquivo ignorado`,
            );
          }
        }

        // Validate status transition if status is being updated
        if (data.status && (data.status as TASK_STATUS) !== (existingTask.status as TASK_STATUS)) {
          const fromStatus = existingTask.status as TASK_STATUS;
          const toStatus = data.status as TASK_STATUS;

          if (!isValidTaskStatusTransition(fromStatus, toStatus)) {
            throw new BadRequestException(
              `Transição de status inválida: ${getTaskStatusLabel(fromStatus)} → ${getTaskStatusLabel(toStatus)}`,
            );
          }
          await this.assertArtworkAllowsRelease(tx, id, fromStatus, toStatus);

          // Only PRODUCTION_MANAGER, LOGISTIC and ADMIN can set a task to
          // COMPLETED or move it away from COMPLETED (COMPLETED feeds
          // bonus/payroll; logistics owns the checkout/finish hand-off).
          // When the caller didn't thread a privilege (internal endpoints like
          // /prepare), resolve it from the database — never assume.
          if (toStatus === TASK_STATUS.COMPLETED || fromStatus === TASK_STATUS.COMPLETED) {
            let effectivePrivilege: string | undefined = userPrivilege as string | undefined;
            if (!effectivePrivilege) {
              effectivePrivilege = await this.getActingUserPrivilege(userId, tx);
            }
            if (
              effectivePrivilege !== SECTOR_PRIVILEGES.PRODUCTION_MANAGER &&
              effectivePrivilege !== SECTOR_PRIVILEGES.LOGISTIC &&
              effectivePrivilege !== SECTOR_PRIVILEGES.ADMIN
            ) {
              throw new BadRequestException(
                'Apenas o gerente de produção, a logística ou o administrador pode finalizar tarefas ou reverter tarefas concluídas.',
              );
            }
          }

          // Additional validation for PREPARATION → IN_PRODUCTION
          // This transition requires all ARTWORK service orders to be completed
          if (fromStatus === TASK_STATUS.PREPARATION && toStatus === TASK_STATUS.IN_PRODUCTION) {
            // Build the final state of layout service orders by merging existing with updates
            const existingLayoutSOs =
              existingTask.serviceOrders?.filter(
                (so: any) => so.type === SERVICE_ORDER_TYPE.ARTWORK,
              ) || [];

            // If user is submitting service order updates, apply them to get final state
            let finalLayoutSOs: ServiceOrder[] = existingLayoutSOs;
            if (data.serviceOrders && Array.isArray(data.serviceOrders)) {
              finalLayoutSOs = existingLayoutSOs.map(existingSO => {
                const update = data.serviceOrders!.find((so: any) => so.id === existingSO.id);
                if (update && update.status) {
                  // User is updating this service order's status
                  return { ...existingSO, status: update.status as SERVICE_ORDER_STATUS };
                }
                return existingSO;
              });
            }

            if (finalLayoutSOs.length > 0) {
              const incompleteLayouts = finalLayoutSOs.filter(
                (so: any) =>
                  so.status !== SERVICE_ORDER_STATUS.COMPLETED &&
                  so.status !== SERVICE_ORDER_STATUS.CANCELLED,
              );

              if (incompleteLayouts.length > 0) {
                this.logger.warn(
                  `[VALIDATION] User attempted PREPARATION → IN_PRODUCTION with ${incompleteLayouts.length} incomplete layout(s). IDs: ${incompleteLayouts.map((so: any) => so.id).join(', ')}`,
                );
                throw new BadRequestException(
                  `Não é possível iniciar produção: ${incompleteLayouts.length} ordem(ns) de serviço de arte ainda não foi(ram) concluída(s). Complete todas as artes antes de iniciar a produção.`,
                );
              }
            }
          }

          // Validation for ANY → COMPLETED (finishing a task)
          // A task can only be finished when ALL of its service orders (regardless
          // of type) are already concluded. Previously the remaining production SOs
          // were silently auto-completed on finish; now finishing is blocked with a
          // clear error so each service must be explicitly completed first.
          if (toStatus === TASK_STATUS.COMPLETED && fromStatus !== TASK_STATUS.COMPLETED) {
            const existingSOs = existingTask.serviceOrders || [];

            // Merge any service order status updates from this same request so a
            // caller completing the services and the task together is allowed.
            let finalSOs: ServiceOrder[] = existingSOs;
            if (data.serviceOrders && Array.isArray(data.serviceOrders)) {
              finalSOs = existingSOs.map(existingSO => {
                const update = data.serviceOrders!.find((so: any) => so.id === existingSO.id);
                if (update && update.status) {
                  return { ...existingSO, status: update.status as SERVICE_ORDER_STATUS };
                }
                return existingSO;
              });
            }

            // CANCELLED service orders don't block completion. This gate is
            // INTENTIONALLY blocking for every other non-terminal status
            // (PENDING / IN_PROGRESS / WAITING_ARTWORK / WAITING_APPROVE / PAUSED):
            // a task may only be finished once all of its service orders are
            // concluded or cancelled, because finishing makes the task billable.
            // There is deliberately no force-finish escape — a manager must
            // conclude or cancel every service order first.
            const incompleteServices = finalSOs.filter(
              (so: any) =>
                so.status !== SERVICE_ORDER_STATUS.COMPLETED &&
                so.status !== SERVICE_ORDER_STATUS.CANCELLED,
            );

            if (incompleteServices.length > 0) {
              const total = finalSOs.filter(
                (so: any) => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
              ).length;
              this.logger.warn(
                `[VALIDATION] User attempted to finish task ${id} with ${incompleteServices.length}/${total} incomplete service(s). IDs: ${incompleteServices.map((so: any) => so.id).join(', ')}`,
              );
              throw new BadRequestException(
                `Não é possível finalizar a tarefa: ${incompleteServices.length} de ${total} serviço(s) ainda não foi(ram) concluído(s). Conclua todos os serviços antes de finalizar a tarefa.`,
              );
            }
          }

          // Auto-fill date requirements based on status transition
          // Instead of throwing an error, automatically set the required dates
          if (
            toStatus === TASK_STATUS.IN_PRODUCTION &&
            !existingTask.startedAt &&
            !data.startedAt
          ) {
            this.logger.log(
              `[AUTO-FILL] Auto-setting startedAt for task ${id} (status → IN_PRODUCTION)`,
            );
            data.startedAt = new Date();
          }
          if (toStatus === TASK_STATUS.COMPLETED && !existingTask.finishedAt && !data.finishedAt) {
            this.logger.log(
              `[AUTO-FILL] Auto-setting finishedAt for task ${id} (status → COMPLETED)`,
            );
            data.finishedAt = new Date();
            // Also auto-fill startedAt if it's not set (task going directly to completed)
            if (!existingTask.startedAt && !data.startedAt) {
              this.logger.log(
                `[AUTO-FILL] Auto-setting startedAt for task ${id} (completing without start date)`,
              );
              data.startedAt = new Date();
            }
          }
        }

        // =====================
        // DATE CASCADING SYNC LOGIC
        // =====================
        // Priority order: forecastDate (lowest) → entryDate → startedAt (highest)
        // When a higher priority date is set, auto-fill lower priority dates if not set
        // Higher priority dates are NEVER affected by lower priority date changes

        // Get the final values being used (prefer data over existing)
        const finalStartedAt = data.startedAt ?? existingTask.startedAt;
        const finalEntryDate = data.entryDate ?? existingTask.entryDate;
        const finalForecastDate = data.forecastDate ?? existingTask.forecastDate;

        // When startedAt is being set (explicitly or via status change)
        if (data.startedAt) {
          // Auto-fill entryDate if not set
          if (!existingTask.entryDate && !data.entryDate) {
            this.logger.log(
              `[DATE-SYNC] Auto-setting entryDate for task ${id} (startedAt is being set)`,
            );
            data.entryDate = data.startedAt;
          }
          // Auto-fill forecastDate if not set
          if (!existingTask.forecastDate && !data.forecastDate) {
            this.logger.log(
              `[DATE-SYNC] Auto-setting forecastDate for task ${id} (startedAt is being set)`,
            );
            data.forecastDate = data.startedAt;
          }
        }

        // When entryDate is being set (and startedAt was not just set)
        if (data.entryDate && !data.startedAt) {
          // Auto-fill forecastDate if not set
          if (!existingTask.forecastDate && !data.forecastDate) {
            this.logger.log(
              `[DATE-SYNC] Auto-setting forecastDate for task ${id} (entryDate is being set)`,
            );
            data.forecastDate = data.entryDate;
          }
        }

        // =====================
        // FORECAST HISTORY TRACKING
        // =====================
        if (data.forecastDate !== undefined && userId) {
          const oldForecast = existingTask.forecastDate;
          const newForecast = data.forecastDate;
          const forecastChanged = oldForecast?.getTime?.() !== newForecast?.getTime?.();
          if (forecastChanged) {
            let forecastSource = 'MANUAL';
            if (data.startedAt && !existingTask.forecastDate) {
              forecastSource = 'AUTO_STARTED_AT';
            } else if (data.entryDate && !data.startedAt && !existingTask.forecastDate) {
              forecastSource = 'AUTO_ENTRY_DATE';
            }

            const forecastReason = (data as any).forecastReason || null;

            await tx.taskForecastHistory.create({
              data: {
                taskId: id,
                previousDate: oldForecast ?? null,
                newDate: newForecast ?? null,
                reason: forecastReason,
                source: forecastSource,
                changedById: userId,
              },
            });
          }
        }

        // Strip forecast-only fields before Prisma write
        delete (data as any).forecastReason;

        // Process cut files BEFORE updating the task (so fileIds are available for cut creation)
        if (files?.cutFiles && files.cutFiles.length > 0 && data.cuts) {
          const customerName =
            existingTask.customer?.fantasyName ||
            (data.customerId
              ? (
                  await tx.customer.findUnique({
                    where: { id: data.customerId },
                    select: { fantasyName: true },
                  })
                )?.fantasyName
              : undefined);

          // Upload each unique file once and store the file records
          const uploadedFileRecords = [];
          for (const cutFile of files.cutFiles) {
            const fileRecord = await this.fileService.createFromUploadWithTransaction(
              tx,
              cutFile,
              'cutFiles',
              userId,
              {
                entityId: id,
                entityType: 'CUT',
                customerName,
              },
            );
            uploadedFileRecords.push(fileRecord);
          }

          // Assign fileIds to cuts based on _fileIndex (if present) or sequential index (backward compat)
          data.cuts.forEach((cut, index) => {
            const fileIndex = cut._fileIndex !== undefined ? cut._fileIndex : index;
            if (fileIndex < uploadedFileRecords.length) {
              cut.fileId = uploadedFileRecords[fileIndex].id;
            }
            // Clean up the temporary _fileIndex field
            delete cut._fileIndex;
          });
        }

        // Process observation files BEFORE task update (to replace temporary IDs with real UUIDs)
        if (files?.observationFiles && files.observationFiles.length > 0 && data.observation) {
          console.log(
            '[TaskService] Processing observation files BEFORE task update:',
            files.observationFiles.length,
          );
          const customerName = existingTask.customer?.fantasyName;

          // Get existing observation file IDs (only real UUIDs, not temporary IDs)
          const existingFileIds =
            data.observation.fileIds?.filter(id =>
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
            ) || [];
          console.log('[TaskService] Existing valid file IDs:', existingFileIds);

          const newFileIds: string[] = [...existingFileIds];

          // Upload each observation file
          for (const observationFile of files.observationFiles) {
            const fileRecord = await this.fileService.createFromUploadWithTransaction(
              tx,
              observationFile,
              'observations',
              userId,
              {
                entityId: id,
                entityType: 'OBSERVATION',
                customerName,
              },
            );
            newFileIds.push(fileRecord.id);
            console.log('[TaskService] Uploaded observation file:', fileRecord.id);
          }

          // Replace temporary IDs with real UUIDs
          data.observation.fileIds = newFileIds;
          console.log('[TaskService] Updated observation.fileIds:', newFileIds);
        } else if (data.observation?.fileIds) {
          // No new files to upload, but observation has fileIds - filter out temporary IDs
          data.observation.fileIds = data.observation.fileIds.filter(id =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
          );
          console.log(
            '[TaskService] Filtered observation.fileIds (no new files):',
            data.observation.fileIds,
          );
        }

        // Extract service orders from data to handle them explicitly
        // This prevents Prisma from doing a silent nested create without events/changelogs
        const serviceOrdersData = (data as any).serviceOrders;
        const createdServiceOrders: any[] = [];
        const observationChangedSOs: Array<{ serviceOrder: any; oldObservation: string | null }> =
          [];

        // Ensure statusOrder and bonificationOrder are updated when status/bonification changes
        const updateData = {
          ...data,
          ...(data.status && { statusOrder: getTaskStatusOrder(data.status as TASK_STATUS) }),
          ...((data as any).bonification && {
            bonificationOrder: getBonificationStatusOrder((data as any).bonification),
          }),
        };

        // Remove service orders from updateData to prevent Prisma nested create
        // We'll handle them explicitly below (serviceOrdersData was already extracted at line 1393)
        delete (updateData as any).serviceOrders;

        // Remove serviceOrderFiles from updateData - handled explicitly after SO processing
        delete (updateData as any).serviceOrderFiles;

        // Remove _soFileMapping from updateData - it's a meta field for file upload routing
        const soFileMapping = (data as any)._soFileMapping as
          | Array<{ soId: string; type: 'checkin' | 'checkout'; count: number }>
          | undefined;
        delete (updateData as any)._soFileMapping;

        // Extract airbrushings data - we'll handle updates/creates explicitly
        // The repository only handles deletions (via notIn), preserving existing airbrushings and their layouts
        const airbrushingsData = (updateData as any).airbrushings;

        // NÃO HÁ MAIS RESPONSÁVEL A SINCRONIZAR. O pagador do orçamento tinha
        // um `responsibleId` eleito, e este bloco existia para persegui-lo:
        // lia o principal ANTES do update, o principal DEPOIS, e reescrevia as
        // fatias que ainda apontavam para o antigo. Duas listas, um mecanismo de
        // sincronia, e uma divergência silenciosa sempre que ele não rodava.
        // Agora quem responde pelo orçamento é `Task.responsibles`, e ponto.

        // Update the task - always include customer for file organization
        // Also include file relations for changelog tracking
        let updatedTask = await this.tasksRepository.updateWithTransaction(
          tx,
          id,
          updateData,
          {
            include: {
              ...include,
              customer: true, // Always include customer for file path organization
              baseFiles: true, // Include for changelog tracking
              logoPaints: true, // Include for changelog tracking
              observation: { include: { files: true } }, // Include for changelog tracking
              implement: true, // Include for implement field changelog tracking
              serviceOrders: {
                include: {
                  checkinFiles: { select: { id: true } },
                  checkoutFiles: { select: { id: true } },
                },
              }, // Include for services field changelog tracking (with checkin/checkout files for validation)
              airbrushings: true, // Include for airbrushing file uploads
            },
          },
          userId,
        );

        // Handle service orders explicitly if provided
        // Migrate files when customer changes
        if (data.customerId !== undefined && data.customerId !== existingTask.customerId) {
          const oldCustomerName = (existingTask as any).customer?.fantasyName;
          if (data.customerId) {
            const newCustomer = await tx.customer.findUnique({
              where: { id: data.customerId },
              select: { fantasyName: true },
            });
            if (newCustomer?.fantasyName) {
              if (oldCustomerName) {
                // Customer changed: move from old customer folder to new customer folder
                await this.migrateTaskFilesOnCustomerChange(
                  id,
                  oldCustomerName,
                  newCustomer.fantasyName,
                  tx,
                );
              } else {
                // No previous customer: move from root-level paths into customer folder
                await this.migrateTaskFilesToCustomerFolder(id, newCustomer.fantasyName, tx);
              }
            }
          }
        }

        // FIX: Implement proper upsert logic - update existing service orders instead of always creating new ones
        // NOTE: If serviceOrdersData is provided as an array (even empty), we process deletions
        // If serviceOrdersData is undefined/null, service orders are not being modified
        if (serviceOrdersData && Array.isArray(serviceOrdersData)) {
          this.logger.log(
            `[Task Update] Processing ${serviceOrdersData.length} service orders for task ${id}`,
          );
          this.logger.log(
            `[Task Update] Service orders data (with observation): ${JSON.stringify(serviceOrdersData.map((so: any) => ({ id: so.id, description: so.description, type: so.type, observation: so.observation })))}`,
          );

          // Get all existing service orders for this task to handle duplicates and deletions
          const existingServiceOrders = await tx.serviceOrder.findMany({
            where: { taskId: id },
          });
          this.logger.log(
            `[Task Update] Found ${existingServiceOrders.length} existing service orders for task`,
          );

          // Process creates/updates for each service order in the submitted data
          for (let soIndex = 0; soIndex < serviceOrdersData.length; soIndex++) {
            const serviceOrderData = serviceOrdersData[soIndex];
            // Check if this is an existing service order (has an ID) or a new one
            if (serviceOrderData.id) {
              // UPDATE existing service order - preserve existing data
              this.logger.log(
                `[Task Update] Updating existing service order ${serviceOrderData.id}`,
              );

              // Get the old service order data for changelog
              const oldServiceOrder = await tx.serviceOrder.findUnique({
                where: { id: serviceOrderData.id },
              });

              if (oldServiceOrder) {
                // Only update fields that are explicitly provided
                const updatePayload: any = {};
                updatePayload.position = soIndex;
                if (serviceOrderData.type !== undefined) updatePayload.type = serviceOrderData.type;
                if (serviceOrderData.status !== undefined)
                  updatePayload.status = serviceOrderData.status;
                if (serviceOrderData.description !== undefined)
                  updatePayload.description = serviceOrderData.description;
                if (serviceOrderData.observation !== undefined)
                  updatePayload.observation = serviceOrderData.observation;
                if (serviceOrderData.assignedToId !== undefined)
                  updatePayload.assignedToId = serviceOrderData.assignedToId;

                // Handle checkin/checkout file connections
                if (serviceOrderData.checkinFileIds !== undefined) {
                  updatePayload.checkinFiles = {
                    set: serviceOrderData.checkinFileIds.map((fid: string) => ({ id: fid })),
                  };
                }
                if (serviceOrderData.checkoutFileIds !== undefined) {
                  updatePayload.checkoutFiles = {
                    set: serviceOrderData.checkoutFileIds.map((fid: string) => ({ id: fid })),
                  };
                }

                // Auto-complete service order when checkin or checkout files are provided
                const hasNewCheckinFiles =
                  serviceOrderData.checkinFileIds !== undefined &&
                  serviceOrderData.checkinFileIds.length > 0;
                const hasNewCheckoutFiles =
                  serviceOrderData.checkoutFileIds !== undefined &&
                  serviceOrderData.checkoutFileIds.length > 0;
                const soNotFinished =
                  oldServiceOrder.status !== SERVICE_ORDER_STATUS.COMPLETED &&
                  oldServiceOrder.status !== SERVICE_ORDER_STATUS.CANCELLED;

                if ((hasNewCheckinFiles || hasNewCheckoutFiles) && soNotFinished) {
                  this.logger.log(
                    `[AUTO-COMPLETE SO] Service order ${serviceOrderData.id} auto-completed: ` +
                      `checkin files=${hasNewCheckinFiles}, checkout files=${hasNewCheckoutFiles}`,
                  );
                  updatePayload.status = SERVICE_ORDER_STATUS.COMPLETED;
                  if (!oldServiceOrder.completedById) {
                    updatePayload.completedById = userId || null;
                    updatePayload.finishedAt = new Date();
                  }
                  if (!oldServiceOrder.startedById) {
                    updatePayload.startedById = userId || null;
                    updatePayload.startedAt = updatePayload.finishedAt || new Date();
                  }
                }

                // Handle date setting/clearing for status transitions
                if (
                  serviceOrderData.status !== undefined &&
                  serviceOrderData.status !== oldServiceOrder.status
                ) {
                  const oldStatus = oldServiceOrder.status as SERVICE_ORDER_STATUS;
                  const newStatus = serviceOrderData.status as SERVICE_ORDER_STATUS;

                  // If transitioning to IN_PROGRESS, set startedAt/startedById if not already set
                  if (
                    newStatus === SERVICE_ORDER_STATUS.IN_PROGRESS &&
                    oldStatus !== SERVICE_ORDER_STATUS.IN_PROGRESS
                  ) {
                    if (!oldServiceOrder.startedById) {
                      updatePayload.startedById = userId || null;
                      updatePayload.startedAt = new Date();
                    }
                  }

                  // If transitioning to COMPLETED, set completedBy/finishedAt and startedAt if not already set
                  if (
                    newStatus === SERVICE_ORDER_STATUS.COMPLETED &&
                    oldStatus !== SERVICE_ORDER_STATUS.COMPLETED
                  ) {
                    if (!oldServiceOrder.completedById) {
                      updatePayload.completedById = userId || null;
                      updatePayload.finishedAt = new Date();
                    }
                    // Also set startedAt/startedById if not already set (e.g., skipped IN_PROGRESS)
                    if (!oldServiceOrder.startedById) {
                      updatePayload.startedById = userId || null;
                      updatePayload.startedAt = updatePayload.finishedAt || new Date();
                    }
                  }

                  // If rolling back to PENDING, clear all progress dates
                  if (
                    newStatus === SERVICE_ORDER_STATUS.PENDING &&
                    oldStatus !== SERVICE_ORDER_STATUS.PENDING
                  ) {
                    this.logger.log(
                      `[Task Update] Clearing dates for SO ${serviceOrderData.id}: ${oldStatus} → PENDING`,
                    );
                    updatePayload.startedById = null;
                    updatePayload.startedAt = null;
                    updatePayload.approvedById = null;
                    updatePayload.approvedAt = null;
                    updatePayload.completedById = null;
                    updatePayload.finishedAt = null;
                  }
                  // If rolling back from COMPLETED to IN_PROGRESS, clear completion dates
                  else if (
                    newStatus === SERVICE_ORDER_STATUS.IN_PROGRESS &&
                    oldStatus === SERVICE_ORDER_STATUS.COMPLETED
                  ) {
                    this.logger.log(
                      `[Task Update] Clearing completion dates for SO ${serviceOrderData.id}: COMPLETED → IN_PROGRESS`,
                    );
                    updatePayload.completedById = null;
                    updatePayload.finishedAt = null;
                  }
                }

                // Only update if there are actual changes
                if (Object.keys(updatePayload).length > 0) {
                  const updatedServiceOrder = await tx.serviceOrder.update({
                    where: { id: serviceOrderData.id },
                    data: updatePayload,
                  });

                  createdServiceOrders.push(updatedServiceOrder);

                  // Track observation changes for post-transaction event emission
                  if (
                    serviceOrderData.observation !== undefined &&
                    oldServiceOrder.observation !== updatedServiceOrder.observation
                  ) {
                    observationChangedSOs.push({
                      serviceOrder: updatedServiceOrder,
                      oldObservation: oldServiceOrder.observation,
                    });
                  }

                  // Create changelog for service order update with field tracking
                  await trackAndLogFieldChanges({
                    changeLogService: this.changeLogService,
                    entityType: ENTITY_TYPE.SERVICE_ORDER,
                    entityId: serviceOrderData.id,
                    oldEntity: oldServiceOrder,
                    newEntity: updatedServiceOrder,
                    fieldsToTrack: [
                      'status',
                      'description',
                      'observation',
                      'type',
                      'assignedToId',
                      'startedAt',
                      'startedById',
                      'approvedAt',
                      'approvedById',
                      'finishedAt',
                      'completedById',
                    ],
                    userId: userId || '',
                    triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                    transaction: tx,
                  });

                  this.logger.log(
                    `[Task Update] Updated service order ${serviceOrderData.id} (${updatedServiceOrder.type})`,
                  );

                  // =====================================================================
                  // ARTWORK/COMMERCIAL SYNC: Check if status change should update task status
                  // =====================================================================
                  if (
                    serviceOrderData.status !== undefined &&
                    serviceOrderData.status !== oldServiceOrder.status &&
                    (updatedServiceOrder.type === SERVICE_ORDER_TYPE.ARTWORK ||
                      updatedServiceOrder.type === SERVICE_ORDER_TYPE.COMMERCIAL)
                  ) {
                    // Get current task status
                    const currentTask = await tx.task.findUnique({
                      where: { id },
                      select: { id: true, status: true },
                    });

                    if (currentTask) {
                      // Get all service orders with their current statuses (including this update)
                      const allServiceOrders = await tx.serviceOrder.findMany({
                        where: { taskId: id },
                        select: { id: true, status: true, type: true },
                      });

                      const layoutSyncResult = getTaskUpdateForLayoutServiceOrderStatusChange(
                        allServiceOrders.map(so => ({
                          id: so.id,
                          status: so.status as SERVICE_ORDER_STATUS,
                          type: so.type as SERVICE_ORDER_TYPE,
                        })),
                        updatedServiceOrder.id,
                        oldServiceOrder.status as SERVICE_ORDER_STATUS,
                        updatedServiceOrder.status as SERVICE_ORDER_STATUS,
                        updatedServiceOrder.type as SERVICE_ORDER_TYPE,
                        currentTask.status as TASK_STATUS,
                        await artworkGateFor(tx, id),
                      );

                      if (layoutSyncResult?.shouldUpdate) {
                        this.logger.log(
                          `[ARTWORK→TASK SYNC] Layout SO ${updatedServiceOrder.id} status changed, updating task ${id}: ${currentTask.status} → ${layoutSyncResult.newTaskStatus}`,
                        );

                        await tx.task.update({
                          where: { id },
                          data: {
                            status: layoutSyncResult.newTaskStatus,
                            statusOrder: getTaskStatusOrder(layoutSyncResult.newTaskStatus),
                          },
                        });

                        // Log the auto-transition in changelog
                        await this.changeLogService.logChange({
                          entityType: ENTITY_TYPE.TASK,
                          entityId: id,
                          action: CHANGE_ACTION.UPDATE,
                          field: 'status',
                          oldValue: currentTask.status,
                          newValue: layoutSyncResult.newTaskStatus,
                          reason: layoutSyncResult.reason,
                          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                          triggeredById: updatedServiceOrder.id,
                          userId: userId || '',
                          transaction: tx,
                        });
                      }
                    }
                  }
                } else {
                  // No changes, just add existing service order to the result
                  createdServiceOrders.push(oldServiceOrder);
                  this.logger.log(
                    `[Task Update] No changes for service order ${serviceOrderData.id}`,
                  );
                }
              } else {
                this.logger.warn(
                  `[Task Update] Service order ${serviceOrderData.id} not found, skipping update`,
                );
              }
            } else {
              // No ID provided - check if this service order already exists (prevent duplicates)
              // Match by description AND type for this task
              const existingMatch = existingServiceOrders.find(
                so =>
                  so.description === serviceOrderData.description &&
                  so.type === serviceOrderData.type,
              );

              if (existingMatch) {
                // UPDATE existing service order (found by description+type match)
                this.logger.log(
                  `[Task Update] Found existing service order by description+type match: ${existingMatch.id}`,
                );

                const updatePayload: any = {};
                updatePayload.position = soIndex;
                if (
                  serviceOrderData.status !== undefined &&
                  serviceOrderData.status !== existingMatch.status
                ) {
                  updatePayload.status = serviceOrderData.status;
                }
                if (
                  serviceOrderData.observation !== undefined &&
                  serviceOrderData.observation !== existingMatch.observation
                ) {
                  updatePayload.observation = serviceOrderData.observation;
                }
                if (
                  serviceOrderData.assignedToId !== undefined &&
                  serviceOrderData.assignedToId !== existingMatch.assignedToId
                ) {
                  updatePayload.assignedToId = serviceOrderData.assignedToId;
                }

                // Handle date setting/clearing for status transitions
                if (
                  serviceOrderData.status !== undefined &&
                  serviceOrderData.status !== existingMatch.status
                ) {
                  const oldStatus = existingMatch.status as SERVICE_ORDER_STATUS;
                  const newStatus = serviceOrderData.status as SERVICE_ORDER_STATUS;

                  // If transitioning to IN_PROGRESS, set startedAt/startedById if not already set
                  if (
                    newStatus === SERVICE_ORDER_STATUS.IN_PROGRESS &&
                    oldStatus !== SERVICE_ORDER_STATUS.IN_PROGRESS
                  ) {
                    if (!existingMatch.startedById) {
                      updatePayload.startedById = userId || null;
                      updatePayload.startedAt = new Date();
                    }
                  }

                  // If transitioning to COMPLETED, set completedBy/finishedAt and startedAt if not already set
                  if (
                    newStatus === SERVICE_ORDER_STATUS.COMPLETED &&
                    oldStatus !== SERVICE_ORDER_STATUS.COMPLETED
                  ) {
                    if (!existingMatch.completedById) {
                      updatePayload.completedById = userId || null;
                      updatePayload.finishedAt = new Date();
                    }
                    // Also set startedAt/startedById if not already set (e.g., skipped IN_PROGRESS)
                    if (!existingMatch.startedById) {
                      updatePayload.startedById = userId || null;
                      updatePayload.startedAt = updatePayload.finishedAt || new Date();
                    }
                  }

                  // If rolling back to PENDING, clear all progress dates
                  if (
                    newStatus === SERVICE_ORDER_STATUS.PENDING &&
                    oldStatus !== SERVICE_ORDER_STATUS.PENDING
                  ) {
                    updatePayload.startedById = null;
                    updatePayload.startedAt = null;
                    updatePayload.approvedById = null;
                    updatePayload.approvedAt = null;
                    updatePayload.completedById = null;
                    updatePayload.finishedAt = null;
                  }
                  // If rolling back from COMPLETED to IN_PROGRESS, clear completion dates
                  else if (
                    newStatus === SERVICE_ORDER_STATUS.IN_PROGRESS &&
                    oldStatus === SERVICE_ORDER_STATUS.COMPLETED
                  ) {
                    updatePayload.completedById = null;
                    updatePayload.finishedAt = null;
                  }
                }

                if (Object.keys(updatePayload).length > 0) {
                  const updatedServiceOrder = await tx.serviceOrder.update({
                    where: { id: existingMatch.id },
                    data: updatePayload,
                  });

                  createdServiceOrders.push(updatedServiceOrder);

                  // Track observation changes for post-transaction event emission
                  if (
                    serviceOrderData.observation !== undefined &&
                    existingMatch.observation !== updatedServiceOrder.observation
                  ) {
                    observationChangedSOs.push({
                      serviceOrder: updatedServiceOrder,
                      oldObservation: existingMatch.observation,
                    });
                  }

                  // Create changelog for service order update
                  await trackAndLogFieldChanges({
                    changeLogService: this.changeLogService,
                    entityType: ENTITY_TYPE.SERVICE_ORDER,
                    entityId: existingMatch.id,
                    oldEntity: existingMatch,
                    newEntity: updatedServiceOrder,
                    fieldsToTrack: [
                      'status',
                      'observation',
                      'assignedToId',
                      'startedAt',
                      'startedById',
                      'finishedAt',
                      'completedById',
                    ],
                    userId: userId || '',
                    triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                    transaction: tx,
                  });

                  this.logger.log(
                    `[Task Update] Updated existing service order ${existingMatch.id} (matched by description+type)`,
                  );

                  // =====================================================================
                  // ARTWORK/COMMERCIAL SYNC: Check if status change should update task status
                  // =====================================================================
                  if (
                    serviceOrderData.status !== undefined &&
                    serviceOrderData.status !== existingMatch.status &&
                    (updatedServiceOrder.type === SERVICE_ORDER_TYPE.ARTWORK ||
                      updatedServiceOrder.type === SERVICE_ORDER_TYPE.COMMERCIAL)
                  ) {
                    // Get current task status
                    const currentTask = await tx.task.findUnique({
                      where: { id },
                      select: { id: true, status: true },
                    });

                    if (currentTask) {
                      // Get all service orders with their current statuses (including this update)
                      const allServiceOrders = await tx.serviceOrder.findMany({
                        where: { taskId: id },
                        select: { id: true, status: true, type: true },
                      });

                      const layoutSyncResult = getTaskUpdateForLayoutServiceOrderStatusChange(
                        allServiceOrders.map(so => ({
                          id: so.id,
                          status: so.status as SERVICE_ORDER_STATUS,
                          type: so.type as SERVICE_ORDER_TYPE,
                        })),
                        updatedServiceOrder.id,
                        existingMatch.status as SERVICE_ORDER_STATUS,
                        updatedServiceOrder.status as SERVICE_ORDER_STATUS,
                        updatedServiceOrder.type as SERVICE_ORDER_TYPE,
                        currentTask.status as TASK_STATUS,
                        await artworkGateFor(tx, id),
                      );

                      if (layoutSyncResult?.shouldUpdate) {
                        this.logger.log(
                          `[ARTWORK→TASK SYNC] Layout SO ${updatedServiceOrder.id} status changed, updating task ${id}: ${currentTask.status} → ${layoutSyncResult.newTaskStatus}`,
                        );

                        await tx.task.update({
                          where: { id },
                          data: {
                            status: layoutSyncResult.newTaskStatus,
                            statusOrder: getTaskStatusOrder(layoutSyncResult.newTaskStatus),
                          },
                        });

                        // Log the auto-transition in changelog
                        await this.changeLogService.logChange({
                          entityType: ENTITY_TYPE.TASK,
                          entityId: id,
                          action: CHANGE_ACTION.UPDATE,
                          field: 'status',
                          oldValue: currentTask.status,
                          newValue: layoutSyncResult.newTaskStatus,
                          reason: layoutSyncResult.reason,
                          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                          triggeredById: updatedServiceOrder.id,
                          userId: userId || '',
                          transaction: tx,
                        });
                      }
                    }
                  }
                } else {
                  createdServiceOrders.push(existingMatch);
                  this.logger.log(
                    `[Task Update] No changes for existing service order ${existingMatch.id} (matched by description+type)`,
                  );
                }
              } else {
                // CREATE new service order (no ID and no existing match)
                this.logger.log(
                  `[Task Update] Creating new service order: ${serviceOrderData.description} (${serviceOrderData.type})`,
                );

                // Auto-complete new SOs added to COMPLETED tasks
                const isTaskCompleted =
                  (existingTask.status as TASK_STATUS) === TASK_STATUS.COMPLETED;
                const soStatus = isTaskCompleted
                  ? SERVICE_ORDER_STATUS.COMPLETED
                  : serviceOrderData.status || 'PENDING';

                const createdServiceOrder = await tx.serviceOrder.create({
                  data: {
                    taskId: id,
                    type: serviceOrderData.type,
                    status: soStatus,
                    description: serviceOrderData.description || null,
                    observation: serviceOrderData.observation || null,
                    assignedToId: serviceOrderData.assignedToId || null,
                    createdById: userId || '',
                    position: soIndex,
                    ...(isTaskCompleted && {
                      statusOrder: 4,
                      startedAt: new Date(),
                      startedById: userId || '',
                      finishedAt: new Date(),
                      completedById: userId || '',
                    }),
                    ...(serviceOrderData.checkinFileIds?.length > 0 && {
                      checkinFiles: {
                        connect: serviceOrderData.checkinFileIds.map((fid: string) => ({
                          id: fid,
                        })),
                      },
                    }),
                    ...(serviceOrderData.checkoutFileIds?.length > 0 && {
                      checkoutFiles: {
                        connect: serviceOrderData.checkoutFileIds.map((fid: string) => ({
                          id: fid,
                        })),
                      },
                    }),
                  },
                });

                createdServiceOrders.push(createdServiceOrder);

                // Create changelog for service order creation
                await logEntityChange({
                  changeLogService: this.changeLogService,
                  entityType: ENTITY_TYPE.SERVICE_ORDER,
                  entityId: createdServiceOrder.id,
                  action: CHANGE_ACTION.CREATE,
                  entity: createdServiceOrder,
                  userId: userId || '',
                  triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                  reason: 'Ordem de serviço criada via atualização de tarefa',
                  transaction: tx,
                });

                this.logger.log(
                  `[Task Update] Created service order ${createdServiceOrder.id} (${createdServiceOrder.type})`,
                );

                // =====================================================================
                // ARTWORK/COMMERCIAL SYNC: Check if newly created SO with COMPLETED status should update task
                // =====================================================================
                if (
                  (createdServiceOrder.type === SERVICE_ORDER_TYPE.ARTWORK ||
                    createdServiceOrder.type === SERVICE_ORDER_TYPE.COMMERCIAL) &&
                  createdServiceOrder.status === SERVICE_ORDER_STATUS.COMPLETED
                ) {
                  // Get current task status
                  const currentTask = await tx.task.findUnique({
                    where: { id },
                    select: { id: true, status: true },
                  });

                  // Evaluate the full preparation gate: ≥1 layout completed AND all commercial concluded
                  const taskServiceOrdersForGate =
                    currentTask && currentTask.status === TASK_STATUS.PREPARATION
                      ? await tx.serviceOrder.findMany({
                          where: { taskId: id },
                          select: { id: true, status: true, type: true },
                        })
                      : [];
                  const preparationGateSatisfied =
                    taskServiceOrdersForGate.some(
                      so =>
                        so.type === SERVICE_ORDER_TYPE.ARTWORK &&
                        so.status === SERVICE_ORDER_STATUS.COMPLETED,
                    ) &&
                    areCommercialServiceOrdersComplete(
                      taskServiceOrdersForGate.map(so => ({
                        status: so.status as SERVICE_ORDER_STATUS,
                        type: so.type as SERVICE_ORDER_TYPE,
                      })),
                    );

                  if (
                    currentTask &&
                    currentTask.status === TASK_STATUS.PREPARATION &&
                    preparationGateSatisfied &&
                    (await artworkGateFor(tx, id)) !== 'PENDING'
                  ) {
                    this.logger.log(
                      `[ARTWORK→TASK SYNC] New ${createdServiceOrder.type} SO ${createdServiceOrder.id} created with COMPLETED status (layout done, commercial done), updating task ${id}: PREPARATION → WAITING_PRODUCTION`,
                    );

                    await tx.task.update({
                      where: { id },
                      data: {
                        status: TASK_STATUS.WAITING_PRODUCTION,
                        statusOrder: getTaskStatusOrder(TASK_STATUS.WAITING_PRODUCTION),
                      },
                    });

                    // Log the auto-transition in changelog
                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.TASK,
                      entityId: id,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'status',
                      oldValue: TASK_STATUS.PREPARATION,
                      newValue: TASK_STATUS.WAITING_PRODUCTION,
                      reason: `Tarefa liberada automaticamente para produção quando ordem de serviço ${createdServiceOrder.type === SERVICE_ORDER_TYPE.COMMERCIAL ? 'comercial' : 'de arte'} foi criada como concluída`,
                      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                      triggeredById: createdServiceOrder.id,
                      userId: userId || '',
                      transaction: tx,
                    });
                  }
                }
              }
            }
          }

          // =====================================================================
          // DELETE SERVICE ORDERS: Remove service orders not in submitted list
          // This runs even when serviceOrdersData is empty (to handle case where user deletes ALL service orders)
          // If a service order existed before but is not in the current submission,
          // the user has deleted it from the form, so we should delete it.
          // =====================================================================
          const submittedServiceOrderIds = new Set<string>();
          const submittedDescriptionTypeKeys = new Set<string>();

          for (const serviceOrderData of serviceOrdersData) {
            if (serviceOrderData.id) {
              submittedServiceOrderIds.add(serviceOrderData.id);
            } else if (serviceOrderData.description) {
              // For new items without ID, track by description+type to avoid deleting items that match
              const key = `${(serviceOrderData.description || '').toLowerCase().trim()}|${serviceOrderData.type}`;
              submittedDescriptionTypeKeys.add(key);
            }
          }

          // CRITICAL DEBUG: Log deletion comparison data
          this.logger.log(`[Task Update] 🔍 Deletion analysis:`);
          this.logger.log(
            `[Task Update]   - Existing SO IDs: ${existingServiceOrders.map(so => so.id).join(', ')}`,
          );
          this.logger.log(
            `[Task Update]   - Submitted SO IDs: ${Array.from(submittedServiceOrderIds).join(', ') || 'none'}`,
          );
          this.logger.log(
            `[Task Update]   - Submitted desc+type keys: ${Array.from(submittedDescriptionTypeKeys).join(', ') || 'none'}`,
          );
          this.logger.log(
            `[Task Update]   - Existing SO descriptions: ${existingServiceOrders.map(so => `${so.description}|${so.type}`).join(', ')}`,
          );

          // Find service orders to delete (exist in DB but not in submission)
          const serviceOrdersToDelete = existingServiceOrders.filter(existing => {
            // If the existing SO's ID is in the submitted list, don't delete
            if (submittedServiceOrderIds.has(existing.id)) {
              this.logger.log(
                `[Task Update]   ✓ Keeping SO ${existing.id} (${existing.description}) - ID in submitted list`,
              );
              return false;
            }
            // If a new item was submitted with same description+type, don't delete
            const existingKey = `${(existing.description || '').toLowerCase().trim()}|${existing.type}`;
            if (submittedDescriptionTypeKeys.has(existingKey)) {
              this.logger.log(
                `[Task Update]   ✓ Keeping SO ${existing.id} (${existing.description}) - desc+type matches submitted item`,
              );
              return false;
            }
            // This service order should be deleted
            this.logger.log(
              `[Task Update]   ✗ DELETING SO ${existing.id} (${existing.description}) - not in submitted list`,
            );
            return true;
          });

          // Normalized descriptions of PRODUCTION SOs that will REMAIN after the
          // deletions below. Used to guard the cascade-delete: a quote service
          // must NOT be removed while another live PRODUCTION SO still mirrors
          // its description (e.g. a duplicate "(Prata)" SO is removed but the
          // original SO — and the priced quote service — must survive).
          const deletedSoIdSet = new Set(serviceOrdersToDelete.map(so => so.id));
          // Composite description::observation keys (the SAME key the quote↔SO
          // sync dedups on) for the PRODUCTION SOs that REMAIN after this edit.
          // Using a desc-only key here let a same-description/different-
          // observation sibling block (or, in the cascade below, wrong-delete)
          // the wrong priced line.
          const remainingProductionDescriptions = new Set<string>(
            existingServiceOrders
              .filter(
                so =>
                  so.type === SERVICE_ORDER_TYPE.PRODUCTION &&
                  so.description &&
                  !deletedSoIdSet.has(so.id),
              )
              .map(so => makeDescObsKey(so.description, (so as any).observation)),
          );

          // Log deletion summary
          this.logger.log(
            `[Task Update] 🗑️ Service orders to delete: ${serviceOrdersToDelete.length} of ${existingServiceOrders.length} total`,
          );

          // Delete the service orders
          for (const soToDelete of serviceOrdersToDelete) {
            this.logger.log(
              `[Task Update] Deleting service order ${soToDelete.id} (${soToDelete.type}: ${soToDelete.description})`,
            );

            await tx.serviceOrder.delete({
              where: { id: soToDelete.id },
            });

            // Create changelog for service order deletion
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.SERVICE_ORDER,
              entityId: soToDelete.id,
              action: CHANGE_ACTION.DELETE,
              entity: soToDelete,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              reason: 'Ordem de serviço removida via atualização de tarefa',
              transaction: tx,
            });

            // CASCADE DELETE: Delete corresponding quote services when production SO is deleted
            if (soToDelete.description && soToDelete.type === SERVICE_ORDER_TYPE.PRODUCTION) {
              // Composite description::observation key — the SAME key the quote↔SO
              // sync dedups on, so the cascade matches exactly the priced line this
              // SO mirrors (not every same-description sibling).
              const soKey = makeDescObsKey(soToDelete.description, (soToDelete as any).observation);

              // GUARD: only cascade-delete the mirrored quote service when NO
              // other live PRODUCTION SO still references this same desc+obs.
              // Without this, removing a duplicate SO (e.g. a "(Prata)" copy
              // created by the quote↔SO sync) wiped the priced quote service even
              // though the original SO remained — the bug that zeroed approved
              // quotes.
              if (remainingProductionDescriptions.has(soKey)) {
                this.logger.log(
                  `[Task Update] Skipping cascade-delete for "${soToDelete.description}" - another live PRODUCTION SO still references it`,
                );
              } else {
                // Find matching quote services by composite desc::obs key
                const matchingQuoteItems = await tx.budgetItem.findMany({
                  where: {
                    quote: {
                      tasks: { some: { id: id } },
                    },
                  },
                });

                const deletedQuoteItemIds: string[] = [];
                for (const quoteItem of matchingQuoteItems) {
                  // Match on the composite key (desc + observation). A legacy
                  // desc-only / startsWith match wrong-deleted a same-description
                  // line that only differed by observation.
                  if (makeDescObsKey(quoteItem.description, quoteItem.observation) === soKey) {
                    this.logger.log(
                      `[Task Update] Cascade-deleting quote service ${quoteItem.id} (${quoteItem.description})`,
                    );
                    await tx.budgetItem.delete({
                      where: { id: quoteItem.id },
                    });
                    deletedQuoteItemIds.push(quoteItem.id);
                  }
                }

                // Recalculate quote totals if any quote services were deleted.
                // Discount-aware recalc keeps Budget and CustomerConfig in sync.
                if (deletedQuoteItemIds.length > 0) {
                  const budget = await tx.budget.findFirst({
                    where: { tasks: { some: { id: id } } },
                  });
                  if (budget) {
                    await this.recalcQuoteTotals(tx, budget.id);
                    this.logger.log(
                      `[Task Update] Recalculated quote totals after cascade delete of ${deletedQuoteItemIds.length} quote service(s)`,
                    );
                  }
                }
              }
            }
          }

          if (serviceOrdersToDelete.length > 0) {
            this.logger.log(`[Task Update] Deleted ${serviceOrdersToDelete.length} service orders`);

            // =====================================================================
            // ARTWORK SYNC: Check if deleting layout SOs should rollback task status
            // If task is in WAITING_PRODUCTION and no completed layouts remain, rollback to PREPARATION
            // =====================================================================
            const deletedLayoutSOs = serviceOrdersToDelete.filter(
              so =>
                so.type === SERVICE_ORDER_TYPE.ARTWORK &&
                so.status === SERVICE_ORDER_STATUS.COMPLETED,
            );

            if (deletedLayoutSOs.length > 0) {
              // Get current task status
              const currentTask = await tx.task.findUnique({
                where: { id },
                select: { id: true, status: true },
              });

              if (currentTask && currentTask.status === TASK_STATUS.WAITING_PRODUCTION) {
                // Get remaining service orders (after deletions)
                const remainingServiceOrders = await tx.serviceOrder.findMany({
                  where: { taskId: id },
                  select: { id: true, status: true, type: true },
                });

                // Check if any layout SOs remain completed
                const anyLayoutCompleted = remainingServiceOrders.some(
                  so =>
                    so.type === SERVICE_ORDER_TYPE.ARTWORK &&
                    so.status === SERVICE_ORDER_STATUS.COMPLETED,
                );

                if (!anyLayoutCompleted) {
                  this.logger.log(
                    `[ARTWORK→TASK SYNC] Completed layout SOs deleted, no completed layouts remain, rolling back task ${id}: WAITING_PRODUCTION → PREPARATION`,
                  );

                  await tx.task.update({
                    where: { id },
                    data: {
                      status: TASK_STATUS.PREPARATION,
                      statusOrder: getTaskStatusOrder(TASK_STATUS.PREPARATION),
                    },
                  });

                  // Log the rollback in changelog
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'status',
                    oldValue: TASK_STATUS.WAITING_PRODUCTION,
                    newValue: TASK_STATUS.PREPARATION,
                    reason: `Tarefa retornada para preparação pois nenhuma ordem de serviço de arte permanece concluída`,
                    triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                    triggeredById: deletedLayoutSOs[0].id,
                    userId: userId || '',
                    transaction: tx,
                  });
                }
              }
            }
          }

          // CRITICAL FIX: Track deleted service order descriptions to prevent bidirectional sync from recreating them
          // This Set is used later in the PRICING↔SO SYNC section to skip creating service orders
          // that were explicitly deleted by the user
          const deletedServiceOrderDescriptions = new Set(
            serviceOrdersToDelete.map(so => (so.description || '').toLowerCase().trim()),
          );
          if (deletedServiceOrderDescriptions.size > 0) {
            this.logger.log(
              `[Task Update] Tracking ${deletedServiceOrderDescriptions.size} deleted SO descriptions to prevent sync recreation: ${Array.from(deletedServiceOrderDescriptions).join(', ')}`,
            );
          }

          // Store in a variable accessible to the sync section
          (data as any)._deletedServiceOrderDescriptions = deletedServiceOrderDescriptions;

          // Refetch the task with updated serviceOrders for changelog tracking
          // Merge service order includes: preserve client's nested includes (e.g. checkinFiles, checkoutFiles)
          const clientSOInclude =
            include?.serviceOrders && typeof include.serviceOrders === 'object'
              ? include.serviceOrders
              : {};
          updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
            include: {
              ...include,
              customer: true,
              observation: { include: { files: true } },
              implement: true,
              serviceOrders:
                typeof clientSOInclude === 'object' && 'include' in clientSOInclude
                  ? clientSOInclude
                  : true,
            },
          });

          this.logger.log(
            `[Task Update] After refetch, updatedTask.serviceOrders count: ${updatedTask?.serviceOrders?.length || 0}`,
          );

          // =====================================================================
          // REVERSE SYNC: Service Order Status Changes → Task Status
          // Check if any service order status changes should trigger task status changes
          // This handles cases where service orders are updated via task edit form
          // =====================================================================
          if (
            data.serviceOrders &&
            Array.isArray(data.serviceOrders) &&
            data.serviceOrders.length > 0
          ) {
            this.logger.log(
              `[REVERSE SYNC] Checking if service order updates require task status change`,
            );

            // Check each service order that was updated
            for (const serviceOrderData of data.serviceOrders) {
              // Only check service orders with IDs (existing records that were updated)
              if (serviceOrderData.id && serviceOrderData.status) {
                // Find the old service order data from existingTask
                const oldServiceOrder = existingTask.serviceOrders?.find(
                  so => so.id === serviceOrderData.id,
                );

                if (oldServiceOrder && oldServiceOrder.status !== serviceOrderData.status) {
                  // Service order status changed - check if task should update
                  const taskUpdate = getTaskUpdateForServiceOrderStatusChange(
                    updatedTask.serviceOrders || [],
                    serviceOrderData.id,
                    oldServiceOrder.status as SERVICE_ORDER_STATUS,
                    serviceOrderData.status as SERVICE_ORDER_STATUS,
                    updatedTask.status as TASK_STATUS,
                  );

                  if (taskUpdate && taskUpdate.shouldUpdate && taskUpdate.newTaskStatus) {
                    this.logger.log(
                      `[REVERSE SYNC] Service order ${serviceOrderData.id} status change (${oldServiceOrder.status} → ${serviceOrderData.status}) triggers task status change: ${updatedTask.status} → ${taskUpdate.newTaskStatus}`,
                    );

                    // Build task update data
                    const taskUpdateData: any = {
                      status: taskUpdate.newTaskStatus,
                      statusOrder: getTaskStatusOrder(taskUpdate.newTaskStatus),
                    };

                    if (taskUpdate.setStartedAt) {
                      taskUpdateData.startedAt = new Date();
                    }
                    if (taskUpdate.setFinishedAt) {
                      taskUpdateData.finishedAt = new Date();
                    }
                    if (taskUpdate.clearStartedAt) {
                      taskUpdateData.startedAt = null;
                    }
                    if (taskUpdate.clearFinishedAt) {
                      taskUpdateData.finishedAt = null;
                    }

                    // Update task status
                    updatedTask = (await tx.task.update({
                      where: { id },
                      data: taskUpdateData,
                      include: {
                        ...include,
                        customer: true,
                        observation: { include: { files: true } },
                        implement: true,
                        serviceOrders: true,
                      },
                    })) as any;

                    // Log the reverse sync in changelog
                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.TASK,
                      entityId: id,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'status',
                      oldValue: existingTask.status,
                      newValue: taskUpdate.newTaskStatus,
                      reason: taskUpdate.reason,
                      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                      triggeredById: serviceOrderData.id,
                      userId: userId || '',
                      transaction: tx,
                    });

                    // Break after first status change (avoid multiple status changes in one update)
                    break;
                  }
                }
              }
            }
          }

          // Auto-transition task from PREPARATION to WAITING_PRODUCTION when all ARTWORK service
          // orders are COMPLETED AND all COMMERCIAL service orders are concluded AND the
          // artwork gate is not PENDING (D-15/DD3). The commercial gate only blocks the
          // AUTOMATIC transition — an explicit "Disponibilizar para produção" (manual status
          // change) bypasses it; the artwork gate holds the manual one too (DD10).
          if (updatedTask && updatedTask.status === TASK_STATUS.PREPARATION) {
            // Get all ARTWORK service orders for this task (from the refetched data)
            const layoutServiceOrders = (updatedTask.serviceOrders || []).filter(
              (so: any) => so.type === SERVICE_ORDER_TYPE.ARTWORK,
            );

            // Check if there's at least 1 layout service order and ALL are COMPLETED
            const hasLayoutOrders = layoutServiceOrders.length > 0;
            const allLayoutCompleted = layoutServiceOrders.every(
              (so: any) => so.status === SERVICE_ORDER_STATUS.COMPLETED,
            );

            // All COMMERCIAL service orders must also be concluded (cancelled don't block)
            const allCommercialCompleted = areCommercialServiceOrdersComplete(
              (updatedTask.serviceOrders || []).map((so: any) => ({
                status: so.status as SERVICE_ORDER_STATUS,
                type: so.type as SERVICE_ORDER_TYPE,
              })),
            );

            if (
              hasLayoutOrders &&
              allLayoutCompleted &&
              allCommercialCompleted &&
              (await artworkGateFor(tx, id)) !== 'PENDING'
            ) {
              this.logger.log(
                `[AUTO-TRANSITION Task Update] All ${layoutServiceOrders.length} ARTWORK service orders completed and all COMMERCIAL service orders concluded for task ${id}, transitioning PREPARATION → WAITING_PRODUCTION`,
              );

              // Update task status to WAITING_PRODUCTION
              // Using tx.task.update directly to include statusOrder which is not in the form data type
              updatedTask = (await tx.task.update({
                where: { id },
                data: {
                  status: TASK_STATUS.WAITING_PRODUCTION,
                  statusOrder: 2, // WAITING_PRODUCTION statusOrder
                },
                include: {
                  ...include,
                  customer: true,
                  observation: { include: { files: true } },
                  implement: true,
                  serviceOrders: true,
                },
              })) as any;

              // Log the auto-transition in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: TASK_STATUS.PREPARATION,
                newValue: TASK_STATUS.WAITING_PRODUCTION,
                reason: `Tarefa liberada automaticamente para produção quando todas as ${layoutServiceOrders.length} ordens de serviço de arte foram concluídas`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              // Track that task was auto-transitioned for event/notification emission after transaction
              taskAutoTransitionedToWaitingProduction = true;
            }
          }

          // Rollback task when ALL production service orders are cancelled
          // NOTE: Task is NOT auto-completed when all production SOs finish.
          // Only PRODUCTION_MANAGER or ADMIN can manually finish/complete tasks.
          if (updatedTask && updatedTask.status === TASK_STATUS.IN_PRODUCTION) {
            const productionServiceOrders = (updatedTask.serviceOrders || []).filter(
              (so: any) => so.type === SERVICE_ORDER_TYPE.PRODUCTION,
            );

            const activeProductionOrders = productionServiceOrders.filter(
              (so: any) => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
            );

            // If ALL production orders are now cancelled, rollback task (not cancel - only COMMERCIAL cancellation cancels task)
            if (activeProductionOrders.length === 0 && productionServiceOrders.length > 0) {
              this.logger.log(
                `[ROLLBACK TASK ON ALL PRODUCTION SO CANCEL] All ${productionServiceOrders.length} PRODUCTION service orders cancelled for task ${id}, rolling back to WAITING_PRODUCTION`,
              );

              updatedTask = (await tx.task.update({
                where: { id },
                data: {
                  status: TASK_STATUS.WAITING_PRODUCTION,
                  statusOrder: 2, // WAITING_PRODUCTION statusOrder
                  startedAt: null, // Clear start date on rollback
                },
                include: {
                  ...include,
                  customer: true,
                  observation: { include: { files: true } },
                  implement: true,
                  serviceOrders: true,
                },
              })) as any;

              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: existingTask.status,
                newValue: TASK_STATUS.WAITING_PRODUCTION,
                reason: `Tarefa retornada para aguardando produção pois todas as ${productionServiceOrders.length} ordens de serviço de produção foram canceladas`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              taskAutoTransitionedToWaitingProduction = true;
            }
          }

          // NOTE: Completed tasks are NO LONGER rolled back when new service orders are added.
          // Only the logistics sector can manage task completion status.

          // =====================================================================
          // AUTO-CANCEL TASK WHEN ALL COMMERCIAL SERVICE ORDERS ARE CANCELLED
          // When all COMMERCIAL service orders are cancelled, cancel task and all other SOs
          // =====================================================================
          if (updatedTask && updatedTask.status !== TASK_STATUS.CANCELLED) {
            const commercialServiceOrders = (updatedTask.serviceOrders || []).filter(
              (so: any) => so.type === SERVICE_ORDER_TYPE.COMMERCIAL,
            );

            const activeCommercialOrders = commercialServiceOrders.filter(
              (so: any) => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
            );

            // If ALL commercial orders are now cancelled, cancel the task and all other service orders
            if (activeCommercialOrders.length === 0 && commercialServiceOrders.length > 0) {
              this.logger.log(
                `[AUTO-CANCEL TASK] All ${commercialServiceOrders.length} COMMERCIAL service orders cancelled for task ${id}, cancelling task and all remaining service orders`,
              );

              // Cancel all remaining non-cancelled service orders
              const otherServiceOrders = (updatedTask.serviceOrders || []).filter(
                (so: any) => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
              );

              // Intentionally NO per-SO notification emits here: task.cancelled covers it and avoids an N-notification storm.
              for (const otherSO of otherServiceOrders) {
                await tx.serviceOrder.update({
                  where: { id: otherSO.id },
                  data: {
                    status: SERVICE_ORDER_STATUS.CANCELLED,
                    statusOrder: 5,
                  },
                });

                // Log each service order cancellation
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.SERVICE_ORDER,
                  entityId: otherSO.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'status',
                  oldValue: otherSO.status,
                  newValue: SERVICE_ORDER_STATUS.CANCELLED,
                  reason: `Ordem de serviço ${otherSO.type} cancelada automaticamente pois todas as ordens de serviço comerciais foram canceladas`,
                  triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                  triggeredById: id,
                  userId: userId || '',
                  transaction: tx,
                });
              }

              // Update task status to CANCELLED
              updatedTask = (await tx.task.update({
                where: { id },
                data: {
                  status: TASK_STATUS.CANCELLED,
                  statusOrder: 5, // CANCELLED statusOrder
                },
                include: {
                  ...include,
                  customer: true,
                  observation: { include: { files: true } },
                  implement: true,
                  serviceOrders: true,
                },
              })) as any;

              // Log the auto-cancel in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: existingTask.status,
                newValue: TASK_STATUS.CANCELLED,
                reason: `Tarefa cancelada automaticamente pois todas as ${commercialServiceOrders.length} ordens de serviço comerciais foram canceladas`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              // The quote is cascade-cancelled in the post-commit step (it detects
              // the task's transition into CANCELLED) — no per-branch capture needed.
              taskAutoTransitionedToWaitingProduction = true;
            }
          }

          // =====================================================================
          // ROLLBACK: COMMERCIAL Service Order Un-Cancelled → Task Status Rollback
          // Check if any COMMERCIAL SO was un-cancelled (CANCELLED → other status)
          // If so and task is CANCELLED, calculate correct status based on all SOs
          // =====================================================================
          if (updatedTask.status === TASK_STATUS.CANCELLED && data.serviceOrders) {
            // Check if any COMMERCIAL SO was un-cancelled
            for (const serviceOrderData of data.serviceOrders) {
              if (serviceOrderData.id && serviceOrderData.status) {
                const oldServiceOrder = existingTask.serviceOrders?.find(
                  (so: any) => so.id === serviceOrderData.id,
                );

                // Check if this is a COMMERCIAL SO being un-cancelled
                if (
                  oldServiceOrder &&
                  oldServiceOrder.type === SERVICE_ORDER_TYPE.COMMERCIAL &&
                  oldServiceOrder.status === SERVICE_ORDER_STATUS.CANCELLED &&
                  serviceOrderData.status !== SERVICE_ORDER_STATUS.CANCELLED
                ) {
                  // Calculate the correct task status based on all service orders
                  const correctStatus = calculateCorrectTaskStatus(
                    (updatedTask.serviceOrders || []).map((so: any) => ({
                      status: so.status as SERVICE_ORDER_STATUS,
                      type: so.type as SERVICE_ORDER_TYPE,
                    })),
                    await artworkGateFor(tx, id),
                  );

                  this.logger.log(
                    `[COMMERCIAL ROLLBACK] Commercial service order ${serviceOrderData.id} un-cancelled (${oldServiceOrder.status} → ${serviceOrderData.status}), rolling back task ${id} from CANCELLED to ${correctStatus}`,
                  );

                  const newStatusOrder =
                    correctStatus === TASK_STATUS.PREPARATION
                      ? 1
                      : correctStatus === TASK_STATUS.WAITING_PRODUCTION
                        ? 2
                        : correctStatus === TASK_STATUS.IN_PRODUCTION
                          ? 3
                          : correctStatus === TASK_STATUS.COMPLETED
                            ? 4
                            : 5;

                  // Update task status to the correct status
                  updatedTask = (await tx.task.update({
                    where: { id },
                    data: {
                      status: correctStatus,
                      statusOrder: newStatusOrder,
                    },
                    include: {
                      ...include,
                      customer: true,
                      observation: { include: { files: true } },
                      implement: true,
                      serviceOrders: true,
                    },
                  })) as any;

                  // Log the rollback in changelog
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'status',
                    oldValue: TASK_STATUS.CANCELLED,
                    newValue: correctStatus,
                    reason: `Tarefa retornada para ${correctStatus === TASK_STATUS.PREPARATION ? 'preparação' : correctStatus === TASK_STATUS.WAITING_PRODUCTION ? 'aguardando produção' : correctStatus === TASK_STATUS.IN_PRODUCTION ? 'em produção' : 'concluída'} pois ordem de serviço comercial foi reativada`,
                    triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                    triggeredById: serviceOrderData.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  taskAutoTransitionedToWaitingProduction = true;
                  break; // Only need to rollback once
                }
              }
            }
          }
        }

        // =====================================================================
        // SERVICE ORDER FILE UPLOADS (direct file upload via soCheckinFiles/soCheckoutFiles)
        // Processes uploaded files using _soFileMapping to route them to the correct SOs,
        // then merges with existing IDs from serviceOrderFiles for backward compatibility.
        // =====================================================================
        // Track which SOs were already processed by direct upload so the legacy handler can skip them
        const soFilesProcessed = new Set<string>();

        // Warn if files are sent without mapping metadata (they would be silently ignored)
        if (
          (!soFileMapping || soFileMapping.length === 0) &&
          files &&
          ((files.soCheckinFiles?.length ?? 0) > 0 || (files.soCheckoutFiles?.length ?? 0) > 0)
        ) {
          this.logger.warn(
            `[Task Update] soCheckinFiles/soCheckoutFiles uploaded but _soFileMapping is missing or empty — files will be ignored. Task: ${id}`,
          );
        }

        if (soFileMapping && soFileMapping.length > 0 && files) {
          const soCheckinFiles = files.soCheckinFiles || [];
          const soCheckoutFiles = files.soCheckoutFiles || [];
          let checkinOffset = 0;
          let checkoutOffset = 0;

          // Group uploaded file IDs by SO
          const uploadedIdsBySo: Record<
            string,
            { checkinFileIds: string[]; checkoutFileIds: string[] }
          > = {};

          const customerName =
            updatedTask.customer?.fantasyName || existingTask.customer?.fantasyName;

          for (const mapping of soFileMapping) {
            const { soId, type, count } = mapping;

            // Verify SO belongs to this task
            const so = await tx.serviceOrder.findFirst({
              where: { id: soId, taskId: id },
            });
            if (!so) {
              this.logger.warn(
                `[Task Update] soFileMapping: SO ${soId} not found for task ${id}, skipping ${count} ${type} files`,
              );
              // Still advance offsets so subsequent mappings stay aligned
              if (type === 'checkin') checkinOffset += count;
              else checkoutOffset += count;
              continue;
            }

            if (!uploadedIdsBySo[soId]) {
              uploadedIdsBySo[soId] = { checkinFileIds: [], checkoutFileIds: [] };
            }

            const sourceArray = type === 'checkin' ? soCheckinFiles : soCheckoutFiles;
            const offset = type === 'checkin' ? checkinOffset : checkoutOffset;
            const fileContext =
              type === 'checkin' ? 'serviceOrderCheckinFiles' : 'serviceOrderCheckoutFiles';

            for (let i = 0; i < count; i++) {
              const file = sourceArray[offset + i];
              if (!file) {
                this.logger.warn(
                  `[Task Update] soFileMapping: Expected file at index ${offset + i} for SO ${soId} ${type}, but array only has ${sourceArray.length} files`,
                );
                continue;
              }

              const fileRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                file,
                fileContext,
                userId,
                { entityId: id, entityType: 'TASK', customerName },
              );

              if (type === 'checkin') {
                uploadedIdsBySo[soId].checkinFileIds.push(fileRecord.id);
              } else {
                uploadedIdsBySo[soId].checkoutFileIds.push(fileRecord.id);
              }

              this.logger.log(
                `[Task Update] Uploaded SO ${type} file for SO ${soId}: ${fileRecord.id}`,
              );
            }

            if (type === 'checkin') checkinOffset += count;
            else checkoutOffset += count;
          }

          // Merge uploaded file IDs with existing IDs from serviceOrderFiles, then update each SO
          const serviceOrderFilesData = (data as any).serviceOrderFiles as
            | Record<string, { checkinFileIds?: string[]; checkoutFileIds?: string[] }>
            | undefined;

          for (const [soId, uploaded] of Object.entries(uploadedIdsBySo)) {
            // Get existing IDs from the legacy serviceOrderFiles field (retained file IDs)
            const existingData = serviceOrderFilesData?.[soId];
            const existingCheckinIds = existingData?.checkinFileIds
              ? Array.isArray(existingData.checkinFileIds)
                ? existingData.checkinFileIds
                : Object.values(existingData.checkinFileIds)
              : [];
            const existingCheckoutIds = existingData?.checkoutFileIds
              ? Array.isArray(existingData.checkoutFileIds)
                ? existingData.checkoutFileIds
                : Object.values(existingData.checkoutFileIds)
              : [];

            const allCheckinIds = [...existingCheckinIds, ...uploaded.checkinFileIds];
            const allCheckoutIds = [...existingCheckoutIds, ...uploaded.checkoutFileIds];

            const soFileUpdates: any = {};
            if (allCheckinIds.length > 0 || existingData?.checkinFileIds !== undefined) {
              soFileUpdates.checkinFiles = {
                set: allCheckinIds.map((fid: string) => ({ id: fid })),
              };
            }
            if (allCheckoutIds.length > 0 || existingData?.checkoutFileIds !== undefined) {
              soFileUpdates.checkoutFiles = {
                set: allCheckoutIds.map((fid: string) => ({ id: fid })),
              };
            }

            if (Object.keys(soFileUpdates).length > 0) {
              await tx.serviceOrder.update({
                where: { id: soId },
                data: soFileUpdates,
              });
              this.logger.log(
                `[Task Update] Updated SO ${soId} files (upload+merge): checkin=${allCheckinIds.length}, checkout=${allCheckoutIds.length}`,
              );
            }

            soFilesProcessed.add(soId);
          }
        }

        // =====================================================================
        // SERVICE ORDER FILE UPDATES (checkin/checkout) - Independent of serviceOrders
        // This allows updating SO files without sending the full serviceOrders array,
        // which would trigger the SO deletion logic above.
        // Skips SOs already processed by the direct upload handler above.
        // =====================================================================
        if (
          (data as any).serviceOrderFiles &&
          typeof (data as any).serviceOrderFiles === 'object'
        ) {
          const serviceOrderFiles = (data as any).serviceOrderFiles as Record<
            string,
            { checkinFileIds?: string[]; checkoutFileIds?: string[] }
          >;

          for (const [serviceOrderId, fileData] of Object.entries(serviceOrderFiles)) {
            // Skip SOs already handled by direct file upload above
            if (soFilesProcessed.has(serviceOrderId)) {
              this.logger.log(
                `[Task Update] serviceOrderFiles: SO ${serviceOrderId} already processed by direct upload, skipping`,
              );
              continue;
            }

            // Verify the SO belongs to this task
            const so = await tx.serviceOrder.findFirst({
              where: { id: serviceOrderId, taskId: id },
            });
            if (!so) {
              this.logger.warn(
                `[Task Update] serviceOrderFiles: SO ${serviceOrderId} not found for task ${id}, skipping`,
              );
              continue;
            }

            const fileUpdates: any = {};

            if (fileData.checkinFileIds !== undefined) {
              // Normalize to array in case client sends object with numeric keys
              const checkinIds = Array.isArray(fileData.checkinFileIds)
                ? fileData.checkinFileIds
                : Object.values(fileData.checkinFileIds);
              fileUpdates.checkinFiles = {
                set: checkinIds.map((fid: string) => ({ id: fid })),
              };
            }
            if (fileData.checkoutFileIds !== undefined) {
              const checkoutIds = Array.isArray(fileData.checkoutFileIds)
                ? fileData.checkoutFileIds
                : Object.values(fileData.checkoutFileIds);
              fileUpdates.checkoutFiles = {
                set: checkoutIds.map((fid: string) => ({ id: fid })),
              };
            }

            if (Object.keys(fileUpdates).length > 0) {
              await tx.serviceOrder.update({
                where: { id: serviceOrderId },
                data: fileUpdates,
              });
              this.logger.log(
                `[Task Update] Updated files for SO ${serviceOrderId}: checkin=${fileData.checkinFileIds?.length ?? 'unchanged'}, checkout=${fileData.checkoutFileIds?.length ?? 'unchanged'}`,
              );
            }
          }
        }

        // =====================================================================
        // CHECKLIST AUTO-COMPLETION: photos drive the LOGISTIC checklist SOs.
        // Checkin/checkout photos live on the PRODUCTION SOs; the "Checklist
        // Entrada"/"Checklist Saída" SOs are completed (or reopened) from the
        // presence of those photos. Runs whenever SO checkin/checkout files were
        // touched in this request.
        // =====================================================================
        const checkinCheckoutFilesTouched =
          (soFileMapping && soFileMapping.length > 0) || !!(data as any).serviceOrderFiles;
        if (checkinCheckoutFilesTouched) {
          await this.syncChecklistServiceOrdersFromPhotos(tx, id, userId);
        }

        // =====================================================================
        // BIDIRECTIONAL SYNC: Task Status → Service Order Status
        // When task status changes, sync production service orders accordingly
        // =====================================================================
        if (data.status && data.status !== existingTask.status) {
          const oldTaskStatus = existingTask.status as TASK_STATUS;
          const newTaskStatus = data.status as TASK_STATUS;

          // Get service order updates needed for this task status change
          const serviceOrderUpdates = getServiceOrderUpdatesForTaskStatusChange(
            (updatedTask?.serviceOrders || []).map((so: any) => ({
              id: so.id,
              status: so.status as SERVICE_ORDER_STATUS,
              type: so.type as SERVICE_ORDER_TYPE,
              startedAt: so.startedAt,
              finishedAt: so.finishedAt,
            })),
            oldTaskStatus,
            newTaskStatus,
          );

          if (serviceOrderUpdates.length > 0) {
            this.logger.log(
              `[TASK→SO SYNC] Task ${id} status changed ${oldTaskStatus} → ${newTaskStatus}, updating ${serviceOrderUpdates.length} service orders`,
            );

            for (const update of serviceOrderUpdates) {
              const so = (updatedTask?.serviceOrders || []).find(
                (s: any) => s.id === update.serviceOrderId,
              );
              if (!so) continue;

              const updateData: any = {
                status: update.newStatus,
                statusOrder: getServiceOrderStatusOrder(update.newStatus),
              };

              // Set dates based on update flags
              if (update.setStartedAt && !so.startedAt) {
                updateData.startedAt = new Date();
                updateData.startedById = userId || null;
              }
              if (update.setFinishedAt && !so.finishedAt) {
                updateData.finishedAt = new Date();
                updateData.completedById = userId || null;
              }
              if (update.clearStartedAt) {
                updateData.startedAt = null;
                updateData.startedById = null;
              }
              if (update.clearFinishedAt) {
                updateData.finishedAt = null;
                updateData.completedById = null;
              }

              await tx.serviceOrder.update({
                where: { id: update.serviceOrderId },
                data: updateData,
              });

              // Log the sync in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.SERVICE_ORDER,
                entityId: update.serviceOrderId,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: so.status,
                newValue: update.newStatus,
                reason: update.reason,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              this.logger.log(
                `[TASK→SO SYNC] Service order ${update.serviceOrderId} (${so.description}) status: ${so.status} → ${update.newStatus}`,
              );
            }

            // Refetch task with updated service orders
            updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
              include: {
                ...include,
                customer: true,
                observation: { include: { files: true } },
                implement: true,
                serviceOrders: true,
              },
            });
          }
        }

        // =====================================================================
        // BIDIRECTIONAL SYNC: Quote Services ↔ Production Service Orders
        // When quote services or PRODUCTION service orders are added/updated,
        // sync them bidirectionally:
        // - PRODUCTION SO → Quote Service (description + observation → service description)
        // - Quote Service → PRODUCTION SO (service description → SO description + observation)
        // =====================================================================
        // CRITICAL: Only run sync if genuinely NEW services are being ADDED.
        // Services resubmitted without IDs (e.g. from form re-serialization during reorder)
        // are detected by matching their description against existing services.
        const existingQuoteDescriptions = new Set<string>(
          (existingTask.quote?.services || []).map((item: any) =>
            normalizeDescription(item.description),
          ),
        );
        const existingSODescriptions = new Set<string>(
          (existingTask.serviceOrders || [])
            .filter((so: any) => so.type === 'PRODUCTION')
            .map((so: any) => normalizeDescription(so.description)),
        );

        const hasNewServiceOrders =
          serviceOrdersData &&
          Array.isArray(serviceOrdersData) &&
          serviceOrdersData.length > 0 &&
          serviceOrdersData.some(
            (so: any) =>
              !so.id && !existingQuoteDescriptions.has(normalizeDescription(so.description)),
          );

        const hasNewQuoteItems =
          (data as any).quote?.services &&
          Array.isArray((data as any).quote.services) &&
          (data as any).quote.services.length > 0 &&
          (data as any).quote.services.some(
            (item: any) =>
              !item.id && !existingSODescriptions.has(normalizeDescription(item.description)),
          );

        if (hasNewServiceOrders || hasNewQuoteItems) {
          // Shared bidirectional sync-create (quote services ⇄ PRODUCTION SOs +
          // discount-aware recalc). Identical logic now runs in batchUpdate so a
          // bulk edit keeps both sides in sync exactly like this single edit.
          const deletedDescriptions = (data as any)._deletedServiceOrderDescriptions as
            | Set<string>
            | undefined;

          const syncPerformed = await this.syncQuoteServicesAndServiceOrders(
            tx,
            id,
            userId,
            existingTask.status as TASK_STATUS,
            deletedDescriptions,
          );

          // Refetch task if any sync action was performed so downstream tracking
          // sees the freshly-created quote services / service orders.
          if (syncPerformed) {
            updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
              include: {
                ...include,
                customer: true,
                observation: { include: { files: true } },
                implement: true,
                serviceOrders: true,
                quote: { include: { services: true } },
              },
            });

            this.logger.log(
              `[QUOTE↔SO SYNC] Task refetched after sync. Quote services: ${updatedTask?.quote?.services?.length || 0}, Service orders: ${updatedTask?.serviceOrders?.length || 0}`,
            );
          }
        }

        // Handle airbrushings explicitly - update existing and create new ones
        // The repository only handles deletions (via notIn), we handle updates/creates here
        // This prevents cascade deletion of layouts (which have onDelete: Cascade on airbrushing)
        if (airbrushingsData && Array.isArray(airbrushingsData) && airbrushingsData.length > 0) {
          this.logger.log(
            `[Task Update] Processing ${airbrushingsData.length} airbrushings for task ${id}`,
          );

          // Fetch existing airbrushings of this task for ownership validation and changelog
          const taskAirbrushings = await tx.airbrushing.findMany({
            where: { taskId: id },
          });
          const taskAirbrushingsById = new Map(taskAirbrushings.map(a => [a.id, a]));

          for (const airbrushingData of airbrushingsData) {
            // Check if this is an existing airbrushing (valid UUID) or a new one (temp ID)
            const isExisting =
              airbrushingData.id &&
              typeof airbrushingData.id === 'string' &&
              !airbrushingData.id.startsWith('airbrushing-');

            // Validar se o pintor existe antes de gravar (evita erro genérico do Prisma)
            if (airbrushingData.painterId !== undefined && airbrushingData.painterId !== null) {
              const painterExists = await tx.user.findUnique({
                where: { id: airbrushingData.painterId },
              });
              if (!painterExists) {
                throw new NotFoundException('Pintor não encontrado.');
              }
            }

            if (isExisting) {
              // Validar que a aerografia pertence à tarefa sendo atualizada
              const existingAirbrushing = taskAirbrushingsById.get(airbrushingData.id);
              if (!existingAirbrushing) {
                throw new NotFoundException('Aerografia não encontrada nesta tarefa.');
              }

              // Em cotação continua em cotação (o schema aninhado manda PREPARATION
              // por padrão); cancelar encerra as negociações. Tira painterId/price
              // do payload antes das guardas abaixo.
              const closedPainterIds = await applyQuotingToNestedAirbrushingUpdate(
                tx,
                existingAirbrushing,
                airbrushingData,
                userId ?? null,
              );
              if (closedPainterIds.length) {
                closedQuotePainters.push({
                  airbrushingId: existingAirbrushing.id,
                  painterIds: closedPainterIds,
                });
              }

              // Security (B7): payment fields are gated on the PERSISTED status —
              // mirrors AirbrushingService. A nested write through the task
              // endpoint may not change paymentStatus/painterId/price unless the
              // airbrushing is already COMPLETED in the database (the dedicated
              // /airbrushings endpoints remain the path for other edits).
              const persistedCompleted = existingAirbrushing.status === 'COMPLETED';
              if (!persistedCompleted) {
                if (
                  airbrushingData.paymentStatus !== undefined &&
                  airbrushingData.paymentStatus !== existingAirbrushing.paymentStatus
                ) {
                  throw new BadRequestException(
                    'O status de pagamento só pode ser alterado quando a aerografia estiver concluída.',
                  );
                }
                if (
                  airbrushingData.painterId !== undefined &&
                  (airbrushingData.painterId || null) !== (existingAirbrushing.painterId || null)
                ) {
                  throw new BadRequestException(
                    'O pintor só pode ser alterado através da tarefa quando a aerografia estiver concluída.',
                  );
                }
                const incomingPrice =
                  airbrushingData.price !== undefined && airbrushingData.price !== null
                    ? Number(airbrushingData.price)
                    : null;
                const persistedPrice =
                  existingAirbrushing.price !== undefined && existingAirbrushing.price !== null
                    ? Number(existingAirbrushing.price)
                    : null;
                if (incomingPrice !== persistedPrice) {
                  throw new BadRequestException(
                    'O preço só pode ser alterado através da tarefa quando a aerografia estiver concluída.',
                  );
                }
              }
              // Un-completing a paid airbrushing is blocked (mirror of
              // AirbrushingService.validateAirbrushing).
              const targetAirbrushingStatus =
                airbrushingData.status || AIRBRUSHING_STATUS.PREPARATION;
              const targetPaymentStatus =
                airbrushingData.paymentStatus !== undefined
                  ? airbrushingData.paymentStatus
                  : existingAirbrushing.paymentStatus;
              if (targetPaymentStatus !== 'PENDING' && targetAirbrushingStatus !== 'COMPLETED') {
                throw new BadRequestException(
                  'O status de pagamento só pode ser alterado quando a aerografia estiver concluída.',
                );
              }

              // UPDATE existing airbrushing - preserves layouts (no deletion)
              this.logger.log(`[Task Update] Updating existing airbrushing ${airbrushingData.id}`);

              // statusOrder must be re-stamped with the status: it drives the airbrushing
              // list's default sort, and these raw tx.airbrushing writes bypass the
              // repository that normally derives it.
              const airbrushingStatus = airbrushingData.status || AIRBRUSHING_STATUS.PREPARATION;
              const updatePayload: any = {
                status: airbrushingStatus,
                statusOrder: getAirbrushingStatusOrder(airbrushingStatus),
                price:
                  airbrushingData.price !== undefined && airbrushingData.price !== null
                    ? Number(airbrushingData.price)
                    : null,
                startDate: airbrushingData.startDate || null,
                finishDate: airbrushingData.finishDate || null,
              };

              // Tempo de execução: o término previsto é DERIVADO dele (início +
              // tempo), como no AirbrushingService. Sem tempo, vale o finishDate
              // enviado, como sempre.
              if (airbrushingData.executionTime !== undefined) {
                updatePayload.executionTime = airbrushingData.executionTime ?? null;
              }
              if (airbrushingData.executionTimeUnit !== undefined) {
                updatePayload.executionTimeUnit = airbrushingData.executionTimeUnit ?? null;
              }
              {
                const time =
                  updatePayload.executionTime !== undefined
                    ? updatePayload.executionTime
                    : (existingAirbrushing as any).executionTime;
                const unit =
                  updatePayload.executionTimeUnit !== undefined
                    ? updatePayload.executionTimeUnit
                    : (existingAirbrushing as any).executionTimeUnit;
                if (time != null && unit != null) {
                  updatePayload.finishDate = computeExpectedFinishDate(
                    updatePayload.startDate,
                    time,
                    unit,
                  );
                }
              }
              // Orçamento de abertura: só enquanto a aerografia está em cotação.
              if (airbrushingStatus === AIRBRUSHING_STATUS.QUOTING) {
                for (const key of [
                  'quotationOfferAmount',
                  'quotationOfferExecutionTime',
                  'quotationOfferExecutionTimeUnit',
                ] as const) {
                  if (airbrushingData[key] !== undefined) {
                    updatePayload[key] = airbrushingData[key] ?? null;
                  }
                }
              }

              if (airbrushingData.description !== undefined) {
                updatePayload.description = airbrushingData.description || null;
              }

              if (airbrushingData.startedAt !== undefined) {
                updatePayload.startedAt = airbrushingData.startedAt || null;
              }

              if (airbrushingData.finishedAt !== undefined) {
                updatePayload.finishedAt = airbrushingData.finishedAt || null;
              }

              // Handle painter (User ID)
              if (airbrushingData.painterId !== undefined) {
                updatePayload.painterId = airbrushingData.painterId || null;
              }

              if (airbrushingData.paymentStatus !== undefined) {
                updatePayload.paymentStatus = airbrushingData.paymentStatus;
              }

              // Handle receipts / invoices (File IDs).
              //
              // An EMPTY array is deliberately treated as "no change", not "clear", on this
              // path only. The task form's airbrushing section is layout-only — it renders no
              // receipt/invoice control — so it can never express the intent "remove every
              // receipt". An empty array arriving here therefore always means the client
              // failed to round-trip the existing ids, and honouring it as `set: []` silently
              // detached every attached receipt/invoice on an unrelated task edit.
              // Genuine clearing goes through AirbrushingService.reconcileFileRelations,
              // which gates it behind an explicit intent flag.
              // NOTE: layouts below intentionally KEEP their clear-on-empty behaviour — the
              // task form does render layouts, so removing the last one is real intent.
              if (airbrushingData.receiptIds !== undefined) {
                if (airbrushingData.receiptIds.length > 0) {
                  updatePayload.receipts = {
                    set: airbrushingData.receiptIds.map((fid: string) => ({ id: fid })),
                  };
                } else {
                  this.logger.warn(
                    `[Task Update] Ignoring empty receiptIds for airbrushing ${airbrushingData.id} — the task form cannot clear receipts; leaving the relation untouched.`,
                  );
                }
              }

              if (airbrushingData.invoiceIds !== undefined) {
                if (airbrushingData.invoiceIds.length > 0) {
                  updatePayload.invoices = {
                    set: airbrushingData.invoiceIds.map((fid: string) => ({ id: fid })),
                  };
                } else {
                  this.logger.warn(
                    `[Task Update] Ignoring empty invoiceIds for airbrushing ${airbrushingData.id} — the task form cannot clear invoices; leaving the relation untouched.`,
                  );
                }
              }

              // Handle layouts (File IDs -> Layout entity IDs)
              // CRITICAL: This must be handled here to preserve layouts when no file uploads occur
              if (airbrushingData.layoutIds !== undefined) {
                // A arte da aerografia é da AEROGRAFIA: uma linha de `Layout` por
                // (aerografia, arquivo). Tirar uma arte é APAGAR a linha dela — o
                // arquivo fica. "Desconectar" deixaria a linha sem dono, e o CHECK
                // "Layout_one_owner_check" (M3) recusa.
                const keep = await this.airbrushingLayoutIds(
                  airbrushingData.layoutIds,
                  airbrushingData.id,
                  tx,
                );
                const removed = await tx.layout.deleteMany({
                  where: { airbrushingId: airbrushingData.id, id: { notIn: keep } },
                });
                if (keep.length === 0 && removed.count > 0) {
                  // Clearing IS legitimate here (the task form renders the layout
                  // uploader), but this path writes raw Prisma, bypassing
                  // AirbrushingService.reconcileFileRelations — so nothing else would
                  // record the loss. ERROR so a wipe caused by a stale/unhydrated
                  // client snapshot is greppable after the fact.
                  this.logger.error(
                    `[Task Update] DETACHING FILES from airbrushing ${airbrushingData.id}: ` +
                      `layoutIds=${removed.count}→0. This is only correct if the user actually removed ` +
                      `those layouts; if it fired on a save that never touched them, the client sent ` +
                      `a stale/unhydrated snapshot (see mapFieldValueToItem in multi-airbrushing-selector).`,
                  );
                } else {
                  this.logger.log(
                    `[Task Update] Airbrushing ${airbrushingData.id}: ${keep.length} layout(s), ${removed.count} removed`,
                  );
                }
              }

              // Este caminho nunca carimbou finishedAt: concluir uma aerografia
              // pelo formulário da tarefa deixava a aerografia COMPLETED sem
              // data de término. Sem término não há competência para a NFS-e —
              // ela cairia na data PREVISTA, que é outra coisa.
              if (
                updatePayload.status === AIRBRUSHING_STATUS.COMPLETED &&
                existingAirbrushing?.status !== AIRBRUSHING_STATUS.COMPLETED
              ) {
                if (!existingAirbrushing?.finishedAt && updatePayload.finishedAt === undefined) {
                  updatePayload.finishedAt = new Date();
                }
                if (!existingAirbrushing?.startedAt && updatePayload.startedAt === undefined) {
                  updatePayload.startedAt = new Date();
                }
              }

              // Vencimento: este caminho também nunca chamava applyDueDate. Como
              // acabou de carimbar `finishedAt`, ele MUDOU a referência do
              // cálculo — e sem recalcular o vencimento ficava congelado na data
              // PREVISTA, que é justamente o que a regra "N dias após o término"
              // não quer dizer. Contas a Pagar lê essa coluna.
              //
              // Regra FIXED_DATE nunca é recalculada: é valor do usuário, não
              // função do término. Mesma fonte usada pelo AirbrushingService.
              const dueRule =
                updatePayload.dueDateRule ??
                existingAirbrushing?.dueDateRule ??
                AIRBRUSHING_DUE_DATE_RULE.DAYS_AFTER_FINISH;
              if (dueRule !== AIRBRUSHING_DUE_DATE_RULE.FIXED_DATE) {
                const finishReference =
                  (updatePayload.finishedAt as Date | undefined) ??
                  existingAirbrushing?.finishedAt ??
                  (updatePayload.finishDate as Date | undefined) ??
                  existingAirbrushing?.finishDate ??
                  null;

                updatePayload.dueDate = resolveAirbrushingDueDate(
                  {
                    dueDateRule: dueRule,
                    paymentTermDays:
                      updatePayload.paymentTermDays ?? existingAirbrushing?.paymentTermDays ?? null,
                    dueDayOfMonth:
                      updatePayload.dueDayOfMonth ?? existingAirbrushing?.dueDayOfMonth ?? null,
                    dueDate: updatePayload.dueDate ?? existingAirbrushing?.dueDate ?? null,
                  },
                  finishReference,
                );
              }

              const updatedAirbrushing = await tx.airbrushing.update({
                where: { id: airbrushingData.id },
                data: updatePayload,
              });

              // NFS-e do aerografista — conclusão pelo formulário da tarefa.
              if (updatedAirbrushing.status === AIRBRUSHING_STATUS.COMPLETED) {
                await this.painterNfseService.registerIntent(tx, {
                  airbrushingId: updatedAirbrushing.id,
                  painterId: updatedAirbrushing.painterId,
                  resetFailed: existingAirbrushing?.status !== AIRBRUSHING_STATUS.COMPLETED,
                });
                // A emissão em si é pós-commit — ver o flush no fim de update().
                completedAirbrushingIds.push(updatedAirbrushing.id);
              }

              // Notificação do pintor: o formulário da tarefa é onde a aerografia
              // costuma ganhar um responsável.
              this.airbrushingNotifier.registerIntent(airbrushingNotifyIntents, {
                airbrushingId: updatedAirbrushing.id,
                actorUserId: userId,
                previous: {
                  painterId: existingAirbrushing?.painterId,
                  paymentStatus: existingAirbrushing?.paymentStatus,
                  status: existingAirbrushing?.status,
                },
                next: {
                  painterId: updatedAirbrushing.painterId,
                  paymentStatus: updatedAirbrushing.paymentStatus,
                  status: updatedAirbrushing.status,
                },
              });

              // Registrar mudanças no changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.AIRBRUSHING,
                entityId: airbrushingData.id,
                action: CHANGE_ACTION.UPDATE,
                field: null,
                oldValue: existingAirbrushing,
                newValue: updatedAirbrushing,
                reason: 'Aerografia atualizada através da tarefa',
                triggeredBy: CHANGE_TRIGGERED_BY.TASK_UPDATE,
                triggeredById: id,
                userId: userId || null,
                transaction: tx,
              });

              this.logger.log(`[Task Update] Updated airbrushing ${airbrushingData.id}`);
            } else {
              // CREATE new airbrushing
              this.logger.log(`[Task Update] Creating new airbrushing for task ${id}`);

              // Security (B7): a brand-new airbrushing can never start with a
              // non-PENDING payment status (it cannot be persisted-COMPLETED yet).
              if (
                airbrushingData.paymentStatus !== undefined &&
                airbrushingData.paymentStatus !== null &&
                airbrushingData.paymentStatus !== 'PENDING'
              ) {
                throw new BadRequestException(
                  'O status de pagamento só pode ser definido após a conclusão da aerografia.',
                );
              }

              // Sem aerografista, nasce em cotação — sem valor e sem aerografista.
              const newAirbrushingStatus = resolveNewAirbrushingStatus(
                airbrushingData.status,
                airbrushingData.painterId,
              );
              const newIsQuoting = newAirbrushingStatus === AIRBRUSHING_STATUS.QUOTING;
              const newAirbrushing = await tx.airbrushing.create({
                data: {
                  taskId: id,
                  status: newAirbrushingStatus,
                  // See the update branch: statusOrder is not defaulted per-status by Prisma.
                  statusOrder: getAirbrushingStatusOrder(newAirbrushingStatus),
                  quotationOpenedAt: newIsQuoting ? new Date() : null,
                  price:
                    !newIsQuoting &&
                    airbrushingData.price !== undefined &&
                    airbrushingData.price !== null
                      ? Number(airbrushingData.price)
                      : null,
                  description: airbrushingData.description || null,
                  startDate: airbrushingData.startDate || null,
                  // Término previsto derivado do tempo de execução, quando há.
                  finishDate:
                    computeExpectedFinishDate(
                      airbrushingData.startDate,
                      airbrushingData.executionTime,
                      airbrushingData.executionTimeUnit,
                    ) ??
                    (airbrushingData.finishDate || null),
                  executionTime: airbrushingData.executionTime ?? null,
                  executionTimeUnit: airbrushingData.executionTimeUnit ?? null,
                  quotationOfferAmount: newIsQuoting
                    ? (airbrushingData.quotationOfferAmount ?? null)
                    : null,
                  quotationOfferExecutionTime: newIsQuoting
                    ? (airbrushingData.quotationOfferExecutionTime ?? null)
                    : null,
                  quotationOfferExecutionTimeUnit: newIsQuoting
                    ? (airbrushingData.quotationOfferExecutionTimeUnit ?? null)
                    : null,
                  startedAt: airbrushingData.startedAt || null,
                  finishedAt: airbrushingData.finishedAt || null,
                  paymentStatus: airbrushingData.paymentStatus || 'PENDING',
                  painterId: airbrushingData.painterId || null,
                  receipts:
                    airbrushingData.receiptIds && airbrushingData.receiptIds.length > 0
                      ? { connect: airbrushingData.receiptIds.map((fid: string) => ({ id: fid })) }
                      : undefined,
                  invoices:
                    airbrushingData.invoiceIds && airbrushingData.invoiceIds.length > 0
                      ? { connect: airbrushingData.invoiceIds.map((fid: string) => ({ id: fid })) }
                      : undefined,
                },
              });

              // NFS-e do aerografista — o formulário permite nascer concluída.
              if (newAirbrushing.status === AIRBRUSHING_STATUS.COMPLETED) {
                await this.painterNfseService.registerIntent(tx, {
                  airbrushingId: newAirbrushing.id,
                  painterId: newAirbrushing.painterId,
                  resetFailed: true,
                });
                // A emissão em si é pós-commit — ver o flush no fim de update().
                completedAirbrushingIds.push(newAirbrushing.id);
              }

              // Notificação do pintor: nascer com pintor designado é atribuição.
              this.airbrushingNotifier.registerIntent(airbrushingNotifyIntents, {
                airbrushingId: newAirbrushing.id,
                actorUserId: userId,
                previous: null,
                next: {
                  painterId: newAirbrushing.painterId,
                  paymentStatus: newAirbrushing.paymentStatus,
                  status: newAirbrushing.status,
                },
              });

              // Registrar criação no changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.AIRBRUSHING,
                entityId: newAirbrushing.id,
                action: CHANGE_ACTION.CREATE,
                field: null,
                oldValue: null,
                newValue: newAirbrushing,
                reason: 'Aerografia criada através da tarefa',
                triggeredBy: CHANGE_TRIGGERED_BY.TASK_UPDATE,
                triggeredById: id,
                userId: userId || null,
                transaction: tx,
              });

              this.logger.log(`[Task Update] Created airbrushing ${newAirbrushing.id}`);
            }
          }

          // Refetch task with updated airbrushings for file processing
          updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
            include: {
              ...include,
              customer: true,
              observation: { include: { files: true } },
              implement: true,
              serviceOrders: true,
              airbrushings: true,
            },
          });

          this.logger.log(
            `[Task Update] After airbrushings refetch, task has ${updatedTask?.airbrushings?.length || 0} airbrushings`,
          );
        }

        // Process and save files WITHIN the transaction
        // This ensures files are only created if the task update succeeds
        if (files) {
          const fileUpdates: any = {};
          const customerName =
            updatedTask.customer?.fantasyName || existingTask.customer?.fantasyName;

          this.logger.log(
            `[Task Update] Processing files with customer name: "${customerName}" (from updatedTask: ${!!updatedTask.customer?.fantasyName}, from existingTask: ${!!existingTask.customer?.fantasyName})`,
          );

          // Budget files (multiple)
          // Process if new files are being uploaded OR if budgetIds is explicitly provided (for deletions)
          if ((files?.budgets && files.budgets.length > 0) || data.budgetIds !== undefined) {
            // Start with the budgetIds provided in the form data (files that should be kept)
            // If not provided, default to empty array (will only have the new uploads)
            let budgetIds: string[] = data.budgetIds ? [...data.budgetIds] : [];

            // SAFEGUARD: If new files are being uploaded but budgetIds was NOT sent,
            // merge with existing budgets to prevent accidental removal
            if (data.budgetIds === undefined && files?.budgets && files.budgets.length > 0) {
              const currentTask = await tx.task.findUnique({
                where: { id },
                include: { budgets: { select: { id: true } } },
              });
              if (currentTask?.budgets?.length) {
                budgetIds = currentTask.budgets.map(f => f.id);
                this.logger.log(
                  `[Task Update] 🛡️ SAFEGUARD: budgetIds not sent but new files uploaded. Preserved ${budgetIds.length} existing budgets.`,
                );
              }
            }

            // Upload new files and add their IDs
            if (files.budgets && files.budgets.length > 0) {
              for (const budgetFile of files.budgets) {
                const budgetRecord = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  budgetFile,
                  'taskBudgets',
                  userId,
                  {
                    entityId: id,
                    entityType: 'TASK',
                    customerName,
                  },
                );
                budgetIds.push(budgetRecord.id);
              }
            }

            // CRITICAL FIX: Use 'set' instead of 'connect' to REPLACE files instead of adding to them
            fileUpdates.budgets = { set: budgetIds.map(id => ({ id })) };
            this.logger.log(
              `[Task Update] Setting budgets to ${budgetIds.length} files (${data.budgetIds?.length || 0} existing + ${files.budgets?.length || 0} new)`,
            );
          }

          // Invoice files (multiple)
          // Process if new files are being uploaded OR if invoiceIds is explicitly provided (for deletions)
          if ((files?.invoices && files.invoices.length > 0) || data.invoiceIds !== undefined) {
            // Start with the invoiceIds provided in the form data (files that should be kept)
            // If not provided, default to empty array (will only have the new uploads)
            let invoiceIds: string[] = data.invoiceIds ? [...data.invoiceIds] : [];

            // SAFEGUARD: If new files are being uploaded but invoiceIds was NOT sent,
            // merge with existing invoices to prevent accidental removal
            if (data.invoiceIds === undefined && files?.invoices && files.invoices.length > 0) {
              const currentTask = await tx.task.findUnique({
                where: { id },
                include: { invoices: { select: { id: true } } },
              });
              if (currentTask?.invoices?.length) {
                invoiceIds = currentTask.invoices.map(f => f.id);
                this.logger.log(
                  `[Task Update] 🛡️ SAFEGUARD: invoiceIds not sent but new files uploaded. Preserved ${invoiceIds.length} existing invoices.`,
                );
              }
            }

            // Upload new files and add their IDs
            if (files.invoices && files.invoices.length > 0) {
              for (const invoiceFile of files.invoices) {
                const invoiceRecord = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  invoiceFile,
                  'taskInvoices',
                  userId,
                  {
                    entityId: id,
                    entityType: 'TASK',
                    customerName,
                  },
                );
                invoiceIds.push(invoiceRecord.id);
              }
            }

            // CRITICAL FIX: Use 'set' instead of 'connect' to REPLACE files instead of adding to them
            fileUpdates.invoices = { set: invoiceIds.map(id => ({ id })) };
            this.logger.log(
              `[Task Update] Setting invoices to ${invoiceIds.length} files (${data.invoiceIds?.length || 0} existing + ${files.invoices?.length || 0} new)`,
            );
          }

          // Receipt files (multiple)
          // Process if new files are being uploaded OR if receiptIds is explicitly provided (for deletions)
          if ((files?.receipts && files.receipts.length > 0) || data.receiptIds !== undefined) {
            // Start with the receiptIds provided in the form data (files that should be kept)
            // If not provided, default to empty array (will only have the new uploads)
            let receiptIds: string[] = data.receiptIds ? [...data.receiptIds] : [];

            // SAFEGUARD: If new files are being uploaded but receiptIds was NOT sent,
            // merge with existing receipts to prevent accidental removal
            if (data.receiptIds === undefined && files?.receipts && files.receipts.length > 0) {
              const currentTask = await tx.task.findUnique({
                where: { id },
                include: { receipts: { select: { id: true } } },
              });
              if (currentTask?.receipts?.length) {
                receiptIds = currentTask.receipts.map(f => f.id);
                this.logger.log(
                  `[Task Update] 🛡️ SAFEGUARD: receiptIds not sent but new files uploaded. Preserved ${receiptIds.length} existing receipts.`,
                );
              }
            }

            // Upload new files and add their IDs
            if (files.receipts && files.receipts.length > 0) {
              for (const receiptFile of files.receipts) {
                const receiptRecord = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  receiptFile,
                  'taskReceipts',
                  userId,
                  {
                    entityId: id,
                    entityType: 'TASK',
                    customerName,
                  },
                );
                receiptIds.push(receiptRecord.id);
              }
            }

            // CRITICAL FIX: Use 'set' instead of 'connect' to REPLACE files instead of adding to them
            fileUpdates.receipts = { set: receiptIds.map(id => ({ id })) };
            this.logger.log(
              `[Task Update] Setting receipts to ${receiptIds.length} files (${data.receiptIds?.length || 0} existing + ${files.receipts?.length || 0} new)`,
            );
          }

          // Bank slip files (multiple)
          if ((files?.bankSlips && files.bankSlips.length > 0) || data.bankSlipIds !== undefined) {
            let bankSlipIds: string[] = data.bankSlipIds ? [...data.bankSlipIds] : [];

            // SAFEGUARD: If new files are being uploaded but bankSlipIds was NOT sent,
            // merge with existing bank slips to prevent accidental removal
            if (data.bankSlipIds === undefined && files?.bankSlips && files.bankSlips.length > 0) {
              const currentTask = await tx.task.findUnique({
                where: { id },
                include: { bankSlips: { select: { id: true } } },
              });
              if (currentTask?.bankSlips?.length) {
                bankSlipIds = currentTask.bankSlips.map(f => f.id);
                this.logger.log(
                  `[Task Update] 🛡️ SAFEGUARD: bankSlipIds not sent but new files uploaded. Preserved ${bankSlipIds.length} existing bank slips.`,
                );
              }
            }

            if (files.bankSlips && files.bankSlips.length > 0) {
              for (const bankSlipFile of files.bankSlips) {
                const bankSlipRecord = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  bankSlipFile,
                  'taskBankSlips',
                  userId,
                  {
                    entityId: id,
                    entityType: 'TASK',
                    customerName,
                  },
                );
                bankSlipIds.push(bankSlipRecord.id);
              }
            }

            fileUpdates.bankSlips = { set: bankSlipIds.map(id => ({ id })) };
            this.logger.log(
              `[Task Update] Setting bankSlips to ${bankSlipIds.length} files (${data.bankSlipIds?.length || 0} existing + ${files.bankSlips?.length || 0} new)`,
            );
          }

          // Base files (files used as base for layout design)
          // Process if new files are being uploaded OR if baseFileIds is explicitly provided (for deletions)
          if ((files?.baseFiles && files.baseFiles.length > 0) || data.baseFileIds !== undefined) {
            // Start with the baseFileIds provided in the form data (files that should be kept)
            // If not provided, default to empty array (will only have the new uploads)
            let baseFileIds: string[] = data.baseFileIds ? [...data.baseFileIds] : [];

            // SAFEGUARD: If new files are being uploaded but baseFileIds was NOT sent,
            // merge with existing base files to prevent accidental removal
            if (data.baseFileIds === undefined && files?.baseFiles && files.baseFiles.length > 0) {
              const currentTask = await tx.task.findUnique({
                where: { id },
                include: { baseFiles: { select: { id: true } } },
              });
              if (currentTask?.baseFiles?.length) {
                baseFileIds = currentTask.baseFiles.map(f => f.id);
                this.logger.log(
                  `[Task Update] 🛡️ SAFEGUARD: baseFileIds not sent but new files uploaded. Preserved ${baseFileIds.length} existing base files.`,
                );
              }
            }

            this.logger.log(
              `[Task Update] Processing baseFiles - Received ${data.baseFileIds?.length || 0} existing IDs: [${data.baseFileIds?.join(', ') || 'none'}]`,
            );

            // Upload new files and add their IDs
            // Files are renamed to match task name with measures format
            if (files.baseFiles && files.baseFiles.length > 0) {
              this.logger.log(`[Task Update] Uploading ${files.baseFiles.length} new base files`);

              // Get task name for file renaming (use updated name if provided, otherwise existing)
              const taskNameForFile = data.name || existingTask.name || 'Tarefa';

              for (let i = 0; i < files.baseFiles.length; i++) {
                const baseFile = files.baseFiles[i];

                // Generate new filename with task name and measures
                // Pass file index (1-based) to add suffix for multiple files
                const newFilename = generateBaseFileName(
                  taskNameForFile,
                  existingTask, // existingTask has the implement with its measures
                  baseFile.originalname,
                  i + 1, // 1-based index for file numbering
                );

                this.logger.log(
                  `[Task Update] Renaming base file from "${baseFile.originalname}" to "${newFilename}"`,
                );

                // Update the file's originalname before upload
                baseFile.originalname = newFilename;

                const baseFileRecord = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  baseFile,
                  'taskBaseFiles',
                  userId,
                  {
                    entityId: id,
                    entityType: 'TASK',
                    customerName,
                  },
                );
                this.logger.log(
                  `[Task Update] Created new base file with ID: ${baseFileRecord.id}`,
                );
                baseFileIds.push(baseFileRecord.id);
              }
            }

            // Use 'set' instead of 'connect' to REPLACE files instead of adding to them
            this.logger.log(
              `[Task Update] Final baseFileIds array (${baseFileIds.length} total): [${baseFileIds.join(', ')}]`,
            );
            fileUpdates.baseFiles = { set: baseFileIds.map(id => ({ id })) };
            this.logger.log(
              `[Task Update] Setting baseFiles to ${baseFileIds.length} files (${data.baseFileIds?.length || 0} existing + ${files.baseFiles?.length || 0} new)`,
            );
          }

          // Project files
          if (
            (files?.projectFiles && files.projectFiles.length > 0) ||
            (data as any).projectFileIds !== undefined
          ) {
            let projectFileIds: string[] = (data as any).projectFileIds
              ? [...(data as any).projectFileIds]
              : [];

            // SAFEGUARD: If new files are being uploaded but projectFileIds was NOT sent,
            // merge with existing project files to prevent accidental removal
            if (
              (data as any).projectFileIds === undefined &&
              files?.projectFiles &&
              files.projectFiles.length > 0
            ) {
              const currentTask = await tx.task.findUnique({
                where: { id },
                include: { projectFiles: { select: { id: true } } },
              });
              if (currentTask?.projectFiles?.length) {
                projectFileIds = currentTask.projectFiles.map(f => f.id);
                this.logger.log(
                  `[Task Update] 🛡️ SAFEGUARD: projectFileIds not sent but new files uploaded. Preserved ${projectFileIds.length} existing project files.`,
                );
              }
            }

            if (files.projectFiles && files.projectFiles.length > 0) {
              for (const projectFile of files.projectFiles) {
                const projectFileRecord = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  projectFile,
                  'taskProjectFiles',
                  userId,
                  {
                    entityId: id,
                    entityType: 'TASK',
                    customerName,
                  },
                );
                projectFileIds.push(projectFileRecord.id);
              }
            }

            fileUpdates.projectFiles = { set: projectFileIds.map(id => ({ id })) };
            this.logger.log(`[Task Update] Setting projectFiles to ${projectFileIds.length} files`);
          }

          // Checkin files
          if (
            (files?.checkinFiles && files.checkinFiles.length > 0) ||
            (data as any).checkinFileIds !== undefined
          ) {
            let checkinFileIds: string[] = (data as any).checkinFileIds
              ? [...(data as any).checkinFileIds]
              : [];

            // SAFEGUARD: If new files are being uploaded but checkinFileIds was NOT sent,
            // merge with existing checkin files to prevent accidental removal
            if (
              (data as any).checkinFileIds === undefined &&
              files?.checkinFiles &&
              files.checkinFiles.length > 0
            ) {
              const currentTask = await tx.task.findUnique({
                where: { id },
                include: { checkinFiles: { select: { id: true } } },
              });
              if (currentTask?.checkinFiles?.length) {
                checkinFileIds = currentTask.checkinFiles.map(f => f.id);
                this.logger.log(
                  `[Task Update] 🛡️ SAFEGUARD: checkinFileIds not sent but new files uploaded. Preserved ${checkinFileIds.length} existing checkin files.`,
                );
              }
            }

            if (files.checkinFiles && files.checkinFiles.length > 0) {
              for (const checkinFile of files.checkinFiles) {
                const checkinFileRecord = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  checkinFile,
                  'taskCheckinFiles',
                  userId,
                  {
                    entityId: id,
                    entityType: 'TASK',
                    customerName,
                  },
                );
                checkinFileIds.push(checkinFileRecord.id);
              }
            }

            fileUpdates.checkinFiles = { set: checkinFileIds.map(id => ({ id })) };
            this.logger.log(`[Task Update] Setting checkinFiles to ${checkinFileIds.length} files`);
          }

          // Checkout files
          if (
            (files?.checkoutFiles && files.checkoutFiles.length > 0) ||
            (data as any).checkoutFileIds !== undefined
          ) {
            let checkoutFileIds: string[] = (data as any).checkoutFileIds
              ? [...(data as any).checkoutFileIds]
              : [];

            // SAFEGUARD: If new files are being uploaded but checkoutFileIds was NOT sent,
            // merge with existing checkout files to prevent accidental removal
            if (
              (data as any).checkoutFileIds === undefined &&
              files?.checkoutFiles &&
              files.checkoutFiles.length > 0
            ) {
              const currentTask = await tx.task.findUnique({
                where: { id },
                include: { checkoutFiles: { select: { id: true } } },
              });
              if (currentTask?.checkoutFiles?.length) {
                checkoutFileIds = currentTask.checkoutFiles.map(f => f.id);
                this.logger.log(
                  `[Task Update] 🛡️ SAFEGUARD: checkoutFileIds not sent but new files uploaded. Preserved ${checkoutFileIds.length} existing checkout files.`,
                );
              }
            }

            if (files.checkoutFiles && files.checkoutFiles.length > 0) {
              for (const checkoutFile of files.checkoutFiles) {
                const checkoutFileRecord = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  checkoutFile,
                  'taskCheckoutFiles',
                  userId,
                  {
                    entityId: id,
                    entityType: 'TASK',
                    customerName,
                  },
                );
                checkoutFileIds.push(checkoutFileRecord.id);
              }
            }

            fileUpdates.checkoutFiles = { set: checkoutFileIds.map(id => ({ id })) };
            this.logger.log(
              `[Task Update] Setting checkoutFiles to ${checkoutFileIds.length} files`,
            );
          }

          // Logo paints (paintIds) - no file upload, just relation management
          if (data.paintIds !== undefined) {
            fileUpdates.logoPaints = { set: data.paintIds.map(id => ({ id })) };
            this.logger.log(`[Task Update] Setting logo paints to ${data.paintIds.length} paints`);
          }

          // Airbrushing files - process files for each airbrushing
          const airbrushingFileFields = Object.keys(files).filter(key =>
            key.startsWith('airbrushings['),
          );
          if (airbrushingFileFields.length > 0 && updatedTask?.airbrushings) {
            console.log(
              '[TaskService.update] Processing airbrushing files:',
              airbrushingFileFields.length,
              'fields',
            );

            for (const fieldName of airbrushingFileFields) {
              // Parse field name: airbrushings[0].receipts -> index: 0, type: receipts
              const match = fieldName.match(/airbrushings\[(\d+)\]\.(receipts|invoices|layouts)/);
              if (!match) continue;

              const index = parseInt(match[1], 10);
              const fileType = match[2] as 'receipts' | 'invoices' | 'layouts';
              const airbrushingFiles = (files as any)[fieldName] as Express.Multer.File[];

              if (!airbrushingFiles || airbrushingFiles.length === 0) continue;
              if (!updatedTask.airbrushings[index]) {
                console.warn(`[TaskService.update] Airbrushing at index ${index} not found`);
                continue;
              }

              const airbrushing = updatedTask.airbrushings[index];
              console.log(
                `[TaskService.update] Processing ${airbrushingFiles.length} ${fileType} for airbrushing ${index} (ID: ${airbrushing.id})`,
              );

              // Get existing file/layout IDs from the form data for this airbrushing
              const airbrushingData = (data as any).airbrushings?.[index];
              const fileIdKey = `${fileType === 'invoices' ? 'invoiceIds' : fileType === 'receipts' ? 'receiptIds' : 'layoutIds'}`;
              const existingFileIds = airbrushingData?.[fileIdKey] || [];

              // Special handling for layouts (need Layout entities, not File entities)
              if (fileType === 'layouts') {
                // Start with empty array for Layout entity IDs
                const layoutEntityIds: string[] = [];

                // Step 1: Convert existing File IDs to Layout entity IDs
                if (existingFileIds && existingFileIds.length > 0) {
                  console.log(
                    `[TaskService.update] Converting ${existingFileIds.length} File IDs to Layout entity IDs for airbrushing ${airbrushing.id}`,
                  );
                  layoutEntityIds.push(
                    ...(await this.airbrushingLayoutIds(existingFileIds, airbrushing.id, tx)),
                  );
                }

                // Step 2: Upload new layout files and create Layout entities
                for (const file of airbrushingFiles) {
                  // Create File entity
                  const fileRecord = await this.fileService.createFromUploadWithTransaction(
                    tx,
                    file,
                    'airbrushingLayouts',
                    userId,
                    {
                      entityId: airbrushing.id,
                      entityType: 'AIRBRUSHING',
                      customerName,
                    },
                  );
                  // A linha de arte da aerografia (rascunho)
                  layoutEntityIds.push(
                    ...(await this.airbrushingLayoutIds([fileRecord.id], airbrushing.id, tx)),
                  );
                }

                // As artes que ficam são estas; as demais linhas da aerografia saem
                // (apagar a linha tira a arte; o arquivo fica — ver `airbrushingLayoutIds`).
                if (layoutEntityIds.length > 0) {
                  await tx.layout.deleteMany({
                    where: { airbrushingId: airbrushing.id, id: { notIn: layoutEntityIds } },
                  });
                  console.log(
                    `[TaskService.update] Kept ${layoutEntityIds.length} Layout entities for airbrushing ${airbrushing.id} (${existingFileIds.length} existing + ${airbrushingFiles.length} new)`,
                  );
                }
              } else {
                // For receipts and invoices, handle as before (File entities only)
                const fileIds: string[] = [...existingFileIds];

                // Upload new files and add their IDs
                for (const file of airbrushingFiles) {
                  const fileRecord = await this.fileService.createFromUploadWithTransaction(
                    tx,
                    file,
                    `airbrushing${fileType.charAt(0).toUpperCase() + fileType.slice(1)}` as any,
                    userId,
                    {
                      entityId: airbrushing.id,
                      entityType: 'AIRBRUSHING',
                      customerName,
                    },
                  );
                  fileIds.push(fileRecord.id);
                }

                // CRITICAL FIX: Use 'set' instead of 'connect' to REPLACE files instead of adding to them
                if (fileIds.length > 0) {
                  await tx.airbrushing.update({
                    where: { id: airbrushing.id },
                    data: {
                      [fileType]: { set: fileIds.map(id => ({ id })) },
                    },
                  });
                  console.log(
                    `[TaskService.update] Set ${fileIds.length} ${fileType} for airbrushing ${airbrushing.id} (${existingFileIds.length} existing + ${airbrushingFiles.length} new)`,
                  );
                }
              }
            }
          }

          // NOTE: Observation files are processed BEFORE the first task update
          // (see lines 462-501) to avoid Prisma errors with temporary file IDs

          // Update task with file IDs if any files were uploaded
          if (Object.keys(fileUpdates).length > 0) {
            await tx.task.update({
              where: { id },
              data: fileUpdates,
            });
            // Refetch through repository to get consistent includes (DEFAULT_TASK_INCLUDE)
            // This prevents false changelog entries for fields like responsibles
            updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
              include: {
                ...include,
                customer: true,
                baseFiles: true,
                logoPaints: true,
                observation: { include: { files: true } },
                implement: true,
                serviceOrders: true,
              },
            });
          }
        }

        // Track individual field changes
        const fieldsToTrack = [
          'status',
          'startedAt',
          'finishedAt',
          'bonification',
          'customerId',
          'sectorId',
          'paintId',
          'paintIds', // Logo paints (file array)
          'details',
          'name',
          'term',
          'entryDate',
          'forecastDate',
          'responsibles',
          'bonusDiscountId',
          'observation',
          'baseFileIds', // Base files (file array)
          'budgetIds', // Budget documents (file array)
          'invoiceIds', // Invoice documents (file array)
          'receiptIds', // Receipt documents (file array)
          'bankSlipIds', // Bank slip documents (file array)
          // statusOrder removed - it's auto-calculated from status, creating redundant changelog entries
          'createdById',
          // Note: chassisNumber and plate are on the Implement entity, not Task
          // Note: quoteId is handled separately below with enriched data
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TASK,
          entityId: id,
          oldEntity: existingTask,
          newEntity: updatedTask,
          fieldsToTrack,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // A SÉRIE (DD1, W2) mora no implemento: a lista acima compara colunas da
        // tarefa e não a enxerga. A trilha continua TASK/serialNumber (S-5 — é o
        // que o aditivo da assinatura e o histórico leem). O valor novo vem do
        // banco: o `updatedTask` muda de forma conforme o ramo que o recarregou.
        {
          const oldSerial = existingTask.implement?.serialNumber ?? null;
          const newSerial =
            (
              await tx.implement.findUnique({
                where: { taskId: id },
                select: { serialNumber: true },
              })
            )?.serialNumber ?? null;
          if (hasValueChanged(oldSerial, newSerial)) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'serialNumber',
              oldValue: oldSerial,
              newValue: newSerial,
              reason: `Campo ${translateFieldName('serialNumber')} atualizado`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        // Special handling for quoteId to include quote details (budgetNumber, total, items)
        if (hasValueChanged(existingTask.quoteId, updatedTask.quoteId)) {
          let oldQuoteDetails: any = null;
          let newQuoteDetails: any = null;

          // Fetch old quote details if it existed (complete data for rollback restoration)
          if (existingTask.quoteId) {
            const oldQuote = await tx.budget.findUnique({
              where: { id: existingTask.quoteId },
              include: {
                services: { orderBy: { position: 'asc' } },
                customerConfigs: {
                  include: { customer: { select: { id: true, fantasyName: true, cnpj: true } } },
                },
              },
            });
            if (oldQuote) {
              oldQuoteDetails = {
                id: oldQuote.id,
                budgetNumber: oldQuote.budgetNumber,
                subtotal: oldQuote.subtotal,
                total: oldQuote.total,
                expiresAt: oldQuote.expiresAt,
                status: oldQuote.status,
                guaranteeYears: oldQuote.guaranteeYears,
                customGuaranteeText: oldQuote.customGuaranteeText,
                customForecastDays: oldQuote.customForecastDays,
                simultaneousTasks: oldQuote.simultaneousTasks,
                services: oldQuote.services.map(service => ({
                  description: service.description,
                  amount: service.amount,
                  observation: service.observation,
                  position: service.position,
                })),
                customerConfigs: oldQuote.customerConfigs.map((c: any) => ({
                  customerId: c.customerId,
                  subtotal: c.subtotal,
                  discountType: c.discountType,
                  discountValue: c.discountValue,
                  total: c.total,
                  customPaymentText: c.customPaymentText,
                  discountReference: c.discountReference,
                })),
              };
            }
          }

          // Fetch new quote details if exists (complete data for rollback restoration)
          if (updatedTask.quoteId) {
            const newQuote = await tx.budget.findUnique({
              where: { id: updatedTask.quoteId },
              include: {
                services: { orderBy: { position: 'asc' } },
                customerConfigs: {
                  include: { customer: { select: { id: true, fantasyName: true, cnpj: true } } },
                },
              },
            });
            if (newQuote) {
              newQuoteDetails = {
                id: newQuote.id,
                budgetNumber: newQuote.budgetNumber,
                subtotal: newQuote.subtotal,
                total: newQuote.total,
                expiresAt: newQuote.expiresAt,
                status: newQuote.status,
                guaranteeYears: newQuote.guaranteeYears,
                customGuaranteeText: newQuote.customGuaranteeText,
                customForecastDays: newQuote.customForecastDays,
                simultaneousTasks: newQuote.simultaneousTasks,
                services: newQuote.services.map(service => ({
                  description: service.description,
                  amount: service.amount,
                  observation: service.observation,
                  position: service.position,
                })),
                customerConfigs: newQuote.customerConfigs.map((c: any) => ({
                  customerId: c.customerId,
                  subtotal: c.subtotal,
                  discountType: c.discountType,
                  discountValue: c.discountValue,
                  total: c.total,
                  customPaymentText: c.customPaymentText,
                  discountReference: c.discountReference,
                })),
              };
            }
          }

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'quoteId',
            oldValue: oldQuoteDetails,
            newValue: newQuoteDetails,
            reason: 'Campo Orçamento atualizado',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || '',
            transaction: tx,
          });
        }

        // Track quote service and scalar field changes when quote is updated inline (via task edit form)
        // This handles the case where quoteId stays the same but quote content changes
        if (
          (data as any).quote &&
          updatedTask.quoteId &&
          !hasValueChanged(existingTask.quoteId, updatedTask.quoteId)
        ) {
          const oldQuoteItems = (existingTask as any).quote?.services || [];
          const updatedQuoteState = await tx.budget.findUnique({
            where: { id: updatedTask.quoteId },
            include: { services: { orderBy: { position: 'asc' } } },
          });
          const newQuoteItems = updatedQuoteState?.services || [];

          // Log per-service changes (added, removed, field updates)
          await logQuoteServiceChanges({
            changeLogService: this.changeLogService,
            quoteId: updatedTask.quoteId,
            oldServices: oldQuoteItems,
            newServices: newQuoteItems,
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            transaction: tx,
          });

          // Track scalar quote field changes (subtotal, total, discountType, etc.)
          const oldQuote = (existingTask as any).quote;
          if (oldQuote && updatedQuoteState) {
            const quoteFieldsToTrack = [
              'subtotal',
              'total',
              'expiresAt',
              'status',
              'guaranteeYears',
              'customGuaranteeText',
              'customForecastDays',
              'simultaneousTasks',
              'budgetNumber',
            ];
            for (const field of quoteFieldsToTrack) {
              const oldVal = oldQuote[field];
              const newVal = (updatedQuoteState as any)[field];
              if (hasValueChanged(oldVal, newVal, field)) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK_QUOTE,
                  entityId: updatedTask.quoteId,
                  action: CHANGE_ACTION.UPDATE,
                  field,
                  oldValue: serializeChangelogValue(oldVal),
                  newValue: serializeChangelogValue(newVal),
                  userId: userId || '',
                  reason: `Campo '${translateFieldName(field)}' do orçamento atualizado`,
                  triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                  triggeredById: userId || '',
                  transaction: tx,
                });
              }
            }
          }
        }

        // Emit field update events for important fields
        if (userId) {
          try {
            const updatedByUser = await tx.user.findUnique({
              where: { id: userId },
            });
            if (updatedByUser) {
              // Check for status change
              if (existingTask.status !== updatedTask.status) {
                // Ensure task has a name before emitting event
                // If name is null/undefined, reload the task to get it
                if (!updatedTask.name) {
                  this.logger.warn(
                    `[Task Update] Task ${id} has null/undefined name, reloading task data...`,
                  );
                  const taskWithName = await tx.task.findUnique({
                    where: { id },
                    select: {
                      id: true,
                      name: true,
                      implement: { select: { serialNumber: true } },
                      status: true,
                    },
                  });
                  if (taskWithName && taskWithName.name) {
                    updatedTask.name = taskWithName.name;
                    this.logger.log(`[Task Update] Task name reloaded: "${taskWithName.name}"`);
                  } else {
                    // If still no name, use a default
                    updatedTask.name = updatedTask.implement?.serialNumber
                      ? `Tarefa ${updatedTask.implement?.serialNumber}`
                      : 'Tarefa sem nome';
                    this.logger.warn(
                      `[Task Update] Task ${id} has no name in database, using default: "${updatedTask.name}"`,
                    );
                  }
                }

                this.eventEmitter.emit(
                  'task.status.changed',
                  new TaskStatusChangedEvent(
                    updatedTask as Task,
                    existingTask.status,
                    updatedTask.status,
                    updatedByUser as any,
                  ),
                );
              }

              // NOTE: Legacy 'task.field.updated' events for importantFields (term, sectorId, details, forecastDate)
              // were removed. All field change notifications are now handled via the fieldTracker:
              // fieldTracker.emitFieldChangeEvents() → 'task.field.changed' → task.listener.ts → dispatchByConfiguration
              // This prevents duplicate notifications since both 'task.field.updated' and 'task.field.changed'
              // were being handled by the same listener dispatching to the same config keys.
            }

            // Track field changes with the field tracker service
            try {
              const fieldChanges = await this.fieldTracker.trackChanges(
                id,
                existingTask as Task,
                updatedTask as Task,
                userId,
              );

              // Filter out auto-filled date fields when status changed to IN_PRODUCTION or COMPLETED
              // These dates are auto-set as part of the status transition and the status-specific
              // notification (task.in_production / task.completed) is sufficient — sending separate
              // date change notifications would be redundant noise.
              const statusChanged = existingTask.status !== updatedTask.status;
              const newStatus = updatedTask.status as TASK_STATUS;
              if (statusChanged && fieldChanges.length > 0) {
                const autoFilledFields = new Set<string>();

                if (
                  newStatus === TASK_STATUS.IN_PRODUCTION ||
                  newStatus === TASK_STATUS.COMPLETED
                ) {
                  // startedAt is auto-filled when entering IN_PRODUCTION or COMPLETED (if not already set)
                  if (!existingTask.startedAt) {
                    autoFilledFields.add('startedAt');
                  }
                }
                if (newStatus === TASK_STATUS.COMPLETED) {
                  // finishedAt is auto-filled when entering COMPLETED
                  if (!existingTask.finishedAt) {
                    autoFilledFields.add('finishedAt');
                  }
                }

                // entryDate and forecastDate are auto-cascaded from startedAt when they were empty
                if (autoFilledFields.has('startedAt')) {
                  if (!existingTask.entryDate) {
                    autoFilledFields.add('entryDate');
                  }
                  if (!existingTask.forecastDate) {
                    autoFilledFields.add('forecastDate');
                  }
                }

                if (autoFilledFields.size > 0) {
                  const removed = fieldChanges
                    .filter(c => autoFilledFields.has(c.field))
                    .map(c => c.field);
                  if (removed.length > 0) {
                    this.logger.log(
                      `[Task Update] Filtering auto-filled date fields from notifications on status → ${newStatus}: ${removed.join(', ')}`,
                    );
                    // Remove auto-filled fields from the array (mutate in place)
                    for (let i = fieldChanges.length - 1; i >= 0; i--) {
                      if (autoFilledFields.has(fieldChanges[i].field)) {
                        fieldChanges.splice(i, 1);
                      }
                    }
                  }
                }
              }

              if (fieldChanges.length > 0) {
                // Store field changes in database
                for (const change of fieldChanges) {
                  const isFileArray = [
                    'baseFiles',
                    'budgets',
                    'invoices',
                    'receipts',
                    'bankSlips',
                    'logoPaints',
                    'reimbursements',
                    'invoiceReimbursements',
                  ].includes(change.field);
                  let filesAdded = 0;
                  let filesRemoved = 0;
                  let metadata: any = null;

                  if (isFileArray) {
                    const fileChange = this.fieldTracker.analyzeFileArrayChange(
                      change.oldValue || [],
                      change.newValue || [],
                    );
                    filesAdded = fileChange.added;
                    filesRemoved = fileChange.removed;
                    metadata = {
                      addedFiles: fileChange.addedFiles?.map(f => ({
                        id: f.id,
                        filename: f.filename,
                      })),
                      removedFiles: fileChange.removedFiles?.map(f => ({
                        id: f.id,
                        filename: f.filename,
                      })),
                    };
                  }

                  await tx.taskFieldChangeLog.create({
                    data: {
                      taskId: id,
                      field: change.field,
                      oldValue: change.oldValue,
                      newValue: change.newValue,
                      changedBy: userId,
                      changedAt: change.changedAt,
                      isFileArray,
                      filesAdded,
                      filesRemoved,
                      metadata,
                    },
                  });
                }

                // Emit field change events
                await this.fieldTracker.emitFieldChangeEvents(
                  updatedTask as Task,
                  fieldChanges,
                  existingTask as Task,
                );

                // NOTE: Legacy TaskNotificationService.createFieldChangeNotifications() was removed.
                // All field change notifications are now handled via the event-based system:
                // fieldTracker.emitFieldChangeEvents() → task.field.changed → task.listener.ts → dispatchByConfiguration
                // This prevents duplicate notifications.
              }
            } catch (error) {
              this.logger.error('Error tracking field changes:', error);
            }
          } catch (error) {
            this.logger.error('Error emitting task update events:', error);
          }
        }

        // Service order changes are NOT tracked as TASK field changelogs.
        // Individual SERVICE_ORDER CREATE/UPDATE/DELETE changelogs already cover all changes.
        // Previously this created a "serviceOrders" field changelog when services were removed,
        // but that was redundant and caused confusing "Nenhuma/Nenhuma" entries.

        // A arte saiu da tarefa (R2): o histórico dela é do implemento
        // (`ImplementLayoutService`), não um campo `layouts` da tarefa.

        // Track baseFiles array changes
        // CRITICAL: Only check if the request baseFileIds are DIFFERENT from existing ones
        if (data.baseFileIds !== undefined) {
          const oldBaseFiles = existingTask.baseFiles || [];

          // Normalize existing baseFile IDs to strings and sort
          const oldBaseFileIds = oldBaseFiles.map((f: any) => String(f.id)).sort();

          // Normalize requested IDs to strings and sort
          const requestedIds = data.baseFileIds.map((id: any) => String(id)).sort();

          // Compare requested IDs with existing IDs - only proceed if different
          const baseFileIdsInRequestAreDifferent =
            oldBaseFileIds.length !== requestedIds.length ||
            !oldBaseFileIds.every((id, index) => id === requestedIds[index]);

          // Only check DB state if the request indicates a change
          if (baseFileIdsInRequestAreDifferent) {
            const newBaseFiles = updatedTask?.baseFiles || [];
            const newBaseFileIds = newBaseFiles.map((f: any) => String(f.id)).sort();

            const addedBaseFiles = newBaseFiles.filter(
              (f: any) => !oldBaseFileIds.includes(String(f.id)),
            );
            const removedBaseFiles = oldBaseFiles.filter(
              (f: any) => !newBaseFileIds.includes(String(f.id)),
            );

            // Only log if there are actual additions or removals
            if (addedBaseFiles.length > 0 || removedBaseFiles.length > 0) {
              const changeDescription = [];
              if (addedBaseFiles.length > 0) {
                changeDescription.push(
                  addedBaseFiles.length === 1
                    ? '1 arquivo base adicionado'
                    : `${addedBaseFiles.length} arquivos base adicionados`,
                );
              }
              if (removedBaseFiles.length > 0) {
                changeDescription.push(
                  removedBaseFiles.length === 1
                    ? '1 arquivo base removido'
                    : `${removedBaseFiles.length} arquivos base removidos`,
                );
              }

              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: 'baseFiles',
                oldValue: oldBaseFiles.length > 0 ? oldBaseFiles : null,
                newValue: newBaseFiles.length > 0 ? newBaseFiles : null,
                reason: changeDescription.join(', '),
                triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });
            }
          }
        }

        // Track logoPaints array changes (paintIds)
        // CRITICAL: Only check if the request paintIds are DIFFERENT from existing ones
        if (data.paintIds !== undefined) {
          const oldLogoPaints = existingTask.logoPaints || [];

          // Normalize existing paint IDs to strings and sort
          const oldPaintIds = oldLogoPaints.map((p: any) => String(p.id)).sort();

          // Normalize requested IDs to strings and sort
          const requestedIds = data.paintIds.map((id: any) => String(id)).sort();

          // Compare requested IDs with existing IDs - only proceed if different
          const paintIdsInRequestAreDifferent =
            oldPaintIds.length !== requestedIds.length ||
            !oldPaintIds.every((id, index) => id === requestedIds[index]);

          // Only check DB state if the request indicates a change
          if (paintIdsInRequestAreDifferent) {
            const newLogoPaints = updatedTask?.logoPaints || [];
            const newPaintIds = newLogoPaints.map((p: any) => String(p.id)).sort();

            const addedPaintIds = newPaintIds.filter((id: string) => !oldPaintIds.includes(id));
            const removedPaintIds = oldPaintIds.filter((id: string) => !newPaintIds.includes(id));

            // Only log if there are actual additions or removals
            if (addedPaintIds.length > 0 || removedPaintIds.length > 0) {
              const changeReasons = [];
              if (addedPaintIds.length > 0) {
                changeReasons.push(
                  addedPaintIds.length === 1
                    ? '1 tinta adicionada'
                    : `${addedPaintIds.length} tintas adicionadas`,
                );
              }
              if (removedPaintIds.length > 0) {
                changeReasons.push(
                  removedPaintIds.length === 1
                    ? '1 tinta removida'
                    : `${removedPaintIds.length} tintas removidas`,
                );
              }

              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: 'logoPaints',
                oldValue: oldPaintIds.length > 0 ? oldPaintIds : null,
                newValue: newPaintIds.length > 0 ? newPaintIds : null,
                reason: changeReasons.join(', '),
                triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });
            }
          }
        }

        // Track cuts array changes (CRITICAL - user reported this missing)
        if (data.cuts !== undefined) {
          const oldCuts = existingTask.cuts || [];
          const newCuts = updatedTask?.cuts || [];

          // Serialize cuts for changelog - store full data for rollback support
          // Count how many cuts have the same fileId+type+origin to determine quantity
          const serializeCuts = (cuts: any[]) => {
            const grouped = new Map<string, any>();

            cuts.forEach((c: any) => {
              const key = `${c.type}-${c.fileId || c.file?.id}-${c.origin}-${c.reason || 'none'}-${c.parentCutId || 'none'}`;

              if (grouped.has(key)) {
                grouped.get(key).quantity += 1;
              } else {
                grouped.set(key, {
                  fileId: c.fileId || c.file?.id || null,
                  type: c.type,
                  origin: c.origin,
                  quantity: 1,
                  status: c.status,
                  ...(c.reason && { reason: c.reason }),
                  ...(c.parentCutId && { parentCutId: c.parentCutId }),
                  // Include file details for changelog display with thumbnails
                  ...(c.file && {
                    file: {
                      id: c.file.id,
                      filename: c.file.filename,
                      mimetype: c.file.mimetype,
                      size: c.file.size,
                      thumbnailUrl: c.file.thumbnailUrl,
                      path: c.file.path,
                    },
                  }),
                });
              }
            });

            return Array.from(grouped.values());
          };

          const oldCutsSerialized = JSON.stringify(serializeCuts(oldCuts));
          const newCutsSerialized = JSON.stringify(serializeCuts(newCuts));

          // Only create changelog if cuts actually changed
          if (oldCutsSerialized !== newCutsSerialized) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'cuts',
              oldValue: serializeCuts(oldCuts),
              newValue: serializeCuts(newCuts),
              reason: `Recortes alterados de ${oldCuts.length} para ${newCuts.length}`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        // Track airbrushings array changes
        if (data.airbrushings !== undefined) {
          const oldAirbrushings = existingTask.airbrushings || [];
          const newAirbrushings = updatedTask?.airbrushings || [];

          // Serialize airbrushings for comparison
          const serializeAirbrushings = (airbrushings: any[]) => {
            return airbrushings.map((a: any) => ({
              description: a.description,
              status: a.status,
            }));
          };

          const oldAirbrushingsSerialized = JSON.stringify(serializeAirbrushings(oldAirbrushings));
          const newAirbrushingsSerialized = JSON.stringify(serializeAirbrushings(newAirbrushings));

          // Only create changelog if airbrushings actually changed
          if (oldAirbrushingsSerialized !== newAirbrushingsSerialized) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'airbrushings',
              oldValue: serializeAirbrushings(oldAirbrushings),
              newValue: serializeAirbrushings(newAirbrushings),
              reason: `Aerografias alteradas de ${oldAirbrushings.length} para ${newAirbrushings.length}`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        // Track observation changes
        if (data.observation !== undefined) {
          const oldObservation = existingTask.observation;
          const newObservation = updatedTask?.observation;

          // Serialize observation for comparison
          const serializeObservation = (obs: any) => {
            if (!obs) return null;
            return {
              description: obs.description || '',
              fileIds: obs.files?.map((f: any) => f.id) || obs.fileIds || [],
            };
          };

          const oldObsSerialized = JSON.stringify(serializeObservation(oldObservation));
          const newObsSerialized = JSON.stringify(serializeObservation(newObservation));

          // Only create changelog if observation actually changed
          if (oldObsSerialized !== newObsSerialized) {
            const oldObs = serializeObservation(oldObservation);
            const newObs = serializeObservation(newObservation);

            // Build reason description
            const changeReasons: string[] = [];
            if (!oldObservation && newObservation) {
              changeReasons.push('Observação adicionada');
            } else if (oldObservation && !newObservation) {
              changeReasons.push('Observação removida');
            } else {
              if (oldObs?.description !== newObs?.description) {
                changeReasons.push('Descrição alterada');
              }
              const oldFileCount = oldObs?.fileIds?.length || 0;
              const newFileCount = newObs?.fileIds?.length || 0;
              if (oldFileCount !== newFileCount) {
                changeReasons.push(`Arquivos: ${oldFileCount} → ${newFileCount}`);
              }
            }

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'observation',
              oldValue: oldObs,
              newValue: newObs,
              reason: changeReasons.join(', ') || 'Observação alterada',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        return {
          updatedTask: updatedTask!,
          createdServiceOrders,
          observationChangedSOs,
          taskAutoTransitionedToWaitingProduction,
        };
      });

      // Destructure transaction result
      const {
        updatedTask,
        createdServiceOrders,
        observationChangedSOs: soObservationChanges,
        taskAutoTransitionedToWaitingProduction: wasAutoTransitioned,
      } = transactionResult;

      // NFS-e do aerografista: concluir pelo formulário da TAREFA emite agora, e
      // não só na varredura de 15 minutos — o mesmo que concluir pelo app do
      // pintor já fazia. Trava mestra e tratamento de falha vivem no gancho.
      await this.painterNfseService.flushAfterCompletion(completedAirbrushingIds);

      // Serviço atribuído / pagamento recebido — pós-commit pelo mesmo motivo:
      // o despacho grava fora da `tx` e dispara push.
      await this.airbrushingNotifier.flush(airbrushingNotifyIntents);

      // Cotação da aerografia: quem negociava uma aerografia cancelada por este
      // formulário fica sabendo; aerografias novas sem aerografista são anunciadas.
      await this.airbrushingQuoteNotifier.flush(
        closedQuotePainters.map(c => ({
          kind: 'closed' as const,
          airbrushingId: c.airbrushingId,
          painterIds: c.painterIds,
          actorUserId: userId ?? null,
          reason: 'CANCELLED' as const,
        })),
      );
      await this.airbrushingQuoteNotifier.notifyPendingRequests(undefined, userId);

      // When this update transitioned the task INTO CANCELLED (a direct cancel or
      // the all-COMMERCIAL-SOs-cancelled auto-cancel), cascade-cancel its quote:
      // set the quote to CANCELLED and tear down any billing (delete invoices,
      // baixa boletos at Sicredi, cancel NFS-e at Elotech). These external calls
      // run post-commit. cancelForTaskCancellation refuses (throws) when an
      // installment is already PAID or an NFS-e is mid-emission — in that genuine
      // conflict we log and leave the records for manual teardown rather than
      // failing the already-committed cancellation.
      if (
        taskOldStatusForQuoteCancel !== TASK_STATUS.CANCELLED &&
        (updatedTask as any)?.status === TASK_STATUS.CANCELLED &&
        (updatedTask as any)?.quoteId
      ) {
        const quoteToCancelId = (updatedTask as any).quoteId as string;
        try {
          await this.budgetService.cancelForTaskCancellation(quoteToCancelId, userId);
          this.logger.log(
            `[Task Update] Cascade-cancelled quote ${quoteToCancelId} after task ${id} cancellation`,
          );
        } catch (cancelError) {
          this.logger.error(
            `[Task Update] Could not cascade-cancel quote ${quoteToCancelId} after task ${id} cancellation (manual teardown may be required): ${
              cancelError instanceof Error ? cancelError.message : String(cancelError)
            }`,
          );
        }
      }

      // Emit events for created service orders AFTER transaction commits
      if (createdServiceOrders && createdServiceOrders.length > 0) {
        this.logger.log(
          `[Task Update] Emitting events for ${createdServiceOrders.length} service orders`,
        );

        for (const serviceOrder of createdServiceOrders) {
          this.logger.log(
            `[Task Update] Emitting service_order.created event for SO ${serviceOrder.id} (type: ${serviceOrder.type})`,
          );

          // Emit creation event
          this.eventEmitter.emit('service_order.created', {
            serviceOrder,
            userId,
          });

          // If service order is assigned, emit assignment event
          if (serviceOrder.assignedToId) {
            this.logger.log(
              `[Task Update] Emitting service_order.assigned event for SO ${serviceOrder.id} to user ${serviceOrder.assignedToId}`,
            );
            this.eventEmitter.emit('service_order.assigned', {
              serviceOrder,
              userId,
              assignedToId: serviceOrder.assignedToId,
            });
          }
        }
      } else {
        this.logger.log(`[Task Update] No service orders to emit events for`);
      }

      // Emit observation change events for service orders whose observation was modified
      if (soObservationChanges && soObservationChanges.length > 0) {
        for (const { serviceOrder, oldObservation } of soObservationChanges) {
          this.logger.log(
            `[Task Update] Emitting service_order.observation.changed for SO ${serviceOrder.id}`,
          );
          this.eventEmitter.emit('service_order.observation.changed', {
            serviceOrder,
            oldObservation,
            newObservation: serviceOrder.observation,
            userId,
          });
        }
      }

      // If task was auto-transitioned to WAITING_PRODUCTION, emit event and send notifications
      // This notifies production sector users that a new task is ready for production
      if (wasAutoTransitioned) {
        this.logger.log(
          `[Task Update] Task ${id} was auto-transitioned to WAITING_PRODUCTION, emitting events and notifications`,
        );

        // Get the user who triggered the auto-transition
        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        // Emit task status changed event
        this.eventEmitter.emit('task.status.changed', {
          task: {
            id: updatedTask.id,
            name: updatedTask.name,
            serialNumber: updatedTask.implement?.serialNumber,
            status: updatedTask.status,
            sectorId: updatedTask.sectorId,
          },
          oldStatus: TASK_STATUS.PREPARATION,
          newStatus: TASK_STATUS.WAITING_PRODUCTION,
          changedBy: changedByUser || { id: 'system', name: 'Sistema' },
        });

        // NOTE: We previously emitted task.created here for auto-transitioned tasks, but this was REMOVED
        // because the task.status.changed event (emitted above) already triggers 'task.ready_for_production'
        // notification via the TaskListener.handleTaskStatusChanged() method. Emitting task.created here
        // caused DUPLICATE notifications for production users.
      }

      return {
        success: true,
        message: 'Tarefa atualizada com sucesso.',
        data: updatedTask,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar tarefa:', error);

      // Clean up uploaded files if task update failed
      if (files) {
        const allFiles = [
          ...(files.budgets || []),
          ...(files.invoices || []),
          ...(files.receipts || []),
          ...(files.bankSlips || []),
          ...(files.cutFiles || []),
          ...(files.implementVinPlate || []),
        ];

        for (const file of allFiles) {
          try {
            const fs = await import('fs');
            fs.unlinkSync(file.path);
          } catch (cleanupError) {
            this.logger.warn(`Failed to cleanup temp file: ${file.path}`);
          }
        }
      }

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        // A concurrency conflict is a meaningful answer the client acts on (offer
        // reload/overwrite), not a server fault — without this it was flattened
        // into a generic 500 and the UI could not tell the two apart.
        error instanceof ConflictException
      ) {
        throw error;
      }
      rethrowPrismaValidationAsBadRequest(error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao atualizar a tarefa. Tente novamente.',
      );
    }
  }

  /**
   * Batch update tasks
   */
  async batchUpdate(
    data: TaskBatchUpdateFormData,
    include?: TaskInclude,
    userId?: string,
    files?: {
      budgets?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      receipts?: Express.Multer.File[];
      bankSlips?: Express.Multer.File[];
      cutFiles?: Express.Multer.File[];
      baseFiles?: Express.Multer.File[];
      /** Foto da plaqueta de identificação (VIN) — imagem única, gravada no implemento. */
      implementVinPlate?: Express.Multer.File[];
    },
  ): Promise<TaskBatchUpdateResponse<TaskUpdateFormData>> {
    this.logger.log('[batchUpdate] ========== BATCH UPDATE STARTED ==========');
    this.logger.log(`[batchUpdate] Number of tasks to update: ${data.tasks?.length || 0}`);
    this.logger.log(
      `[batchUpdate] Tasks data: ${JSON.stringify(data.tasks?.map(t => ({ id: t.id, data: t.data })))}`,
    );
    this.logger.log(`[batchUpdate] userId: ${userId}`);
    this.logger.log(`[batchUpdate] include: ${JSON.stringify(include)}`);

    // Log files received
    this.logger.log(
      `[batchUpdate] Files received: ${files ? Object.keys(files).join(', ') : 'none'}`,
    );
    if (files) {
      Object.entries(files).forEach(([key, fileArray]) => {
        this.logger.log(`[batchUpdate] ${key}: ${fileArray.length} files`);
      });
    }

    // Store existing task states BEFORE updates — declared outside transaction for post-transaction access
    const existingTaskStates: Map<string, any> = new Map();

    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        this.logger.log('[batchUpdate] Inside transaction');

        // Look up the acting user's sector privilege for field-level access control.
        // NOTE: the batch endpoint admits 8 privileges (task.controller.ts),
        // so the privilege MUST be resolved and enforced here. Least-privilege:
        // if the user or their sector cannot be resolved, the batch is denied —
        // never assume ADMIN.
        if (!userId) {
          throw new ForbiddenException(
            'Usuário não identificado. Não é possível validar as permissões da operação em lote.',
          );
        }
        const actingUser = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, email: true, sector: { select: { privileges: true } } },
        });
        const userPrivilege: string | undefined = actingUser?.sector?.privileges || undefined;
        if (!userPrivilege) {
          throw new ForbiddenException(
            'Não foi possível determinar o setor do usuário. Operação em lote negada.',
          );
        }
        this.logger.log(`[batchUpdate] User ${userId} privilege: ${userPrivilege}`);

        // Prepare updates with change tracking and validation
        const updatesWithChangeTracking: { id: string; data: TaskUpdateFormData }[] = [];
        const validationErrors: Array<{ id: string; error: string }> = [];

        // Store field changes for event emission after transaction
        const fieldChangesForEvents: Array<{
          taskId: string;
          task: any;
          field: string;
          oldValue: any;
          newValue: any;
          isFileArray: boolean;
        }> = [];

        // Store cuts created additively via the batch path, grouped by task, so that
        // after the transaction commits we emit cut.created / cuts.added.to.task — mirroring
        // CutService.create (the single-item path). Without this, batch-created cuts were silent.
        const cutsCreatedByTask = new Map<string, any[]>();

        for (const update of data.tasks) {
          this.logger.log(`[batchUpdate] Processing task ${update.id}`);
          const existingTask = await this.tasksRepository.findByIdWithTransaction(tx, update.id, {
            include: {
              ...include,
              // a série (trilha e aviso) é do implemento: sempre carregado aqui
              implement: (include as any)?.implement ?? { select: { serialNumber: true } },
              budgets: true,
              invoices: true,
              receipts: true,
              bankSlips: true,
              logoPaints: true,
              generalPainting: true,
              cuts: { include: { file: true } },
              serviceOrders: true, // Needed to gate task completion on service order status
            },
          });
          if (existingTask) {
            // Store existing state for changelog comparison after update
            existingTaskStates.set(update.id, {
              ...existingTask,
              budgets: existingTask.budgets ? [...existingTask.budgets] : [],
              invoices: existingTask.invoices ? [...existingTask.invoices] : [],
              receipts: existingTask.receipts ? [...existingTask.receipts] : [],
              bankSlips: existingTask.bankSlips ? [...existingTask.bankSlips] : [],
              logoPaints: existingTask.logoPaints ? [...existingTask.logoPaints] : [],
              cuts: existingTask.cuts ? [...existingTask.cuts] : [],
            });

            this.logger.log(`[batchUpdate] Found existing task ${update.id}, validating...`);
            try {
              // Field-level access control per sector — same rule as the
              // single-update path (task.permissions.ts). Without this, the
              // batch endpoint lets any of its 8 admitted privileges edit ANY
              // task field.
              validateSectorFieldAccess(
                userPrivilege as SECTOR_PRIVILEGES,
                update.data as Record<string, unknown>,
              );

              // Nested quote writes must honor the same guards as
              // BudgetService.update (status locks, role gates, auto-revert).
              if ((update.data as any).quote) {
                const budgetRef = await tx.task.findUnique({
                  where: { id: update.id },
                  select: { quoteId: true },
                });
                if (!budgetRef?.quoteId) {
                  // No quote yet — the repository will CREATE one from this
                  // block; apply the nested-create guards.
                  this.enforceNestedQuoteCreateGuards((update.data as any).quote, userPrivilege);
                }
                if (budgetRef?.quoteId) {
                  const existingQuote = await tx.budget.findUnique({
                    where: { id: budgetRef.quoteId },
                    include: {
                      services: { orderBy: { position: 'asc' } },
                      customerConfigs: true,
                      // ⚠️ Sem `billings` a trava do dinheiro não acontece — ver
                      // `isQuoteMoneyLocked`. Vale para o caminho em lote tanto
                      // quanto para o individual.
                      billings: { select: { approvedAt: true, status: true } },
                    },
                  });
                  if (existingQuote) {
                    const quoteStatusPinned = (update.data as any).quote.status !== undefined;
                    const filteredQuote = this.filterNoOpQuoteFields(
                      existingQuote,
                      (update.data as any).quote,
                    );
                    if (filteredQuote === null) {
                      delete (update.data as any).quote;
                    } else {
                      (update.data as any).quote = filteredQuote;
                      this.enforceNestedQuoteGuards(
                        existingQuote,
                        filteredQuote,
                        userPrivilege,
                        quoteStatusPinned,
                      );
                    }
                  }
                }
              }

              await this.validateTask(update.data, update.id, tx);

              // Validate status transition if status is being updated
              if (
                update.data.status &&
                (update.data.status as TASK_STATUS) !== (existingTask.status as TASK_STATUS)
              ) {
                if (
                  !isValidTaskStatusTransition(
                    existingTask.status as TASK_STATUS,
                    update.data.status as TASK_STATUS,
                  )
                ) {
                  throw new BadRequestException(
                    `Transição de status inválida: ${getTaskStatusLabel(existingTask.status as TASK_STATUS)} → ${getTaskStatusLabel(update.data.status as TASK_STATUS)}`,
                  );
                }
                await this.assertArtworkAllowsRelease(
                  tx,
                  update.id,
                  existingTask.status as TASK_STATUS,
                  update.data.status as TASK_STATUS,
                );

                // Only PRODUCTION_MANAGER, LOGISTIC and ADMIN can set a task to
                // COMPLETED or move it away from COMPLETED (mirrors the
                // single-update path and the dedicated /finish endpoint).
                if (
                  ((update.data.status as TASK_STATUS) === TASK_STATUS.COMPLETED ||
                    (existingTask.status as TASK_STATUS) === TASK_STATUS.COMPLETED) &&
                  userPrivilege !== SECTOR_PRIVILEGES.PRODUCTION_MANAGER &&
                  userPrivilege !== SECTOR_PRIVILEGES.LOGISTIC &&
                  userPrivilege !== SECTOR_PRIVILEGES.ADMIN
                ) {
                  throw new BadRequestException(
                    'Apenas o gerente de produção, a logística ou o administrador pode finalizar tarefas ou reverter tarefas concluídas.',
                  );
                }

                // A task can only be finished when ALL of its service orders are
                // already concluded (mirrors the single-update path). CANCELLED
                // service orders don't block completion.
                if (
                  (update.data.status as TASK_STATUS) === TASK_STATUS.COMPLETED &&
                  (existingTask.status as TASK_STATUS) !== TASK_STATUS.COMPLETED
                ) {
                  const existingSOs = (existingTask as any).serviceOrders || [];
                  let finalSOs = existingSOs;
                  if (Array.isArray((update.data as any).serviceOrders)) {
                    finalSOs = existingSOs.map((existingSO: any) => {
                      const soUpdate = (update.data as any).serviceOrders.find(
                        (so: any) => so.id === existingSO.id,
                      );
                      if (soUpdate && soUpdate.status) {
                        return { ...existingSO, status: soUpdate.status };
                      }
                      return existingSO;
                    });
                  }
                  // Same intentionally-blocking completion gate as the single
                  // update path: a task can only finish once every service order
                  // is COMPLETED or CANCELLED (finishing makes the task billable).
                  // No force-finish escape by design.
                  const incompleteServices = finalSOs.filter(
                    (so: any) =>
                      so.status !== SERVICE_ORDER_STATUS.COMPLETED &&
                      so.status !== SERVICE_ORDER_STATUS.CANCELLED,
                  );
                  if (incompleteServices.length > 0) {
                    const total = finalSOs.filter(
                      (so: any) => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
                    ).length;
                    throw new BadRequestException(
                      `Não é possível finalizar a tarefa: ${incompleteServices.length} de ${total} serviço(s) ainda não foi(ram) concluído(s). Conclua todos os serviços antes de finalizar a tarefa.`,
                    );
                  }
                }

                // Note: startedAt and finishedAt are no longer required as they are auto-filled
                // when task status changes to IN_PRODUCTION or COMPLETED respectively
              }

              // Cotação da aerografia: o mapper do lote grava `status` direto, e o
              // schema aninhado manda PREPARATION por padrão — sem isto o lote tirava
              // aerografias de cotação. Mesma regra do update individual.
              if (Array.isArray((update.data as any).airbrushings)) {
                const nested = (update.data as any).airbrushings as Array<Record<string, any>>;
                const persistedIds = nested
                  .map(item => item.id)
                  .filter((aid: any) => typeof aid === 'string' && !aid.startsWith('airbrushing-'));
                if (persistedIds.length) {
                  const persisted = await tx.airbrushing.findMany({
                    where: { id: { in: persistedIds }, taskId: update.id },
                    select: { id: true, status: true },
                  });
                  const byId = new Map(persisted.map(a => [a.id, a]));
                  for (const item of nested) {
                    const current = byId.get(item.id);
                    if (current) {
                      await applyQuotingToNestedAirbrushingUpdate(
                        tx,
                        current,
                        item,
                        userId ?? null,
                      );
                    }
                  }
                }
              }

              // Ensure statusOrder and bonificationOrder are updated when status/bonification changes
              const updateData = {
                ...update.data,
                ...(update.data.status && {
                  statusOrder: getTaskStatusOrder(update.data.status as TASK_STATUS),
                }),
                ...((update.data as any).bonification && {
                  bonificationOrder: getBonificationStatusOrder((update.data as any).bonification),
                }),
                // Batch has no service-layer airbrushing handling, so opt the repo
                // mapper into FULL create+update+notIn-delete (the single-update
                // path leaves this unset and keeps repo delete-only).
                ...((update.data as any).airbrushings !== undefined && {
                  _applyAirbrushingsFully: true,
                }),
              };

              updatesWithChangeTracking.push({
                id: update.id,
                data: updateData,
              });
            } catch (error) {
              this.logger.error(`[batchUpdate] Validation error for task ${update.id}:`, error);
              if (error instanceof BadRequestException) {
                validationErrors.push({ id: update.id, error: error.message });
              } else {
                // Log and re-throw unexpected errors
                this.logger.error(`[batchUpdate] Unexpected error during validation:`, error);
                throw error;
              }
            }
          } else {
            this.logger.warn(`[batchUpdate] Task ${update.id} not found`);
          }
        }

        // If there are validation errors, include them in the batch result
        const failedItems = validationErrors.map(e => ({
          id: e.id,
          error: e.error,
          data: data.tasks.find(u => u.id === e.id)?.data || ({} as TaskUpdateFormData),
        }));

        // Process file uploads if provided - upload files once and add to all tasks
        const uploadedFileIds: {
          budgets?: string[];
          invoices?: string[];
          receipts?: string[];
          bankSlips?: string[];
          layouts?: string[];
          baseFiles?: string[];
        } = {};

        if (files && data.tasks.length > 0) {
          this.logger.log('[batchUpdate] Processing file uploads for batch operation');
          this.logger.log(`[batchUpdate] Files object keys: ${Object.keys(files).join(', ')}`);

          // Get customer name from first task for file metadata
          const firstTask = await this.tasksRepository.findByIdWithTransaction(
            tx,
            data.tasks[0].id,
            {
              include: { customer: true },
            },
          );
          const customerName = firstTask?.customer?.fantasyName;

          // Upload budgets
          if (files.budgets && files.budgets.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.budgets.length} budget files`);
            uploadedFileIds.budgets = [];
            for (const budgetFile of files.budgets) {
              const budgetRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                budgetFile,
                'taskBudgets',
                userId,
                {
                  entityId: data.tasks[0].id, // Use first task ID for reference
                  entityType: 'TASK',
                  customerName,
                },
              );
              uploadedFileIds.budgets.push(budgetRecord.id);
            }
          }

          // Upload invoices
          if (files.invoices && files.invoices.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.invoices.length} invoice files`);
            uploadedFileIds.invoices = [];
            for (const invoiceFile of files.invoices) {
              const invoiceRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                invoiceFile,
                'taskInvoices',
                userId,
                {
                  entityId: data.tasks[0].id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              uploadedFileIds.invoices.push(invoiceRecord.id);
            }
          }

          // Upload receipts
          if (files.receipts && files.receipts.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.receipts.length} receipt files`);
            uploadedFileIds.receipts = [];
            for (const receiptFile of files.receipts) {
              const receiptRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                receiptFile,
                'taskReceipts',
                userId,
                {
                  entityId: data.tasks[0].id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              uploadedFileIds.receipts.push(receiptRecord.id);
            }
          }

          // Upload bank slips
          if (files.bankSlips && files.bankSlips.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.bankSlips.length} bank slip files`);
            uploadedFileIds.bankSlips = [];
            for (const bankSlipFile of files.bankSlips) {
              const bankSlipRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                bankSlipFile,
                'taskBankSlips',
                userId,
                {
                  entityId: data.tasks[0].id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              uploadedFileIds.bankSlips.push(bankSlipRecord.id);
            }
          }

          // Upload base files (shared across all tasks)
          if (files.baseFiles && files.baseFiles.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.baseFiles.length} base files`);
            uploadedFileIds.baseFiles = [];
            for (const baseFile of files.baseFiles) {
              const baseFileRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                baseFile,
                'taskBaseFiles',
                userId,
                {
                  entityId: data.tasks[0].id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              uploadedFileIds.baseFiles.push(baseFileRecord.id);
            }
            this.logger.log(
              `[batchUpdate] Uploaded ${uploadedFileIds.baseFiles.length} base files`,
            );
          }

          // Process cut files for batch update
          // Note: These files will be referenced in the cuts data for each task
          const uploadedCutFiles: Array<{ id: string }> = [];
          if (files.cutFiles && files.cutFiles.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.cutFiles.length} cut files`);
            for (const cutFile of files.cutFiles) {
              const cutRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                cutFile,
                'cutFiles',
                userId,
                {
                  entityId: data.tasks[0].id,
                  entityType: 'CUT',
                  customerName,
                },
              );
              uploadedCutFiles.push({ id: cutRecord.id });
            }

            // Update cuts data with uploaded file IDs
            // Each task's cuts array should have _fileIndex that maps to the uploaded files
            for (const task of data.tasks) {
              if (task.data.cuts && Array.isArray(task.data.cuts)) {
                task.data.cuts.forEach((cut: any) => {
                  if (
                    typeof cut._fileIndex === 'number' &&
                    cut._fileIndex < uploadedCutFiles.length
                  ) {
                    cut.fileId = uploadedCutFiles[cut._fileIndex].id;
                    delete cut._fileIndex; // Clean up the temporary field
                  }
                });
              }
            }
          }

          // Process implementMeasure photo files for bulk implementMeasure operations
          // Upload photos and inject photoId into implement data for all tasks
          this.logger.log(`[batchUpdate] ===== LAYOUT PHOTO PROCESSING START =====`);
          this.logger.log(`[batchUpdate] All file keys: ${Object.keys(files).join(', ')}`);
          const uploadedImplementMeasurePhotoIds: Partial<Record<ImplementFace, string>> = {};
          const implementMeasurePhotoKeys = Object.keys(files).filter(k =>
            k.startsWith('implementMeasurePhotos.'),
          );
          this.logger.log(
            `[batchUpdate] implement measure photo keys found: ${implementMeasurePhotoKeys.length > 0 ? implementMeasurePhotoKeys.join(', ') : 'NONE'}`,
          );
          if (implementMeasurePhotoKeys.length > 0) {
            this.logger.log(
              `[batchUpdate] Processing ${implementMeasurePhotoKeys.length} implementMeasure photo files`,
            );

            for (const key of implementMeasurePhotoKeys) {
              // `implementMeasurePhotos.<face>Side` — o interceptor só aceita as faces da lista
              const side = faceOf(key.replace('implementMeasurePhotos.', ''));
              if (!side) continue;
              const photoFile = Array.isArray((files as any)[key])
                ? (files as any)[key][0]
                : (files as any)[key];

              if (photoFile) {
                this.logger.log(`[batchUpdate] Uploading implementMeasure photo for ${side}`);
                const uploadedPhoto = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  photoFile,
                  'implementMeasurePhotos',
                  userId,
                  { entityType: 'IMPLEMENT_MEASURE', customerName },
                );
                uploadedImplementMeasurePhotoIds[side] = uploadedPhoto.id;
                this.logger.log(
                  `[batchUpdate] implement measure photo uploaded for ${side}: ${uploadedPhoto.id}`,
                );
              }
            }

            // Inject uploaded photo IDs into implement data for all tasks
            if (Object.keys(uploadedImplementMeasurePhotoIds).length > 0) {
              for (const task of data.tasks) {
                const implementData = (task.data as any)?.implement;
                if (implementData) {
                  for (const face of FACES) {
                    const photoId = uploadedImplementMeasurePhotoIds[face];
                    if (photoId && implementData[FACE_REL[face]]) {
                      implementData[FACE_REL[face]].photoId = photoId;
                    }
                  }
                }
              }
              this.logger.log(
                '[batchUpdate] Injected implementMeasure photo IDs into implement data for all tasks',
              );
            }
          }
        }

        // Add uploaded files to all tasks in the batch (only when files were uploaded)
        if (files && data.tasks.length > 0) {
          // We need to merge with existing files to avoid replacing them
          this.logger.log('[batchUpdate] Adding uploaded files to all tasks in batch');
          this.logger.log(
            `[batchUpdate] Tasks to update with files: ${updatesWithChangeTracking.length}`,
          );
          this.logger.log(`[batchUpdate] Uploaded file IDs:`, uploadedFileIds);

          for (const update of updatesWithChangeTracking) {
            this.logger.log(
              `[batchUpdate] Processing task ${update.id} for file connections and removals`,
            );

            // Get current task to merge existing files and process removals
            const currentTask = await this.tasksRepository.findByIdWithTransaction(tx, update.id, {
              include: {
                budgets: true,
                invoices: true,
                receipts: true,
                bankSlips: true,
                baseFiles: true,
                logoPaints: true,
                cuts: true,
              },
            });

            if (!currentTask) {
              this.logger.error(`[batchUpdate] Task ${update.id} not found`);
              continue;
            }

            // Process file additions (merge with existing)
            if (uploadedFileIds.budgets && uploadedFileIds.budgets.length > 0) {
              const currentBudgetIds = currentTask.budgets?.map(f => f.id) || [];
              const mergedBudgetIds = [
                ...new Set([...currentBudgetIds, ...uploadedFileIds.budgets]),
              ];
              update.data.budgetIds = mergedBudgetIds;
              this.logger.log(
                `[batchUpdate] Adding ${uploadedFileIds.budgets.length} budgets to task ${update.id} (total: ${mergedBudgetIds.length})`,
              );
            }

            if (uploadedFileIds.invoices && uploadedFileIds.invoices.length > 0) {
              const currentInvoiceIds = currentTask.invoices?.map(f => f.id) || [];
              const mergedInvoiceIds = [
                ...new Set([...currentInvoiceIds, ...uploadedFileIds.invoices]),
              ];
              update.data.invoiceIds = mergedInvoiceIds;
              this.logger.log(
                `[batchUpdate] Adding ${uploadedFileIds.invoices.length} invoices to task ${update.id} (total: ${mergedInvoiceIds.length})`,
              );
            }

            if (uploadedFileIds.receipts && uploadedFileIds.receipts.length > 0) {
              const currentReceiptIds = currentTask.receipts?.map(f => f.id) || [];
              const mergedReceiptIds = [
                ...new Set([...currentReceiptIds, ...uploadedFileIds.receipts]),
              ];
              update.data.receiptIds = mergedReceiptIds;
              this.logger.log(
                `[batchUpdate] Adding ${uploadedFileIds.receipts.length} receipts to task ${update.id} (total: ${mergedReceiptIds.length})`,
              );
            }

            if (uploadedFileIds.bankSlips && uploadedFileIds.bankSlips.length > 0) {
              const currentBankSlipIds = currentTask.bankSlips?.map(f => f.id) || [];
              const mergedBankSlipIds = [
                ...new Set([...currentBankSlipIds, ...uploadedFileIds.bankSlips]),
              ];
              update.data.bankSlipIds = mergedBankSlipIds;
              this.logger.log(
                `[batchUpdate] Adding ${uploadedFileIds.bankSlips.length} bank slips to task ${update.id} (total: ${mergedBankSlipIds.length})`,
              );
            }

            // Merge uploaded base files with each task (SET/ADD pattern)
            if (uploadedFileIds.baseFiles && uploadedFileIds.baseFiles.length > 0) {
              const hasExplicitBaseFileIds = update.data.baseFileIds !== undefined;

              if (!hasExplicitBaseFileIds) {
                // ADD mode: merge uploaded files with current base files
                const currentBaseFileIds = currentTask.baseFiles?.map((f: any) => f.id) || [];
                const mergedBaseFileIds = [
                  ...new Set([...currentBaseFileIds, ...uploadedFileIds.baseFiles]),
                ];
                update.data.baseFileIds = mergedBaseFileIds;
                this.logger.log(
                  `[batchUpdate] Adding ${uploadedFileIds.baseFiles.length} base files to task ${update.id} (merged with ${currentBaseFileIds.length} existing, total: ${mergedBaseFileIds.length})`,
                );
              } else {
                // SET/REPLACE mode: baseFileIds was explicitly provided, add uploaded files to it
                const currentBaseFileIds = Array.isArray(update.data.baseFileIds)
                  ? update.data.baseFileIds
                  : [];
                const mergedIds = [
                  ...new Set([...currentBaseFileIds, ...uploadedFileIds.baseFiles]),
                ];
                update.data.baseFileIds = mergedIds;
                this.logger.log(
                  `[batchUpdate] Base file IDs explicitly provided (${currentBaseFileIds.length}), adding ${uploadedFileIds.baseFiles.length} uploaded files (total: ${mergedIds.length})`,
                );
              }
            }

            // Process removals
            // Remove budgets
            if (update.data.removeBudgetIds && update.data.removeBudgetIds.length > 0) {
              const currentBudgetIds = currentTask.budgets?.map(f => f.id) || [];
              const filteredBudgetIds = currentBudgetIds.filter(
                id => !update.data.removeBudgetIds.includes(id),
              );
              update.data.budgetIds = filteredBudgetIds;
              delete update.data.removeBudgetIds;
              this.logger.log(
                `[batchUpdate] Removing ${update.data.removeBudgetIds.length} budgets from task ${update.id}`,
              );
            }

            // Remove invoices
            if (update.data.removeInvoiceIds && update.data.removeInvoiceIds.length > 0) {
              const currentInvoiceIds = currentTask.invoices?.map(f => f.id) || [];
              const filteredInvoiceIds = currentInvoiceIds.filter(
                id => !update.data.removeInvoiceIds.includes(id),
              );
              update.data.invoiceIds = filteredInvoiceIds;
              delete update.data.removeInvoiceIds;
              this.logger.log(
                `[batchUpdate] Removing ${update.data.removeInvoiceIds.length} invoices from task ${update.id}`,
              );
            }

            // Remove receipts
            if (update.data.removeReceiptIds && update.data.removeReceiptIds.length > 0) {
              const currentReceiptIds = currentTask.receipts?.map(f => f.id) || [];
              const filteredReceiptIds = currentReceiptIds.filter(
                id => !update.data.removeReceiptIds.includes(id),
              );
              update.data.receiptIds = filteredReceiptIds;
              delete update.data.removeReceiptIds;
              this.logger.log(
                `[batchUpdate] Removing ${update.data.removeReceiptIds.length} receipts from task ${update.id}`,
              );
            }

            // Remove general painting
            if (update.data.removeGeneralPainting) {
              update.data.paintId = null;
              delete update.data.removeGeneralPainting;
              this.logger.log(`[batchUpdate] Removing general painting from task ${update.id}`);
            }

            // Remove logo paints
            if (update.data.removeLogoPaints && update.data.removeLogoPaints.length > 0) {
              const currentLogoPaintIds = currentTask.logoPaints?.map(p => p.id) || [];
              const filteredLogoPaintIds = currentLogoPaintIds.filter(
                id => !update.data.removeLogoPaints.includes(id),
              );
              update.data.paintIds = filteredLogoPaintIds;
              delete update.data.removeLogoPaints;
              this.logger.log(
                `[batchUpdate] Removing ${update.data.removeLogoPaints.length} logo paints from task ${update.id}`,
              );
            }

            // Remove cuts
            if (update.data.removeCutIds && update.data.removeCutIds.length > 0) {
              const removeCutIds = update.data.removeCutIds;
              // Delete the cuts directly using prisma
              await tx.cut.deleteMany({
                where: {
                  id: { in: removeCutIds },
                  taskId: update.id,
                },
              });
              delete update.data.removeCutIds;
              this.logger.log(
                `[batchUpdate] Removed ${removeCutIds.length} cuts from task ${update.id}`,
              );
            }

            // Handle new cuts additively (don't pass to repository which would do deleteMany+create)
            if (
              update.data.cuts &&
              Array.isArray(update.data.cuts) &&
              update.data.cuts.length > 0
            ) {
              const cutsToAdd = update.data.cuts;
              this.logger.log(
                `[batchUpdate] Adding ${cutsToAdd.length} new cuts to task ${update.id} (additive)`,
              );

              for (const cutItem of cutsToAdd) {
                if (!cutItem.fileId) continue;
                const quantity = (cutItem as any).quantity || 1;
                for (let i = 0; i < quantity; i++) {
                  const createdCut = await tx.cut.create({
                    data: {
                      fileId: cutItem.fileId,
                      type: cutItem.type as any,
                      origin: (cutItem.origin || 'PLAN') as any,
                      reason: cutItem.reason || null,
                      status: CUT_STATUS.PENDING as any,
                      statusOrder: 1,
                      taskId: update.id,
                    },
                  });

                  // Collect for post-commit cut.created / cuts.added.to.task emission
                  const existingCuts = cutsCreatedByTask.get(update.id) || [];
                  existingCuts.push(createdCut);
                  cutsCreatedByTask.set(update.id, existingCuts);
                }
              }

              // Remove cuts from update data so repository doesn't do deleteMany+create
              delete update.data.cuts;
            }

            this.logger.log(
              `[batchUpdate] After merge and removals - update.data:`,
              JSON.stringify(update.data),
            );
          }
        }

        // Process cut removals AND additive cut creation for EVERY batch request. The files-gated
        // block above only runs for MULTIPART uploads, but the "Adicionar Plano de Corte" flow
        // uploads cut files separately and then sends plain JSON — so with no `files` that block was
        // skipped and BOTH removeCutIds and the additive `cuts` were silently dropped (the cut
        // stayed / the new cut was never created, even though the transaction reported success).
        // The repository mapper is create-only and never removes cuts, and — as the JSON path proved
        // in production — its nested `cuts.create` was not persisting here either; so this loop is
        // the single authoritative place cuts are added/removed. For MULTIPART requests the block
        // above already handled and `delete`d these fields, so this no-ops (no double-processing).
        for (const update of updatesWithChangeTracking) {
          // Removals first.
          const removeCutIds = (update.data as any).removeCutIds;
          if (Array.isArray(removeCutIds) && removeCutIds.length > 0) {
            await tx.cut.deleteMany({
              where: { id: { in: removeCutIds }, taskId: update.id },
            });
            delete (update.data as any).removeCutIds;
            this.logger.log(
              `[batchUpdate] Removed ${removeCutIds.length} cuts from task ${update.id} (json path)`,
            );
          }

          // Additive creation (quantity-expanded, one Cut row per unit, per-task FK). Mirrors the
          // multipart path so a plan created/edited without a fresh upload still persists.
          const cutsToAdd = (update.data as any).cuts;
          if (Array.isArray(cutsToAdd) && cutsToAdd.length > 0) {
            for (const cutItem of cutsToAdd) {
              if (!cutItem.fileId) continue;
              const quantity = (cutItem as any).quantity || 1;
              for (let i = 0; i < quantity; i++) {
                const createdCut = await tx.cut.create({
                  data: {
                    fileId: cutItem.fileId,
                    type: cutItem.type as any,
                    origin: (cutItem.origin || 'PLAN') as any,
                    reason: cutItem.reason || null,
                    status: CUT_STATUS.PENDING as any,
                    statusOrder: 1,
                    taskId: update.id,
                  },
                });
                const existingCuts = cutsCreatedByTask.get(update.id) || [];
                existingCuts.push(createdCut);
                cutsCreatedByTask.set(update.id, existingCuts);
              }
            }
            // Remove from update data so the repository mapper doesn't also try to create them.
            delete (update.data as any).cuts;
            this.logger.log(
              `[batchUpdate] Added ${cutsToAdd.length} cut group(s) to task ${update.id} (json path)`,
            );
          }
        }

        // Batch update only valid items
        const result = await this.tasksRepository.updateManyWithTransaction(
          tx,
          updatesWithChangeTracking,
          { include },
        );

        // Add validation failures to the result
        if (failedItems.length > 0) {
          result.failed = [...(result.failed || []), ...failedItems];
          result.totalFailed = (result.totalFailed || 0) + failedItems.length;
        }

        // Process consolidated implement data with implementMeasures for each successfully updated task
        // Phase 1: Collect all tasks that need implementMeasure updates
        const tasksNeedingImplementMeasureUpdate: Array<{
          taskId: string;
          implementData: any;
        }> = [];

        for (const task of result.success) {
          const updateData = data.tasks.find(u => u.id === task.id)?.data;
          const implementData = (updateData as any)?.implement;
          if (facesIn(implementData).length > 0) {
            tasksNeedingImplementMeasureUpdate.push({ taskId: task.id, implementData });
          }
        }

        if (tasksNeedingImplementMeasureUpdate.length > 0) {
          this.logger.log(
            `[batchUpdate] Processing individual implementMeasures for ${tasksNeedingImplementMeasureUpdate.length} tasks`,
          );

          // Cada face passa pelo escritor único (I38: a linha que é só deste
          // implemento é editada NO LUGAR — sem trocar o id da medida a cada lote,
          // o que disparava um falso "medidas mudaram"; a que é de mais alguém
          // ganha cópia; face sem linha ganha uma). O escritor devolve o ANTES
          // de cada face, lido antes da escrita.

          // Phase 2: For each task, ensure implement exists, then write each face through the writer
          for (const { taskId, implementData } of tasksNeedingImplementMeasureUpdate) {
            this.logger.log(`[batchUpdate] Processing implement implementMeasures for task ${taskId}`);

            // Get the task with implement info
            const taskWithImplement = await tx.task.findUnique({
              where: { id: taskId },
              include: { implement: { select: { id: true } } },
            });

            // O implemento SEMPRE existe (DD1): o ramo que o criava aqui saiu.
            const implementId = taskWithImplement?.implement?.id;
            if (!implementId) {
              throw new InternalServerErrorException(
                `Tarefa ${taskId} sem implemento: toda tarefa tem exatamente um implemento.`,
              );
            }

            const writtenFaces: FaceWriteResult[] = [];
            for (const face of FACES) {
              const implementMeasureData = implementData[FACE_REL[face]];
              if (!implementMeasureData) continue;
              const written = await setFace(tx, implementId, face, implementMeasureData);
              this.logger.log(
                `[batchUpdate] Individual ${face} implementMeasure ${written.action}: ${written.measureId} for task ${taskId}`,
              );
              writtenFaces.push(written);
            }

            // As faces escritas (o escritor já apontou o implemento para cada uma)
            const implementMeasureUpdate: Record<string, string> = {};
            for (const written of writtenFaces) {
              if (written.measureId) implementMeasureUpdate[written.fk] = written.measureId;
            }

            if (Object.keys(implementMeasureUpdate).length > 0) {
              this.logger.log(
                `[batchUpdate] Implement ${implementId} pointed to individual implementMeasures: ${JSON.stringify(implementMeasureUpdate)}`,
              );

              // Track implementMeasure changes in changelog with formatted summaries
              const sides: string[] = [];
              const oldValues: Record<string, any> = {};
              const newValues: Record<string, any> = {};
              const implementMeasureSidePairs: Array<{
                field: string;
                oldId: string | null;
                newId: string;
                sideName: string;
              }> = [];
              for (const written of writtenFaces) {
                if (!written.measureId) continue;
                implementMeasureSidePairs.push({
                  field: written.fk,
                  oldId: written.previousId,
                  newId: written.measureId,
                  sideName: IMPLEMENT_FACE_LABELS[written.face],
                });
                sides.push(IMPLEMENT_FACE_LABELS[written.face]);
                oldValues[written.fk] = formatImplementMeasureForChangelog(written.before);
                newValues[written.fk] = formatImplementMeasureForChangelog(written.after);
              }

              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: taskId,
                action: CHANGE_ACTION.UPDATE,
                field: 'implementMeasures',
                oldValue: oldValues,
                newValue: newValues,
                reason: `ImplementMeasures aplicados (${sides.join(', ')}) via operação em lote`,
                triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                triggeredById: taskId,
                userId: userId || '',
                transaction: tx,
                metadata: {
                  sides: sides,
                  implementMeasureIds: implementMeasureUpdate,
                },
              });

              this.logger.log(
                `[batchUpdate] Changelog created for task ${taskId}: implementMeasures applied for ${sides.join(', ')}`,
              );

              // As faces da medida que mudaram, para a notificação depois do commit.
              // Passam por fieldTracker.emitFieldChangeEvents, que junta as faces
              // (implement.<face>SideMeasureId) num ÚNICO evento 'implement.measures'
              // — como na edição de uma tarefa só.
              for (const pair of implementMeasureSidePairs) {
                if (pair.oldId === pair.newId) continue;
                fieldChangesForEvents.push({
                  taskId,
                  task: { id: taskId },
                  field: `implement.${pair.field}`,
                  oldValue: pair.oldId,
                  newValue: pair.newId,
                  isFileArray: false,
                });
              }
            }

            this.logger.log(
              `[batchUpdate] Finished processing implementMeasures for task ${taskId}`,
            );
          }

          // O TAMANHO É DO ORÇAMENTO — depois do lote inteiro, e não tarefa a
          // tarefa: o irmão que o próprio lote já mediu com os mesmos valores é
          // pulado (só o lado que DIFERE é escrito), e o que ficou de fora do
          // lote recebe a medida. Ver `utils/implement-measure-replication.ts`.
          for (const { taskId, implementData } of tasksNeedingImplementMeasureUpdate) {
            const lados = FACES.filter(face => !!implementData?.[FACE_REL[face]]);
            if (lados.length === 0) continue;
            await replicateImplementMeasuresToQuoteSiblings(tx, {
              sourceTaskId: taskId,
              sides: lados,
              logChange: (entry: ReplicationLogEntry) =>
                this.logReplicatedMeasure(entry, taskId, userId, tx),
            });
          }
        }

        // Track individual field changes for successful updates
        for (const task of result.success) {
          const updateData = data.tasks.find(u => u.id === task.id)?.data;
          const existingTask = existingTaskStates.get(task.id);

          // Fetch updated task with all relations for comparison
          const updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, task.id, {
            include: {
              implement: { select: { serialNumber: true } },
              baseFiles: true,
              budgets: true,
              invoices: true,
              receipts: true,
              bankSlips: true,
              logoPaints: true,
              generalPainting: true,
              cuts: { include: { file: true } },
            },
          });

          // Track individual field changes for batch update
          if (existingTask && updateData && updatedTask) {
            // Track baseFiles changes
            if (updateData.baseFileIds !== undefined) {
              const oldBaseFiles = existingTask.baseFiles || [];
              const newBaseFiles = updatedTask.baseFiles || [];

              // Normalize IDs to strings and sort for consistent comparison
              const oldBaseFileIds = oldBaseFiles.map((f: any) => String(f.id)).sort();
              const newBaseFileIds = newBaseFiles.map((f: any) => String(f.id)).sort();

              // Check if arrays are actually different
              const idsChanged =
                oldBaseFileIds.length !== newBaseFileIds.length ||
                !oldBaseFileIds.every((id, index) => id === newBaseFileIds[index]);

              if (idsChanged) {
                const addedBaseFiles = newBaseFiles.filter(
                  (f: any) => !oldBaseFileIds.includes(String(f.id)),
                );
                const removedBaseFiles = oldBaseFiles.filter(
                  (f: any) => !newBaseFileIds.includes(String(f.id)),
                );

                if (addedBaseFiles.length > 0 || removedBaseFiles.length > 0) {
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'baseFiles',
                    oldValue: oldBaseFiles.length > 0 ? oldBaseFiles : null,
                    newValue: newBaseFiles.length > 0 ? newBaseFiles : null,
                    reason: `Campo arquivos base atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: 'baseFiles',
                    oldValue: oldBaseFiles,
                    newValue: newBaseFiles,
                    isFileArray: true,
                  });
                }
              }
            }

            // Track budgets changes
            if (updateData.budgetIds !== undefined) {
              const oldBudgets = existingTask.budgets || [];
              const newBudgets = updatedTask.budgets || [];

              // Normalize IDs to strings and sort for consistent comparison
              const oldBudgetIds = oldBudgets.map((f: any) => String(f.id)).sort();
              const newBudgetIds = newBudgets.map((f: any) => String(f.id)).sort();

              // Check if arrays are actually different
              const idsChanged =
                oldBudgetIds.length !== newBudgetIds.length ||
                !oldBudgetIds.every((id, index) => id === newBudgetIds[index]);

              if (idsChanged) {
                const addedBudgets = newBudgets.filter(
                  (f: any) => !oldBudgetIds.includes(String(f.id)),
                );
                const removedBudgets = oldBudgets.filter(
                  (f: any) => !newBudgetIds.includes(String(f.id)),
                );

                if (addedBudgets.length > 0 || removedBudgets.length > 0) {
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'budgets',
                    oldValue: oldBudgets.length > 0 ? oldBudgets : null,
                    newValue: newBudgets.length > 0 ? newBudgets : null,
                    reason: `Campo orçamentos atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: 'budgets',
                    oldValue: oldBudgets,
                    newValue: newBudgets,
                    isFileArray: true,
                  });
                }
              }
            }

            // Track invoices changes
            if (updateData.invoiceIds !== undefined) {
              const oldInvoices = existingTask.invoices || [];
              const newInvoices = updatedTask.invoices || [];

              // Normalize IDs to strings and sort for consistent comparison
              const oldInvoiceIds = oldInvoices.map((f: any) => String(f.id)).sort();
              const newInvoiceIds = newInvoices.map((f: any) => String(f.id)).sort();

              // Check if arrays are actually different
              const idsChanged =
                oldInvoiceIds.length !== newInvoiceIds.length ||
                !oldInvoiceIds.every((id, index) => id === newInvoiceIds[index]);

              if (idsChanged) {
                const addedInvoices = newInvoices.filter(
                  (f: any) => !oldInvoiceIds.includes(String(f.id)),
                );
                const removedInvoices = oldInvoices.filter(
                  (f: any) => !newInvoiceIds.includes(String(f.id)),
                );

                if (addedInvoices.length > 0 || removedInvoices.length > 0) {
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'invoices',
                    oldValue: oldInvoices.length > 0 ? oldInvoices : null,
                    newValue: newInvoices.length > 0 ? newInvoices : null,
                    reason: `Campo notas fiscais atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: 'invoices',
                    oldValue: oldInvoices,
                    newValue: newInvoices,
                    isFileArray: true,
                  });
                }
              }
            }

            // Track receipts changes
            if (updateData.receiptIds !== undefined) {
              const oldReceipts = existingTask.receipts || [];
              const newReceipts = updatedTask.receipts || [];

              // Normalize IDs to strings and sort for consistent comparison
              const oldReceiptIds = oldReceipts.map((f: any) => String(f.id)).sort();
              const newReceiptIds = newReceipts.map((f: any) => String(f.id)).sort();

              // Check if arrays are actually different
              const idsChanged =
                oldReceiptIds.length !== newReceiptIds.length ||
                !oldReceiptIds.every((id, index) => id === newReceiptIds[index]);

              if (idsChanged) {
                const addedReceipts = newReceipts.filter(
                  (f: any) => !oldReceiptIds.includes(String(f.id)),
                );
                const removedReceipts = oldReceipts.filter(
                  (f: any) => !newReceiptIds.includes(String(f.id)),
                );

                if (addedReceipts.length > 0 || removedReceipts.length > 0) {
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'receipts',
                    oldValue: oldReceipts.length > 0 ? oldReceipts : null,
                    newValue: newReceipts.length > 0 ? newReceipts : null,
                    reason: `Campo comprovantes atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: 'receipts',
                    oldValue: oldReceipts,
                    newValue: newReceipts,
                    isFileArray: true,
                  });
                }
              }
            }

            // Track logoPaints changes
            if (updateData.paintIds !== undefined) {
              const oldPaintIds = (
                existingTask.logoPaints?.map((p: any) => String(p.id)) || []
              ).sort();
              const newPaintIds = (
                updatedTask.logoPaints?.map((p: any) => String(p.id)) || []
              ).sort();

              // Check if arrays are actually different
              const idsChanged =
                oldPaintIds.length !== newPaintIds.length ||
                !oldPaintIds.every((id, index) => id === newPaintIds[index]);

              if (idsChanged) {
                const addedPaintIds = newPaintIds.filter((id: string) => !oldPaintIds.includes(id));
                const removedPaintIds = oldPaintIds.filter(
                  (id: string) => !newPaintIds.includes(id),
                );

                if (addedPaintIds.length > 0 || removedPaintIds.length > 0) {
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'logoPaints',
                    oldValue: oldPaintIds.length > 0 ? oldPaintIds : null,
                    newValue: newPaintIds.length > 0 ? newPaintIds : null,
                    reason: `Campo tintas de logo atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: 'logoPaints',
                    oldValue: existingTask.logoPaints || [],
                    newValue: updatedTask.logoPaints || [],
                    isFileArray: true,
                  });
                }
              }
            }

            // Track general painting (paintId) changes
            if (updateData.paintId !== undefined) {
              const oldPaintId = existingTask.paintId;
              const newPaintId = updatedTask.paintId;

              if (oldPaintId !== newPaintId) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'paintId',
                  oldValue: oldPaintId,
                  newValue: newPaintId,
                  reason: `Campo tinta atualizado`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });

                // Store for event emission
                fieldChangesForEvents.push({
                  taskId: task.id,
                  task: updatedTask,
                  field: 'paintId',
                  oldValue: oldPaintId,
                  newValue: newPaintId,
                  isFileArray: false,
                });
              }
            }

            // Track cuts changes
            if (updateData.cuts !== undefined) {
              const oldCuts = existingTask.cuts || [];
              const newCuts = updatedTask.cuts || [];

              if (JSON.stringify(oldCuts) !== JSON.stringify(newCuts)) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'cuts',
                  oldValue: oldCuts.length > 0 ? oldCuts : null,
                  newValue: newCuts.length > 0 ? newCuts : null,
                  reason: `Campo recortes atualizado`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });

                // Store for event emission
                fieldChangesForEvents.push({
                  taskId: task.id,
                  task: updatedTask,
                  field: 'cuts',
                  oldValue: oldCuts,
                  newValue: newCuts,
                  isFileArray: false,
                });
              }
            }

            // Track other simple field changes
            const simpleFieldsToTrack = [
              'status',
              'sectorId',
              'assignedToUserId',
              'description',
              'observations',
            ];
            for (const field of simpleFieldsToTrack) {
              if ((updateData as any)[field] !== undefined) {
                const oldValue = existingTask[field as keyof typeof existingTask];
                const newValue = updatedTask[field as keyof typeof updatedTask];

                if (hasValueChanged(oldValue, newValue)) {
                  const fieldLabel = translateFieldName(field);
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: field,
                    oldValue: oldValue,
                    newValue: newValue,
                    reason: `Campo ${fieldLabel} atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: field,
                    oldValue: oldValue,
                    newValue: newValue,
                    isFileArray: false,
                  });
                }
              }
            }

            // A SÉRIE (DD1, W2 em lote): gravada no implemento pelo repositório; a
            // trilha é TASK/serialNumber (S-5).
            if ((updateData as any).implement?.serialNumber !== undefined) {
              const oldSerial = (existingTask as any).implement?.serialNumber ?? null;
              const newSerial = (updatedTask as any).implement?.serialNumber ?? null;
              if (hasValueChanged(oldSerial, newSerial)) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'serialNumber',
                  oldValue: oldSerial,
                  newValue: newSerial,
                  reason: `Campo ${translateFieldName('serialNumber')} atualizado`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });
                fieldChangesForEvents.push({
                  taskId: task.id,
                  task: updatedTask,
                  field: 'serialNumber',
                  oldValue: oldSerial,
                  newValue: newSerial,
                  isFileArray: false,
                });
              }
            }

            // =====================================================================
            // BIDIRECTIONAL SYNC: Task Status → Service Order Status (Batch)
            // When task status changes, sync production service orders accordingly
            // =====================================================================
            if (updateData.status && updateData.status !== existingTask.status) {
              const oldTaskStatus = existingTask.status as TASK_STATUS;
              const newTaskStatus = updateData.status as TASK_STATUS;

              // Get all service orders for this task
              const taskServiceOrders = await tx.serviceOrder.findMany({
                where: { taskId: task.id },
                select: {
                  id: true,
                  status: true,
                  type: true,
                  description: true,
                  startedAt: true,
                  finishedAt: true,
                },
              });

              // Get service order updates needed for this task status change
              const serviceOrderUpdates = getServiceOrderUpdatesForTaskStatusChange(
                taskServiceOrders.map((so: any) => ({
                  id: so.id,
                  status: so.status as SERVICE_ORDER_STATUS,
                  type: so.type as SERVICE_ORDER_TYPE,
                  startedAt: so.startedAt,
                  finishedAt: so.finishedAt,
                })),
                oldTaskStatus,
                newTaskStatus,
              );

              if (serviceOrderUpdates.length > 0) {
                this.logger.log(
                  `[TASK→SO SYNC BATCH] Task ${task.id} status changed ${oldTaskStatus} → ${newTaskStatus}, updating ${serviceOrderUpdates.length} service orders`,
                );

                for (const update of serviceOrderUpdates) {
                  const so = taskServiceOrders.find((s: any) => s.id === update.serviceOrderId);
                  if (!so) continue;

                  const soUpdateData: any = {
                    status: update.newStatus,
                    statusOrder: getServiceOrderStatusOrder(update.newStatus),
                  };

                  // Set dates based on update flags
                  if (update.setStartedAt && !so.startedAt) {
                    soUpdateData.startedAt = new Date();
                    soUpdateData.startedById = userId || null;
                  }
                  if (update.setFinishedAt && !so.finishedAt) {
                    soUpdateData.finishedAt = new Date();
                    soUpdateData.completedById = userId || null;
                  }
                  if (update.clearStartedAt) {
                    soUpdateData.startedAt = null;
                    soUpdateData.startedById = null;
                  }
                  if (update.clearFinishedAt) {
                    soUpdateData.finishedAt = null;
                    soUpdateData.completedById = null;
                  }

                  await tx.serviceOrder.update({
                    where: { id: update.serviceOrderId },
                    data: soUpdateData,
                  });

                  // Log the sync in changelog
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.SERVICE_ORDER,
                    entityId: update.serviceOrderId,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'status',
                    oldValue: so.status,
                    newValue: update.newStatus,
                    reason: update.reason + ' (batch)',
                    triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  this.logger.log(
                    `[TASK→SO SYNC BATCH] Service order ${update.serviceOrderId} (${so.description}) status: ${so.status} → ${update.newStatus}`,
                  );
                }
              }
            }

            // =====================================================================
            // BIDIRECTIONAL SYNC: Quote Services ⇄ Production Service Orders (Batch)
            // Mirrors the single-update path: whenever a batch edit touched the
            // quote services or the service orders, create the mirrored rows on
            // the other side and recompute discount-aware totals. Without this,
            // bulk edits desynced SOs ⇄ quote services + totals. The shared helper
            // is non-destructive (only ADDS rows) and swallows its own errors.
            // =====================================================================
            const batchTouchedServiceOrders = (updateData as any).serviceOrders !== undefined;
            const batchTouchedQuoteServices =
              (updateData as any).quote?.services !== undefined &&
              Array.isArray((updateData as any).quote.services) &&
              (updateData as any).quote.services.length > 0;
            if (batchTouchedServiceOrders || batchTouchedQuoteServices) {
              await this.syncQuoteServicesAndServiceOrders(
                tx,
                task.id,
                userId,
                // Use the PERSISTED (post-update) status for SO auto-complete
                // parity with the single-update path.
                (updatedTask.status as TASK_STATUS) ?? (existingTask.status as TASK_STATUS),
              );
            }
          }
        }

        this.logger.log(
          `[batchUpdate] Transaction complete. Success: ${result.totalUpdated}, Failed: ${result.totalFailed}`,
        );
        return { ...result, fieldChangesForEvents, cutsCreatedByTask };
      });

      // After transaction: Emit field change events for notifications.
      // Instead of hand-rolling raw 'task.field.changed' emits (which bypassed the
      // TaskFieldTrackerService), route every changed task through the SAME logic the
      // single-update path uses:
      //   (a) status changes -> dedicated 'task.status.changed' event (NOT a generic field),
      //   (b) the implement measure side trio -> ONE consolidated 'implement.measures' event,
      //   (c) all other tracked fields -> fieldTracker.emitFieldChangeEvents (with proper
      //       file-array add/remove analysis).
      if (result.fieldChangesForEvents && result.fieldChangesForEvents.length > 0) {
        this.logger.log(
          `[batchUpdate] Emitting field change events for ${result.fieldChangesForEvents.length} change(s) for notifications`,
        );

        // Normalize batch field names to the tracker's TRACKED_FIELDS names so the
        // downstream listener receives the same field identifiers as the single path.
        const normalizeFieldName = (field: string): string => {
          switch (field) {
            case 'description':
              return 'details';
            case 'observations':
              return 'observation';
            default:
              return field;
          }
        };

        // Group changes by task so each task emits one consolidated implement.measures event.
        const changesByTask = new Map<
          string,
          { task: any; changes: Array<{ field: string; oldValue: any; newValue: any }> }
        >();
        for (const change of result.fieldChangesForEvents) {
          const entry = changesByTask.get(change.taskId);
          // Prefer a task object that actually carries a name (full fetch) over the
          // lightweight { id } placeholders pushed for implement measure entries.
          const candidateTask = change.task;
          if (entry) {
            if (!entry.task?.name && candidateTask?.name) {
              entry.task = candidateTask;
            }
            entry.changes.push({
              field: change.field,
              oldValue: change.oldValue,
              newValue: change.newValue,
            });
          } else {
            changesByTask.set(change.taskId, {
              task: candidateTask,
              changes: [
                { field: change.field, oldValue: change.oldValue, newValue: change.newValue },
              ],
            });
          }
        }

        // Resolve the acting user once for status-change events.
        let updatedByUser: any = null;
        if (userId) {
          try {
            updatedByUser = await this.prisma.user.findUnique({ where: { id: userId } });
          } catch (userError) {
            this.logger.warn(`[batchUpdate] Could not resolve acting user ${userId}:`, userError);
          }
        }

        for (const [taskId, group] of changesByTask) {
          const taskForEvents = group.task || { id: taskId };
          const existingTaskState = existingTaskStates.get(taskId);

          // (a) Status change -> dedicated task.status.changed event (mirror single path)
          const statusChange = group.changes.find(c => c.field === 'status');
          if (statusChange && updatedByUser && statusChange.oldValue !== statusChange.newValue) {
            try {
              this.eventEmitter.emit(
                'task.status.changed',
                new TaskStatusChangedEvent(
                  taskForEvents as Task,
                  statusChange.oldValue as TASK_STATUS,
                  statusChange.newValue as TASK_STATUS,
                  updatedByUser as any,
                ),
              );
              this.logger.debug(
                `[batchUpdate] Emitted task.status.changed for task ${taskId}: ${statusChange.oldValue} -> ${statusChange.newValue}`,
              );
            } catch (statusError) {
              this.logger.error(
                `[batchUpdate] Error emitting task.status.changed for task ${taskId}:`,
                statusError,
              );
            }
          }

          // (b)+(c) Remaining tracked fields -> route through the field tracker so the
          // implement measure trio collapses into one event and file arrays get add/remove analysis.
          const trackerChanges = group.changes
            .filter(c => c.field !== 'status')
            .map(c => ({
              field: normalizeFieldName(c.field),
              oldValue: c.oldValue,
              newValue: c.newValue,
              changedAt: new Date(),
              changedBy: userId || '',
            }));

          if (trackerChanges.length > 0) {
            try {
              await this.fieldTracker.emitFieldChangeEvents(
                taskForEvents as Task,
                trackerChanges,
                existingTaskState as Task,
              );
              this.logger.debug(
                `[batchUpdate] Routed ${trackerChanges.length} field change(s) through fieldTracker for task ${taskId}`,
              );
            } catch (eventError) {
              this.logger.error(
                `[batchUpdate] Error emitting field change events for task ${taskId}:`,
                eventError,
              );
              // Don't throw - event emission is not critical
            }
          }
        }
      }

      // After transaction: Emit cut.created / cuts.added.to.task for cuts created via the
      // batch path — mirroring CutService.create so cut notifications fire for batch updates too.
      if (result.cutsCreatedByTask && result.cutsCreatedByTask.size > 0) {
        try {
          const createdByUser = userId
            ? await this.prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, name: true, email: true },
              })
            : null;

          if (createdByUser) {
            for (const [cutTaskId, cuts] of result.cutsCreatedByTask) {
              if (!cuts || cuts.length === 0) continue;
              try {
                const taskForEvent = await this.prisma.task.findUnique({
                  where: { id: cutTaskId },
                  select: { id: true, name: true, sectorId: true, status: true },
                });

                for (const cut of cuts) {
                  this.eventEmitter.emit(
                    'cut.created',
                    new CutCreatedEvent(cut, taskForEvent as any, createdByUser as any),
                  );
                }

                if (taskForEvent && cuts.length > 0) {
                  this.eventEmitter.emit(
                    'cuts.added.to.task',
                    new CutsAddedToTaskEvent(taskForEvent as any, cuts, createdByUser as any),
                  );
                }

                this.logger.debug(
                  `[batchUpdate] Emitted cut.created x${cuts.length} + cuts.added.to.task for task ${cutTaskId}`,
                );
              } catch (perTaskCutError) {
                this.logger.error(
                  `[batchUpdate] Error emitting cut events for task ${cutTaskId}:`,
                  perTaskCutError,
                );
              }
            }
          }
        } catch (cutEventError) {
          this.logger.error('[batchUpdate] Error emitting batch cut events:', cutEventError);
        }
      }

      this.logger.log('[batchUpdate] ========== BATCH UPDATE COMPLETED ==========');
      const successMessage =
        result.totalUpdated === 1
          ? '1 tarefa atualizada com sucesso'
          : `${result.totalUpdated} tarefas atualizadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalUpdated + result.totalFailed,
        totalSuccess: result.totalUpdated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('[batchUpdate] ========== BATCH UPDATE FAILED ==========');
      this.logger.error('[batchUpdate] Error details:', error);
      this.logger.error(
        '[batchUpdate] Error stack:',
        error instanceof Error ? error.stack : 'No stack trace',
      );

      // Clean up uploaded temp files to prevent orphans
      if (files) {
        const allFiles = [
          ...(files.budgets || []),
          ...(files.invoices || []),
          ...(files.receipts || []),
          ...(files.bankSlips || []),
          ...(files.cutFiles || []),
          ...(files.baseFiles || []),
        ];
        for (const file of allFiles) {
          try {
            const fs = await import('fs');
            if (file.path) fs.unlinkSync(file.path);
          } catch (cleanupError) {
            this.logger.warn(`[batchUpdate] Failed to cleanup temp file: ${file.path}`);
          }
        }
        this.logger.log(`[batchUpdate] Cleaned up ${allFiles.length} temp files after failure`);
      }

      // Re-throw BadRequestException and other client errors as-is
      if (error instanceof BadRequestException) {
        throw error;
      }

      // For other errors, provide more detailed information
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      rethrowPrismaValidationAsBadRequest(error);
      throw new InternalServerErrorException(`Erro na atualização em lote: ${errorMessage}`);
    }
  }

  /**
   * Exclusão degradada para cancelamento: a tarefa tem orçamento com assinatura
   * eletrônica coletada (ou envelope selado), então apagar destruiria a prova da
   * contratação. Em vez de recusar com erro, a tarefa vira CANCELLED e o
   * orçamento é cascade-cancelado (`cancelForTaskCancellation`: teardown de
   * faturamento + cancelamento de cerimônias RUNNING), preservando envelope,
   * trilha de auditoria e PDFs congelados.
   */
  private async cancelTaskInsteadOfDelete(
    id: string,
    userId?: string,
  ): Promise<TaskDeleteResponse> {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, quoteId: true },
    });
    if (!task) {
      throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
    }

    const alreadyCancelled = task.status === TASK_STATUS.CANCELLED;
    if (!alreadyCancelled) {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await tx.task.update({
          where: { id },
          data: {
            status: TASK_STATUS.CANCELLED,
            statusOrder: 5, // CANCELLED statusOrder
          },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: task.status,
          newValue: TASK_STATUS.CANCELLED,
          reason:
            'Exclusão convertida em cancelamento: o orçamento possui assinatura eletrônica coletada e o documento assinado deve ser preservado',
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
          triggeredById: id,
          userId: userId || '',
          transaction: tx,
        });
      });
    }

    // Pós-commit (chamadas externas Sicredi/Elotech): cascade-cancel do
    // orçamento, espelhando o caminho de cancelamento do update(). Uma falha
    // aqui não desfaz o cancelamento da tarefa — fica logada para teardown
    // manual, como lá.
    if (task.quoteId) {
      try {
        await this.budgetService.cancelForTaskCancellation(
          task.quoteId,
          userId || '',
          'Orçamento com assinatura eletrônica coletada — exclusão da tarefa convertida em cancelamento para preservar o documento assinado',
        );
      } catch (cancelError) {
        this.logger.error(
          `[Task Delete→Cancel] Could not cascade-cancel quote ${task.quoteId} of task ${id} (manual teardown may be required): ${
            cancelError instanceof Error ? cancelError.message : String(cancelError)
          }`,
        );
      }
    }

    return {
      success: true,
      message: alreadyCancelled
        ? 'A tarefa possui assinatura eletrônica coletada no orçamento e não pode ser excluída — ela permanece cancelada, com o documento assinado preservado.'
        : 'A tarefa possui assinatura eletrônica coletada no orçamento e não pode ser excluída — tarefa e orçamento foram cancelados automaticamente, preservando o documento assinado.',
    };
  }

  /**
   * OS VEÍCULOS QUE NÃO PODEM SER APAGADOS PORQUE JÁ FORAM COBRADOS.
   *
   * Devolve, dos ids recebidos, os que estão na cobertura de um faturamento
   * CONGELADO — aprovado, ou em estado pós-aprovação sem carimbo (ver
   * `isBillingFrozen`; as duas leituras são a mesma pergunta).
   *
   * ⚠️ POR QUE ISTO PRECISOU EXISTIR. A exclusão de tarefa consultava SÓ
   * `findProtectedTaskIds` — a guarda de ASSINATURA. `isQuoteMoneyLocked` nunca
   * era chamada em caminho de exclusão nenhum, e o banco apagava antes de
   * qualquer código opinar: `BillingTask.task` e `Invoice.task` eram os dois
   * `onDelete: Cascade`, de modo que apagar o implemento levava junto a linha de
   * cobertura E a fatura emitida sobre ele. A guarda `orphanedFrozen` da
   * reconciliação — que existe exatamente para recusar isto — ficava cega,
   * porque quando ela roda a linha de cobertura já não está mais lá. No acervo
   * eram 159 veículos passando sem erro e levando 159 faturas vivas.
   *
   * O critério é a COBERTURA, não o orçamento inteiro, e é deliberado: a trava do
   * dinheiro foi desenhada para NÃO travar os cinquenta e nove veículos que ainda
   * não foram cobrados e cujo preço ainda pode mudar (ver o cabeçalho de
   * `budget.guards.ts`). É o mesmo recorte de `orphanedFrozen`.
   *
   * A migração `2026091715..._fatura_nao_morre_com_o_veiculo` troca
   * `Invoice.task` para `Restrict`, de modo que o banco também recusa. Esta
   * função existe para recusar com uma frase que diga o que fazer, em vez de um
   * erro de integridade referencial.
   */
  private async findMoneyLockedTaskIds(
    taskIds: string[],
  ): Promise<Array<{ taskId: string; label: string; budgetNumber: number | null }>> {
    if (taskIds.length === 0) return [];
    const cobertos = await (this.prisma as any).billingTask.findMany({
      where: { taskId: { in: taskIds }, billing: BILLING_FROZEN_WHERE },
      select: {
        taskId: true,
        task: { select: { name: true, implement: { select: { serialNumber: true, plate: true } } } },
        billing: { select: { quote: { select: { budgetNumber: true } } } },
      },
    });
    return cobertos.map((row: any) => ({
      taskId: row.taskId,
      label:
        row.task?.implement?.serialNumber ??
        row.task?.implement?.plate ??
        row.task?.name ??
        String(row.taskId).slice(0, 8),
      budgetNumber: row.billing?.quote?.budgetNumber ?? null,
    }));
  }

  /** A frase que a tela mostra quando a exclusão é recusada pelo dinheiro. */
  private moneyLockedDeletionMessage(
    bloqueados: Array<{ label: string; budgetNumber: number | null }>,
  ): string {
    const lista = bloqueados
      .slice(0, 5)
      .map(b => (b.budgetNumber ? `${b.label} (orçamento nº ${b.budgetNumber})` : b.label))
      .join(', ');
    return (
      `Não é possível excluir ${bloqueados.length === 1 ? 'o veículo' : 'os veículos'} ` +
      `${lista}${bloqueados.length > 5 ? ', …' : ''}: o faturamento que ${
        bloqueados.length === 1 ? 'o cobre' : 'os cobre'
      } já foi aprovado — há fatura emitida, e pode haver boleto registrado e NFS-e autorizada. ` +
      'Use "Reverter Faturamento" na tela de Faturamento antes de excluir.'
    );
  }

  /**
   * Delete a task
   */
  async delete(id: string, userId?: string): Promise<TaskDeleteResponse> {
    // ── O DINHEIRO VEM ANTES DA ASSINATURA ────────────────────────────────────
    //
    // A assinatura DEGRADA para cancelamento (nada é apagado); o dinheiro RECUSA.
    // Perguntar primeiro ao dinheiro é o que impede um veículo já faturado de
    // entrar no caminho do cancelamento automático, que desmonta a cobrança.
    const bloqueadosPorDinheiro = await this.findMoneyLockedTaskIds([id]);
    if (bloqueadosPorDinheiro.length > 0) {
      throw new BadRequestException(this.moneyLockedDeletionMessage(bloqueadosPorDinheiro));
    }

    // Assinatura eletrônica: quando o orçamento da tarefa já tem assinatura
    // coletada ou envelope selado, a exclusão degrada para cancelamento
    // automático (nada é apagado). Fora do try porque erros do cancelamento
    // (ex.: boleto com baixa não confirmada) precisam chegar legíveis, não
    // convertidos em 500.
    const protectedTaskIds = await this.signatureDeletion.findProtectedTaskIds([id]);
    if (protectedTaskIds.length > 0) {
      return this.cancelTaskInsteadOfDelete(id, userId);
    }

    try {
      const purged = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const task = await this.tasksRepository.findByIdWithTransaction(tx, id);

        if (!task) {
          throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
        }

        // O envelope congela nº de série, placa, serviços e responsáveis DESTA
        // tarefa. Sem a tarefa, um envelope RUNNING seguiria mandando link de
        // assinatura por WhatsApp e sendo varrido pelo scheduler de expiração —
        // apontando para um documento cujo objeto não existe mais. Só envelopes
        // não vinculantes chegam aqui: os assinados já foram barrados acima.
        const purgeResult = await this.signatureDeletion.purgeForTasks(tx, [id]);

        // Log deletion
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TASK,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: extractEssentialFields(
            task,
            getEssentialFields(ENTITY_TYPE.TASK) as (keyof Task)[],
          ),
          reason: 'Tarefa excluída do sistema',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.tasksRepository.deleteWithTransaction(tx, id);

        // ── O ORÇAMENTO QUE FICOU SEM NENHUM VEÍCULO ─────────────────────────
        //
        // A chave estrangeira mora do lado da TAREFA (`Task.quoteId`), então
        // apagar a tarefa não toca no orçamento: ele simplesmente fica sem
        // veículo. Em produção, 17/09/2026, há 105 assim — o mais antigo de
        // janeiro, todos com serviços, 32 marcados como APROVADOS. Nenhum tem
        // fatura viva nem um centavo recebido: são resíduo, não valor perdido.
        //
        // Eles eram INVISÍVEIS enquanto a lista consultava tarefas. Quando ela
        // passou a consultar orçamentos, apareceram de uma vez e ocuparam a
        // primeira página com linhas sem logomarca, sem identificador e sem
        // veículo — e a tela parecia quebrada.
        //
        // CANCELA, não apaga. Um orçamento sem veículo não pode ser cotado,
        // assinado nem cobrado: está morto. Mas apagá-lo destruiria o número, o
        // histórico e a lista de serviços que alguém escreveu — e o número é o
        // que o cliente tem no e-mail. Cancelar tira das telas operacionais (que
        // filtram por estado), preserva o registro e é reversível.
        //
        // Só quando foi o ÚLTIMO: num orçamento de quatro implementos, apagar um
        // deixa três, e aí o que cabe é recalcular — que é o que
        // `deleteWithTransaction` já faz.
        await this.cancelBudgetsLeftWithoutVehicles(tx, [task.quoteId], userId);

        return purgeResult;
      });

      await this.signatureDeletion.unlinkFrozenDocuments(purged.frozenDocumentPaths);

      return {
        success: true,
        message: 'Tarefa excluída com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao excluir tarefa:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      rethrowPrismaValidationAsBadRequest(error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao excluir a tarefa. Tente novamente.',
      );
    }
  }

  /**
   * O ORÇAMENTO QUE FICOU SEM NENHUM VEÍCULO — cancela, não apaga.
   *
   * A chave estrangeira mora do lado da TAREFA (`Task.quoteId`), então apagar a
   * tarefa não toca no orçamento: ele simplesmente fica sem veículo. Em produção,
   * 17/09/2026, há 105 assim — o mais antigo de janeiro, todos com serviços, 32
   * marcados como APROVADOS. Nenhum tem fatura viva nem um centavo recebido: são
   * resíduo, não valor perdido. Eram INVISÍVEIS enquanto a lista consultava
   * tarefas; quando ela passou a consultar orçamentos, apareceram de uma vez e
   * ocuparam a primeira página com linhas sem veículo, e a tela parecia quebrada.
   *
   * CANCELA, não apaga. Um orçamento sem veículo não pode ser cotado, assinado nem
   * cobrado: está morto. Mas apagá-lo destruiria o número, o histórico e a lista de
   * serviços que alguém escreveu — e o número é o que o cliente tem no e-mail.
   * Cancelar tira das telas operacionais (que filtram por estado), preserva o
   * registro e é reversível.
   *
   * Só quando foi o ÚLTIMO: num orçamento de quatro implementos, apagar um deixa
   * três, e aí o que cabe é recalcular — que é o que `deleteWithTransaction` faz.
   *
   * ⚠️ EXTRAÍDA DE DENTRO DO `delete` UNITÁRIO. O bloco existia lá e NÃO existia
   * no `batchDelete`, então apagar os quatro últimos veículos de uma vez produzia
   * mais um resíduo dos 105 que este código existe para não criar. Um comportamento
   * que depende de por qual botão se chega não é comportamento, é acidente.
   */
  private async cancelBudgetsLeftWithoutVehicles(
    tx: PrismaTransaction,
    quoteIds: Array<string | null | undefined>,
    userId?: string,
  ): Promise<void> {
    const ids = [...new Set(quoteIds.filter((q): q is string => !!q))];
    for (const quoteId of ids) {
      const restantes = await tx.task.count({ where: { quoteId } });
      if (restantes > 0) continue;
      const orcamento = await tx.budget.findUnique({
        where: { id: quoteId },
        select: { id: true, budgetNumber: true, status: true },
      });
      if (!orcamento || orcamento.status === TASK_QUOTE_STATUS.CANCELLED) continue;
      await tx.budget.update({
        where: { id: orcamento.id },
        data: {
          status: TASK_QUOTE_STATUS.CANCELLED,
          statusOrder: getTaskQuoteStatusOrder(TASK_QUOTE_STATUS.CANCELLED),
        },
      });
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.TASK_QUOTE,
        entityId: orcamento.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'status',
        oldValue: orcamento.status,
        newValue: TASK_QUOTE_STATUS.CANCELLED,
        reason:
          `Cancelado automaticamente: o último veículo do orçamento nº ` +
          `${orcamento.budgetNumber} foi excluído.`,
        userId: userId || '',
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM as any,
        triggeredById: userId || null,
        transaction: tx,
      });
    }
  }

  /**
   * Batch delete tasks
   */
  async batchDelete(
    data: TaskBatchDeleteFormData,
    userId?: string,
  ): Promise<TaskBatchDeleteResponse> {
    // ── O DINHEIRO RECUSA O LOTE INTEIRO ──────────────────────────────────────
    //
    // Em lote a recusa é de tudo, de propósito: excluir "as outras" e recusar
    // caladamente as faturadas deixaria o operador com um resumo em que a conta
    // não fecha e, pior, com metade de um lote de sessenta apagada. A frase
    // NOMEIA os veículos, então a ação seguinte (tirá-los da seleção, ou reverter
    // o faturamento) é óbvia.
    //
    // Nada disto era verificado: `batchDelete` consultava só a guarda de
    // ASSINATURA, e o `Cascade` do banco levava cobertura e fatura junto.
    const bloqueadosPorDinheiro = await this.findMoneyLockedTaskIds(data.taskIds);
    if (bloqueadosPorDinheiro.length > 0) {
      throw new BadRequestException(this.moneyLockedDeletionMessage(bloqueadosPorDinheiro));
    }

    // Tarefas com orçamento assinado não são excluídas: cada uma degrada para
    // cancelamento automático (tarefa + orçamento CANCELLED, envelope
    // preservado). As demais seguem para a exclusão normal, e o resumo final
    // reporta as duas contagens separadamente para o operador enxergar o que
    // NÃO foi apagado.
    const protectedTaskIds = await this.signatureDeletion.findProtectedTaskIds(data.taskIds);
    const deletableTaskIds = data.taskIds.filter(id => !protectedTaskIds.includes(id));

    let cancelledCount = 0;
    const cancelFailures: string[] = [];
    for (const taskId of protectedTaskIds) {
      try {
        await this.cancelTaskInsteadOfDelete(taskId, userId);
        cancelledCount++;
      } catch (error) {
        cancelFailures.push(`${taskId}: ${error instanceof Error ? error.message : String(error)}`);
        this.logger.error(`[batchDelete] Falha ao cancelar tarefa protegida ${taskId}:`, error);
      }
    }

    if (deletableTaskIds.length === 0) {
      const cancelMessage =
        cancelledCount === 1
          ? '1 tarefa possuía assinatura eletrônica coletada e foi cancelada (não excluída), preservando o documento assinado'
          : `${cancelledCount} tarefas possuíam assinatura eletrônica coletada e foram canceladas (não excluídas), preservando os documentos assinados`;
      return {
        success: cancelFailures.length === 0,
        message:
          cancelledCount > 0
            ? cancelMessage
            : `Nenhuma tarefa excluída${cancelFailures.length ? `: ${cancelFailures.join('; ')}` : ''}`,
        data: {
          success: [],
          failed: [],
          totalProcessed: data.taskIds.length,
          totalSuccess: cancelledCount,
          totalFailed: cancelFailures.length,
        },
      } as any;
    }

    try {
      const { result, purged } = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const purgeResult = await this.signatureDeletion.purgeForTasks(tx, deletableTaskIds);

        // Get tasks before deletion for logging
        const tasks = await this.tasksRepository.findByIdsWithTransaction(tx, deletableTaskIds);

        // Log deletions
        for (const task of tasks) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: extractEssentialFields(
              task,
              getEssentialFields(ENTITY_TYPE.TASK) as (keyof Task)[],
            ),
            reason: 'Tarefa excluída em operação de lote',
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            transaction: tx,
          });
        }

        // Os orçamentos tocados pelo lote, lidos ANTES da exclusão — depois dela
        // a FK já se foi e não há como saber de qual orçamento cada tarefa era.
        const quoteIdsTocados = tasks.map(t => (t as any).quoteId as string | null);

        // Batch delete
        const result = await this.tasksRepository.deleteManyWithTransaction(tx, deletableTaskIds);

        // O MESMO desmonte do `delete` unitário: o orçamento que perdeu o último
        // veículo é cancelado. Faltava aqui, e apagar os quatro últimos de uma vez
        // deixava o orçamento vivo e sem ninguém.
        await this.cancelBudgetsLeftWithoutVehicles(tx, quoteIdsTocados, userId);

        return { result, purged: purgeResult };
      });

      await this.signatureDeletion.unlinkFrozenDocuments(purged.frozenDocumentPaths);

      const successMessage =
        result.totalDeleted === 1
          ? '1 tarefa excluída com sucesso'
          : `${result.totalDeleted} tarefas excluídas com sucesso`;
      const cancelledMessage =
        cancelledCount > 0
          ? `, ${cancelledCount} com assinatura eletrônica coletada ${
              cancelledCount === 1 ? 'foi cancelada' : 'foram canceladas'
            } (não excluída${cancelledCount === 1 ? '' : 's'}) para preservar o documento assinado`
          : '';
      const failureMessage =
        result.totalFailed + cancelFailures.length > 0
          ? `, ${result.totalFailed + cancelFailures.length} falharam`
          : '';

      // Convert BatchDeleteResult to BatchOperationResult
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalDeleted + result.totalFailed,
        totalSuccess: result.totalDeleted,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${cancelledMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na exclusão em lote:', error);
      rethrowPrismaValidationAsBadRequest(error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
    }
  }

  /**
   * Find a task by ID
   */
  async findById(
    id: string,
    include?: TaskInclude,
    userRole?: string,
  ): Promise<TaskGetUniqueResponse> {
    try {
      const task = await this.tasksRepository.findById(id, { include });

      if (!task) {
        throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
      }

      filterImplementArtForRole(task, userRole);

      // Debug logging for logo paints
      this.logger.log(`[Task findById] Task ${task.id} (${task.name}):`);
      this.logger.log(
        `  - General painting: ${task.generalPainting ? task.generalPainting.name : 'none'}`,
      );
      this.logger.log(`  - Logo paints count: ${task.logoPaints?.length || 0}`);
      if (task.logoPaints && task.logoPaints.length > 0) {
        this.logger.log(
          `  - Logo paints: ${JSON.stringify(task.logoPaints.map(p => ({ id: p.id, name: p.name, paintType: p.paintType?.name, paintBrand: p.paintBrand?.name })))}`,
        );
      }

      return {
        success: true,
        message: 'Tarefa carregada com sucesso.',
        data: task,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar tarefa por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      // ⛔ O INCLUDE COM CHAVE INVENTADA MERECE NOME, NÃO 500.
      //
      // `taskIncludeSchema` valida include ANINHADO como `z.record` — é
      // passthrough (`schemas/task.ts:1098`). Uma relação que não existe mais
      // atravessa o zod inteiro e só morre no Prisma, e aqui virava "Erro
      // interno do servidor. Tente novamente." — uma frase que manda o
      // desenvolvedor procurar no lugar errado.
      //
      // Custou caro DUAS vezes com a MESMA relação: `BudgetPayer.responsible`
      // saiu na migration `20260918120000` e ficou em dois includes do web
      // (`task-detail-page.tsx` e `billing/details/[id].tsx`), derrubando as
      // duas telas inteiras sem nenhuma pista. Nomear a chave transforma uma
      // hora de arqueologia num conserto de uma linha.
      //
      // Desde o G1 a chave inventada é recusada na ROTA, com o caminho inteiro
      // (`query-shape.guard.ts`); isto fica como rede para consulta montada aqui
      // dentro.
      const chaveDesconhecida = unknownPrismaKeyOf(error);
      if (chaveDesconhecida) {
        throw new BadRequestException(
          `O include pede a relação "${chaveDesconhecida}", que não existe no modelo. ` +
            'Confira se ela foi removida numa migration — o schema de include de tarefa ' +
            'aceita chave aninhada desconhecida sem reclamar, e o erro só aparece aqui.',
        );
      }
      rethrowPrismaValidationAsBadRequest(error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar a tarefa. Tente novamente.',
      );
    }
  }

  /**
   * Find many tasks with filtering
   */
  async findMany(query: TaskGetManyFormData, userRole?: string): Promise<TaskGetManyResponse> {
    try {
      console.log('[TaskService.findMany] Query received:', {
        hasWhere: !!query.where,
        whereKeys: query.where ? Object.keys(query.where) : [],
        whereStringified: query.where ? JSON.stringify(query.where).substring(0, 200) : 'undefined',
        searchingFor: (query as any).searchingFor,
        page: query.page,
        limit: query.limit,
      });

      // The schema transform already handles searchingFor and converts it to where clause
      // No need for additional handling here
      const params = {
        where: query.where,
        page: query.page,
        take: query.limit,
        orderBy: query.orderBy as TaskOrderBy,
        include: query.include as TaskInclude,
        select: query.select,
      };

      const result = await this.tasksRepository.findMany(params);

      for (const task of result.data) filterImplementArtForRole(task, userRole);

      return {
        success: true,
        message: 'Tarefas carregadas com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar tarefas:', error);
      rethrowPrismaValidationAsBadRequest(error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar as tarefas. Tente novamente.',
      );
    }
  }

  /**
   * Migrate task files when customer changes.
   * Moves files on disk and updates File.path in DB for all file relations.
   */
  private async migrateTaskFilesOnCustomerChange(
    taskId: string,
    oldCustomerName: string,
    newCustomerName: string,
    tx: PrismaTransaction,
  ): Promise<void> {
    this.logger.log(
      `[Task File Migration] Migrating files from "${oldCustomerName}" to "${newCustomerName}" for task ${taskId}`,
    );

    // Sanitize customer names for path matching (same logic as FilesStorageService.sanitizeFileName)
    const sanitize = (name: string) =>
      name
        .replace(/[<>:"|?*\x00-\x1f]/g, '_')
        .replace(/\.\./g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
    const sanitizeOld = sanitize(oldCustomerName);
    const sanitizeNew = sanitize(newCustomerName);

    if (sanitizeOld === sanitizeNew) {
      this.logger.log('[Task File Migration] Sanitized names are identical, skipping');
      return;
    }

    // Fetch task with ALL file relations
    const task = await tx.task.findUnique({
      where: { id: taskId },
      include: {
        baseFiles: true,
        projectFiles: true,
        checkinFiles: true,
        checkoutFiles: true,
        budgets: true,
        invoices: true,
        receipts: true,
        bankSlips: true,
        reimbursements: true,
        invoiceReimbursements: true,
        // A arte, o projeto do implemento e a plaqueta moram no IMPLEMENTO (R2, R6).
        implement: {
          include: { layouts: { include: { file: true } }, projectFiles: true, vinPlate: true },
        },
        // Airbrushing files live under Clientes/{cliente}/Aerografias/ (an airbrushing
        // Layout has airbrushingId set), so they must be collected explicitly or they
        // stay behind in the OLD customer's folder.
        airbrushings: {
          include: {
            layouts: { include: { file: true } },
            receipts: true,
            invoices: true,
          },
        },
      },
    });

    if (!task) return;

    // Collect all files to migrate (direct file relations)
    const allFiles: Array<{ id: string; path: string }> = [
      ...(task.baseFiles || []),
      ...(task.projectFiles || []),
      ...(task.checkinFiles || []),
      ...(task.checkoutFiles || []),
      ...(task.budgets || []),
      ...(task.invoices || []),
      ...(task.receipts || []),
      ...(task.bankSlips || []),
      ...(task.reimbursements || []),
      ...(task.invoiceReimbursements || []),
    ];

    // A arte, o projeto do implemento e a plaqueta (o implemento é da tarefa)
    for (const layout of task.implement?.layouts || []) {
      if (layout.file) allFiles.push(layout.file);
    }
    allFiles.push(...(task.implement?.projectFiles || []));
    if (task.implement?.vinPlate) allFiles.push(task.implement.vinPlate);

    // Add airbrushing files (layouts + receipts + invoices)
    for (const airbrushing of (task as any).airbrushings || []) {
      for (const layout of airbrushing.layouts || []) {
        if (layout.file) allFiles.push(layout.file);
      }
      allFiles.push(...(airbrushing.receipts || []), ...(airbrushing.invoices || []));
    }

    let migratedCount = 0;
    for (const file of allFiles) {
      if (!file.path || !file.path.includes(`/${sanitizeOld}/`)) continue;

      const newPath = file.path.replace(`/Clientes/${sanitizeOld}/`, `/Clientes/${sanitizeNew}/`);

      try {
        // Move file on disk
        await this.filesStorageService.moveWithinStorage(file.path, newPath);

        // Update path in database
        await tx.file.update({
          where: { id: file.id },
          data: { path: newPath },
        });

        migratedCount++;
      } catch (error: any) {
        this.logger.warn(
          `[Task File Migration] Failed to migrate file ${file.id}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `[Task File Migration] Migrated ${migratedCount}/${allFiles.length} files for task ${taskId}`,
    );
  }

  /**
   * Move task files from root-level paths into a customer folder.
   * Called when a task that had no customer gets a customer assigned.
   * Files in generic paths (no /Clientes/ prefix) get moved into Clientes/{customerName}/.
   */
  private async migrateTaskFilesToCustomerFolder(
    taskId: string,
    customerName: string,
    tx: PrismaTransaction,
  ): Promise<void> {
    this.logger.log(
      `[Task File Migration] Moving files to customer folder "${customerName}" for task ${taskId}`,
    );

    const sanitize = (name: string) =>
      name
        .replace(/[<>:"|?*\x00-\x1f]/g, '_')
        .replace(/\.\./g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
    const sanitizedCustomer = sanitize(customerName);
    const filesRoot = this.filesStorageService.getFilesRoot();

    // Fetch task with ALL file relations
    const task = await tx.task.findUnique({
      where: { id: taskId },
      include: {
        baseFiles: true,
        projectFiles: true,
        checkinFiles: true,
        checkoutFiles: true,
        budgets: true,
        invoices: true,
        receipts: true,
        bankSlips: true,
        reimbursements: true,
        invoiceReimbursements: true,
        implement: {
          include: { layouts: { include: { file: true } }, projectFiles: true, vinPlate: true },
        },
        // See migrateTaskFilesOnCustomerChange — airbrushing files must be collected
        // explicitly.
        airbrushings: {
          include: {
            layouts: { include: { file: true } },
            receipts: true,
            invoices: true,
          },
        },
      },
    });

    if (!task) return;

    // Map of root-level folder prefixes to their new entity-first equivalents
    const rootToEntityMap: Array<{ rootPrefix: string; entitySuffix: string }> = [
      { rootPrefix: '/Checkin/', entitySuffix: '/Checkin/' },
      { rootPrefix: '/Checkout/', entitySuffix: '/Checkout/' },
      { rootPrefix: '/Projetos/', entitySuffix: '/Projetos/' },
      { rootPrefix: '/ImplementMeasures/', entitySuffix: '/ImplementMeasures/' },
      { rootPrefix: '/Outros/', entitySuffix: '/Outros/' },
      { rootPrefix: '/Observacoes/', entitySuffix: '/Observacoes/' },
      { rootPrefix: '/Traseiras/', entitySuffix: '/Traseiras/' },
      { rootPrefix: '/Plotter/', entitySuffix: '/Plotter/' },
      { rootPrefix: '/Orcamentos/', entitySuffix: '/Orcamentos/' },
      { rootPrefix: '/Notas Fiscais Reembolso/', entitySuffix: '/Notas Fiscais Reembolso/' },
      { rootPrefix: '/Notas Fiscais/', entitySuffix: '/Notas Fiscais/' },
      { rootPrefix: '/Comprovantes/', entitySuffix: '/Comprovantes/' },
      { rootPrefix: '/Boletos/', entitySuffix: '/Boletos/' },
      { rootPrefix: '/Reembolsos/', entitySuffix: '/Reembolsos/' },
      // '/Aerografias/' MUST precede '/Layouts/': a legacy '/Aerografias/Layouts/...'
      // path has to remap as an airbrushing folder, not as a task layout folder.
      { rootPrefix: '/Aerografias/', entitySuffix: '/Aerografias/' },
      { rootPrefix: '/Layouts/', entitySuffix: '/Layouts/' },
    ];

    const allFiles: Array<{ id: string; path: string }> = [
      ...(task.baseFiles || []),
      ...(task.projectFiles || []),
      ...(task.checkinFiles || []),
      ...(task.checkoutFiles || []),
      ...(task.budgets || []),
      ...(task.invoices || []),
      ...(task.receipts || []),
      ...(task.bankSlips || []),
      ...(task.reimbursements || []),
      ...(task.invoiceReimbursements || []),
    ];

    // A arte, o projeto do implemento e a plaqueta (o implemento é da tarefa)
    for (const layout of task.implement?.layouts || []) {
      if (layout.file) allFiles.push(layout.file);
    }
    allFiles.push(...(task.implement?.projectFiles || []));
    if (task.implement?.vinPlate) allFiles.push(task.implement.vinPlate);

    for (const airbrushing of (task as any).airbrushings || []) {
      for (const layout of airbrushing.layouts || []) {
        if (layout.file) allFiles.push(layout.file);
      }
      allFiles.push(...(airbrushing.receipts || []), ...(airbrushing.invoices || []));
    }

    let migratedCount = 0;
    for (const file of allFiles) {
      if (!file.path) continue;
      // Skip if already in a proper customer folder (not the catch-all Outros)
      if (file.path.includes('/Clientes/') && !file.path.includes('/Clientes/Outros/')) continue;

      let newPath: string | null = null;

      // Case 1: File is in Clientes/Outros/ catch-all — move to Clientes/{customer}/
      if (file.path.includes('/Clientes/Outros/')) {
        newPath = file.path.replace('/Clientes/Outros/', `/Clientes/${sanitizedCustomer}/`);
      } else {
        // Case 2: File is in a root-level path (legacy) — find and remap
        const pathAfterRoot = file.path.replace(filesRoot, '');

        for (const { rootPrefix, entitySuffix } of rootToEntityMap) {
          if (pathAfterRoot.includes(rootPrefix)) {
            const afterPrefix = pathAfterRoot.split(rootPrefix).slice(1).join(rootPrefix);
            newPath = `${filesRoot}/Clientes/${sanitizedCustomer}${entitySuffix}${afterPrefix}`;
            break;
          }
        }
      }

      if (!newPath || newPath === file.path) continue;

      try {
        await this.filesStorageService.moveWithinStorage(file.path, newPath);
        await tx.file.update({
          where: { id: file.id },
          data: { path: newPath },
        });
        migratedCount++;
      } catch (error: any) {
        this.logger.warn(
          `[Task File Migration] Failed to migrate file ${file.id} to customer folder: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `[Task File Migration] Migrated ${migratedCount}/${allFiles.length} files to customer folder for task ${taskId}`,
    );
  }

  private async validateTask(
    data: Partial<TaskCreateFormData | TaskUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validate customer exists (only if customerId is provided)
    if (data.customerId) {
      const customer = await transaction.customer.findUnique({ where: { id: data.customerId } });
      if (!customer) {
        throw new NotFoundException('Cliente não encontrado.');
      }
    }

    // Services are created inline with the task, no need to validate they exist

    // Validate user exists
    if ('createdById' in data && (data as any).createdById) {
      const user = await transaction.user.findUnique({ where: { id: (data as any).createdById } });
      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }
    }

    // Validate sector exists if provided
    if (data.sectorId) {
      const sector = await transaction.sector.findUnique({ where: { id: data.sectorId } });
      if (!sector) {
        throw new NotFoundException('Setor não encontrado.');
      }
    }

    // Validate painters of nested airbrushings exist (avoids generic Prisma FK errors)
    const nestedAirbrushings = (data as any).airbrushings;
    if (nestedAirbrushings && Array.isArray(nestedAirbrushings)) {
      for (const airbrushing of nestedAirbrushings) {
        if (airbrushing?.painterId) {
          const painter = await transaction.user.findUnique({
            where: { id: airbrushing.painterId },
          });
          if (!painter) {
            throw new NotFoundException('Pintor não encontrado.');
          }
        }
      }
    }

    // Validate status-specific requirements
    if (data.status) {
      // For update, we need to check the existing task
      let existingTask: { status: any; startedAt: Date | null; finishedAt: Date | null } | null =
        null;
      if (existingId) {
        existingTask = await transaction.task.findUnique({
          where: { id: existingId },
          select: { status: true, startedAt: true, finishedAt: true },
        });
      }

      // If status is IN_PRODUCTION, require startedAt
      if ((data.status as TASK_STATUS) === TASK_STATUS.IN_PRODUCTION) {
        const hasStartedAt = data.startedAt || existingTask?.startedAt;
        if (!hasStartedAt) {
          throw new BadRequestException('Data de início é obrigatória para tarefas em produção.');
        }
      }

      // If status is COMPLETED, require finishedAt
      if ((data.status as TASK_STATUS) === TASK_STATUS.COMPLETED) {
        const hasFinishedAt = data.finishedAt || existingTask?.finishedAt;
        if (!hasFinishedAt) {
          throw new BadRequestException('Data de conclusão é obrigatória para tarefas concluídas.');
        }

        // Ensure finishedAt >= startedAt (allow same timestamp for instant completion)
        const startedAt = data.startedAt || existingTask?.startedAt;
        const finishedAt = data.finishedAt || existingTask?.finishedAt;

        if (startedAt && finishedAt) {
          const startDate = new Date(startedAt);
          const finishDate = new Date(finishedAt);

          if (finishDate < startDate) {
            throw new BadRequestException(
              'Data de conclusão deve ser posterior ou igual à data de início.',
            );
          }
        }
      }
    }

    // A SÉRIE (DD1): mora no implemento, e o corpo só a traz em
    // `implement.serialNumber`. Unicidade no IMPLEMENTO (`Implement_serialNumber_key`).
    const serial = (data as any).implement?.serialNumber;
    if (serial) {
      // V15: na EDIÇÃO, a regra da série vale só quando ela MUDA — as 42 séries
      // antigas fora da regra migraram como estavam, e o app reenvia a série
      // inteira a cada gravação.
      if (existingId) {
        const current = await transaction.implement.findUnique({
          where: { taskId: existingId },
          select: { serialNumber: true },
        });
        if ((current?.serialNumber ?? null) !== serial && !SERIAL_NUMBER_PATTERN.test(serial)) {
          throw new BadRequestException(SERIAL_NUMBER_PATTERN_MESSAGE);
        }
      }
      const existing = await transaction.implement.findFirst({
        where: {
          serialNumber: serial,
          ...(existingId && { taskId: { not: existingId } }),
        },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException('Número de série já está em uso.');
      }
    }

    // Placa única (a placa é do implemento)
    const plate = (data as any).implement?.plate;
    if (plate) {
      const existing = await transaction.implement.findFirst({
        where: {
          plate: plate,
          ...(existingId && { taskId: { not: existingId } }),
        },
      });
      if (existing) {
        throw new BadRequestException('Placa já está cadastrada.');
      }
    }
  }

  /**
   * W6: a série a restaurar não pode estar em outra tarefa (unicidade no
   * implemento, DD1). Sem esta checagem o conflito virava P2002 → 500.
   */
  private async assertSerialFreeForRollback(
    tx: PrismaTransaction,
    serial: unknown,
    taskId: string,
  ): Promise<void> {
    if (typeof serial !== 'string' || serial === '') return;
    const owner = await tx.implement.findFirst({
      where: { serialNumber: serial, NOT: { taskId } },
      select: { taskId: true },
    });
    if (owner) {
      throw new BadRequestException(
        `Não é possível reverter: o número de série ${serial} já está em uso em outra tarefa.`,
      );
    }
  }

  /**
   * Rollback a field change based on a changelog entry
   * Reverts the specified field to its previous value from the changelog
   */
  async rollbackFieldChange(changeLogId: string, userId: string): Promise<TaskUpdateResponse> {
    // ORÇAMENTOS REESCRITOS POR ESTE DESFAZER.
    //
    // O gancho de assinatura roda DEPOIS do commit: `onQuoteContentChanged`
    // remonta o recorte canônico lendo o banco por outra conexão e, de dentro da
    // transação, enxergaria a lista anterior e concluiria que nada mudou.
    const quotesContentChanged = new Set<string>();
    const rollbackResult = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // 1. Get the changelog entry
      const changeLog = await tx.changeLog.findUnique({
        where: { id: changeLogId },
      });

      if (!changeLog) {
        throw new NotFoundException('Entrada de changelog não encontrada');
      }

      // Support TASK, SERVICE_ORDER, and IMPLEMENT entity types
      const supportedEntityTypes = [
        'TASK',
        'SERVICE_ORDER',
        'IMPLEMENT',
        'TASK_QUOTE',
        'TASK_QUOTE_SERVICE',
      ];
      if (!supportedEntityTypes.includes(changeLog.entityType)) {
        throw new BadRequestException(
          `Rollback não suportado para entidade do tipo '${changeLog.entityType}'`,
        );
      }

      // Handle SERVICE_ORDER and TRUCK rollback with generic field update
      if (changeLog.entityType === 'SERVICE_ORDER') {
        const fieldToRevert = changeLog.field;
        if (!fieldToRevert) {
          throw new BadRequestException('Não é possível reverter: campo não especificado');
        }

        // statusOrder is derived - skip direct rollback
        if (fieldToRevert === 'statusOrder') {
          throw new BadRequestException(
            'statusOrder é calculado automaticamente a partir do status',
          );
        }

        let convertedValue: any = changeLog.oldValue;
        if (convertedValue === null || convertedValue === undefined || convertedValue === '') {
          convertedValue = null;
        } else if (
          ['startedAt', 'finishedAt', 'approvedAt', 'completedAt'].includes(fieldToRevert)
        ) {
          const parsed = new Date(convertedValue as string);
          convertedValue = isNaN(parsed.getTime()) ? null : parsed;
        }

        const updateData: any = { [fieldToRevert]: convertedValue };

        // When rolling back status, also update statusOrder and clear progress data if going back to PENDING
        if (fieldToRevert === 'status' && convertedValue) {
          const statusOrderMap: Record<string, number> = {
            PENDING: 1,
            IN_PROGRESS: 2,
            WAITING_APPROVE: 3,
            COMPLETED: 4,
            CANCELLED: 5,
          };
          updateData.statusOrder = statusOrderMap[convertedValue] ?? 1;

          // If reverting to PENDING, clear all progress data
          if (convertedValue === 'PENDING') {
            updateData.startedById = null;
            updateData.startedAt = null;
            updateData.approvedById = null;
            updateData.approvedAt = null;
            updateData.completedById = null;
            updateData.finishedAt = null;
          }
        }

        // When rolling back startedById to null, also revert status to PENDING and clear progress timestamps
        if (fieldToRevert === 'startedById' && convertedValue === null) {
          updateData.status = 'PENDING';
          updateData.statusOrder = 1;
          updateData.startedAt = null;
        }

        await tx.serviceOrder.update({
          where: { id: changeLog.entityId },
          data: updateData,
        });

        const fieldNamePt = translateFieldName(fieldToRevert);
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.SERVICE_ORDER,
          entityId: changeLog.entityId,
          action: CHANGE_ACTION.ROLLBACK,
          field: fieldToRevert,
          oldValue: changeLog.newValue,
          newValue: changeLog.oldValue,
          reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: changeLog.entityId,
          userId,
          transaction: tx,
        });

        return {
          success: true,
          message: `Campo '${fieldNamePt}' revertido com sucesso`,
          data: null,
        };
      }

      if (changeLog.entityType === 'IMPLEMENT') {
        const loggedField = changeLog.field;
        if (!loggedField) {
          throw new BadRequestException('Não é possível reverter: campo não especificado');
        }
        // O histórico do implemento grava a coluna (`type`, `serialNumber`…); a
        // migração 20260930120060 trouxe os nomes antigos para os de hoje.
        const fieldToRevert = resolveImplementColumn(loggedField);
        if (!fieldToRevert) {
          throw new BadRequestException(
            `Não é possível reverter "${loggedField}": o campo não existe mais no implemento.`,
          );
        }

        let convertedValue: any = changeLog.oldValue;
        if (convertedValue === null || convertedValue === undefined || convertedValue === '') {
          convertedValue = null;
        }

        // Coluna de face: pelo escritor único (reverter não pode compartilhar
        // linha nem deixar a atual órfã).
        const revertedFace = faceOf(fieldToRevert);
        if (revertedFace && FACE_FK[revertedFace] === fieldToRevert) {
          await this.restoreFaceFromChangelog(tx, changeLog.entityId, revertedFace, convertedValue);
        } else {
          if (fieldToRevert === 'serialNumber') {
            const owner = await tx.implement.findUnique({
              where: { id: changeLog.entityId },
              select: { taskId: true },
            });
            await this.assertSerialFreeForRollback(tx, convertedValue, owner?.taskId ?? '');
          }
          await tx.implement.update({
            where: { id: changeLog.entityId },
            data: { [fieldToRevert]: convertedValue },
          });
        }

        const fieldNamePt = translateFieldName(fieldToRevert);
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.IMPLEMENT,
          entityId: changeLog.entityId,
          action: CHANGE_ACTION.ROLLBACK,
          field: fieldToRevert,
          oldValue: changeLog.newValue,
          newValue: changeLog.oldValue,
          reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: changeLog.entityId,
          userId,
          transaction: tx,
        });

        return {
          success: true,
          message: `Campo '${fieldNamePt}' revertido com sucesso`,
          data: null,
        };
      }

      // Handle TASK_QUOTE rollback
      if (changeLog.entityType === 'TASK_QUOTE') {
        const fieldToRevert = changeLog.field;
        if (!fieldToRevert) {
          throw new BadRequestException('Não é possível reverter: campo não especificado');
        }

        // A arte saiu do orçamento (R1): o histórico antigo de layout do orçamento
        // não tem mais onde ser gravado (§6.2 item 31).
        if (['layoutFileIds', 'layoutFiles', 'layouts', 'layoutCoverage'].includes(fieldToRevert)) {
          throw new BadRequestException(
            'Não é possível desfazer a arte por aqui: a arte não é mais do orçamento, é do ' +
              'implemento de cada veículo. Use a arte do implemento (versão nova).',
          );
        }

        // ── DINHEIRO NA RUA NÃO SE DESFAZ PELO HISTÓRICO ───────────────────────
        //
        // Este caminho escreve `Budget` e `BudgetItem` direto pelo `tx`: não passa
        // por `BudgetService.update`, então nenhuma das duas guardas dela roda.
        // Com NFS-e autorizada na prefeitura e boleto registrado no Sicredi, o
        // admin clicava "Desfazer" numa alteração de preço e a tela passava a
        // mostrar um valor que nenhum documento emitido conhece.
        //
        // A lista de exceções é a MESMA de `BudgetService.update`
        // (`QUOTE_SAFE_AFTER_BILLING_FIELDS`) — validade, texto de garantia,
        // layout, status e os campos de prazo continuam reversíveis, porque não
        // são o valor cobrado. Duas listas para a mesma regra divergiriam na
        // primeira edição. `items`/`items_snapshot` não estão nela, e é isso que
        // barra o desfazer em lote da lista de serviços.
        const quoteMoneyLock = await tx.budget.findUnique({
          where: { id: changeLog.entityId },
          select: { billings: { select: { approvedAt: true, status: true } } },
        });
        if (
          isQuoteMoneyLocked(quoteMoneyLock?.billings) &&
          !QUOTE_SAFE_AFTER_BILLING_FIELDS.has(fieldToRevert)
        ) {
          throw new BadRequestException(
            `Não é possível desfazer a alteração de "${translateFieldName(fieldToRevert)}": este ` +
              'orçamento já tem cobrança aprovada, com nota fiscal e boleto emitidos sobre o valor ' +
              'atual. Para mexer no valor, reverta o faturamento primeiro (tela de Faturamento → ' +
              'Reverter).',
          );
        }

        // Legacy bulk items rollback
        if (fieldToRevert === 'items' || fieldToRevert === 'items_snapshot') {
          let parsedOldValue: any = changeLog.oldValue;
          if (typeof parsedOldValue === 'string') {
            try {
              parsedOldValue = JSON.parse(parsedOldValue);
            } catch {
              /* use as-is */
            }
          }

          if (
            parsedOldValue &&
            typeof parsedOldValue === 'object' &&
            Array.isArray(parsedOldValue.services)
          ) {
            // Delete all current items
            await tx.budgetItem.deleteMany({ where: { quoteId: changeLog.entityId } });

            // Recreate from old snapshot
            for (let i = 0; i < parsedOldValue.services.length; i++) {
              const item = parsedOldValue.services[i];
              await tx.budgetItem.create({
                data: {
                  quoteId: changeLog.entityId,
                  description: item.description || '',
                  amount: item.amount || 0,
                  observation: item.observation ?? null,
                  position: item.position !== undefined ? item.position : i,
                },
              });
            }

            // Authoritative discount-aware recompute (per-config + aggregate +
            // multi-config unassigned fold) from the restored services. Summing
            // the stale per-config subtotal/total snapshots here re-introduced
            // the aggregate-vs-config drift / dropped-discount bug.
            await this.recalcQuoteTotals(tx, changeLog.entityId);
            quotesContentChanged.add(changeLog.entityId);
          }
        } else {
          // Scalar field rollback
          let convertedValue: any = changeLog.oldValue;
          if (convertedValue === null || convertedValue === undefined || convertedValue === '') {
            convertedValue = null;
          } else if (
            [
              'subtotal',
              'total',
              'guaranteeYears',
              'customForecastDays',
              'simultaneousTasks',
              'budgetNumber',
            ].includes(fieldToRevert)
          ) {
            convertedValue = Number(convertedValue);
          } else if (['expiresAt'].includes(fieldToRevert)) {
            const parsed = new Date(convertedValue as string);
            convertedValue = isNaN(parsed.getTime()) ? null : parsed;
          }

          const rollbackData: any = { [fieldToRevert]: convertedValue };
          if (fieldToRevert === 'status' && convertedValue && typeof convertedValue === 'string') {
            // ── O ESTADO HISTÓRICO PODE NÃO EXISTIR MAIS ─────────────────────
            //
            // O ciclo do pagamento saiu do orçamento para a COBRANÇA, e com ele
            // saíram seis valores do enum: `BUDGET_APPROVED`, `BILLING_APPROVED`,
            // `COMMERCIAL_APPROVED`, `DRAFT`, `UPCOMING`, `DUE` e `PARTIAL`. O
            // `ChangeLog` guarda 468 linhas com esses `oldValue` — é histórico
            // legítimo, e nada nele está errado.
            //
            // O que estava errado era o reverter: `TASK_QUOTE_STATUS_ORDER[...]`
            // dava `undefined` (então o espelho numérico nem era gravado) e o
            // `status` inválido seguia para uma coluna ENUM. O usuário recebia o
            // erro cru do Prisma sobre um valor de enum inexistente, na tela de
            // histórico, sem nenhuma pista do que fazer.
            //
            // Recusar com nome é a resposta honesta: aquele estado não existe
            // mais, e não há para onde reverter.
            if (!(convertedValue in TASK_QUOTE_STATUS_ORDER)) {
              throw new BadRequestException(
                `Não é possível reverter para o status "${convertedValue}": ele não existe mais. ` +
                  'O ciclo de pagamento deixou de ser status do orçamento e passou a ser estado da ' +
                  'COBRANÇA (tela de Faturamento). Este registro do histórico é de antes dessa mudança.',
              );
            }
            rollbackData.statusOrder = TASK_QUOTE_STATUS_ORDER[convertedValue as TASK_QUOTE_STATUS];
          }
          await tx.budget.update({
            where: { id: changeLog.entityId },
            data: rollbackData,
          });
          quotesContentChanged.add(changeLog.entityId);
        }

        const fieldNamePt = translateFieldName(fieldToRevert);
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK_QUOTE,
          entityId: changeLog.entityId,
          action: CHANGE_ACTION.ROLLBACK,
          field: fieldToRevert,
          oldValue: changeLog.newValue,
          newValue: changeLog.oldValue,
          reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: changeLog.entityId,
          userId,
          transaction: tx,
        });

        return {
          success: true,
          message: `Campo '${fieldNamePt}' revertido com sucesso`,
          data: null,
        };
      }

      // Handle TASK_QUOTE_SERVICE rollback (also handles legacy TASK_QUOTE_ITEM records)
      if (
        changeLog.entityType === 'TASK_QUOTE_SERVICE' ||
        changeLog.entityType === ('TASK_QUOTE_ITEM' as any)
      ) {
        const quoteId = changeLog.entityId; // entityId is the quoteId
        const metadata = changeLog.metadata as any;
        const itemDescription = metadata?.itemDescription;

        // ⛔ A MESMA TRAVA DO RAMO ACIMA, e aqui sem exceções: tudo o que este
        // ramo faz é apagar, recriar ou reprecificar uma LINHA DE SERVIÇO, que é
        // exatamente o que a nota fiscal descreve e o boleto cobra.
        const serviceMoneyLock = await tx.budget.findUnique({
          where: { id: quoteId },
          select: { billings: { select: { approvedAt: true, status: true } } },
        });
        if (isQuoteMoneyLocked(serviceMoneyLock?.billings)) {
          throw new BadRequestException(
            'Não é possível desfazer alterações nos serviços deste orçamento: já há cobrança ' +
              'aprovada, com nota fiscal e boleto emitidos sobre a lista atual. Reverta o ' +
              'faturamento primeiro (tela de Faturamento → Reverter).',
          );
        }

        if (!itemDescription) {
          throw new BadRequestException(
            'Não é possível reverter: descrição do item não encontrada nos metadados',
          );
        }

        const recalculateTotals = async () => {
          // Authoritative discount-aware recompute (per-config + aggregate +
          // unassigned fold) — never sum stale per-config snapshots.
          await this.recalcQuoteTotals(tx, quoteId);
          quotesContentChanged.add(quoteId);
        };

        if (changeLog.action === 'CREATE') {
          // Undo item addition — find and delete the item
          const item = await tx.budgetItem.findFirst({
            where: { quoteId, description: itemDescription },
          });
          if (item) {
            await tx.budgetItem.delete({ where: { id: item.id } });
            await recalculateTotals();
          }
        } else if (changeLog.action === 'DELETE') {
          // Undo item removal — recreate item from oldValue
          let parsedOldValue = changeLog.oldValue;
          if (typeof parsedOldValue === 'string') {
            try {
              parsedOldValue = JSON.parse(parsedOldValue);
            } catch {
              /* use as-is */
            }
          }
          if (parsedOldValue && typeof parsedOldValue === 'object') {
            const itemData = parsedOldValue as any;
            await tx.budgetItem.create({
              data: {
                quoteId,
                description: itemData.description || itemDescription,
                amount: itemData.amount || 0,
                observation: itemData.observation ?? null,
                position: itemData.position ?? 0,
              },
            });
            await recalculateTotals();
          }
        } else if (changeLog.action === 'UPDATE') {
          // Undo field change on an existing item
          const field = changeLog.field;
          if (!field) {
            throw new BadRequestException('Não é possível reverter: campo não especificado');
          }

          const item = await tx.budgetItem.findFirst({
            where: { quoteId, description: itemDescription },
          });
          if (item) {
            let convertedValue: any = changeLog.oldValue;
            if (field === 'amount') {
              convertedValue = Number(convertedValue);
            }
            await tx.budgetItem.update({
              where: { id: item.id },
              data: { [field]: convertedValue },
            });
            // Marca SEMPRE, não só quando o valor muda: a DESCRIÇÃO da linha está
            // no recorte material do documento assinado tanto quanto o preço.
            quotesContentChanged.add(quoteId);
            if (field === 'amount') {
              await recalculateTotals();
            }
          }
        }

        const fieldNamePt = changeLog.field ? translateFieldName(changeLog.field) : 'item';
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK_QUOTE_SERVICE,
          entityId: quoteId,
          action: CHANGE_ACTION.ROLLBACK,
          field: changeLog.field || null,
          oldValue: changeLog.newValue,
          newValue: changeLog.oldValue,
          reason: `Item '${itemDescription}' — ${fieldNamePt} revertido via changelog ${changeLogId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: quoteId,
          userId,
          transaction: tx,
          metadata: { itemDescription },
        });

        return {
          success: true,
          message: `Item '${itemDescription}' revertido com sucesso`,
          data: null,
        };
      }

      // 2. Get current task (TASK entity type)
      const currentTask = await this.tasksRepository.findByIdWithTransaction(
        tx,
        changeLog.entityId,
      );

      if (!currentTask) {
        throw new NotFoundException('Tarefa não encontrada');
      }

      // 3. Extract the field and old value from changelog
      const fieldToRevert = changeLog.field;
      const oldValue = changeLog.oldValue;

      if (!fieldToRevert) {
        throw new BadRequestException(
          'Não é possível reverter: campo não especificado na entrada de changelog',
        );
      }

      // 4. Convert oldValue to appropriate type based on field
      let convertedValue: any = oldValue;

      // Handle null, undefined, and empty string values
      if (oldValue === null || oldValue === undefined || oldValue === '') {
        convertedValue = null;
      }
      // Handle date fields
      else if (
        [
          'startedAt',
          'finishedAt',
          'entryDate',
          'term',
          'createdAt',
          'updatedAt',
          'forecastDate',
        ].includes(fieldToRevert)
      ) {
        // Dates must be either a valid Date object or null, never empty string
        const parsed = new Date(oldValue as string);
        convertedValue = isNaN(parsed.getTime()) ? null : parsed;
      }
      // Handle number fields
      else if (['statusOrder'].includes(fieldToRevert)) {
        convertedValue = typeof oldValue === 'number' ? oldValue : parseInt(oldValue as string, 10);
      }
      // Handle enum fields (status, bonification) - must not be empty string
      else if (['status', 'bonification', 'priority'].includes(fieldToRevert)) {
        convertedValue = oldValue as string;
      }
      // Handle UUID/string fields - convert empty strings to null for optional fields
      else if (
        [
          'customerId',
          'sectorId',
          'paintId',
          'createdById',
          'bonusDiscountId',
          'serialNumber',
          'details',
          'invoiceToId',
          'negotiatingWith',
        ].includes(fieldToRevert)
      ) {
        convertedValue = oldValue;
        // Note: chassisNumber and plate are on the Implement entity, not Task
      }
      // Handle required string fields (name) - keep as is
      else if (['name'].includes(fieldToRevert)) {
        convertedValue = oldValue;
      }

      // 5. Special handling for array/relation fields that need custom rollback logic
      if (fieldToRevert === 'cuts') {
        // Cuts are a relation, not a direct field - need special handling
        // oldValue is a serialized array like: [{ fileId, type, origin, quantity, status, file: {...} }]

        this.logger.log(`[Rollback] Starting cuts rollback for task ${changeLog.entityId}`);
        this.logger.log(`[Rollback] Changelog action: ${changeLog.action}`);
        this.logger.log(`[Rollback] oldValue type: ${typeof oldValue}`);

        // Parse oldValue if it's a JSON string
        let parsedOldValue = oldValue;
        if (typeof oldValue === 'string') {
          try {
            parsedOldValue = JSON.parse(oldValue);
            this.logger.log(`[Rollback] Parsed oldValue from string to ${typeof parsedOldValue}`);
          } catch (e) {
            this.logger.error(`[Rollback] Failed to parse oldValue: ${e.message}`);
            parsedOldValue = oldValue;
          }
        }

        // Delete all current cuts for this task
        const deleteResult = await tx.cut.deleteMany({
          where: { taskId: changeLog.entityId },
        });
        this.logger.log(`[Rollback] Deleted ${deleteResult.count} existing cuts`);

        // Recreate cuts from parsedOldValue
        let cutsCreated = 0;
        if (parsedOldValue && Array.isArray(parsedOldValue)) {
          this.logger.log(`[Rollback] Recreating ${parsedOldValue.length} cut groups`);
          for (const cutData of parsedOldValue) {
            // Type assertion for cutData as it's from JSON
            const cut = cutData as any;

            // Create 'quantity' number of cuts with the same fileId/type/origin
            const quantity = cut.quantity || 1;
            this.logger.log(
              `[Rollback] Creating ${quantity} cuts for file ${cut.fileId} (${cut.file?.filename || 'unknown'})`,
            );

            for (let i = 0; i < quantity; i++) {
              const createdCut = await tx.cut.create({
                data: {
                  fileId: cut.fileId,
                  type: cut.type,
                  origin: cut.origin || 'PLAN',
                  status: cut.status || 'PENDING',
                  taskId: changeLog.entityId,
                },
              });
              cutsCreated++;
              this.logger.log(`[Rollback] Created cut ${i + 1}/${quantity}: ${createdCut.id}`);
            }
          }
        } else {
          this.logger.log(
            `[Rollback] No cuts to recreate (parsedOldValue is ${typeof parsedOldValue}, isArray: ${Array.isArray(parsedOldValue)})`,
          );
        }

        this.logger.log(`[Rollback] Total cuts created: ${cutsCreated}`);

        // Fetch updated task with cuts to return
        const updatedTask = await this.tasksRepository.findByIdWithTransaction(
          tx,
          changeLog.entityId,
          {
            include: {
              customer: true,
              sector: true,
              generalPainting: true,
              implement: true,
              createdBy: true,
              cuts: {
                include: {
                  file: true,
                },
              },
            },
          },
        );

        // Log the rollback action
        const fieldNamePt = translateFieldName(fieldToRevert);

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: changeLog.entityId,
          action: CHANGE_ACTION.ROLLBACK,
          field: fieldToRevert,
          oldValue: changeLog.newValue, // What we're rolling back from
          newValue: changeLog.oldValue, // What we're rolling back to
          reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: changeLog.entityId,
          userId,
          transaction: tx,
        });

        this.logger.log(
          `Field '${fieldToRevert}' rolled back for task ${changeLog.entityId} by user ${userId}`,
        );

        return {
          success: true,
          message: `Campo '${fieldNamePt}' revertido com sucesso`,
          data: updatedTask,
        };
      }

      // 5b. Special handling for file relationship fields (many-to-many with File)
      // These are the File[] relations on Task that need Prisma's { set: [...] } syntax
      // Map tracked field names (from changelog) to Prisma relation names
      const trackedToRelationMap: Record<string, string> = {
        budgetIds: 'budgets',
        invoiceIds: 'invoices',
        receiptIds: 'receipts',
        bankSlipIds: 'bankSlips',
        baseFileIds: 'baseFiles',
        paintIds: 'logoPaints',
        reimbursementIds: 'reimbursements',
        reimbursementInvoiceIds: 'invoiceReimbursements',
      };
      // A arte saiu da tarefa (R2): o histórico antigo de `layouts`/`layoutIds` não
      // tem mais relação a que voltar. Recusar com a frase — e não um 500 do Prisma.
      if (fieldToRevert === 'layouts' || fieldToRevert === 'layoutIds') {
        throw new BadRequestException(
          'Não é possível reverter a arte por aqui: a arte agora é do implemento. ' +
            'Envie ou substitua a arte no implemento do veículo.',
        );
      }
      const fileRelationFields = [
        'budgets',
        'invoices',
        'invoiceReimbursements',
        'receipts',
        'bankSlips',
        'reimbursements',
        'baseFiles',
        'logoPaints',
      ];

      // Resolve tracked name to Prisma relation name
      const resolvedRelationField = trackedToRelationMap[fieldToRevert] || fieldToRevert;

      if (fileRelationFields.includes(resolvedRelationField)) {
        this.logger.log(
          `[Rollback] Starting ${fieldToRevert} rollback for task ${changeLog.entityId}`,
        );
        this.logger.log(`[Rollback] oldValue type: ${typeof oldValue}`);

        // Parse oldValue if it's a JSON string
        let parsedOldValue = oldValue;
        if (typeof oldValue === 'string') {
          try {
            parsedOldValue = JSON.parse(oldValue);
            this.logger.log(`[Rollback] Parsed oldValue from string to ${typeof parsedOldValue}`);
          } catch (e) {
            this.logger.error(`[Rollback] Failed to parse oldValue: ${e.message}`);
            parsedOldValue = oldValue;
          }
        }

        // Extract file IDs from the parsed value
        // oldValue can be: array of file objects [{id, filename, ...}], array of IDs, or null/empty
        let fileIds: string[] = [];
        if (parsedOldValue && Array.isArray(parsedOldValue)) {
          fileIds = parsedOldValue
            .map((item: any) => {
              // Handle both full file objects and plain IDs
              return typeof item === 'string' ? item : item.id;
            })
            .filter((id: string) => id); // Filter out any null/undefined
        }

        this.logger.log(
          `[Rollback] Setting ${resolvedRelationField} (tracked as ${fieldToRevert}) to ${fileIds.length} files: ${fileIds.join(', ')}`,
        );

        // Update the task using Prisma's relationship set syntax with the resolved relation name
        await tx.task.update({
          where: { id: changeLog.entityId },
          data: {
            [resolvedRelationField]: {
              set: fileIds.map(id => ({ id })),
            },
          },
        });

        // Fetch updated task with proper typing using repository
        const updatedTask = await this.tasksRepository.findByIdWithTransaction(
          tx,
          changeLog.entityId,
          {
            include: {
              customer: true,
              sector: true,
              generalPainting: true,
              implement: true,
              createdBy: true,
              layouts: true,
            },
          },
        );

        // Log the rollback action
        const fieldNamePt = translateFieldName(fieldToRevert);

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: changeLog.entityId,
          action: CHANGE_ACTION.ROLLBACK,
          field: fieldToRevert,
          oldValue: changeLog.newValue, // What we're rolling back from
          newValue: changeLog.oldValue, // What we're rolling back to
          reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: changeLog.entityId,
          userId,
          transaction: tx,
        });

        this.logger.log(
          `Field '${fieldToRevert}' rolled back for task ${changeLog.entityId} by user ${userId}`,
        );

        return {
          success: true,
          message: `Campo '${fieldNamePt}' revertido com sucesso`,
          data: updatedTask,
        };
      }

      // 5c. Special handling for quoteId - oldValue may be a full JSON quote object
      if (fieldToRevert === 'quoteId') {
        this.logger.log(`[Rollback] Starting quoteId rollback for task ${changeLog.entityId}`);

        let quoteIdToRestore: string | null = null;

        // Parse the oldValue - it might be a JSON object, a UUID string, or null
        if (oldValue) {
          let parsedValue = oldValue;
          if (typeof oldValue === 'string') {
            try {
              parsedValue = JSON.parse(oldValue);
            } catch {
              // Not JSON, use as-is (might be a UUID directly)
              parsedValue = oldValue;
            }
          }

          if (typeof parsedValue === 'object' && parsedValue !== null && (parsedValue as any).id) {
            // It's a full quote object - extract the ID
            quoteIdToRestore = (parsedValue as any).id;

            // Check if the Budget record still exists
            const existingQuote = await tx.budget.findUnique({
              where: { id: quoteIdToRestore },
            });

            if (!existingQuote) {
              // Recreate the Budget from the stored data
              this.logger.log(`[Rollback] Budget ${quoteIdToRestore} not found, recreating`);
              const quoteData = parsedValue as any;

              const recreatedQuote = await tx.budget.create({
                data: {
                  id: quoteIdToRestore,
                  budgetNumber: quoteData.budgetNumber || 0,
                  subtotal: quoteData.subtotal || quoteData.total || '0',
                  total: quoteData.total || '0',
                  expiresAt: quoteData.expiresAt
                    ? new Date(quoteData.expiresAt)
                    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                  status: quoteData.status || 'PENDING',
                  statusOrder:
                    TASK_QUOTE_STATUS_ORDER[(quoteData.status || 'PENDING') as TASK_QUOTE_STATUS] ??
                    undefined,
                  guaranteeYears: quoteData.guaranteeYears ?? null,
                  customGuaranteeText: quoteData.customGuaranteeText ?? null,
                  customForecastDays: quoteData.customForecastDays ?? null,
                  simultaneousTasks: quoteData.simultaneousTasks ?? null,
                  // Restore the FULL per-customer billing config (discount, flags,
                  // orderNumber, paymentConfig, signature). The previous partial
                  // subset silently dropped the discount + billing settings on
                  // restore — the exact aggregate/discount drift this rollback is
                  // supposed to undo.
                  // ⚠️ OS PAGADORES NÃO NASCEM AQUI, e não podem.
                  //
                  // Um `customerConfigs.create` aninhado esbarra em duas coisas
                  // que mudaram por baixo dele: `orderNumber` foi DROPADO em
                  // `20260909170000` (a chave sozinha derruba a criação inteira
                  // com "Unknown argument"), e `billingId` virou `NOT NULL` em
                  // `20260916120000_billing_entity` — sem faturamento, o pagador
                  // não tem onde nascer. As duas juntas faziam TODO rollback de
                  // campo que recria orçamento morrer em 500, e o rollback é
                  // justamente a rota de quem já está consertando algo.
                  //
                  // `reconcileQuoteCustomerConfigs`, logo abaixo, cria o
                  // `Billing` e os pagadores na ordem certa — é a mesma função
                  // que a gravação normal usa.
                },
              });

              if (quoteData.customerConfigs?.length > 0) {
                await reconcileQuoteCustomerConfigs(
                  tx,
                  recreatedQuote.id,
                  quoteData.customerConfigs.map((config: any) => ({
                    customerId: config.customerId,
                    subtotal: config.subtotal ?? 0,
                    total: config.total ?? 0,
                    discountType: config.discountType || 'NONE',
                    discountValue: config.discountValue ?? null,
                    discountReference: config.discountReference ?? null,
                    customPaymentText: config.customPaymentText ?? null,
                    generateInvoice:
                      config.generateInvoice !== undefined ? config.generateInvoice : true,
                    generateBankSlip:
                      config.generateBankSlip !== undefined ? config.generateBankSlip : true,
                    paymentCondition: config.paymentCondition ?? null,
                    paymentConfig: config.paymentConfig ?? null,
                    customerSignatureId: config.customerSignatureId ?? null,
                  })),
                );

                // O número do pedido do SNAPSHOT desce para a tarefa, que é onde
                // ele mora agora: o snapshot de um orçamento antigo ainda o
                // carrega no pagador. Primeiro valor não vazio; vazio não apaga o
                // que a tarefa já tem.
                const legacyOrderNumber = quoteData.customerConfigs
                  .map((c: any) => (typeof c?.orderNumber === 'string' ? c.orderNumber.trim() : ''))
                  .find((v: string) => v.length > 0);
                if (legacyOrderNumber) {
                  await tx.task.updateMany({
                    where: { quoteId: recreatedQuote.id },
                    data: { customerOrderNumber: legacyOrderNumber },
                  });
                }
              }

              this.logger.log(`[Rollback] Recreated Budget ${recreatedQuote.id}`);

              // `layoutFileIds` de snapshot antigo é IGNORADO: a arte não é mais do
              // orçamento (R1) — ela ficou em cada implemento, que não saiu daqui.

              // Recreate services if available (preserve per-service invoice target)
              if (quoteData.services && Array.isArray(quoteData.services)) {
                for (let i = 0; i < quoteData.services.length; i++) {
                  const item = quoteData.services[i];
                  await tx.budgetItem.create({
                    data: {
                      description: item.description || '',
                      amount: item.amount || '0',
                      quoteId: quoteIdToRestore,
                      observation: item.observation ?? null,
                      position: item.position !== undefined ? item.position : i,
                      ...(item.invoiceToCustomerId && {
                        invoiceToCustomerId: item.invoiceToCustomerId,
                      }),
                    },
                  });
                }
                this.logger.log(`[Rollback] Recreated ${quoteData.services.length} quote services`);

                // Authoritative discount-aware recompute from the restored rows.
                await this.recalcQuoteTotals(tx, quoteIdToRestore);
                quotesContentChanged.add(quoteIdToRestore);
              }
            }
          } else if (typeof parsedValue === 'string') {
            // It's a UUID string directly
            quoteIdToRestore = parsedValue;
          }
        }

        // O orçamento de onde a tarefa SAI com o rollback — lido antes, porque
        // depois do update o vínculo anterior já se foi.
        const quoteAntesDoRollback =
          (
            await tx.task.findUnique({
              where: { id: changeLog.entityId },
              select: { quoteId: true },
            })
          )?.quoteId ?? null;

        // Update the task's quoteId
        await tx.task.update({
          where: { id: changeLog.entityId },
          data: { quoteId: quoteIdToRestore },
        });

        const updatedTask = await this.tasksRepository.findByIdWithTransaction(
          tx,
          changeLog.entityId,
          {
            include: {
              customer: true,
              sector: true,
              generalPainting: true,
              implement: true,
              createdBy: true,
              quote: { include: { services: true } },
            },
          },
        );

        const fieldNamePt = translateFieldName(fieldToRevert);

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: changeLog.entityId,
          action: CHANGE_ACTION.ROLLBACK,
          field: fieldToRevert,
          oldValue: changeLog.newValue,
          newValue: changeLog.oldValue,
          reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: changeLog.entityId,
          userId,
          transaction: tx,
        });

        this.logger.log(
          `Field '${fieldToRevert}' rolled back for task ${changeLog.entityId} by user ${userId}`,
        );

        return {
          success: true,
          message: `Campo '${fieldNamePt}' revertido com sucesso`,
          data: updatedTask,
        };
      }

      // 5d. Campo do IMPLEMENTO gravado como `implement.*` (histórico) ou `implement.*`.
      // O nome gravado passa por `LEGACY_FIELD_ALIASES` (`implement.type` →
      // `type`); nome sem coluna hoje → 400 com mensagem, nunca o 500 do Prisma.
      if (isImplementHistoryField(fieldToRevert)) {
        const implementField = resolveImplementColumn(fieldToRevert);
        if (!implementField) {
          throw new BadRequestException(
            `Não é possível reverter "${fieldToRevert}": o campo não existe mais no implemento.`,
          );
        }
        const taskWithImplement = await tx.task.findUnique({
          where: { id: changeLog.entityId },
          include: { implement: true },
        });

        if (!taskWithImplement?.implement) {
          throw new BadRequestException('Tarefa sem implemento: nada a reverter.');
        }
        if (implementField === 'serialNumber') {
          await this.assertSerialFreeForRollback(tx, convertedValue, changeLog.entityId);
        }

        const revertedFace = faceOf(implementField);
        if (revertedFace && FACE_FK[revertedFace] === implementField) {
          await this.restoreFaceFromChangelog(
            tx,
            taskWithImplement.implement.id,
            revertedFace,
            convertedValue,
          );
        } else {
          await tx.implement.update({
            where: { id: taskWithImplement.implement.id },
            data: { [implementField]: convertedValue },
          });
        }

        const updatedTask = await this.tasksRepository.findByIdWithTransaction(
          tx,
          changeLog.entityId,
          {
            include: {
              customer: true,
              sector: true,
              generalPainting: true,
              implement: true,
              createdBy: true,
            },
          },
        );

        const fieldNamePt = translateFieldName(fieldToRevert);
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: changeLog.entityId,
          action: CHANGE_ACTION.ROLLBACK,
          field: fieldToRevert,
          oldValue: changeLog.newValue,
          newValue: changeLog.oldValue,
          reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: changeLog.entityId,
          userId,
          transaction: tx,
        });

        return {
          success: true,
          message: `Campo '${fieldNamePt}' revertido com sucesso`,
          data: updatedTask,
        };
      }

      // 5e. Special handling for responsibles (many-to-many relation)
      if (fieldToRevert === 'responsibles') {
        this.logger.log(`[Rollback] Starting responsibles rollback for task ${changeLog.entityId}`);

        let parsedOldValue = oldValue;
        if (typeof oldValue === 'string') {
          try {
            parsedOldValue = JSON.parse(oldValue);
          } catch {
            parsedOldValue = oldValue;
          }
        }

        let repIds: string[] = [];
        if (parsedOldValue && Array.isArray(parsedOldValue)) {
          repIds = parsedOldValue
            .map((item: any) => (typeof item === 'string' ? item : item.id))
            .filter((id: string) => id);
        }

        await tx.task.update({
          where: { id: changeLog.entityId },
          data: {
            responsibles: { set: repIds.map(id => ({ id })) },
          },
        });

        const updatedTask = await this.tasksRepository.findByIdWithTransaction(
          tx,
          changeLog.entityId,
          {
            include: {
              customer: true,
              sector: true,
              generalPainting: true,
              implement: true,
              createdBy: true,
              responsibles: true,
            },
          },
        );

        const fieldNamePt = translateFieldName(fieldToRevert);
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: changeLog.entityId,
          action: CHANGE_ACTION.ROLLBACK,
          field: fieldToRevert,
          oldValue: changeLog.newValue,
          newValue: changeLog.oldValue,
          reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: changeLog.entityId,
          userId,
          transaction: tx,
        });

        return {
          success: true,
          message: `Campo '${fieldNamePt}' revertido com sucesso`,
          data: updatedTask,
        };
      }

      // 5f. Special handling for observation (1-to-1 relation)
      if (fieldToRevert === 'observation') {
        this.logger.log(`[Rollback] Starting observation rollback for task ${changeLog.entityId}`);

        let parsedOldValue = oldValue;
        if (typeof oldValue === 'string') {
          try {
            parsedOldValue = JSON.parse(oldValue);
          } catch {
            parsedOldValue = oldValue;
          }
        }

        // Get the existing observation for this task
        const existingObs = await tx.observation.findUnique({
          where: { taskId: changeLog.entityId },
        });

        if (parsedOldValue && typeof parsedOldValue === 'object') {
          const obsData = parsedOldValue as any;
          if (existingObs) {
            await tx.observation.update({
              where: { taskId: changeLog.entityId },
              data: { description: obsData.description || '' },
            });
          } else {
            await tx.observation.create({
              data: { taskId: changeLog.entityId, description: obsData.description || '' },
            });
          }
        } else if (parsedOldValue === null && existingObs) {
          await tx.observation.delete({ where: { taskId: changeLog.entityId } });
        }

        const updatedTask = await this.tasksRepository.findByIdWithTransaction(
          tx,
          changeLog.entityId,
          {
            include: {
              customer: true,
              sector: true,
              generalPainting: true,
              implement: true,
              createdBy: true,
              observation: true,
            },
          },
        );

        const fieldNamePt = translateFieldName(fieldToRevert);
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: changeLog.entityId,
          action: CHANGE_ACTION.ROLLBACK,
          field: fieldToRevert,
          oldValue: changeLog.newValue,
          newValue: changeLog.oldValue,
          reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: changeLog.entityId,
          userId,
          transaction: tx,
        });

        return {
          success: true,
          message: `Campo '${fieldNamePt}' revertido com sucesso`,
          data: updatedTask,
        };
      }

      // 5g. Special handling for implementMeasures (composite relation on implement)
      if (fieldToRevert === 'implementMeasures') {
        this.logger.log(
          `[Rollback] Starting implementMeasures rollback for task ${changeLog.entityId}`,
        );

        let parsedOldValue = oldValue;
        if (typeof oldValue === 'string') {
          try {
            parsedOldValue = JSON.parse(oldValue);
          } catch {
            parsedOldValue = null;
          }
        }
        if (parsedOldValue === undefined) parsedOldValue = null;

        // Find the implement for this task
        const implement = await tx.implement.findUnique({
          where: { taskId: changeLog.entityId },
          select: { id: true },
        });

        if (!implement) {
          throw new BadRequestException(
            'Tarefa não possui implemento associado para reverter implementMeasures',
          );
        }

        for (const face of FACES) {
          const key = FACE_FK[face];
          // Only process sides that appear in the old value
          if (parsedOldValue !== null && parsedOldValue[key] === undefined) continue;
          await this.restoreFaceFromChangelog(tx, implement.id, face, parsedOldValue?.[key] ?? null);
        }

        const updatedTask = await this.tasksRepository.findByIdWithTransaction(
          tx,
          changeLog.entityId,
          {
            include: {
              customer: true,
              sector: true,
              generalPainting: true,
              implement: { include: FACE_MEASURES_WITH_SECTIONS },
              createdBy: true,
            },
          },
        );

        const fieldNamePt = translateFieldName(fieldToRevert);
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: changeLog.entityId,
          action: CHANGE_ACTION.ROLLBACK,
          field: fieldToRevert,
          oldValue: changeLog.newValue,
          newValue: changeLog.oldValue,
          reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: changeLog.entityId,
          userId,
          transaction: tx,
        });

        return {
          success: true,
          message: `Campo '${fieldNamePt}' revertido com sucesso`,
          data: updatedTask,
        };
      }

      // 6. Create update data with just the field being rolled back
      const updateData: any = {
        [fieldToRevert]: convertedValue,
      };

      // 6. Special handling for status changes
      if (fieldToRevert === 'status') {
        const targetStatus = oldValue as TASK_STATUS;
        const currentStatus = currentTask.status as TASK_STATUS;

        // Validate if we can rollback to this status
        if (!isValidTaskStatusTransition(currentStatus, targetStatus)) {
          throw new BadRequestException(
            `Não é possível reverter status de ${getTaskStatusLabel(currentStatus)} para ${getTaskStatusLabel(targetStatus)}: transição inválida`,
          );
        }
        await this.assertArtworkAllowsRelease(tx, currentTask.id, currentStatus, targetStatus);

        // Update statusOrder when status changes
        updateData.statusOrder = getTaskStatusOrder(targetStatus);

        // Handle date field validation for rolled back status
        if (targetStatus === TASK_STATUS.IN_PRODUCTION && !currentTask.startedAt) {
          throw new BadRequestException(
            'Não é possível reverter para EM PRODUÇÃO: data de início não está definida',
          );
        }
        if (targetStatus === TASK_STATUS.COMPLETED && !currentTask.finishedAt) {
          throw new BadRequestException(
            'Não é possível reverter para CONCLUÍDO: data de conclusão não está definida',
          );
        }
      }

      // Update bonificationOrder when bonification changes
      if (fieldToRevert === 'bonification' && convertedValue) {
        updateData.bonificationOrder = getBonificationStatusOrder(convertedValue as string);
      }

      // W6 (DD1): a série volta pelo repositório (W2 → implemento), com a
      // unicidade conferida ANTES — o conflito virava P2002 → 500. A trilha é
      // TASK/serialNumber (S-5), mas a coluna é do implemento: `serialNumber` no
      // topo o repositório não lê, e o desfazer respondia 200 sem desfazer.
      if (fieldToRevert === 'serialNumber') {
        await this.assertSerialFreeForRollback(tx, convertedValue, changeLog.entityId);
        delete updateData.serialNumber;
        updateData.implement = { serialNumber: convertedValue };
      }

      // 7. Update the task with relations included for proper response
      const updatedTask = await this.tasksRepository.updateWithTransaction(
        tx,
        changeLog.entityId,
        updateData,
        {
          include: {
            customer: true,
            sector: true,
            generalPainting: true,
            implement: true,
            createdBy: true,
          },
        },
        userId,
      );

      // 8. Log the rollback action
      const fieldNamePt = translateFieldName(fieldToRevert);

      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.TASK,
        entityId: changeLog.entityId,
        action: CHANGE_ACTION.ROLLBACK,
        field: fieldToRevert,
        oldValue: changeLog.newValue, // What we're rolling back from
        newValue: changeLog.oldValue, // What we're rolling back to
        reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: changeLog.entityId,
        userId,
        transaction: tx,
      });

      this.logger.log(
        `Field '${fieldToRevert}' rolled back for task ${changeLog.entityId} by user ${userId}`,
      );

      return {
        success: true,
        message: `Campo '${fieldNamePt}' revertido com sucesso`,
        data: updatedTask,
      };
    });

    // Commitado. O "Desfazer" pode ter reescrito preço, descrição ou a lista de
    // serviços — e o documento que o cliente assinou pode já não descrever este
    // orçamento. É a mesma pergunta que `BudgetService.update` faz ao final de
    // toda gravação; este caminho simplesmente não a fazia.
    for (const quoteId of quotesContentChanged) {
      try {
        await this.signatureEnvelopes.onQuoteContentChanged(quoteId, userId || null);
      } catch (error) {
        this.logger.error(
          `[Rollback] Falha ao reavaliar as assinaturas do orçamento ${quoteId} ` +
            '(a reversão JÁ foi gravada):',
          error,
        );
      }
    }

    return rollbackResult;
  }

  // =====================
  // TRUCK POSITIONING METHODS
  // =====================

  /**
   * Update the spot (parking position) of a implement associated with a task
   */
  async updateTaskPosition(
    taskId: string,
    positionData: {
      spot?: IMPLEMENT_SPOT | null;
    },
    include?: TaskInclude,
    userId?: string,
  ): Promise<TaskUpdateResponse> {
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Find the task with its implement
      const task = await tx.task.findUnique({
        where: { id: taskId },
        include: {
          implement: { include: FACE_MEASURES_WITH_SECTIONS },
        },
      });

      if (!task) {
        throw new NotFoundException(`Tarefa ${taskId} não encontrada`);
      }

      if (!task.implement) {
        throw new BadRequestException(`Tarefa ${taskId} não possui implemento associado`);
      }

      // Validate that implement has implementMeasure before positioning
      if (positionData.spot && !FACES.some(face => (task.implement as any)[FACE_REL[face]])) {
        throw new BadRequestException(
          `O implemento da tarefa "${task.name}" não possui medida configurada. Configure pelo menos uma medida (${FACES.map(face => IMPLEMENT_FACE_LABELS[face]).join(', ')}) antes de posicionar o implemento na garagem.`,
        );
      }

      // Validate spot availability (check if spot is already occupied)
      if (positionData.spot) {
        const existingImplement = await tx.implement.findFirst({
          where: {
            spot: positionData.spot,
            id: { not: task.implement.id },
          },
        });

        if (existingImplement) {
          throw new BadRequestException(
            `A vaga ${positionData.spot} já está ocupada por outro implemento`,
          );
        }
      }

      const oldSpot = task.implement.spot;

      // Update implement spot
      await tx.implement.update({
        where: { id: task.implement.id },
        data: {
          spot: positionData.spot,
        },
      });

      // Log the change
      if (userId) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.IMPLEMENT,
          entityId: task.implement.id,
          action: CHANGE_ACTION.UPDATE,
          userId,
          oldValue: { spot: oldSpot },
          newValue: { spot: positionData.spot },
          reason: `Spot updated for task ${task.id}`,
          triggeredBy: CHANGE_TRIGGERED_BY.TASK_UPDATE,
          triggeredById: null,
          transaction: tx,
        });
      }

      // Fetch updated task
      const updatedTask = await this.tasksRepository.findById(taskId, include);

      return {
        success: true,
        message: 'Vaga do implemento atualizada com sucesso',
        data: updatedTask,
      };
    });
  }

  /**
   * Bulk update positions for multiple implements
   */
  async bulkUpdatePositions(
    data: TaskBulkPositionUpdateFormData,
    include?: TaskInclude,
    userId?: string,
  ): Promise<TaskBatchUpdateResponse<any>> {
    const results: Task[] = [];
    const errors: Array<{ index: number; data: any; error: string }> = [];

    // Wrap all position updates in a transaction for atomicity
    // Either all succeed or none do, preventing partial position state
    try {
      await this.prisma.$transaction(async () => {
        for (let i = 0; i < data.updates.length; i++) {
          const update = data.updates[i];
          try {
            const result = await this.updateTaskPosition(update.taskId, update, include, userId);
            results.push(result.data);
          } catch (error) {
            errors.push({
              index: i,
              data: update,
              error: error.message || 'Erro desconhecido',
            });
          }
        }

        // If any errors, throw to roll back all changes
        if (errors.length > 0) {
          throw new Error(`${errors.length} position updates failed`);
        }
      });
    } catch (txError) {
      // If transaction failed, the errors array already has details
      if (errors.length === 0) {
        // Unexpected transaction error
        errors.push({
          index: -1,
          data: null,
          error: txError.message || 'Erro na transação',
        });
      }
    }

    return {
      success: errors.length === 0,
      message:
        errors.length === 0
          ? 'Todas as posições foram atualizadas com sucesso'
          : `${results.length} posições atualizadas, ${errors.length} falharam`,
      data: {
        success: errors.length === 0 ? results : [],
        failed: errors,
        totalProcessed: data.updates.length,
        totalSuccess: errors.length === 0 ? results.length : 0,
        totalFailed: errors.length > 0 ? data.updates.length : 0,
      },
    };
  }

  /**
   * Swap spots of two implements
   */
  async swapTaskPositions(
    taskId1: string,
    taskId2: string,
    include?: TaskInclude,
    userId?: string,
  ): Promise<{ success: boolean; message: string; data: { task1: Task; task2: Task } }> {
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Fetch both tasks with implements
      const task1 = await tx.task.findUnique({
        where: { id: taskId1 },
        include: { implement: true },
      });

      const task2 = await tx.task.findUnique({
        where: { id: taskId2 },
        include: { implement: true },
      });

      if (!task1 || !task2) {
        throw new NotFoundException('Uma ou ambas as tarefas não foram encontradas');
      }

      if (!task1.implement || !task2.implement) {
        throw new BadRequestException('Ambas as tarefas devem ter implementos associados');
      }

      // Store original spots
      const implement1Spot = task1.implement.spot;
      const implement2Spot = task2.implement.spot;

      // Swap spots
      await tx.implement.update({
        where: { id: task1.implement.id },
        data: { spot: implement2Spot },
      });

      await tx.implement.update({
        where: { id: task2.implement.id },
        data: { spot: implement1Spot },
      });

      // Log changes
      if (userId) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.IMPLEMENT,
          entityId: task1.implement.id,
          action: CHANGE_ACTION.UPDATE,
          userId,
          oldValue: { spot: implement1Spot },
          newValue: { spot: implement2Spot },
          reason: `Spot swapped with implement ${task2.implement.id}`,
          triggeredBy: CHANGE_TRIGGERED_BY.TASK_UPDATE,
          triggeredById: null,
          transaction: tx,
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.IMPLEMENT,
          entityId: task2.implement.id,
          action: CHANGE_ACTION.UPDATE,
          userId,
          oldValue: { spot: implement2Spot },
          newValue: { spot: implement1Spot },
          reason: `Spot swapped with implement ${task1.implement.id}`,
          triggeredBy: CHANGE_TRIGGERED_BY.TASK_UPDATE,
          triggeredById: null,
          transaction: tx,
        });
      }

      // Fetch updated tasks
      const updatedTask1 = await this.tasksRepository.findById(taskId1, include);
      const updatedTask2 = await this.tasksRepository.findById(taskId2, include);

      return {
        success: true,
        message: 'Vagas dos implementos trocadas com sucesso',
        data: {
          task1: updatedTask1,
          task2: updatedTask2,
        },
      };
    });
  }

  /**
   * Calculate implement width from implementMeasures (sum of implementMeasure section widths)
   */
  private calculateImplementWidth(implement: any): number {
    // Width is the sum of section widths from side implementMeasures
    const leftWidth =
      implement.leftSideMeasure?.sections?.reduce(
        (sum: number, section: any) => sum + section.width,
        0,
      ) || 0;

    const rightWidth =
      implement.rightSideMeasure?.sections?.reduce(
        (sum: number, section: any) => sum + section.width,
        0,
      ) || 0;

    // Use the maximum width from available implementMeasures, default to 5m if no implementMeasure
    const baseLength = Math.max(leftWidth, rightWidth) || 5;

    // Add cabin length for implements under 10m
    if (baseLength < 10) {
      return baseLength + 2.8;
    }
    return baseLength;
  }

  /**
   * Calculate implement length from implementMeasures
   */
  private calculateImplementLength(implement: any): number {
    // Length is typically the height from implementMeasures, use back implementMeasure as primary
    const backLength = implement.backSideMeasure?.height || 0;
    const leftLength = implement.leftSideMeasure?.height || 0;
    const rightLength = implement.rightSideMeasure?.height || 0;

    // Use the maximum length from available implementMeasures, default to 12.5m if no implementMeasure
    return Math.max(backLength, leftLength, rightLength) || 12.5;
  }

  // =====================
  // BULK OPERATIONS
  // =====================

  /**
   * Bulk add documents to multiple tasks
   */
  async bulkAddDocuments(
    taskIds: string[],
    documentType: 'budget' | 'invoice' | 'receipt',
    documentIds: string[],
    userId: string,
    include?: TaskInclude,
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    this.logger.log(
      `[bulkAddDocuments] Adding ${documentIds.length} ${documentType}s to ${taskIds.length} tasks`,
    );

    const errors: Array<{ taskId: string; error: string }> = [];
    let successCount = 0;

    // Store field changes for event emission after transaction
    const fieldChangesForEvents: Array<{
      taskId: string;
      task: any;
      field: string;
      oldValue: any[];
      newValue: any[];
    }> = [];

    // Map document type to Prisma relation name
    const relationMap = {
      budget: 'budgets',
      invoice: 'invoices',
      receipt: 'receipts',
    };
    const relationName = relationMap[documentType];

    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Verify all tasks exist
      const tasks = await tx.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, name: true },
      });

      if (tasks.length !== taskIds.length) {
        const foundIds = tasks.map(t => t.id);
        const missingIds = taskIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Tarefas não encontradas: ${missingIds.join(', ')}`);
      }

      // Verify all document files exist
      const documents = await tx.file.findMany({
        where: { id: { in: documentIds } },
        select: { id: true },
      });

      if (documents.length !== documentIds.length) {
        const foundIds = documents.map(d => d.id);
        const missingIds = documentIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Documentos não encontrados: ${missingIds.join(', ')}`);
      }

      // Add documents to each task
      for (const task of tasks) {
        try {
          // Get current documents for this task
          const currentTask = await tx.task.findUnique({
            where: { id: task.id },
            include: { [relationName]: { select: { id: true } } },
          });

          // Merge current document IDs with new ones (avoid duplicates)
          const currentDocumentIds =
            (currentTask as any)?.[relationName]?.map((d: any) => d.id) || [];
          const mergedDocumentIds = [...new Set([...currentDocumentIds, ...documentIds])];

          // Update task with merged document IDs
          await tx.task.update({
            where: { id: task.id },
            data: {
              [relationName]: {
                set: mergedDocumentIds.map(id => ({ id })),
              },
            },
          });

          // Log the change
          const fieldLabel = translateFieldName(relationName);
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            action: CHANGE_ACTION.UPDATE,
            field: relationName,
            oldValue: currentDocumentIds,
            newValue: mergedDocumentIds,
            reason: `Campo ${fieldLabel} atualizado`,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            triggeredById: task.id,
            userId: userId || '',
            transaction: tx,
          });

          // Store for event emission
          fieldChangesForEvents.push({
            taskId: task.id,
            task: currentTask,
            field: relationName,
            oldValue: currentDocumentIds,
            newValue: mergedDocumentIds,
          });

          successCount++;
        } catch (error) {
          this.logger.error(`[bulkAddDocuments] Error updating task ${task.id}:`, error);
          errors.push({
            taskId: task.id,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
        }
      }
    });

    // After transaction: Emit field change events for notifications
    if (fieldChangesForEvents.length > 0) {
      this.logger.log(
        `[bulkAddDocuments] Emitting ${fieldChangesForEvents.length} field change event(s) for notifications`,
      );

      for (const change of fieldChangesForEvents) {
        try {
          this.eventEmitter.emit('task.field.changed', {
            task: change.task,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            changedBy: userId,
            isFileArray: true,
          });
        } catch (eventError) {
          this.logger.error(
            `[bulkAddDocuments] Error emitting event for task ${change.taskId}:`,
            eventError,
          );
        }
      }
    }

    return {
      success: successCount,
      failed: errors.length,
      total: taskIds.length,
      errors,
    };
  }

  /**
   * Bulk add paints to multiple tasks
   */
  async bulkAddPaints(
    taskIds: string[],
    paintIds: string[],
    userId: string,
    include?: TaskInclude,
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    this.logger.log(`[bulkAddPaints] Adding ${paintIds.length} paints to ${taskIds.length} tasks`);

    const errors: Array<{ taskId: string; error: string }> = [];
    let successCount = 0;

    // Store field changes for event emission after transaction
    const fieldChangesForEvents: Array<{
      taskId: string;
      task: any;
      oldValue: any[];
      newValue: any[];
    }> = [];

    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Verify all tasks exist
      const tasks = await tx.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, name: true },
      });

      if (tasks.length !== taskIds.length) {
        const foundIds = tasks.map(t => t.id);
        const missingIds = taskIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Tarefas não encontradas: ${missingIds.join(', ')}`);
      }

      // Verify all paints exist
      const paints = await tx.paint.findMany({
        where: { id: { in: paintIds } },
        select: { id: true },
      });

      if (paints.length !== paintIds.length) {
        const foundIds = paints.map(p => p.id);
        const missingIds = paintIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Tintas não encontradas: ${missingIds.join(', ')}`);
      }

      // Add paints to each task
      for (const task of tasks) {
        try {
          // Get current paints for this task
          const currentTask = await tx.task.findUnique({
            where: { id: task.id },
            include: { logoPaints: { select: { id: true } } },
          });

          // Merge current paint IDs with new ones (avoid duplicates)
          const currentPaintIds = currentTask?.logoPaints?.map(p => p.id) || [];
          const mergedPaintIds = [...new Set([...currentPaintIds, ...paintIds])];

          // Update task with merged paint IDs
          await tx.task.update({
            where: { id: task.id },
            data: {
              logoPaints: {
                set: mergedPaintIds.map(id => ({ id })),
              },
            },
          });

          // Log the change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'logoPaints',
            oldValue: currentPaintIds,
            newValue: mergedPaintIds,
            reason: `Campo tintas de logo atualizado`,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            triggeredById: task.id,
            userId: userId || '',
            transaction: tx,
          });

          // Store for event emission
          fieldChangesForEvents.push({
            taskId: task.id,
            task: currentTask,
            oldValue: currentPaintIds,
            newValue: mergedPaintIds,
          });

          successCount++;
        } catch (error) {
          this.logger.error(`[bulkAddPaints] Error updating task ${task.id}:`, error);
          errors.push({
            taskId: task.id,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
        }
      }
    });

    // After transaction: Emit field change events for notifications
    if (fieldChangesForEvents.length > 0) {
      this.logger.log(
        `[bulkAddPaints] Emitting ${fieldChangesForEvents.length} field change event(s) for notifications`,
      );

      for (const change of fieldChangesForEvents) {
        try {
          this.eventEmitter.emit('task.field.changed', {
            task: change.task,
            field: 'logoPaints',
            oldValue: change.oldValue,
            newValue: change.newValue,
            changedBy: userId,
            isFileArray: false,
          });
        } catch (eventError) {
          this.logger.error(
            `[bulkAddPaints] Error emitting event for task ${change.taskId}:`,
            eventError,
          );
        }
      }
    }

    return {
      success: successCount,
      failed: errors.length,
      total: taskIds.length,
      errors,
    };
  }

  /**
   * Bulk add cutting plans to multiple tasks
   */
  async bulkAddCuttingPlans(
    taskIds: string[],
    cutData: {
      fileId: string;
      type: string;
      origin?: string;
      reason?: string | null;
      quantity?: number;
    },
    userId: string,
    include?: TaskInclude,
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    this.logger.log(`[bulkAddCuttingPlans] Adding cutting plans to ${taskIds.length} tasks`);

    const errors: Array<{ taskId: string; error: string }> = [];
    let successCount = 0;

    // Store field changes for event emission after transaction
    const fieldChangesForEvents: Array<{
      taskId: string;
      task: any;
      oldValue: any[];
      newValue: any[];
    }> = [];

    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Verify all tasks exist
      const tasks = await tx.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, name: true, sectorId: true, status: true },
      });

      if (tasks.length !== taskIds.length) {
        const foundIds = tasks.map(t => t.id);
        const missingIds = taskIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Tarefas não encontradas: ${missingIds.join(', ')}`);
      }

      // Verify the cut file exists
      const cutFile = await tx.file.findUnique({
        where: { id: cutData.fileId },
      });

      if (!cutFile) {
        throw new NotFoundException(`Arquivo de corte não encontrado: ${cutData.fileId}`);
      }

      // Create cutting plans for each task
      for (const task of tasks) {
        try {
          const quantity = cutData.quantity || 1;
          const createdCuts = [];

          // Create the specified quantity of cuts for this task
          for (let i = 0; i < quantity; i++) {
            const cut = await tx.cut.create({
              data: {
                fileId: cutData.fileId,
                type: cutData.type as any,
                origin: (cutData.origin || 'PLAN') as any,
                reason: cutData.reason ? (cutData.reason as any) : null,
                status: 'PENDING' as any,
                statusOrder: 1,
                taskId: task.id,
              },
            });
            createdCuts.push(cut);
          }

          // Log the change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'cuts',
            oldValue: null,
            newValue: createdCuts.map(c => c.id),
            reason: `Campo recortes atualizado`,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            triggeredById: task.id,
            userId: userId || '',
            transaction: tx,
          });

          // Store for event emission
          fieldChangesForEvents.push({
            taskId: task.id,
            task,
            oldValue: [],
            newValue: createdCuts,
          });

          successCount++;
        } catch (error) {
          this.logger.error(`[bulkAddCuttingPlans] Error updating task ${task.id}:`, error);
          errors.push({
            taskId: task.id,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
        }
      }
    });

    // After transaction: Emit cut.created per created cut + one cuts.added.to.task
    // per task so the cutting team (PLOTTING/DESIGNER) is actually alerted (H10).
    // Previously this emitted task.field.changed (field='cuts'), which routed to
    // task.listener.ts and never reached the cutting queue. Mirrors
    // CutService.create / batchCreate (and the task-create / batchUpdate paths).
    if (fieldChangesForEvents.length > 0) {
      this.logger.log(
        `[bulkAddCuttingPlans] Emitting cut notifications for ${fieldChangesForEvents.length} task(s)`,
      );

      try {
        const createdByUser = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, email: true },
        });

        if (createdByUser) {
          for (const change of fieldChangesForEvents) {
            try {
              const createdCuts = change.newValue;
              if (!createdCuts || createdCuts.length === 0) continue;

              for (const cut of createdCuts) {
                this.eventEmitter.emit(
                  'cut.created',
                  new CutCreatedEvent(cut as any, change.task as any, createdByUser as any),
                );
              }

              this.eventEmitter.emit(
                'cuts.added.to.task',
                new CutsAddedToTaskEvent(
                  change.task as any,
                  createdCuts as any,
                  createdByUser as any,
                ),
              );
            } catch (eventError) {
              this.logger.error(
                `[bulkAddCuttingPlans] Error emitting cut events for task ${change.taskId}:`,
                eventError,
              );
            }
          }
        }
      } catch (eventError) {
        this.logger.error('[bulkAddCuttingPlans] Failed to emit cut created events:', eventError);
      }
    }

    return {
      success: successCount,
      failed: errors.length,
      total: taskIds.length,
      errors,
    };
  }

  // NOTE: getTargetUsersForNotification() was REMOVED because the legacy
  // TaskNotificationService notification path was deprecated. All notifications
  // now go through the event-based system with configuration-based targeting.

  /**
   * Duplicate a Budget record (deep copy with items and invoice connections).
   * Creates a new independent quote with a new budgetNumber.
   * Does NOT copy customerSignatureId (signature is specific to the original budget).
   */
  /**
   * Cria uma CÓPIA independente do orçamento para UMA tarefa.
   *
   * A cópia é sempre de um veículo — quem chama é "copiar campos de outra
   * tarefa" (`copyFromTask`), e o destino é uma tarefa só. Por isso a origem
   * `PER_TASK`, que tem uma fatia de faturamento POR VEÍCULO (sessenta fatias do
   * mesmo cliente), precisa ser achatada para uma fatia por CLIENTE antes de
   * gravar: as sessenta linhas nasceriam sem `taskId` e a segunda já violaria o
   * índice parcial `TaskQuoteCustomerConfig_one_joint_per_customer` — 500 no meio
   * da transação de cópia, com o campo "Orçamento" oferecido na tela para
   * ADMIN/FINANCEIRO/COMERCIAL. O `billingSplit` também não é copiado: a cópia
   * tem um veículo, e a única leitura possível ali é `JOINT`.
   */
  /**
   * Reverte UMA face para o valor que o histórico guardou, pelo escritor único:
   *   - a linha antiga ainda existe e NÃO é a atual da face → a face volta a
   *     apontá-la; se outra face já a usa, ganha uma CÓPIA (reverter não cria
   *     medida compartilhada);
   *   - a linha antiga É a atual (a edição foi no lugar) → os valores guardados
   *     voltam para ela mesma (mesmo id, a foto fica);
   *   - a linha sumiu, mas o histórico tem as seções → recriada (sem foto, como
   *     sempre foi);
   *   - nada a restaurar (`null`, ou sem id nem seções) → a face fica vazia e a
   *     linha atual só é apagada se mais ninguém a usa.
   * `value` é o recorte de `formatImplementMeasureForChangelog` ou só o id.
   */
  private async restoreFaceFromChangelog(
    tx: PrismaTransaction,
    implementId: string,
    face: ImplementFace,
    value: string | { id?: string | null; height?: number; sections?: any[] } | null,
  ): Promise<void> {
    const old = typeof value === 'string' ? { id: value } : value;
    const currentId =
      ((await tx.implement.findUnique({ where: { id: implementId }, select: { [FACE_FK[face]]: true } })) as unknown as
        | Record<string, string | null>
        | null)?.[FACE_FK[face]] ?? null;
    const isCurrent = !!old?.id && old.id === currentId;

    if (old?.id && !isCurrent) {
      const attached = await attachMeasure(tx, implementId, face, old.id);
      if (attached) {
        this.logger.log(
          `[Rollback] ${face} implementMeasure restored (${attached.action}): ${attached.measureId}`,
        );
        return;
      }
    }

    if (old && Array.isArray(old.sections) && old.sections.length > 0) {
      const restored = await setFace(
        tx,
        implementId,
        face,
        {
          height: old.height || 0,
          sections: old.sections.map((s: any, idx: number) => ({
            width: s.width || 0,
            isDoor: s.isDoor || false,
            doorHeight: s.doorHeight ?? null,
            position: s.position ?? idx,
          })),
        },
        { mode: isCurrent ? 'patch' : 'replace' },
      );
      this.logger.log(
        `[Rollback] ${face} implementMeasure restored from history (${restored.action}): ${restored.measureId}`,
      );
      return;
    }

    if (isCurrent) return;

    if (currentId) {
      const removed = await setFace(tx, implementId, face, null);
      if (removed.previous === 'deleted') {
        this.logger.log(`[Rollback] Deleted orphaned ${face} implementMeasure: ${currentId}`);
      }
    }
  }

  /**
   * A trilha de uma medida REPLICADA: na tarefa irmã, no mesmo campo
   * (`implementMeasures`) que a edição de tarefa usa, dizendo de qual veículo a
   * medida veio. Gerada pelo sistema, mas atribuída a quem gravou a origem.
   */
  private async logReplicatedMeasure(
    entry: ReplicationLogEntry,
    sourceTaskId: string,
    userId: string | null | undefined,
    tx: PrismaTransaction,
  ): Promise<void> {
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.TASK,
      entityId: entry.taskId,
      action: CHANGE_ACTION.UPDATE,
      field: entry.field,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      reason: entry.reason,
      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
      triggeredById: sourceTaskId,
      userId: userId || '',
      transaction: tx,
      metadata: { replicatedFromTaskId: sourceTaskId },
    });
  }

  private async duplicateBudget(sourceQuoteId: string, tx: PrismaTransaction): Promise<string> {
    const sourceQuote = await tx.budget.findUnique({
      where: { id: sourceQuoteId },
      include: {
        services: {
          select: {
            description: true,
            amount: true,
            observation: true,
            position: true,
            invoiceToCustomerId: true,
          },
          // Read in the SAME order the quote is displayed everywhere (position asc),
          // with a createdAt tiebreaker so services whose positions tie (legacy rows
          // default to 0) preserve their original insertion order instead of coming
          // back in non-deterministic heap order. Without this the copy is scrambled.
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        },
        customerConfigs: {
          select: {
            customerId: true,
            subtotal: true,
            total: true,
            discountType: true,
            discountValue: true,
            discountReference: true,
            customPaymentText: true,
            paymentCondition: true,
            paymentConfig: true,
            generateInvoice: true,
            generateBankSlip: true,
          },
        },
      },
    });

    if (!sourceQuote) {
      throw new NotFoundException(`Precificação de origem não encontrada (ID: ${sourceQuoteId})`);
    }

    // UMA configuração por CLIENTE. Num orçamento `PER_TASK` há uma por veículo,
    // todas do mesmo cliente e com as MESMAS condições (a reconciliação as
    // mantém em pé de igualdade), então a primeira de cada cliente descreve as
    // outras — e é a única que cabe num orçamento de um veículo.
    const configsByCustomer = Array.from(
      new Map((sourceQuote.customerConfigs ?? []).map(c => [c.customerId, c] as const)).values(),
    );

    // Get next budget number (advisory-locked — a bulk copy mints one per target
    // and the bare MAX+1 read raced itself into P2002).
    const nextBudgetNumber = await allocateBudgetNumber(tx);

    // A ARTE NÃO VEM NA CÓPIA DO ORÇAMENTO: ela é do implemento (R1/R2). Quem
    // copia a arte entre veículos é o token `implementLayouts` da cópia de tarefa.
    const newQuote = await tx.budget.create({
      data: {
        budgetNumber: nextBudgetNumber,
        subtotal: sourceQuote.subtotal,
        total: sourceQuote.total,
        expiresAt: sourceQuote.expiresAt,
        // A duplicate is a fresh draft — normalize to PENDING (with its matching
        // statusOrder, billingApprovedAt left null). Copying a billed status onto
        // a quote that has no invoices/installments produced an impossible locked
        // state.
        status: TASK_QUOTE_STATUS.PENDING,
        statusOrder: TASK_QUOTE_STATUS_ORDER[TASK_QUOTE_STATUS.PENDING],
        // JUNTO OU SEPARADO acompanha a cópia.
        //
        // Ficava de fora e caía no `@default('JOINT')` da coluna: duplicar um
        // orçamento cobrado veículo a veículo (ou em lotes) produzia uma cópia
        // que AFIRMAVA "uma fatura para todos". Num orçamento de um veículo —
        // que é o que a cópia é no instante em que nasce — os três modos são
        // indistinguíveis, então nada acusava; o estrago aparecia depois, quando
        // a cópia recebia o segundo implemento e a reconciliação fatiava pelo modo
        // errado, emitindo UMA nota para os dois.
        billingSplit: (sourceQuote as any).billingSplit,
        guaranteeYears: sourceQuote.guaranteeYears,
        customGuaranteeText: sourceQuote.customGuaranteeText,
        simultaneousTasks: sourceQuote.simultaneousTasks,
        customForecastDays: sourceQuote.customForecastDays,
        services: {
          // Re-assign clean sequential positions from the (now correctly ordered)
          // source list so the copy has unique, stable positions — guarding against
          // tied/legacy positions re-introducing the scramble on future reads.
          create: sourceQuote.services.map((service, index) => ({
            description: service.description,
            amount: service.amount,
            observation: service.observation,
            position: index,
            // Preserve the per-service invoice target so multi-customer billing
            // and the discount-aware totals stay internally consistent on copy.
            invoiceToCustomerId: (service as any).invoiceToCustomerId ?? null,
          })),
        },
      },
    });

    // ── O FATURAMENTO DA CÓPIA ────────────────────────────────────────────────
    //
    // UM só, sem cobertura: a cópia nasce sem veículo (quem vincula a tarefa é o
    // chamador), e um faturamento sem cobertura é a afirmação honesta nesse
    // instante — "cobra este orçamento, e quais implementos ainda não se sabe".
    // Quando a tarefa entrar, a reconciliação lhe dá a cobertura.
    //
    // Não pode ser aninhado no `create` acima: o pagador tem FK obrigatória para o
    // ORÇAMENTO além da do faturamento, e o id do orçamento só existe depois que
    // ele é gravado.
    if (configsByCustomer.length > 0) {
      await (tx as any).billing.create({
        data: {
          quote: { connect: { id: newQuote.id } },
          customerConfigs: {
            create: configsByCustomer.map(c => ({
              quote: { connect: { id: newQuote.id } },
              customer: { connect: { id: c.customerId } },
              subtotal: c.subtotal,
              total: c.total,
              discountType: c.discountType,
              discountValue: c.discountValue,
              discountReference: c.discountReference,
              customPaymentText: c.customPaymentText,
              paymentCondition: c.paymentCondition,
              paymentConfig: (c as any).paymentConfig ?? null,
              generateInvoice: c.generateInvoice,
              generateBankSlip: c.generateBankSlip,
            })),
          },
        },
      });
    }

    // Recompute discount-aware per-config + aggregate totals from the cloned rows
    // so the copy is internally consistent (never trust the copied scalars).
    await this.recalcQuoteTotals(tx, newQuote.id);

    return newQuote.id;
  }

  /**
   * Copy fields from one task to another
   *
   * @param destinationTaskId - Task to copy fields to
   * @param sourceTaskId - Task to copy fields from
   * @param fields - Array of fields to copy
   * @param userId - User performing the copy operation
   * @returns Result object with success status, message, and details
   */
  async copyFromTask(
    destinationTaskId: string,
    sourceTaskId: string,
    fields: CopyableTaskField[],
    userId: string,
    userPrivilege?: string,
    _retryCount = 0,
  ): Promise<{
    success: boolean;
    message: string;
    copiedFields: CopyableTaskField[];
    details: Record<string, any>;
  }> {
    // A task can never be its own source. Beyond being a pure no-op for every
    // scalar field, the quote branch is actively DESTRUCTIVE: it deep-copies the
    // quote, repoints `task.quoteId` at the copy, then deletes the task's previous
    // quote as "orphaned" — which, when source === destination, is the very quote
    // it just copied FROM. The user's original quote is deleted and any editor
    // still holding its id 404s on save (PUT /budgets/<id>). The UI must not
    // offer this, but the guard belongs here: this is where the damage happens.
    if (destinationTaskId === sourceTaskId) {
      throw new BadRequestException('A tarefa de origem não pode ser a mesma tarefa de destino.');
    }

    this.logger.log(
      `[copyFromTask] Copying ${fields.length} field(s) from task ${sourceTaskId} to ${destinationTaskId}`,
    );
    this.logger.debug(`[copyFromTask] Requested fields: ${JSON.stringify(fields)}`);
    this.logger.debug(`[copyFromTask] User privilege: ${userPrivilege}`);

    // Import permission filter function
    const { expandAllFieldsForUser } = require('../../../schemas/task-copy');

    // Expand 'all' to only fields user has permission to copy, and filter all fields by privilege
    const fieldsToProcess: CopyableTaskField[] = expandAllFieldsForUser(fields, userPrivilege);
    this.logger.log(
      `[copyFromTask] After privilege filtering: ${fieldsToProcess.length} fields for privilege ${userPrivilege}`,
    );

    // Ensure we have fields to process
    if (fieldsToProcess.length === 0) {
      return {
        success: false,
        message: 'Nenhum campo permitido para cópia com seu nível de privilégio',
        copiedFields: [],
        details: {},
      };
    }

    // ── A TRAVA DO DINHEIRO TAMBÉM VALE AQUI ─────────────────────────────────
    //
    // Copiar `quoteId` REPONTA o vínculo do veículo de destino: ele deixa o
    // orçamento em que está e passa a um duplicado do orçamento de origem. Se o
    // implemento já está na cobertura de um faturamento CONGELADO — com fatura
    // emitida, boleto registrado no Sicredi e NFS-e autorizada na prefeitura —,
    // isso o arranca de debaixo da cobrança que já saiu.
    //
    // `PUT /tasks/:id` nunca teve esse buraco (o repositório carrega `billings` e
    // a trava recusa). O `copy-from` grava com `tx.task.update` cru, por fora do
    // repositório E do validador de campos, então a guarda tem de estar aqui.
    if (fieldsToProcess.includes('quoteId' as CopyableTaskField)) {
      const bloqueados = await this.findMoneyLockedTaskIds([destinationTaskId]);
      if (bloqueados.length > 0) {
        throw new BadRequestException(
          'Não é possível copiar o orçamento para este veículo: ele já está coberto por um ' +
            `faturamento aprovado (orçamento nº ${bloqueados[0].budgetNumber ?? '—'}). ` +
            'Reverta o faturamento antes de trocar o orçamento do veículo.',
        );
      }
    }

    try {
      // Orçamento órfão protegido por assinatura coletada: não pode ser purgado
      // dentro da transação — é cancelado (preservado) DEPOIS do commit, porque
      // o cancelamento pode fazer chamadas externas (Sicredi/Elotech).
      let protectedOrphanQuoteId: string | null = null;

      const transactionResult = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Fetch source task with all necessary relations
        const sourceTask = await tx.task.findUnique({
          where: { id: sourceTaskId },
          include: {
            implement: {
              select: {
                serialNumber: true,
                id: true,
                category: true,
                type: true,
                spot: true,
                // Include full implementMeasure data for cloning individual instances
                backSideMeasureId: true,
                leftSideMeasureId: true,
                rightSideMeasureId: true,
                frontSideMeasureId: true,
                backSideMeasure: { select: FACE_MEASURE_COPY_SELECT },
                leftSideMeasure: { select: FACE_MEASURE_COPY_SELECT },
                rightSideMeasure: { select: FACE_MEASURE_COPY_SELECT },
                frontSideMeasure: { select: FACE_MEASURE_COPY_SELECT },
                rearDoorLeaves: true,
                rearDoorBarCount: true,
                rearDoorHatchCount: true,
                projectFiles: { select: { id: true, filename: true, thumbnailUrl: true } },
                // A ARTE do implemento de origem (a que vale: nem reprovada, nem substituída)
                layouts: {
                  where: { status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } },
                  orderBy: { createdAt: 'asc' },
                  select: {
                    id: true,
                    fileId: true,
                    file: { select: { id: true, filename: true, thumbnailUrl: true } },
                  },
                },
              },
            },
            observation: true,
            budgets: { select: { id: true } },
            invoices: { select: { id: true } },
            receipts: { select: { id: true } },
            bankSlips: { select: { id: true } },
            reimbursements: { select: { id: true } },
            invoiceReimbursements: { select: { id: true } },
            baseFiles: {
              select: {
                id: true,
                filename: true,
                thumbnailUrl: true,
              },
            },
            projectFiles: {
              select: {
                id: true,
                filename: true,
                thumbnailUrl: true,
              },
            },
            logoPaints: { select: { id: true } },
            cuts: {
              select: {
                id: true,
                fileId: true,
                type: true,
                origin: true,
                reason: true,
                parentCutId: true,
              },
            },
            airbrushings: {
              include: {
                receipts: { select: { id: true } },
                invoices: { select: { id: true } },
                layouts: { select: { id: true, fileId: true, status: true } },
              },
            },
            serviceOrders: {
              select: {
                id: true,
                description: true,
                type: true,
              },
            },
            quote: {
              select: {
                id: true,
                budgetNumber: true,
                total: true,
                services: {
                  select: {
                    description: true,
                    amount: true,
                    position: true,
                  },
                  // Match the canonical display order (position asc, createdAt tiebreaker)
                  // so the copy changelog preview lists services as on the source quote.
                  orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
                },
              },
            },
            responsibles: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                roles: true,
              },
            },
          },
        });

        if (!sourceTask) {
          throw new NotFoundException(`Tarefa de origem não encontrada (ID: ${sourceTaskId})`);
        }

        this.logger.debug(
          `[copyFromTask] Source task loaded: ${sourceTask.name} (${sourceTask.id})`,
        );
        this.logger.debug(`[copyFromTask] Source has implement: ${!!sourceTask.implement}`);
        this.logger.debug(`[copyFromTask] Source has cuts: ${sourceTask.cuts?.length || 0}`);
        this.logger.debug(
          `[copyFromTask] Source has airbrushings: ${sourceTask.airbrushings?.length || 0}`,
        );
        this.logger.debug(`[copyFromTask] 🔍 RAW SOURCE TASK DATES:`);
        this.logger.debug(`[copyFromTask]   - term: ${JSON.stringify(sourceTask.term)}`);
        this.logger.debug(`[copyFromTask]   - entryDate: ${JSON.stringify(sourceTask.entryDate)}`);
        this.logger.debug(
          `[copyFromTask]   - forecastDate: ${JSON.stringify(sourceTask.forecastDate)}`,
        );
        this.logger.debug(`[copyFromTask]   - term type: ${typeof sourceTask.term}`);
        this.logger.debug(`[copyFromTask]   - entryDate type: ${typeof sourceTask.entryDate}`);
        this.logger.debug(
          `[copyFromTask]   - forecastDate type: ${typeof sourceTask.forecastDate}`,
        );

        // Fetch destination task with all relations (for old value comparison in changelogs)
        const destinationTask = await tx.task.findUnique({
          where: { id: destinationTaskId },
          include: {
            implement: {
              select: {
                serialNumber: true,
                id: true,
                category: true,
                type: true,
                spot: true,
                backSideMeasureId: true,
                leftSideMeasureId: true,
                rightSideMeasureId: true,
                frontSideMeasureId: true,
                rearDoorLeaves: true,
                rearDoorBarCount: true,
                rearDoorHatchCount: true,
                projectFiles: { select: { id: true } },
                layouts: { select: { id: true, fileId: true } },
              },
            },
            observation: true,
            // fantasyName drives the Clientes/{cliente}/ storage folder for any file
            // cloned into the destination task (e.g. airbrushing layouts below).
            customer: { select: { id: true, fantasyName: true } },
            baseFiles: { select: { id: true } },
            projectFiles: { select: { id: true } },
            logoPaints: { select: { id: true } },
            cuts: { select: { id: true } },
            airbrushings: { select: { id: true } },
            serviceOrders: { select: { id: true, type: true, description: true } },
            // Include quote for enriched oldValue in changelog
            quote: {
              select: {
                id: true,
                budgetNumber: true,
                total: true,
                services: {
                  select: {
                    description: true,
                    amount: true,
                    position: true,
                  },
                  // Match the canonical display order (position asc, createdAt tiebreaker)
                  // so the copy changelog preview lists services as on the source quote.
                  orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
                },
              },
            },
            responsibles: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                roles: true,
              },
            },
          },
        });

        if (!destinationTask) {
          throw new NotFoundException(
            `Tarefa de destino não encontrada (ID: ${destinationTaskId})`,
          );
        }

        this.logger.debug(
          `[copyFromTask] Destination task loaded: ${destinationTask.name} (${destinationTask.id})`,
        );

        // Store old values for changelog tracking
        const oldValues: Record<string, any> = {
          name: destinationTask.name,
          details: destinationTask.details,
          term: destinationTask.term,
          entryDate: destinationTask.entryDate,
          forecastDate: destinationTask.forecastDate,
          bonification: destinationTask.bonification,
          responsibles: destinationTask.responsibles?.map(r => r.id) || [],
          customerId: destinationTask.customerId,
          // Store enriched quote data for changelog display (not just UUID)
          quoteId: destinationTask.quote
            ? {
                id: destinationTask.quote.id,
                budgetNumber: destinationTask.quote.budgetNumber,
                total: destinationTask.quote.total,
                items: destinationTask.quote.services || [],
              }
            : null,
          paintId: destinationTask.paintId,
          implementLayouts: destinationTask.implement?.layouts?.map(a => a.fileId) || [],
          baseFileIds: destinationTask.baseFiles?.map(f => f.id) || [],
          projectFileIds: destinationTask.projectFiles?.map(f => f.id) || [],
          logoPaintIds: destinationTask.logoPaints?.map(p => p.id) || [],
          cuts: destinationTask.cuts?.length || 0,
          airbrushings: destinationTask.airbrushings?.length || 0,
          'serviceOrders:PRODUCTION':
            destinationTask.serviceOrders?.filter(so => so.type === 'PRODUCTION').length || 0,
          'serviceOrders:COMMERCIAL':
            destinationTask.serviceOrders?.filter(so => so.type === 'COMMERCIAL').length || 0,
          'serviceOrders:LOGISTIC':
            destinationTask.serviceOrders?.filter(so => so.type === 'LOGISTIC').length || 0,
          'serviceOrders:ARTWORK':
            destinationTask.serviceOrders?.filter(so => so.type === 'ARTWORK').length || 0,
          implementType: destinationTask.implement?.type || null,
          category: destinationTask.implement?.category || null,
          implementMeasures: Object.fromEntries(
            FACES.map(face => [FACE_FK[face], destinationTask.implement?.[FACE_FK[face]] || null]),
          ),
          rearDoor: Object.fromEntries(
            IMPLEMENT_REAR_DOOR_FIELDS.map(f => [f, destinationTask.implement?.[f] ?? null]),
          ),
          implementProjectFiles: destinationTask.implement?.projectFiles?.map(f => f.id) || [],
          observation: destinationTask.observation?.description || null,
        };

        // Array to store field changes for events (emitted after transaction)
        const fieldChangesForEvents: Array<{
          field: string;
          oldValue: any;
          newValue: any;
        }> = [];

        // Prepare update data
        const updateData: any = {};
        const copiedFields: CopyableTaskField[] = [];
        const details: Record<string, any> = {};
        // When copying a quote onto the destination, the destination's PREVIOUS
        // quote is left dangling (no task points at it, but its budgetNumber +
        // services + configs survive). Capture it here so we can clean it up
        // after the reassign — but only when it carries no active obligation.
        let orphanedOldQuoteId: string | null = null;
        // Lados de medida que a cópia escreveu no destino — replicados aos irmãos
        // DEPOIS do vínculo final com o orçamento (a mesma cópia pode trocar o
        // orçamento do destino, e replicar antes mediria os irmãos errados).
        const ladosDeMedidaCopiados: ImplementFace[] = [];

        this.logger.log(`[copyFromTask] Processing ${fieldsToProcess.length} fields...`);
        this.logger.debug(`[copyFromTask] Fields to process: ${fieldsToProcess.join(', ')}`);
        this.logger.debug(
          `[copyFromTask] Source task dates - term: ${sourceTask.term}, entryDate: ${sourceTask.entryDate}, forecastDate: ${sourceTask.forecastDate}`,
        );

        // Helper to check if field has data
        const hasData = (value: any): boolean => {
          if (value === null || value === undefined) return false;
          if (Array.isArray(value)) return value.length > 0;
          // Special handling for Date objects
          if (value instanceof Date) return !isNaN(value.getTime());
          if (typeof value === 'object') return Object.keys(value).length > 0;
          return true;
        };

        // Process each field
        for (const field of fieldsToProcess) {
          switch (field) {
            // ===== SIMPLE FIELDS =====
            case 'name':
              if (hasData(sourceTask.name)) {
                updateData.name = sourceTask.name;
                copiedFields.push(field);
                details.name = sourceTask.name;
              }
              break;

            case 'details':
              if (hasData(sourceTask.details)) {
                updateData.details = sourceTask.details;
                copiedFields.push(field);
                details.details = sourceTask.details;
              }
              break;

            case 'term':
              this.logger.debug(
                `[copyFromTask] term value: ${sourceTask.term}, hasData: ${hasData(sourceTask.term)}`,
              );
              if (hasData(sourceTask.term)) {
                updateData.term = sourceTask.term;
                copiedFields.push(field);
                details.term = sourceTask.term;
                this.logger.debug(`[copyFromTask] term copied: ${sourceTask.term}`);
              } else {
                this.logger.debug(`[copyFromTask] term NOT copied (no data)`);
              }
              break;

            case 'entryDate':
              this.logger.debug(
                `[copyFromTask] entryDate value: ${sourceTask.entryDate}, hasData: ${hasData(sourceTask.entryDate)}`,
              );
              if (hasData(sourceTask.entryDate)) {
                updateData.entryDate = sourceTask.entryDate;
                copiedFields.push(field);
                details.entryDate = sourceTask.entryDate;
                this.logger.debug(`[copyFromTask] entryDate copied: ${sourceTask.entryDate}`);
              } else {
                this.logger.debug(`[copyFromTask] entryDate NOT copied (no data)`);
              }
              break;

            case 'forecastDate':
              this.logger.debug(
                `[copyFromTask] forecastDate value: ${sourceTask.forecastDate}, hasData: ${hasData(sourceTask.forecastDate)}`,
              );
              if (hasData(sourceTask.forecastDate)) {
                updateData.forecastDate = sourceTask.forecastDate;
                // Reset cleared when copying forecastDate — new forecast needs fresh confirmation
                updateData.cleared = false;
                copiedFields.push(field);
                details.forecastDate = sourceTask.forecastDate;
                this.logger.debug(`[copyFromTask] forecastDate copied: ${sourceTask.forecastDate}`);
              } else {
                this.logger.debug(`[copyFromTask] forecastDate NOT copied (no data)`);
              }
              break;

            case 'bonification':
              if (hasData(sourceTask.bonification)) {
                updateData.bonification = sourceTask.bonification;
                updateData.bonificationOrder = getBonificationStatusOrder(sourceTask.bonification);
                copiedFields.push(field);
                details.bonification = sourceTask.bonification;
              }
              break;

            case 'responsibles':
              if (hasData(sourceTask.responsibles)) {
                const responsibleIds = sourceTask.responsibles.map(r => r.id);
                updateData.responsibles = {
                  set: responsibleIds.map(id => ({ id })),
                };
                copiedFields.push(field);
                details.responsibles = sourceTask.responsibles.map(r => ({
                  id: r.id,
                  name: r.name,
                  roles: r.roles,
                  phone: r.phone,
                  email: r.email,
                }));
              }
              break;

            // ===== REFERENCES =====
            case 'customerId':
              if (hasData(sourceTask.customerId)) {
                updateData.customerId = sourceTask.customerId;
                copiedFields.push(field);
                details.customerId = sourceTask.customerId;
              }
              break;

            case 'quoteId':
              if (hasData(sourceTask.quoteId)) {
                // Remember the destination's CURRENT quote before we overwrite the
                // FK — it would otherwise dangle forever. Cleaned up post-update
                // (guarded against active obligations).
                if (destinationTask.quote?.id) {
                  orphanedOldQuoteId = destinationTask.quote.id;
                }
                // Create an independent copy of the quote (never share quote across tasks)
                const newQuoteId = await this.duplicateBudget(sourceTask.quoteId, tx);
                updateData.quoteId = newQuoteId;
                copiedFields.push(field);
                // Store quote info for changelog display
                details.quoteId = {
                  id: newQuoteId,
                  budgetNumber: sourceTask.quote?.budgetNumber || null,
                  total: sourceTask.quote?.total || null,
                  items: sourceTask.quote?.services || [],
                };
              }
              break;

            case 'paintId':
              if (hasData(sourceTask.paintId)) {
                updateData.paintId = sourceTask.paintId;
                copiedFields.push(field);
                details.paintId = sourceTask.paintId;
              }
              break;

            // ===== SHARED FILE IDS =====
            // ===== A ARTE (do implemento de origem para o de destino) =====
            // Linhas NOVAS, em RASCUNHO: a aprovação é do cliente DESTE veículo, e
            // copiar o status faria uma arte aprovada para outro implemento valer
            // aqui sem ninguém ter aprovado. O arquivo é o mesmo (a unicidade é
            // (implemento, arquivo)); o que o destino já tem não se repete.
            case 'implementLayouts':
              if (hasData(sourceTask.implement?.layouts)) {
                const destinationImplement = await tx.implement.findUnique({
                  where: { taskId: destinationTaskId },
                  select: { id: true, layouts: { select: { fileId: true } } },
                });
                if (!destinationImplement) {
                  throw new InternalServerErrorException(
                    'Tarefa de destino sem implemento: toda tarefa tem exatamente um implemento.',
                  );
                }
                const alreadyThere = new Set(destinationImplement.layouts.map(l => l.fileId));
                const toCopy = sourceTask.implement.layouts.filter(
                  l => !alreadyThere.has(l.fileId),
                );
                for (const l of toCopy) {
                  await tx.layout.create({
                    data: {
                      fileId: l.fileId,
                      implementId: destinationImplement.id,
                      status: 'DRAFT',
                      createdById: userId,
                    },
                  });
                }
                copiedFields.push(field);
                // Store file info for changelog display
                details.implementLayouts = toCopy.map(a => ({
                  fileId: a.fileId,
                  filename: a.file?.filename,
                  thumbnailUrl: a.file?.thumbnailUrl,
                }));
              }
              break;

            case 'baseFileIds':
              if (hasData(sourceTask.baseFiles)) {
                const baseFileIds = sourceTask.baseFiles.map(f => f.id);
                updateData.baseFiles = {
                  set: baseFileIds.map(id => ({ id })),
                };
                copiedFields.push(field);
                // Store file info for changelog display
                details.baseFileIds = sourceTask.baseFiles.map(f => ({
                  id: f.id,
                  filename: f.filename,
                  thumbnailUrl: f.thumbnailUrl,
                }));
              }
              break;

            case 'projectFileIds':
              if (hasData(sourceTask.projectFiles)) {
                const projectFileIds = sourceTask.projectFiles.map(f => f.id);
                updateData.projectFiles = {
                  set: projectFileIds.map(id => ({ id })),
                };
                copiedFields.push(field);
                details.projectFileIds = sourceTask.projectFiles.map(f => ({
                  id: f.id,
                  filename: f.filename,
                  thumbnailUrl: f.thumbnailUrl,
                }));
              }
              break;

            case 'logoPaintIds':
              if (hasData(sourceTask.logoPaints)) {
                const logoPaintIds = sourceTask.logoPaints.map(p => p.id);
                updateData.logoPaints = {
                  set: logoPaintIds.map(id => ({ id })),
                };
                copiedFields.push(field);
                details.logoPaintIds = logoPaintIds;
              }
              break;

            // ===== INDIVIDUAL RESOURCES (Create New) =====
            case 'cuts':
              if (hasData(sourceTask.cuts)) {
                // PASS 1: create every copied cut WITHOUT a parentCutId. Copying
                // the source's parentCutId verbatim would dangle — it points at a
                // cut on the SOURCE task, not the new copies. Build an old→new id
                // map so we can rewire parent links to the destination copies.
                const oldToNewCutId = new Map<string, string>();
                const newCuts = await Promise.all(
                  sourceTask.cuts.map(async cut => {
                    const created = await tx.cut.create({
                      data: {
                        taskId: destinationTaskId,
                        fileId: cut.fileId,
                        type: cut.type,
                        status: CUT_STATUS.PENDING,
                        statusOrder: 1, // PENDING order
                        origin: cut.origin,
                        reason: cut.reason,
                        // parentCutId set in PASS 2 (remapped) — never the source's.
                      },
                    });
                    if ((cut as any).id) {
                      oldToNewCutId.set((cut as any).id, created.id);
                    }
                    return created;
                  }),
                );

                // PASS 2: rewire parent links. A copied cut whose source parent was
                // ALSO copied gets the remapped destination parent; a cut whose
                // parent lives outside this copy stays parentless (null) rather
                // than dangling onto the source task.
                await Promise.all(
                  sourceTask.cuts.map(async (cut, index) => {
                    const sourceParentId = (cut as any).parentCutId as string | null;
                    if (!sourceParentId) return;
                    const remappedParentId = oldToNewCutId.get(sourceParentId);
                    if (remappedParentId) {
                      await tx.cut.update({
                        where: { id: newCuts[index].id },
                        data: { parentCutId: remappedParentId },
                      });
                    }
                  }),
                );

                copiedFields.push(field);
                details.cuts = {
                  count: newCuts.length,
                  ids: newCuts.map(c => c.id),
                };
              }
              break;

            case 'airbrushings':
              if (hasData(sourceTask.airbrushings)) {
                // Create new airbrushing records with PENDING status
                const newAirbrushings = await Promise.all(
                  sourceTask.airbrushings.map(async airbrushing => {
                    // Uma linha de arte tem UM dono (M3): `connect` roubaria a linha
                    // da aerografia de origem. A cópia ganha linhas NOVAS sobre o
                    // MESMO arquivo — a unicidade é (dono, arquivo), e o arquivo
                    // compartilhado fica protegido pela referência de cada dono.
                    const copiedLayouts = ((airbrushing.layouts as any[]) ?? []).map(a => ({
                      file: { connect: { id: a.fileId as string } },
                      status: a.status,
                    }));

                    return await tx.airbrushing.create({
                      data: {
                        taskId: destinationTaskId,
                        // Sem aerografista a cópia vai para cotação, e o valor sai dela.
                        price: airbrushing.painterId ? airbrushing.price : null,
                        // Job spec, not runtime progress — copies with the definition.
                        description: airbrushing.description ?? null,
                        // Assigned painter carries over with the airbrushing definition.
                        painterId: airbrushing.painterId ?? null,
                        // Fresh work item: status resets and start/finish clear — those are
                        // runtime progress, not template data to copy. A copy must be
                        // released to the floor again, so it starts in Em Preparação —
                        // or, sem aerografista, em cotação (ver resolveNewAirbrushingStatus).
                        status: resolveNewAirbrushingStatus(null, airbrushing.painterId),
                        statusOrder: getAirbrushingStatusOrder(
                          resolveNewAirbrushingStatus(null, airbrushing.painterId),
                        ),
                        quotationOpenedAt: airbrushing.painterId ? null : new Date(),
                        startDate: null,
                        finishDate: null,
                        // Shared files (M2M) can be connected; layouts are new rows.
                        receipts: airbrushing.receipts?.length
                          ? { connect: airbrushing.receipts.map(r => ({ id: r.id })) }
                          : undefined,
                        invoices: airbrushing.invoices?.length
                          ? { connect: airbrushing.invoices.map(i => ({ id: i.id })) }
                          : undefined,
                        layouts: copiedLayouts.length ? { create: copiedLayouts } : undefined,
                      },
                    });
                  }),
                );
                copiedFields.push(field);
                details.airbrushings = {
                  count: newAirbrushings.length,
                  ids: newAirbrushings.map(a => a.id),
                };
              }
              break;

            // ===== IMPLEMENT TYPE (Shared Reference) =====
            // (o token continua `implementType`: renomeá-lo seria 400 no app instalado)
            case 'implementType':
              if (hasData(sourceTask.implement?.type)) {
                // DD1: o implemento do destino SEMPRE existe — `update`, nunca criar.
                await tx.implement.update({
                  where: { taskId: destinationTaskId },
                  data: { type: sourceTask.implement.type },
                });
                copiedFields.push(field);
                details.implementType = sourceTask.implement.type;
              }
              break;

            // ===== CATEGORY (Shared Reference) =====
            case 'category':
              if (hasData(sourceTask.implement?.category)) {
                // DD1: o implemento do destino SEMPRE existe — `update`, nunca criar.
                await tx.implement.update({
                  where: { taskId: destinationTaskId },
                  data: { category: sourceTask.implement.category },
                });
                copiedFields.push(field);
                details.category = sourceTask.implement.category;
              }
              break;

            // ===== PORTA TRASEIRA (as três colunas juntas; 0 portinholas é dado) =====
            case 'rearDoor':
              if (IMPLEMENT_REAR_DOOR_FIELDS.some(f => sourceTask.implement?.[f] != null)) {
                const rearDoor = Object.fromEntries(
                  IMPLEMENT_REAR_DOOR_FIELDS.map(f => [f, sourceTask.implement?.[f] ?? null]),
                );
                // DD1: o implemento do destino SEMPRE existe — `update`, nunca criar.
                await tx.implement.update({ where: { taskId: destinationTaskId }, data: rearDoor });
                copiedFields.push(field);
                details.rearDoor = rearDoor;
              }
              break;

            // ===== PROJETO DO IMPLEMENTO (M2M: o mesmo PDF da Furgões serve N implementos) =====
            case 'implementProjectFiles':
              if (hasData(sourceTask.implement?.projectFiles)) {
                await tx.implement.update({
                  where: { taskId: destinationTaskId },
                  data: {
                    projectFiles: { set: sourceTask.implement.projectFiles.map(f => ({ id: f.id })) },
                  },
                });
                copiedFields.push(field);
                details.implementProjectFiles = sourceTask.implement.projectFiles.map(f => ({
                  id: f.id,
                  filename: f.filename,
                  thumbnailUrl: f.thumbnailUrl,
                }));
              }
              break;

            // ===== LAYOUTS (Individual Clones) =====
            case 'implementMeasures':
              if (hasData(sourceTask.implement)) {
                const existingImplement = await tx.implement.findUnique({
                  where: { taskId: destinationTaskId },
                  select: { id: true },
                });

                // Cada face da origem vira uma linha NOVA no destino (escritor
                // único, `cloneFaces`); a anterior do destino só sai se ficou sem
                // uso. Face vazia na origem não mexe no destino.
                // DD1: o implemento do destino SEMPRE existe (o ramo que o criava saiu).
                const destinationImplementId = existingImplement?.id;
                if (!destinationImplementId) {
                  throw new InternalServerErrorException(
                    'Tarefa de destino sem implemento: toda tarefa tem exatamente um implemento.',
                  );
                }
                const clonedFaces = await cloneFaces(
                  tx,
                  sourceTask.implement.id,
                  destinationImplementId,
                );

                const implementMeasureData: Record<string, string> = {};
                for (const cloned of clonedFaces) {
                  implementMeasureData[cloned.fk] = cloned.measureId!;
                  ladosDeMedidaCopiados.push(cloned.face);
                }
                copiedFields.push(field);

                // Helper to calculate dimensions from implementMeasure
                const getImplementMeasureDimensions = (implementMeasure: any) => {
                  if (!implementMeasure) return null;
                  const height = implementMeasure.height
                    ? Math.round(implementMeasure.height * 100)
                    : 0;
                  const totalWidth = implementMeasure.sections
                    ? implementMeasure.sections.reduce(
                        (sum: number, s: any) => sum + (s.width || 0) * 100,
                        0,
                      )
                    : 0;
                  return { height, width: Math.round(totalWidth) };
                };

                // Store cloned implementMeasure data with dimensions for changelog display
                details.implementMeasures = {
                  ...implementMeasureData,
                  ...Object.fromEntries(
                    FACES.map(face => [
                      `${face}SideDimensions`,
                      getImplementMeasureDimensions(sourceTask.implement[FACE_REL[face]]),
                    ]),
                  ),
                };
              }
              break;

            // ===== OBSERVATION =====
            case 'observation':
              if (hasData(sourceTask.observation)) {
                // Check if destination already has an observation
                const existingObservation = await tx.observation.findUnique({
                  where: { taskId: destinationTaskId },
                });

                const observationData = {
                  description: sourceTask.observation.description,
                };

                if (existingObservation) {
                  await tx.observation.update({
                    where: { taskId: destinationTaskId },
                    data: observationData,
                  });
                } else {
                  await tx.observation.create({
                    data: {
                      ...observationData,
                      taskId: destinationTaskId,
                    },
                  });
                }
                copiedFields.push(field);
                details.observation = observationData;
              }
              break;

            // ===== SERVICE ORDERS BY TYPE (Merge without duplicates) =====
            case 'serviceOrders:PRODUCTION':
            case 'serviceOrders:COMMERCIAL':
            case 'serviceOrders:LOGISTIC':
            case 'serviceOrders:ARTWORK': {
              const soType = field.split(':')[1] as SERVICE_ORDER_TYPE;

              // Get source service orders of this type
              const sourceSOsOfType =
                sourceTask.serviceOrders?.filter(so => so.type === soType) || [];
              if (sourceSOsOfType.length === 0) break;

              // Fetch full details of source service orders
              const fullSOsOfType = await tx.serviceOrder.findMany({
                where: {
                  id: { in: sourceSOsOfType.map(so => so.id) },
                },
                select: {
                  description: true,
                  type: true,
                  observation: true,
                  assignedToId: true,
                  position: true,
                },
                orderBy: { position: 'asc' },
              });

              // Get existing service orders of this type on destination for dedup
              const existingDestSOs = await tx.serviceOrder.findMany({
                where: {
                  taskId: destinationTaskId,
                  type: soType,
                },
                select: { description: true },
              });
              const existingDescriptions = new Set(
                existingDestSOs.map(so => so.description?.toLowerCase().trim()),
              );

              // Get max position of existing SOs on destination for proper ordering
              const maxPositionResult = await tx.serviceOrder.aggregate({
                where: { taskId: destinationTaskId },
                _max: { position: true },
              });
              let nextPosition = (maxPositionResult._max.position ?? -1) + 1;

              // Filter out duplicates (same description + type already exists)
              const sosToCreate = fullSOsOfType.filter(
                so => !existingDescriptions.has(so.description?.toLowerCase().trim()),
              );

              if (sosToCreate.length === 0) {
                this.logger.log(
                  `[copyFromTask] All ${fullSOsOfType.length} ${soType} service orders already exist on destination, skipping`,
                );
                break;
              }

              const skippedCount = fullSOsOfType.length - sosToCreate.length;
              if (skippedCount > 0) {
                this.logger.log(
                  `[copyFromTask] Skipping ${skippedCount} duplicate ${soType} service orders`,
                );
              }

              // Create non-duplicate service orders with PENDING status
              const newServiceOrders = await Promise.all(
                sosToCreate.map(async so => {
                  return await tx.serviceOrder.create({
                    data: {
                      taskId: destinationTaskId,
                      description: so.description,
                      type: so.type,
                      observation: so.observation,
                      assignedToId: so.assignedToId,
                      position: nextPosition++,
                      status: SERVICE_ORDER_STATUS.PENDING,
                      statusOrder: 1, // PENDING order
                      createdById: userId,
                    },
                  });
                }),
              );

              copiedFields.push(field);
              details[field] = {
                count: newServiceOrders.length,
                skippedDuplicates: skippedCount,
                ids: newServiceOrders.map(so => so.id),
                items: sosToCreate.map(so => ({
                  description: so.description,
                  type: so.type,
                })),
              };
              break;
            }

            default:
              this.logger.warn(`[copyFromTask] Unknown field: ${field}`);
          }
        }

        this.logger.log(
          `[copyFromTask] Finished processing fields. Copied ${copiedFields.length} field(s)`,
        );
        this.logger.debug(`[copyFromTask] Copied fields: ${JSON.stringify(copiedFields)}`);
        this.logger.debug(
          `[copyFromTask] UpdateData keys: ${JSON.stringify(Object.keys(updateData))}`,
        );

        // Copiar a previsão zera `cleared` (acima) — mas não quando o implemento já
        // entrou: com data de entrada a tarefa segue liberada (utils/task-cleared.ts).
        if (updateData.cleared === false) {
          const effectiveEntryDate =
            updateData.entryDate !== undefined ? updateData.entryDate : destinationTask.entryDate;

          if (hasEntered(effectiveEntryDate as Date | null | undefined)) {
            updateData.cleared = true;
          }
        }

        // Update the destination task with collected data
        if (Object.keys(updateData).length > 0) {
          this.logger.log(
            `[copyFromTask] Updating task with ${Object.keys(updateData).length} field(s)`,
          );
          await tx.task.update({
            where: { id: destinationTaskId },
            data: updateData,
          });
          this.logger.log(`[copyFromTask] Task update successful`);

          // Mudou a liberação (acima)? Mova o implemento junto.
          if (typeof updateData.cleared === 'boolean') {
            await syncImplementSpotWithCleared(tx, destinationTaskId, updateData.cleared);
          }

          if (updateData.quoteId) {
            // ── A COBERTURA E OS TOTAIS DOS DOIS LADOS ──────────────────────────
            //
            // O vínculo `Task.quoteId` acabou de mudar, e a contagem de veículos é
            // o multiplicador de todo total (`por veículo × N`). O repositório faz
            // exatamente isto quando o vínculo muda por `PUT /tasks/:id`
            // (`task-prisma.repository.ts`); o `copy-from` grava por fora dele e
            // ficava sem.
            //
            // Sem o refatiamento, o `Billing` do orçamento duplicado nasce SEM
            // cobertura (a cópia é criada antes de a tarefa existir para ela): a
            // fatura não sabe que implemento cobra, a nota não tem a quem se ligar e
            // a lista de Faturamento mostra uma cobrança sem veículo.
            //
            // Sem o recálculo do orçamento de ORIGEM DO DESTINO — quando ele
            // sobrevive por ter outros veículos —, ele segue cobrando por um
            // implemento que não é mais dele.
            await resliceQuoteCoverage(tx, updateData.quoteId as string);
            await this.recalcQuoteTotals(tx, updateData.quoteId as string);
            if (orphanedOldQuoteId && orphanedOldQuoteId !== updateData.quoteId) {
              const aindaExiste = await tx.budget.count({ where: { id: orphanedOldQuoteId } });
              if (aindaExiste > 0) {
                await resliceQuoteCoverage(tx, orphanedOldQuoteId);
                await this.recalcQuoteTotals(tx, orphanedOldQuoteId);
              }
            }

            // The PRODUCTION service orders are derived from the quote's services (by matching
            // description) — regenerate them to match the copied quote, since the old quote's SOs
            // are now orphaned and the new services have none. (The "SO didn't update" fix.)
            await this.regenerateProductionServiceOrdersFromQuote(
              tx,
              destinationTaskId,
              updateData.quoteId as string,
              userId,
              (destinationTask.status as TASK_STATUS) ?? TASK_STATUS.PREPARATION,
            );
          }
        } else {
          this.logger.log(`[copyFromTask] No fields to update via task.update()`);
        }

        // O TAMANHO É DO ORÇAMENTO: a medida copiada para o destino vale para os
        // irmãos dele no orçamento em que ele ficou. Esta porta cria o implemento
        // quando falta, e o irmão sem implemento ganha um. Ver
        // `utils/implement-measure-replication.ts`.
        if (ladosDeMedidaCopiados.length > 0) {
          await replicateImplementMeasuresToQuoteSiblings(tx, {
            sourceTaskId: destinationTaskId,
            sides: ladosDeMedidaCopiados,
            logChange: (entry: ReplicationLogEntry) =>
              this.logReplicatedMeasure(entry, destinationTaskId, userId, tx),
          });
        }

        // Clean up the destination's now-orphaned previous quote (reassigned
        // above). Delete ONLY when it carries no active billing obligation —
        // an Invoice in any non-cancelled state means the quote was billed and
        // must be preserved for the financial record. Quote children (services,
        // customer configs) cascade on delete; the financial guard prevents
        // wiping a quote that still anchors a live invoice/installment.
        // Belt-and-braces: `budget.delete` below is unconditional by design, so a
        // stale `orphanedOldQuoteId` silently destroys real data. Two ways it can be
        // stale, both refusing the delete rather than trusting the caller:
        //  - it IS the source's quote (the self-copy shape guarded at the top of this
        //    method — the destination's FK has already been repointed by now, so a
        //    "still attached?" test alone comes back clean and deletes the original);
        //  - some other task still points at it (quotes are never meant to be shared,
        //    but deleting one out from under a live task is unrecoverable).
        const orphanIsSourceQuote =
          !!orphanedOldQuoteId && orphanedOldQuoteId === sourceTask.quoteId;
        const orphanIsStillAttached =
          !!orphanedOldQuoteId &&
          (await tx.task.count({ where: { quoteId: orphanedOldQuoteId } })) > 0;

        if (orphanIsSourceQuote || orphanIsStillAttached) {
          this.logger.warn(
            `[copyFromTask] Skipped deleting previous quote ${orphanedOldQuoteId}: ` +
              `${orphanIsSourceQuote ? 'it is the source task quote' : 'still referenced by a task'}`,
          );
        }

        if (
          orphanedOldQuoteId &&
          orphanedOldQuoteId !== updateData.quoteId &&
          !orphanIsSourceQuote &&
          !orphanIsStillAttached
        ) {
          const activeInvoiceCount = await tx.invoice.count({
            where: {
              customerConfig: { quoteId: orphanedOldQuoteId },
              status: { not: INVOICE_STATUS.CANCELLED },
            },
          });

          // ── A FATURA NÃO É O ÚNICO SINAL DE QUE O DINHEIRO SAIU ──────────────
          //
          // A guarda só perguntava por `Invoice`. Um faturamento APROVADO que
          // ainda não emitiu fatura — ou LIQUIDADO por conciliação, sem fatura de
          // onde derivar o carimbo — não era visto por ninguém, e `Billing.quote`
          // é `onDelete: Cascade`: o `budget.delete` abaixo levava a cobrança
          // inteira junto, silenciosamente. `BILLING_FROZEN_WHERE` é o mesmo
          // predicado da trava do dinheiro, em SQL.
          const frozenBillingCount = await (tx as any).billing.count({
            where: { quoteId: orphanedOldQuoteId, ...BILLING_FROZEN_WHERE },
          });

          if (activeInvoiceCount === 0 && frozenBillingCount === 0) {
            // Assinatura colhida/envelope selado protege o orçamento órfão:
            // ele NÃO é apagado — fica preservado (sem tarefa apontando para
            // ele) e é cancelado após o commit, junto das cerimônias RUNNING.
            const protectedIds = await this.signatureDeletion.findProtectedQuoteIds(
              [orphanedOldQuoteId],
              tx,
            );
            if (protectedIds.length > 0) {
              protectedOrphanQuoteId = orphanedOldQuoteId;
              this.logger.warn(
                `[copyFromTask] Orçamento órfão ${orphanedOldQuoteId} tem assinatura coletada — ` +
                  'será cancelado (preservado) em vez de excluído',
              );
            } else {
              // Mesmo cascade append-only do delete de orçamento: sem a purga
              // explícita este `budget.delete` estoura `restrict_violation` e
              // derruba a cópia inteira. A quote está sendo descartada por já
              // ter sido substituída, e um envelope não-vinculante dela não
              // obriga ninguém a nada.
              const purgedQuote = await this.signatureDeletion.purgeForQuotes(tx, [
                orphanedOldQuoteId,
              ]);
              if (purgedQuote.envelopesRemoved) {
                this.logger.warn(
                  `[copyFromTask] Purgados ${purgedQuote.envelopesRemoved} envelope(s) de assinatura ` +
                    `do orçamento órfão ${orphanedOldQuoteId}`,
                );
              }
              await tx.budget.delete({ where: { id: orphanedOldQuoteId } });
              this.logger.log(
                `[copyFromTask] Deleted orphaned previous quote ${orphanedOldQuoteId} (no active invoice)`,
              );
            }
          } else {
            this.logger.warn(
              `[copyFromTask] Kept orphaned previous quote ${orphanedOldQuoteId}: ` +
                `${activeInvoiceCount} non-cancelled invoice(s) and ${frozenBillingCount} frozen billing(s) still reference it`,
            );
          }
        }

        // Create INDIVIDUAL changelog entries for each copied field
        if (copiedFields.length > 0) {
          this.logger.debug(`[copyFromTask] Creating individual changelog entries...`);
          this.logger.debug(`[copyFromTask] Copied fields: ${copiedFields.join(', ')}`);

          for (const field of copiedFields) {
            try {
              const oldValue = oldValues[field];
              const newValue = details[field];
              const fieldLabel = translateFieldName(field);

              // Create individual changelog entry for this field
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: destinationTaskId,
                action: CHANGE_ACTION.UPDATE,
                field,
                oldValue,
                newValue,
                reason: `Campo ${fieldLabel} copiado da tarefa "${sourceTask.name || sourceTaskId}"`,
                triggeredBy: CHANGE_TRIGGERED_BY.TASK_COPY_FROM_TASK,
                triggeredById: sourceTaskId,
                userId,
                transaction: tx,
                metadata: {
                  sourceTaskId,
                  sourceTaskName: sourceTask.name,
                },
              });

              // Track field change for event emission (after transaction)
              fieldChangesForEvents.push({
                field,
                oldValue,
                newValue,
              });

              this.logger.debug(`[copyFromTask] Changelog entry created for field: ${field}`);
            } catch (changelogError) {
              this.logger.error(
                `[copyFromTask] Error creating changelog for field ${field}:`,
                changelogError,
              );
              // Don't throw - changelog is not critical for the copy operation
            }
          }
        }

        return {
          success: true,
          message:
            copiedFields.length === 1
              ? `1 campo copiado com sucesso da tarefa ${sourceTask.name || sourceTaskId}`
              : `${copiedFields.length} campos copiados com sucesso da tarefa ${sourceTask.name || sourceTaskId}`,
          copiedFields,
          details,
          fieldChangesForEvents,
          sourceTask: { id: sourceTask.id, name: sourceTask.name },
          destinationTaskId,
        };
      });

      // Pós-commit: cancela (preservando) o orçamento órfão protegido por
      // assinatura coletada. Best-effort — a cópia já foi commitada.
      if (protectedOrphanQuoteId) {
        try {
          await this.budgetService.cancelForTaskCancellation(
            protectedOrphanQuoteId,
            userId || '',
            'Orçamento substituído por cópia de outra tarefa — cancelado (não excluído) por possuir assinatura eletrônica coletada',
          );
        } catch (cancelError) {
          this.logger.error(
            `[copyFromTask] Could not cancel protected orphan quote ${protectedOrphanQuoteId}: ${
              cancelError instanceof Error ? cancelError.message : String(cancelError)
            }`,
          );
        }
      }

      // After transaction success: Emit field change events for notifications
      // This triggers the notification system to send individual notifications per field
      if (
        transactionResult.fieldChangesForEvents &&
        transactionResult.fieldChangesForEvents.length > 0
      ) {
        this.logger.log(
          `[copyFromTask] Emitting ${transactionResult.fieldChangesForEvents.length} field change event(s) for notifications`,
        );

        // Fetch the updated task for event emission
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: destinationTaskId },
          include: {
            customer: { select: { id: true, fantasyName: true } },
          },
        });

        if (updatedTask) {
          for (const change of transactionResult.fieldChangesForEvents) {
            try {
              // Emit task.field.changed event (handled by task.listener.ts for notifications)
              this.eventEmitter.emit('task.field.changed', {
                task: updatedTask,
                field: change.field,
                oldValue: change.oldValue,
                newValue: change.newValue,
                changedBy: userId,
                isFileArray: ['implementLayouts', 'baseFileIds', 'logoPaintIds'].includes(
                  change.field,
                ),
              });

              this.logger.debug(
                `[copyFromTask] Emitted task.field.changed event for field: ${change.field}`,
              );
            } catch (eventError) {
              this.logger.error(
                `[copyFromTask] Error emitting event for field ${change.field}:`,
                eventError,
              );
              // Don't throw - event emission is not critical
            }
          }
        }
      }

      // Aerografias copiadas sem aerografista entram em cotação — anuncia.
      await this.airbrushingQuoteNotifier.notifyPendingRequests(undefined, userId);

      return {
        success: transactionResult.success,
        message: transactionResult.message,
        copiedFields: transactionResult.copiedFields,
        details: transactionResult.details,
      };
    } catch (error) {
      // If the transaction failed due to budgetNumber unique constraint,
      // retry the entire operation with a fresh transaction
      const isPrismaUniqueError =
        error?.code === 'P2002' &&
        (error?.meta?.target?.includes?.('budgetNumber') ||
          // Nome do índice ÚNICO, que o Postgres devolve como string em
          // `meta.target`. A migração o renomeia de `TaskQuote_budgetNumber_key`
          // para `Budget_budgetNumber_key`; os dois ficam aceitos porque o
          // código pode subir antes de a migração rodar — e aí o nome que volta
          // do banco ainda é o antigo, sem erro de compilação nenhum a acusar.
          error?.meta?.target?.includes?.('Budget_budgetNumber_key') ||
          error?.meta?.target?.includes?.('TaskQuote_budgetNumber_key'));

      if (isPrismaUniqueError && _retryCount < 3) {
        this.logger.warn(
          `[copyFromTask] Transaction failed due to budgetNumber conflict (attempt ${_retryCount + 1}), retrying...`,
        );
        return this.copyFromTask(
          destinationTaskId,
          sourceTaskId,
          fields,
          userId,
          userPrivilege,
          _retryCount + 1,
        );
      }

      this.logger.error(
        `[copyFromTask] Error copying fields from task ${sourceTaskId} to ${destinationTaskId}:`,
        error,
      );

      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      rethrowPrismaValidationAsBadRequest(error);
      throw new InternalServerErrorException(`Erro ao copiar campos da tarefa: ${error.message}`);
    }
  }

  // =====================
  // FORECAST RESCHEDULE & HISTORY
  // =====================

  async rescheduleForecast(
    taskId: string,
    data: { forecastDate: Date; reason: string },
    userId: string,
    include?: any,
  ): Promise<TaskUpdateResponse> {
    const existingTask = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, forecastDate: true, status: true, entryDate: true },
    });

    if (!existingTask) {
      throw new NotFoundException(`Tarefa ${taskId} não encontrada`);
    }

    if (existingTask.status === 'COMPLETED' || existingTask.status === 'CANCELLED') {
      throw new BadRequestException('Não é possível reagendar uma tarefa concluída ou cancelada');
    }

    const previousDate = existingTask.forecastDate;

    // Reagendar desfaz a liberação — MENOS quando o implemento já entrou: aí a previsão
    // é só a expectativa de saída e a liberação segue o implemento (utils/task-cleared.ts).
    const clearedAfterReschedule = hasEntered(existingTask.entryDate);

    const updatedTask = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const task = await tx.task.update({
        where: { id: taskId },
        data: { forecastDate: data.forecastDate, cleared: clearedAfterReschedule },
        include: include || undefined,
      });

      // Perdeu a liberação? O implemento sai do pátio junto.
      await syncImplementSpotWithCleared(tx, taskId, clearedAfterReschedule);

      // Only create reschedule history when there was a previous forecast date.
      // Setting a forecast for the first time (previousDate is null) is not a reschedule.
      if (previousDate) {
        await tx.taskForecastHistory.create({
          data: {
            taskId,
            previousDate,
            newDate: data.forecastDate,
            reason: data.reason,
            source: 'MANUAL',
            changedById: userId,
          },
        });
      }

      await tx.taskFieldChangeLog.create({
        data: {
          taskId,
          field: 'forecastDate',
          oldValue: previousDate ? previousDate.toISOString() : null,
          newValue: data.forecastDate.toISOString(),
          changedBy: userId,
        },
      });

      await this.changeLogService.logChange({
        entityId: taskId,
        entityType: ENTITY_TYPE.TASK,
        action: CHANGE_ACTION.RESCHEDULE,
        field: 'forecastDate',
        oldValue: previousDate?.toISOString() ?? null,
        newValue: data.forecastDate.toISOString(),
        reason: `Reagendamento: ${data.reason}`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER,
        triggeredById: null,
        userId,
        transaction: tx,
        metadata: { reason: data.reason },
      });

      return task;
    });

    // Emit field changed event for notifications
    try {
      await this.fieldTracker.emitFieldChangeEvents(updatedTask as Task, [
        {
          field: 'forecastDate',
          oldValue: previousDate,
          newValue: data.forecastDate,
          changedAt: new Date(),
          changedBy: userId,
        },
      ]);
    } catch (error) {
      this.logger.error('Error emitting forecast reschedule events:', error);
    }

    return {
      success: true,
      message: 'Previsão de liberação reagendada com sucesso',
      data: updatedTask as Task,
    };
  }

  async getForecastHistory(taskId: string, query: { page?: number; take?: number } = {}) {
    const page = query.page || 1;
    const take = query.take || 50;
    const skip = (page - 1) * take;

    const [data, total] = await Promise.all([
      this.prisma.taskForecastHistory.findMany({
        where: { taskId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          changedBy: {
            select: { id: true, name: true },
          },
        },
      }),
      this.prisma.taskForecastHistory.count({ where: { taskId } }),
    ]);

    return {
      success: true,
      data,
      meta: {
        total,
        page,
        take,
        totalPages: Math.ceil(total / take),
        hasNextPage: page * take < total,
      },
    };
  }
}
