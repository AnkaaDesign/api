// packages/types/src/monitoring.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse } from './common';
import type { ORDER_BY_DIRECTION } from '@constants';

// =====================
// SSD Health Data Types
// =====================

export interface SsdHealthAttribute {
  id: number;
  name: string;
  value: number;
  worst: number;
  threshold: number;
  raw: string;
  status: 'OK' | 'WARNING' | 'CRITICAL';
}

export interface SsdHealthData extends BaseEntity {
  device: string;
  model: string;
  serialNumber: string;
  capacity: string;
  firmwareVersion: string;
  interfaceType: string;
  health: {
    overall: 'PASSED' | 'FAILED' | 'UNKNOWN';
    percentage?: number;
    status: string;
  };
  temperature: {
    current?: number;
    max?: number;
    unit: 'C' | 'F';
  };
  powerOn: {
    hours?: number;
    count?: number;
  };
  wearLevel: {
    percentage?: number;
    spareBlocks?: number;
  };
  errorCounts: {
    reallocatedSectors?: number;
    pendingSectors?: number;
    uncorrectableErrors?: number;
  };
  attributes: SsdHealthAttribute[];
  lastUpdated: Date;
}

// =====================
// RAID Status Types
// =====================

export interface RaidDevice {
  device: string;
  role: 'active' | 'spare' | 'faulty' | 'removed';
  state: 'in_sync' | 'spare' | 'faulty' | 'rebuilding' | 'write_mostly';
  errors: number;
}

export interface RaidArray {
  name: string;
  device: string;
  level: string; // RAID0, RAID1, RAID5, RAID6, RAID10, etc.
  state: 'clean' | 'active' | 'degraded' | 'recovering' | 'resyncing' | 'failed';
  activeDevices: number;
  totalDevices: number;
  workingDevices: number;
  failedDevices: number;
  spareDevices: number;
  uuid: string;
  devices: RaidDevice[];
  rebuildProgress?: {
    percentage: number;
    speed: string;
    timeRemaining?: string;
  };
  lastCheck?: Date;
  nextCheck?: Date;
}

export interface RaidStatus extends BaseEntity {
  arrays: RaidArray[];
  overall: {
    status: 'healthy' | 'degraded' | 'failed' | 'rebuilding';
    totalArrays: number;
    healthyArrays: number;
    degradedArrays: number;
    failedArrays: number;
    rebuildingArrays: number;
  };
  lastUpdated: Date;
}

// =====================
// Backup Metadata Types
// =====================

export interface BackupJob {
  id: string;
  name: string;
  type: 'full' | 'incremental' | 'differential' | 'snapshot';
  status: 'running' | 'completed' | 'failed' | 'scheduled' | 'paused';
  source: string;
  destination: string;
  schedule?: string; // cron expression
  retention: {
    days?: number;
    weeks?: number;
    months?: number;
    years?: number;
  };
  encryption: boolean;
  compression: boolean;
  lastRun?: Date;
  nextRun?: Date;
  duration?: number; // in seconds
  size?: number; // in bytes
  progress?: {
    percentage: number;
    filesProcessed: number;
    totalFiles: number;
    bytesProcessed: number;
    totalBytes: number;
    speed: string;
    timeRemaining?: string;
  };
  error?: string;
}

export interface BackupMetadata extends BaseEntity {
  jobs: BackupJob[];
  storage: {
    totalSpace: number;
    usedSpace: number;
    availableSpace: number;
    percentage: number;
  };
  statistics: {
    totalBackups: number;
    successfulBackups: number;
    failedBackups: number;
    lastSuccessfulBackup?: Date;
    oldestBackup?: Date;
    averageBackupSize: number;
    averageBackupDuration: number;
  };
  alerts: Array<{
    type: 'error' | 'warning' | 'info';
    message: string;
    timestamp: Date;
    jobId?: string;
  }>;
  lastUpdated: Date;
}

