// user.service.ts

import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import {
  SECULLUM_USER_CREATED_EVENT,
  SECULLUM_USER_UPDATED_EVENT,
  UserSecullumSyncService,
  type SecullumSyncResult,
} from '@modules/integrations/secullum/user-secullum-sync.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { UserRepository, PrismaTransaction } from './repositories/user.repository';
import type {
  User,
  UserBatchCreateResponse,
  UserBatchDeleteResponse,
  UserBatchUpdateResponse,
  UserCreateResponse,
  UserDeleteResponse,
  UserGetManyResponse,
  UserGetUniqueResponse,
  UserUpdateResponse,
  UserMergeResponse,
  FindManyOptions,
} from '../../../types';
import type {
  UserCreateFormData,
  UserUpdateFormData,
  UserGetManyFormData,
  UserBatchCreateFormData,
  UserBatchUpdateFormData,
  UserBatchDeleteFormData,
  UserMergeFormData,
  UserInclude,
  UserOrderBy,
  UserWhere,
} from '../../../schemas/user';
import { isValidStatusTransition, getStatusTransitionError } from '../../../schemas/user';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
  hasValueChanged,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_TRIGGERED_BY,
  CONTRACT_TYPE,
  CONTRACT_STATUS,
  EMPLOYEE_TYPE,
  ENTITY_TYPE,
  CHANGE_ACTION,
  SECTOR_PRIVILEGES,
  POSITION_CHANGE_REASON,
} from '../../../constants/enums';
import { POSITION_CHANGE_REASON_LABELS } from '../../../constants/enum-labels';
import { CONTRACT_STATUS_ORDER } from '../../../constants/sortOrders';
import { EmploymentContractService } from '@modules/human-resources/employment-contract/employment-contract.service';
import { isValidCPF, isValidPIS, isValidPhone } from '../../../utils';
import {
  canTransitionContractStatus,
  invalidContractStatusTransitionMessage,
  validateEmployeeContractTypeIntegrity,
} from '../../../utils/contract';
import { FileService } from '@modules/common/file/file.service';
import { FolderRenameService } from '@modules/common/file/services/folder-rename.service';
import { NotificationPreferenceInitService } from '@modules/common/notification/notification-preference-init.service';
import { unlinkSync, existsSync } from 'fs';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userRepository: UserRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
    private readonly folderRenameService: FolderRenameService,
    private readonly notificationPreferenceInitService: NotificationPreferenceInitService,
    /**
     * `forwardRef` is required at the injection site (not only on the module
     * import) because UserModule ⇄ EmploymentContractModule form a true
     * circular module dependency. Without it the provider can resolve to
     * `undefined` depending on instantiation order.
     */
    @Inject(forwardRef(() => EmploymentContractService))
    private readonly employmentContractService: EmploymentContractService,
    /**
     * Global Node EventEmitter (registered as @Global() in
     * `apps/api/src/modules/common/event-emitter`). Used to fire
     * Secullum sync events for the UPDATE path and any other listeners.
     */
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    /**
     * Direct reference to the Secullum bridge so the CREATE path can
     * `await` the sync and return its outcome to the web UI as a toast.
     * `forwardRef` is required because SecullumModule itself imports
     * UserModule.
     */
    @Inject(forwardRef(() => UserSecullumSyncService))
    private readonly userSecullumSyncService: UserSecullumSyncService,
  ) {}

  /**
   * Registrar histórico de cargo (UserPositionHistory) dentro da transação atual:
   * fecha o registro aberto (endedAt = agora) e adiciona o novo registro.
   * Usado pelos hooks de create/update/batch/merge e pela efetivação automática.
   */
  private async recordPositionHistory(
    tx: PrismaTransaction,
    params: {
      userId: string;
      newPositionId: string | null;
      previousPositionId: string | null;
      reason: POSITION_CHANGE_REASON;
      changedById?: string | null;
      note?: string | null;
      triggeredBy?: CHANGE_TRIGGERED_BY;
    },
  ): Promise<void> {
    const now = new Date();

    // Fechar o registro de histórico aberto
    await tx.userPositionHistory.updateMany({
      where: { userId: params.userId, endedAt: null },
      data: { endedAt: now },
    });

    // Adicionar o novo registro
    const created = await tx.userPositionHistory.create({
      data: {
        userId: params.userId,
        positionId: params.newPositionId,
        previousPositionId: params.previousPositionId,
        reason: params.reason as any,
        startedAt: now,
        note: params.note ?? null,
        changedById: params.changedById ?? null,
      },
    });

    await logEntityChange({
      changeLogService: this.changeLogService,
      entityType: ENTITY_TYPE.USER_POSITION_HISTORY,
      entityId: created.id,
      action: CHANGE_ACTION.CREATE,
      entity: created,
      reason: `Histórico de cargo registrado (${POSITION_CHANGE_REASON_LABELS[params.reason]})`,
      triggeredBy: params.triggeredBy ?? CHANGE_TRIGGERED_BY.USER_ACTION,
      userId: params.changedById ?? null,
      transaction: tx,
    });
  }

  // Experience-period date auto-calculation moved to the EmploymentContract
  // (EmploymentContractService.computeContractDates). User no longer carries
  // these dates — they live on the current vínculo.

  /**
   * Validar usuário completo
   */
  /**
   * Security guards for user writes (audit B1/B8, decision 12).
   * - Non-ADMIN actors cannot change their OWN sectorId/positionId/status/performanceLevel.
   * - Non-ADMIN actors cannot assign a sector with ADMIN privileges (blocks HR→ADMIN escalation).
   * - Non-ADMIN actors cannot set account-takeover fields on updates
   *   (verificationCode/Type/ExpiresAt, requirePasswordChange, sessionToken — silently stripped),
   *   nor another user's password (stripped; self password change via profile keeps working).
   * Mutates `data` in place (strips) and throws ForbiddenException on escalation attempts.
   */
  private async enforceUserWriteGuards(
    actorId: string | undefined,
    data: Partial<UserCreateFormData & UserUpdateFormData>,
    existingUser: {
      id: string;
      sectorId: string | null;
      positionId: string | null;
      currentContractType: string | null;
      performanceLevel: number;
    } | null,
    tx?: PrismaTransaction,
  ): Promise<void> {
    // No actor = internal/system call (controllers always pass the JWT userId).
    if (!actorId) return;

    const client = tx ?? this.prisma;
    const actor = await client.user.findUnique({
      where: { id: actorId },
      select: { sector: { select: { privileges: true } } },
    });
    if (actor?.sector?.privileges === SECTOR_PRIVILEGES.ADMIN) return;

    const anyData = data as Record<string, any>;

    if (existingUser) {
      // B8/H3: account-takeover fields are ADMIN-only on updates.
      for (const field of [
        'verificationCode',
        'verificationType',
        'verificationExpiresAt',
        'requirePasswordChange',
        'sessionToken',
      ]) {
        if (anyData[field] !== undefined) delete anyData[field];
      }
      // Non-ADMIN may only change their OWN password (profile flow), never someone else's.
      if (existingUser.id !== actorId && anyData.password !== undefined) {
        delete anyData.password;
      }

      // B1(a): non-ADMIN cannot change own privileged fields.
      if (existingUser.id === actorId) {
        for (const field of [
          'sectorId',
          'positionId',
          'contractType',
          'contractStatus',
          'employeeType',
          'performanceLevel',
        ] as const) {
          if (anyData[field] !== undefined && anyData[field] !== (existingUser as any)[field]) {
            throw new ForbiddenException(
              'Você não pode alterar seu próprio setor, cargo, status ou nível de desempenho.',
            );
          }
        }
      }
    }

    // B1(b): non-ADMIN cannot assign a sector whose privileges include ADMIN.
    const newSectorId = anyData.sectorId;
    if (newSectorId && (!existingUser || newSectorId !== existingUser.sectorId)) {
      const sector = await client.sector.findUnique({
        where: { id: newSectorId },
        select: { privileges: true },
      });
      if (sector?.privileges === SECTOR_PRIVILEGES.ADMIN) {
        throw new ForbiddenException(
          'Apenas administradores podem atribuir um setor com privilégios de administrador.',
        );
      }
    }
  }

  private async userValidation(
    data: Partial<UserCreateFormData | UserUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;
    const isUpdate = !!existingId;

    // Validar campos obrigatórios para criação
    if (!isUpdate) {
      if (!data.name || data.name.trim().length === 0) {
        throw new BadRequestException('Nome é obrigatório.');
      }
      if (!data.email) {
        throw new BadRequestException('Email é obrigatório.');
      }
    }

    // Validar formato e tamanho do nome
    if (data.name !== undefined) {
      const trimmedName = data.name.trim();
      if (trimmedName.length === 0) {
        throw new BadRequestException('Nome não pode ser vazio.');
      }
      if (trimmedName.length < 2) {
        throw new BadRequestException('Nome deve ter pelo menos 2 caracteres.');
      }
      if (trimmedName.length > 200) {
        throw new BadRequestException('Nome deve ter no máximo 200 caracteres.');
      }
    }

    // Validar formato do email
    if (data.email !== undefined) {
      // Convert empty string to null to avoid unique constraint issues
      if (data.email === '' || data.email === null) {
        data.email = null;
      } else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(data.email)) {
          throw new BadRequestException('Email inválido.');
        }

        // Validar tamanho do email
        if (data.email.length > 100) {
          throw new BadRequestException('Email deve ter no máximo 100 caracteres.');
        }

        // Validar unicidade do email
        const existingEmail = await this.userRepository.findByEmail(data.email, tx);
        if (existingEmail && existingEmail.id !== existingId) {
          throw new BadRequestException('Email já está em uso.');
        }
      }
    }

    // Validar CPF
    if (data.cpf !== undefined && data.cpf !== null) {
      // Validar formato do CPF
      if (!isValidCPF(data.cpf)) {
        throw new BadRequestException('CPF inválido.');
      }

      // Validar unicidade do CPF
      const existingCpf = await this.userRepository.findByCpf(data.cpf, tx);
      if (existingCpf && existingCpf.id !== existingId) {
        throw new BadRequestException('CPF já está cadastrado.');
      }
    }

    // Validar telefone
    if (data.phone !== undefined) {
      // Convert empty string to null to avoid unique constraint issues
      if (data.phone === '' || data.phone === null) {
        data.phone = null;
        // Skip uniqueness check for null values - multiple users can have null phone
      } else {
        // Validar formato do telefone
        if (!isValidPhone(data.phone)) {
          throw new BadRequestException('Telefone inválido.');
        }

        // Validar unicidade do telefone (only for non-null values)
        const existingPhone = await this.userRepository.findByPhone(data.phone, tx);
        if (existingPhone && existingPhone.id !== existingId) {
          throw new BadRequestException('Telefone já está em uso.');
        }
      }
    }

    // Validar formato do PIS se fornecido
    if (data.pis !== undefined && data.pis !== null) {
      if (!isValidPIS(data.pis)) {
        throw new BadRequestException('PIS inválido.');
      }
    }

    // Validar número da folha (payrollNumber)
    if (data.payrollNumber !== undefined && data.payrollNumber !== null) {
      // Verificar se é um número positivo
      if (!Number.isInteger(data.payrollNumber) || data.payrollNumber <= 0) {
        throw new BadRequestException('Número da folha deve ser um número inteiro positivo.');
      }

      // Validar unicidade do número da folha
      const existingPayrollNumber = await this.userRepository.findByPayrollNumber(
        data.payrollNumber,
        tx,
      );
      if (existingPayrollNumber && existingPayrollNumber.id !== existingId) {
        throw new BadRequestException('Número da folha já está em uso.');
      }
    }

    // Validar nível de desempenho
    if (data.performanceLevel !== undefined) {
      if (!Number.isInteger(data.performanceLevel)) {
        throw new BadRequestException('Nível de desempenho deve ser um número inteiro.');
      }
      if (data.performanceLevel < 0 || data.performanceLevel > 5) {
        throw new BadRequestException('Nível de desempenho deve estar entre 0 e 5.');
      }
    }

    // Validar senha quando fornecida (opcional para criação por admin)
    if (data.password !== undefined && data.password !== null) {
      // Validar força da senha - deve ter pelo menos 8 caracteres com complexidade
      if (data.password.length < 8) {
        throw new BadRequestException('Senha deve ter pelo menos 8 caracteres.');
      }
      if (data.password.length > 128) {
        throw new BadRequestException('Senha deve ter no máximo 128 caracteres.');
      }
      // Note: Additional password strength validation (uppercase, lowercase, number)
      // is handled by the Zod schema validation in the controller
    }

    // Validar relacionamentos se IDs fornecidos
    if (data.positionId !== undefined) {
      if (data.positionId === null) {
        // Permitir remover a posição
      } else {
        const position = await transaction.position.findUnique({
          where: { id: data.positionId },
        });
        if (!position) {
          throw new NotFoundException('Cargo não encontrado.');
        }
      }
    }

    if (data.sectorId !== undefined) {
      if (data.sectorId === null) {
        // Permitir remover o setor
      } else {
        const sector = await transaction.sector.findUnique({
          where: { id: data.sectorId },
        });
        if (!sector) {
          throw new NotFoundException('Setor não encontrado.');
        }
      }
    }

    // Note: ledSector is now handled via Sector.leaderId relation
    // The business logic for sector leadership should be handled in the Sector service

    // Validar que ao demitir (status do vínculo → TERMINATED), o usuário não tenha pendências
    if (isUpdate && (data as any).contractStatus === CONTRACT_STATUS.TERMINATED) {
      // Verificar empréstimos não devolvidos
      const unreturnedBorrows = await transaction.borrow.count({
        where: {
          userId: existingId,
          returnedAt: null,
        },
      });

      if (unreturnedBorrows > 0) {
        throw new BadRequestException(
          `Usuário possui ${unreturnedBorrows} empréstimo(s) não devolvido(s). Não é possível demitir antes de devolver os itens.`,
        );
      }

      // Verificar tarefas em andamento criadas pelo usuário
      const activeTasks = await transaction.task.count({
        where: {
          createdById: existingId,
          status: {
            in: ['PREPARATION', 'WAITING_PRODUCTION', 'IN_PRODUCTION'],
          },
        },
      });

      if (activeTasks > 0) {
        throw new BadRequestException(
          `Usuário possui ${activeTasks} tarefa(s) em andamento que criou. Não é possível inativar.`,
        );
      }
    }
  }

  /**
   * Buscar muitos usuários com filtros
   */
  async findMany(
    query: UserGetManyFormData,
    include?: UserInclude,
    userId?: string,
  ): Promise<UserGetManyResponse> {
    try {
      // Map UserGetManyFormData to FindManyOptions
      const {
        page,
        limit,
        take,
        skip,
        where,
        orderBy,
        include: queryInclude,
        select,
        ...filters
      } = query;
      const finalInclude = include || queryInclude;

      // Build where clause with filters
      const finalWhere = where || {};

      // Handle searchingFor transformation
      // NOTE: This logic is now handled by the frontend schema (user.ts:778-799)
      // which transforms searchingFor into proper OR conditions including payrollNumber
      // Removed duplicate backend transformation to prevent conflicts

      // Handle other filters
      if (filters.name !== undefined) finalWhere.name = filters.name;
      if (filters.email !== undefined) finalWhere.email = filters.email;
      if (filters.phone !== undefined) finalWhere.phone = filters.phone;
      if (filters.cpf !== undefined) finalWhere.cpf = filters.cpf;
      if (filters.payrollNumber !== undefined) finalWhere.payrollNumber = filters.payrollNumber;

      // Handle contractKind - now mapped to the current-vínculo type cache
      if (filters.contractKind !== undefined) {
        if (Array.isArray(filters.contractKind)) {
          // If it's an array, use 'in' operator
          finalWhere.currentContractType =
            filters.contractKind.length > 0 ? { in: filters.contractKind } : undefined;
        } else {
          // If it's a single value, assign directly
          finalWhere.currentContractType = filters.contractKind;
        }
      }

      // Handle positionId - check if it's an array or single value
      if (filters.positionId !== undefined) {
        if (Array.isArray(filters.positionId)) {
          finalWhere.positionId =
            filters.positionId.length > 0 ? { in: filters.positionId } : undefined;
        } else {
          finalWhere.positionId = filters.positionId;
        }
      }

      // Handle sectorId - check if it's an array or single value
      if (filters.sectorId !== undefined) {
        if (Array.isArray(filters.sectorId)) {
          finalWhere.sectorId = filters.sectorId.length > 0 ? { in: filters.sectorId } : undefined;
        } else {
          finalWhere.sectorId = filters.sectorId;
        }
      }

      if (filters.verified !== undefined) finalWhere.verified = filters.verified;
      if (filters.requirePasswordChange !== undefined)
        finalWhere.requirePasswordChange = filters.requirePasswordChange;
      if (filters.createdAt !== undefined) finalWhere.createdAt = filters.createdAt;
      if (filters.updatedAt !== undefined) finalWhere.updatedAt = filters.updatedAt;

      // Handle legacy plural array filters (kept for backward compatibility)
      if (filters.sectorIds && filters.sectorIds.length > 0) {
        finalWhere.sectorId = { in: filters.sectorIds };
      }
      if (filters.positionIds && filters.positionIds.length > 0) {
        finalWhere.positionId = { in: filters.positionIds };
      }
      if (filters.contractKinds && filters.contractKinds.length > 0) {
        finalWhere.currentContractType = { in: filters.contractKinds };
      }

      // Handle boolean filters
      if (filters.isActive !== undefined) {
        finalWhere.isActive = filters.isActive;
      }
      if (filters.isVerified !== undefined) {
        finalWhere.verified = filters.isVerified;
      }
      if (filters.hasPosition !== undefined) {
        finalWhere.positionId = filters.hasPosition ? { not: null } : null;
      }
      if (filters.hasSector !== undefined) {
        finalWhere.sectorId = filters.hasSector ? { not: null } : null;
      }
      if (filters.hasPpeSize !== undefined) {
        finalWhere.ppeSize = filters.hasPpeSize ? { isNot: null } : null;
      }

      // Handle existence filters
      if (filters.hasActivities !== undefined) {
        finalWhere.activities = filters.hasActivities ? { some: {} } : { none: {} };
      }
      if (filters.hasTasks !== undefined) {
        finalWhere.createdTasks = filters.hasTasks ? { some: {} } : { none: {} };
      }

      // Handle range filters
      if (filters.performanceLevelRange) {
        const levelWhere: any = {};
        if (filters.performanceLevelRange.min !== undefined) {
          levelWhere.gte = filters.performanceLevelRange.min;
        }
        if (filters.performanceLevelRange.max !== undefined) {
          levelWhere.lte = filters.performanceLevelRange.max;
        }
        if (Object.keys(levelWhere).length > 0) {
          finalWhere.performanceLevel = levelWhere;
        }
      }

      if (filters.birthDateRange) {
        const dateWhere: any = {};
        if (filters.birthDateRange.gte !== undefined) {
          dateWhere.gte = filters.birthDateRange.gte;
        }
        if (filters.birthDateRange.lte !== undefined) {
          dateWhere.lte = filters.birthDateRange.lte;
        }
        if (Object.keys(dateWhere).length > 0) {
          finalWhere.birth = dateWhere;
        }
      }

      const result = await this.userRepository.findMany({
        page,
        take: take || limit,
        skip,
        where: finalWhere,
        orderBy,
        include: finalInclude,
        select,
      });

      // Remove passwords from response
      const dataWithoutPasswords = result.data.map(({ password, ...user }) => user as User);
      return {
        success: true,
        data: dataWithoutPasswords,
        meta: result.meta,
        message: 'Usuários carregados com sucesso',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar usuários:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar usuários. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Buscar um usuário por ID
   */
  async findById(id: string, include?: UserInclude): Promise<UserGetUniqueResponse> {
    try {
      const user = await this.userRepository.findById(id, { include });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }

      // Remove password from response
      const { password, ...userWithoutPassword } = user;
      return {
        success: true,
        data: userWithoutPassword as User,
        message: 'Usuário carregado com sucesso',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar usuário por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar usuário. Por favor, tente novamente.');
    }
  }

  /**
   * Valida a transição de TIPO de contrato dentro do vínculo atual
   * (experiência → efetivado, etc.). Delega ao helper compartilhado do schema.
   * A demissão é uma mudança de STATUS (não de tipo) e é tratada à parte.
   */
  private validateUserStatusTransition(
    currentType: CONTRACT_TYPE,
    newType: CONTRACT_TYPE,
  ): { valid: boolean; error?: string } {
    if (currentType === newType) {
      return { valid: true };
    }
    if (!isValidStatusTransition(currentType, newType)) {
      return { valid: false, error: getStatusTransitionError(currentType, newType) };
    }
    return { valid: true };
  }

  /**
   * Process avatar file upload
   */
  private async processAvatarFile(
    avatarFile: Express.Multer.File,
    userId: string,
    userName: string,
    tx: PrismaTransaction,
    triggeredBy?: string,
  ): Promise<string> {
    try {
      const fileRecord = await this.fileService.createFromUploadWithTransaction(
        tx,
        avatarFile,
        'userAvatar',
        triggeredBy,
        {
          entityId: userId,
          entityType: 'user',
          userName,
        },
      );
      this.logger.log(`Avatar file created and moved to storage: ${fileRecord.path}`);
      return fileRecord.id;
    } catch (error: any) {
      this.logger.error(`Failed to process avatar file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Throws BadRequestException with a structured message listing every
   * required field / mapping that is missing for Secullum sync.
   *
   * Called from create() when `secullumSyncEnabled === true`, and from
   * update() when the toggle is being flipped on (or is already on and
   * a relevant field is being changed).
   *
   * The list mirrors the bridge's preconditions in
   * `UserSecullumSyncService.onUserCreated`:
   *  - cpf
   *  - payrollNumber          (Secullum requires NumeroFolha)
   *  - exp1StartAt            (Secullum requires a valid Admissao)
   *  - sectorId + sector mapped to a departamento
   *  - positionId + position mapped to a função
   */
  private async validateSecullumPrerequisites(
    effective: {
      cpf?: string | null;
      payrollNumber?: number | null;
      admissionDate?: Date | string | null;
      sectorId?: string | null;
      positionId?: string | null;
    },
    tx: PrismaTransaction,
  ): Promise<void> {
    const missing: string[] = [];

    if (!effective.cpf) missing.push('CPF');
    if (effective.payrollNumber == null) missing.push('Número da folha');
    if (!effective.admissionDate) missing.push('Data de admissão (início do período de experiência)');
    if (!effective.sectorId) missing.push('Setor');
    if (!effective.positionId) missing.push('Cargo');

    if (effective.sectorId) {
      const sector = await tx.sector.findUnique({
        where: { id: effective.sectorId },
        select: { name: true, secullumDepartamentoId: true },
      });
      if (sector && sector.secullumDepartamentoId == null) {
        missing.push(
          `Setor "${sector.name}" sem departamento Secullum vinculado ` +
            `(configure em Recursos Humanos → Integração Secullum)`,
        );
      }
    }

    if (effective.positionId) {
      const position = await tx.position.findUnique({
        where: { id: effective.positionId },
        select: { name: true, secullumFuncaoId: true },
      });
      if (position && position.secullumFuncaoId == null) {
        missing.push(
          `Cargo "${position.name}" sem função Secullum vinculada ` +
            `(configure em Recursos Humanos → Integração Secullum)`,
        );
      }
    }

    if (missing.length > 0) {
      throw new BadRequestException(
        'Não é possível habilitar a sincronização com Secullum. ' +
          `Pendências: ${missing.join('; ')}.`,
      );
    }
  }

  /**
   * Núcleo da criação de usuário, executado DENTRO de uma transação aberta.
   *
   * Usado pelo POST /users (via create()) e pelo processo de admissão
   * (AdmissionService), que cria o colaborador e a admissão na MESMA
   * transação. Executa guards, validação, defaults, criação no repositório,
   * vínculo de líder de setor, histórico de cargo inicial e o changelog de
   * CREATE. Efeitos pós-commit (preferências de notificação, Secullum) ficam
   * em runPostCreateSideEffects().
   */
  async createWithinTransaction(
    tx: PrismaTransaction,
    data: UserCreateFormData,
    options?: {
      include?: UserInclude;
      userId?: string;
      avatarFile?: Express.Multer.File;
      changelogReason?: string;
    },
  ): Promise<any> {
    const { include, userId, avatarFile, changelogReason } = options ?? {};

    // Security: privilege-escalation guards (audit B1, decision 12)
    await this.enforceUserWriteGuards(userId, data, null, tx);

    // Validar usuário completo
    await this.userValidation(data, undefined, tx);

    // If the user is opting in to Secullum sync at create time, every
    // prerequisite the bridge needs MUST be present and the sector/position
    // mappings MUST exist. Otherwise we'd commit an Ankaa user that we
    // can't create on the Secullum side, leaving the operator confused.
    if ((data as any).secullumSyncEnabled === true) {
      await this.validateSecullumPrerequisites(data, tx);
    }

    // Hash da senha se fornecida
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10);
    }

    // Process avatar file if provided
    let avatarId: string | null = data.avatarId || null;
    if (avatarFile) {
      try {
        avatarId = await this.processAvatarFile(avatarFile, '', data.name, tx, userId);
      } catch (fileError: any) {
        this.logger.error(`Avatar file processing failed: ${fileError.message}`);
        if (existsSync(avatarFile.path)) {
          unlinkSync(avatarFile.path);
        }
        throw new BadRequestException('Erro ao processar arquivo de avatar.');
      }
    }

    // Extract non-column inputs before creating the user: the nested `contract`
    // block and the top-level admissionDate feed the first EmploymentContract,
    // not the User row. isSectorLeader is a flag, not a column.
    const isSectorLeader = (data as any).isSectorLeader;
    const contractInput = (data as any).contract;
    const admissionDate = (data as any).admissionDate;
    const {
      isSectorLeader: _isSectorLeader,
      contract: _contract,
      admissionDate: _admissionDate,
      ...createData
    } = data as any;

    // Criar o usuário
    const newUser = await this.userRepository.createWithTransaction(
      tx,
      { ...createData, avatarId },
      { include },
    );

    // Handle isSectorLeader flag - update Sector.leaderId relationship
    if (isSectorLeader && createData.sectorId) {
      await tx.sector.update({
        where: { id: createData.sectorId },
        data: { leaderId: newUser.id },
      });
      this.logger.log(`New user ${newUser.id} set as leader of sector ${createData.sectorId}`);
    }

    // Criar o PRIMEIRO vínculo (sequence 1, isCurrent true) e sincronizar o
    // cache do User (currentContract*). Defaults CLT: contractType=FIXED_TERM,
    // status=EXPERIENCE (a experiência é a SITUAÇÃO, não uma modalidade);
    // off-folha: contractType=null, status=ACTIVE. Datas calculadas automaticamente.
    const employeeType = (contractInput?.employeeType as EMPLOYEE_TYPE) ?? EMPLOYEE_TYPE.CLT;
    const contractType =
      contractInput?.contractType === undefined
        ? employeeType === EMPLOYEE_TYPE.CLT
          ? CONTRACT_TYPE.FIXED_TERM
          : null
        : (contractInput.contractType as CONTRACT_TYPE | null);
    const status =
      employeeType === EMPLOYEE_TYPE.CLT ? CONTRACT_STATUS.EXPERIENCE : CONTRACT_STATUS.ACTIVE;
    const integrityError = validateEmployeeContractTypeIntegrity({ employeeType, contractType });
    if (integrityError) {
      throw new BadRequestException(integrityError);
    }
    const contractDates = this.employmentContractService.computeContractDates({
      status,
      contractType,
      admissionDate: contractInput?.admissionDate ?? admissionDate ?? null,
      exp1StartAt: null,
      exp1EndAt: null,
      exp2StartAt: null,
      exp2EndAt: null,
      effectedAt: null,
    });

    await tx.employmentContract.create({
      data: {
        userId: newUser.id,
        sequence: 1,
        isCurrent: true,
        employeeType: employeeType as any,
        contractType: (contractType as any) ?? null,
        status: status as any,
        statusOrder: CONTRACT_STATUS_ORDER[status],
        payrollNumber: contractInput?.payrollNumber ?? newUser.payrollNumber ?? null,
        positionId: contractInput?.positionId ?? newUser.positionId ?? null,
        sectorId: contractInput?.sectorId ?? newUser.sectorId ?? null,
        ...contractDates,
        providerName: contractInput?.providerName ?? null,
        providerCnpj: contractInput?.providerCnpj ?? null,
      },
    });

    await this.employmentContractService.syncUserCurrentContract(tx, newUser.id, { userId });

    // Registrar histórico de cargo inicial (admissão)
    if (newUser.positionId) {
      await this.recordPositionHistory(tx, {
        userId: newUser.id,
        newPositionId: newUser.positionId,
        previousPositionId: null,
        reason: POSITION_CHANGE_REASON.ADMISSION,
        changedById: userId || null,
      });
    }

    // Registrar no changelog
    await logEntityChange({
      changeLogService: this.changeLogService,
      entityType: ENTITY_TYPE.USER,
      entityId: newUser.id,
      action: CHANGE_ACTION.CREATE,
      entity: newUser,
      reason: changelogReason ?? 'Novo usuário criado no sistema',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      userId: userId || null,
      transaction: tx,
    });

    // Refresh the returned user so the synced currentContract* cache is visible.
    const refreshed = await this.userRepository.findByIdWithTransaction(tx, newUser.id, {
      include,
    });
    return refreshed ?? newUser;
  }

  /**
   * Efeitos pós-commit da criação de usuário (preferências de notificação +
   * ponte Secullum). Chamado por create() e pelo AdmissionService DEPOIS que
   * a transação que criou o usuário foi confirmada. Nunca lança erro.
   */
  async runPostCreateSideEffects(user: {
    id: string;
    secullumSyncEnabled?: boolean | null;
  }): Promise<SecullumSyncResult | undefined> {
    // Initialize notification preferences (non-blocking)
    this.notificationPreferenceInitService
      .initializeForNewUser(user.id)
      .catch(err => this.logger.error('Failed to init notification preferences:', err));

    // Secullum bridge.
    //
    // For users with `secullumSyncEnabled = true` we `await` the bridge so
    // the result of the Secullum POST is visible to the web UI (toast).
    // The bridge is guaranteed never to throw — it always returns a
    // `SecullumSyncResult`. We still emit the event for any other listeners
    // (and to keep the contract consistent with the UPDATE path).
    let secullumSync: SecullumSyncResult | undefined;
    if (user.secullumSyncEnabled) {
      try {
        secullumSync = await this.userSecullumSyncService.onUserCreated({
          userId: user.id,
        });
      } catch (err) {
        // Defensive — onUserCreated already swallows everything, but if the
        // contract is ever violated we don't want user creation to fail.
        this.logger.error('Unexpected secullum sync throw:', err);
        secullumSync = {
          status: 'error',
          reason: (err as Error).message,
        };
      }
    }
    try {
      this.eventEmitter.emit(SECULLUM_USER_CREATED_EVENT, { userId: user.id });
    } catch (err) {
      this.logger.error('Failed to emit secullum.user.created:', err);
    }
    return secullumSync;
  }

  /**
   * Criar novo usuário
   */
  async create(
    data: UserCreateFormData,
    include?: UserInclude,
    userId?: string,
    avatarFile?: Express.Multer.File,
  ): Promise<UserCreateResponse> {
    try {
      const user = await this.prisma.$transaction(async (tx: PrismaTransaction) =>
        this.createWithinTransaction(tx, data, { include, userId, avatarFile }),
      );

      const secullumSync = await this.runPostCreateSideEffects(user);

      // Remove password from response
      const { password, ...userWithoutPassword } = user;
      const response: UserCreateResponse = {
        success: true,
        message: 'Usuário criado com sucesso',
        data: userWithoutPassword as User,
      };
      if (secullumSync) {
        (response as UserCreateResponse & { secullumSync?: SecullumSyncResult }).secullumSync =
          secullumSync;
      }
      return response;
    } catch (error: any) {
      this.logger.error('Erro ao criar usuário:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      // Handle Prisma unique constraint violations with Portuguese messages
      if (error.code === 'P2002') {
        const field = error.meta?.target?.[0];
        const fieldNames: Record<string, string> = {
          email: 'Email',
          phone: 'Telefone',
          cpf: 'CPF',
          pis: 'PIS',
          payrollNumber: 'Número da folha de pagamento',
          sessionToken: 'Token de sessão',
        };
        const fieldName = fieldNames[field] || field || 'Campo';
        throw new BadRequestException(`${fieldName} já está em uso.`);
      }

      throw new InternalServerErrorException(
        'Não foi possível criar o usuário. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar usuário
   */
  async update(
    id: string,
    data: UserUpdateFormData,
    include?: UserInclude,
    userId?: string,
    avatarFile?: Express.Multer.File,
  ): Promise<UserUpdateResponse> {
    try {
      const updatedUser = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar usuário existente com relações para o tracking
        const existingUser = await this.userRepository.findByIdWithTransaction(tx, id, {
          include: { position: true, sector: true, ppeSize: true, currentContract: true },
        });

        if (!existingUser) {
          throw new NotFoundException('Usuário não encontrado.');
        }

        // Security: privilege-escalation/account-takeover guards (audit B1/B8, decision 12)
        await this.enforceUserWriteGuards(
          userId,
          data,
          existingUser as unknown as {
            id: string;
            sectorId: string | null;
            positionId: string | null;
            currentContractType: string | null;
            performanceLevel: number;
          },
          tx,
        );

        // If the update will leave (or put) the user in secullumSyncEnabled=true,
        // re-validate Secullum prerequisites against the merged shape (existing
        // values + this update's overrides). Reject the update if any
        // mapping/field is missing — same contract as create().
        const willSyncAfter =
          (data as any).secullumSyncEnabled === true ||
          ((data as any).secullumSyncEnabled !== false &&
            (existingUser as { secullumSyncEnabled?: boolean }).secullumSyncEnabled === true);
        if (willSyncAfter) {
          await this.validateSecullumPrerequisites(
            {
              cpf: (data as any).cpf ?? existingUser.cpf,
              payrollNumber: (data as any).payrollNumber ?? existingUser.payrollNumber,
              admissionDate:
                (data as any).admissionDate ?? (existingUser as any).currentContract?.admissionDate,
              sectorId: (data as any).sectorId ?? existingUser.sectorId,
              positionId: (data as any).positionId ?? existingUser.positionId,
            },
            tx,
          );
        }

        const existingContractType = (existingUser as any).currentContractType as
          | CONTRACT_TYPE
          | null;
        const existingContractStatus = (existingUser as any).currentContractStatus as
          | CONTRACT_STATUS
          | null;

        // A termination date implies the contract status becomes TERMINATED.
        if (
          (data as any).terminationDate &&
          (data as any).contractStatus !== CONTRACT_STATUS.TERMINATED
        ) {
          (data as any).contractStatus = CONTRACT_STATUS.TERMINATED;
        }

        // Validate the contract STATUS transition (lifecycle machine) within the
        // current vínculo. Blocks illegal regressions (e.g. ACTIVE→EXPERIENCE).
        if (
          (data as any).contractStatus &&
          existingContractStatus &&
          (data as any).contractStatus !== existingContractStatus
        ) {
          if (
            !canTransitionContractStatus(
              existingContractStatus,
              (data as any).contractStatus as CONTRACT_STATUS,
            )
          ) {
            throw new BadRequestException(
              invalidContractStatusTransitionMessage(
                existingContractStatus,
                (data as any).contractStatus,
              ),
            );
          }
        }

        // Validate the contract MODALITY transition within the current vínculo.
        if (data.contractType && existingContractType && data.contractType !== existingContractType) {
          const transitionValidation = this.validateUserStatusTransition(
            existingContractType,
            data.contractType as CONTRACT_TYPE,
          );

          if (!transitionValidation.valid) {
            throw new BadRequestException(transitionValidation.error);
          }
        }

        // EmployeeType ↔ ContractType integrity over the resulting merged state.
        const resultingEmployeeType = ((data as any).employeeType ??
          (existingUser as any).currentEmployeeType) as EMPLOYEE_TYPE | null | undefined;
        const resultingContractType = (
          data.contractType !== undefined ? data.contractType : existingContractType
        ) as CONTRACT_TYPE | null;
        if (resultingEmployeeType) {
          const integrityError = validateEmployeeContractTypeIntegrity({
            employeeType: resultingEmployeeType,
            contractType: resultingContractType,
          });
          if (integrityError) {
            throw new BadRequestException(integrityError);
          }
        }

        // Validar usuário completo
        await this.userValidation(data, id, tx);

        // Check if name changed and rename folders accordingly
        if (data.name && data.name !== existingUser.name) {
          this.logger.log(
            `User name changed from "${existingUser.name}" to "${data.name}". Renaming folders...`,
          );

          try {
            const renameResult = await this.folderRenameService.renameUserFolders(
              existingUser.name,
              data.name,
              tx,
            );

            this.logger.log(
              `Folder rename complete for user "${existingUser.name}": ` +
                `${renameResult.totalFoldersRenamed} folders renamed, ` +
                `${renameResult.totalFilesUpdated} file paths updated`,
            );
          } catch (renameError: any) {
            this.logger.error(`Failed to rename user folders: ${renameError.message}`);
            throw new InternalServerErrorException(
              `Failed to rename user folders: ${renameError.message}. ` +
                `User update cancelled to maintain consistency.`,
            );
          }
        }

        // Hash da senha se fornecida
        if (data.password) {
          data.password = await bcrypt.hash(data.password, 10);
        }

        // Clear sessionToken when sectorId changes to force re-authentication with new privileges
        if (data.hasOwnProperty('sectorId') && existingUser.sectorId !== data.sectorId) {
          (data as any).sessionToken = null;
        }

        // Clear sessionToken when the collaborator is being dismissed (vínculo → TERMINATED)
        if (
          (data as any).contractStatus === CONTRACT_STATUS.TERMINATED &&
          (existingUser as any).currentContractStatus !== CONTRACT_STATUS.TERMINATED
        ) {
          (data as any).sessionToken = null;
        }

        // Process avatar file if provided
        let avatarId: string | null | undefined = data.avatarId;
        if (avatarFile) {
          try {
            // Delete old avatar file before uploading new one
            if (existingUser.avatarId) {
              try {
                await this.fileService.delete(existingUser.avatarId, userId);
                this.logger.log(`Deleted old avatar file: ${existingUser.avatarId}`);
              } catch (deleteError: any) {
                this.logger.warn(`Failed to delete old avatar: ${deleteError.message}`);
              }
            }

            // Process new avatar file
            avatarId = await this.processAvatarFile(avatarFile, id, existingUser.name, tx, userId);
          } catch (fileError: any) {
            this.logger.error(`Avatar file processing failed: ${fileError.message}`);
            if (existsSync(avatarFile.path)) {
              unlinkSync(avatarFile.path);
            }
            throw new BadRequestException('Erro ao processar arquivo de avatar.');
          }
        }

        // Handle isSectorLeader flag - update Sector.leaderId relationship
        const isSectorLeader = (data as any).isSectorLeader;
        const targetSectorId = data.sectorId ?? existingUser.sectorId;

        if (typeof isSectorLeader === 'boolean') {
          if (isSectorLeader && targetSectorId) {
            // Set this user as the leader of their sector
            await tx.sector.update({
              where: { id: targetSectorId },
              data: { leaderId: id },
            });
            this.logger.log(`User ${id} set as leader of sector ${targetSectorId}`);
          } else if (!isSectorLeader) {
            // Check if user was the leader of any sector and remove them
            const ledSector = await tx.sector.findFirst({
              where: { leaderId: id },
            });
            if (ledSector) {
              await tx.sector.update({
                where: { id: ledSector.id },
                data: { leaderId: null },
              });
              this.logger.log(`User ${id} removed as leader of sector ${ledSector.id}`);
            }
          }
        }

        // Prepare data for database update. Strip validation-only fields and
        // every CONTRACT-scoped field — those are applied to the current vínculo
        // (EmploymentContract), then mirrored back into the User cache by the sync.
        const {
          currentContractType: _ignoredCurrentContractType,
          isSectorLeader: _isSectorLeader,
          contractType: _contractType,
          contractStatus: _contractStatus,
          employeeType: _employeeType,
          admissionDate: _admissionDate,
          effectedAt: _effectedAt,
          exp1StartAt: _exp1StartAt,
          exp1EndAt: _exp1EndAt,
          exp2StartAt: _exp2StartAt,
          exp2EndAt: _exp2EndAt,
          terminationDate: _terminationDate,
          terminationType: _terminationType,
          // positionId/sectorId/payrollNumber stay on the User row (current
          // pointers) AND are propagated to the current contract below.
          ...dataForDb
        } = data as any;
        const dbUpdateData = avatarFile ? { ...dataForDb, avatarId } : dataForDb;

        // Prepare update data for tracking
        const updateData: any = { ...data };
        if (avatarFile) {
          updateData.avatarId = avatarId;
        }

        // Handle password separately for security
        if (data.password) {
          updateData.password = '[REDACTED]';
        }

        // Atualizar o usuário
        const updatedUser = await this.userRepository.updateWithTransaction(tx, id, dbUpdateData, {
          include,
        });

        // Histórico de cargo: fechar registro aberto + adicionar novo quando positionId muda
        if (
          data.hasOwnProperty('positionId') &&
          existingUser.positionId !== (updatedUser as any).positionId
        ) {
          await this.recordPositionHistory(tx, {
            userId: id,
            newPositionId: (updatedUser as any).positionId ?? null,
            previousPositionId: existingUser.positionId ?? null,
            reason: POSITION_CHANGE_REASON.ADJUSTMENT,
            changedById: userId || null,
          });
        }

        // Edita o vínculo (EmploymentContract) ATUAL quando algum campo de
        // contrato muda, e re-sincroniza o cache do User. Também propaga
        // position/sector/payrollNumber para o contrato atual.
        const currentContractId = (existingUser as any).currentContractId as string | null;
        const contractFieldsTouched =
          data.contractType !== undefined ||
          (data as any).contractStatus !== undefined ||
          data.employeeType !== undefined ||
          (data as any).admissionDate !== undefined ||
          (data as any).effectedAt !== undefined ||
          (data as any).exp1StartAt !== undefined ||
          (data as any).exp1EndAt !== undefined ||
          (data as any).exp2StartAt !== undefined ||
          (data as any).exp2EndAt !== undefined ||
          (data as any).terminationDate !== undefined ||
          (data as any).terminationType !== undefined ||
          data.hasOwnProperty('positionId') ||
          data.hasOwnProperty('sectorId') ||
          data.hasOwnProperty('payrollNumber');

        if (currentContractId && contractFieldsTouched) {
          const contractUpdate: any = {};
          if (data.contractType !== undefined) contractUpdate.contractType = data.contractType;
          if ((data as any).contractStatus !== undefined)
            contractUpdate.status = (data as any).contractStatus;
          if (data.employeeType !== undefined) contractUpdate.employeeType = data.employeeType;
          if ((data as any).admissionDate !== undefined)
            contractUpdate.admissionDate = (data as any).admissionDate;
          if ((data as any).effectedAt !== undefined)
            contractUpdate.effectedAt = (data as any).effectedAt;
          if ((data as any).exp1StartAt !== undefined)
            contractUpdate.exp1StartAt = (data as any).exp1StartAt;
          if ((data as any).exp1EndAt !== undefined)
            contractUpdate.exp1EndAt = (data as any).exp1EndAt;
          if ((data as any).exp2StartAt !== undefined)
            contractUpdate.exp2StartAt = (data as any).exp2StartAt;
          if ((data as any).exp2EndAt !== undefined)
            contractUpdate.exp2EndAt = (data as any).exp2EndAt;
          if ((data as any).terminationDate !== undefined)
            contractUpdate.terminationDate = (data as any).terminationDate;
          if ((data as any).terminationType !== undefined)
            contractUpdate.terminationType = (data as any).terminationType;
          if (data.hasOwnProperty('positionId'))
            contractUpdate.positionId = (updatedUser as any).positionId ?? null;
          if (data.hasOwnProperty('sectorId'))
            contractUpdate.sectorId = (updatedUser as any).sectorId ?? null;
          if (data.hasOwnProperty('payrollNumber'))
            contractUpdate.payrollNumber = (updatedUser as any).payrollNumber ?? null;

          await this.employmentContractService.updateWithTransaction(
            tx,
            currentContractId,
            contractUpdate,
            undefined,
            userId,
          );
        }

        // Track individual field changes
        const fieldsToTrack = [
          'name',
          'email',
          'phone',
          'cpf',
          'pis',
          'payrollNumber',
          'positionId',
          'performanceLevel',
          'sectorId',
          'verified',
          'isActive',
          'requirePasswordChange',
          'birth',
          'verificationCode',
          'verificationExpiresAt',
          'verificationType',
          'sessionToken',
          'lastLoginAt',
          'address',
          'addressNumber',
          'addressComplement',
          'neighborhood',
          'city',
          'state',
          'zipCode',
          'site',
        ];

        // Track regular fields
        const fieldsToActuallyTrack = fieldsToTrack.filter(
          field => field !== 'password' && data.hasOwnProperty(field),
        );
        if (fieldsToActuallyTrack.length > 0) {
          await trackAndLogFieldChanges({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.USER,
            entityId: id,
            oldEntity: existingUser,
            newEntity: updatedUser,
            fieldsToTrack: fieldsToActuallyTrack,
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            transaction: tx,
          });
        }

        // Track password change separately with redacted values
        if (data.password) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.USER,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'password',
            oldValue: '[REDACTED]',
            newValue: '[REDACTED]',
            reason: 'Senha atualizada',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
        }

        // Track PPE size changes
        if (data.ppeSize) {
          const oldPpeSize = existingUser.ppeSize;
          const newPpeSize = data.ppeSize;

          // Track each PPE size field individually
          const ppeSizeFields = [
            { field: 'shirts', label: 'Tamanho de camisetas' },
            { field: 'boots', label: 'Tamanho de botas' },
            { field: 'pants', label: 'Tamanho de calças' },
            { field: 'shorts', label: 'Tamanho de bermudas' },
            { field: 'sleeves', label: 'Tamanho de mangas' },
            { field: 'mask', label: 'Tamanho de máscara' },
            { field: 'gloves', label: 'Tamanho de luvas' },
            { field: 'rainBoots', label: 'Tamanho de botas de chuva' },
          ];

          for (const { field, label } of ppeSizeFields) {
            const oldValue = oldPpeSize?.[field];
            const newValue = newPpeSize[field];

            // Only log if the value actually changed (using proper comparison for null/undefined)
            if (hasValueChanged(oldValue, newValue)) {
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.USER,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: `ppeSize.${field}`,
                oldValue: oldValue || 'Não definido',
                newValue: newValue || 'Não definido',
                reason: `${label} atualizado`,
                triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                triggeredById: id,
                userId: userId || null,
                transaction: tx,
              });
            }
          }
        }

        // Re-fetch so the synced currentContract* cache + mirrors are reflected
        // in the returned user (the contract update above changes them).
        const refreshed = await this.userRepository.findByIdWithTransaction(tx, id, { include });
        return refreshed ?? updatedUser;
      });

      // Secullum bridge for the UPDATE path.
      //
      // Mirrors the CREATE path: always `await` the bridge and attach its
      // result to the response. The bridge is self-gating (returns a
      // 'skipped' status when sync isn't enabled or the user has no
      // secullumEmployeeId yet) and never throws. We don't rely on
      // updatedUser's scalar fields here because the controller may pass
      // an `include` shape that omits or restricts what Prisma returns —
      // letting the bridge re-fetch is the robust path.
      const dismissalJustHappened =
        (updatedUser as { currentContractStatus?: string | null }).currentContractStatus ===
        CONTRACT_STATUS.TERMINATED;
      this.logger.log(
        `[secullum-update] invoking bridge for user ${id} (dismissalJustHappened=${dismissalJustHappened})`,
      );
      let secullumSync: SecullumSyncResult | undefined;
      try {
        secullumSync = await this.userSecullumSyncService.onUserUpdated({
          userId: id,
          dismissalJustHappened,
        });
        this.logger.log(
          `[secullum-update] bridge result for user ${id}: ${JSON.stringify(secullumSync)}`,
        );
      } catch (err) {
        // Defensive — onUserUpdated already swallows everything internally.
        this.logger.error('Unexpected secullum sync throw:', err);
        secullumSync = {
          status: 'error',
          reason: (err as Error).message,
        };
      }
      // Always emit the event too — keeps the contract for any other
      // listeners that might care about user updates.
      try {
        this.eventEmitter.emit(SECULLUM_USER_UPDATED_EVENT, {
          userId: id,
          dismissalJustHappened,
        });
      } catch (err) {
        this.logger.error('Failed to emit secullum.user.updated:', err);
      }

      // Remove password from response
      const { password, ...userWithoutPassword } = updatedUser;
      const response: UserUpdateResponse = {
        success: true,
        message: 'Usuário atualizado com sucesso',
        data: userWithoutPassword as User,
      };
      if (secullumSync) {
        (response as UserUpdateResponse & { secullumSync?: SecullumSyncResult }).secullumSync =
          secullumSync;
      }
      return response;
    } catch (error: any) {
      this.logger.error('Erro ao atualizar usuário:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      // Handle Prisma unique constraint violations with Portuguese messages
      if (error.code === 'P2002') {
        const field = error.meta?.target?.[0];
        const fieldNames: Record<string, string> = {
          email: 'Email',
          phone: 'Telefone',
          cpf: 'CPF',
          pis: 'PIS',
          payrollNumber: 'Número da folha de pagamento',
          sessionToken: 'Token de sessão',
        };
        const fieldName = fieldNames[field] || field || 'Campo';
        throw new BadRequestException(`${fieldName} já está em uso.`);
      }

      throw new InternalServerErrorException(
        'Não foi possível atualizar o usuário. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir usuário
   */
  async delete(id: string, userId?: string): Promise<UserDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const user = await this.userRepository.findByIdWithTransaction(tx, id);

        if (!user) {
          throw new NotFoundException('Usuário não encontrado.');
        }

        // Registrar exclusão
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.USER,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: user,
          reason: 'Usuário excluído do sistema',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await this.userRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Usuário excluído com sucesso',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir usuário:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir usuário. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar múltiplos usuários
   */
  async batchCreate(
    data: UserBatchCreateFormData,
    include?: UserInclude,
    userId?: string,
  ): Promise<UserBatchCreateResponse<UserCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const { users } = data;

        // Validar cada usuário individualmente antes de processar
        const errors: Array<{ index: number; error: string }> = [];
        const validUsers: Array<{ index: number; data: UserCreateFormData }> = [];

        for (let i = 0; i < users.length; i++) {
          try {
            const user = users[i];
            // Security: privilege-escalation guards (audit B1, decision 12)
            await this.enforceUserWriteGuards(userId, user, null, tx);
            await this.userValidation(user, undefined, tx);
            validUsers.push({ index: i, data: user });
          } catch (error) {
            errors.push({
              index: i,
              error:
                error instanceof BadRequestException ||
                error instanceof NotFoundException ||
                error instanceof ForbiddenException
                  ? error.message
                  : 'Erro ao validar usuário.',
            });
          }
        }

        // Se todos falharam na validação, retornar erro
        if (validUsers.length === 0) {
          return {
            success: [],
            failed: errors.map(e => ({
              ...e,
              id: undefined,
              errorCode: 'VALIDATION_ERROR',
              data: users[e.index],
            })),
            totalCreated: 0,
            totalFailed: errors.length,
          };
        }

        // Cria cada usuário válido pelo MESMO caminho do POST /users
        // (createWithinTransaction): cria o primeiro vínculo, sincroniza o cache,
        // registra histórico de cargo e changelog. Tudo dentro desta transação.
        const created: any[] = [];
        const createFailed: any[] = [];
        for (const { index, data } of validUsers) {
          try {
            const newUser = await this.createWithinTransaction(tx, data, {
              include,
              userId,
              changelogReason: 'Usuário criado em lote',
            });
            created.push(newUser);
          } catch (error: any) {
            createFailed.push({
              index,
              id: undefined,
              error:
                error instanceof BadRequestException ||
                error instanceof NotFoundException ||
                error instanceof ForbiddenException
                  ? error.message
                  : error.message || 'Erro ao criar usuário.',
              errorCode: 'CREATE_ERROR',
              data: users[index],
            });
          }
        }

        const finalResult = {
          success: created,
          failed: [
            ...errors.map(e => ({
              index: e.index,
              id: undefined,
              error: e.error,
              errorCode: 'VALIDATION_ERROR',
              data: users[e.index],
            })),
            ...createFailed,
          ],
          totalCreated: created.length,
          totalFailed: errors.length + createFailed.length,
        };

        return finalResult;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 usuário criado com sucesso'
          : `${result.totalCreated} usuários criados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult format and remove passwords
      const batchOperationResult = {
        success: result.success.map(({ password, ...user }) => user as User),
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
    } catch (error: any) {
      this.logger.error('Erro na criação em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar usuários em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplos usuários
   */
  async batchUpdate(
    data: UserBatchUpdateFormData,
    include?: UserInclude,
    userId?: string,
  ): Promise<UserBatchUpdateResponse<UserUpdateFormData>> {
    // Each update goes through the single-user update() path so the current
    // vínculo (EmploymentContract) edit + cache sync + changelog all happen
    // consistently per user (each in its own transaction).
    const success: any[] = [];
    const failed: any[] = [];

    for (const [index, update] of data.users.entries()) {
      try {
        const res = await this.update(update.id, update.data, include, userId);
        if (res.data) success.push(res.data);
      } catch (error: any) {
        failed.push({
          index,
          id: update.id,
          error: error.message || 'Erro ao atualizar usuário',
          errorCode:
            error instanceof BadRequestException ||
            error instanceof NotFoundException ||
            error instanceof ForbiddenException
              ? 'VALIDATION_ERROR'
              : 'UPDATE_ERROR',
          data: { ...update.data, id: update.id },
        });
      }
    }

    const successMessage =
      success.length === 1
        ? '1 usuário atualizado com sucesso'
        : `${success.length} usuários atualizados com sucesso`;
    const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

    return {
      success: true,
      message: `${successMessage}${failureMessage}`,
      data: {
        success: success.map(({ password, ...user }) => user as User),
        failed,
        totalProcessed: success.length + failed.length,
        totalSuccess: success.length,
        totalFailed: failed.length,
      },
    };
  }


  /**
   * Excluir múltiplos usuários
   */
  async batchDelete(
    data: UserBatchDeleteFormData,
    userId?: string,
  ): Promise<UserBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar usuários antes de excluir para o changelog
        const users = await this.userRepository.findByIdsWithTransaction(tx, data.userIds);

        // Registrar exclusões
        for (const user of users) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.USER,
            entityId: user.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: user,
            reason: 'Usuário excluído em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return this.userRepository.deleteManyWithTransaction(tx, data.userIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 usuário excluído com sucesso'
          : `${result.totalDeleted} usuários excluídos com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult format
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
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir usuários em lote. Por favor, tente novamente.',
      );
    }
  }

  async merge(
    data: UserMergeFormData,
    include?: UserInclude,
    userId?: string,
  ): Promise<UserMergeResponse> {
    try {
      const mergedUser = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // 1. Fetch target user and source users
        const targetUser = await tx.user.findUnique({
          where: { id: data.targetUserId },
          include: {
            createdTasks: true,
          },
        });

        if (!targetUser) {
          throw new NotFoundException(`Usuário alvo com ID ${data.targetUserId} não encontrado`);
        }

        const sourceUsers = await tx.user.findMany({
          where: { id: { in: data.sourceUserIds } },
          include: {
            createdTasks: true,
          },
        });

        if (sourceUsers.length !== data.sourceUserIds.length) {
          const foundIds = sourceUsers.map(u => u.id);
          const missingIds = data.sourceUserIds.filter(id => !foundIds.includes(id));
          throw new NotFoundException(
            `Usuários de origem não encontrados: ${missingIds.join(', ')}`,
          );
        }

        // 2. Merge tasks - move all created tasks from source users to target
        for (const sourceUser of sourceUsers) {
          if (sourceUser.createdTasks.length > 0) {
            await tx.task.updateMany({
              where: { createdById: sourceUser.id },
              data: { createdById: data.targetUserId },
            });
          }
        }

        // 3. Merge activities
        for (const sourceUser of sourceUsers) {
          await tx.activity.updateMany({
            where: { userId: sourceUser.id },
            data: { userId: data.targetUserId },
          });
        }

        // 4. Merge borrows
        for (const sourceUser of sourceUsers) {
          await tx.borrow.updateMany({
            where: { userId: sourceUser.id },
            data: { userId: data.targetUserId },
          });
        }

        // 6. Merge warnings (both as collaborator and supervisor)
        for (const sourceUser of sourceUsers) {
          // Update warnings where source user is the collaborator
          await tx.warning.updateMany({
            where: { collaboratorId: sourceUser.id },
            data: { collaboratorId: data.targetUserId },
          });
          // Update warnings where source user is the supervisor
          await tx.warning.updateMany({
            where: { supervisorId: sourceUser.id },
            data: { supervisorId: data.targetUserId },
          });
        }

        // 7. Merge PPE deliveries
        for (const sourceUser of sourceUsers) {
          await tx.ppeDelivery.updateMany({
            where: { userId: sourceUser.id },
            data: { userId: data.targetUserId },
          });
        }

        // 8. Merge notifications (created by user)
        for (const sourceUser of sourceUsers) {
          await tx.notification.updateMany({
            where: { userId: sourceUser.id },
            data: { userId: data.targetUserId },
          });
        }

        // 9. Merge seen notifications
        for (const sourceUser of sourceUsers) {
          await tx.seenNotification.updateMany({
            where: { userId: sourceUser.id },
            data: { userId: data.targetUserId },
          });
        }

        // 9.5. Merge physical file directories from source users into target
        const sourceUserNames = sourceUsers.map(u => u.name);
        try {
          const mergeResult = await this.folderRenameService.mergeEntityFolders(
            'Colaboradores',
            sourceUserNames,
            targetUser.name,
            tx,
          );
          if (mergeResult.errors.length > 0) {
            this.logger.warn(
              `User file folder merge had ${mergeResult.errors.length} errors: ${mergeResult.errors.slice(0, 3).join('; ')}`,
            );
          }
          this.logger.log(
            `Merged ${mergeResult.totalFilesMoved} files from ${sourceUserNames.join(', ')} into ${targetUser.name}`,
          );
        } catch (folderError: any) {
          this.logger.error(`Failed to merge user file folders: ${folderError.message}`);
        }

        // 10. Delete source users BEFORE updating target to avoid unique constraint conflicts
        for (const sourceUser of sourceUsers) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.USER,
            entityId: sourceUser.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: sourceUser,
            reason: `Usuário removido após mesclagem com ${targetUser.name}`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            userId: userId || null,
            transaction: tx,
          });

          await tx.user.delete({
            where: { id: sourceUser.id },
          });
        }

        // 11. Apply conflict resolutions to target user
        const updateData: any = {};
        if (data.conflictResolutions) {
          Object.keys(data.conflictResolutions).forEach(field => {
            updateData[field] = data.conflictResolutions![field];
          });
        }

        // Server-only fields that the merge UI must never overwrite, even if
        // the client puts them in conflictResolutions. `secullumEmployeeId`
        // is the FK to the Secullum Funcionario row — losing it breaks
        // historical bonus/ponto/payroll resolution. `secullumSyncEnabled`
        // is the toggle that drives the bridge — flipping it via merge
        // would silently disable sync. Both are managed elsewhere.
        delete updateData.secullumEmployeeId;
        delete updateData.secullumSyncEnabled;

        if (Object.keys(updateData).length > 0) {
          await tx.user.update({
            where: { id: data.targetUserId },
            data: updateData,
          });

          // Histórico de cargo quando a mesclagem altera o positionId do usuário alvo
          if (
            updateData.positionId !== undefined &&
            updateData.positionId !== targetUser.positionId
          ) {
            await this.recordPositionHistory(tx, {
              userId: data.targetUserId,
              newPositionId: updateData.positionId ?? null,
              previousPositionId: targetUser.positionId ?? null,
              reason: POSITION_CHANGE_REASON.ADJUSTMENT,
              changedById: userId || null,
              note: 'Cargo definido durante mesclagem de usuários',
            });
          }
        }

        // 12. Log the merge operation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.USER,
          entityId: data.targetUserId,
          action: CHANGE_ACTION.UPDATE,
          entity: targetUser,
          reason: `Usuário mesclado com ${sourceUsers.length} outro(s) usuário(s): ${sourceUsers.map(u => u.name).join(', ')}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        // 13. Return the merged user
        const mergedUser = await this.userRepository.findByIdWithTransaction(
          tx,
          data.targetUserId,
          { include },
        );

        return mergedUser;
      });

      const { password, ...userWithoutPassword } = mergedUser;
      return {
        success: true,
        message: `${data.sourceUserIds.length + 1} usuários mesclados com sucesso.`,
        data: userWithoutPassword as User,
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao mesclar usuários:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao mesclar usuários. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Automatically advance experiência by DATES when phases end. Called daily.
   *
   * With the Part-A taxonomy, experiência is the SITUAÇÃO `status=EXPERIENCE`
   * (modality stays e.g. FIXED_TERM); phase 1 vs 2 is tracked by the optional
   * `experiencePhase` marker and the exp1/exp2 phase dates. Transitions:
   * - phase 1 → phase 2 (when exp1EndAt passed): set experiencePhase=2,
   *   exp2StartAt; status stays EXPERIENCE.
   * - efetivação (when exp2EndAt passed): status EXPERIENCE → ACTIVE,
   *   contractType → INDETERMINATE, set effectedAt.
   */
  async processExperiencePeriodTransitions(userId: string | null = null): Promise<{
    totalProcessed: number;
    exp1ToExp2: number;
    exp2ToEffected: number;
    errors: Array<{ userId: string; error: string }>;
  }> {
    this.logger.log('Starting automatic experience period status transitions...');

    const result = {
      totalProcessed: 0,
      exp1ToExp2: 0,
      exp2ToEffected: 0,
      errors: [] as Array<{ userId: string; error: string }>,
    };

    try {
      // Get today's date at start of day (midnight)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get tomorrow's date at start of day to create a range for "today"
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Find CURRENT contracts in EXPERIENCE still in phase 1 (experiencePhase=1
      // or unset/derived) whose exp1 ended today or earlier, and which have NOT
      // yet reached exp2EndAt (otherwise they go straight to efetivação below).
      const contractsEndingExp1 = await this.prisma.employmentContract.findMany({
        where: {
          isCurrent: true,
          status: CONTRACT_STATUS.EXPERIENCE,
          exp1EndAt: { lt: tomorrow },
          OR: [{ experiencePhase: { not: 2 } }, { experiencePhase: null }],
          ...(userId ? { userId } : {}),
        },
        include: { user: { select: { id: true, name: true } } },
      });

      this.logger.log(
        `Found ${contractsEndingExp1.length} contracts with Experience Period 1 ended (pending transition)`,
      );

      // Advance phase 1 → phase 2 (status stays EXPERIENCE).
      for (const contract of contractsEndingExp1) {
        try {
          await this.prisma.$transaction(async (tx: PrismaTransaction) => {
            await tx.employmentContract.update({
              where: { id: contract.id },
              data: {
                experiencePhase: 2,
                exp2StartAt: contract.exp2StartAt || today,
              },
            });

            await this.employmentContractService.syncUserCurrentContract(tx, contract.userId, {
              userId: userId ?? undefined,
            });

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.USER,
              entityId: contract.userId,
              action: CHANGE_ACTION.UPDATE,
              field: 'experiencePhase',
              oldValue: contract.experiencePhase?.toString() ?? '1',
              newValue: '2',
              reason: 'Transição automática: Período de Experiência 1 finalizado',
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              triggeredById: contract.userId,
              userId: userId,
              transaction: tx,
            });

            this.logger.log(
              `Contract for ${contract.user?.name} (${contract.userId}) advanced from experiência fase 1 to fase 2`,
            );
          });

          result.exp1ToExp2++;
          result.totalProcessed++;
        } catch (error: any) {
          this.logger.error(
            `Failed to advance contract ${contract.id} from experiência fase 1 to fase 2:`,
            error,
          );
          result.errors.push({
            userId: contract.userId,
            error: error.message || 'Unknown error during exp1->exp2 transition',
          });
        }
      }

      // Find CURRENT contracts in EXPERIENCE whose exp2 ended today or earlier
      // → efetivação (status EXPERIENCE → ACTIVE, modality → INDETERMINATE).
      const contractsEndingExp2 = await this.prisma.employmentContract.findMany({
        where: {
          isCurrent: true,
          status: CONTRACT_STATUS.EXPERIENCE,
          exp2EndAt: { lt: tomorrow },
          ...(userId ? { userId } : {}),
        },
        include: {
          user: { select: { id: true, name: true, positionId: true, performanceLevel: true } },
          position: true,
        },
      });

      this.logger.log(
        `Found ${contractsEndingExp2.length} contracts with Experience Period 2 ended (pending transition)`,
      );

      // Transition contracts from exp2 to effected
      for (const contract of contractsEndingExp2) {
        const user = {
          id: contract.userId,
          name: contract.user?.name,
          position: (contract as any).position,
          positionId: contract.positionId,
          performanceLevel: contract.user?.performanceLevel,
        };
        try {
          await this.prisma.$transaction(async (tx: PrismaTransaction) => {
            // Find the next position in the hierarchy (lowest hierarchy value greater than current).
            // Hierarchy convention: higher number = above (more senior).
            let nextPosition: { id: string; name: string; hierarchy: number | null } | null = null;
            if (
              user.position &&
              user.position.hierarchy !== null &&
              user.position.hierarchy !== undefined
            ) {
              nextPosition = await tx.position.findFirst({
                where: {
                  hierarchy: { gt: user.position.hierarchy },
                },
                orderBy: { hierarchy: 'asc' },
                select: { id: true, name: true, hierarchy: true },
              });
            }

            const shouldPromote = nextPosition !== null;

            // Efetivação (CLT art. 451): status → ACTIVE, modalidade →
            // INDETERMINATE, grava effectedAt (e promove o cargo se houver
            // hierarquia superior).
            await tx.employmentContract.update({
              where: { id: contract.id },
              data: {
                status: CONTRACT_STATUS.ACTIVE,
                statusOrder: CONTRACT_STATUS_ORDER[CONTRACT_STATUS.ACTIVE],
                contractType: CONTRACT_TYPE.INDETERMINATE,
                effectedAt: today,
                ...(shouldPromote && { positionId: nextPosition!.id }),
              },
            });

            // Performance level + position promotion live on the User.
            await tx.user.update({
              where: { id: user.id },
              data: {
                performanceLevel: 3,
                ...(shouldPromote && { positionId: nextPosition!.id }),
                updatedAt: new Date(),
              },
            });

            await this.employmentContractService.syncUserCurrentContract(tx, user.id, {
              userId: userId ?? undefined,
            });

            // Log the status change (efetivação)
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.USER,
              entityId: user.id,
              action: CHANGE_ACTION.UPDATE,
              field: 'currentContractStatus',
              oldValue: CONTRACT_STATUS.EXPERIENCE,
              newValue: CONTRACT_STATUS.ACTIVE,
              reason: 'Transição automática: Período de Experiência 2 finalizado (efetivação)',
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              triggeredById: user.id,
              userId: userId,
              transaction: tx,
            });

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.USER,
              entityId: user.id,
              action: CHANGE_ACTION.UPDATE,
              field: 'performanceLevel',
              oldValue: user.performanceLevel?.toString() ?? null,
              newValue: '3',
              reason: 'Nível de desempenho inicial definido na efetivação automática',
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              triggeredById: user.id,
              userId: userId,
              transaction: tx,
            });

            if (shouldPromote) {
              // Histórico de cargo: promoção automática na efetivação
              await this.recordPositionHistory(tx, {
                userId: user.id,
                newPositionId: nextPosition!.id,
                previousPositionId: user.positionId ?? null,
                reason: POSITION_CHANGE_REASON.PROMOTION,
                changedById: userId,
                note: 'Promoção automática: efetivação após período de experiência',
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              });

              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.USER,
                entityId: user.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'positionId',
                oldValue: user.positionId,
                newValue: nextPosition!.id,
                reason: `Promoção automática: efetivação após período de experiência (${user.position!.name} → ${nextPosition!.name})`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
                triggeredById: user.id,
                userId: userId,
                transaction: tx,
              });

              this.logger.log(
                `User ${user.name} (${user.id}) transitioned from EXP2 to EFFECTED and promoted from ${user.position!.name} (hierarchy ${user.position!.hierarchy}) to ${nextPosition!.name} (hierarchy ${nextPosition!.hierarchy})`,
              );
            } else {
              const reason = !user.position
                ? 'usuário sem cargo atribuído'
                : user.position.hierarchy === null || user.position.hierarchy === undefined
                  ? 'cargo atual sem hierarquia definida'
                  : 'nenhum cargo com hierarquia superior encontrado';
              this.logger.warn(
                `User ${user.name} (${user.id}) transitioned from EXP2 to EFFECTED but was NOT promoted: ${reason}`,
              );
            }
          });

          result.exp2ToEffected++;
          result.totalProcessed++;
        } catch (error: any) {
          this.logger.error(`Failed to transition user ${user.id} from EXP2 to EFFECTED:`, error);
          result.errors.push({
            userId: user.id,
            error: error.message || 'Unknown error during exp2->effected transition',
          });
        }
      }

      this.logger.log(
        `Experience period transitions completed. Total processed: ${result.totalProcessed}, ` +
          `EXP1->EXP2: ${result.exp1ToExp2}, EXP2->EFFECTED: ${result.exp2ToEffected}, ` +
          `Errors: ${result.errors.length}`,
      );

      return result;
    } catch (error: any) {
      this.logger.error('Failed to process experience period transitions:', error);
      throw new InternalServerErrorException(
        'Erro ao processar transições de período de experiência. Por favor, tente novamente.',
      );
    }
  }
}
