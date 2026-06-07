// packages/types/src/statistics-preferences.ts

import type { BaseEntity } from './common';

// =====================
// Main Interfaces
// =====================

export interface StatisticsPagePreference extends BaseEntity {
  userId: string;
  pageKey: string;
  lastConfig: unknown; // Page-specific config JSON; validated client-side
}

export interface StatisticsPreset extends BaseEntity {
  userId: string;
  pageKey: string;
  name: string;
  config: unknown; // Page-specific config JSON; validated client-side
}

// =====================
// Response Types
// =====================

export interface StatisticsPreferencesGetResponse {
  success: boolean;
  message: string;
  data: {
    pageConfigs: StatisticsPagePreference[];
    presets: StatisticsPreset[];
  };
}

export interface StatisticsPageConfigUpsertResponse {
  success: boolean;
  message: string;
  data: StatisticsPagePreference;
}

export interface StatisticsPresetCreateResponse {
  success: boolean;
  message: string;
  data: StatisticsPreset;
}

export interface StatisticsPresetUpdateResponse {
  success: boolean;
  message: string;
  data: StatisticsPreset;
}

export interface StatisticsPresetDeleteResponse {
  success: boolean;
  message: string;
}
