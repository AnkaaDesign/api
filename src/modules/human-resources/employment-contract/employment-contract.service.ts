// employment-contract.service.ts
// Vínculos empregatícios (EmploymentContract) — fonte da verdade do relacionamento
// de trabalho. Mantém o cache do colaborador (User.currentContract*) sincronizado.

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  logEntityChange,
  trackAndLogFieldChanges,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  CONTRACT_STATUS,
  CONTRACT_TYPE,
  EMPLOYEE_TYPE,
  ENTITY_TYPE,
} from '../../../constants';
import { CONTRACT_STATUS_ORDER, CONTRACT_TYPE_ORDER } from '../../../constants/sortOrders';
import type {
  EmploymentContractBatchCreateResponse,
  EmploymentContractBatchDeleteResponse,
  EmploymentContractBatchUpdateResponse,
  EmploymentContractCreateResponse,
  EmploymentContractDeleteResponse,
  EmploymentContractGetManyResponse,
  EmploymentContractGetUniqueResponse,
  EmploymentContractUpdateResponse,
} from '../../../types';
import type {
  EmploymentContractBatchCreateFormData,
  EmploymentContractBatchDeleteFormData,
  EmploymentContractBatchUpdateFormData,
  EmploymentContractCreateFormData,
  EmploymentContractGetManyFormData,
  EmploymentContractInclude,
  EmploymentContractUpdateFormData,
} from '../../../schemas';

const DEFAULT_INCLUDE = { user: true, position: true, sector: true } as const;

