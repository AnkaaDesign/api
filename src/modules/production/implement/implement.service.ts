import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import type {
  ImplementGetManyFormData,
  ImplementUpdateFormData,
} from '../../../schemas/implement';
import {
  GARAGE_CONFIGS,
  GARAGE_CONFIG,
  parseSpot,
  getGarageSpots,
  calculateTruckGarageLength,
  isYardSpot,
  isGarageSpot,
  getGarageForSectorName,
  getSectorNameForGarage,
  getSpotLabel,
  type GarageId,
  type LaneId,
  type SpotNumber,
} from '../../../constants/garage';
import { trackAndLogFieldChanges } from '@modules/common/changelog/utils/changelog-helpers';
import { ENTITY_TYPE, CHANGE_TRIGGERED_BY } from '@constants';
import type { PrismaTransaction } from '@modules/common/base/base.repository';

/**
 * Disponibilidade do barracão, no vocabulário novo. O alias da rota velha devolve as
 * chaves que o web e o app instalados leem (`legacyGarageAvailability`).
 */
export interface SpotOccupant {
  spotNumber: SpotNumber;
  implementId: string;
  taskName: string | null;
  implementLength: number;
}

export interface LaneAvailability {
  laneId: LaneId;
  availableSpace: number;
  currentImplements: number;
  canFit: boolean;
  nextSpotNumber: SpotNumber | null;
  occupiedSpots: SpotNumber[];
  spotOccupants: SpotOccupant[]; // Details about who occupies each spot
}

export interface GarageAvailability {
  garageId: GarageId;
  totalSpots: number;
  occupiedSpots: number;
  canFit: boolean;
  lanes: LaneAvailability[];
}

/**
 * Campo do implemento → chave de NOTIFICAÇÃO `task.field.truck.<campo>` (D-04:
 * as chaves persistidas em NotificationConfiguration e nas preferências de
 * silenciar NÃO mudam). Mapa explícito: montar a chave pelo nome novo
 * (`task.field.implement.type`) deixaria a notificação muda (G9).
 */
export const IMPLEMENT_FIELD_NOTIFICATION_KEY: Readonly<Record<string, string>> = {
  plate: 'truck.plate',
  chassisNumber: 'truck.chassisNumber',
  vinPlateId: 'truck.vinPlateId',
  category: 'truck.category',
  type: 'truck.implementType',
  spot: 'truck.spot',
};

