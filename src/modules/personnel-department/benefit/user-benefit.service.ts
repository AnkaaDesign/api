// user-benefit.service.ts
// Adesões de benefícios (Departamento Pessoal) — vínculo colaborador ↔ benefício
// com máquina de status ACTIVE ↔ SUSPENDED → TERMINATED (OPTED_OUT para renúncias de VT).

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { existsSync, unlinkSync } from 'fs';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FileService } from '@modules/common/file/file.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  ENTITY_TYPE,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  BENEFIT_KIND,
  BENEFIT_ENROLLMENT_STATUS,
  BENEFIT_ENROLLMENT_STATUS_ORDER,
} from '../../../constants';
import type {
  UserBenefit,
  UserBenefitGetManyResponse,
  UserBenefitGetUniqueResponse,
  UserBenefitCreateResponse,
  UserBenefitUpdateResponse,
  UserBenefitDeleteResponse,
  UserBenefitBatchCreateResponse,
  UserBenefitBatchUpdateResponse,
  UserBenefitBatchDeleteResponse,
} from '../../../types';
import type {
  UserBenefitGetManyFormData,
  UserBenefitCreateFormData,
  UserBenefitUpdateFormData,
  UserBenefitBatchCreateFormData,
  UserBenefitBatchUpdateFormData,
  UserBenefitBatchDeleteFormData,
  UserBenefitInclude,
} from '../../../schemas';

const USER_BENEFIT_TRACKED_FIELDS = [
  'userId',
  'benefitId',
  'status',
  'startDate',
  'endDate',
  'monthlyValue',
  'employeeDiscountValue',
  'employeeDiscountPercent',
  'dailyTickets',
  'totalInstallments',
  'currentInstallment',
  'declarationFileId',
  'notes',
];

// Discount-percent legal caps per benefit kind:
// VT: max 6% of salary (Lei 7.418/85); VR/VA: max 20% of cost (PAT).
const DISCOUNT_PERCENT_CAPS: Partial<Record<string, { cap: number; message: string }>> = {
  [BENEFIT_KIND.TRANSPORT_VOUCHER]: {
    cap: 6,
    message: 'O desconto do Vale Transporte não pode exceder 6% do salário do colaborador.',
  },
  [BENEFIT_KIND.MEAL_VOUCHER]: {
    cap: 20,
    message: 'O desconto do Vale Refeição não pode exceder 20% do custo do benefício.',
  },
  [BENEFIT_KIND.FOOD_VOUCHER]: {
    cap: 20,
    message: 'O desconto do Vale Alimentação não pode exceder 20% do custo do benefício.',
  },
};

// Allowed status transitions: ACTIVE ↔ SUSPENDED → TERMINATED; OPTED_OUT is
// settable on create/update (VT waivers) and can be re-activated; TERMINATED is terminal.
const STATUS_TRANSITIONS: Record<string, string[]> = {
  [BENEFIT_ENROLLMENT_STATUS.ACTIVE]: [
    BENEFIT_ENROLLMENT_STATUS.SUSPENDED,
    BENEFIT_ENROLLMENT_STATUS.OPTED_OUT,
    BENEFIT_ENROLLMENT_STATUS.TERMINATED,
  ],
  [BENEFIT_ENROLLMENT_STATUS.SUSPENDED]: [
    BENEFIT_ENROLLMENT_STATUS.ACTIVE,
    BENEFIT_ENROLLMENT_STATUS.OPTED_OUT,
    BENEFIT_ENROLLMENT_STATUS.TERMINATED,
  ],
  [BENEFIT_ENROLLMENT_STATUS.OPTED_OUT]: [
    BENEFIT_ENROLLMENT_STATUS.ACTIVE,
    BENEFIT_ENROLLMENT_STATUS.TERMINATED,
  ],
  [BENEFIT_ENROLLMENT_STATUS.TERMINATED]: [],
};

@Injectable()
export class UserBenefitService {
  private readonly logger = new Logger(UserBenefitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
  ) {}

  private getStatusOrder(status: string): number {
    return BENEFIT_ENROLLMENT_STATUS_ORDER[status] ?? 1;
  }

