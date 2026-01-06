import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { TruckUpdateFormData } from '../../../schemas/truck';
import {
  GARAGE_CONFIGS,
  GARAGE_CONFIG,
  parseSpot,
  getGarageSpots,
  type GarageId,
  type LaneId,
  type SpotNumber,
} from '../../../constants/garage';

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
  constructor(private readonly prisma: PrismaService) {}

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

  async update(id: string, data: TruckUpdateFormData, query?: any) {
    // Check if truck exists
    const existing = await this.prisma.truck.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Caminhao com id ${id} nao encontrado`);
    }

    return this.prisma.truck.update({
      where: { id },
      data: {
        ...(data.spot !== undefined && { spot: data.spot }),
        ...(data.plate !== undefined && { plate: data.plate }),
        ...(data.chassisNumber !== undefined && { chassisNumber: data.chassisNumber }),
        ...(data.serialNumber !== undefined && { serialNumber: data.serialNumber }),
      },
      include: query?.include,
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
      let length = GARAGE_CONFIG.MIN_TRUCK_LENGTH; // Default minimum

      if (layout?.layoutSections) {
        const sectionsSum = layout.layoutSections.reduce((sum, s) => sum + s.width, 0);
        // Add cabin if < 10m (same logic as calculateTruckGarageLength)
        length =
          sectionsSum < GARAGE_CONFIG.CABIN_THRESHOLD
            ? sectionsSum + GARAGE_CONFIG.CABIN_LENGTH
            : sectionsSum;
      }

      const parsed = parseSpot(truck.spot!);
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

      // Calculate required spacing (1m between trucks, small margin)
      const requiredSpacing =
        trucksInLane.length * GARAGE_CONFIG.TRUCK_MIN_SPACING +
        GARAGE_CONFIG.TRUCK_MIN_SPACING * 0.2; // Small margin at ends

      // Available space = lane length - occupied - spacing
      const availableSpace = Math.max(0, config.laneLength - totalOccupiedLength - requiredSpacing);

      // Count only V1/V2 occupancy for task form (max 2 spots)
      const spotsOccupiedInV1V2 = occupiedSpots.filter(s => s <= 2).length;

      // Check if truck can fit (needs space + minimum spacing)
      // Only consider V1/V2 spots for canFit (task form uses max 2 spots per lane)
      const canFit =
        spotsOccupiedInV1V2 < maxSpotsInTaskForm &&
        availableSpace >= truckLength + GARAGE_CONFIG.TRUCK_MIN_SPACING;

      // Find next available spot number (V1 or V2 only)
      let nextSpotNumber: SpotNumber | null = null;
      if (canFit) {
        for (let i = 1; i <= maxSpotsInTaskForm; i++) {
          if (!occupiedSpots.includes(i as SpotNumber)) {
            nextSpotNumber = i as SpotNumber;
            break;
          }
        }
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
  ): Promise<{ success: boolean; updated: number }> {
    if (updates.length === 0) {
      return { success: true, updated: 0 };
    }

    // Use transaction to update all trucks atomically
    await this.prisma.$transaction(
      updates.map(update =>
        this.prisma.truck.update({
          where: { id: update.truckId },
          data: { spot: update.spot },
        }),
      ),
    );

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
