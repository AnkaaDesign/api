// admission.service.ts
// Admissões (Departamento Pessoal) — contract §2.

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FileService } from '@modules/common/file/file.service';
import { UserService } from '@modules/people/user/user.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  logEntityChange,
  trackAndLogFieldChanges,
} from '@modules/common/changelog/utils/changelog-helpers';
import { existsSync, unlinkSync } from 'fs';
import {
  ADMISSION_DOCUMENT_STATUS,
  ADMISSION_DOCUMENT_TYPE,
  ADMISSION_STATUS,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  CONTRACT_STATUS,
  ENTITY_TYPE,
  MEDICAL_EXAM_RESULT,
  MEDICAL_EXAM_STATUS,
  MEDICAL_EXAM_TYPE,
} from '../../../constants';
import {
  ADMISSION_STATUS_ORDER,
  CONTRACT_STATUS_ORDER,
  MEDICAL_EXAM_STATUS_ORDER,
} from '../../../constants/sortOrders';
import { EmploymentContractService } from '../employment-contract/employment-contract.service';
import { isProviderEmployeeType } from '../../../utils/contract';
import type {
  AdmissionBatchCreateResponse,
  AdmissionBatchDeleteResponse,
  AdmissionBatchUpdateResponse,
  AdmissionCreateResponse,
  AdmissionDeleteResponse,
  AdmissionDocumentUpdateResponse,
  AdmissionGetManyResponse,
  AdmissionGetUniqueResponse,
  AdmissionUpdateResponse,
} from '../../../types';
import type {
  AdmissionAdvanceFormData,
  AdmissionBatchCreateFormData,
  AdmissionBatchDeleteFormData,
  AdmissionBatchUpdateFormData,
  AdmissionCreateFormData,
  AdmissionDocumentUpdateFormData,
  AdmissionDocumentUploadFormData,
  AdmissionGetManyFormData,
  AdmissionInclude,
  AdmissionUpdateFormData,
} from '../../../schemas';

const STATUS_LABELS_PT: Record<string, string> = {
  [ADMISSION_STATUS.DOCS_PENDING]: 'Documentação pendente',
  [ADMISSION_STATUS.MEDICAL_EXAM]: 'Exame admissional',
  [ADMISSION_STATUS.CONTRACT]: 'Contrato',
  [ADMISSION_STATUS.REGISTRATION]: 'Registro',
  [ADMISSION_STATUS.COMPLETED]: 'Concluída',
  [ADMISSION_STATUS.CANCELLED]: 'Cancelada',
};

// Forward chain of the admission status machine (CANCELLED handled separately).
const STATUS_CHAIN: ADMISSION_STATUS[] = [
  ADMISSION_STATUS.DOCS_PENDING,
  ADMISSION_STATUS.MEDICAL_EXAM,
  ADMISSION_STATUS.CONTRACT,
  ADMISSION_STATUS.REGISTRATION,
  ADMISSION_STATUS.COMPLETED,
];

// Prestadores de serviço (terceirizado/PJ) não têm documentação CLT nem exame
// admissional, então pulam DOCS_PENDING e MEDICAL_EXAM: o processo começa no
// contrato e segue Contrato → Registro → Concluída.
const PROVIDER_STATUS_CHAIN: ADMISSION_STATUS[] = [
  ADMISSION_STATUS.CONTRACT,
  ADMISSION_STATUS.REGISTRATION,
  ADMISSION_STATUS.COMPLETED,
];

// Seleciona a cadeia de status conforme a categoria do vínculo.
function getStatusChain(
  employeeType: string | null | undefined,
): ADMISSION_STATUS[] {
  return isProviderEmployeeType(employeeType) ? PROVIDER_STATUS_CHAIN : STATUS_CHAIN;
}

// Default required-document checklist: every type EXCEPT the optional ones
// (OTHER / DRIVER_LICENSE / TIME_BANK_AGREEMENT — addable later as optional).
// Tipos exibidos/gerados no checklist da admissão. Tudo que não está aqui NÃO
// pertence à admissão (LGPD, contrato, vale-transporte, reservista, título de
// eleitor, PIS, salário-família…) — pode ser anexado depois no colaborador.
// ADMISSION_EXAM também não é documento: é o ASO (MedicalExam), tratado inline.
const DEFAULT_CHECKLIST: ADMISSION_DOCUMENT_TYPE[] = [
  ADMISSION_DOCUMENT_TYPE.CPF,
  ADMISSION_DOCUMENT_TYPE.RG,
  ADMISSION_DOCUMENT_TYPE.DRIVER_LICENSE, // CNH — alternativa ao RG
  ADMISSION_DOCUMENT_TYPE.CTPS,
  ADMISSION_DOCUMENT_TYPE.PROOF_OF_RESIDENCE,
  ADMISSION_DOCUMENT_TYPE.BIRTH_MARRIAGE_CERTIFICATE,
  ADMISSION_DOCUMENT_TYPE.PHOTO,
];
// Sempre obrigatórios.
const HARD_REQUIRED_DOCUMENT_TYPES: ADMISSION_DOCUMENT_TYPE[] = [ADMISSION_DOCUMENT_TYPE.CPF, ADMISSION_DOCUMENT_TYPE.CTPS];
// Obrigatório "um destes": RG OU CNH.
const EITHER_REQUIRED_DOCUMENT_TYPES: ADMISSION_DOCUMENT_TYPE[] = [ADMISSION_DOCUMENT_TYPE.RG, ADMISSION_DOCUMENT_TYPE.DRIVER_LICENSE];

