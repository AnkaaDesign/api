/**
 * Type definitions for Google Drive sync operations
 */

export interface GDriveSyncJobData {
  backupId: string;
  backupFilePath: string;
  backupType: 'database' | 'files' | 'system' | 'full';
  retryCount?: number;
}

export interface GDriveDeleteJobData {
  backupId: string;
  gdriveFileId?: string;
  retryCount?: number;
}

export interface GDriveSyncResult {
  success: boolean;
  backupId: string;
  gdriveFileId?: string;
  error?: string;
  bytesTransferred?: number;
  duration?: number;
}

export interface GDriveDeleteResult {
  success: boolean;
  backupId: string;
  error?: string;
}

export interface RcloneProgress {
  bytes: number;
  totalBytes: number;
  speed: string;
  eta: string;
  percent: number;
}

export interface RcloneCopyResult {
  success: boolean;
  fileId?: string;
  bytesTransferred?: number;
  error?: string;
}

export interface RcloneDeleteResult {
  success: boolean;
  error?: string;
}

export interface GDriveSyncStats {
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
  totalBytesUploaded: bigint;
}
