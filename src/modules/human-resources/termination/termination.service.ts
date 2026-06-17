// termination.service.ts
// Rescisões (Departamento Pessoal) — contract §2.

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FileService } from '@modules/common/file/file.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  logEntityChange,
  trackAndLogFieldChanges,
} from '@modules/common/changelog/utils/changelog-helpers';
import { existsSync, unlinkSync } from 'fs';
import {
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  MEDICAL_EXAM_RESULT,
  MEDICAL_EXAM_STATUS,
  MEDICAL_EXAM_TYPE,
  NOTICE_TYPE,
  TERMINATION_DOCUMENT_STATUS,
  TERMINATION_DOCUMENT_TYPE,
  TERMINATION_ITEM_TYPE,
  TERMINATION_STATUS,
  TERMINATION_TYPE,
  CONTRACT_STATUS,
} from '../../../constants';
import {
  TERMINATION_STATUS_ORDER,
  CONTRACT_STATUS_ORDER,
  MEDICAL_EXAM_STATUS_ORDER,
} from '../../../constants/sortOrders';
import {
  EMPLOYER_NOTICE_TYPES,
  TerminationCalculationService,
  isUnderStability,
} from './termination-calculation.service';
import { TerminationDocumentService } from './termination-document.service';
import { EmploymentContractService } from '../employment-contract/employment-contract.service';
import type {
  TerminationBatchCreateResponse,
  TerminationBatchDeleteResponse,
  TerminationBatchUpdateResponse,
  TerminationCalculateResponse,
  TerminationComputeTaxesResponse,
  TerminationCreateResponse,
  TerminationDeleteResponse,
  TerminationDocumentUpdateResponse,
  TerminationGetManyResponse,
  TerminationGetUniqueResponse,
  TerminationItemCreateResponse,
  TerminationItemDeleteResponse,
  TerminationItemUpdateResponse,
  TerminationUpdateResponse,
} from '../../../types';
import type {
  TerminationAdvanceFormData,
  TerminationBatchCreateFormData,
  TerminationBatchDeleteFormData,
  TerminationBatchUpdateFormData,
  TerminationCreateFormData,
  TerminationDocumentUpdateFormData,
  TerminationDocumentUploadFormData,
  TerminationGetManyFormData,
  TerminationInclude,
  TerminationItemCreateFormData,
  TerminationItemUpdateFormData,
  TerminationUpdateFormData,
} from '../../../schemas';

const STATUS_LABELS_PT: Record<string, string> = {
  [TERMINATION_STATUS.INITIATED]: 'Iniciada',
  [TERMINATION_STATUS.NOTICE_PERIOD]: 'Aviso prévio',
  [TERMINATION_STATUS.DOCUMENTS]: 'Documentação',
  [TERMINATION_STATUS.MEDICAL_EXAM]: 'Exame demissional',
  [TERMINATION_STATUS.CALCULATION]: 'Cálculo',
  [TERMINATION_STATUS.PAYMENT]: 'Pagamento',
  [TERMINATION_STATUS.HOMOLOGATION]: 'Homologação',
  [TERMINATION_STATUS.COMPLETED]: 'Concluída',
  [TERMINATION_STATUS.CANCELLED]: 'Cancelada',
};

// Forward chain of the termination status machine (CANCELLED handled separately).
// HOMOLOGATION (Part G) sits between PAYMENT and COMPLETED: the TRCT/homologação
// documents are generated and (when applicable) homologated before closing.
const STATUS_CHAIN: TERMINATION_STATUS[] = [
  TERMINATION_STATUS.INITIATED,
  TERMINATION_STATUS.NOTICE_PERIOD,
  TERMINATION_STATUS.DOCUMENTS,
  TERMINATION_STATUS.MEDICAL_EXAM,
  TERMINATION_STATUS.CALCULATION,
  TERMINATION_STATUS.PAYMENT,
  TERMINATION_STATUS.HOMOLOGATION,
  TERMINATION_STATUS.COMPLETED,
];

/**
 * Per-termination applicable forward chain:
 * - NOTICE_PERIOD only applies when the notice is actually being WORKED
 *   (indemnified/waived/absent notices have no period to run);
 * - MEDICAL_EXAM never applies to DEATH (no exame demissional is possible).
 * Mirrored on the web in
 * web/src/components/personnel-department/termination/detail/status-stepper-card.tsx.
 */
export const terminationStatusChainFor = (termination: {
  type: string;
  noticeType: string | null;
}): TERMINATION_STATUS[] =>
  STATUS_CHAIN.filter(status => {
    if (status === TERMINATION_STATUS.NOTICE_PERIOD) {
      return termination.noticeType === NOTICE_TYPE.WORKED;
    }
    if (status === TERMINATION_STATUS.MEDICAL_EXAM) {
      return termination.type !== TERMINATION_TYPE.DEATH;
    }
    return true;
  });

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
};

@Injectable()
export class TerminationService {
  private readonly logger = new Logger(TerminationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
    private readonly calculationService: TerminationCalculationService,
    private readonly documentService: TerminationDocumentService,
    private readonly employmentContractService: EmploymentContractService,
  ) {}

  // =====================
  // Derived fields
  // =====================

  /**
   * projectedEndDate = terminationDate + noticeDays (only when the notice is
   * INDEMNIFIED and paid by the employer — CLT 487 §1º; a resigning
   * employee's unworked notice indemnifies the employer and never projects);
   * paymentDueDate = terminationDate + 10 calendar days (CLT 477 §6º).
   */
  private deriveDates(input: {
    type: TERMINATION_TYPE;
    terminationDate: Date | null;
    noticeType: string | null;
    noticeDays: number | null;
  }): { projectedEndDate: Date | null; paymentDueDate: Date | null } {
    const { type, terminationDate, noticeType, noticeDays } = input;
    if (!terminationDate) {
      return { projectedEndDate: null, paymentDueDate: null };
    }
    return {
      projectedEndDate:
        noticeType === NOTICE_TYPE.INDEMNIFIED &&
        noticeDays &&
        noticeDays > 0 &&
        EMPLOYER_NOTICE_TYPES.includes(type)
          ? addDays(terminationDate, noticeDays)
          : null,
      paymentDueDate: addDays(terminationDate, 10),
    };
  }

