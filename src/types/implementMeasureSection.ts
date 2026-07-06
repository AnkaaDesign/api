export interface ImplementMeasureSection {
  id: string;
  implementMeasureId: string;
  width: number; // Width in meters
  isDoor: boolean; // Whether this section is a door
  doorHeight: number | null; // Height of the door from bottom of implementMeasure to top of door opening in meters (only when isDoor is true)
  position: number; // Order/position of this section
  createdAt: Date;
  updatedAt: Date;
}

export interface ImplementMeasureSectionCreateInput {
  width: number;
  isDoor: boolean;
  doorHeight?: number | null;
  position: number;
}

export interface ImplementMeasureSectionUpdateInput {
  width?: number;
  isDoor?: boolean;
  doorHeight?: number | null;
  position?: number;
}
