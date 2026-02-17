// Garage layout calculation utilities
// Handles positioning trucks within garage lanes with proper spacing

import {
  GARAGE_CONFIG,
  GARAGES,
  type Garage,
  type GarageId,
  type Lane,
  type LaneId,
  parseSpot,
  calculateTruckGarageLength,
} from '@constants';
import { TRUCK_SPOT } from '@constants';

// =====================
// Types
// =====================

export interface TruckForLayout {
  id: string;
  spot: TRUCK_SPOT | null;
  // From task
  taskName?: string;
  serialNumber?: string | null;
  // From task.generalPainting
  paintHex?: string | null;
  // Calculated from layout sections
  length: number; // Already includes cabin if needed
}

export interface PositionedTruck extends TruckForLayout {
  // Position within the lane (in meters from top of lane)
  yPosition: number;
  // Lane x position (in meters from left of garage)
  xPosition: number;
}

export interface LaneWithTrucks {
  lane: Lane;
  trucks: PositionedTruck[];
  totalOccupiedLength: number;
  remainingLength: number;
}

export interface GarageWithTrucks {
  garage: Garage;
  lanes: LaneWithTrucks[];
}

// =====================
// Layout Algorithm
// =====================

/**
 * Group trucks by their lane within a garage
 */
function groupTrucksByLane(
  trucks: TruckForLayout[],
  garageId: GarageId,
): Map<LaneId, TruckForLayout[]> {
  const laneMap = new Map<LaneId, TruckForLayout[]>();

  // Initialize empty arrays for each lane
  (['F1', 'F2', 'F3'] as LaneId[]).forEach(laneId => {
    laneMap.set(laneId, []);
  });

  trucks.forEach(truck => {
    if (!truck.spot) return;

    const parsed = parseSpot(truck.spot);
    if (parsed.garage === garageId && parsed.lane) {
      const laneTrucks = laneMap.get(parsed.lane) || [];
      laneTrucks.push(truck);
      laneMap.set(parsed.lane, laneTrucks);
    }
  });

  return laneMap;
}

/**
 * Sort trucks by spot number (1, 2, 3)
 */
function sortTrucksBySpotNumber(trucks: TruckForLayout[]): TruckForLayout[] {
  return [...trucks].sort((a, b) => {
    const aSpot = parseSpot(a.spot!);
    const bSpot = parseSpot(b.spot!);
    return (aSpot.spotNumber || 0) - (bSpot.spotNumber || 0);
  });
}

/**
 * Calculate truck positions within a lane using justify-between spacing
 *
 * Rules:
 * - First truck is always at the top (y=0)
 * - If there's space for another truck after all current trucks, use minimum spacing
 * - Otherwise, distribute trucks with justify-between spacing
 * - Minimum spacing between trucks is 2m
 */
export function calculateLaneLayout(lane: Lane, trucks: TruckForLayout[]): LaneWithTrucks {
  const sortedTrucks = sortTrucksBySpotNumber(trucks);
  const positionedTrucks: PositionedTruck[] = [];

  if (sortedTrucks.length === 0) {
    return {
      lane,
      trucks: [],
      totalOccupiedLength: 0,
      remainingLength: lane.length,
    };
  }

  // Calculate total occupied length (trucks + minimum spacing)
  const totalTruckLength = sortedTrucks.reduce((sum, t) => sum + t.length, 0);
  const minTotalSpacing = (sortedTrucks.length - 1) * GARAGE_CONFIG.TRUCK_MIN_SPACING;
  const minOccupiedLength = totalTruckLength + minTotalSpacing;
  const remainingLength = lane.length - minOccupiedLength;

  // Check if there's enough space for another minimum truck
  const canFitAnotherTruck =
    remainingLength >= GARAGE_CONFIG.MIN_TRUCK_LENGTH + GARAGE_CONFIG.TRUCK_MIN_SPACING;

  // Calculate spacing between trucks
  let spacing: number;
  if (canFitAnotherTruck || sortedTrucks.length === 1) {
    // Use minimum spacing (stick together)
    spacing = GARAGE_CONFIG.TRUCK_MIN_SPACING;
  } else {
    // Justify-between: distribute extra space evenly
    const extraSpace = lane.length - totalTruckLength;
    spacing = extraSpace / (sortedTrucks.length - 1 || 1);
  }

  // Position trucks
  let currentY = 0;
  sortedTrucks.forEach((truck, index) => {
    positionedTrucks.push({
      ...truck,
      yPosition: currentY,
      xPosition: lane.xPosition,
    });
    currentY += truck.length + (index < sortedTrucks.length - 1 ? spacing : 0);
  });

  return {
    lane,
    trucks: positionedTrucks,
    totalOccupiedLength: minOccupiedLength,
    remainingLength: Math.max(0, lane.length - minOccupiedLength),
  };
}

