export interface LayoutSection {
  id: string;
  layoutId: string;
  width: number;           // Width in meters
  isDoor: boolean;         // Whether this section is a door
  doorHeight: number | null; // Height of the door from bottom of layout to top of door opening in meters (only when isDoor is true)
  position: number;        // Order/position of this section
  createdAt: Date;
  updatedAt: Date;
}

export interface LayoutSectionCreateInput {
  width: number;
  isDoor: boolean;
  doorHeight?: number | null;
  position: number;
}

export interface LayoutSectionUpdateInput {
  width?: number;
  isDoor?: boolean;
  doorHeight?: number | null;
  position?: number;
}