import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import type { TruckUpdateFormData } from '../../../schemas/truck';
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

export interface SpotOccupant {
  spotNumber: SpotNumber;
  truckId: string;
  taskName: string | null;
  truckLength: number;
}

export interface LaneAvailability {
  laneId: LaneId;
  availableSpace: number;
  currentTrucks: number;
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

@Injectable()
export class TruckService {
  private readonly logger = new Logger(TruckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly notificationDispatchService: NotificationDispatchService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  /**
   * Truck scalar fields that map 1:1 to a tracked task field ('truck.<field>').
   * The TaskFieldTrackerService emits the SAME 'task.field.changed' events when a
   * truck is updated as part of a task; here we mirror those emits for the
   * standalone truck-update paths (update / batchUpdateSpots) so the existing
   * task.listener.ts handler dispatches 'task.field.truck.<field>' notifications.
   */
  private static readonly TRUCK_TRACKED_FIELDS = [
    'plate',
    'chassisNumber',
    'category',
    'implementType',
    'spot',
  ] as const;

  /**
   * Emit 'task.field.changed' events (one per changed truck field) for a truck's
   * owning task, mirroring the TaskFieldTrackerService output so task.listener.ts
   * dispatches the 'task.field.truck.<field>' notifications.
   *
   * Called AFTER the truck-update transaction commits. Wrapped in try/catch so a
   * notification failure never breaks the business flow.
   *
   * ASSUMPTION: task.listener.ts reads event.field as 'truck.plate' etc. and
   * dispatches `task.field.${event.field}`; the field tracker uses the EventEmitter
   * token 'EventEmitter' and the same 'task.field.changed' event name.
   */
  private async emitTruckTaskFieldChanges(
    truckId: string,
    changes: Array<{ field: string; oldValue: any; newValue: any }>,
    userId?: string,
  ): Promise<void> {
    if (changes.length === 0) return;

    try {
      const truck = await this.prisma.truck.findUnique({
        where: { id: truckId },
        select: {
          taskId: true,
          task: {
            select: { id: true, name: true, serialNumber: true, sectorId: true, status: true },
          },
        },
      });

      if (!truck?.task) {
        // No owning task -> nothing to notify (truck-level changelog already recorded).
        return;
      }

      const task = truck.task;
      const changedBy = userId || 'system';

      for (const change of changes) {
        this.eventEmitter.emit('task.field.changed', {
          task,
          field: `truck.${change.field}`,
          oldValue: change.oldValue,
          newValue: change.newValue,
          changedBy,
          isFileArray: false,
        });
      }
    } catch (error) {
      this.logger.warn(
        `[emitTruckTaskFieldChanges] Failed to emit task.field.changed for truck ${truckId}:`,
        error,
      );
    }
  }

  async findAll(query?: any) {
    return this.prisma.truck.findMany({
      include: query?.include,
    });
  }

  async findById(id: string, query?: any) {
    return this.prisma.truck.findUnique({
      where: { id },
      include: query?.include,
    });
  }

  async update(
    id: string,
    data: TruckUpdateFormData,
    query?: any,
    userId?: string,
    userPrivilege?: string,
  ) {
    // Check if truck exists
    const existing = await this.prisma.truck.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Caminhao com id ${id} nao encontrado`);
    }

    // Use transaction to update and log changes
    const updated = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Update truck
      const updated = await tx.truck.update({
        where: { id },
        data: {
          ...(data.spot !== undefined && { spot: data.spot }),
          ...(data.plate !== undefined && { plate: data.plate }),
          ...(data.chassisNumber !== undefined && { chassisNumber: data.chassisNumber }),
          ...(data.category !== undefined && { category: data.category }),
          ...(data.implementType !== undefined && { implementType: data.implementType }),
        },
        include: query?.include,
      });

      // Log changes
      await trackAndLogFieldChanges({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.TRUCK,
        entityId: id,
        oldEntity: existing,
        newEntity: updated,
        fieldsToTrack: ['plate', 'chassisNumber', 'category', 'implementType', 'spot'],
        userId: userId || '',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        transaction: tx,
      });

      return updated;
    });

    // After commit: mirror the TaskFieldTracker by emitting task.field.changed for
    // each changed truck field so task.listener.ts fires the truck.* notifications.
    const truckFieldChanges = TruckService.TRUCK_TRACKED_FIELDS.filter(
      field => (existing as any)[field] !== (updated as any)[field],
    ).map(field => ({
      field,
      oldValue: (existing as any)[field],
      newValue: (updated as any)[field],
    }));
    await this.emitTruckTaskFieldChanges(id, truckFieldChanges, userId);

    return updated;
  }

  /**
   * Calculate lane availability for a garage based on truck length
   * Used by the spot selector to show which lanes can fit a truck
   */
  async getLaneAvailability(
    garageId: GarageId,
    truckLength: number,
    excludeTruckId?: string,
  ): Promise<LaneAvailability[]> {
    const config = GARAGE_CONFIGS[garageId];
    const lanes: LaneId[] = ['F1', 'F2', 'F3'];

    // Get all valid spots for this garage
    const garageSpots = getGarageSpots(garageId);

    // Get all trucks in this garage with their layout sections and active task to calculate lengths
    const trucksInGarage = await this.prisma.truck.findMany({
      where: {
        spot: {
          in: garageSpots,
        },
        ...(excludeTruckId && { id: { not: excludeTruckId } }),
      },
      include: {
        leftSideLayout: {
          include: { layoutSections: true },
        },
        rightSideLayout: {
          include: { layoutSections: true },
        },
        task: {
          select: { name: true },
        },
      },
    });

    // Calculate truck lengths from layout sections
    const trucksWithLengths = trucksInGarage.map(truck => {
      // Use left or right side layout to calculate length
      const layout = truck.leftSideLayout || truck.rightSideLayout;
      let length: number = GARAGE_CONFIG.MIN_TRUCK_LENGTH; // Default minimum

      if (layout?.layoutSections) {
        const sectionsSum = layout.layoutSections.reduce((sum, s) => sum + s.width, 0);
        // Calculate full truck length with cabin using two-tier system
        length = calculateTruckGarageLength(sectionsSum);
      }

      const parsed = parseSpot(truck.spot! as any);
      // Get active task name if available
      const taskName = truck.task?.name || null;

      return {
        id: truck.id,
        spot: truck.spot,
        lane: parsed.lane,
        spotNumber: parsed.spotNumber,
        length,
        taskName,
      };
    });

    // Calculate availability for each lane
    const maxSpotsInTaskForm = 2; // Task form only uses V1 and V2

    return lanes.map(laneId => {
      const trucksInLane = trucksWithLengths.filter(t => t.lane === laneId);
      const occupiedSpots = trucksInLane
        .map(t => t.spotNumber)
        .filter((s): s is SpotNumber => s !== null)
        .sort((a, b) => a - b);

      // Build spot occupants list with task names
      const spotOccupants: SpotOccupant[] = trucksInLane
        .filter(t => t.spotNumber !== null)
        .map(t => ({
          spotNumber: t.spotNumber!,
          truckId: t.id,
          taskName: t.taskName,
          truckLength: Math.round(t.length * 100) / 100,
        }));

      // Calculate total occupied length
      const totalOccupiedLength = trucksInLane.reduce((sum, t) => sum + t.length, 0);

      // Calculate gaps - must match garage view logic:
      // - 1 truck: 0 gaps (just V1 at top)
      // - 2 trucks: 0 gaps (V1 at top, V2 at bottom, no mandatory gap between)
      // - 3 trucks: 2m gaps (V1 top, V2 middle with 1m gap on each side, V3 bottom)
      const currentGaps = trucksInLane.length === 3 ? 2 * GARAGE_CONFIG.TRUCK_MIN_SPACING : 0;
      const margins = 2 * 0.2; // 0.4m total (small margin at top and bottom)

      // Available space = lane length - occupied - margins - current gaps
      const currentOccupied = totalOccupiedLength + margins + currentGaps;
      const availableSpace = Math.max(0, config.laneLength - currentOccupied);

      // Count only V1/V2 occupancy for task form (max 2 spots)
      const spotsOccupiedInV1V2 = occupiedSpots.filter(s => s <= 2).length;

      // Calculate if the new truck would fit when added
      const newTruckCount = trucksInLane.length + 1;
      const newTotalLength = totalOccupiedLength + truckLength;
      // Gaps needed after adding the truck
      const newGaps = newTruckCount === 3 ? 2 * GARAGE_CONFIG.TRUCK_MIN_SPACING : 0;
      const totalRequiredSpace = newTotalLength + margins + newGaps;

      // Check if truck can fit in V1 or V2 (normal case)
      const canFitInV1V2 =
        spotsOccupiedInV1V2 < maxSpotsInTaskForm && totalRequiredSpace <= config.laneLength;

      // Check if truck can fit in V3 (special case: V1+V2 occupied, small trucks)
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
        currentTrucks: trucksInLane.length,
        canFit,
        nextSpotNumber,
        occupiedSpots,
        spotOccupants,
      };
    });
  }

  /**
   * Batch update multiple trucks' spots in a single transaction
   * Used by the garage view to save all pending changes at once
   */
  async batchUpdateSpots(
    updates: Array<{ truckId: string; spot: string | null }>,
    userId?: string,
  ): Promise<{ success: boolean; updated: number }> {
    if (updates.length === 0) {
      return { success: true, updated: 0 };
    }

    // Note: null spot means "remove from patio entirely" (truck left the facility)

    // Track spot changes so we can emit task.field.changed AFTER commit (mirroring
    // the TaskFieldTracker) and fire 'task.field.truck.spot' notifications.
    const spotChanges: Array<{ truckId: string; oldValue: any; newValue: any }> = [];

    // Use transaction to update all trucks atomically and log changes
    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Collect all target spots and truck IDs in this batch
      const batchTruckIds = new Set(updates.map(u => u.truckId));
      const targetSpots = updates.map(u => u.spot).filter((s): s is string => s !== null);

      // Clear conflicting spots: any OTHER truck (not in this batch) that occupies
      // a spot we're about to assign should have its spot cleared.
      // This prevents duplicate trucks sharing the same spot.
      // Exclude yard spots from conflict detection (multiple trucks can be in YARD_WAIT/YARD_EXIT)
      const nonYardTargetSpots = targetSpots.filter(s => !isYardSpot(s));
      if (nonYardTargetSpots.length > 0) {
        const conflictingTrucks = await tx.truck.findMany({
          where: {
            spot: { in: nonYardTargetSpots as any },
            id: { notIn: Array.from(batchTruckIds) },
          },
        });

        for (const conflicting of conflictingTrucks) {
          await tx.truck.update({
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

        // Fetch the truck's task and sector
        const truckWithTask = await tx.truck.findUnique({
          where: { id: update.truckId },
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

        const task = truckWithTask?.task;
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
        // Get existing truck
        const existing = await tx.truck.findUnique({
          where: { id: update.truckId },
        });

        if (!existing) continue;

        // Update truck
        const updated = await tx.truck.update({
          where: { id: update.truckId },
          data: { spot: update.spot as any },
        });

        // Log change only if spot actually changed
        if (existing.spot !== updated.spot) {
          await trackAndLogFieldChanges({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.TRUCK,
            entityId: update.truckId,
            oldEntity: existing,
            newEntity: updated,
            fieldsToTrack: ['spot'],
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            transaction: tx,
          });

          spotChanges.push({
            truckId: update.truckId,
            oldValue: existing.spot,
            newValue: updated.spot,
          });
        }
      }
    });

    // After commit: emit task.field.changed for each truck whose spot changed,
    // mirroring the TaskFieldTracker so 'task.field.truck.spot' notifications fire.
    // NOTE: conflicting-truck spot clears above are SYSTEM_GENERATED side effects and
    // intentionally NOT notified here (mirrors the single-item user-action semantics).
    for (const change of spotChanges) {
      await this.emitTruckTaskFieldChanges(
        change.truckId,
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
    truckLength: number,
    excludeTruckId?: string,
  ): Promise<GarageAvailability[]> {
    const garages: GarageId[] = ['B1', 'B2', 'B3'];

    const results = await Promise.all(
      garages.map(async garageId => {
        const lanes = await this.getLaneAvailability(garageId, truckLength, excludeTruckId);

        const totalSpots = 9; // 3 lanes x 3 spots
        const occupiedSpots = lanes.reduce((sum, l) => sum + l.currentTrucks, 0);
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
   * Request a truck movement (for production managers who can't directly move trucks)
   * Sends a notification to logistics team for approval
   */
  async requestMovement(
    data: {
      taskId: string;
      truckId: string;
      taskName: string;
      fromSpot: string | null;
      toSpot: string | null;
    },
    userId: string,
  ): Promise<{ success: boolean }> {
    // Get the user who made the request
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    const fromLabel = getSpotLabel(data.fromSpot);
    const toLabel = getSpotLabel(data.toSpot);

    // Dispatch notification to logistics
    await this.notificationDispatchService.dispatchByConfiguration(
      'truck.movement_request',
      userId,
      {
        entityType: 'TRUCK',
        entityId: data.truckId,
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
