import { TRUCK_MANUFACTURER_LABELS } from '@constants';
import { TRUCK_MANUFACTURER } from '@constants';

/**
 * Rótulo da montadora do CAVALO (Scania, Volvo…) — a cor de fábrica da tinta é
 * do caminhão, não do implemento (NOMENCLATURA.md §4).
 */
export function getTruckManufacturerLabel(manufacturer: TRUCK_MANUFACTURER): string {
  return TRUCK_MANUFACTURER_LABELS[manufacturer] || manufacturer;
}
