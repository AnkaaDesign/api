// agenda-event.service.ts
// Agenda com avisos — CRUD de eventos com lembretes configuráveis
// (notifyDaysBefore + notifyOnDay) enviados pelos canais escolhidos
// (in-app, push, e-mail, WhatsApp) via CalendarNotificationScheduler.

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../constants';
import type {
  AgendaEvent,
  AgendaEventGetManyResponse,
  AgendaEventGetUniqueResponse,
  AgendaEventCreateResponse,
  AgendaEventUpdateResponse,
  AgendaEventDeleteResponse,
  AgendaEventBatchCreateResponse,
  AgendaEventBatchUpdateResponse,
  AgendaEventBatchDeleteResponse,
} from '../../../types';
import type {
  AgendaEventGetManyFormData,
  AgendaEventCreateFormData,
  AgendaEventUpdateFormData,
  AgendaEventBatchCreateFormData,
  AgendaEventBatchUpdateFormData,
  AgendaEventBatchDeleteFormData,
  AgendaEventInclude,
} from '../../../schemas';

const AGENDA_EVENT_TRACKED_FIELDS = [
  'title',
  'description',
  'eventDate',
  'notifyDaysBefore',
  'notifyOnDay',
  'channels',
  'targetSectorIds',
  'targetUserIds',
  'isActive',
];

@Injectable()
export class AgendaEventService {
  private readonly logger = new Logger(AgendaEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Compatibilidade da codificação de lembretes: 0 ∈ notifyDaysBefore significa
   * "avisar no dia" (e -1 significa "avisar atraso, 1 dia após"). Sempre que o
   * cliente envia notifyDaysBefore, notifyOnDay é DERIVADO daqui — o campo
   * booleano permanece no banco apenas para leitores legados.
   */
  private deriveNotifyOnDay<T extends { notifyDaysBefore?: number[]; notifyOnDay?: boolean }>(
    data: T,
  ): T {
    if (Array.isArray(data.notifyDaysBefore)) {
      return { ...data, notifyOnDay: data.notifyDaysBefore.includes(0) };
    }
    return data;
  }

  /**
   * Valida setores/usuários-alvo existentes (somente quando informados).
   */
  private async agendaEventValidation(
    data: Partial<AgendaEventCreateFormData | AgendaEventUpdateFormData>,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    if (data.targetSectorIds && data.targetSectorIds.length > 0) {
      const count = await transaction.sector.count({
        where: { id: { in: data.targetSectorIds } },
      });
      if (count !== data.targetSectorIds.length) {
        throw new NotFoundException('Um ou mais setores-alvo não foram encontrados.');
      }
    }

    if (data.targetUserIds && data.targetUserIds.length > 0) {
      const count = await transaction.user.count({
        where: { id: { in: data.targetUserIds } },
      });
      if (count !== data.targetUserIds.length) {
        throw new NotFoundException('Um ou mais colaboradores-alvo não foram encontrados.');
      }
    }
  }

  async findMany(query: AgendaEventGetManyFormData): Promise<AgendaEventGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit && query.limit > 0 ? query.limit : 20;
      const skip = (page - 1) * take;
      const where = query.where || {};
      const orderBy = query.orderBy || { eventDate: 'asc' };

      const [totalRecords, agendaEvents] = await Promise.all([
        this.prisma.agendaEvent.count({ where }),
        this.prisma.agendaEvent.findMany({
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
        message: 'Eventos da agenda carregados com sucesso.',
        data: agendaEvents as unknown as AgendaEvent[],
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
      this.logger.error('Erro ao buscar eventos da agenda:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar eventos da agenda. Por favor, tente novamente.',
      );
    }
  }

  async findById(id: string, include?: AgendaEventInclude): Promise<AgendaEventGetUniqueResponse> {
    try {
      const agendaEvent = await this.prisma.agendaEvent.findUnique({ where: { id }, include });

      if (!agendaEvent) {
        throw new NotFoundException('Evento da agenda não encontrado.');
      }

      return {
        success: true,
        message: 'Evento da agenda carregado com sucesso.',
        data: agendaEvent as unknown as AgendaEvent,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar evento da agenda por ID:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar evento da agenda. Por favor, tente novamente.',
      );
    }
  }

  async create(
    data: AgendaEventCreateFormData,
    include?: AgendaEventInclude,
    userId?: string,
  ): Promise<AgendaEventCreateResponse> {
    try {
      if (!userId) {
        throw new BadRequestException('Usuário criador não identificado.');
      }

      const agendaEvent = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.agendaEventValidation(data, tx);

        const newAgendaEvent = await tx.agendaEvent.create({
          data: {
            ...(this.deriveNotifyOnDay(data) as any),
            createdById: userId,
          },
          include,
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.AGENDA_EVENT,
          entityId: newAgendaEvent.id,
          action: CHANGE_ACTION.CREATE,
          entity: newAgendaEvent,
          reason: 'Evento da agenda criado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newAgendaEvent;
      });

      return {
        success: true,
        message: 'Evento da agenda criado com sucesso.',
        data: agendaEvent as unknown as AgendaEvent,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao criar evento da agenda:', error);
      throw new InternalServerErrorException(
        'Erro ao criar evento da agenda. Por favor, tente novamente.',
      );
    }
  }

  async update(
    id: string,
    data: AgendaEventUpdateFormData,
    include?: AgendaEventInclude,
    userId?: string,
  ): Promise<AgendaEventUpdateResponse> {
    try {
      const agendaEvent = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.agendaEvent.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('Evento da agenda não encontrado.');
        }

        await this.agendaEventValidation(data, tx);

        const updateData: any = { ...this.deriveNotifyOnDay(data) };

        // Data do evento alterada ⇒ zera o carimbo de notificação para que o
        // ciclo de lembretes recomece em relação à nova data.
        if (
          data.eventDate &&
          new Date(data.eventDate).getTime() !== new Date(existing.eventDate).getTime()
        ) {
          updateData.lastNotifiedAt = null;
        }

        const updated = await tx.agendaEvent.update({ where: { id }, data: updateData, include });

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.AGENDA_EVENT,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: AGENDA_EVENT_TRACKED_FIELDS,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Evento da agenda atualizado com sucesso.',
        data: agendaEvent as unknown as AgendaEvent,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar evento da agenda:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar evento da agenda. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId?: string): Promise<AgendaEventDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const agendaEvent = await tx.agendaEvent.findUnique({ where: { id } });

        if (!agendaEvent) {
          throw new NotFoundException('Evento da agenda não encontrado.');
        }

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.AGENDA_EVENT,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: agendaEvent,
          reason: 'Evento da agenda excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.agendaEvent.delete({ where: { id } });
      });

      return {
        success: true,
        message: 'Evento da agenda excluído com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao excluir evento da agenda:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir evento da agenda. Por favor, tente novamente.',
      );
    }
  }

