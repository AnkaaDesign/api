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
import { CONTRACT_STATUS_ORDER } from '../../../constants/sortOrders';
import {
  canTransitionContractStatus,
  invalidContractStatusTransitionMessage,
  isOpenStatus,
  validateEmployeeContractTypeIntegrity,
} from '../../../utils/contract';
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
   * currentEmployeeType + espelha positionId/sectorId/payrollNumber. A situação
   * (currentContractStatus) é a fonte única de "vínculo ativo" — login e filtros
   * derivam dela (isUserEmployed / EMPLOYED_USER_WHERE), sem flag isActive.
   * Sempre executado dentro da transação que alterou o(s) vínculo(s) do colaborador.
   *
   * REGRA do vínculo atual (corrige o bug que pegava o maior sequence ignorando
   * a situação): preferimos o vínculo ABERTO (status = ACTIVE) de MAIOR sequence.
   * Só caímos para um vínculo TERMINATED se NÃO houver nenhum aberto (mantém
   * histórico coerente p/ readmissão).
   */
  async syncUserCurrentContract(
    tx: PrismaTransaction,
    userId: string,
    options?: { userId?: string },
  ): Promise<void> {
    const contracts = await tx.employmentContract.findMany({
      where: { userId },
      orderBy: { sequence: 'desc' },
    });

    // 1) Maior sequence ENTRE OS ABERTOS (não-TERMINATED). 2) fallback: maior
    // sequence geral (todos encerrados — pessoa desligada).
    const openContracts = contracts.filter(c => isOpenStatus(c.status));
    const current = openContracts[0] ?? contracts[0] ?? null;

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
      // Sem vínculos: limpa o cache. currentContractStatus = null significa
      // "sem vínculo ativo" — login/elegibilidade derivam disso (isUserEmployed),
      // não há mais flag isActive redundante a manter em sincronia.
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
      },
    });
  }

  // =====================
  // Phase-history audit trail (timeline of contractType phases)
  // =====================

  /**
   * Abre uma nova fase (linha de histórico em aberto, endDate=NULL) para a
   * modalidade atual do vínculo. Idempotente: se já existir uma fase ABERTA com o
   * mesmo contractType, não duplica. Ignora vínculos off-folha (contractType=null).
   * Sempre executado dentro da transação que alterou o vínculo.
   */
  async openContractPhase(
    tx: PrismaTransaction,
    params: {
      contractId: string;
      userId: string;
      contractType: CONTRACT_TYPE | null;
      startDate: Date;
      triggeredBy?: CHANGE_TRIGGERED_BY;
      reason?: string | null;
    },
  ): Promise<void> {
    const { contractId, userId, contractType, startDate, triggeredBy, reason } = params;
    // Off-folha (terceirizado/PJ/autônomo): sem modalidade → sem histórico de fase.
    if (!contractType) return;

    // Idempotência: não abrir uma fase duplicada do mesmo tipo se já houver uma aberta.
    const existingOpen = await tx.contractPhaseHistory.findFirst({
      where: { contractId, endDate: null },
      select: { id: true, contractType: true },
    });
    if (existingOpen && existingOpen.contractType === contractType) return;

    await tx.contractPhaseHistory.create({
      data: {
        contractId,
        userId,
        contractType: contractType as any,
        startDate,
        endDate: null,
        triggeredBy: (triggeredBy as any) ?? null,
        reason: reason ?? null,
      },
    });
  }

  /**
   * Encerra a fase ATUALMENTE EM ABERTO (endDate IS NULL) do vínculo, gravando o
   * endDate informado. No-op se não houver fase aberta. Sempre dentro da transação.
   */
  async closeOpenContractPhase(
    tx: PrismaTransaction,
    params: { contractId: string; endDate: Date },
  ): Promise<void> {
    const { contractId, endDate } = params;
    await tx.contractPhaseHistory.updateMany({
      where: { contractId, endDate: null },
      data: { endDate },
    });
  }

  /**
   * Transição de fase: encerra a fase aberta atual (closeOpenContractPhase) e abre
   * uma nova fase para a nova modalidade (openContractPhase), ambas na mesma data.
   * Usado tanto pela transição automática (cron) quanto pela efetivação manual.
   */
  async transitionContractPhase(
    tx: PrismaTransaction,
    params: {
      contractId: string;
      userId: string;
      newContractType: CONTRACT_TYPE | null;
      date: Date;
      triggeredBy?: CHANGE_TRIGGERED_BY;
      reason?: string | null;
    },
  ): Promise<void> {
    const { contractId, userId, newContractType, date, triggeredBy, reason } = params;
    await this.closeOpenContractPhase(tx, { contractId, endDate: date });
    await this.openContractPhase(tx, {
      contractId,
      userId,
      contractType: newContractType,
      startDate: date,
      triggeredBy,
      reason,
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

    // ── Guarda de sobreposição (readmissão): só é possível abrir um novo vínculo
    //    se o vínculo atual anterior estiver ENCERRADO (TERMINATED). Caso contrário
    //    haveria dois vínculos abertos simultâneos para a mesma pessoa.
    const currentOpen = await tx.employmentContract.findFirst({
      where: { userId, isCurrent: true, status: { not: CONTRACT_STATUS.TERMINATED } },
      select: { id: true, status: true, sequence: true },
    });
    if (currentOpen) {
      throw new BadRequestException(
        `Não é possível criar um novo vínculo para ${user.name}: o vínculo atual (sequência ${currentOpen.sequence}) ainda está aberto (${currentOpen.status}). Encerre-o (rescisão) antes de readmitir.`,
      );
    }

    const maxSequence = await tx.employmentContract.aggregate({
      where: { userId },
      _max: { sequence: true },
    });
    const sequence = (maxSequence._max.sequence ?? 0) + 1;

    const employeeType = (data.employeeType as EMPLOYEE_TYPE) ?? EMPLOYEE_TYPE.CLT;
    // Default de modalidade: CLT inicia em experiência → modalidade EXPERIENCE_PERIOD_1
    // (a fase de experiência é encodada no contractType). Off-folha → null.
    const contractType =
      data.contractType === undefined
        ? employeeType === EMPLOYEE_TYPE.CLT
          ? CONTRACT_TYPE.EXPERIENCE_PERIOD_1
          : null
        : (data.contractType as CONTRACT_TYPE | null);

    // Default de situação: vínculo nasce ACTIVE (CLT e off-folha). A situação é
    // binária; experiência é modalidade, não situação.
    const status =
      ((data as any).status as CONTRACT_STATUS | undefined) ?? CONTRACT_STATUS.ACTIVE;

    // Integridade categoria × modalidade.
    const integrityError = validateEmployeeContractTypeIntegrity({ employeeType, contractType });
    if (integrityError) {
      throw new BadRequestException(integrityError);
    }

    // Derruba o vínculo atual anterior (já garantido TERMINATED pela guarda acima).
    await tx.employmentContract.updateMany({
      where: { userId, isCurrent: true },
      data: { isCurrent: false },
    });

    const dates = this.computeContractDates({
      status,
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
        status: status as any,
        statusOrder: CONTRACT_STATUS_ORDER[status],
        matricula: data.matricula ?? null,
        payrollNumber: data.payrollNumber ?? null,
        positionId: data.positionId ?? user.positionId ?? null,
        sectorId: data.sectorId ?? user.sectorId ?? null,
        ...dates,
        providerName: data.providerName ?? null,
        providerCnpj: data.providerCnpj ?? null,
        hasArt481Clause: data.hasArt481Clause ?? false,
        insalubrityDegreeOverride: data.insalubrityDegreeOverride ?? null,
        hazardPayOverride: data.hazardPayOverride ?? null,
        stabilityType: data.stabilityType ?? null,
        stabilityStart: data.stabilityStart ?? null,
        stabilityEnd: data.stabilityEnd ?? null,
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

    // Abre a primeira fase do histórico (timeline da modalidade). Off-folha
    // (contractType=null) é ignorado dentro de openContractPhase.
    await this.openContractPhase(tx, {
      contractId: created.id,
      userId,
      contractType,
      startDate: (created.admissionDate as Date | null) ?? new Date(),
      triggeredBy: options?.userId ? CHANGE_TRIGGERED_BY.USER : CHANGE_TRIGGERED_BY.SYSTEM,
      reason: options?.changelogReason ?? 'Início do vínculo',
    });

    await this.syncUserCurrentContract(tx, userId, { userId: options?.userId });

    return created;
  }

  /**
   * Auto-cálculo das datas de experiência (CLT). A experiência é a MODALIDADE
   * `EXPERIENCE_PERIOD_1` / `EXPERIENCE_PERIOD_2` (status ACTIVE): split padrão
   * 1º período = 30 dias, 2º período = 50 dias (teto legal de 90 dias). Vínculo
   * já efetivado (INDETERMINATE) grava effectedAt. Retorna apenas os campos a persistir.
   *
   * O split é configurável via EXPERIENCE_PHASE_1_DAYS / EXPERIENCE_PHASE_2_DAYS.
   */
  static readonly EXPERIENCE_PHASE_1_DAYS = 30;
  static readonly EXPERIENCE_PHASE_2_DAYS = 50;

  computeContractDates(input: {
    status: CONTRACT_STATUS;
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

    const p1 = EmploymentContractService.EXPERIENCE_PHASE_1_DAYS;
    const p2 = EmploymentContractService.EXPERIENCE_PHASE_2_DAYS;

    const isExperience =
      input.contractType === CONTRACT_TYPE.EXPERIENCE_PERIOD_1 ||
      input.contractType === CONTRACT_TYPE.EXPERIENCE_PERIOD_2;

    if (isExperience) {
      const start = exp1StartAt || admissionDate || now;
      exp1StartAt = exp1StartAt || start;
      admissionDate = admissionDate || start;

      if (!exp1EndAt) {
        const e = new Date(start);
        e.setDate(e.getDate() + p1);
        exp1EndAt = e;
      }
      if (!exp2StartAt) {
        const s = new Date(start);
        s.setDate(s.getDate() + p1 + 1);
        exp2StartAt = s;
      }
      if (!exp2EndAt) {
        const e = new Date(start);
        e.setDate(e.getDate() + p1 + p2);
        exp2EndAt = e;
      }
    } else if (input.status === CONTRACT_STATUS.ACTIVE) {
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

    // ── Máquina de transição de situação: bloqueia regressões ilegais.
    if (data.status !== undefined && data.status !== existing.status) {
      if (!canTransitionContractStatus(existing.status, data.status as CONTRACT_STATUS)) {
        throw new BadRequestException(
          invalidContractStatusTransitionMessage(existing.status, data.status as string),
        );
      }
    }

    // ── Integridade categoria × modalidade (sobre o estado RESULTANTE).
    const resultingEmployeeType = (data.employeeType ?? existing.employeeType) as EMPLOYEE_TYPE;
    const resultingContractType = (
      data.contractType !== undefined ? data.contractType : existing.contractType
    ) as CONTRACT_TYPE | null;
    const integrityError = validateEmployeeContractTypeIntegrity({
      employeeType: resultingEmployeeType,
      contractType: resultingContractType,
    });
    if (integrityError) {
      throw new BadRequestException(integrityError);
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
    if (data.hasArt481Clause !== undefined) updateData.hasArt481Clause = data.hasArt481Clause;
    if (data.insalubrityDegreeOverride !== undefined)
      updateData.insalubrityDegreeOverride = data.insalubrityDegreeOverride;
    if (data.hazardPayOverride !== undefined) updateData.hazardPayOverride = data.hazardPayOverride;
    if (data.stabilityType !== undefined) updateData.stabilityType = data.stabilityType;
    if (data.stabilityStart !== undefined) updateData.stabilityStart = data.stabilityStart;
    if (data.stabilityEnd !== undefined) updateData.stabilityEnd = data.stabilityEnd;
    if (data.notes !== undefined) updateData.notes = data.notes;

    // Efetivação (CLT art. 451): mudança de modalidade EXPERIENCE_PERIOD_2 → INDETERMINATE
    // (a situação já é/permanece ACTIVE). Grava effectedAt se ainda não houver.
    if (
      data.contractType === CONTRACT_TYPE.INDETERMINATE &&
      existing.contractType === CONTRACT_TYPE.EXPERIENCE_PERIOD_2
    ) {
      if (data.effectedAt === undefined && !existing.effectedAt) {
        updateData.effectedAt = new Date();
      }
    }

    // Encerramento: status=TERMINATED sem data → grava agora.
    if (
      data.status === CONTRACT_STATUS.TERMINATED &&
      existing.status !== CONTRACT_STATUS.TERMINATED &&
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

    // Histórico de fases: quando a MODALIDADE muda de fato (inclui a efetivação
    // manual EXPERIENCE_PERIOD_2 → INDETERMINATE), encerra a fase aberta e abre a
    // nova. Guard contra dupla-abertura: só dispara se contractType realmente mudou.
    if (
      updateData.contractType !== undefined &&
      updated.contractType !== existing.contractType &&
      updated.contractType !== null
    ) {
      const transitionDate =
        (updateData.effectedAt as Date | undefined) ?? (updated.effectedAt as Date | null) ?? new Date();
      await this.transitionContractPhase(tx, {
        contractId: id,
        userId: existing.userId,
        newContractType: updated.contractType as CONTRACT_TYPE,
        date:
          updated.contractType === CONTRACT_TYPE.INDETERMINATE &&
          existing.contractType === CONTRACT_TYPE.EXPERIENCE_PERIOD_2
            ? transitionDate
            : new Date(),
        triggeredBy: CHANGE_TRIGGERED_BY.USER,
        reason:
          updated.contractType === CONTRACT_TYPE.INDETERMINATE &&
          existing.contractType === CONTRACT_TYPE.EXPERIENCE_PERIOD_2
            ? 'Efetivação (alteração manual)'
            : 'Alteração manual de modalidade',
      });
    }

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