@Injectable()
export class AdmissionService {
  private readonly logger = new Logger(AdmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
    private readonly userService: UserService,
    private readonly employmentContractService: EmploymentContractService,
  ) {}

  /**
   * Mapeia violações de unicidade do Prisma (P2002) vindas da criação do
   * colaborador para mensagens pt-BR (espelha o catch de UserService.create).
   * Retorna null quando o erro não é P2002.
   */
  private mapUserUniqueConstraintError(error: any): BadRequestException | null {
    if (error?.code !== 'P2002') return null;
    const field = error.meta?.target?.[0];
    const fieldNames: Record<string, string> = {
      email: 'Email',
      phone: 'Telefone',
      cpf: 'CPF',
      pis: 'PIS',
      payrollNumber: 'Número da folha de pagamento',
    };
    const fieldName = fieldNames[field] || field || 'Campo';
    return new BadRequestException(`${fieldName} já está em uso.`);
  }

  // =====================
  // Queries
  // =====================

  async findMany(query: AdmissionGetManyFormData): Promise<AdmissionGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit || 20;
      const skip = (page - 1) * take;

      const [total, admissions] = await Promise.all([
        this.prisma.admission.count({ where: query.where }),
        this.prisma.admission.findMany({
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
        message: 'Admissões carregadas com sucesso.',
        data: admissions as any[],
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
      this.logger.error('Erro ao buscar admissões:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar admissões. Por favor, tente novamente.',
      );
    }
  }

  async findById(id: string, include?: AdmissionInclude): Promise<AdmissionGetUniqueResponse> {
    try {
      const admission = await this.prisma.admission.findUnique({
        where: { id },
        include: include ?? { documents: true, user: true },
      });

      if (!admission) {
        throw new NotFoundException('Admissão não encontrada.');
      }

      return {
        success: true,
        message: 'Admissão carregada com sucesso.',
        data: admission as any,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao buscar admissão por ID:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar admissão. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Documentação do colaborador — busca a admissão pelo userId (relação 1:1).
   * Retorna data: null (success) quando o colaborador ainda não possui
   * processo de admissão, para a UI exibir o estado vazio sem erro.
   */
  async findByUser(
    userId: string,
    include?: AdmissionInclude,
  ): Promise<AdmissionGetUniqueResponse> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) {
        throw new NotFoundException('Colaborador não encontrado.');
      }

      const admission = await this.prisma.admission.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: include ?? { documents: { include: { file: true } }, user: true },
      });

      return {
        success: true,
        message: admission
          ? 'Admissão carregada com sucesso.'
          : 'O colaborador ainda não possui processo de admissão.',
        data: (admission ?? null) as any,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao buscar admissão por colaborador:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar admissão do colaborador. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Create
  // =====================

  private async createWithTransaction(
    tx: PrismaTransaction,
    data: AdmissionCreateFormData,
    userId?: string,
    include?: AdmissionInclude,
  ): Promise<{ admission: any; createdUser: any | null }> {
    if (!data.userId && !data.user) {
      throw new BadRequestException(
        'Selecione um colaborador existente ou informe os dados do novo colaborador.',
      );
    }

    // CPF auto-detect: when the new-person payload carries a CPF that already
    // belongs to someone, treat it as a re-engagement (rehire) — attach a NEW
    // vínculo to that person instead of creating a duplicate user.
    let targetExistingUserId: string | undefined = data.userId;
    if (!targetExistingUserId && data.user?.cpf) {
      const existingByCpf = await tx.user.findFirst({
        where: { cpf: (data.user as any).cpf },
        select: { id: true },
      });
      if (existingByCpf) {
        targetExistingUserId = existingByCpf.id;
      }
    }

    let createdUser: any = null;
    let targetUserId: string;

    if (!targetExistingUserId && data.user) {
      // Pessoa NOVA: cria usuário (que já cria o primeiro vínculo) pelo MESMO
      // caminho do POST /users. Encaminha o bloco `contract` da admissão.
      const userPayload: any = { ...(data.user as any) };
      if (data.contract) {
        userPayload.contract = {
          employeeType: data.contract.employeeType,
          contractType: data.contract.contractType,
          admissionDate: data.contract.admissionDate ?? data.hireDate ?? undefined,
          positionId: data.contract.positionId,
          sectorId: data.contract.sectorId,
          payrollNumber: data.contract.payrollNumber,
          providerName: data.contract.providerName,
          providerCnpj: data.contract.providerCnpj,
        };
      }
      createdUser = await this.userService.createWithinTransaction(tx, userPayload, {
        userId,
        changelogReason: 'Colaborador cadastrado pelo processo de admissão',
      });
      targetUserId = createdUser.id;
    } else {
      // Pessoa EXISTENTE (re-engajamento): cria um NOVO vínculo (sequence+1).
      targetUserId = targetExistingUserId as string;
      const user = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true },
      });
      if (!user) {
        throw new NotFoundException('Colaborador não encontrado.');
      }
      await this.employmentContractService.createContractForUserWithTransaction(
        tx,
        targetUserId,
        {
          employeeType: (data.contract?.employeeType as any) ?? undefined,
          contractType: (data.contract?.contractType as any) ?? undefined,
          admissionDate: data.contract?.admissionDate ?? data.hireDate ?? null,
          positionId: data.contract?.positionId ?? null,
          sectorId: data.contract?.sectorId ?? null,
          payrollNumber: data.contract?.payrollNumber ?? null,
          providerName: data.contract?.providerName ?? null,
          providerCnpj: data.contract?.providerCnpj ?? null,
        } as any,
        { userId, changelogReason: 'Novo vínculo criado pelo processo de admissão (re-engajamento)' },
      );
    }

    const user = await tx.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, currentContractId: true, currentContract: { select: { admissionDate: true } } },
    });
    if (!user) {
      throw new NotFoundException('Colaborador não encontrado.');
    }

    // Inline documents (besides the per-doc upload endpoint).
    const inlineDocuments = (data as any).documents as
      | Array<{ type: string; fileId: string }>
      | undefined;
    const inlineByType = new Map<string, string>();
    for (const doc of inlineDocuments ?? []) {
      inlineByType.set(doc.type, doc.fileId);
    }

    // Prestador de serviço (terceirizado/PJ): processo enxuto — começa no
    // contrato, sem checklist de documentos nem exame admissional.
    const isProvider = isProviderEmployeeType(data.contract?.employeeType);
    const isRehire = !!targetExistingUserId;

    // Documentos seguem a pessoa: numa re-engajamento (CPF já existente), carrega
    // para a nova admissão os documentos JÁ recebidos/assinados da admissão mais
    // recente, para que não seja preciso reenviá-los. (Não se aplica a prestador.)
    const carriedByType = new Map<string, { fileId: string | null; status: any }>();
    if (isRehire && !isProvider) {
      const priorAdmission = await tx.admission.findFirst({
        where: { userId: targetUserId, status: { not: ADMISSION_STATUS.CANCELLED } },
        orderBy: { createdAt: 'desc' },
        include: { documents: true },
      });
      for (const doc of priorAdmission?.documents ?? []) {
        const carriable =
          doc.status === ADMISSION_DOCUMENT_STATUS.RECEIVED ||
          doc.status === ADMISSION_DOCUMENT_STATUS.SIGNED;
        if (doc.fileId && carriable) {
          carriedByType.set(doc.type, { fileId: doc.fileId, status: doc.status });
        }
      }
    }

    const initialStatus = isProvider
      ? ADMISSION_STATUS.CONTRACT
      : ADMISSION_STATUS.DOCS_PENDING;

    const admission = await tx.admission.create({
      data: {
        userId: targetUserId,
        contractId: user.currentContractId ?? null,
        hireDate: data.hireDate ?? user.currentContract?.admissionDate ?? null,
        notes: data.notes ?? null,
        status: initialStatus,
        statusOrder: ADMISSION_STATUS_ORDER[initialStatus],
        createdById: userId ?? null,
        // Prestador não tem checklist. CLT: cria o checklist padrão, pré-preenchido
        // com o arquivo inline OU com o documento carregado da admissão anterior
        // (status RECEIVED quando há fileId).
        documents: isProvider
          ? undefined
          : {
              create: DEFAULT_CHECKLIST.map(type => {
                const inlineFileId = inlineByType.get(type);
                inlineByType.delete(type);
                const carried = carriedByType.get(type);
                const fileId = inlineFileId ?? carried?.fileId ?? null;
                return {
                  type: type as any,
                  // Obrigatórios: CPF + CTPS (RG/CNH validados como grupo no avanço).
                  required: HARD_REQUIRED_DOCUMENT_TYPES.includes(type),
                  fileId,
                  status: inlineFileId
                    ? ADMISSION_DOCUMENT_STATUS.RECEIVED
                    : carried?.status ?? ADMISSION_DOCUMENT_STATUS.PENDING,
                };
              }),
            },
      },
      include: include ?? { documents: true, user: true },
    });

    // Any remaining inline documents (optional types not in the default
    // checklist) are added as extra rows. ADMISSION_EXAM is never a document
    // (it is the real MedicalExam/ASO entity). Prestador não recebe documentos.
    for (const [type, fileId] of isProvider ? [] : inlineByType.entries()) {
      if (type === ADMISSION_DOCUMENT_TYPE.ADMISSION_EXAM) continue;
      await tx.admissionDocument.create({
        data: {
          admissionId: admission.id,
          type: type as any,
          required: HARD_REQUIRED_DOCUMENT_TYPES.includes(type as ADMISSION_DOCUMENT_TYPE),
          fileId,
          status: ADMISSION_DOCUMENT_STATUS.RECEIVED,
        },
      });
    }

    await logEntityChange({
      changeLogService: this.changeLogService,
      entityType: ENTITY_TYPE.ADMISSION,
      entityId: admission.id,
      action: CHANGE_ACTION.CREATE,
      entity: admission,
      reason: createdUser
        ? `Processo de admissão criado junto com o cadastro do colaborador ${user.name}`
        : `Processo de admissão criado para o colaborador ${user.name}`,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      userId: userId || null,
      transaction: tx,
    });

    return { admission, createdUser };
  }

  async create(
    data: AdmissionCreateFormData,
    include?: AdmissionInclude,
    userId?: string,
  ): Promise<AdmissionCreateResponse> {
    try {
      // Pessoa EXISTENTE com dados alterados no formulário: atualiza o
      // colaborador (apenas os campos enviados) ANTES de criar o novo vínculo +
      // admissão, para que correções de cadastro persistam sem duplicar o usuário.
      const userUpdate = (data as any).userUpdate as Record<string, unknown> | undefined;
      if (data.userId && userUpdate && Object.keys(userUpdate).length > 0) {
        await this.userService.update(data.userId, userUpdate as any, undefined, userId);
      }

      const { admission, createdUser } = await this.prisma.$transaction(
        async (tx: PrismaTransaction) => this.createWithTransaction(tx, data, userId, include),
      );

      // Post-commit user side effects (notification preferences + Secullum
      // bridge) — same hooks the POST /users path fires. Never throws.
      if (createdUser) {
        await this.userService.runPostCreateSideEffects(createdUser);
      }

      return {
        success: true,
        message: createdUser
          ? 'Colaborador cadastrado e admissão criada com sucesso.'
          : 'Admissão criada com sucesso.',
        data: admission,
      };
    } catch (error: any) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      const uniqueError = this.mapUserUniqueConstraintError(error);
      if (uniqueError) throw uniqueError;
      this.logger.error('Erro ao criar admissão:', error);
      throw new InternalServerErrorException('Erro ao criar admissão. Por favor, tente novamente.');
    }
  }

  // =====================
  // Update
  // =====================

  async update(
    id: string,
    data: AdmissionUpdateFormData,
    include?: AdmissionInclude,
    userId?: string,
  ): Promise<AdmissionUpdateResponse> {
    try {
      const admission = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.admission.findUnique({ where: { id } });
        if (!existing) {
          throw new NotFoundException('Admissão não encontrada.');
        }

        // Admissões finalizadas (concluídas/canceladas) são registros imutáveis —
        // espelha o guard de UI (botão Editar desabilitado) e o da rescisão.
        if (
          existing.status === ADMISSION_STATUS.COMPLETED ||
          existing.status === ADMISSION_STATUS.CANCELLED
        ) {
          throw new BadRequestException(
            `Não é possível editar uma admissão ${STATUS_LABELS_PT[existing.status].toLowerCase()}.`,
          );
        }

        const updated = await tx.admission.update({
          where: { id },
          data: {
            ...(data.hireDate !== undefined ? { hireDate: data.hireDate } : {}),
            ...(data.notes !== undefined ? { notes: data.notes } : {}),
          },
          include: include ?? { documents: true, user: true },
        });

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ADMISSION,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: ['hireDate', 'notes'],
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Admissão atualizada com sucesso.',
        data: admission as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao atualizar admissão:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar admissão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Delete
  // =====================

  async delete(id: string, userId?: string): Promise<AdmissionDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const admission = await tx.admission.findUnique({ where: { id } });
        if (!admission) {
          throw new NotFoundException('Admissão não encontrada.');
        }

        // Só é possível excluir admissões CANCELADAS ou já CONCLUÍDAS. Admissões
        // em andamento devem ser canceladas antes (preservando o histórico e
        // desfazendo o vínculo/ASO criados ao vivo) — excluir uma admissão em
        // andamento deixaria um vínculo ABERTO órfão (o colaborador seguiria
        // marcado como ativo) e um ASO pendente sem processo.
        if (
          admission.status !== ADMISSION_STATUS.CANCELLED &&
          admission.status !== ADMISSION_STATUS.COMPLETED
        ) {
          throw new BadRequestException(
            `Não é possível excluir uma admissão ${STATUS_LABELS_PT[admission.status].toLowerCase()}. Apenas admissões canceladas ou concluídas podem ser excluídas — cancele a admissão antes de excluí-la.`,
          );
        }

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.ADMISSION,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: admission,
          reason: 'Processo de admissão excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.admission.delete({ where: { id } });
      });

      return { success: true, message: 'Admissão excluída com sucesso.' };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao excluir admissão:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir admissão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Status machine — PUT /admissions/:id/advance
  // =====================

  async advance(
    id: string,
    data: AdmissionAdvanceFormData,
    include?: AdmissionInclude,
    userId?: string,
  ): Promise<AdmissionUpdateResponse> {
    try {
      const admission = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.admission.findUnique({
          where: { id },
          include: {
            documents: true,
            user: {
              select: {
                id: true,
                name: true,
                currentContractId: true,
                currentEmployeeType: true,
                currentContract: { select: { admissionDate: true } },
              },
            },
          },
        });
        if (!existing) {
          throw new NotFoundException('Admissão não encontrada.');
        }

        const currentStatus = existing.status as ADMISSION_STATUS;

        if (
          currentStatus === ADMISSION_STATUS.COMPLETED ||
          currentStatus === ADMISSION_STATUS.CANCELLED
        ) {
          throw new BadRequestException(
            `Não é possível alterar o status de uma admissão ${STATUS_LABELS_PT[currentStatus].toLowerCase()}.`,
          );
        }

        // Prestador (terceirizado/PJ) usa uma cadeia enxuta (sem documentação
        // nem exame admissional), então não pode retroceder a esses estágios.
        const isProvider = isProviderEmployeeType((existing as any).user?.currentEmployeeType);
        const statusChain = getStatusChain((existing as any).user?.currentEmployeeType);
        const currentIndex = statusChain.indexOf(currentStatus);
        const nextStatus = statusChain[currentIndex + 1];
        const previousStatus = currentIndex > 0 ? statusChain[currentIndex - 1] : undefined;
        const targetStatus = (data.status as ADMISSION_STATUS) ?? nextStatus;
        const isCancelling = targetStatus === ADMISSION_STATUS.CANCELLED;
        const isGoingBack = previousStatus !== undefined && targetStatus === previousStatus;

        // Valid moves: forward one step, back one step, or cancel.
        if (!isCancelling && targetStatus !== nextStatus && !isGoingBack) {
          throw new BadRequestException(
            `Transição de status inválida: ${STATUS_LABELS_PT[currentStatus]} → ${STATUS_LABELS_PT[targetStatus]}. Avance para ${nextStatus ? STATUS_LABELS_PT[nextStatus] : '—'}${previousStatus ? `, retroceda para ${STATUS_LABELS_PT[previousStatus]}` : ''} ou cancele.`,
          );
        }

        // Cancelar exige justificativa (por que a admissão não foi concluída).
        const cancellationReason = (data.reason ?? '').toString().trim();
        if (isCancelling && cancellationReason.length === 0) {
          throw new BadRequestException(
            'Informe o motivo do cancelamento (por que a admissão não foi concluída).',
          );
        }

        // Guard: cannot leave DOCS_PENDING (forward) while any required document
        // is still PENDING (WAIVED/RECEIVED/SIGNED are all acceptable).
        if (
          currentStatus === ADMISSION_STATUS.DOCS_PENDING &&
          !isCancelling &&
          !isGoingBack
        ) {
          const docs = existing.documents || [];
          // Obrigatórios fixos: CPF + CTPS.
          const hardPending = docs.filter(
            (doc: any) => HARD_REQUIRED_DOCUMENT_TYPES.includes(doc.type) && doc.status === ADMISSION_DOCUMENT_STATUS.PENDING,
          );
          // Obrigatório "um destes": RG ou CNH (satisfeito se pelo menos um não-pendente).
          const eitherDocs = docs.filter((doc: any) => EITHER_REQUIRED_DOCUMENT_TYPES.includes(doc.type));
          const eitherSatisfied = eitherDocs.length === 0 || eitherDocs.some((doc: any) => doc.status !== ADMISSION_DOCUMENT_STATUS.PENDING);
          if (hardPending.length > 0 || !eitherSatisfied) {
            throw new BadRequestException(
              'Não é possível avançar: são obrigatórios CPF, CTPS e RG ou CNH (recebidos, assinados ou dispensados).',
            );
          }
        }

        // Guard: cannot leave MEDICAL_EXAM (forward → CONTRACT) until the
        // collaborator's ADMISSION exam is COMPLETED with result FIT
        // (mirrors the required-documents guard above).
        if (
          currentStatus === ADMISSION_STATUS.MEDICAL_EXAM &&
          !isCancelling &&
          !isGoingBack
        ) {
          // Prefer the FK link (this admission's own ASO); fall back to the
          // legacy userId+type lookup for rows created before the FK existed.
          let admissionExam = await tx.medicalExam.findFirst({
            where: {
              admissionId: existing.id,
              status: { not: MEDICAL_EXAM_STATUS.CANCELLED as any },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (!admissionExam) {
            admissionExam = await tx.medicalExam.findFirst({
              where: {
                userId: existing.userId,
                type: MEDICAL_EXAM_TYPE.ADMISSION as any,
                status: { not: MEDICAL_EXAM_STATUS.CANCELLED as any },
              },
              orderBy: { createdAt: 'desc' },
            });
          }
          if (!admissionExam) {
            throw new BadRequestException(
              'Não é possível avançar: nenhum exame admissional (ASO) foi encontrado para o colaborador. Agende e conclua o exame admissional antes de prosseguir.',
            );
          }
          if (admissionExam.status !== MEDICAL_EXAM_STATUS.COMPLETED) {
            throw new BadRequestException(
              'Não é possível avançar: o exame admissional (ASO) ainda não foi concluído.',
            );
          }
          if (admissionExam.result !== MEDICAL_EXAM_RESULT.FIT) {
            throw new BadRequestException(
              'Não é possível avançar: o resultado do exame admissional (ASO) não é Apto. Apenas colaboradores aptos podem prosseguir para o contrato.',
            );
          }
        }

        // Entering MEDICAL_EXAM: auto-create the ADMISSION exam (SCHEDULED)
        // when the collaborator has no non-cancelled ADMISSION exam yet, so the
        // step never depends on someone remembering to create it manually.
        let examCrossReference = '';
        if (targetStatus === ADMISSION_STATUS.MEDICAL_EXAM && !isProvider) {
          const existingExam = await tx.medicalExam.findFirst({
            where: {
              status: { not: MEDICAL_EXAM_STATUS.CANCELLED as any },
              OR: [
                { admissionId: existing.id },
                { userId: existing.userId, type: MEDICAL_EXAM_TYPE.ADMISSION as any },
              ],
            },
            select: { id: true },
          });
          if (!existingExam) {
            const createdExam = await tx.medicalExam.create({
              data: {
                userId: existing.userId,
                type: MEDICAL_EXAM_TYPE.ADMISSION as any,
                status: MEDICAL_EXAM_STATUS.SCHEDULED as any,
                statusOrder: MEDICAL_EXAM_STATUS_ORDER[MEDICAL_EXAM_STATUS.SCHEDULED],
                // Link the ASO to THIS admission so the advance-guard and the
                // doc-sync use the FK instead of the fragile userId+type heuristic.
                admissionId: existing.id,
              },
            });

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.MEDICAL_EXAM,
              entityId: createdExam.id,
              action: CHANGE_ACTION.CREATE,
              entity: createdExam,
              reason: `Exame admissional (ASO) criado automaticamente pelo processo de admissão${(existing as any).user?.name ? ` do colaborador ${(existing as any).user.name}` : ''}`,
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              userId: userId || null,
              transaction: tx,
            });

            examCrossReference = ' — exame admissional (ASO) agendado automaticamente';
          }
        }

        const updated = await tx.admission.update({
          where: { id },
          data: {
            status: targetStatus as any,
            statusOrder: ADMISSION_STATUS_ORDER[targetStatus],
            // Ao cancelar: preserva a etapa em que estava + a justificativa.
            // Ao retomar/avançar de volta de um cancelamento (não ocorre hoje,
            // pois CANCELLED é final) os campos permaneceriam; limpamos quando
            // a transição não é um cancelamento para manter consistência.
            ...(isCancelling
              ? { cancelledFromStatus: currentStatus as any, cancellationReason }
              : { cancelledFromStatus: null, cancellationReason: null }),
          },
          include: include ?? { documents: true, user: true },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ADMISSION,
          entityId: id,
          action: isCancelling ? CHANGE_ACTION.CANCEL : CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: currentStatus,
          newValue: targetStatus,
          reason: isCancelling
            ? `Admissão cancelada na etapa "${STATUS_LABELS_PT[currentStatus]}": ${cancellationReason}`
            : `Status da admissão alterado: ${STATUS_LABELS_PT[currentStatus]} → ${STATUS_LABELS_PT[targetStatus]}${examCrossReference}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        // CANCELLED effect — desfaz os efeitos colaterais "ao vivo" que a criação
        // da admissão deixou pendentes, evitando vínculo/ASO órfãos:
        //  (1) encerra (TERMINATED) o vínculo que ESTA admissão criou — somente o
        //      contractId desta admissão, nunca vínculos anteriores — e re-sincroniza
        //      o cache do User (para colaborador re-engajado, o vínculo anterior
        //      encerrado volta a ser o atual; para colaborador novo, isActive=false);
        //  (2) cancela o ASO admissional ainda não concluído gerado pelo processo.
        if (isCancelling) {
          const contractId = (existing as any).contractId;
          if (contractId) {
            const contract = await tx.employmentContract.findUnique({
              where: { id: contractId },
              select: { id: true, status: true, sequence: true },
            });
            // Só encerramos vínculo ainda ABERTO (não mexe num já encerrado).
            if (contract && contract.status !== CONTRACT_STATUS.TERMINATED) {
              const now = new Date();
              await tx.employmentContract.update({
                where: { id: contractId },
                data: {
                  status: CONTRACT_STATUS.TERMINATED as any,
                  statusOrder: CONTRACT_STATUS_ORDER[CONTRACT_STATUS.TERMINATED],
                  terminationDate: now,
                },
              });
              await this.employmentContractService.closeOpenContractPhase(tx, {
                contractId,
                endDate: now,
              });
              await this.employmentContractService.syncUserCurrentContract(tx, existing.userId, {
                userId: userId ?? undefined,
              });

              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.USER,
                entityId: existing.userId,
                action: CHANGE_ACTION.UPDATE,
                field: 'currentContractStatus',
                oldValue: contract.status,
                newValue: CONTRACT_STATUS.TERMINATED,
                reason: `Vínculo (sequência ${contract.sequence}) encerrado pelo cancelamento do processo de admissão`,
                triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                triggeredById: id,
                userId: userId || null,
                transaction: tx,
              });
            }
          }

          // Cancela o ASO admissional pendente (SCHEDULED/IN_PROGRESS) desta
          // admissão — nunca um exame já concluído, que é registro permanente.
          const pendingExam = await tx.medicalExam.findFirst({
            where: {
              admissionId: existing.id,
              status: { notIn: [MEDICAL_EXAM_STATUS.COMPLETED, MEDICAL_EXAM_STATUS.CANCELLED] as any[] },
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, status: true },
          });
          if (pendingExam) {
            await tx.medicalExam.update({
              where: { id: pendingExam.id },
              data: {
                status: MEDICAL_EXAM_STATUS.CANCELLED as any,
                statusOrder: MEDICAL_EXAM_STATUS_ORDER[MEDICAL_EXAM_STATUS.CANCELLED],
              },
            });
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.MEDICAL_EXAM,
              entityId: pendingExam.id,
              action: CHANGE_ACTION.CANCEL,
              field: 'status',
              oldValue: pendingExam.status,
              newValue: MEDICAL_EXAM_STATUS.CANCELLED,
              reason: 'Exame admissional (ASO) cancelado pelo cancelamento do processo de admissão',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        // COMPLETED effect: the admission hireDate becomes the linked vínculo's
        // admissionDate when it was never filled (Admission.hireDate mirrors
        // EmploymentContract.admissionDate).
        if (targetStatus === ADMISSION_STATUS.COMPLETED) {
          const admissionUser = (existing as any).user;
          const contractId = (existing as any).contractId ?? admissionUser?.currentContractId;
          if (existing.hireDate && contractId && !admissionUser?.currentContract?.admissionDate) {
            await tx.employmentContract.update({
              where: { id: contractId },
              data: { admissionDate: existing.hireDate },
            });

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.USER,
              entityId: existing.userId,
              action: CHANGE_ACTION.UPDATE,
              field: 'admissionDate',
              oldValue: null,
              newValue: existing.hireDate,
              reason: 'Data de admissão definida pela conclusão do processo de admissão',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        return updated;
      });

      return {
        success: true,
        message: 'Status da admissão atualizado com sucesso.',
        data: admission as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao avançar status da admissão:', error);
      throw new InternalServerErrorException(
        'Erro ao avançar status da admissão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Documents — POST /admissions/:id/documents (multipart)
  // =====================

  private async uploadDocumentWithTransaction(
    tx: PrismaTransaction,
    admission: { id: string; user?: { name: string } | null },
    data: AdmissionDocumentUploadFormData,
    file: Express.Multer.File,
    userId?: string,
  ): Promise<any> {
    const id = admission.id;

    const createdFile = await this.fileService.createFromUploadWithTransaction(
      tx,
      file,
      'documents',
      userId,
      {
        entityId: id,
        entityType: 'ADMISSION',
        userName: (admission as any).user?.name,
      },
    );

    // OTHER allows multiple rows; every other type is upserted by type.
    const existingDocument =
      data.type === ADMISSION_DOCUMENT_TYPE.OTHER
        ? null
        : await tx.admissionDocument.findFirst({
            where: { admissionId: id, type: data.type as any },
          });

    let document: any;
    if (existingDocument) {
      document = await tx.admissionDocument.update({
        where: { id: existingDocument.id },
        data: {
          fileId: createdFile.id,
          status: ADMISSION_DOCUMENT_STATUS.RECEIVED,
          ...(data.note !== undefined ? { note: data.note } : {}),
        },
        include: { file: true },
      });
    } else {
      document = await tx.admissionDocument.create({
        data: {
          admissionId: id,
          type: data.type as any,
          required: HARD_REQUIRED_DOCUMENT_TYPES.includes(data.type as ADMISSION_DOCUMENT_TYPE),
          fileId: createdFile.id,
          status: ADMISSION_DOCUMENT_STATUS.RECEIVED,
          note: data.note ?? null,
        },
        include: { file: true },
      });
    }

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.ADMISSION,
      entityId: id,
      action: CHANGE_ACTION.UPDATE,
      field: `document_${data.type}`,
      oldValue: existingDocument
        ? { status: existingDocument.status, fileId: existingDocument.fileId }
        : null,
      newValue: { status: ADMISSION_DOCUMENT_STATUS.RECEIVED, fileId: createdFile.id },
      reason: `Documento de admissão recebido: ${data.type}`,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: id,
      userId: userId || null,
      transaction: tx,
    });

    return document;
  }

  async uploadDocument(
    id: string,
    data: AdmissionDocumentUploadFormData,
    file: Express.Multer.File | undefined,
    userId?: string,
  ): Promise<AdmissionDocumentUpdateResponse> {
    if (!file) {
      throw new BadRequestException('O arquivo do documento é obrigatório.');
    }

    try {
      const document = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const admission = await tx.admission.findUnique({
          where: { id },
          include: { user: { select: { name: true } } },
        });
        if (!admission) {
          throw new NotFoundException('Admissão não encontrada.');
        }

        return this.uploadDocumentWithTransaction(tx, admission as any, data, file, userId);
      });

      return {
        success: true,
        message: 'Documento da admissão enviado com sucesso.',
        data: document,
      };
    } catch (error: any) {
      // Clean up the uploaded temp file on error
      if (file && existsSync(file.path)) {
        try {
          unlinkSync(file.path);
        } catch {
          this.logger.warn(`Falha ao limpar arquivo temporário: ${file.path}`);
        }
      }
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao enviar documento da admissão:', error);
      throw new InternalServerErrorException(
        'Erro ao enviar documento da admissão. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Documentação do colaborador — POST /admissions/by-user/:userId/documents.
   * Faz o upload de um documento pelo userId; quando o colaborador ainda não
   * possui processo de admissão, ele é criado preguiçosamente (DOCS_PENDING,
   * com o checklist padrão) na mesma transação, conforme a máquina de status.
   */
  async uploadDocumentByUser(
    targetUserId: string,
    data: AdmissionDocumentUploadFormData,
    file: Express.Multer.File | undefined,
    userId?: string,
  ): Promise<AdmissionDocumentUpdateResponse> {
    if (!file) {
      throw new BadRequestException('O arquivo do documento é obrigatório.');
    }

    try {
      const document = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        let admission: any = await tx.admission.findFirst({
          where: { userId: targetUserId },
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { name: true } } },
        });

        if (!admission) {
          // Lazy-create the admission process for the collaborator
          // (createWithTransaction validates the user and writes the changelog).
          const created = await this.createWithTransaction(
            tx,
            { userId: targetUserId } as AdmissionCreateFormData,
            userId,
            { user: true } as any,
          );
          admission = created.admission;
        }

        return this.uploadDocumentWithTransaction(tx, admission, data, file, userId);
      });

      return {
        success: true,
        message: 'Documento da admissão enviado com sucesso.',
        data: document,
      };
    } catch (error: any) {
      // Clean up the uploaded temp file on error
      if (file && existsSync(file.path)) {
        try {
          unlinkSync(file.path);
        } catch {
          this.logger.warn(`Falha ao limpar arquivo temporário: ${file.path}`);
        }
      }
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao enviar documento da admissão do colaborador:', error);
      throw new InternalServerErrorException(
        'Erro ao enviar documento da admissão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Documents — PUT /admissions/documents/:documentId
  // =====================

  async updateDocument(
    documentId: string,
    data: AdmissionDocumentUpdateFormData,
    userId?: string,
  ): Promise<AdmissionDocumentUpdateResponse> {
    try {
      const document = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.admissionDocument.findUnique({ where: { id: documentId } });
        if (!existing) {
          throw new NotFoundException('Documento da admissão não encontrado.');
        }

        const updated = await tx.admissionDocument.update({
          where: { id: documentId },
          data: {
            ...(data.status !== undefined ? { status: data.status as any } : {}),
            ...(data.note !== undefined ? { note: data.note } : {}),
            ...(data.required !== undefined ? { required: data.required } : {}),
            ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
          },
          include: { file: true },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ADMISSION,
          entityId: existing.admissionId,
          action: CHANGE_ACTION.UPDATE,
          field: `document_${existing.type}`,
          oldValue: {
            status: existing.status,
            note: existing.note,
            required: existing.required,
          },
          newValue: {
            status: updated.status,
            note: updated.note,
            required: updated.required,
          },
          reason: `Documento de admissão atualizado: ${existing.type}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: existing.admissionId,
          userId: userId || null,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Documento da admissão atualizado com sucesso.',
        data: document as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao atualizar documento da admissão:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar documento da admissão. Por favor, tente novamente.',
      );
    }
  }

  // =====================
  // Batch operations
  // =====================

  async batchCreate(
    data: AdmissionBatchCreateFormData,
    include?: AdmissionInclude,
    userId?: string,
  ): Promise<AdmissionBatchCreateResponse<AdmissionCreateFormData>> {
    const success: any[] = [];
    const failed: any[] = [];

    for (const [index, admissionData] of data.admissions.entries()) {
      try {
        const { admission, createdUser } = await this.prisma.$transaction(
          async (tx: PrismaTransaction) =>
            this.createWithTransaction(tx, admissionData, userId, include),
        );
        if (createdUser) {
          await this.userService.runPostCreateSideEffects(createdUser);
        }
        success.push(admission);
      } catch (error: any) {
        const uniqueError = this.mapUserUniqueConstraintError(error);
        failed.push({
          index,
          error: uniqueError?.message || error.message || 'Erro ao criar admissão',
          data: admissionData,
        });
      }
    }

    const successMessage =
      success.length === 1
        ? '1 admissão criada com sucesso'
        : `${success.length} admissões criadas com sucesso`;
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
    data: AdmissionBatchUpdateFormData,
    include?: AdmissionInclude,
    userId?: string,
  ): Promise<AdmissionBatchUpdateResponse<AdmissionUpdateFormData>> {
    const success: any[] = [];
    const failed: any[] = [];

    for (const [index, update] of data.admissions.entries()) {
      try {
        const result = await this.update(update.id, update.data, include, userId);
        if (result.data) success.push(result.data);
      } catch (error: any) {
        failed.push({
          index,
          id: update.id,
          error: error.message || 'Erro ao atualizar admissão',
          data: { ...update.data, id: update.id },
        });
      }
    }

    const successMessage =
      success.length === 1
        ? '1 admissão atualizada com sucesso'
        : `${success.length} admissões atualizadas com sucesso`;
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
    data: AdmissionBatchDeleteFormData,
    userId?: string,
  ): Promise<AdmissionBatchDeleteResponse> {
    const success: { id: string; deleted: boolean }[] = [];
    const failed: any[] = [];

    for (const [index, id] of data.admissionIds.entries()) {
      try {
        await this.delete(id, userId);
        success.push({ id, deleted: true });
      } catch (error: any) {
        failed.push({
          index,
          id,
          error: error.message || 'Erro ao excluir admissão',
          data: { id },
        });
      }
    }

    const successMessage =
      success.length === 1
        ? '1 admissão excluída com sucesso'
        : `${success.length} admissões excluídas com sucesso`;
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