// =====================
// Files Storage Folder Types
// =====================

export interface StorageFolder {
  name: string;
  path: string;
  fullPath: string;
  type: 'directory' | 'file';
  size: number;
  permissions: {
    readable: boolean;
    writable: boolean;
    executable: boolean;
    owner: string;
    group: string;
    mode: string;
  };
  timestamps: {
    created: Date;
    modified: Date;
    accessed: Date;
  };
  isShared: boolean;
  shareSettings?: {
    public: boolean;
    password: boolean;
    expirationDate?: Date;
    permissions: 'read' | 'write' | 'admin';
  };
  children?: StorageFolder[];
}

export interface StorageInfo extends BaseEntity {
  serverUrl: string;
  username?: string;
  isConnected: boolean;
  rootFolder: StorageFolder;
  statistics: {
    totalFiles: number;
    totalFolders: number;
    totalSize: number;
    sharedItems: number;
    publicShares: number;
    passwordProtectedShares: number;
  };
  capabilities: {
    supportsLocking: boolean;
    supportsVersioning: boolean;
    supportsSearch: boolean;
    supportsQuotas: boolean;
    maxFileSize?: number;
    maxQuota?: number;
  };
  lastSync: Date;
  error?: string;
}

// =====================
// System Monitoring Types
// =====================

export interface SystemService {
  name: string;
  displayName: string;
  status: 'active' | 'inactive' | 'failed' | 'unknown';
  enabled: boolean;
  description?: string;
  subState?: string;
  memory?: string;
  pid?: string;
  uptime?: string;
}

export interface CpuTemperatureSensor {
  name: string;
  value: number;
  unit: 'C' | 'F';
  label?: string;
  critical?: number;
  max?: number;
}

export interface CpuTemperatureData {
  source: 'k10temp' | 'coretemp' | 'acpitz' | 'thermal_zone' | 'unknown';
  sensors: CpuTemperatureSensor[];
  primary: {
    value: number;
    unit: 'C' | 'F';
    source: string;
  };
}

export interface SystemMetrics extends BaseEntity {
  cpu: {
    usage: number;
    loadAverage: number[];
    cores: number;
    temperature?: number;
    temperatureData?: CpuTemperatureData;
  };
  memory: {
    total: number;
    used: number;
    available: number;
    percentage: number;
  };
  disk: {
    total: number;
    used: number;
    available: number;
    percentage: number;
  };
  network: {
    interfaces: Array<{
      name: string;
      ip: string;
      mac?: string;
      rx: number;
      tx: number;
    }>;
  };
  uptime: number;
  hostname: string;
  lastUpdated: Date;
}

export interface SystemUser {
  username: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
  fullName?: string;
  lastLogin?: Date;
  status: 'active' | 'inactive' | 'locked';
}

export interface SharedFolder {
  name: string;
  path: string;
  permissions: string;
  owner: string;
  group: string;
  size: string;
  lastModified: Date;
}

export interface SystemHealth extends BaseEntity {
  overall: 'healthy' | 'warning' | 'critical';
  services: {
    healthy: number;
    total: number;
    critical: SystemService[];
  };
  resources: {
    cpu: number;
    memory: number;
    disk: number;
  };
  uptime: number;
  hostname: string;
  alerts: Array<{
    type: 'error' | 'warning' | 'info';
    message: string;
    timestamp: Date;
    component: 'cpu' | 'memory' | 'disk' | 'network' | 'service' | 'raid' | 'backup' | 'ssd';
  }>;
  lastUpdated: Date;
}

// =====================
// Include Types
// =====================

export interface SsdHealthDataIncludes {
  attributes?: boolean;
}

export interface RaidStatusIncludes {
  arrays?:
    | boolean
    | {
        include?: {
          devices?: boolean;
          rebuildProgress?: boolean;
        };
      };
}

