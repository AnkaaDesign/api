import { TRUCK_MANUFACTURER_LABELS } from '@constants';
import { TRUCK_MANUFACTURER } from '@constants';

/**
 * Get human-readable label for truck manufacturer
 */
export function getTruckManufacturerLabel(manufacturer: TRUCK_MANUFACTURER): string {
  return TRUCK_MANUFACTURER_LABELS[manufacturer] || manufacturer;
}