@Injectable()
export class ImplementService {
  private readonly logger = new Logger(ImplementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly notificationDispatchService: NotificationDispatchService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  /**
   * Campos do implemento acompanhados na trilha e na notificação. O
   * TaskFieldTrackerService emite os MESMOS eventos quando o implemento muda pela
   * tarefa; aqui os caminhos avulsos (update / batchUpdateSpots) fazem igual,
   * com a chave de notificação de `IMPLEMENT_FIELD_NOTIFICATION_KEY`.
   */
  private static readonly TRACKED_FIELDS = [
    'plate',
    'chassisNumber',
    'vinPlateId',
    'category',
    'type',
    'spot',
  ] as const;

  /**
   * Um 'task.field.changed' por campo do implemento que mudou, para a tarefa dona
   * — o mesmo que o TaskFieldTrackerService emite —, e o task.listener.ts despacha
   * `task.field.${event.field}` com a chave de `IMPLEMENT_FIELD_NOTIFICATION_KEY`.
   *
   * Roda DEPOIS do commit; falha de notificação nunca derruba a gravação.
   */
  private async emitImplementTaskFieldChanges(
    implementId: string,
    changes: Array<{ field: string; oldValue: any; newValue: any }>,
    userId?: string,
  ): Promise<void> {
    if (changes.length === 0) return;

    try {
      const implement = await this.prisma.implement.findUnique({
        where: { id: implementId },
        select: {
          taskId: true,
          task: {
            select: { id: true, name: true, serialNumber: true, sectorId: true, status: true },
          },
        },
      });

      if (!implement?.task) {
        // Sem tarefa dona: nada a notificar (a trilha do implemento já foi gravada).
        return;
      }

      const task = implement.task;
      const changedBy = userId || 'system';

      for (const change of changes) {
        this.eventEmitter.emit('task.field.changed', {
          task,
          field: IMPLEMENT_FIELD_NOTIFICATION_KEY[change.field],
          oldValue: change.oldValue,
          newValue: change.newValue,
          changedBy,
          isFileArray: false,
        });
      }
    } catch (error) {
      this.logger.warn(
        `[emitImplementTaskFieldChanges] Failed to emit task.field.changed for implement ${implementId}:`,
        error,
      );
    }
  }

  /**
   * Lista. O `include`/`where`/`orderBy` já passaram pelo zod estrito e pelo G1
   * (queryModel 'Implement'). Sem `limit`, devolve todos (o que o barracão pede).
   */
  async findAll(query: Partial<ImplementGetManyFormData> = {}) {
    const take = query.limit;
    const skip = take ? ((query.page ?? 1) - 1) * take : undefined;
    const [data, total] = await Promise.all([
      this.prisma.implement.findMany({
        where: query.where,
        orderBy: query.orderBy as any,
        include: query.include as any,
        ...(take ? { take, skip } : {}),
      }),
      take ? this.prisma.implement.count({ where: query.where }) : Promise.resolve(undefined),
    ]);
    return { data, total };
  }

  async findById(id: string, include?: Record<string, unknown>) {
    return this.prisma.implement.findUnique({
      where: { id },
      include: include as any,
    });
  }

  async update(
    id: string,
    data: ImplementUpdateFormData,
    include?: Record<string, unknown>,
    userId?: string,
  ) {
    const existing = await this.prisma.implement.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Implemento ${id} não encontrado`);
    }

    // Use transaction to update and log changes
    const updated = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const updated = await tx.implement.update({
        where: { id },
        data: {
          ...(data.spot !== undefined && { spot: data.spot }),
          ...(data.plate !== undefined && { plate: data.plate }),
          ...(data.chassisNumber !== undefined && { chassisNumber: data.chassisNumber }),
          ...(data.vinPlateId !== undefined && { vinPlateId: data.vinPlateId }),
          ...(data.category !== undefined && { category: data.category }),
          ...(data.type !== undefined && { type: data.type }),
        },
        include: include as any,
      });

      // Log changes
      await trackAndLogFieldChanges({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.TRUCK,
        entityId: id,
        oldEntity: existing,
        newEntity: updated,
        fieldsToTrack: [...ImplementService.TRACKED_FIELDS],
        userId: userId || '',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        transaction: tx,
      });

      return updated;
    });

    // Depois do commit: os eventos task.field.changed de cada campo que mudou, para o
    // task.listener.ts disparar as notificações task.field.truck.* (chaves mantidas).
    const fieldChanges = ImplementService.TRACKED_FIELDS.filter(
      field => (existing as any)[field] !== (updated as any)[field],
    ).map(field => ({
      field,
      oldValue: (existing as any)[field],
      newValue: (updated as any)[field],
    }));
    await this.emitImplementTaskFieldChanges(id, fieldChanges, userId);

    return updated;
  }

  /**
   * Disponibilidade das faixas de um barracão para um implemento de dado comprimento
   * (seletor de vaga).
   */
  async getLaneAvailability(
    garageId: GarageId,
    implementLength: number,
    excludeImplementId?: string,
  ): Promise<LaneAvailability[]> {
    const config = GARAGE_CONFIGS[garageId];
    const lanes: LaneId[] = ['F1', 'F2', 'F3'];

    // Get all valid spots for this garage
    const garageSpots = getGarageSpots(garageId);

    // Implementos no barracão, com as seções da medida (comprimento) e a tarefa
    const implementsInGarage = await this.prisma.implement.findMany({
      where: {
        spot: {
          in: garageSpots,
        },
        ...(excludeImplementId && { id: { not: excludeImplementId } }),
      },
      include: {
        leftSideMeasure: {
          include: { sections: true },
        },
        rightSideMeasure: {
          include: { sections: true },
        },
        task: {
          select: { name: true },
        },
      },
    });

    // Comprimento de cada um pelas seções da medida lateral
    const withLengths = implementsInGarage.map(implement => {
      // Use left or right side implementMeasure to calculate length
      const implementMeasure = implement.leftSideMeasure || implement.rightSideMeasure;
      let length: number = GARAGE_CONFIG.MIN_TRUCK_LENGTH; // Default minimum

      if (implementMeasure?.sections) {
        const sectionsSum = implementMeasure.sections.reduce((sum, s) => sum + s.width, 0);
        // comprimento total com a cabine (sistema de duas faixas)
        length = calculateTruckGarageLength(sectionsSum);
      }

      const parsed = parseSpot(implement.spot! as any);
      // Get active task name if available
      const taskName = implement.task?.name || null;

      return {
        id: implement.id,
        spot: implement.spot,
        lane: parsed.lane,
        spotNumber: parsed.spotNumber,
        length,
        taskName,
      };
    });

    // Calculate availability for each lane
    const maxSpotsInTaskForm = 2; // Task form only uses V1 and V2

    return lanes.map(laneId => {
      const inLane = withLengths.filter(t => t.lane === laneId);
      const occupiedSpots = inLane
        .map(t => t.spotNumber)
        .filter((s): s is SpotNumber => s !== null)
        .sort((a, b) => a - b);

      // Build spot occupants list with task names
      const spotOccupants: SpotOccupant[] = inLane
        .filter(t => t.spotNumber !== null)
        .map(t => ({
          spotNumber: t.spotNumber!,
          implementId: t.id,
          taskName: t.taskName,
          implementLength: Math.round(t.length * 100) / 100,
        }));

      // Calculate total occupied length
      const totalOccupiedLength = inLane.reduce((sum, t) => sum + t.length, 0);

      // Calculate gaps - must match garage view logic:
      // - 1 veículo: sem folga (só V1 no topo)
      // - 2 veículos: sem folga obrigatória (V1 no topo, V2 embaixo)
      // - 3 veículos: 2 m de folga (V2 no meio, 1 m de cada lado)
      const currentGaps = inLane.length === 3 ? 2 * GARAGE_CONFIG.TRUCK_MIN_SPACING : 0;
      const margins = 2 * 0.2; // 0.4m total (small margin at top and bottom)

      // Available space = lane length - occupied - margins - current gaps
      const currentOccupied = totalOccupiedLength + margins + currentGaps;
      const availableSpace = Math.max(0, config.laneLength - currentOccupied);

      // Count only V1/V2 occupancy for task form (max 2 spots)
      const spotsOccupiedInV1V2 = occupiedSpots.filter(s => s <= 2).length;

      // O novo caberia?
      const newCount = inLane.length + 1;
      const newTotalLength = totalOccupiedLength + implementLength;
      // folgas depois de acrescentá-lo
      const newGaps = newCount === 3 ? 2 * GARAGE_CONFIG.TRUCK_MIN_SPACING : 0;
      const totalRequiredSpace = newTotalLength + margins + newGaps;

      // cabe em V1 ou V2 (caso normal)
      const canFitInV1V2 =
        spotsOccupiedInV1V2 < maxSpotsInTaskForm && totalRequiredSpace <= config.laneLength;

      // cabe em V3 (V1 e V2 ocupadas, veículos pequenos)
      const v3IsOccupied = occupiedSpots.includes(3 as SpotNumber);
      const canFitInV3 =
        spotsOccupiedInV1V2 >= maxSpotsInTaskForm &&
        !v3IsOccupied &&
        totalRequiredSpace <= config.laneLength;

      const canFit = canFitInV1V2 || canFitInV3;

      // Find next available spot number
      let nextSpotNumber: SpotNumber | null = null;
      if (canFitInV1V2) {
        for (let i = 1; i <= maxSpotsInTaskForm; i++) {
          if (!occupiedSpots.includes(i as SpotNumber)) {
            nextSpotNumber = i as SpotNumber;
            break;
          }
        }
      } else if (canFitInV3) {
        nextSpotNumber = 3 as SpotNumber;
      }

      return {
        laneId,
        availableSpace: Math.round(availableSpace * 100) / 100, // Round to 2 decimals
        currentImplements: inLane.length,
        canFit,
        nextSpotNumber,
        occupiedSpots,
        spotOccupants,
      };
    });
  }

  /**
   * Vagas de vários implementos numa transação (o "Salvar" do barracão).
   */
  async batchUpdateSpots(
    updates: Array<{ implementId: string; spot: string | null }>,
    userId?: string,
  ): Promise<{ success: boolean; updated: number }> {
    if (updates.length === 0) {
      return { success: true, updated: 0 };
    }

    // spot null = saiu das instalações

    // Mudanças de vaga, para os eventos task.field.changed DEPOIS do commit
    // (notificação `task.field.truck.spot`, chave mantida).
    const spotChanges: Array<{ implementId: string; oldValue: any; newValue: any }> = [];

    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // vagas-alvo e implementos deste lote
      const batchImplementIds = new Set(updates.map(u => u.implementId));
      const targetSpots = updates.map(u => u.spot).filter((s): s is string => s !== null);

      // Quem (fora do lote) ocupa uma vaga que vamos atribuir perde a vaga: dois
      // implementos nunca dividem a mesma vaga. Pátio fica fora (cabe vários).
      const nonYardTargetSpots = targetSpots.filter(s => !isYardSpot(s));
      if (nonYardTargetSpots.length > 0) {
        const occupants = await tx.implement.findMany({
          where: {
            spot: { in: nonYardTargetSpots as any },
            id: { notIn: Array.from(batchImplementIds) },
          },
        });

        for (const conflicting of occupants) {
          await tx.implement.update({
            where: { id: conflicting.id },
            data: { spot: null },
          });

          await trackAndLogFieldChanges({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.TRUCK,
            entityId: conflicting.id,
            oldEntity: conflicting,
            newEntity: { ...conflicting, spot: null },
            fieldsToTrack: ['spot'],
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
            transaction: tx,
          });
        }
      }

      // Validate sector-garage matching for garage spots
      for (const update of updates) {
        if (!update.spot || isYardSpot(update.spot)) continue;
        if (!isGarageSpot(update.spot)) continue;

        const parsed = parseSpot(update.spot as any);
        if (!parsed.garage) continue;

        // a tarefa e o setor do implemento
        const withTask = await tx.implement.findUnique({
          where: { id: update.implementId },
          include: {
            task: {
              select: {
                id: true,
                sector: { select: { id: true, name: true } },
                sectorId: true,
              },
            },
          },
        });

        const task = withTask?.task;
        if (!task) continue;

        if (task.sector) {
          // Task has a sector — validate garage matches
          const expectedGarage = getGarageForSectorName(task.sector.name);
          if (expectedGarage && expectedGarage !== parsed.garage) {
            throw new BadRequestException(
              `Este caminhão pertence ao setor ${task.sector.name} e só pode ir no Barracão ${expectedGarage.slice(1)}`,
            );
          }
        } else if (!task.sectorId) {
          // Task has no sector — auto-assign matching sector
          const expectedSectorName = getSectorNameForGarage(parsed.garage);
          const sector = await tx.sector.findFirst({
            where: { name: { contains: expectedSectorName, mode: 'insensitive' } },
          });
          if (sector) {
            await tx.task.update({
              where: { id: task.id },
              data: { sectorId: sector.id },
            });
          }
        }
      }

      for (const update of updates) {
        // o implemento como está
        const existing = await tx.implement.findUnique({
          where: { id: update.implementId },
        });

        if (!existing) continue;

        const updated = await tx.implement.update({
          where: { id: update.implementId },
          data: { spot: update.spot as any },
        });

        // Log change only if spot actually changed
        if (existing.spot !== updated.spot) {
          await trackAndLogFieldChanges({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.TRUCK,
            entityId: update.implementId,
            oldEntity: existing,
            newEntity: updated,
            fieldsToTrack: ['spot'],
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            transaction: tx,
          });

          spotChanges.push({
            implementId: update.implementId,
            oldValue: existing.spot,
            newValue: updated.spot,
          });
        }
      }
    });

    // Depois do commit: um evento por implemento cuja vaga mudou (notificação
    // `task.field.truck.spot`). A vaga tirada de quem conflitava é efeito do sistema
    // e, de propósito, não notifica.
    for (const change of spotChanges) {
      await this.emitImplementTaskFieldChanges(
        change.implementId,
        [{ field: 'spot', oldValue: change.oldValue, newValue: change.newValue }],
        userId,
      );
    }

    return { success: true, updated: updates.length };
  }

  /**
   * Get availability for all garages
   */
  async getAllGaragesAvailability(
    implementLength: number,
    excludeImplementId?: string,
  ): Promise<GarageAvailability[]> {
    const garages: GarageId[] = ['B1', 'B2', 'B3'];

    const results = await Promise.all(
      garages.map(async garageId => {
        const lanes = await this.getLaneAvailability(garageId, implementLength, excludeImplementId);

        const totalSpots = 9; // 3 lanes x 3 spots
        const occupiedSpots = lanes.reduce((sum, l) => sum + l.currentImplements, 0);
        const canFit = lanes.some(l => l.canFit);

        return {
          garageId,
          totalSpots,
          occupiedSpots,
          canFit,
          lanes,
        };
      }),
    );

    return results;
  }

  /**
   * Pedido de movimentação (quem não move o implemento direto, como o gerente de
   * produção): notifica a logística. A chave `truck.movement_request` fica (D-04).
   */
  async requestMovement(
    data: {
      taskId: string;
      implementId: string;
      taskName?: string | null;
      fromSpot?: string | null;
      toSpot?: string | null;
    },
    userId: string,
  ): Promise<{ success: boolean }> {
    // Get the user who made the request
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    const fromLabel = getSpotLabel(data.fromSpot ?? null);
    const toLabel = getSpotLabel(data.toSpot ?? null);

    // Dispatch notification to logistics
    await this.notificationDispatchService.dispatchByConfiguration(
      'truck.movement_request',
      userId,
      {
        entityType: 'TRUCK',
        entityId: data.implementId,
        action: 'movement_request',
        data: {
          changedBy: user?.name || 'Usuário',
          taskName: data.taskName,
          taskId: data.taskId,
          fromSpot: fromLabel,
          toSpot: toLabel,
        },
        // 'TRUCK' isn't in the deep-link switch — the caminhão lives on the TASK
        // detail page, so point the tap there using the request's taskId.
        overrides: {
          webUrl: `/producao/cronograma/detalhes/${data.taskId}`,
          mobileUrl: `/(tabs)/producao/cronograma/detalhes/${data.taskId}`,
        },
      },
    );

    return { success: true };
  }
}