@Injectable()
export class EmploymentContractService {
  private readonly logger = new Logger(EmploymentContractService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  // =====================
  // Sync invariant (write path)
  // =====================

  /**
   * Recalcula qual vínculo do colaborador é o atual (isCurrent) e atualiza o cache
   * no User: currentContractId/currentContractType/currentContractStatus/
   * currentEmployeeType + espelha positionId/sectorId/payrollNumber e define
   * isActive (false sse o status atual for DISMISSED). Sempre executado dentro da
   * transação que alterou o(s) vínculo(s) do colaborador.
   */
  async syncUserCurrentContract(
    tx: PrismaTransaction,
    userId: string,
    options?: { userId?: string },
  ): Promise<void> {
    // O vínculo atual é o de MAIOR sequence (o mais recente). Garante exatamente
    // um isCurrent=true por colaborador.
    const contracts = await tx.employmentContract.findMany({
      where: { userId },
      orderBy: { sequence: 'desc' },
    });

    const current = contracts[0] ?? null;

    // Garante o flag isCurrent coerente em todos os vínculos.
    for (const contract of contracts) {
      const shouldBeCurrent = current ? contract.id === current.id : false;
      if (contract.isCurrent !== shouldBeCurrent) {
        await tx.employmentContract.update({
          where: { id: contract.id },
          data: { isCurrent: shouldBeCurrent },
        });
      }
    }

    if (!current) {
      // Sem vínculos: limpa o cache.
      await tx.user.update({
        where: { id: userId },
        data: {
          currentContractId: null,
          currentContractType: null,
          currentContractStatus: null,
          currentEmployeeType: null,
        },
      });
      return;
    }

    const isDismissed = current.status === CONTRACT_STATUS.DISMISSED;

    await tx.user.update({
      where: { id: userId },
      data: {
        currentContractId: current.id,
        currentContractType: current.contractType,
        currentContractStatus: current.status,
        currentEmployeeType: current.employeeType,
        // Espelha os ponteiros do vínculo atual no colaborador.
        positionId: current.positionId,
        sectorId: current.sectorId,
        payrollNumber: current.payrollNumber,
        isActive: !isDismissed,
      },
    });
  }

  /**
   * Cria um NOVO vínculo para um colaborador EXISTENTE (recontratação / nova
   * relação): sequence = max(sequence)+1, derruba o isCurrent anterior e
   * sincroniza o cache do User. Executado dentro de uma transação.
   */
  async createContractForUserWithTransaction(
    tx: PrismaTransaction,
    userId: string,
    data: Omit<EmploymentContractCreateFormData, 'userId'>,
    options?: { userId?: string; changelogReason?: string; include?: EmploymentContractInclude },
  ): Promise<any> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, positionId: true, sectorId: true, payrollNumber: true },
    });
    if (!user) {
      throw new NotFoundException('Colaborador não encontrado.');
    }

    const maxSequence = await tx.employmentContract.aggregate({
      where: { userId },
      _max: { sequence: true },
    });
    const sequence = (maxSequence._max.sequence ?? 0) + 1;

    // Derruba o vínculo atual anterior.
    await tx.employmentContract.updateMany({
      where: { userId, isCurrent: true },
      data: { isCurrent: false },
    });

    const employeeType = (data.employeeType as EMPLOYEE_TYPE) ?? EMPLOYEE_TYPE.CLT;
    const contractType =
      data.contractType === undefined
        ? employeeType === EMPLOYEE_TYPE.CLT
          ? CONTRACT_TYPE.EXPERIENCE_PERIOD_1
          : null
        : (data.contractType as CONTRACT_TYPE | null);

    const dates = this.computeContractDates({
      contractType,
      admissionDate: data.admissionDate ?? null,
      exp1StartAt: data.exp1StartAt ?? null,
      exp1EndAt: data.exp1EndAt ?? null,
      exp2StartAt: data.exp2StartAt ?? null,
      exp2EndAt: data.exp2EndAt ?? null,
      effectedAt: data.effectedAt ?? null,
    });

    const created = await tx.employmentContract.create({
      data: {
        userId,
        sequence,
        isCurrent: true,
        employeeType: employeeType as any,
        contractType: (contractType as any) ?? null,
        status: CONTRACT_STATUS.ACTIVE as any,
        statusOrder: CONTRACT_STATUS_ORDER[CONTRACT_STATUS.ACTIVE],
        matricula: data.matricula ?? null,
        payrollNumber: data.payrollNumber ?? null,
        positionId: data.positionId ?? user.positionId ?? null,
        sectorId: data.sectorId ?? user.sectorId ?? null,
        ...dates,
        providerName: data.providerName ?? null,
        providerCnpj: data.providerCnpj ?? null,
        notes: data.notes ?? null,
      },
      include: options?.include ?? DEFAULT_INCLUDE,
    });

    await logEntityChange({
      changeLogService: this.changeLogService,
      entityType: ENTITY_TYPE.USER,
      entityId: userId,
      action: CHANGE_ACTION.CREATE,
      entity: created,
      reason: options?.changelogReason ?? `Novo vínculo (sequência ${sequence}) criado para ${user.name}`,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      userId: options?.userId || null,
      transaction: tx,
    });

    await this.syncUserCurrentContract(tx, userId, { userId: options?.userId });

    return created;
  }

  /**
   * Auto-cálculo das datas de experiência (CLT): 1º período = 30 dias,
   * 2º período = 50 dias. Aplica-se apenas a vínculos em fase de experiência;
   * EFETIVADO grava effectedAt. Retorna apenas os campos a serem persistidos.
   */
  computeContractDates(input: {
    contractType: CONTRACT_TYPE | null;
    admissionDate: Date | null;
    exp1StartAt: Date | null;
    exp1EndAt: Date | null;
    exp2StartAt: Date | null;
    exp2EndAt: Date | null;
    effectedAt: Date | null;
  }): {
    admissionDate: Date | null;
    exp1StartAt: Date | null;
    exp1EndAt: Date | null;
    exp2StartAt: Date | null;
    exp2EndAt: Date | null;
    effectedAt: Date | null;
  } {
    const now = new Date();
    let { admissionDate, exp1StartAt, exp1EndAt, exp2StartAt, exp2EndAt, effectedAt } = input;

    if (
      input.contractType === CONTRACT_TYPE.EXPERIENCE_PERIOD_1 ||
      input.contractType === CONTRACT_TYPE.EXPERIENCE_PERIOD_2
    ) {
      const start = exp1StartAt || admissionDate || now;
      exp1StartAt = exp1StartAt || start;
      admissionDate = admissionDate || start;

      if (!exp1EndAt) {
        const e = new Date(start);
        e.setDate(e.getDate() + 30);
        exp1EndAt = e;
      }
      if (!exp2StartAt) {
        const s = new Date(start);
        s.setDate(s.getDate() + 31);
        exp2StartAt = s;
      }
      if (!exp2EndAt) {
        const e = new Date(start);
        e.setDate(e.getDate() + 80); // 30 (exp1) + 50 (exp2)
        exp2EndAt = e;
      }
    } else if (input.contractType === CONTRACT_TYPE.EFFECTED) {
      effectedAt = effectedAt || admissionDate || now;
      admissionDate = admissionDate || effectedAt;
    } else {
      admissionDate = admissionDate || now;
    }

    return { admissionDate, exp1StartAt, exp1EndAt, exp2StartAt, exp2EndAt, effectedAt };
  }

  // =====================
  // Queries
  // =====================

  async findMany(
    query: EmploymentContractGetManyFormData,
  ): Promise<EmploymentContractGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit || 20;
      const skip = (page - 1) * take;

      const [total, employmentContracts] = await Promise.all([
        this.prisma.employmentContract.count({ where: query.where }),
        this.prisma.employmentContract.findMany({
          where: query.where,
          orderBy: query.orderBy || [{ userId: 'asc' }, { sequence: 'asc' }],
          include: query.include,
          skip,
          take,
        }),
      ]);

      const totalPages = Math.ceil(total / take) || 0;

      return {
        success: true,
        message: 'Vínculos carregados com sucesso.',
        data: employmentContracts as any[],
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
      this.logger.error('Erro ao buscar vínculos:', error);
      throw new InternalServerErrorException('Erro ao buscar vínculos. Por favor, tente novamente.');
    }
  }

  async findById(
    id: string,
    include?: EmploymentContractInclude,
  ): Promise<EmploymentContractGetUniqueResponse> {
    try {
      const employmentContract = await this.prisma.employmentContract.findUnique({
        where: { id },
        include: include ?? DEFAULT_INCLUDE,
      });

      if (!employmentContract) {
        throw new NotFoundException('Vínculo não encontrado.');
      }

      return {
        success: true,
        message: 'Vínculo carregado com sucesso.',
        data: employmentContract as any,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao buscar vínculo por ID:', error);
      throw new InternalServerErrorException('Erro ao buscar vínculo. Por favor, tente novamente.');
    }
  }

  // =====================
  // Create
  // =====================

  async create(
    data: EmploymentContractCreateFormData,
    include?: EmploymentContractInclude,
    userId?: string,
  ): Promise<EmploymentContractCreateResponse> {
    try {
      const { userId: ownerId, ...rest } = data;
      const created = await this.prisma.$transaction(async (tx: PrismaTransaction) =>
        this.createContractForUserWithTransaction(tx, ownerId, rest, { userId, include }),
      );

      return {
        success: true,
        message: 'Vínculo criado com sucesso.',
        data: created,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao criar vínculo:', error);
      throw new InternalServerErrorException('Erro ao criar vínculo. Por favor, tente novamente.');
    }
  }

  // =====================
  // Update
  // =====================

  async updateWithTransaction(
    tx: PrismaTransaction,
    id: string,
    data: EmploymentContractUpdateFormData,
    include?: EmploymentContractInclude,
    userId?: string,
  ): Promise<any> {
    const existing = await tx.employmentContract.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Vínculo não encontrado.');
    }

    const updateData: any = {};
    if (data.employeeType !== undefined) updateData.employeeType = data.employeeType;
    if (data.contractType !== undefined) updateData.contractType = data.contractType;
    if (data.status !== undefined) {
      updateData.status = data.status;
      updateData.statusOrder = CONTRACT_STATUS_ORDER[data.status as CONTRACT_STATUS];
    }
    if (data.payrollNumber !== undefined) updateData.payrollNumber = data.payrollNumber;
    if (data.matricula !== undefined) updateData.matricula = data.matricula;
    if (data.positionId !== undefined) updateData.positionId = data.positionId;
    if (data.sectorId !== undefined) updateData.sectorId = data.sectorId;
    if (data.admissionDate !== undefined) updateData.admissionDate = data.admissionDate;
    if (data.exp1StartAt !== undefined) updateData.exp1StartAt = data.exp1StartAt;
    if (data.exp1EndAt !== undefined) updateData.exp1EndAt = data.exp1EndAt;
    if (data.exp2StartAt !== undefined) updateData.exp2StartAt = data.exp2StartAt;
    if (data.exp2EndAt !== undefined) updateData.exp2EndAt = data.exp2EndAt;
    if (data.effectedAt !== undefined) updateData.effectedAt = data.effectedAt;
    if (data.terminationDate !== undefined) updateData.terminationDate = data.terminationDate;
    if (data.terminationType !== undefined) updateData.terminationType = data.terminationType;
    if (data.providerName !== undefined) updateData.providerName = data.providerName;
    if (data.providerCnpj !== undefined) updateData.providerCnpj = data.providerCnpj;
    if (data.notes !== undefined) updateData.notes = data.notes;

    // Efetivação: ao mudar o tipo para EFETIVADO sem effectedAt, registra agora.
    if (
      data.contractType === CONTRACT_TYPE.EFFECTED &&
      existing.contractType !== CONTRACT_TYPE.EFFECTED &&
      data.effectedAt === undefined &&
      !existing.effectedAt
    ) {
      updateData.effectedAt = new Date();
    }

    // Demissão: status=DISMISSED sem data → grava agora.
    if (
      data.status === CONTRACT_STATUS.DISMISSED &&
      existing.status !== CONTRACT_STATUS.DISMISSED &&
      data.terminationDate === undefined &&
      !existing.terminationDate
    ) {
      updateData.terminationDate = new Date();
    }

    const updated = await tx.employmentContract.update({
      where: { id },
      data: updateData,
      include: include ?? DEFAULT_INCLUDE,
    });

    await trackAndLogFieldChanges({
      changeLogService: this.changeLogService,
      entityType: ENTITY_TYPE.USER,
      entityId: existing.userId,
      oldEntity: existing,
      newEntity: updated,
      fieldsToTrack: [
        'employeeType',
        'contractType',
        'status',
        'payrollNumber',
        'matricula',
        'positionId',
        'sectorId',
        'admissionDate',
        'effectedAt',
        'terminationDate',
        'terminationType',
        'notes',
      ],
      userId: userId || null,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      transaction: tx,
    });

    // Re-sincroniza o cache se este for (ou puder ter virado) o vínculo atual.
    await this.syncUserCurrentContract(tx, existing.userId, { userId });

    return updated;
  }

  async update(
    id: string,
    data: EmploymentContractUpdateFormData,
    include?: EmploymentContractInclude,
    userId?: string,
  ): Promise<EmploymentContractUpdateResponse> {
    try {
      const updated = await this.prisma.$transaction(async (tx: PrismaTransaction) =>
        this.updateWithTransaction(tx, id, data, include, userId),
      );

      return {
        success: true,
        message: 'Vínculo atualizado com sucesso.',
        data: updated as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao atualizar vínculo:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar vínculo. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Delete
  // =====================

  async delete(id: string, userId?: string): Promise<EmploymentContractDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const contract = await tx.employmentContract.findUnique({ where: { id } });
        if (!contract) {
          throw new NotFoundException('Vínculo não encontrado.');
        }

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.USER,
          entityId: contract.userId,
          action: CHANGE_ACTION.DELETE,
          oldEntity: contract,
          reason: `Vínculo (sequência ${contract.sequence}) excluído`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.employmentContract.delete({ where: { id } });

        // Recalcula o vínculo atual do colaborador.
        await this.syncUserCurrentContract(tx, contract.userId, { userId });
      });

      return { success: true, message: 'Vínculo excluído com sucesso.' };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao excluir vínculo:', error);
      throw new InternalServerErrorException('Erro ao excluir vínculo. Por favor, tente novamente.');
    }
  }

  // =====================
  // Batch operations
  // =====================

  async batchCreate(
    data: EmploymentContractBatchCreateFormData,
    include?: EmploymentContractInclude,
    userId?: string,
  ): Promise<EmploymentContractBatchCreateResponse<EmploymentContractCreateFormData>> {
    const success: any[] = [];
    const failed: any[] = [];

    for (const [index, contractData] of data.employmentContracts.entries()) {
      try {
        const { userId: ownerId, ...rest } = contractData;
        const created = await this.prisma.$transaction(async (tx: PrismaTransaction) =>
          this.createContractForUserWithTransaction(tx, ownerId, rest, { userId, include }),
        );
        success.push(created);
      } catch (error: any) {
        failed.push({
          index,
          error: error.message || 'Erro ao criar vínculo',
          data: contractData,
        });
      }
    }

    const successMessage =
      success.length === 1
        ? '1 vínculo criado com sucesso'
        : `${success.length} vínculos criados com sucesso`;
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
    data: EmploymentContractBatchUpdateFormData,
    include?: EmploymentContractInclude,
    userId?: string,
  ): Promise<EmploymentContractBatchUpdateResponse<EmploymentContractUpdateFormData>> {
    const success: any[] = [];
    const failed: any[] = [];

    for (const [index, update] of data.employmentContracts.entries()) {
      try {
        const updated = await this.prisma.$transaction(async (tx: PrismaTransaction) =>
          this.updateWithTransaction(tx, update.id, update.data, include, userId),
        );
        success.push(updated);
      } catch (error: any) {
        failed.push({
          index,
          id: update.id,
          error: error.message || 'Erro ao atualizar vínculo',
          data: { ...update.data, id: update.id },
        });
      }
    }

    const successMessage =
      success.length === 1
        ? '1 vínculo atualizado com sucesso'
        : `${success.length} vínculos atualizados com sucesso`;
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
    data: EmploymentContractBatchDeleteFormData,
    userId?: string,
  ): Promise<EmploymentContractBatchDeleteResponse> {
    const success: { id: string; deleted: boolean }[] = [];
    const failed: any[] = [];

    for (const [index, id] of data.employmentContractIds.entries()) {
      try {
        await this.delete(id, userId);
        success.push({ id, deleted: true });
      } catch (error: any) {
        failed.push({
          index,
          id,
          error: error.message || 'Erro ao excluir vínculo',
          data: { id },
        });
      }
    }

    const successMessage =
      success.length === 1
        ? '1 vínculo excluído com sucesso'
        : `${success.length} vínculos excluídos com sucesso`;
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
