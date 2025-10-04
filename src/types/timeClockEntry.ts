// Note: Time clock entries are now managed internally without external integrations
import type { User } from "./user";

export interface TimeClockEntry {
  id: string;
  userId: string;
  date: Date;

  // Time entries (up to 5 pairs)
  entry1?: string | null;
  exit1?: string | null;
  entry2?: string | null;
  exit2?: string | null;
  entry3?: string | null;
  exit3?: string | null;
  entry4?: string | null;
  exit4?: string | null;
  entry5?: string | null;
  exit5?: string | null;

  // Day configuration
  dayType: number;
  compensated: boolean;
  neutral: boolean;
  dayOff: boolean;
  freeLunch: boolean;

  // Geolocation (optional)
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  address?: string | null;

  // Device and source tracking
  source: string;
  deviceId?: string | null;
  hasPhoto: boolean;

  // Sync fields
  synced: boolean;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Relations
  user?: User;
  justifications?: TimeClockJustification[];

  // Count fields (when included)
  _count?: {
    justifications?: number;
  };
}

export interface TimeClockEntryInclude {
  user?: boolean | { include?: UserIncludes };
  _count?:
    | boolean
    | {
        select?: {
          justifications?: boolean;
        };
      };
}

export interface TimeClockEntryWhere {
  id?: string | { in?: string[]; notIn?: string[] };
  userId?: string | { in?: string[] };
  date?: Date | { gte?: Date; lte?: Date; lt?: Date; gt?: Date };
  source?: string | { in?: string[] };
  synced?: boolean;
  dayOff?: boolean;
  compensated?: boolean;
  neutral?: boolean;
  AND?: TimeClockEntryWhere | TimeClockEntryWhere[];
  OR?: TimeClockEntryWhere[];
  NOT?: TimeClockEntryWhere | TimeClockEntryWhere[];
}

export interface TimeClockEntryOrderBy {
  date?: "asc" | "desc";
  createdAt?: "asc" | "desc";
  updatedAt?: "asc" | "desc";
  user?: { name?: "asc" | "desc" };
}

export interface TimeClockEntryUpdate {
  entry1?: string | null;
  exit1?: string | null;
  entry2?: string | null;
  exit2?: string | null;
  entry3?: string | null;
  exit3?: string | null;
  entry4?: string | null;
  exit4?: string | null;
  entry5?: string | null;
  exit5?: string | null;
  dayType?: number;
  compensated?: boolean;
  neutral?: boolean;
  dayOff?: boolean;
  freeLunch?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  address?: string | null;
  source?: string;
  deviceId?: string | null;
  hasPhoto?: boolean;
}

// Justification for time edits
export interface TimeClockJustification {
  originalTime: string;
  newTime: string | null;
  field: string;
  reason: string;
  changedBy: string;
  changedAt: Date;
}

// Import UserIncludes for relation typing
import type { UserIncludes } from "./user";
