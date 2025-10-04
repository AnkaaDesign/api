import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  PreferencesGetUniqueResponse,
  PreferencesGetManyResponse,
  PreferencesCreateResponse,
  PreferencesUpdateResponse,
  PreferencesDeleteResponse,
} from '../../../types';
import { PreferencesRepository } from './repositories/preferences.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  PreferencesCreateFormData,
  PreferencesUpdateFormData,
  PreferencesGetManyFormData,
  PreferencesInclude,
} from '../../../schemas/preferences';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
@Injectable()
export class PreferencesService {
  private readonly logger = new Logger(PreferencesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferencesRepository: PreferencesRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validate unique constraints for preferences
   */
  private async validateUniqueConstraints(
    tx: PrismaTransaction,
    data: PreferencesCreateFormData | PreferencesUpdateFormData,
    excludeId?: string,
  ): Promise<void> {
    // Validate unique userId constraint
    if ('userId' in data && data.userId) {
      const existingPreferences = await tx.preferences.findMany({
        where: {
          userId: data.userId,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        take: 1,
      });

      if (existingPreferences.length > 0) {
        throw new ConflictException('Usuário já possui preferências cadastradas');
      }
    }
  }

  /**
   * Create a new preference
   */
  async create(
    data: PreferencesCreateFormData,
    include?: PreferencesInclude,
  ): Promise<PreferencesCreateResponse> {
    try {
      const preference = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validate unique constraints
        await this.validateUniqueConstraints(tx, data);

        const newPreference = await this.preferencesRepository.createWithTransaction(tx, data);

        // Registrar no changelog
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PREFERENCES,
          entityId: newPreference.id,
          action: CHANGE_ACTION.CREATE,
          field: null,
          oldValue: null,
          newValue: newPreference,
          reason: 'Preferência criada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: newPreference.id,
          userId: data.userId || null,
          transaction: tx,
        });

        return newPreference;
      });

      return {
        success: true,
        message: 'Preferência criada com sucesso.',
        data: preference,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Erro ao criar preferência:', error);
      throw new InternalServerErrorException('Erro ao criar preferência. Tente novamente.');
    }
  }

  /**
   * Update a preference
   */
  async update(
    id: string,
    data: PreferencesUpdateFormData,
    include?: PreferencesInclude,
  ): Promise<PreferencesUpdateResponse> {
    try {
      const preference = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar preferência existente
        const existingPreference = await this.preferencesRepository.findByIdWithTransaction(tx, id);
        if (!existingPreference) {
          throw new NotFoundException(
            'Preferência não encontrada. Verifique se o ID está correto.',
          );
        }

        // Validate unique constraints
        await this.validateUniqueConstraints(tx, data, id);

        // Atualizar preferência
        const updatedPreference = await this.preferencesRepository.updateWithTransaction(
          tx,
          id,
          data,
        );

        // Registrar mudanças no changelog
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PREFERENCES,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: null,
          oldValue: existingPreference,
          newValue: updatedPreference,
          reason: 'Preferência atualizada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: existingPreference.userId || null,
          transaction: tx,
        });

        return updatedPreference;
      });

      return {
        success: true,
        message: 'Preferência atualizada com sucesso.',
        data: preference,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(`Erro ao atualizar preferência ${id}:`, error);
      throw new InternalServerErrorException('Erro ao atualizar preferência. Tente novamente.');
    }
  }

  /**
   * Delete a preference
   */
  async delete(id: string, include?: PreferencesInclude): Promise<PreferencesDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const preference = await this.preferencesRepository.findByIdWithTransaction(tx, id);
        if (!preference) {
          throw new NotFoundException(
            'Preferência não encontrada. Verifique se o ID está correto.',
          );
        }

        // Registrar exclusão
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PREFERENCES,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          field: null,
          oldValue: preference,
          newValue: null,
          reason: 'Preferência excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: preference.userId || null,
          transaction: tx,
        });

        await this.preferencesRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Preferência deletada com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Erro ao deletar preferência ${id}:`, error);
      throw new InternalServerErrorException('Erro ao deletar preferência. Tente novamente.');
    }
  }

  /**
   * Find preference by ID
   */
  async findById(id: string, include?: PreferencesInclude): Promise<PreferencesGetUniqueResponse> {
    try {
      const preference = await this.preferencesRepository.findById(id);
      if (!preference) {
        throw new NotFoundException('Preferência não encontrada. Verifique se o ID está correto.');
      }

      return {
        success: true,
        message: 'Preferência recuperada com sucesso.',
        data: preference,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Erro ao buscar preferência ${id}:`, error);
      throw new InternalServerErrorException('Erro ao buscar preferência. Tente novamente.');
    }
  }

  /**
   * Find many preferences with filters and pagination
   */
  async findMany(query: PreferencesGetManyFormData = {}): Promise<PreferencesGetManyResponse> {
    try {
      const { page, limit: take, orderBy, where, ...filters } = query;

      // Convert query to FindManyOptions format
      const options = {
        page,
        take,
        orderBy,
        where: where || filters,
      };

      const result = await this.preferencesRepository.findMany(options);

      return {
        success: true,
        message: 'Preferências recuperadas com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar preferências:', error);
      throw new InternalServerErrorException('Erro ao buscar preferências. Tente novamente.');
    }
  }
}
