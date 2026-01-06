// Static garage configuration for the truck painting company
// Garages (Barracões) are static - they never change

import { TRUCK_SPOT } from './enums';

// =====================
// Garage Dimensions (in meters)
// =====================

// Individual garage configurations with real measurements
// All garages standardized to 20m × 35m for consistency with minimal waste
// Lane lengths are preserved to maintain truck positioning accuracy
export const GARAGE_CONFIGS = {
  B1: {
    width: 20, // meters (standardized)
    length: 35, // meters (standardized from 30m)
    paddingTop: 3, // meters - back margin from top
    paddingBottom: 7.4, // meters - front margin from bottom (adjusted)
    laneLength: 24.6, // meters (preserved: 35 - 3 - 7.4)
    laneWidth: 3, // meters
    laneSpacing: 2.75, // meters between lanes (calculated: (20 - 3*3) / 4 = 2.75)
    lanePaddingX: 2.75, // meters from left edge to first lane
  },
  B2: {
    width: 20, // meters (standardized from 18.5m)
    length: 35, // meters (standardized from 30.5m)
    paddingTop: 3, // meters - back margin from top
    paddingBottom: 7.5, // meters - front margin from bottom (adjusted)
    laneLength: 24.5, // meters (preserved: 35 - 3 - 7.5)
    laneWidth: 3, // meters
    laneSpacing: 2.75, // meters between lanes (standardized: (20 - 3*3) / 4 = 2.75)
    lanePaddingX: 2.75, // meters from left edge to first lane (standardized)
  },
  B3: {
    width: 20, // meters (standardized)
    length: 35, // meters (standardized from 40m)
    paddingTop: 3, // meters - back margin from top
    paddingBottom: 2, // meters - front margin from bottom (reduced from 7m)
    laneLength: 30, // meters (preserved: 35 - 3 - 2)
    laneWidth: 3, // meters
    laneSpacing: 2.75, // meters between lanes (calculated: (20 - 3*3) / 4 = 2.75)
    lanePaddingX: 2.75, // meters from left edge to first lane
  },
} as const;

// Legacy GARAGE_CONFIG for backward compatibility (uses B1 values as default)
export const GARAGE_CONFIG = {
  // Garage dimensions
  GARAGE_LENGTH: 45, // meters (along the lanes) - DEPRECATED: Use GARAGE_CONFIGS[garageId].length
  GARAGE_WIDTH: 25, // meters (across the lanes) - DEPRECATED: Use GARAGE_CONFIGS[garageId].width

  // Lane dimensions
  LANE_LENGTH: 35, // meters (truck capacity) - DEPRECATED: Use GARAGE_CONFIGS[garageId].laneLength
  LANE_WIDTH: 3, // meters (truck width in top view)

  // Spacing
  LANE_SPACING: 4, // meters between lanes and at edges - DEPRECATED: Use GARAGE_CONFIGS[garageId].laneSpacing
  TRUCK_MIN_SPACING: 1, // meters minimum between trucks

  // Truck dimensions
  TRUCK_WIDTH_TOP_VIEW: 2.8, // meters (width when viewed from top = truck's actual width)
  CABIN_LENGTH: 1.8, // meters (added to trucks < 10m) - average Brazilian cab (day cab ~1.5m, sleeper ~2.0m)
  CABIN_THRESHOLD: 10, // meters (trucks below this length need cabin added)

  // Limits
  MAX_TRUCKS_PER_LANE: 3,
  MIN_TRUCK_LENGTH: 5, // meters
} as const;

// =====================
// Lane Definitions
// =====================

export type GarageId = 'B1' | 'B2' | 'B3';
export type LaneId = 'F1' | 'F2' | 'F3';
export type SpotNumber = 1 | 2 | 3;

export interface Lane {
  id: LaneId;
  label: string;
  xPosition: number; // meters from left edge of garage
  length: number; // meters (same as LANE_LENGTH)
  width: number; // meters (same as LANE_WIDTH)
}

export interface Garage {
  id: GarageId;
  name: string;
  label: string;
  width: number;
  length: number;
  lanes: Lane[];
}

// Type for individual garage configuration
type GarageConfig = (typeof GARAGE_CONFIGS)[GarageId];

