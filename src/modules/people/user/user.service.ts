// user.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
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
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
  hasValueChanged,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_TRIGGERED_BY,
  USER_STATUS,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../../constants/enums';
import { USER_STATUS_ORDER } from '../../../constants/sortOrders';
import { isValidCPF, isValidPIS, isValidPhone } from '../../../utils';
import { FileService } from '@modules/common/file/file.service';
import { FolderRenameService } from '@modules/common/file/services/folder-rename.service';
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
  ) {}

  /**
   * Calculate status-specific dates based on exp1StartAt
   * Each experience period is 45 days
   */
  private calculateStatusDates(data: Partial<UserCreateFormData | UserUpdateFormData>): void {
    // If exp1StartAt is provided, calculate the experience period dates
    if (data.exp1StartAt) {
      const exp1Start = new Date(data.exp1StartAt);

      // Calculate exp1EndAt (45 days after start) if not provided
      if (!data.exp1EndAt) {
        const exp1End = new Date(exp1Start);
        exp1End.setDate(exp1End.getDate() + 45);
        (data as any).exp1EndAt = exp1End;
      }

      // Calculate exp2StartAt (day after exp1 ends) if not provided
      if (!data.exp2StartAt) {
        const exp2Start = new Date(exp1Start);
        exp2Start.setDate(exp2Start.getDate() + 46); // Day after exp1 ends
        (data as any).exp2StartAt = exp2Start;
      }

      // Calculate exp2EndAt (45 days after exp2 starts) if not provided
      if (!data.exp2EndAt) {
        const exp2End = new Date(exp1Start);
        exp2End.setDate(exp2End.getDate() + 90); // 45 days for exp1 + 45 for exp2
        (data as any).exp2EndAt = exp2End;
      }
    }
  }

  /**
   * Set initial status timestamps for new users
   */
  private setInitialStatusTimestamps(
    data: Partial<UserCreateFormData | UserUpdateFormData>,
    status: USER_STATUS,
  ): void {
    const now = new Date();

    switch (status) {
      case USER_STATUS.EXPERIENCE_PERIOD_1:
        // Set exp1StartAt if not provided
        if (!data.exp1StartAt) {
          (data as any).exp1StartAt = now;
        }
        // Calculate all experience dates based on exp1StartAt
        this.calculateStatusDates(data);
        break;

      case USER_STATUS.EXPERIENCE_PERIOD_2:
        // If exp2StartAt is not provided, set it to now
        if (!data.exp2StartAt) {
          (data as any).exp2StartAt = now;
        }
        // If exp2EndAt is not provided, calculate it (45 days from exp2StartAt)
        if (!data.exp2EndAt) {
          const exp2End = new Date(data.exp2StartAt || now);
          exp2End.setDate(exp2End.getDate() + 45);
          (data as any).exp2EndAt = exp2End;
        }
        break;

      case USER_STATUS.EFFECTED:
        // Set effectedAt (exp1StartAt) if not provided
        // Note: effectedAt field will be kept for now but represents the actual contract date (exp1StartAt)
        if (!data.effectedAt) {
          (data as any).effectedAt = now;
        }
        break;

      case USER_STATUS.DISMISSED:
        // Set dismissedAt if not provided
        if (!data.dismissedAt) {
          (data as any).dismissedAt = now;
        }
        break;
    }
  }

  /**
   * Validar usuário completo
   */
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

    // Note: managedSector is now handled via Sector.managerId relation
    // The business logic for sector management should be handled in the Sector service

    // Validar que ao atualizar status para DISMISSED, o usuário não tenha pendências
    if (isUpdate && (data.status as USER_STATUS) === USER_STATUS.DISMISSED) {
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
            in: ['PENDING', 'IN_PRODUCTION', 'ON_HOLD'],
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
      const { page, limit, take, skip, where, orderBy, include: queryInclude, ...filters } = query;
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

      // Handle status - check if it's an array or single value
      if (filters.status !== undefined) {
        if (Array.isArray(filters.status)) {
          // If it's an array, use 'in' operator
          finalWhere.status = filters.status.length > 0 ? { in: filters.status } : undefined;
        } else {
          // If it's a single value, assign directly
          finalWhere.status = filters.status;
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
      if (filters.statuses && filters.statuses.length > 0) {
        finalWhere.status = { in: filters.statuses };
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
      if (filters.hasVacations !== undefined) {
        finalWhere.vacations = filters.hasVacations ? { some: {} } : { none: {} };
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
   * Validar transição de status do usuário
   * Baseado nas regras da CLT (Consolidação das Leis do Trabalho) brasileira
   */
  private validateUserStatusTransition(
    currentStatus: USER_STATUS,
    newStatus: USER_STATUS,
  ): { valid: boolean; error?: string } {
    // Define valid transitions according to Brazilian employment law (CLT)
    const validTransitions: Record<USER_STATUS, USER_STATUS[]> = {
      // Primeiro período de experiência (45 dias)
      [USER_STATUS.EXPERIENCE_PERIOD_1]: [
        USER_STATUS.EXPERIENCE_PERIOD_2, // Progride para segundo período
        USER_STATUS.EFFECTED, // Pode ser efetivado diretamente
        USER_STATUS.DISMISSED, // Pode ser demitido
      ],
      // Segundo período de experiência (45 dias)
      [USER_STATUS.EXPERIENCE_PERIOD_2]: [
        USER_STATUS.EFFECTED, // Progride para efetivado
        USER_STATUS.DISMISSED, // Pode ser demitido
      ],
      // Efetivado (contratado permanente)
      [USER_STATUS.EFFECTED]: [
        USER_STATUS.DISMISSED, // Pode ser demitido
        // Note: CANNOT go back to experience periods per Brazilian law
      ],
      // Demitido (status final)
      [USER_STATUS.DISMISSED]: [
        // No transitions allowed from dismissed status
        // Would require a new hiring process (new user record)
      ],
    };

    // Allow staying in same status
    if (currentStatus === newStatus) {
      return { valid: true };
    }

    const allowedTransitions = validTransitions[currentStatus] || [];

    if (!allowedTransitions.includes(newStatus)) {
      return {
        valid: false,
        error: `Transição de status inválida: não é possível mudar de ${currentStatus} para ${newStatus} de acordo com a CLT`,
      };
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
   * Criar novo usuário
   */
  async create(
    data: UserCreateFormData,
    include?: UserInclude,
    userId?: string,
    avatarFile?: Express.Multer.File,
  ): Promise<UserCreateResponse> {
    try {
      const user = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar usuário completo
        await this.userValidation(data, undefined, tx);

        // Set default status to EXPERIENCE_PERIOD_1 if not provided (Brazilian CLT standard)
        if (!data.status) {
          (data as any).status = USER_STATUS.EXPERIENCE_PERIOD_1;
        }

        // Hash da senha se fornecida
        if (data.password) {
          data.password = await bcrypt.hash(data.password, 10);
        }

        // Set statusOrder based on status
        const status = (data.status as USER_STATUS) || USER_STATUS.EXPERIENCE_PERIOD_1;
        (data as any).statusOrder = USER_STATUS_ORDER[status];

        // Set initial status timestamps and calculate dates
        this.setInitialStatusTimestamps(data, status);

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

        // Extract isSectorLeader before creating user (it's not a database field on User)
        const isSectorLeader = (data as any).isSectorLeader;
        const { isSectorLeader: _isSectorLeader, ...createData } = data as any;

        // Criar o usuário
        const newUser = await this.userRepository.createWithTransaction(
          tx,
          { ...createData, avatarId },
          { include },
        );

        // Handle isSectorLeader flag - update Sector.managerId relationship
        if (isSectorLeader && createData.sectorId) {
          await tx.sector.update({
            where: { id: createData.sectorId },
            data: { managerId: newUser.id },
          });
          this.logger.log(`New user ${newUser.id} set as manager of sector ${createData.sectorId}`);
        }

        // Registrar no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.USER,
          entityId: newUser.id,
          action: CHANGE_ACTION.CREATE,
          entity: newUser,
          reason: 'Novo usuário criado no sistema',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newUser;
      });

      // Remove password from response
      const { password, ...userWithoutPassword } = user;
      return {
        success: true,
        message: 'Usuário criado com sucesso',
        data: userWithoutPassword as User,
      };
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
          include: { position: true, sector: true, ppeSize: true },
        });

        if (!existingUser) {
          throw new NotFoundException('Usuário não encontrado.');
        }

        // Business logic BEFORE saving: Handle dismissedAt date and status relationship
        // If dismissedAt date is provided and status is not DISMISSED, automatically set status to DISMISSED
        if (data.dismissedAt && (!data.status || data.status !== USER_STATUS.DISMISSED)) {
          this.logger.log(
            `Dismissal date provided for user ${id}. Automatically setting status to DISMISSED.`,
          );
          (data as any).status = USER_STATUS.DISMISSED;
        }

        // If status is being set to DISMISSED and dismissedAt is null, automatically set dismissedAt
        if (
          data.status === USER_STATUS.DISMISSED &&
          !data.dismissedAt &&
          !existingUser.dismissedAt
        ) {
          this.logger.log(
            `Status being set to DISMISSED for user ${id}. Automatically setting dismissedAt to now.`,
          );
          (data as any).dismissedAt = new Date();
        }

        // Validate status transition
        if (data.status && data.status !== existingUser.status) {
          const transitionValidation = this.validateUserStatusTransition(
            existingUser.status as USER_STATUS,
            data.status as USER_STATUS,
          );

          if (!transitionValidation.valid) {
            throw new BadRequestException(transitionValidation.error);
          }
        }

        // Prevent EFFECTED users from being set to experience periods (additional check)
        if (
          existingUser.status === USER_STATUS.EFFECTED &&
          data.status &&
          (data.status === USER_STATUS.EXPERIENCE_PERIOD_1 ||
            data.status === USER_STATUS.EXPERIENCE_PERIOD_2)
        ) {
          throw new BadRequestException(
            'Colaboradores efetivados não podem ser alterados para períodos de experiência conforme a CLT.',
          );
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

        // Set statusOrder when status changes
        if (data.status && data.status !== existingUser.status) {
          (data as any).statusOrder = USER_STATUS_ORDER[data.status as USER_STATUS];
          // Track status timestamps when status changes
          this.setInitialStatusTimestamps(data, data.status as USER_STATUS);
        } else if (data.exp1StartAt) {
          // If exp1StartAt is being updated without status change, recalculate dates
          this.calculateStatusDates(data);
        }

        // Clear sessionToken when sectorId changes to force re-authentication with new privileges
        if (data.hasOwnProperty('sectorId') && existingUser.sectorId !== data.sectorId) {
          (data as any).sessionToken = null;
        }

        // Clear sessionToken when user is dismissed
        if (
          data.status === USER_STATUS.DISMISSED &&
          existingUser.status !== USER_STATUS.DISMISSED
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

        // Handle isSectorLeader flag - update Sector.managerId relationship
        const isSectorLeader = (data as any).isSectorLeader;
        const targetSectorId = data.sectorId ?? existingUser.sectorId;

        if (typeof isSectorLeader === 'boolean') {
          if (isSectorLeader && targetSectorId) {
            // Set this user as the manager of their sector
            await tx.sector.update({
              where: { id: targetSectorId },
              data: { managerId: id },
            });
            this.logger.log(`User ${id} set as manager of sector ${targetSectorId}`);
          } else if (!isSectorLeader) {
            // Check if user was the manager of any sector and remove them
            const managedSector = await tx.sector.findFirst({
              where: { managerId: id },
            });
            if (managedSector) {
              await tx.sector.update({
                where: { id: managedSector.id },
                data: { managerId: null },
              });
              this.logger.log(`User ${id} removed as manager of sector ${managedSector.id}`);
            }
          }
        }

        // Prepare data for database update
        // Remove currentStatus, isSectorLeader (validation-only fields) and other non-database fields
        const { currentStatus, isSectorLeader: _isSectorLeader, ...dataForDb } = data as any;
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

        // Track individual field changes
        const fieldsToTrack = [
          'name',
          'email',
          'phone',
          'cpf',
          'pis',
          'payrollNumber',
          'status',
          'statusOrder',
          'positionId',
          'performanceLevel',
          'sectorId',
          'verified',
          'requirePasswordChange',
          'birth',
          'dismissedAt', // Track dismissal date changes
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

        return updatedUser;
      });

      // Remove password from response
      const { password, ...userWithoutPassword } = updatedUser;
      return {
        success: true,
        message: 'Usuário atualizado com sucesso',
        data: userWithoutPassword as User,
      };
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
            await this.userValidation(user, undefined, tx);
            validUsers.push({ index: i, data: user });
          } catch (error) {
            errors.push({
              index: i,
              error:
                error instanceof BadRequestException || error instanceof NotFoundException
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

        // Hash das senhas e configurar timestamps de status para todos os usuários válidos
        const usersWithHashedPasswords = await Promise.all(
          validUsers.map(async ({ index, data }) => {
            // Hash password if provided
            const hashedPassword = data.password ? await bcrypt.hash(data.password, 10) : undefined;

            // Set default status to EXPERIENCE_PERIOD_1 if not provided (Brazilian CLT standard)
            const status = (data.status as USER_STATUS) || USER_STATUS.EXPERIENCE_PERIOD_1;

            // Set statusOrder based on status
            const statusOrder = USER_STATUS_ORDER[status];

            // Set initial status timestamps
            const now = new Date();
            const statusTimestamps: any = {};

            switch (status) {
              case USER_STATUS.EXPERIENCE_PERIOD_1:
                statusTimestamps.exp1StartAt = now;
                // Set exp1EndAt to 45 days from now
                const exp1End = new Date(now);
                exp1End.setDate(exp1End.getDate() + 45);
                statusTimestamps.exp1EndAt = exp1End;
                break;

              case USER_STATUS.EXPERIENCE_PERIOD_2:
                statusTimestamps.exp2StartAt = now;
                // Set exp2EndAt to 45 days from now
                const exp2End = new Date(now);
                exp2End.setDate(exp2End.getDate() + 45);
                statusTimestamps.exp2EndAt = exp2End;
                break;

              case USER_STATUS.EFFECTED:
                statusTimestamps.effectedAt = now;
                break;

              case USER_STATUS.DISMISSED:
                statusTimestamps.dismissedAt = now;
                break;
            }

            return {
              index,
              data: {
                ...data,
                password: hashedPassword,
                status,
                statusOrder,
                ...statusTimestamps,
              },
            };
          }),
        );

        // Criar usuários com mapeamento de índices
        const createResult = await this.userRepository.createManyWithTransaction(
          tx,
          usersWithHashedPasswords.map(u => u.data),
          { include },
        );

        // Mapear resultados de volta aos índices originais
        const finalResult = {
          success: createResult.success,
          failed: [
            ...errors.map(e => ({
              index: e.index,
              id: undefined,
              error: e.error,
              errorCode: 'VALIDATION_ERROR',
              data: users[e.index],
            })),
            ...createResult.failed,
          ],
          totalCreated: createResult.totalCreated,
          totalFailed: errors.length + createResult.totalFailed,
        };

        // Registrar criações bem-sucedidas
        for (const user of finalResult.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.USER,
            entityId: user.id,
            action: CHANGE_ACTION.CREATE,
            entity: user,
            reason: 'Usuário criado em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            userId: userId || null,
            transaction: tx,
          });
        }

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
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const { users: updates } = data;

        // Validar cada atualização individualmente
        const errors: Array<{ index: number; id: string; error: string }> = [];
        const validUpdates: Array<{ index: number; id: string; data: UserUpdateFormData }> = [];

        for (let i = 0; i < updates.length; i++) {
          try {
            const { id, data: updateData } = updates[i];

            // Verificar se o usuário existe
            const existing = await tx.user.findUnique({ where: { id } });
            if (!existing) {
              throw new NotFoundException('Usuário não encontrado.');
            }

            // Validar dados da atualização
            await this.userValidation(updateData, id, tx);
            validUpdates.push({ index: i, id, data: updateData });
          } catch (error) {
            errors.push({
              index: i,
              id: updates[i].id,
              error:
                error instanceof BadRequestException || error instanceof NotFoundException
                  ? error.message
                  : 'Erro ao validar atualização.',
            });
          }
        }

        // Se todos falharam na validação, retornar erro
        if (validUpdates.length === 0) {
          return {
            success: [],
            failed: errors.map(e => ({
              ...e,
              errorCode: 'VALIDATION_ERROR',
              data: { id: e.id, ...updates[e.index].data },
            })),
            totalUpdated: 0,
            totalFailed: errors.length,
          };
        }

        // Processar atualizações válidas com hash de senha e tracking de status se necessário
        const updateData: Array<{ id: string; data: UserUpdateFormData }> = await Promise.all(
          validUpdates.map(async ({ id, data }) => {
            // Hash password if provided
            const hashedPassword = data.password ? await bcrypt.hash(data.password, 10) : undefined;

            // Get existing user to check for status changes
            const existingUser = await tx.user.findUnique({ where: { id } });

            const processedData: any = {
              ...data,
              password: hashedPassword,
            };

            // Track status timestamps when status changes
            if (data.status && existingUser && data.status !== existingUser.status) {
              // Set statusOrder when status changes
              processedData.statusOrder = USER_STATUS_ORDER[data.status as USER_STATUS];

              const now = new Date();

              switch (data.status) {
                case USER_STATUS.EXPERIENCE_PERIOD_1:
                  processedData.exp1StartAt = now;
                  // Set exp1EndAt to 45 days from now
                  const exp1End = new Date(now);
                  exp1End.setDate(exp1End.getDate() + 45);
                  processedData.exp1EndAt = exp1End;
                  break;

                case USER_STATUS.EXPERIENCE_PERIOD_2:
                  processedData.exp2StartAt = now;
                  // Set exp2EndAt to 45 days from now
                  const exp2End = new Date(now);
                  exp2End.setDate(exp2End.getDate() + 45);
                  processedData.exp2EndAt = exp2End;
                  break;

                case USER_STATUS.EFFECTED:
                  processedData.effectedAt = now;
                  break;

                case USER_STATUS.DISMISSED:
                  processedData.dismissedAt = now;
                  break;
              }
            }

            return {
              id,
              data: processedData,
            };
          }),
        );

        const updateResult = await this.userRepository.updateManyWithTransaction(tx, updateData, {
          include,
        });

        // Mapear resultados finais
        const finalResult = {
          success: updateResult.success,
          failed: [
            ...errors.map(e => ({
              index: e.index,
              id: e.id,
              error: e.error,
              errorCode: 'VALIDATION_ERROR',
              data: { id: e.id, ...updates[e.index].data },
            })),
            ...updateResult.failed,
          ],
          totalUpdated: updateResult.totalUpdated,
          totalFailed: errors.length + updateResult.totalFailed,
        };

        // For batch updates, we need to track field changes for each user
        for (const user of finalResult.success) {
          // Find the original update data for this user
          const updateIndex = validUpdates.findIndex(u => u.id === user.id);
          if (updateIndex !== -1) {
            const originalData = validUpdates[updateIndex].data;

            // Find the existing user data from before the update
            const existingUser = await this.userRepository.findByIdWithTransaction(tx, user.id, {
              include: { position: true, sector: true },
            });

            if (existingUser) {
              // Track field changes
              const fieldsToTrack = [
                'name',
                'email',
                'phone',
                'cpf',
                'pis',
                'payrollNumber',
                'status',
                'statusOrder',
                'positionId',
                'performanceLevel',
                'sectorId',
                'verified',
                'requirePasswordChange',
                'birth',
                'dismissedAt',
                'address',
                'addressNumber',
                'addressComplement',
                'neighborhood',
                'city',
                'state',
                'zipCode',
                'site',
              ];

              await trackAndLogFieldChanges({
                changeLogService: this.changeLogService,
                entityType: ENTITY_TYPE.USER,
                entityId: user.id,
                oldEntity: existingUser,
                newEntity: user,
                fieldsToTrack: fieldsToTrack.filter(field => originalData.hasOwnProperty(field)),
                userId: userId || null,
                triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                transaction: tx,
              });

              // Handle password changes
              if (originalData.password) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.USER,
                  entityId: user.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'password',
                  oldValue: '[REDACTED]',
                  newValue: '[REDACTED]',
                  reason: 'Senha atualizada em lote',
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: user.id,
                  userId: userId || null,
                  transaction: tx,
                });
              }
            }
          }
        }

        return finalResult;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 usuário atualizado com sucesso'
          : `${result.totalUpdated} usuários atualizados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format and remove passwords
      const batchOperationResult = {
        success: result.success.map(({ password, ...user }) => user as User),
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: {
            ...error.data,
            id: error.id || '',
          },
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
    } catch (error: any) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar usuários em lote. Por favor, tente novamente.',
      );
    }
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
            vacations: true,
          },
        });

        if (!targetUser) {
          throw new NotFoundException(`Usuário alvo com ID ${data.targetUserId} não encontrado`);
        }

        const sourceUsers = await tx.user.findMany({
          where: { id: { in: data.sourceUserIds } },
          include: {
            createdTasks: true,
            vacations: true,
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

        // 5. Merge vacations
        for (const sourceUser of sourceUsers) {
          if (sourceUser.vacations.length > 0) {
            await tx.vacation.updateMany({
              where: { userId: sourceUser.id },
              data: { userId: data.targetUserId },
            });
          }
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

        if (Object.keys(updateData).length > 0) {
          await tx.user.update({
            where: { id: data.targetUserId },
            data: updateData,
          });
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
   * Automatically transition users to the next status when their experience periods end
   * This method should be called by a cron job daily at midnight
   *
   * Status transitions:
   * - EXPERIENCE_PERIOD_1 -> EXPERIENCE_PERIOD_2 (when exp1EndAt is today)
   * - EXPERIENCE_PERIOD_2 -> EFFECTED (when exp2EndAt is today)
   */
  async processExperiencePeriodTransitions(userId: string = 'system'): Promise<{
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

      // Find users where exp1EndAt has passed (today or earlier) and status is still EXPERIENCE_PERIOD_1
      const usersEndingExp1 = await this.prisma.user.findMany({
        where: {
          status: USER_STATUS.EXPERIENCE_PERIOD_1,
          exp1EndAt: {
            lt: tomorrow, // Catches all users whose exp1 ended today or earlier
          },
        },
        include: {
          position: true,
          sector: true,
        },
      });

      this.logger.log(
        `Found ${usersEndingExp1.length} users with Experience Period 1 ended (pending transition)`,
      );

      // Transition users from exp1 to exp2
      for (const user of usersEndingExp1) {
        try {
          await this.prisma.$transaction(async (tx: PrismaTransaction) => {
            const existingUser = user;

            // Update user status to EXPERIENCE_PERIOD_2
            const updatedUser = await tx.user.update({
              where: { id: user.id },
              data: {
                status: USER_STATUS.EXPERIENCE_PERIOD_2,
                // exp2StartAt and exp2EndAt should already be set, but we can update them if needed
                exp2StartAt: user.exp2StartAt || today,
                updatedAt: new Date(),
              },
            });

            // Log the status change
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.USER,
              entityId: user.id,
              action: CHANGE_ACTION.UPDATE,
              field: 'status',
              oldValue: USER_STATUS.EXPERIENCE_PERIOD_1,
              newValue: USER_STATUS.EXPERIENCE_PERIOD_2,
              reason: 'Transição automática: Período de Experiência 1 finalizado',
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              triggeredById: user.id,
              userId: userId,
              transaction: tx,
            });

            this.logger.log(`User ${user.name} (${user.id}) transitioned from EXP1 to EXP2`);
          });

          result.exp1ToExp2++;
          result.totalProcessed++;
        } catch (error: any) {
          this.logger.error(`Failed to transition user ${user.id} from EXP1 to EXP2:`, error);
          result.errors.push({
            userId: user.id,
            error: error.message || 'Unknown error during exp1->exp2 transition',
          });
        }
      }

      // Find users where exp2EndAt has passed (today or earlier) and status is still EXPERIENCE_PERIOD_2
      const usersEndingExp2 = await this.prisma.user.findMany({
        where: {
          status: USER_STATUS.EXPERIENCE_PERIOD_2,
          exp2EndAt: {
            lt: tomorrow, // Catches all users whose exp2 ended today or earlier
          },
        },
        include: {
          position: true,
          sector: true,
        },
      });

      this.logger.log(
        `Found ${usersEndingExp2.length} users with Experience Period 2 ended (pending transition)`,
      );

      // Transition users from exp2 to effected
      for (const user of usersEndingExp2) {
        try {
          await this.prisma.$transaction(async (tx: PrismaTransaction) => {
            const existingUser = user;

            // Update user status to EFFECTED
            const updatedUser = await tx.user.update({
              where: { id: user.id },
              data: {
                status: USER_STATUS.EFFECTED,
                effectedAt: today,
                updatedAt: new Date(),
              },
            });

            // Log the status change
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.USER,
              entityId: user.id,
              action: CHANGE_ACTION.UPDATE,
              field: 'status',
              oldValue: USER_STATUS.EXPERIENCE_PERIOD_2,
              newValue: USER_STATUS.EFFECTED,
              reason: 'Transição automática: Período de Experiência 2 finalizado',
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              triggeredById: user.id,
              userId: userId,
              transaction: tx,
            });

            this.logger.log(`User ${user.name} (${user.id}) transitioned from EXP2 to EFFECTED`);
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
