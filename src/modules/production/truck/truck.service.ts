import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import type { TruckUpdateFormData } from '../../../schemas/truck';
import {
  GARAGE_CONFIGS,
  GARAGE_CONFIG,
  parseSpot,
  getGarageSpots,
  calculateTruckGarageLength,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

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
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
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
        spotsOccupiedInV1V2 < maxSpotsInTaskForm &&
        totalRequiredSpace <= config.laneLength;

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

    // Use transaction to update all trucks atomically and log changes
    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Collect all target spots and truck IDs in this batch
      const batchTruckIds = new Set(updates.map((u) => u.truckId));
      const targetSpots = updates
        .map((u) => u.spot)
        .filter((s): s is string => s !== null);

      // Clear conflicting spots: any OTHER truck (not in this batch) that occupies
      // a spot we're about to assign should have its spot cleared.
      // This prevents duplicate trucks sharing the same spot.
      if (targetSpots.length > 0) {
        const conflictingTrucks = await tx.truck.findMany({
          where: {
            spot: { in: targetSpots as any },
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
        }
      }
    });

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
}
