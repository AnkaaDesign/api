export interface LayoutSection {
  id: string;
  layoutId: string;
  width: number;           // Width in meters
  isDoor: boolean;         // Whether this section is a door
  doorOffset: number | null; // Offset from top in meters (only when isDoor is true)
  position: number;        // Order/position of this section
  createdAt: Date;
  updatedAt: Date;
}

export interface LayoutSectionCreateInput {
  width: number;
  isDoor: boolean;
  doorOffset?: number | null;
  position: number;
}

export interface LayoutSectionUpdateInput {
  width?: number;
  isDoor?: boolean;
  doorOffset?: number | null;
  position?: number;
}