  async batchCreate(
    data: AgendaEventBatchCreateFormData,
    include?: AgendaEventInclude,
    userId?: string,
  ): Promise<AgendaEventBatchCreateResponse<AgendaEventCreateFormData>> {
    try {
      if (!userId) {
        throw new BadRequestException('Usuário criador não identificado.');
      }

      const success: AgendaEvent[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: AgendaEventCreateFormData;
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, itemData] of data.agendaEvents.entries()) {
          try {
            await this.agendaEventValidation(itemData, tx);

            const created = await tx.agendaEvent.create({
              data: {
                ...(this.deriveNotifyOnDay(itemData) as any),
                createdById: userId,
              },
              include,
            });

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.AGENDA_EVENT,
              entityId: created.id,
              action: CHANGE_ACTION.CREATE,
              entity: created,
              reason: 'Evento da agenda criado em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || null,
              transaction: tx,
            });

            success.push(created as unknown as AgendaEvent);
          } catch (error: any) {
            failed.push({
              index,
              error: error?.message || 'Erro ao criar evento da agenda.',
              data: itemData,
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 evento criado com sucesso'
          : `${success.length} eventos criados com sucesso`;
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
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro na criação de eventos da agenda em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar eventos da agenda em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchUpdate(
    data: AgendaEventBatchUpdateFormData,
    include?: AgendaEventInclude,
    userId?: string,
  ): Promise<AgendaEventBatchUpdateResponse<AgendaEventUpdateFormData>> {
    try {
      const success: AgendaEvent[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: AgendaEventUpdateFormData & { id: string };
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, update] of data.agendaEvents.entries()) {
          try {
            const existing = await tx.agendaEvent.findUnique({ where: { id: update.id } });
            if (!existing) {
              throw new NotFoundException('Evento da agenda não encontrado.');
            }

            await this.agendaEventValidation(update.data, tx);

            const updateData: any = { ...this.deriveNotifyOnDay(update.data) };
            if (
              update.data.eventDate &&
              new Date(update.data.eventDate).getTime() !== new Date(existing.eventDate).getTime()
            ) {
              updateData.lastNotifiedAt = null;
            }

            const updated = await tx.agendaEvent.update({
              where: { id: update.id },
              data: updateData,
              include,
            });

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.AGENDA_EVENT,
              entityId: update.id,
              oldEntity: existing,
              newEntity: updated,
              fieldsToTrack: AGENDA_EVENT_TRACKED_FIELDS,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            success.push(updated as unknown as AgendaEvent);
          } catch (error: any) {
            failed.push({
              index,
              id: update.id,
              error: error?.message || 'Erro ao atualizar evento da agenda.',
              data: { ...update.data, id: update.id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 evento atualizado com sucesso'
          : `${success.length} eventos atualizados com sucesso`;
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
      this.logger.error('Erro na atualização de eventos da agenda em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar eventos da agenda em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: AgendaEventBatchDeleteFormData,
    userId?: string,
  ): Promise<AgendaEventBatchDeleteResponse> {
    try {
      const success: Array<{ id: string; deleted: boolean }> = [];
      const failed: Array<{ index: number; id?: string; error: string; data: { id: string } }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, id] of data.agendaEventIds.entries()) {
          try {
            const agendaEvent = await tx.agendaEvent.findUnique({ where: { id } });

            if (!agendaEvent) {
              throw new NotFoundException('Evento da agenda não encontrado.');
            }

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.AGENDA_EVENT,
              entityId: id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: agendaEvent,
              reason: 'Evento da agenda excluído em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              userId: userId || null,
              transaction: tx,
            });

            await tx.agendaEvent.delete({ where: { id } });
            success.push({ id, deleted: true });
          } catch (error: any) {
            failed.push({
              index,
              id,
              error: error?.message || 'Erro ao excluir evento da agenda.',
              data: { id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 evento excluído com sucesso'
          : `${success.length} eventos excluídos com sucesso`;
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
      this.logger.error('Erro na exclusão de eventos da agenda em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir eventos da agenda em lote. Por favor, tente novamente.',
      );
    }
  }
}