/**
 * Calculate the full garage layout with all trucks positioned
 */
export function calculateGarageLayout(
  garageId: GarageId,
  trucks: TruckForLayout[],
): GarageWithTrucks {
  const garage = GARAGES.find(g => g.id === garageId);
  if (!garage) {
    throw new Error(`Garage ${garageId} not found`);
  }

  const trucksByLane = groupTrucksByLane(trucks, garageId);
  const lanesWithTrucks: LaneWithTrucks[] = [];

  garage.lanes.forEach(lane => {
    const laneTrucks = trucksByLane.get(lane.id) || [];
    lanesWithTrucks.push(calculateLaneLayout(lane, laneTrucks));
  });

  return {
    garage,
    lanes: lanesWithTrucks,
  };
}

// =====================
// Patio Layout
// =====================

export interface PatioLayout {
  trucks: PositionedTruck[];
  width: number;
  height: number;
  columns: number;
  rows: number;
}

/**
 * Calculate patio layout for trucks not assigned to a garage
 * Creates a dynamic grid based on the number of trucks
 */
export function calculatePatioLayout(trucks: TruckForLayout[]): PatioLayout {
  const patioTrucks = trucks.filter(t => !t.spot);

  if (patioTrucks.length === 0) {
    return {
      trucks: [],
      width: 0,
      height: 0,
      columns: 0,
      rows: 0,
    };
  }

  // Calculate optimal grid layout
  // Assume standard truck length of 12m and width of 2.8m with 2m spacing
  const avgTruckLength = patioTrucks.reduce((sum, t) => sum + t.length, 0) / patioTrucks.length;
  const truckWidth = GARAGE_CONFIG.TRUCK_WIDTH_TOP_VIEW;
  const spacing = GARAGE_CONFIG.TRUCK_MIN_SPACING;

  // Calculate columns to fit in a reasonable width (similar to garage width)
  const targetWidth = GARAGE_CONFIG.GARAGE_WIDTH;
  const columns = Math.max(1, Math.floor(targetWidth / (truckWidth + spacing)));
  const rows = Math.ceil(patioTrucks.length / columns);

  // Position trucks in grid
  const positionedTrucks: PositionedTruck[] = patioTrucks.map((truck, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...truck,
      xPosition: col * (truckWidth + spacing) + spacing,
      yPosition: row * (avgTruckLength + spacing) + spacing,
    };
  });

  const totalWidth = columns * (truckWidth + spacing) + spacing;
  const totalHeight = rows * (avgTruckLength + spacing) + spacing;

  return {
    trucks: positionedTrucks,
    width: totalWidth,
    height: totalHeight,
    columns,
    rows,
  };
}

// =====================
// Validation
// =====================

/**
 * Check if a truck can fit in a specific lane
 */
export function canTruckFitInLane(
  truckLength: number,
  lane: Lane,
  existingTrucks: TruckForLayout[],
  excludeTruckId?: string,
): boolean {
  const trucksInLane = existingTrucks.filter(t => t.id !== excludeTruckId);

  if (trucksInLane.length >= GARAGE_CONFIG.MAX_TRUCKS_PER_LANE) {
    return false;
  }

  const totalOccupiedLength = trucksInLane.reduce((sum, t) => sum + t.length, 0);
  const newTruckCount = trucksInLane.length + 1;
  const newTotalLength = totalOccupiedLength + truckLength;
  // Only add gaps when 3 trucks: 2 × 1m = 2m (1m gap on each side of middle truck)
  const gaps = newTruckCount === 3 ? 2 * GARAGE_CONFIG.TRUCK_MIN_SPACING : 0;
  const margins = 2 * 0.2; // 0.4m total (small margin at top and bottom)

  return newTotalLength + margins + gaps <= lane.length;
}

/**
 * Get the next available spot in a lane
 */
export function getNextAvailableSpot(
  garageId: GarageId,
  laneId: LaneId,
  existingTrucks: TruckForLayout[],
): TRUCK_SPOT | null {
  const trucksInLane = existingTrucks.filter(t => {
    if (!t.spot) return false;
    const parsed = parseSpot(t.spot);
    return parsed.garage === garageId && parsed.lane === laneId;
  });

  const occupiedSpots = new Set(trucksInLane.map(t => parseSpot(t.spot!).spotNumber));

  for (let spotNum = 1; spotNum <= GARAGE_CONFIG.MAX_TRUCKS_PER_LANE; spotNum++) {
    if (!occupiedSpots.has(spotNum as 1 | 2 | 3)) {
      const spotKey = `${garageId}_${laneId}${spotNum}` as keyof typeof TRUCK_SPOT;
      return TRUCK_SPOT[spotKey];
    }
  }

  return null;
}