// Calculate lane positions based on garage-specific spacing
const calculateLaneXPosition = (laneIndex: number, garageConfig: GarageConfig): number => {
  // First lane starts at lanePaddingX from left edge
  // Each subsequent lane is laneWidth + laneSpacing apart
  return (
    garageConfig.lanePaddingX + laneIndex * (garageConfig.laneWidth + garageConfig.laneSpacing)
  );
};

// Helper function to create lanes for a specific garage
const createLanesForGarage = (garageId: GarageId): Lane[] => {
  const config = GARAGE_CONFIGS[garageId];
  return [
    {
      id: 'F1',
      label: 'Faixa 1',
      xPosition: calculateLaneXPosition(0, config),
      length: config.laneLength,
      width: config.laneWidth,
    },
    {
      id: 'F2',
      label: 'Faixa 2',
      xPosition: calculateLaneXPosition(1, config),
      length: config.laneLength,
      width: config.laneWidth,
    },
    {
      id: 'F3',
      label: 'Faixa 3',
      xPosition: calculateLaneXPosition(2, config),
      length: config.laneLength,
      width: config.laneWidth,
    },
  ];
};

// Legacy LANES constant (uses B1 configuration for backward compatibility)
export const LANES: Lane[] = createLanesForGarage('B1');

// =====================
// Garage Definitions
// =====================

export const GARAGES: Garage[] = [
  {
    id: 'B1',
    name: 'Barracão 1',
    label: 'B1',
    width: GARAGE_CONFIGS.B1.width,
    length: GARAGE_CONFIGS.B1.length,
    lanes: createLanesForGarage('B1'),
  },
  {
    id: 'B2',
    name: 'Barracão 2',
    label: 'B2',
    width: GARAGE_CONFIGS.B2.width,
    length: GARAGE_CONFIGS.B2.length,
    lanes: createLanesForGarage('B2'),
  },
  {
    id: 'B3',
    name: 'Barracão 3',
    label: 'B3',
    width: GARAGE_CONFIGS.B3.width,
    length: GARAGE_CONFIGS.B3.length,
    lanes: createLanesForGarage('B3'),
  },
];

// =====================
// Spot Helpers
// =====================

/**
 * Parse a TRUCK_SPOT enum value to extract garage, lane, and spot number
 */
export function parseSpot(spot: TRUCK_SPOT): {
  garage: GarageId | null;
  lane: LaneId | null;
  spotNumber: SpotNumber | null;
} {
  if (spot === TRUCK_SPOT.PATIO) {
    return { garage: null, lane: null, spotNumber: null };
  }

  // Format: B1_F1_V1, B2_F2_V2, etc.
  const match = spot.match(/^B(\d)_F(\d)_V(\d)$/);
  if (!match) {
    return { garage: null, lane: null, spotNumber: null };
  }

  return {
    garage: `B${match[1]}` as GarageId,
    lane: `F${match[2]}` as LaneId,
    spotNumber: parseInt(match[3], 10) as SpotNumber,
  };
}

/**
 * Build a TRUCK_SPOT enum value from garage, lane, and spot number
 */
export function buildSpot(garage: GarageId, lane: LaneId, spotNumber: SpotNumber): TRUCK_SPOT {
  const key = `${garage}_${lane}_V${spotNumber}` as keyof typeof TRUCK_SPOT;
  return TRUCK_SPOT[key];
}

/**
 * Get all spots for a specific garage
 */
export function getGarageSpots(garage: GarageId): TRUCK_SPOT[] {
  const prefix = `${garage}_`;
  return Object.values(TRUCK_SPOT).filter(
    spot => spot.startsWith(prefix) && spot !== TRUCK_SPOT.PATIO,
  );
}

/**
 * Get all spots for a specific lane in a garage
 */
export function getLaneSpots(garage: GarageId, lane: LaneId): TRUCK_SPOT[] {
  const prefix = `${garage}_${lane}`;
  return Object.values(TRUCK_SPOT).filter(spot => spot.startsWith(prefix));
}

/**
 * Get the garage configuration by ID
 */
