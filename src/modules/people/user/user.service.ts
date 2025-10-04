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
  FindManyOptions,
} from '../../../types';
import type {
  UserCreateFormData,
  UserUpdateFormData,
  UserGetManyFormData,
  UserBatchCreateFormData,
  UserBatchUpdateFormData,
  UserBatchDeleteFormData,
  UserInclude,
  UserOrderBy,
  UserWhere,
} from '../../../schemas/user';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_TRIGGERED_BY,
  USER_STATUS,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../../constants/enums';
import { USER_STATUS_ORDER } from '../../../constants/sortOrders';
import { isValidCPF, isValidPIS, isValidPhone } from '../../../utils';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userRepository: UserRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

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
    if (data.email !== undefined && data.email !== null) {
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
    if (data.phone !== undefined && data.phone !== null) {
      // Validar formato do telefone
      if (!isValidPhone(data.phone)) {
        throw new BadRequestException('Telefone inválido.');
      }

      // Validar unicidade do telefone
      const existingPhone = await this.userRepository.findByPhone(data.phone, tx);
      if (existingPhone && existingPhone.id !== existingId) {
        throw new BadRequestException('Telefone já está em uso.');
      }
    }

    // Validar formato do PIS se fornecido
    if (data.pis !== undefined && data.pis !== null) {
      if (!isValidPIS(data.pis)) {
        throw new BadRequestException('PIS inválido.');
      }
    }

    // Validar data de contratação
    if ('admissional' in data && data.admissional !== undefined && data.admissional !== null) {
      const admissional = new Date(data.admissional);
      const now = new Date();

      // Verificar se é uma data válida
      if (isNaN(admissional.getTime())) {
        throw new BadRequestException('Data de contratação inválida.');
      }

      // Verificar se não é muito no futuro (permitir até 30 dias no futuro para pré-contratações)
      const maxFutureDate = new Date();
      maxFutureDate.setDate(maxFutureDate.getDate() + 30);
      if (admissional > maxFutureDate) {
        throw new BadRequestException(
          'Data de contratação não pode ser mais de 30 dias no futuro.',
        );
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

    if (data.managedSectorId !== undefined) {
      if (data.managedSectorId === null) {
        // Permitir remover o setor gerenciado
      } else {
        const managedSector = await transaction.sector.findUnique({
          where: { id: data.managedSectorId },
        });
        if (!managedSector) {
          throw new NotFoundException('Setor gerenciado não encontrado.');
        }

        // Regra de negócio: usuário não pode gerenciar seu próprio setor
        if (data.sectorId && data.managedSectorId === data.sectorId) {
          throw new BadRequestException('Usuário não pode gerenciar seu próprio setor.');
        }
      }
    }

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
      let finalWhere = where || {};

      // Handle searchingFor transformation
      if (filters.searchingFor && typeof filters.searchingFor === 'string') {
        finalWhere = {
          ...finalWhere,
          OR: [
            { name: { contains: filters.searchingFor, mode: 'insensitive' } },
            { email: { contains: filters.searchingFor, mode: 'insensitive' } },
            { cpf: { contains: filters.searchingFor } },
          ],
        };
      }

      // Handle other filters
      if (filters.name !== undefined) finalWhere.name = filters.name;
      if (filters.email !== undefined) finalWhere.email = filters.email;
      if (filters.phone !== undefined) finalWhere.phone = filters.phone;
      if (filters.cpf !== undefined) finalWhere.cpf = filters.cpf;

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
          finalWhere.positionId = filters.positionId.length > 0 ? { in: filters.positionId } : undefined;
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
      // isActive now means "not dismissed" since we no longer have ACTIVE/INACTIVE
      if (filters.isActive !== undefined) {
        finalWhere.status = filters.isActive
          ? { not: USER_STATUS.DISMISSED }  // Active = not dismissed
          : USER_STATUS.DISMISSED;           // Inactive = dismissed
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

      if (filters.hireDateRange) {
        const dateWhere: any = {};
        if (filters.hireDateRange.gte !== undefined) {
          dateWhere.gte = filters.hireDateRange.gte;
        }
        if (filters.hireDateRange.lte !== undefined) {
          dateWhere.lte = filters.hireDateRange.lte;
        }
        if (Object.keys(dateWhere).length > 0) {
          finalWhere.hireDate = dateWhere;
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
          finalWhere.birthDate = dateWhere;
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
        USER_STATUS.CONTRACTED, // Pode ser efetivado diretamente
        USER_STATUS.DISMISSED, // Pode ser demitido
      ],
      // Segundo período de experiência (45 dias)
      [USER_STATUS.EXPERIENCE_PERIOD_2]: [
        USER_STATUS.CONTRACTED, // Progride para contratado
        USER_STATUS.DISMISSED, // Pode ser demitido
      ],
      // Contratado (efetivo)
      [USER_STATUS.CONTRACTED]: [
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
   * Criar novo usuário
   */
  async create(
    data: UserCreateFormData,
    include?: UserInclude,
    userId?: string,
  ): Promise<UserCreateResponse> {
    try {
      const user = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar usuário completo
        await this.userValidation(data, undefined, tx);

        // Set default status to EXPERIENCE_PERIOD_1 if not provided (Brazilian CLT standard)
        if (!data.status) {
          (data as any).status = USER_STATUS.EXPERIENCE_PERIOD_1;
        }

        // Validate required dates for new users
        if (!data.admissional) {
          throw new BadRequestException('Data de admissão é obrigatória para novos usuários.');
        }

        // Hash da senha se fornecida
        if (data.password) {
          data.password = await bcrypt.hash(data.password, 10);
        }

        // Set statusOrder based on status
        const status = (data.status as USER_STATUS) || USER_STATUS.EXPERIENCE_PERIOD_1;
        (data as any).statusOrder = USER_STATUS_ORDER[status];

        // Criar o usuário
        const newUser = await this.userRepository.createWithTransaction(tx, data, { include });

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
      throw new InternalServerErrorException('Erro ao criar usuário. Por favor, tente novamente.');
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
  ): Promise<UserUpdateResponse> {
    try {
      const updatedUser = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar usuário existente com relações para o tracking
        const existingUser = await this.userRepository.findByIdWithTransaction(tx, id, {
          include: { position: true, sector: true },
        });

        if (!existingUser) {
          throw new NotFoundException('Usuário não encontrado.');
        }

        // Business logic BEFORE saving: Handle dismissal date and status relationship
        // If dismissalDate is provided and status is not DISMISSED, automatically set status to DISMISSED
        if (data.dismissal && (!data.status || data.status !== USER_STATUS.DISMISSED)) {
          this.logger.log(
            `Dismissal date provided for user ${id}. Automatically setting status to DISMISSED.`,
          );
          (data as any).status = USER_STATUS.DISMISSED;
        }

        // If status is being set to DISMISSED and dismissalDate is null, automatically set dismissalDate
        if (data.status === USER_STATUS.DISMISSED && !data.dismissal && !existingUser.dismissal) {
          this.logger.log(
            `Status being set to DISMISSED for user ${id}. Automatically setting dismissal date to now.`,
          );
          (data as any).dismissal = new Date();
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

        // Prevent CONTRACTED users from being set to experience periods (additional check)
        if (
          existingUser.status === USER_STATUS.CONTRACTED &&
          data.status &&
          (data.status === USER_STATUS.EXPERIENCE_PERIOD_1 ||
            data.status === USER_STATUS.EXPERIENCE_PERIOD_2)
        ) {
          throw new BadRequestException(
            'Colaboradores contratados não podem ser alterados para períodos de experiência conforme a CLT.',
          );
        }

        // Validar usuário completo
        await this.userValidation(data, id, tx);

        // Hash da senha se fornecida
        if (data.password) {
          data.password = await bcrypt.hash(data.password, 10);
        }

        // Set statusOrder when status changes
        if (data.status && data.status !== existingUser.status) {
          (data as any).statusOrder = USER_STATUS_ORDER[data.status as USER_STATUS];
        }

        // Clear sessionToken when sectorId changes to force re-authentication with new privileges
        if (data.hasOwnProperty('sectorId') && existingUser.sectorId !== data.sectorId) {
          (data as any).sessionToken = null;
        }

        // Clear sessionToken when user is dismissed
        if (data.status === USER_STATUS.DISMISSED && existingUser.status !== USER_STATUS.DISMISSED) {
          (data as any).sessionToken = null;
        }

        // Prepare update data for tracking
        const updateData: any = { ...data };

        // Handle password separately for security
        if (data.password) {
          updateData.password = '[REDACTED]';
        }

        // Atualizar o usuário
        const updatedUser = await this.userRepository.updateWithTransaction(tx, id, data, {
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
          'hireDate',
          'birthDate',
          'admissional',
          'dismissal', // Track dismissal date changes
          'verificationCode',
          'verificationExpiresAt',
          'verificationType',
          'sessionToken',
          'lastLoginAt',
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

        // Track relationship changes with descriptive messages
        if (
          data.hasOwnProperty('positionId') &&
          existingUser.positionId !== updatedUser.positionId
        ) {
          const oldPosition = existingUser.position?.name || 'Nenhum';
          const newPosition = updatedUser.position?.name || 'Nenhum';
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.USER,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'position',
            oldValue: oldPosition,
            newValue: newPosition,
            reason: `Cargo alterado de "${oldPosition}" para "${newPosition}"`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
        }

        if (data.hasOwnProperty('sectorId') && existingUser.sectorId !== updatedUser.sectorId) {
          const oldSector = existingUser.sector?.name || 'Nenhum';
          const newSector = updatedUser.sector?.name || 'Nenhum';
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.USER,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'sector',
            oldValue: oldSector,
            newValue: newSector,
            reason: `Setor alterado de "${oldSector}" para "${newSector}"`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
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
      throw new InternalServerErrorException(
        'Erro ao atualizar usuário. Por favor, tente novamente.',
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

        // Hash das senhas para todos os usuários válidos
        const usersWithHashedPasswords = await Promise.all(
          validUsers.map(async ({ index, data }) => ({
            index,
            data: {
              ...data,
              password: data.password ? await bcrypt.hash(data.password, 10) : undefined,
            },
          })),
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

        // Processar atualizações válidas com hash de senha se necessário
        const updateData: Array<{ id: string; data: UserUpdateFormData }> = await Promise.all(
          validUpdates.map(async ({ id, data }) => ({
            id,
            data: {
              ...data,
              password: data.password ? await bcrypt.hash(data.password, 10) : undefined,
            },
          })),
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
                'hireDate',
                'birthDate',
                'admissional',
                'dismissal',
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
}