  /**
   * Document checklist per contract §2 / Part G: DISMISSAL_EXAM, TRCT, FGTS_GUIDE,
   * FGTS_STATEMENT, HOMOLOGATION_TERM, PAYMENT_RECEIPT and
   * DOCUMENT_DELIVERY_RECEIPT always; NOTICE_LETTER (carta de aviso /
   * WARNING_LETTER) only when notice applies; TERM_484A + MUTUAL_AGREEMENT_TERM
   * only for MUTUAL_AGREEMENT (484-A); UNEMPLOYMENT_INSURANCE_FORM only for
   * WITHOUT_CAUSE/INDIRECT. The TRCT, NOTICE_LETTER (WARNING_LETTER), TERM_484A
   * and HOMOLOGATION_TERM are auto-generatable as real PDFs (Part G).
   */
  private buildDocumentChecklist(
    type: TERMINATION_TYPE,
    noticeDays: number | null,
  ): TERMINATION_DOCUMENT_TYPE[] {
    const checklist: TERMINATION_DOCUMENT_TYPE[] = [
      // DEATH: no exame demissional is possible for a deceased collaborator
      ...(type === TERMINATION_TYPE.DEATH ? [] : [TERMINATION_DOCUMENT_TYPE.DISMISSAL_EXAM]),
      TERMINATION_DOCUMENT_TYPE.TRCT,
      TERMINATION_DOCUMENT_TYPE.FGTS_GUIDE,
      TERMINATION_DOCUMENT_TYPE.FGTS_STATEMENT,
      TERMINATION_DOCUMENT_TYPE.HOMOLOGATION_TERM,
      TERMINATION_DOCUMENT_TYPE.PAYMENT_RECEIPT,
      TERMINATION_DOCUMENT_TYPE.DOCUMENT_DELIVERY_RECEIPT,
    ];
    if (noticeDays !== null && noticeDays > 0) {
      checklist.unshift(TERMINATION_DOCUMENT_TYPE.WARNING_LETTER);
    }
    if (type === TERMINATION_TYPE.MUTUAL_AGREEMENT) {
      checklist.push(TERMINATION_DOCUMENT_TYPE.TERM_484A);
      checklist.push(TERMINATION_DOCUMENT_TYPE.MUTUAL_AGREEMENT_TERM);
    }
    if (type === TERMINATION_TYPE.WITHOUT_CAUSE || type === TERMINATION_TYPE.INDIRECT) {
      checklist.push(TERMINATION_DOCUMENT_TYPE.UNEMPLOYMENT_INSURANCE_FORM);
    }
    return checklist;
  }

  // =====================
  // Queries
  // =====================

  async findMany(query: TerminationGetManyFormData): Promise<TerminationGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit || 20;
      const skip = (page - 1) * take;

      const [total, terminations] = await Promise.all([
        this.prisma.termination.count({ where: query.where }),
        this.prisma.termination.findMany({
          where: query.where,
          orderBy: query.orderBy || { createdAt: 'desc' },
          include: query.include,
          skip,
          take,
        }),
      ]);

      const totalPages = Math.ceil(total / take) || 0;

