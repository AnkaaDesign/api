// user-position-history.service.ts
// Histórico de cargos (Departamento Pessoal) — read-only list/detail + promote.
// Position changes made through user create/update flow into this table via the
// hooks in user.service.ts; the promote flow here writes User.positionId with
// Prisma directly (inside one transaction) to avoid circular module deps.

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
import { logEntityChange } from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  POSITION_CHANGE_REASON,
} from '../../../constants/enums';
import { POSITION_CHANGE_REASON_LABELS } from '../../../constants';
import type {
  UserPositionHistory,
  UserPositionHistoryGetManyResponse,
  UserPositionHistoryGetUniqueResponse,
  UserPositionHistoryPromoteResponse,
} from '../../../types';
import type {
  UserPositionHistoryGetManyFormData,
  UserPositionHistoryInclude,
  UserPositionHistoryPromoteFormData,
} from '../../../schemas';

const DEFAULT_INCLUDE = {
  user: { include: { position: true, sector: true } },
  position: true,
  previousPosition: true,
  changedBy: true,
} as const;

@Injectable()
export class UserPositionHistoryService {
  private readonly logger = new Logger(UserPositionHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Buscar muitos registros de histórico de cargos com filtros
   */
  async findMany(
    query: UserPositionHistoryGetManyFormData,
  ): Promise<UserPositionHistoryGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit ?? 20;
      const skip = (page - 1) * take;

      const where = (query.where as any) || {};
      const orderBy = (query.orderBy as any) || { startedAt: 'desc' };
      const include = (query.include as any) || DEFAULT_INCLUDE;

      const [totalRecords, data] = await Promise.all([
        this.prisma.userPositionHistory.count({ where }),
        this.prisma.userPositionHistory.findMany({
          where,
          orderBy,
          include,
          skip,
          take,
        }),
      ]);

      const totalPages = Math.ceil(totalRecords / take) || 1;

      return {
        success: true,
        message: 'Histórico de cargos carregado com sucesso.',
        data: data as unknown as UserPositionHistory[],
        meta: {
          totalRecords,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar histórico de cargos:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar histórico de cargos. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Buscar um registro de histórico de cargo por ID
   */
  async findById(
    id: string,
    include?: UserPositionHistoryInclude,
  ): Promise<UserPositionHistoryGetUniqueResponse> {
    try {
      const history = await this.prisma.userPositionHistory.findUnique({
        where: { id },
        include: (include as any) || DEFAULT_INCLUDE,
      });

      if (!history) {
        throw new NotFoundException('Registro de histórico de cargo não encontrado.');
      }

      return {
        success: true,
        message: 'Registro de histórico de cargo carregado com sucesso.',
        data: history as unknown as UserPositionHistory,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar registro de histórico de cargo por ID:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar registro de histórico de cargo. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Promover/transferir/rebaixar colaborador — POST /user-position-history/promote
   *
   * Em UMA transação: atualiza User.positionId, fecha o registro de histórico
   * aberto (endedAt = agora) e adiciona o novo registro; registra changelog do
   * USER (campo positionId) e do USER_POSITION_HISTORY (CREATE).
   */
  async promote(
    data: UserPositionHistoryPromoteFormData,
    include?: UserPositionHistoryInclude,
    changedById?: string,
  ): Promise<UserPositionHistoryPromoteResponse> {
    try {
      const created = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const user = await tx.user.findUnique({
          where: { id: data.userId },
          include: { position: true },
        });

        if (!user) {
          throw new NotFoundException('Usuário não encontrado.');
        }

        const newPosition = await tx.position.findUnique({
          where: { id: data.toPositionId },
        });

        if (!newPosition) {
          throw new NotFoundException('Cargo não encontrado.');
        }

        if (user.positionId === data.toPositionId) {
          throw new BadRequestException('O colaborador já está neste cargo.');
        }

        const now = new Date();
        const reasonLabel =
          POSITION_CHANGE_REASON_LABELS[data.reason as POSITION_CHANGE_REASON] || data.reason;

        // Atualizar o cargo do usuário
        await tx.user.update({
          where: { id: user.id },
          data: { positionId: data.toPositionId },
        });

        // Fechar o registro de histórico aberto
        await tx.userPositionHistory.updateMany({
          where: { userId: user.id, endedAt: null },
          data: { endedAt: now },
        });

        // Adicionar o novo registro de histórico
        const created = await tx.userPositionHistory.create({
          data: {
            userId: user.id,
            positionId: data.toPositionId,
            previousPositionId: user.positionId,
            reason: data.reason as any,
            startedAt: now,
            note: data.note ?? null,
            changedById: changedById || null,
          },
          include: (include as any) || DEFAULT_INCLUDE,
        });

        // Changelog do USER (campo positionId)
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.USER,
          entityId: user.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'positionId',
          oldValue: user.positionId,
          newValue: data.toPositionId,
          reason: `${reasonLabel}: ${user.position?.name || 'Sem cargo'} → ${newPosition.name}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: user.id,
          userId: changedById || null,
          transaction: tx,
        });

        // Changelog do USER_POSITION_HISTORY (CREATE)
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.USER_POSITION_HISTORY,
          entityId: created.id,
          action: CHANGE_ACTION.CREATE,
          entity: created,
          reason: `Registro de ${reasonLabel.toLowerCase()} criado para ${user.name}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: changedById || null,
          transaction: tx,
        });

        return created;
      });

      const messageByReason: Record<string, string> = {
        [POSITION_CHANGE_REASON.PROMOTION]: 'Colaborador promovido com sucesso.',
        [POSITION_CHANGE_REASON.TRANSFER]: 'Colaborador transferido de cargo com sucesso.',
        [POSITION_CHANGE_REASON.DEMOTION]: 'Cargo do colaborador alterado com sucesso.',
      };

      return {
        success: true,
        message: messageByReason[data.reason] || 'Cargo do colaborador atualizado com sucesso.',
        data: created as unknown as UserPositionHistory,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao alterar cargo do colaborador:', error);
      throw new InternalServerErrorException(
        'Erro ao alterar cargo do colaborador. Por favor, tente novamente.',
      );
    }
  }
}