  private validateStatusTransition(fromStatus: string, toStatus: string): void {
    if (fromStatus === toStatus) return;
    const allowed = STATUS_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(`Transição de status inválida: ${fromStatus} → ${toStatus}.`);
    }
  }

  /**
   * Validações de adesão: colaborador/benefício existem, tetos legais de
   * desconto por tipo, desconto fixo ≤ valor mensal, uma adesão ACTIVE por
   * (colaborador, benefício).
   */
  private async userBenefitValidation(
    data: Partial<UserBenefitCreateFormData | UserBenefitUpdateFormData>,
    existing?: {
      id: string;
      userId: string;
      benefitId: string;
      status: string;
      monthlyValue: number;
      employeeDiscountValue: number | null;
      employeeDiscountPercent: number | null;
    } | null,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    const userId = data.userId ?? existing?.userId;
    const benefitId = data.benefitId ?? existing?.benefitId;

    if (!userId || !benefitId) {
      throw new BadRequestException('Colaborador e benefício são obrigatórios.');
    }

    if (data.userId) {
      const user = await transaction.user.findUnique({ where: { id: data.userId } });
      if (!user) {
        throw new NotFoundException('Colaborador não encontrado.');
      }
    }

    const benefit = await transaction.benefit.findUnique({ where: { id: benefitId } });
    if (!benefit) {
      throw new NotFoundException('Benefício não encontrado.');
    }

    // Merge effective values (update may only carry partial data)
    const monthlyValue =
      data.monthlyValue !== undefined ? data.monthlyValue : existing?.monthlyValue;
    const discountValue =
      data.employeeDiscountValue !== undefined
        ? data.employeeDiscountValue
        : existing?.employeeDiscountValue;
    const discountPercent =
      data.employeeDiscountPercent !== undefined
        ? data.employeeDiscountPercent
        : existing?.employeeDiscountPercent;

    // Legal caps on percent discount per benefit kind
    const capRule = DISCOUNT_PERCENT_CAPS[benefit.kind as string];
    if (capRule && discountPercent != null && discountPercent > capRule.cap) {
      throw new BadRequestException(capRule.message);
    }

    // Fixed discount can never exceed the employer monthly cost
    if (discountValue != null && monthlyValue != null && discountValue > monthlyValue) {
      throw new BadRequestException(
        'O desconto do colaborador não pode exceder o valor mensal do benefício.',
      );
    }

    // Only one ACTIVE enrollment per (user, benefit) at a time
    const targetStatus = data.status ?? existing?.status ?? BENEFIT_ENROLLMENT_STATUS.ACTIVE;
    if (targetStatus === BENEFIT_ENROLLMENT_STATUS.ACTIVE) {
      const conflict = await transaction.userBenefit.findFirst({
        where: {
          userId,
          benefitId,
          status: BENEFIT_ENROLLMENT_STATUS.ACTIVE,
          ...(existing ? { id: { not: existing.id } } : {}),
        },
      });
      if (conflict) {
        throw new BadRequestException(
          'Já existe uma adesão ativa deste benefício para este colaborador.',
        );
      }
    }
  }

  async findMany(query: UserBenefitGetManyFormData): Promise<UserBenefitGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit && query.limit > 0 ? query.limit : 20;
      const skip = (page - 1) * take;
      const where = query.where || {};
      const orderBy = query.orderBy || [{ statusOrder: 'asc' }, { createdAt: 'desc' }];

      const [totalRecords, userBenefits] = await Promise.all([
        this.prisma.userBenefit.count({ where }),
        this.prisma.userBenefit.findMany({
          where,
          orderBy,
          include: query.include,
          skip,
          take,
        }),
      ]);

      const totalPages = Math.max(Math.ceil(totalRecords / take), 1);

      return {
        success: true,
        message: 'Adesões carregadas com sucesso.',
        data: userBenefits as unknown as UserBenefit[],
        meta: {
          totalRecords,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar adesões:', error);
      throw new InternalServerErrorException('Erro ao buscar adesões. Por favor, tente novamente.');
    }
  }

  async findById(id: string, include?: UserBenefitInclude): Promise<UserBenefitGetUniqueResponse> {
    try {
      const userBenefit = await this.prisma.userBenefit.findUnique({ where: { id }, include });

      if (!userBenefit) {
        throw new NotFoundException('Adesão não encontrada.');
      }

      return {
        success: true,
        message: 'Adesão carregada com sucesso.',
        data: userBenefit as unknown as UserBenefit,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar adesão por ID:', error);
      throw new InternalServerErrorException('Erro ao buscar adesão. Por favor, tente novamente.');
    }
  }

  async create(
    data: UserBenefitCreateFormData,
    include?: UserBenefitInclude,
    userId?: string,
  ): Promise<UserBenefitCreateResponse> {
    try {
      const userBenefit = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.userBenefitValidation(data, undefined, tx);

        const status = data.status || BENEFIT_ENROLLMENT_STATUS.ACTIVE;
        const newUserBenefit = await tx.userBenefit.create({
          data: {
            ...(data as any),
            status,
            statusOrder: this.getStatusOrder(status),
          },
          include,
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.USER_BENEFIT,
          entityId: newUserBenefit.id,
          action: CHANGE_ACTION.CREATE,
          entity: newUserBenefit,
          reason: 'Adesão de benefício criada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newUserBenefit;
      });

      return {
        success: true,
        message: 'Adesão criada com sucesso.',
        data: userBenefit as unknown as UserBenefit,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao criar adesão:', error);
      throw new InternalServerErrorException('Erro ao criar adesão. Por favor, tente novamente.');
    }
  }

  async update(
    id: string,
    data: UserBenefitUpdateFormData,
    include?: UserBenefitInclude,
    userId?: string,
  ): Promise<UserBenefitUpdateResponse> {
    try {
      const userBenefit = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.userBenefit.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('Adesão não encontrada.');
        }

        if (data.status && data.status !== existing.status) {
          this.validateStatusTransition(existing.status, data.status);
        }

        await this.userBenefitValidation(data, existing, tx);

        const updateData: any = { ...data };
        if (data.status) {
          updateData.statusOrder = this.getStatusOrder(data.status);
          // Terminating via plain update also stamps the end date
          if (
            data.status === BENEFIT_ENROLLMENT_STATUS.TERMINATED &&
            data.endDate === undefined &&
            !existing.endDate
          ) {
            updateData.endDate = new Date();
          }
        }

        const updated = await tx.userBenefit.update({ where: { id }, data: updateData, include });

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.USER_BENEFIT,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: USER_BENEFIT_TRACKED_FIELDS,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Adesão atualizada com sucesso.',
        data: userBenefit as unknown as UserBenefit,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar adesão:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar adesão. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Mudança de status dedicada (suspend/reactivate/terminate).
   */
  private async changeStatus(
    id: string,
    toStatus: BENEFIT_ENROLLMENT_STATUS,
    options: {
      endDate?: Date;
      reason: string;
      successMessage: string;
      allowedFrom: string[];
    },
    include?: UserBenefitInclude,
    userId?: string,
  ): Promise<UserBenefitUpdateResponse> {
    try {
      const userBenefit = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.userBenefit.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('Adesão não encontrada.');
        }

        if (!options.allowedFrom.includes(existing.status)) {
          throw new BadRequestException(
            `Transição de status inválida: ${existing.status} → ${toStatus}.`,
          );
        }

        // Reactivation must respect the one-ACTIVE-per-pair rule
        if (toStatus === BENEFIT_ENROLLMENT_STATUS.ACTIVE) {
          await this.userBenefitValidation(
            { status: BENEFIT_ENROLLMENT_STATUS.ACTIVE },
            existing,
            tx,
          );
        }

        const updated = await tx.userBenefit.update({
          where: { id },
          data: {
            status: toStatus,
            statusOrder: this.getStatusOrder(toStatus),
            ...(options.endDate !== undefined ? { endDate: options.endDate } : {}),
          },
          include,
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.USER_BENEFIT,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: existing.status,
          newValue: toStatus,
          reason: options.reason,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: options.successMessage,
        data: userBenefit as unknown as UserBenefit,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao alterar status da adesão:', error);
      throw new InternalServerErrorException(
        'Erro ao alterar status da adesão. Por favor, tente novamente.',
      );
    }
  }

  async suspend(
    id: string,
    include?: UserBenefitInclude,
    userId?: string,
  ): Promise<UserBenefitUpdateResponse> {
    return this.changeStatus(
      id,
      BENEFIT_ENROLLMENT_STATUS.SUSPENDED,
      {
        reason: 'Adesão suspensa',
        successMessage: 'Adesão suspensa com sucesso.',
        allowedFrom: [BENEFIT_ENROLLMENT_STATUS.ACTIVE],
      },
      include,
      userId,
    );
  }

  async reactivate(
    id: string,
    include?: UserBenefitInclude,
    userId?: string,
  ): Promise<UserBenefitUpdateResponse> {
    return this.changeStatus(
      id,
      BENEFIT_ENROLLMENT_STATUS.ACTIVE,
      {
        reason: 'Adesão reativada',
        successMessage: 'Adesão reativada com sucesso.',
        allowedFrom: [BENEFIT_ENROLLMENT_STATUS.SUSPENDED, BENEFIT_ENROLLMENT_STATUS.OPTED_OUT],
      },
      include,
      userId,
    );
  }

  async terminate(
    id: string,
    endDate: Date,
    include?: UserBenefitInclude,
    userId?: string,
  ): Promise<UserBenefitUpdateResponse> {
    return this.changeStatus(
      id,
      BENEFIT_ENROLLMENT_STATUS.TERMINATED,
      {
        endDate,
        reason: 'Adesão encerrada',
        successMessage: 'Adesão encerrada com sucesso.',
        allowedFrom: [
          BENEFIT_ENROLLMENT_STATUS.ACTIVE,
          BENEFIT_ENROLLMENT_STATUS.SUSPENDED,
          BENEFIT_ENROLLMENT_STATUS.OPTED_OUT,
        ],
      },
      include,
      userId,
    );
  }

  /**
   * Avança a parcela corrente de um convênio parcelado (semântica de desconto
   * persistente, espelhando LOAN/ADVANCE). Quando a parcela avançada excede
   * `totalInstallments`, a adesão é encerrada (TERMINATED) — a última parcela
   * já foi descontada na folha anterior. Idempotência mensal fica a cargo do
   * chamador (a folha mensal — Part B — invoca uma vez por competência).
   *
   * No-op (returns the row unchanged) quando a adesão não é parcelada
   * (`totalInstallments` nulo) ou já está encerrada.
   */
  async advanceInstallment(
    id: string,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<UserBenefit> {
    const run = async (transaction: PrismaTransaction): Promise<UserBenefit> => {
      const existing = await transaction.userBenefit.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Adesão não encontrada.');
      }

      // Not an installment plan, or already terminated → nothing to advance.
      if (existing.totalInstallments == null) {
        return existing as unknown as UserBenefit;
      }
      if (existing.status === BENEFIT_ENROLLMENT_STATUS.TERMINATED) {
        return existing as unknown as UserBenefit;
      }

      const current = existing.currentInstallment ?? 1;
      const next = current + 1;

      // Reached the end: the final installment was charged this period; close it.
      if (next > existing.totalInstallments) {
        const updated = await transaction.userBenefit.update({
          where: { id },
          data: {
            status: BENEFIT_ENROLLMENT_STATUS.TERMINATED,
            statusOrder: this.getStatusOrder(BENEFIT_ENROLLMENT_STATUS.TERMINATED),
            currentInstallment: existing.totalInstallments,
            ...(existing.endDate ? {} : { endDate: new Date() }),
          },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.USER_BENEFIT,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: existing.status,
          newValue: BENEFIT_ENROLLMENT_STATUS.TERMINATED,
          reason: 'Convênio parcelado quitado (última parcela atingida)',
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          triggeredById: id,
          userId: userId || null,
          transaction,
        });

        return updated as unknown as UserBenefit;
      }

      const updated = await transaction.userBenefit.update({
        where: { id },
        data: { currentInstallment: next },
      });

      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.USER_BENEFIT,
        entityId: id,
        action: CHANGE_ACTION.UPDATE,
        field: 'currentInstallment',
        oldValue: current,
        newValue: next,
        reason: 'Parcela de convênio avançada',
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
        triggeredById: id,
        userId: userId || null,
        transaction,
      });

      return updated as unknown as UserBenefit;
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }

  /**
   * Avança todas as parcelas em aberto (status não-TERMINATED, parceladas) de
   * todos os colaboradores — uma vez por competência. Consumido pela folha
   * mensal (Part B) após o fechamento. Retorna a contagem de avanços e de
   * convênios quitados.
   */
  async advanceInstallmentsForMonth(
    userId?: string,
  ): Promise<{ advanced: number; settled: number }> {
    const pending = await this.prisma.userBenefit.findMany({
      where: {
        totalInstallments: { not: null },
        status: { not: BENEFIT_ENROLLMENT_STATUS.TERMINATED },
      },
      select: { id: true },
    });

    let advanced = 0;
    let settled = 0;

    for (const { id } of pending) {
      try {
        const before = await this.prisma.userBenefit.findUnique({
          where: { id },
          select: { status: true },
        });
        const result = await this.advanceInstallment(id, userId);
        if (
          result.status === BENEFIT_ENROLLMENT_STATUS.TERMINATED &&
          before?.status !== BENEFIT_ENROLLMENT_STATUS.TERMINATED
        ) {
          settled += 1;
        } else {
          advanced += 1;
        }
      } catch (error: any) {
        this.logger.warn(`Falha ao avançar parcela da adesão ${id}: ${error?.message}`);
      }
    }

    return { advanced, settled };
  }

  /**
   * Upload da declaração assinada (renúncia de VT / autorização de desconto
   * de convênio, CLT art. 462) — define declarationFileId.
   */
  async uploadDeclaration(
    id: string,
    file: Express.Multer.File,
    include?: UserBenefitInclude,
    userId?: string,
  ): Promise<UserBenefitUpdateResponse> {
    try {
      const userBenefit = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.userBenefit.findUnique({
          where: { id },
          include: { user: { select: { name: true } } },
        });

        if (!existing) {
          throw new NotFoundException('Adesão não encontrada.');
        }

        const newFile = await this.fileService.createFromUploadWithTransaction(
          tx,
          file,
          'documents',
          userId,
          {
            entityId: id,
            entityType: 'USER_BENEFIT',
            userName: existing.user?.name || undefined,
          },
        );

        const updated = await tx.userBenefit.update({
          where: { id },
          data: { declarationFileId: newFile.id },
          include,
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.USER_BENEFIT,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'declarationFileId',
          oldValue: existing.declarationFileId,
          newValue: newFile.id,
          reason: 'Declaração anexada à adesão',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Declaração anexada com sucesso.',
        data: userBenefit as unknown as UserBenefit,
      };
    } catch (error: any) {
      // Clean up temp upload on error
      if (file && existsSync(file.path)) {
        try {
          unlinkSync(file.path);
        } catch {
          this.logger.warn(`Falha ao limpar arquivo temporário: ${file.path}`);
        }
      }

      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao anexar declaração:', error);
      throw new InternalServerErrorException(
        'Erro ao anexar declaração. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId?: string): Promise<UserBenefitDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const userBenefit = await tx.userBenefit.findUnique({ where: { id } });

        if (!userBenefit) {
          throw new NotFoundException('Adesão não encontrada.');
        }

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.USER_BENEFIT,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: userBenefit,
          reason: 'Adesão excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.userBenefit.delete({ where: { id } });
      });

      return {
        success: true,
        message: 'Adesão excluída com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao excluir adesão:', error);
      throw new InternalServerErrorException('Erro ao excluir adesão. Por favor, tente novamente.');
    }
  }

  async batchCreate(
    data: UserBenefitBatchCreateFormData,
    include?: UserBenefitInclude,
    userId?: string,
  ): Promise<UserBenefitBatchCreateResponse<UserBenefitCreateFormData>> {
    try {
      const success: UserBenefit[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: UserBenefitCreateFormData;
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, itemData] of data.userBenefits.entries()) {
          try {
            await this.userBenefitValidation(itemData, undefined, tx);

            const status = itemData.status || BENEFIT_ENROLLMENT_STATUS.ACTIVE;
            const created = await tx.userBenefit.create({
              data: {
                ...(itemData as any),
                status,
                statusOrder: this.getStatusOrder(status),
              },
              include,
            });

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.USER_BENEFIT,
              entityId: created.id,
              action: CHANGE_ACTION.CREATE,
              entity: created,
              reason: 'Adesão criada em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || null,
              transaction: tx,
            });

            success.push(created as unknown as UserBenefit);
          } catch (error: any) {
            failed.push({
              index,
              error: error?.message || 'Erro ao criar adesão.',
              data: itemData,
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 adesão criada com sucesso'
          : `${success.length} adesões criadas com sucesso`;
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
    } catch (error: any) {
      this.logger.error('Erro na criação de adesões em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar adesões em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchUpdate(
    data: UserBenefitBatchUpdateFormData,
    include?: UserBenefitInclude,
    userId?: string,
  ): Promise<UserBenefitBatchUpdateResponse<UserBenefitUpdateFormData>> {
    try {
      const success: UserBenefit[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: UserBenefitUpdateFormData & { id: string };
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, update] of data.userBenefits.entries()) {
          try {
            const existing = await tx.userBenefit.findUnique({ where: { id: update.id } });
            if (!existing) {
              throw new NotFoundException('Adesão não encontrada.');
            }

            if (update.data.status && update.data.status !== existing.status) {
              this.validateStatusTransition(existing.status, update.data.status);
            }

            await this.userBenefitValidation(update.data, existing, tx);

            const updateData: any = { ...update.data };
            if (update.data.status) {
              updateData.statusOrder = this.getStatusOrder(update.data.status);
            }

            const updated = await tx.userBenefit.update({
              where: { id: update.id },
              data: updateData,
              include,
            });

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.USER_BENEFIT,
              entityId: update.id,
              oldEntity: existing,
              newEntity: updated,
              fieldsToTrack: USER_BENEFIT_TRACKED_FIELDS,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            success.push(updated as unknown as UserBenefit);
          } catch (error: any) {
            failed.push({
              index,
              id: update.id,
              error: error?.message || 'Erro ao atualizar adesão.',
              data: { ...update.data, id: update.id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 adesão atualizada com sucesso'
          : `${success.length} adesões atualizadas com sucesso`;
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
    } catch (error: any) {
      this.logger.error('Erro na atualização de adesões em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar adesões em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: UserBenefitBatchDeleteFormData,
    userId?: string,
  ): Promise<UserBenefitBatchDeleteResponse> {
    try {
      const success: Array<{ id: string; deleted: boolean }> = [];
      const failed: Array<{ index: number; id?: string; error: string; data: { id: string } }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, id] of data.userBenefitIds.entries()) {
          try {
            const userBenefit = await tx.userBenefit.findUnique({ where: { id } });

            if (!userBenefit) {
              throw new NotFoundException('Adesão não encontrada.');
            }

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.USER_BENEFIT,
              entityId: id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: userBenefit,
              reason: 'Adesão excluída em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              userId: userId || null,
              transaction: tx,
            });

            await tx.userBenefit.delete({ where: { id } });
            success.push({ id, deleted: true });
          } catch (error: any) {
            failed.push({
              index,
              id,
              error: error?.message || 'Erro ao excluir adesão.',
              data: { id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 adesão excluída com sucesso'
          : `${success.length} adesões excluídas com sucesso`;
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
    } catch (error: any) {
      this.logger.error('Erro na exclusão de adesões em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir adesões em lote. Por favor, tente novamente.',
      );
    }
  }
}
