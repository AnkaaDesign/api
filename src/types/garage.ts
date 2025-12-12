// packages/interfaces/src/garage.ts
//
// NOTE: Garages are now static configuration - not database entities
// See: api/src/constants/garage.ts for static garage definitions
//
// The Garage, GarageLane, and ParkingSpot entities have been removed.
// Instead, trucks have a `spot` field (TRUCK_SPOT enum) that indicates
// their location in the static garage structure.

// Re-export garage configuration types from constants
export {
  GARAGE_CONFIG,
  GARAGES,
  LANES,
  type Garage,
  type GarageId,
  type Lane,
  type LaneId,
  type SpotNumber,
  parseSpot,
  buildSpot,
  getGarageSpots,
  getLaneSpots,
  getGarage,
  getLane,
  calculateTruckGarageLength,
  calculateLayoutSectionsSum,
  SPOT_LABELS,
  getSpotLabel,
} from '@constants';

// Re-export TRUCK_SPOT enum
export { TRUCK_SPOT } from '@constants';
