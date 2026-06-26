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

/**
 * Resultado da resolução histórica de salário de um colaborador numa data.
 * (Part F — getUserSalaryAt). NÃO há campo de salário em User: o valor é sempre
 * composto por UserPositionHistory (qual cargo) × MonetaryValue do cargo (qual
 * valor então).
 */
export interface UserSalaryAtResult {
  userId: string;
  /** Data de competência consultada. */
  date: Date;
  /** Cargo que o colaborador ocupava na data (null se indeterminado). */
  positionId: string | null;
  positionName: string | null;
  /** Remuneração vigente do cargo NA DATA (null se não houver valor aplicável). */
  salary: number | null;
  /** effectiveDate do MonetaryValue usado (para auditoria). */
  effectiveDate: Date | null;
  /** Como o cargo foi resolvido: histórico, cargo atual (fallback) ou nenhum. */
  source: 'HISTORY' | 'CURRENT_POSITION' | 'NONE';
  /** Motivo quando salary é null (sem cargo, sem remuneração, data anterior...). */
  reason?: string;
}

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
        // DEMOTION = Reversão (cargo de confiança → cargo efetivo, CLT art.468 §único)
        [POSITION_CHANGE_REASON.DEMOTION]: 'Colaborador revertido ao cargo efetivo com sucesso.',
        // ADJUSTMENT = Readaptação (restrição médica/INSS, CLT art.461 §4º)
        [POSITION_CHANGE_REASON.ADJUSTMENT]: 'Colaborador readaptado de cargo com sucesso.',
        // CORRECTION = Reenquadramento (plano de cargos)
        [POSITION_CHANGE_REASON.CORRECTION]: 'Colaborador reenquadrado com sucesso.',
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

  // =========================================================================
  // Historical salary resolution (Part F — o pedido explícito do dono)
  //
  //   salário(user, data) = cargo ocupado em `data` (UserPositionHistory)
  //                         × MonetaryValue do cargo vigente em `data`
  //                           (max effectiveDate ≤ data)
  //
  // Sem campo de salário em User. Resolve a janela [startedAt, endedAt) do
  // histórico; se o usuário nunca trocou de cargo (histórico vazio) cai para o
  // cargo atual; trata data anterior ao primeiro registro, cargo sem
  // remuneração e usuário sem cargo.
  // =========================================================================

  /**
   * Resolve a remuneração que UM colaborador tinha numa data específica.
   * @param userId colaborador
   * @param date   data de competência
   */
  async getUserSalaryAt(userId: string, date: Date): Promise<UserSalaryAtResult> {
    const map = await this.getUsersSalaryAt([userId], date);
    return (
      map.get(userId) ?? {
        userId,
        date,
        positionId: null,
        positionName: null,
        salary: null,
        effectiveDate: null,
        source: 'NONE',
        reason: 'Colaborador não encontrado.',
      }
    );
  }

  /**
   * Variante em lote (performance para estatísticas). Faz no máximo 3 queries
   * independentemente da quantidade de usuários:
   *   1) janelas de histórico que cobrem `date` para todos os userIds
   *   2) cargo atual dos usuários sem janela de histórico (fallback)
   *   3) MonetaryValue vigente (≤ date) dos cargos envolvidos
   * Devolve um Map<userId, UserSalaryAtResult>.
   */
  async getUsersSalaryAt(
    userIds: string[],
    date: Date,
  ): Promise<Map<string, UserSalaryAtResult>> {
    const result = new Map<string, UserSalaryAtResult>();
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return result;

    // 1) Janela de histórico cobrindo a data: startedAt ≤ date < endedAt
    //    (endedAt null = ainda aberta). Ordena por startedAt desc e pega a
    //    primeira por usuário (mais recente que ainda cobre a data).
    const historyRows = await this.prisma.userPositionHistory.findMany({
      where: {
        userId: { in: uniqueIds },
        startedAt: { lte: date },
        OR: [{ endedAt: null }, { endedAt: { gt: date } }],
      },
      orderBy: { startedAt: 'desc' },
      select: { userId: true, positionId: true, startedAt: true },
    });

    const positionByUser = new Map<string, { positionId: string | null; source: UserSalaryAtResult['source'] }>();
    for (const row of historyRows) {
      // primeira ocorrência (startedAt mais recente) vence
      if (!positionByUser.has(row.userId)) {
        positionByUser.set(row.userId, { positionId: row.positionId, source: 'HISTORY' });
      }
    }

    // 2) Fallback: usuários sem janela de histórico cobrindo a data.
    //    Se o usuário tem QUALQUER histórico mas nenhum cobre a data, a data é
    //    anterior ao primeiro vínculo de cargo → sem cargo na data (NONE).
    //    Se o usuário não tem NENHUM histórico, usamos o cargo atual (muitos
    //    colaboradores nunca trocaram de cargo e não têm linha de histórico).
    const missing = uniqueIds.filter(id => !positionByUser.has(id));
    if (missing.length > 0) {
      const anyHistory = await this.prisma.userPositionHistory.groupBy({
        by: ['userId'],
        where: { userId: { in: missing } },
        _count: { _all: true },
      });
      const hasHistory = new Set(anyHistory.map(h => h.userId));

      const fallbackUsers = await this.prisma.user.findMany({
        where: { id: { in: missing } },
        select: { id: true, positionId: true, createdAt: true },
      });
      const userById = new Map(fallbackUsers.map(u => [u.id, u]));

      for (const id of missing) {
        const u = userById.get(id);
        if (!u) {
          result.set(id, {
            userId: id,
            date,
            positionId: null,
            positionName: null,
            salary: null,
            effectiveDate: null,
            source: 'NONE',
            reason: 'Colaborador não encontrado.',
          });
          continue;
        }
        if (hasHistory.has(id)) {
          // Tem histórico, mas nenhuma janela cobre a data → data anterior ao
          // primeiro cargo registrado.
          result.set(id, {
            userId: id,
            date,
            positionId: null,
            positionName: null,
            salary: null,
            effectiveDate: null,
            source: 'NONE',
            reason: 'Data anterior ao primeiro registro de cargo do colaborador.',
          });
        } else {
          // Sem histórico: usa o cargo atual como melhor aproximação.
          positionByUser.set(id, { positionId: u.positionId, source: 'CURRENT_POSITION' });
        }
      }
    }

    // 3) MonetaryValue vigente em `date` para cada cargo envolvido.
    const positionIds = [
      ...new Set(
        Array.from(positionByUser.values())
          .map(v => v.positionId)
          .filter((p): p is string => !!p),
      ),
    ];

    const valueByPosition = new Map<string, { value: number; effectiveDate: Date }>();
    const nameByPosition = new Map<string, string>();

    if (positionIds.length > 0) {
      const [monetaryValues, positions] = await Promise.all([
        this.prisma.monetaryValue.findMany({
          where: { positionId: { in: positionIds }, effectiveDate: { lte: date } },
          orderBy: { effectiveDate: 'desc' },
          select: { positionId: true, value: true, effectiveDate: true },
        }),
        this.prisma.position.findMany({
          where: { id: { in: positionIds } },
          select: { id: true, name: true },
        }),
      ]);

      for (const p of positions) nameByPosition.set(p.id, p.name);

      // primeira por cargo (effectiveDate mais recente ≤ date) vence
      for (const mv of monetaryValues) {
        if (mv.positionId && !valueByPosition.has(mv.positionId)) {
          valueByPosition.set(mv.positionId, {
            value: mv.value,
            effectiveDate: mv.effectiveDate,
          });
        }
      }
    }

    // Montagem final
    for (const id of uniqueIds) {
      if (result.has(id)) continue; // já resolvido como NONE/erro acima
      const resolved = positionByUser.get(id);
      if (!resolved || !resolved.positionId) {
        result.set(id, {
          userId: id,
          date,
          positionId: null,
          positionName: null,
          salary: null,
          effectiveDate: null,
          source: resolved?.source ?? 'NONE',
          reason: 'Colaborador sem cargo definido na data.',
        });
        continue;
      }
      const positionId = resolved.positionId;
      const mv = valueByPosition.get(positionId);
      result.set(id, {
        userId: id,
        date,
        positionId,
        positionName: nameByPosition.get(positionId) ?? null,
        salary: mv ? mv.value : null,
        effectiveDate: mv ? mv.effectiveDate : null,
        source: resolved.source,
        reason: mv ? undefined : 'Cargo sem remuneração vigente na data.',
      });
    }

    return result;
  }
}