      return {
        success: true,
        message: 'Rescisões carregadas com sucesso.',
        data: terminations as any[],
        meta: {
          totalRecords: total,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar rescisões:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar rescisões. Por favor, tente novamente.',
      );
    }
  }

  async findById(id: string, include?: TerminationInclude): Promise<TerminationGetUniqueResponse> {
    try {
      const termination = await this.prisma.termination.findUnique({
        where: { id },
        include: include ?? { items: true, documents: true, user: true },
      });

      if (!termination) {
        throw new NotFoundException('Rescisão não encontrada.');
      }

      return {
        success: true,
        message: 'Rescisão carregada com sucesso.',
        data: termination as any,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao buscar rescisão por ID:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar rescisão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Create
  // =====================

  private async createWithTransaction(
    tx: PrismaTransaction,
    data: TerminationCreateFormData,
    userId?: string,
    include?: TerminationInclude,
  ): Promise<any> {
    const user = await tx.user.findUnique({
      where: { id: data.userId },
      select: {
        id: true,
        name: true,
        currentContractStatus: true,
        currentContractId: true,
        currentContract: {
          select: {
            admissionDate: true,
            stabilityType: true,
            stabilityStart: true,
            stabilityEnd: true,
          },
        },
      },
    });
    if (!user) {
      throw new NotFoundException('Colaborador não encontrado.');
    }
    if (user.currentContractStatus === CONTRACT_STATUS.TERMINATED) {
      throw new BadRequestException('Este colaborador já está demitido.');
    }

    const type = data.type as TERMINATION_TYPE;

    // Estabilidade guard (Part G): block a termination — especially a dispensa
    // SEM justa causa — while the worker is inside a job-stability window
    // (acidentária/gestante/etc.). WITH_CAUSE (justa causa) and DEATH are the
    // legal exceptions and may proceed.
    const stabilityExempt =
      type === TERMINATION_TYPE.WITH_CAUSE || type === TERMINATION_TYPE.DEATH;
    if (
      !stabilityExempt &&
      data.terminationDate &&
      isUnderStability(user.currentContract, data.terminationDate)
    ) {
      throw new BadRequestException(
        'Não é possível registrar a rescisão: o colaborador está em período de estabilidade no trabalho. Apenas demissão por justa causa ou por falecimento é permitida nesse período.',
      );
    }

    const openTermination = await tx.termination.findFirst({
      where: {
        userId: data.userId,
        status: { notIn: [TERMINATION_STATUS.COMPLETED, TERMINATION_STATUS.CANCELLED] as any[] },
      },
      select: { id: true },
    });
    if (openTermination) {
      throw new BadRequestException(
        'Este colaborador já possui um processo de rescisão em andamento.',
      );
    }

    const terminationDate = data.terminationDate ?? null;
    const noticeDays = this.calculationService.computeNoticeDays(
      type,
      user.currentContract?.admissionDate ?? null,
      terminationDate,
    );
    const { projectedEndDate, paymentDueDate } = this.deriveDates({
      type,
      terminationDate,
      noticeType: data.noticeType ?? null,
      noticeDays,
    });

    const checklist = this.buildDocumentChecklist(type, noticeDays);

    const termination = await tx.termination.create({
      data: {
        userId: data.userId,
        contractId: user.currentContractId ?? null,
        type: type as any,
        status: TERMINATION_STATUS.INITIATED,
        statusOrder: TERMINATION_STATUS_ORDER[TERMINATION_STATUS.INITIATED],
        noticeType: (data.noticeType as any) ?? null,
        ...(data.noticeReduction ? { noticeReduction: data.noticeReduction as any } : {}),
        noticeDays,
        noticeStartDate: data.noticeStartDate ?? null,
        terminationDate,
        projectedEndDate,
        paymentDueDate,
        baseRemuneration: data.baseRemuneration ?? null,
        fgtsBalance: data.fgtsBalance ?? null,
        accruedVacationPeriods: data.accruedVacationPeriods ?? 0,
        reason: data.reason ?? null,
        justCauseArticle: data.justCauseArticle ?? null,
        initiatedById: userId ?? null,
        documents: {
          create: checklist.map(docType => ({
            type: docType as any,
            status: TERMINATION_DOCUMENT_STATUS.PENDING,
          })),
        },
      },
      include: include ?? { items: true, documents: true, user: true },
    });

    await logEntityChange({
      changeLogService: this.changeLogService,
      entityType: ENTITY_TYPE.TERMINATION,
      entityId: termination.id,
      action: CHANGE_ACTION.CREATE,
      entity: termination,
      reason: `Processo de rescisão criado para o colaborador ${user.name}`,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      userId: userId || null,
      transaction: tx,
    });

    return termination;
  }

  async create(
    data: TerminationCreateFormData,
    include?: TerminationInclude,
    userId?: string,
  ): Promise<TerminationCreateResponse> {
    try {
      const termination = await this.prisma.$transaction(async (tx: PrismaTransaction) =>
        this.createWithTransaction(tx, data, userId, include),
      );

      return {
        success: true,
        message: 'Rescisão criada com sucesso.',
        data: termination,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao criar rescisão:', error);
      throw new InternalServerErrorException('Erro ao criar rescisão. Por favor, tente novamente.');
    }
  }

  // =====================
  // Update — PUT /terminations/:id
  // =====================

  async update(
    id: string,
    data: TerminationUpdateFormData,
    include?: TerminationInclude,
    userId?: string,
  ): Promise<TerminationUpdateResponse> {
    try {
      const termination = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.termination.findUnique({
          where: { id },
          include: { user: { select: { currentContract: { select: { admissionDate: true } } } } },
        });
        if (!existing) {
          throw new NotFoundException('Rescisão não encontrada.');
        }
        if (
          existing.status === TERMINATION_STATUS.COMPLETED ||
          existing.status === TERMINATION_STATUS.CANCELLED
        ) {
          throw new BadRequestException(
            `Não é possível editar uma rescisão ${STATUS_LABELS_PT[existing.status].toLowerCase()}.`,
          );
        }

        const updateData: any = {};
        const directFields: (keyof TerminationUpdateFormData)[] = [
          'noticeType',
          'noticeReduction',
          'noticeDays',
          'noticeStartDate',
          'lastWorkingDate',
          'terminationDate',
          'paymentDate',
          'paidAmount',
          'baseRemuneration',
          'fgtsBalance',
          'accruedVacationPeriods',
          'reason',
          'justCauseArticle',
        ];
        for (const field of directFields) {
          if (data[field] !== undefined) {
            updateData[field] = data[field];
          }
        }

        // Recompute derived fields when their inputs change
        const noticeInputsChanged =
          data.terminationDate !== undefined ||
          data.noticeType !== undefined ||
          data.noticeDays !== undefined;
        if (noticeInputsChanged) {
          const terminationDate =
            data.terminationDate !== undefined ? data.terminationDate : existing.terminationDate;
          const noticeType =
            data.noticeType !== undefined ? data.noticeType : (existing.noticeType as any);

          let noticeDays: number | null;
          if (data.noticeDays !== undefined) {
            // Explicit manual override
            noticeDays = data.noticeDays;
          } else if (data.terminationDate !== undefined) {
            // terminationDate changed → recompute per the CLT rule
            noticeDays = this.calculationService.computeNoticeDays(
              existing.type as TERMINATION_TYPE,
              (existing as any).user?.currentContract?.admissionDate ?? null,
              terminationDate,
            );
          } else {
            noticeDays = existing.noticeDays;
          }

          const { projectedEndDate, paymentDueDate } = this.deriveDates({
            type: existing.type as TERMINATION_TYPE,
            terminationDate,
            noticeType,
            noticeDays,
          });
          updateData.noticeDays = noticeDays;
          updateData.projectedEndDate = projectedEndDate;
          updateData.paymentDueDate = paymentDueDate;
        }

        const updated = await tx.termination.update({
          where: { id },
          data: updateData,
          include: include ?? { items: true, documents: true, user: true },
        });

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TERMINATION,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: [
            'noticeType',
            'noticeReduction',
            'noticeDays',
            'noticeStartDate',
            'lastWorkingDate',
            'terminationDate',
            'projectedEndDate',
            'paymentDueDate',
            'paymentDate',
            'paidAmount',
            'baseRemuneration',
            'fgtsBalance',
            'accruedVacationPeriods',
            'reason',
            'justCauseArticle',
          ],
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Rescisão atualizada com sucesso.',
        data: termination as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao atualizar rescisão:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar rescisão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Delete
  // =====================

  async delete(id: string, userId?: string): Promise<TerminationDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const termination = await tx.termination.findUnique({ where: { id } });
        if (!termination) {
          throw new NotFoundException('Rescisão não encontrada.');
        }
        if (termination.status === TERMINATION_STATUS.COMPLETED) {
          throw new BadRequestException('Não é possível excluir uma rescisão concluída.');
        }

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TERMINATION,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: termination,
          reason: 'Processo de rescisão excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.termination.delete({ where: { id } });
      });

      return { success: true, message: 'Rescisão excluída com sucesso.' };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao excluir rescisão:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir rescisão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Verbas engine — POST /terminations/:id/calculate
  // =====================

  async calculate(id: string, userId?: string): Promise<TerminationCalculateResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const termination = await tx.termination.findUnique({
          where: { id },
          include: {
            contract: {
              select: {
                admissionDate: true,
                exp1EndAt: true,
                exp2EndAt: true,
                hasArt481Clause: true,
              },
            },
            user: {
              select: {
                currentContract: {
                  select: {
                    admissionDate: true,
                    exp1EndAt: true,
                    exp2EndAt: true,
                    hasArt481Clause: true,
                  },
                },
              },
            },
          },
        });
        if (!termination) {
          throw new NotFoundException('Rescisão não encontrada.');
        }
        if (
          termination.status === TERMINATION_STATUS.COMPLETED ||
          termination.status === TERMINATION_STATUS.CANCELLED
        ) {
          throw new BadRequestException(
            `Não é possível recalcular uma rescisão ${STATUS_LABELS_PT[termination.status].toLowerCase()}.`,
          );
        }

        // Prefer the contract pinned on the termination; fall back to the user's
        // current contract (legacy rows created before contractId was wired).
        const contract =
          (termination as any).contract ?? (termination as any).user?.currentContract;
        const computedItems = this.calculationService.calculate({
          type: termination.type as TERMINATION_TYPE,
          noticeType: termination.noticeType as NOTICE_TYPE | null,
          noticeDays: termination.noticeDays,
          terminationDate: termination.terminationDate,
          projectedEndDate: termination.projectedEndDate,
          baseRemuneration: termination.baseRemuneration,
          fgtsBalance: termination.fgtsBalance,
          accruedVacationPeriods: termination.accruedVacationPeriods,
          exp1StartAt: contract?.admissionDate ?? null,
          experienceEndAt: contract?.exp2EndAt ?? contract?.exp1EndAt ?? null,
          hasArt481Clause: contract?.hasArt481Clause ?? false,
        });

        // Replace every auto-calculated item; custom items (isCustom) are kept
        await tx.terminationItem.deleteMany({ where: { terminationId: id, isCustom: false } });
        if (computedItems.length > 0) {
          await tx.terminationItem.createMany({
            data: computedItems.map(item => ({
              terminationId: id,
              type: item.type as any,
              description: item.description,
              referenceQuantity: item.referenceQuantity,
              baseValue: item.baseValue,
              amount: item.amount,
              isCustom: false,
            })),
          });
        }

        const items = await tx.terminationItem.findMany({
          where: { terminationId: id },
          orderBy: [{ isCustom: 'asc' }, { createdAt: 'asc' }],
        });

        const round2 = (value: number) => Math.round(value * 100) / 100;
        const earnings = round2(
          items.filter(item => item.amount > 0).reduce((sum, item) => sum + item.amount, 0),
        );
        const discounts = round2(
          items.filter(item => item.amount < 0).reduce((sum, item) => sum + Math.abs(item.amount), 0),
        );
        const net = round2(earnings - discounts);

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TERMINATION,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'items',
          oldValue: null,
          newValue: { totalItems: items.length, earnings, discounts, net },
          reason: 'Verbas rescisórias recalculadas',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return { items, totals: { earnings, discounts, net } };
      });

      return {
        success: true,
        message: 'Verbas rescisórias calculadas com sucesso.',
        data: result as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao calcular verbas rescisórias:', error);
      throw new InternalServerErrorException(
        'Erro ao calcular verbas rescisórias. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Tax/FGTS assist — POST /terminations/:id/compute-taxes
  // =====================

  /**
   * Auto-computes INSS/IRRF on the TAXABLE verbas only (saldo de salário, aviso
   * prévio TRABALHADO, 13º proporcional) and the FGTS-multa base, persisting the
   * INSS_DISCOUNT/IRRF_DISCOUNT as CUSTOM items so they survive a verbas recalc
   * and remain editable (manual override). EXEMPT verbas — férias indenizadas
   * (vencidas/proporcionais + 1/3), aviso prévio INDENIZADO and the multa do
   * FGTS — are never taxed; the taxable set is derived from the computed item
   * types, which structurally prevents taxing the exempt verbas.
   */
  async computeTaxes(id: string, userId?: string): Promise<TerminationComputeTaxesResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const termination = await tx.termination.findUnique({
          where: { id },
          include: {
            items: true,
            user: { select: { dependentsCount: true } },
          },
        });
        if (!termination) {
          throw new NotFoundException('Rescisão não encontrada.');
        }
        if (
          termination.status === TERMINATION_STATUS.COMPLETED ||
          termination.status === TERMINATION_STATUS.CANCELLED
        ) {
          throw new BadRequestException(
            `Não é possível calcular impostos de uma rescisão ${STATUS_LABELS_PT[termination.status].toLowerCase()}.`,
          );
        }

        const items = (termination as any).items as Array<{
          type: TERMINATION_ITEM_TYPE;
          amount: number;
          description: string | null;
        }>;
        const sumOf = (type: TERMINATION_ITEM_TYPE) =>
          items.filter(i => i.type === type).reduce((s, i) => s + i.amount, 0);

        // TAXABLE verbas only. NOTE: NOTICE_INDEMNIFIED, ACCRUED_VACATION and
        // PROPORTIONAL_VACATION (férias indenizadas) and FGTS_FINE are EXEMPT
        // and intentionally NOT read here.
        const salaryBalance = sumOf(TERMINATION_ITEM_TYPE.SALARY_BALANCE);
        const thirteenth = sumOf(TERMINATION_ITEM_TYPE.THIRTEENTH_PROPORTIONAL);
        // The WORKED notice is not modelled as a verba line (it is paid in the
        // normal folha when worked); only the INDEMNIFIED notice produces an item
        // (which is exempt). So the monthly taxable base is the saldo de salário.
        const workedNotice = 0;

        const indemnifiedNotice = sumOf(TERMINATION_ITEM_TYPE.NOTICE_INDEMNIFIED);
        const fgtsBalance = termination.fgtsBalance ?? null;
        const year = (termination.terminationDate ?? new Date()).getFullYear();

        const assist = this.calculationService.computeTaxAssist({
          taxable: { salaryBalance, workedNotice, thirteenth },
          fgtsBalance,
          indemnifiedNotice,
          dependentsCount: (termination as any).user?.dependentsCount ?? 0,
          year,
        });

        // Defensive validation: the monthly taxable base must equal exactly the
        // taxable verbas (saldo + aviso trabalhado) and never include any exempt
        // verba (aviso indenizado, férias indenizadas, multa FGTS). Structurally
        // guaranteed by the taxable-set derivation above; asserted to fail loudly
        // on regression.
        const round2 = (v: number) => Math.round(v * 100) / 100;
        if (round2(assist.monthlyInssBase) !== round2(salaryBalance + workedNotice)) {
          throw new InternalServerErrorException(
            'Erro de incidência tributária: a base de cálculo mensal não corresponde às verbas tributáveis.',
          );
        }

        // Upsert INSS/IRRF discount items as CUSTOM (editable, survive recalc).
        const upsertDiscount = async (
          type: TERMINATION_ITEM_TYPE,
          amount: number,
          description: string,
        ) => {
          const existing = await tx.terminationItem.findFirst({
            where: { terminationId: id, type: type as any },
          });
          if (existing) {
            await tx.terminationItem.update({
              where: { id: existing.id },
              data: { amount: -Math.abs(amount), description, isCustom: true },
            });
          } else if (amount > 0) {
            await tx.terminationItem.create({
              data: {
                terminationId: id,
                type: type as any,
                description,
                amount: -Math.abs(amount),
                isCustom: true,
              },
            });
          }
        };

        await upsertDiscount(
          TERMINATION_ITEM_TYPE.INSS_DISCOUNT,
          assist.totalInss,
          `INSS rescisório (mensal ${assist.monthlyInss.toFixed(2)} + 13º ${assist.thirteenthInss.toFixed(2)})`,
        );
        await upsertDiscount(
          TERMINATION_ITEM_TYPE.IRRF_DISCOUNT,
          assist.totalIrrf,
          `IRRF rescisório (mensal ${assist.monthlyIrrf.toFixed(2)} + 13º ${assist.thirteenthIrrf.toFixed(2)})`,
        );

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TERMINATION,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'items',
          oldValue: null,
          newValue: {
            inss: assist.totalInss,
            irrf: assist.totalIrrf,
            fgtsFineBase: assist.fgtsFineBase,
          },
          reason: 'INSS/IRRF/FGTS auto-calculados (assistente de impostos da rescisão)',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return assist;
      });

      return {
        success: true,
        message:
          'Impostos da rescisão calculados com sucesso. Os valores de INSS/IRRF foram lançados como verbas personalizadas e podem ser ajustados manualmente.',
        data: result,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao calcular impostos da rescisão:', error);
      throw new InternalServerErrorException(
        'Erro ao calcular impostos da rescisão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Status machine — PUT /terminations/:id/advance
  // =====================

  async advance(
    id: string,
    data: TerminationAdvanceFormData,
    include?: TerminationInclude,
    userId?: string,
  ): Promise<TerminationUpdateResponse> {
    try {
      const termination = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.termination.findUnique({
          where: { id },
          include: {
            items: { select: { id: true } },
            user: {
              select: {
                id: true,
                name: true,
                currentContractStatus: true,
                currentContractId: true,
                currentContract: { select: { terminationDate: true } },
              },
            },
          },
        });
        if (!existing) {
          throw new NotFoundException('Rescisão não encontrada.');
        }

        const currentStatus = existing.status as TERMINATION_STATUS;

        if (
          currentStatus === TERMINATION_STATUS.COMPLETED ||
          currentStatus === TERMINATION_STATUS.CANCELLED
        ) {
          throw new BadRequestException(
            `Não é possível alterar o status de uma rescisão ${STATUS_LABELS_PT[currentStatus].toLowerCase()}.`,
          );
        }

        // Applicable chain skips NOTICE_PERIOD when the notice is not worked
        // and MEDICAL_EXAM for DEATH. The next status is the first applicable
        // status after the current one in the full chain (robust even when
        // the current status was later made inapplicable by an edit).
        const applicableChain = terminationStatusChainFor(existing);
        const currentIndex = STATUS_CHAIN.indexOf(currentStatus);
        const nextStatus = applicableChain.find(
          status => STATUS_CHAIN.indexOf(status) > currentIndex,
        ) as TERMINATION_STATUS;
        const targetStatus = (data.status as TERMINATION_STATUS) ?? nextStatus;

        // CANCELLED is reachable from any non-final status; otherwise only the
        // immediate next applicable status in the chain is allowed.
        if (targetStatus !== TERMINATION_STATUS.CANCELLED && targetStatus !== nextStatus) {
          throw new BadRequestException(
            `Transição de status inválida: ${STATUS_LABELS_PT[currentStatus]} → ${STATUS_LABELS_PT[targetStatus]}. O próximo status válido é ${STATUS_LABELS_PT[nextStatus]} (ou Cancelada).`,
          );
        }

        const isCancelling = targetStatus === TERMINATION_STATUS.CANCELLED;
        // Cancelar exige justificativa (por que a rescisão não foi concluída).
        const cancellationReason = (data.reason ?? '').toString().trim();
        if (isCancelling && cancellationReason.length === 0) {
          throw new BadRequestException(
            'Informe o motivo do cancelamento (por que a rescisão não foi concluída).',
          );
        }

        // Guard: →PAYMENT requires calculated/registered items
        if (
          targetStatus === TERMINATION_STATUS.PAYMENT &&
          (existing.items || []).length === 0
        ) {
          throw new BadRequestException(
            'Não é possível avançar para Pagamento: nenhuma verba rescisória foi calculada.',
          );
        }

        // Guard: →COMPLETED requires paymentDate
        if (targetStatus === TERMINATION_STATUS.COMPLETED && !existing.paymentDate) {
          throw new BadRequestException(
            'Não é possível concluir a rescisão: a data de pagamento não foi informada.',
          );
        }

        // Guard: leaving MEDICAL_EXAM (→CALCULATION) requires the DISMISSAL
        // exam (created since this termination started) to be COMPLETED.
        // Result UNFIT does not block, but a warning is returned in the message.
        let warningMessage = '';
        if (
          currentStatus === TERMINATION_STATUS.MEDICAL_EXAM &&
          targetStatus === TERMINATION_STATUS.CALCULATION
        ) {
          // Prefer the FK link (this termination's own ASO); fall back to the
          // legacy userId+type+createdAt lookup for rows created before the FK.
          let dismissalExam = await tx.medicalExam.findFirst({
            where: {
              terminationId: existing.id,
              status: { not: MEDICAL_EXAM_STATUS.CANCELLED as any },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (!dismissalExam) {
            dismissalExam = await tx.medicalExam.findFirst({
              where: {
                userId: existing.userId,
                type: MEDICAL_EXAM_TYPE.DISMISSAL as any,
                status: { not: MEDICAL_EXAM_STATUS.CANCELLED as any },
                createdAt: { gte: existing.createdAt },
              },
              orderBy: { createdAt: 'desc' },
            });
          }
          if (!dismissalExam) {
            throw new BadRequestException(
              'Não é possível avançar para Cálculo: aguardando ASO demissional. Nenhum exame demissional foi encontrado para o colaborador neste processo de rescisão.',
            );
          }
          if (dismissalExam.status !== MEDICAL_EXAM_STATUS.COMPLETED) {
            throw new BadRequestException(
              'Não é possível avançar para Cálculo: aguardando ASO demissional. O exame demissional ainda não foi concluído.',
            );
          }
          if (dismissalExam.result === MEDICAL_EXAM_RESULT.UNFIT) {
            warningMessage =
              ' Atenção: o exame demissional foi concluído com resultado Inapto — verifique possíveis regras de estabilidade antes de prosseguir com a rescisão.';
          }
        }

        // Entering MEDICAL_EXAM: auto-create the DISMISSAL exam (SCHEDULED)
        // when no non-cancelled DISMISSAL exam exists for the user since this
        // termination was created.
        let examCrossReference = '';
        if (targetStatus === TERMINATION_STATUS.MEDICAL_EXAM) {
          const existingExam = await tx.medicalExam.findFirst({
            where: {
              status: { not: MEDICAL_EXAM_STATUS.CANCELLED as any },
              OR: [
                { terminationId: existing.id },
                {
                  userId: existing.userId,
                  type: MEDICAL_EXAM_TYPE.DISMISSAL as any,
                  createdAt: { gte: existing.createdAt },
                },
              ],
            },
            select: { id: true },
          });
          if (!existingExam) {
            const createdExam = await tx.medicalExam.create({
              data: {
                userId: existing.userId,
                type: MEDICAL_EXAM_TYPE.DISMISSAL as any,
                status: MEDICAL_EXAM_STATUS.SCHEDULED as any,
                statusOrder: MEDICAL_EXAM_STATUS_ORDER[MEDICAL_EXAM_STATUS.SCHEDULED],
                // Link the ASO to THIS termination so the advance-guard and the
                // doc-sync use the FK instead of the fragile userId+type+createdAt
                // heuristic.
                terminationId: existing.id,
              },
            });

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.MEDICAL_EXAM,
              entityId: createdExam.id,
              action: CHANGE_ACTION.CREATE,
              entity: createdExam,
              reason: `Exame demissional (ASO) criado automaticamente pelo processo de rescisão${(existing as any).user?.name ? ` do colaborador ${(existing as any).user.name}` : ''}`,
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              userId: userId || null,
              transaction: tx,
            });

            examCrossReference = ' — exame demissional (ASO) agendado automaticamente';
          }
        }

        const updated = await tx.termination.update({
          where: { id },
          data: {
            status: targetStatus as any,
            statusOrder: TERMINATION_STATUS_ORDER[targetStatus],
            // Ao cancelar: preserva a etapa em que estava + a justificativa.
            ...(isCancelling
              ? { cancelledFromStatus: currentStatus as any, cancellationReason }
              : { cancelledFromStatus: null, cancellationReason: null }),
          },
          include: include ?? { items: true, documents: true, user: true },
        });

        // Entering HOMOLOGATION: auto-generate the real-PDF documents (TRCT,
        // carta de aviso, termo 484-A, termo de homologação) for the checklist
        // entries that exist on this termination and aren't yet generated.
        let docCrossReference = '';
        if (targetStatus === TERMINATION_STATUS.HOMOLOGATION) {
          const pending = await tx.terminationDocument.findMany({
            where: {
              terminationId: id,
              type: {
                in: TerminationDocumentService.GENERATABLE_TYPES as any[],
              },
              status: TERMINATION_DOCUMENT_STATUS.PENDING,
            },
            select: { type: true },
          });
          const generated: string[] = [];
          for (const doc of pending) {
            try {
              const fileId = await this.documentService.generateAndPersist(
                tx,
                id,
                doc.type as TERMINATION_DOCUMENT_TYPE,
              );
              if (fileId) generated.push(doc.type);
            } catch (genError: any) {
              this.logger.warn(
                `Falha ao gerar documento ${doc.type} da rescisão ${id}: ${genError?.message ?? genError}`,
              );
            }
          }
          if (generated.length > 0) {
            docCrossReference = ` — documentos gerados automaticamente: ${generated.join(', ')}`;
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TERMINATION,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'documents',
              oldValue: null,
              newValue: { generated },
              reason: `Documentos de rescisão gerados automaticamente na homologação: ${generated.join(', ')}`,
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TERMINATION,
          entityId: id,
          action: isCancelling ? CHANGE_ACTION.CANCEL : CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: currentStatus,
          newValue: targetStatus,
          reason: isCancelling
            ? `Rescisão cancelada na etapa "${STATUS_LABELS_PT[currentStatus]}": ${cancellationReason}`
            : `Status da rescisão alterado: ${STATUS_LABELS_PT[currentStatus]} → ${STATUS_LABELS_PT[targetStatus]}${examCrossReference}${docCrossReference}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        // On COMPLETED: close the user's CURRENT vínculo (status=TERMINATED,
        // terminationDate, terminationType) and re-sync the User cache
        // (isActive=false) via the EmploymentContractService. The termination
        // itself closes the contract (Part G: DISMISSED → TERMINATED).
        if (targetStatus === TERMINATION_STATUS.COMPLETED) {
          const user = (existing as any).user;
          const terminationDate = existing.terminationDate ?? new Date();
          const contractId = (existing as any).contractId ?? user?.currentContractId;

          if (
            user &&
            user.currentContractStatus !== CONTRACT_STATUS.TERMINATED &&
            contractId
          ) {
            await tx.employmentContract.update({
              where: { id: contractId },
              data: {
                status: CONTRACT_STATUS.TERMINATED as any,
                statusOrder: CONTRACT_STATUS_ORDER[CONTRACT_STATUS.TERMINATED],
                terminationDate,
                terminationType: existing.type as any,
              },
            });

            // Histórico de fases: encerra a fase atualmente em aberto na data de
            // rescisão (o vínculo terminou; a timeline fecha).
            await this.employmentContractService.closeOpenContractPhase(tx, {
              contractId,
              endDate: terminationDate,
            });

            await this.employmentContractService.syncUserCurrentContract(tx, existing.userId, {
              userId: userId ?? undefined,
            });

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.USER,
              entityId: existing.userId,
              action: CHANGE_ACTION.UPDATE,
              field: 'currentContractStatus',
              oldValue: user.currentContractStatus,
              newValue: CONTRACT_STATUS.TERMINATED,
              reason: 'Colaborador demitido pela conclusão do processo de rescisão',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.USER,
              entityId: existing.userId,
              action: CHANGE_ACTION.UPDATE,
              field: 'terminationDate',
              oldValue: user.currentContract?.terminationDate ?? null,
              newValue: terminationDate,
              reason: 'Data de demissão definida pela conclusão do processo de rescisão',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        return { updated, warningMessage };
      });

      return {
        success: true,
        message: `Status da rescisão atualizado com sucesso.${termination.warningMessage}`,
        data: termination.updated as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao avançar status da rescisão:', error);
      throw new InternalServerErrorException(
        'Erro ao avançar status da rescisão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Status machine — PUT /terminations/:id/regress (step ONE step backward)
  // =====================

  async regress(
    id: string,
    userId?: string,
    include?: TerminationInclude,
  ): Promise<TerminationUpdateResponse> {
    try {
      const termination = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.termination.findUnique({
          where: { id },
          include: {
            items: { select: { id: true } },
            user: {
              select: {
                id: true,
                name: true,
                currentContractStatus: true,
                currentContractId: true,
                currentContract: { select: { terminationDate: true } },
              },
            },
          },
        });
        if (!existing) {
          throw new NotFoundException('Rescisão não encontrada.');
        }

        const currentStatus = existing.status as TERMINATION_STATUS;

        // Guards (mirror advance's terminal-state protection, but split so the
        // COMPLETED message can warn that the employee was already demitted).
        if (currentStatus === TERMINATION_STATUS.CANCELLED) {
          throw new BadRequestException(
            'Não é possível retroceder uma rescisão cancelada.',
          );
        }
        if (currentStatus === TERMINATION_STATUS.COMPLETED) {
          // COMPLETED already demitted the employee; do NOT auto-un-demit here —
          // keep it blocked (safest).
          throw new BadRequestException(
            'Não é possível retroceder uma rescisão concluída. Reabra o processo por outro meio.',
          );
        }

        // Applicable chain skips NOTICE_PERIOD when the notice is not worked
        // and MEDICAL_EXAM for DEATH. The previous status is the last applicable
        // status before the current one in the full chain (robust even when
        // the current status was later made inapplicable by an edit).
        const applicableChain = terminationStatusChainFor(existing);
        const currentIndex = STATUS_CHAIN.indexOf(currentStatus);
        const previousStatus = [...applicableChain]
          .reverse()
          .find(status => STATUS_CHAIN.indexOf(status) < currentIndex) as
          | TERMINATION_STATUS
          | undefined;

        if (!previousStatus) {
          throw new BadRequestException('A rescisão já está na primeira etapa.');
        }

        const updated = await tx.termination.update({
          where: { id },
          data: {
            status: previousStatus as any,
            statusOrder: TERMINATION_STATUS_ORDER[previousStatus],
          },
          include: include ?? { items: true, documents: true, user: true },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TERMINATION,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: currentStatus,
          newValue: previousStatus,
          reason: `Retrocedeu etapa da rescisão: ${STATUS_LABELS_PT[currentStatus]} → ${STATUS_LABELS_PT[previousStatus]}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return { updated };
      });

      return {
        success: true,
        message: 'Status da rescisão atualizado com sucesso.',
        data: termination.updated as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao retroceder status da rescisão:', error);
      throw new InternalServerErrorException(
        'Erro ao retroceder status da rescisão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Documents — POST /terminations/:id/documents (multipart)
  // =====================

  async uploadDocument(
    id: string,
    data: TerminationDocumentUploadFormData,
    file: Express.Multer.File | undefined,
    userId?: string,
  ): Promise<TerminationDocumentUpdateResponse> {
    if (!file) {
      throw new BadRequestException('O arquivo do documento é obrigatório.');
    }

    try {
      const document = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const termination = await tx.termination.findUnique({
          where: { id },
          include: { user: { select: { name: true } } },
        });
        if (!termination) {
          throw new NotFoundException('Rescisão não encontrada.');
        }

        const createdFile = await this.fileService.createFromUploadWithTransaction(
          tx,
          file,
          'documents',
          userId,
          {
            entityId: id,
            entityType: 'TERMINATION',
            userName: (termination as any).user?.name,
          },
        );

        // OTHER allows multiple rows; every other type is upserted by type.
        const existingDocument =
          data.type === TERMINATION_DOCUMENT_TYPE.OTHER
            ? null
            : await tx.terminationDocument.findFirst({
                where: { terminationId: id, type: data.type as any },
              });

        let document: any;
        if (existingDocument) {
          document = await tx.terminationDocument.update({
            where: { id: existingDocument.id },
            data: {
              fileId: createdFile.id,
              status: TERMINATION_DOCUMENT_STATUS.GENERATED,
              ...(data.note !== undefined ? { note: data.note } : {}),
            },
            include: { file: true },
          });
        } else {
          document = await tx.terminationDocument.create({
            data: {
              terminationId: id,
              type: data.type as any,
              fileId: createdFile.id,
              status: TERMINATION_DOCUMENT_STATUS.GENERATED,
              note: data.note ?? null,
            },
            include: { file: true },
          });
        }

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TERMINATION,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: `document_${data.type}`,
          oldValue: existingDocument
            ? { status: existingDocument.status, fileId: existingDocument.fileId }
            : null,
          newValue: { status: TERMINATION_DOCUMENT_STATUS.GENERATED, fileId: createdFile.id },
          reason: `Documento de rescisão recebido: ${data.type}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return document;
      });

      return {
        success: true,
        message: 'Documento da rescisão enviado com sucesso.',
        data: document,
      };
    } catch (error: any) {
      if (file && existsSync(file.path)) {
        try {
          unlinkSync(file.path);
        } catch {
          this.logger.warn(`Falha ao limpar arquivo temporário: ${file.path}`);
        }
      }
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao enviar documento da rescisão:', error);
      throw new InternalServerErrorException(
        'Erro ao enviar documento da rescisão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Documents — PUT /terminations/documents/:documentId
  // =====================

  async updateDocument(
    documentId: string,
    data: TerminationDocumentUpdateFormData,
    userId?: string,
  ): Promise<TerminationDocumentUpdateResponse> {
    try {
      const document = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.terminationDocument.findUnique({ where: { id: documentId } });
        if (!existing) {
          throw new NotFoundException('Documento da rescisão não encontrado.');
        }

        const updated = await tx.terminationDocument.update({
          where: { id: documentId },
          data: {
            ...(data.status !== undefined ? { status: data.status as any } : {}),
            ...(data.note !== undefined ? { note: data.note } : {}),
          },
          include: { file: true },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TERMINATION,
          entityId: existing.terminationId,
          action: CHANGE_ACTION.UPDATE,
          field: `document_${existing.type}`,
          oldValue: { status: existing.status, note: existing.note },
          newValue: { status: updated.status, note: updated.note },
          reason: `Documento de rescisão atualizado: ${existing.type}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: existing.terminationId,
          userId: userId || null,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Documento da rescisão atualizado com sucesso.',
        data: document as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao atualizar documento da rescisão:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar documento da rescisão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Custom items (INSS/IRRF and other user-entered earnings/discounts)
  // =====================

  async addItem(
    id: string,
    data: TerminationItemCreateFormData,
    userId?: string,
  ): Promise<TerminationItemCreateResponse> {
    try {
      const item = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const termination = await tx.termination.findUnique({ where: { id } });
        if (!termination) {
          throw new NotFoundException('Rescisão não encontrada.');
        }
        if (
          termination.status === TERMINATION_STATUS.COMPLETED ||
          termination.status === TERMINATION_STATUS.CANCELLED
        ) {
          throw new BadRequestException(
            `Não é possível adicionar verbas a uma rescisão ${STATUS_LABELS_PT[termination.status].toLowerCase()}.`,
          );
        }

        const item = await tx.terminationItem.create({
          data: {
            terminationId: id,
            type: data.type as any,
            description: data.description ?? null,
            referenceQuantity: data.referenceQuantity ?? null,
            baseValue: data.baseValue ?? null,
            amount: data.amount,
            isCustom: true,
          },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TERMINATION,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'items',
          oldValue: null,
          newValue: { type: data.type, amount: data.amount, isCustom: true },
          reason: `Verba rescisória personalizada adicionada: ${data.type}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return item;
      });

      return {
        success: true,
        message: 'Verba rescisória adicionada com sucesso.',
        data: item as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao adicionar verba rescisória:', error);
      throw new InternalServerErrorException(
        'Erro ao adicionar verba rescisória. Por favor, tente novamente.',
      );
    }
  }

  async updateItem(
    itemId: string,
    data: TerminationItemUpdateFormData,
    userId?: string,
  ): Promise<TerminationItemUpdateResponse> {
    try {
      const item = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.terminationItem.findUnique({
          where: { id: itemId },
          include: { termination: { select: { id: true, status: true } } },
        });
        if (!existing) {
          throw new NotFoundException('Verba rescisória não encontrada.');
        }
        const terminationStatus = (existing as any).termination?.status;
        if (
          terminationStatus === TERMINATION_STATUS.COMPLETED ||
          terminationStatus === TERMINATION_STATUS.CANCELLED
        ) {
          throw new BadRequestException(
            `Não é possível editar verbas de uma rescisão ${STATUS_LABELS_PT[terminationStatus].toLowerCase()}.`,
          );
        }
        if (!existing.isCustom) {
          throw new BadRequestException(
            'Apenas verbas personalizadas podem ser editadas. As verbas calculadas são substituídas pelo recálculo.',
          );
        }

        const updated = await tx.terminationItem.update({
          where: { id: itemId },
          data: {
            ...(data.type !== undefined ? { type: data.type as any } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.referenceQuantity !== undefined
              ? { referenceQuantity: data.referenceQuantity }
              : {}),
            ...(data.baseValue !== undefined ? { baseValue: data.baseValue } : {}),
            ...(data.amount !== undefined ? { amount: data.amount } : {}),
          },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TERMINATION,
          entityId: existing.terminationId,
          action: CHANGE_ACTION.UPDATE,
          field: 'items',
          oldValue: { type: existing.type, amount: existing.amount },
          newValue: { type: updated.type, amount: updated.amount },
          reason: `Verba rescisória personalizada atualizada: ${updated.type}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: existing.terminationId,
          userId: userId || null,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Verba rescisória atualizada com sucesso.',
        data: item as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao atualizar verba rescisória:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar verba rescisória. Por favor, tente novamente.',
      );
    }
  }

  async deleteItem(itemId: string, userId?: string): Promise<TerminationItemDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.terminationItem.findUnique({
          where: { id: itemId },
          include: { termination: { select: { id: true, status: true } } },
        });
        if (!existing) {
          throw new NotFoundException('Verba rescisória não encontrada.');
        }
        const terminationStatus = (existing as any).termination?.status;
        if (
          terminationStatus === TERMINATION_STATUS.COMPLETED ||
          terminationStatus === TERMINATION_STATUS.CANCELLED
        ) {
          throw new BadRequestException(
            `Não é possível excluir verbas de uma rescisão ${STATUS_LABELS_PT[terminationStatus].toLowerCase()}.`,
          );
        }
        if (!existing.isCustom) {
          throw new BadRequestException(
            'Apenas verbas personalizadas podem ser excluídas. As verbas calculadas são substituídas pelo recálculo.',
          );
        }

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TERMINATION,
          entityId: existing.terminationId,
          action: CHANGE_ACTION.UPDATE,
          field: 'items',
          oldValue: { type: existing.type, amount: existing.amount },
          newValue: null,
          reason: `Verba rescisória personalizada excluída: ${existing.type}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: existing.terminationId,
          userId: userId || null,
          transaction: tx,
        });

        await tx.terminationItem.delete({ where: { id: itemId } });
      });

      return { success: true, message: 'Verba rescisória excluída com sucesso.' };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao excluir verba rescisória:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir verba rescisória. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Batch operations
  // =====================

  async batchCreate(
    data: TerminationBatchCreateFormData,
    include?: TerminationInclude,
    userId?: string,
  ): Promise<TerminationBatchCreateResponse<TerminationCreateFormData>> {
    const success: any[] = [];
    const failed: any[] = [];

    for (const [index, terminationData] of data.terminations.entries()) {
      try {
        const termination = await this.prisma.$transaction(async (tx: PrismaTransaction) =>
          this.createWithTransaction(tx, terminationData, userId, include),
        );
        success.push(termination);
      } catch (error: any) {
        failed.push({
          index,
          error: error.message || 'Erro ao criar rescisão',
          data: terminationData,
        });
      }
    }

    const successMessage =
      success.length === 1
        ? '1 rescisão criada com sucesso'
        : `${success.length} rescisões criadas com sucesso`;
    const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

    return {
      success: true,
      message: `${successMessage}${failureMessage}`,
      data: {
        success,
        failed,
        totalProcessed: success.length + failed.length,
        totalSuccess: success.length,
        totalFailed: failed.length,
      },
    };
  }

  async batchUpdate(
    data: TerminationBatchUpdateFormData,
    include?: TerminationInclude,
    userId?: string,
  ): Promise<TerminationBatchUpdateResponse<TerminationUpdateFormData>> {
    const success: any[] = [];
    const failed: any[] = [];

    for (const [index, update] of data.terminations.entries()) {
      try {
        const result = await this.update(update.id, update.data, include, userId);
        if (result.data) success.push(result.data);
      } catch (error: any) {
        failed.push({
          index,
          id: update.id,
          error: error.message || 'Erro ao atualizar rescisão',
          data: { ...update.data, id: update.id },
        });
      }
    }

    const successMessage =
      success.length === 1
        ? '1 rescisão atualizada com sucesso'
        : `${success.length} rescisões atualizadas com sucesso`;
    const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

    return {
      success: true,
      message: `${successMessage}${failureMessage}`,
      data: {
        success,
        failed,
        totalProcessed: success.length + failed.length,
        totalSuccess: success.length,
        totalFailed: failed.length,
      },
    };
  }

  async batchDelete(
    data: TerminationBatchDeleteFormData,
    userId?: string,
  ): Promise<TerminationBatchDeleteResponse> {
    const success: { id: string; deleted: boolean }[] = [];
    const failed: any[] = [];

    for (const [index, id] of data.terminationIds.entries()) {
      try {
        await this.delete(id, userId);
        success.push({ id, deleted: true });
      } catch (error: any) {
        failed.push({
          index,
          id,
          error: error.message || 'Erro ao excluir rescisão',
          data: { id },
        });
      }
    }

    const successMessage =
      success.length === 1
        ? '1 rescisão excluída com sucesso'
        : `${success.length} rescisões excluídas com sucesso`;
    const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

    return {
      success: true,
      message: `${successMessage}${failureMessage}`,
      data: {
        success,
        failed,
        totalProcessed: success.length + failed.length,
        totalSuccess: success.length,
        totalFailed: failed.length,
      },
    };
  }
}