export interface BackupMetadataIncludes {
  jobs?:
    | boolean
    | {
        include?: {
          progress?: boolean;
          retention?: boolean;
        };
      };
  storage?: boolean;
  statistics?: boolean;
  alerts?: boolean;
}

export interface StorageInfoIncludes {
  rootFolder?:
    | boolean
    | {
        include?: {
          children?: boolean;
          permissions?: boolean;
          shareSettings?: boolean;
        };
      };
  statistics?: boolean;
  capabilities?: boolean;
}

export interface SystemMetricsIncludes {
  cpu?: boolean;
  memory?: boolean;
  disk?: boolean;
  network?: boolean;
}

export interface SystemHealthIncludes {
  services?: boolean;
  resources?: boolean;
  alerts?: boolean;
}

// =====================
// Order By Types
// =====================

export interface SsdHealthDataOrderBy {
  id?: ORDER_BY_DIRECTION;
  device?: ORDER_BY_DIRECTION;
  model?: ORDER_BY_DIRECTION;
  serialNumber?: ORDER_BY_DIRECTION;
  lastUpdated?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface RaidStatusOrderBy {
  id?: ORDER_BY_DIRECTION;
  lastUpdated?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface BackupMetadataOrderBy {
  id?: ORDER_BY_DIRECTION;
  lastUpdated?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface StorageInfoOrderBy {
  id?: ORDER_BY_DIRECTION;
  serverUrl?: ORDER_BY_DIRECTION;
  lastSync?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface SystemMetricsOrderBy {
  id?: ORDER_BY_DIRECTION;
  hostname?: ORDER_BY_DIRECTION;
  lastUpdated?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface SsdHealthDataGetUniqueResponse extends BaseGetUniqueResponse<SsdHealthData> {}
export interface SsdHealthDataGetManyResponse extends BaseGetManyResponse<SsdHealthData> {}

export interface RaidStatusGetUniqueResponse extends BaseGetUniqueResponse<RaidStatus> {}
export interface RaidStatusGetManyResponse extends BaseGetManyResponse<RaidStatus> {}

export interface BackupMetadataGetUniqueResponse extends BaseGetUniqueResponse<BackupMetadata> {}
export interface BackupMetadataGetManyResponse extends BaseGetManyResponse<BackupMetadata> {}

export interface StorageInfoGetUniqueResponse extends BaseGetUniqueResponse<StorageInfo> {}
export interface StorageInfoGetManyResponse extends BaseGetManyResponse<StorageInfo> {}

export interface SystemMetricsGetUniqueResponse extends BaseGetUniqueResponse<SystemMetrics> {}
export interface SystemMetricsGetManyResponse extends BaseGetManyResponse<SystemMetrics> {}

export interface SystemHealthGetUniqueResponse extends BaseGetUniqueResponse<SystemHealth> {}
export interface SystemHealthGetManyResponse extends BaseGetManyResponse<SystemHealth> {}

// Service list responses
export interface SystemServicesResponse {
  success: boolean;
  message: string;
  data?: SystemService[];
  error?: string;
}

export interface SystemUsersResponse {
  success: boolean;
  message: string;
  data?: SystemUser[];
  error?: string;
}

export interface SharedFoldersResponse {
  success: boolean;
  message: string;
  data?: SharedFolder[];
  error?: string;
}

export interface ServiceLogsResponse {
  success: boolean;
  message: string;
  data?: string;
  error?: string;
}

export interface ServiceActionResponse {
  success: boolean;
  message: string;
  error?: string;
}

export interface CreateUserRequest {
  username: string;
  fullName?: string;
  password?: string;
}

export interface SetPasswordRequest {
  password: string;
}

export interface CreateUserResponse {
  success: boolean;
  message: string;
  data?: {
    username: string;
    fullName?: string;
  };
  error?: string;
}

export interface CpuTemperatureResponse {
  success: boolean;
  message: string;
  data?: CpuTemperatureData;
  error?: string;
}