export function getGarage(garageId: GarageId): Garage | undefined {
  return GARAGES.find(g => g.id === garageId);
}

/**
 * Get the lane configuration by ID within a garage
 */
export function getLane(garageId: GarageId, laneId: LaneId): Lane | undefined {
  const garage = getGarage(garageId);
  return garage?.lanes.find(l => l.id === laneId);
}

// =====================
// Truck Length Calculation
// =====================

/**
 * Calculate the actual length of a truck in the garage (top view)
 * The layout sections width sum represents the side view length
 * For trucks with total section width < 10m, add cabin length (2.8m)
 *
 * @param layoutSectionsWidthSum - Sum of all layout section widths (in meters)
 * @returns Actual truck length in the garage (in meters)
 */
export function calculateTruckGarageLength(layoutSectionsWidthSum: number): number {
  if (layoutSectionsWidthSum < GARAGE_CONFIG.CABIN_THRESHOLD) {
    return layoutSectionsWidthSum + GARAGE_CONFIG.CABIN_LENGTH;
  }
  return layoutSectionsWidthSum;
}

/**
 * Calculate the sum of layout sections widths from layout sections
 */
export function calculateLayoutSectionsSum(layoutSections: { width: number }[]): number {
  return layoutSections.reduce((sum, section) => sum + section.width, 0);
}

// =====================
// Spot Labels for Display
// =====================

export const SPOT_LABELS: Record<TRUCK_SPOT, string> = {
  // Garage 1
  [TRUCK_SPOT.B1_F1_V1]: 'B1-F1-V1',
  [TRUCK_SPOT.B1_F1_V2]: 'B1-F1-V2',
  [TRUCK_SPOT.B1_F1_V3]: 'B1-F1-V3',
  [TRUCK_SPOT.B1_F2_V1]: 'B1-F2-V1',
  [TRUCK_SPOT.B1_F2_V2]: 'B1-F2-V2',
  [TRUCK_SPOT.B1_F2_V3]: 'B1-F2-V3',
  [TRUCK_SPOT.B1_F3_V1]: 'B1-F3-V1',
  [TRUCK_SPOT.B1_F3_V2]: 'B1-F3-V2',
  [TRUCK_SPOT.B1_F3_V3]: 'B1-F3-V3',
  // Garage 2
  [TRUCK_SPOT.B2_F1_V1]: 'B2-F1-V1',
  [TRUCK_SPOT.B2_F1_V2]: 'B2-F1-V2',
  [TRUCK_SPOT.B2_F1_V3]: 'B2-F1-V3',
  [TRUCK_SPOT.B2_F2_V1]: 'B2-F2-V1',
  [TRUCK_SPOT.B2_F2_V2]: 'B2-F2-V2',
  [TRUCK_SPOT.B2_F2_V3]: 'B2-F2-V3',
  [TRUCK_SPOT.B2_F3_V1]: 'B2-F3-V1',
  [TRUCK_SPOT.B2_F3_V2]: 'B2-F3-V2',
  [TRUCK_SPOT.B2_F3_V3]: 'B2-F3-V3',
  // Garage 3
  [TRUCK_SPOT.B3_F1_V1]: 'B3-F1-V1',
  [TRUCK_SPOT.B3_F1_V2]: 'B3-F1-V2',
  [TRUCK_SPOT.B3_F1_V3]: 'B3-F1-V3',
  [TRUCK_SPOT.B3_F2_V1]: 'B3-F2-V1',
  [TRUCK_SPOT.B3_F2_V2]: 'B3-F2-V2',
  [TRUCK_SPOT.B3_F2_V3]: 'B3-F2-V3',
  [TRUCK_SPOT.B3_F3_V1]: 'B3-F3-V1',
  [TRUCK_SPOT.B3_F3_V2]: 'B3-F3-V2',
  [TRUCK_SPOT.B3_F3_V3]: 'B3-F3-V3',
  // Yard/Patio
  [TRUCK_SPOT.PATIO]: 'Pátio',
};

/**
 * Get the display label for a spot
 */
export function getSpotLabel(spot: TRUCK_SPOT | null | undefined): string {
  if (!spot) return 'Não atribuído';
  return SPOT_LABELS[spot] || spot;
}
