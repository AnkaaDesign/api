import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const execPromise = promisify(exec);

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

export interface CpuTemperatureData {
  source: 'k10temp' | 'coretemp' | 'acpitz' | 'thermal_zone' | 'unknown';
  sensors: Array<{
    name: string;
    value: number;
    unit: 'C' | 'F';
    label?: string;
    critical?: number;
    max?: number;
  }>;
  primary: {
    value: number;
    unit: 'C' | 'F';
    source: string;
    max?: number;
    critical?: number;
  };
  thermalStatus: {
    isThrottling: boolean;
    maxTemp: number | undefined;
    criticalTemp: number | undefined;
    thermalEvents?: number;
  };
}

export interface SystemMetrics {
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
  remotePath?: string;
  description?: string;
  type?: string;
}

export interface SsdHealthData {
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
  attributes: Array<{
    id: number;
    name: string;
    value: number;
    worst: number;
    threshold: number;
    raw: string;
    status: 'OK' | 'WARNING' | 'CRITICAL';
  }>;
  lastUpdated: Date;
}

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

export interface RaidStatus {
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

@Injectable()
export class ServerService {
  private readonly logger = new Logger(ServerService.name);

  async getSystemServices(): Promise<SystemService[]> {
    try {
      const services = [
        'nginx',
        'postgresql',
        'redis-server',
        'docker',
        'ssh',
        'fail2ban',
        'ufw',
        'tailscaled',
      ];

      const servicePromises = services.map(async serviceName => {
        try {
          const { stdout } = await execPromise(`systemctl show ${serviceName} --no-page`);
          const lines = stdout.split('\n');
          const props: Record<string, string> = {};

          lines.forEach(line => {
            const [key, value] = line.split('=');
            if (key && value) {
              props[key] = value;
            }
          });

          return {
            name: serviceName,
            displayName: props.Description || serviceName,
            status: this.mapServiceStatus(props.ActiveState),
            enabled: props.UnitFileState === 'enabled',
            description: props.Description,
            subState: props.SubState,
            memory: this.formatMemoryValue(props.MemoryCurrent),
            pid: props.MainPID !== '0' ? props.MainPID : undefined,
            uptime: props.ActiveEnterTimestamp
              ? this.calculateUptime(props.ActiveEnterTimestamp)
              : undefined,
          } as SystemService;
        } catch (error) {
          this.logger.warn(`Failed to get status for service ${serviceName}: ${error.message}`);
          return {
            name: serviceName,
            displayName: serviceName,
            status: 'unknown' as const,
            enabled: false,
          };
        }
      });

      return await Promise.all(servicePromises);
    } catch (error) {
      this.logger.error('Failed to get system services', error);
      throw error;
    }
  }

  async getSystemMetrics(): Promise<SystemMetrics> {
    try {
      const [cpuInfo, memInfo, diskInfo, networkInfo] = await Promise.all([
        this.getCpuInfo(),
        this.getMemoryInfo(),
        this.getDiskInfo(),
        this.getNetworkInfo(),
      ]);

      // Validate and sanitize all metric data before returning
      const validatedMetrics = {
        cpu: this.validateCpuInfo(cpuInfo),
        memory: this.validateMemoryInfo(memInfo),
        disk: this.validateDiskInfo(diskInfo),
        network: this.validateNetworkInfo(networkInfo),
        uptime: isNaN(os.uptime()) ? 0 : Math.max(0, os.uptime()),
        hostname: os.hostname() || 'unknown',
      };

      return validatedMetrics;
    } catch (error) {
      this.logger.error('Failed to get system metrics', error);
      // Return safe fallback data instead of throwing
      return this.getFallbackMetrics();
    }
  }

  async restartService(serviceName: string): Promise<void> {
    try {
      await execPromise(`sudo systemctl restart ${serviceName}`);
      this.logger.log(`Service ${serviceName} restarted successfully`);
    } catch (error) {
      this.logger.error(`Failed to restart service ${serviceName}`, error);
      throw new Error(`Falha ao reiniciar serviço ${serviceName}: ${error.message}`);
    }
  }

  async stopService(serviceName: string): Promise<void> {
    try {
      await execPromise(`sudo systemctl stop ${serviceName}`);
      this.logger.log(`Service ${serviceName} stopped successfully`);
    } catch (error) {
      this.logger.error(`Failed to stop service ${serviceName}`, error);
      throw new Error(`Falha ao parar serviço ${serviceName}: ${error.message}`);
    }
  }

  async startService(serviceName: string): Promise<void> {
    try {
      await execPromise(`sudo systemctl start ${serviceName}`);
      this.logger.log(`Service ${serviceName} started successfully`);
    } catch (error) {
      this.logger.error(`Failed to start service ${serviceName}`, error);
      throw new Error(`Falha ao iniciar serviço ${serviceName}: ${error.message}`);
    }
  }

  async getSystemUsers(): Promise<SystemUser[]> {
    try {
      const { stdout } = await execPromise('getent passwd');
      const users = stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [username, , uid, gid, fullName, home, shell] = line.split(':');
          const uidNum = parseInt(uid);

          // Only include regular users (UID >= 1000) and system service accounts
          if (uidNum >= 1000 || ['www-data', 'postgres', 'redis', 'nginx'].includes(username)) {
            return {
              username,
              uid: uidNum,
              gid: parseInt(gid),
              home,
              shell,
              fullName: fullName || undefined,
              status: this.getUserStatus(username, uidNum),
            } as SystemUser;
          }
          return null;
        })
        .filter(user => user !== null);

      return users;
    } catch (error) {
      this.logger.error('Failed to get system users', error);
      throw error;
    }
  }

  async getSharedFolders(): Promise<SharedFolder[]> {
    try {
      // Use proper files storage mount point, fallback to samba if not available
      const filesRoot = '/srv/files';

      if (!fs.existsSync(filesRoot)) {
        this.logger.warn(`files storage root directory does not exist: ${filesRoot}`);
        return [];
      }

      // Check files storage service status
      const filesServiceStatus = await this.checkFilesServiceStatus();
      if (!filesServiceStatus.isRunning) {
        this.logger.warn('files storage service is not running properly');
      }

      // files storage-exclusive folders (not served via API, only accessible via files storage)
      const sambaOnlyFolders = ['Rascunhos', 'Fotos', 'Auxiliares', 'Artes'];

      // Get all subdirectories in the files storage root
      const { stdout: lsOutput } = await execPromise(`ls -la "${filesRoot}"`);
      const lines = lsOutput.split('\n').slice(1); // Skip the "total" line

      const folderPromises = lines
        .filter(line => {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('d')) return false; // Must be a directory

          const parts = trimmed.split(/\s+/);
          if (parts.length < 9) return false;

          const folderName = parts.slice(8).join(' ');

          return (
            !trimmed.endsWith(' .') && // Skip current directory
            !trimmed.endsWith(' ..') && // Skip parent directory
            !trimmed.endsWith(' .DS_Store') && // Skip macOS files
            !trimmed.endsWith(' .recycle') && // Skip recycle bin
            !sambaOnlyFolders.includes(folderName) // Skip files storage-exclusive folders
          );
        })
        .map(async line => {
          try {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 9) return null;

            const permissions = parts[0];
            const owner = parts[2];
            const group = parts[3];
            const folderName = parts.slice(8).join(' '); // Handle names with spaces
            const folderPath = path.join(filesRoot, folderName);

            if (!fs.existsSync(folderPath)) return null;

            const stats = fs.statSync(folderPath);

            // Get folder size and enhanced statistics
            const enhancedStats = await this.getEnhancedFolderStats(folderPath);

            // Get additional files storage-specific information
            const filesInfo = await this.getFilesFolderInfo(folderName, folderPath);

            // Check folder accessibility
            const accessInfo = await this.checkFolderAccess(folderPath);

            return {
              name: folderName,
              path: folderPath,
              permissions: permissions,
              owner: owner,
              group: group,
              size: enhancedStats.size,
              lastModified: stats.mtime,
              fileCount: enhancedStats.fileCount,
              subdirCount: enhancedStats.subdirCount,
              ...filesInfo, // Add files storage specific metadata
              ...accessInfo, // Add access information
            } as SharedFolder & {
              remotePath?: string;
              description?: string;
              type?: string;
              accessible?: boolean;
              accessError?: string;
              fileCount?: number;
              subdirCount?: number;
            };
          } catch (error) {
            this.logger.warn(`Failed to process folder from line: ${line}`, error);
            return null;
          }
        });

      const folders = await Promise.all(folderPromises);
      const validFolders = folders.filter(folder => folder !== null);

      // Sort folders by name for consistent display
      validFolders.sort((a, b) => a.name.localeCompare(b.name));

      this.logger.log(`Found ${validFolders.length} files storage shared folders`);
      return validFolders;
    } catch (error) {
      this.logger.error('Failed to get shared folders', error);
      throw error;
    }
  }

  async getSharedFolderContents(
    folderName: string,
    subPath?: string,
  ): Promise<{
    files: Array<{
      name: string;
      type: 'file' | 'directory';
      size: string;
      lastModified: Date;
      permissions: string;
      owner: string;
      group: string;
      remoteUrl?: string;
      fileCount?: number;
      folderCount?: number;
    }>;
    totalFiles: number;
    totalSize: string;
    parentPath?: string;
  }> {
    try {
      // Use proper files storage mount point, fallback to samba if not available
      const filesRoot = '/srv/files';
      const basePath = path.join(filesRoot, folderName);
      // Decode URL-encoded path to handle special characters (spaces, etc.)
      const decodedSubPath = subPath ? decodeURIComponent(subPath) : undefined;
      const targetPath = decodedSubPath ? path.join(basePath, decodedSubPath) : basePath;

      if (!fs.existsSync(targetPath)) {
        throw new Error(`Folder does not exist: ${targetPath}`);
      }

      if (!targetPath.startsWith(filesRoot)) {
        throw new Error('Access denied: Path traversal not allowed');
      }

      // Get folder contents with detailed information
      const { stdout: lsOutput } = await execPromise(`ls -la "${targetPath}"`);
      const lines = lsOutput.split('\n').slice(1); // Skip the "total" line

      const files = [];
      let totalFiles = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length < 9) continue;

        const permissions = parts[0];
        const owner = parts[2];
        const group = parts[3];
        const sizeBytes = parts[4];
        const fileName = parts.slice(8).join(' ');

        // Skip current and parent directory entries
        if (fileName === '.' || fileName === '..') {
          continue;
        }

        // Skip hidden system files
        if (
          fileName.startsWith('.') &&
          !fileName.match(/\.(jpg|jpeg|png|gif|pdf|doc|docx|xls|xlsx|eps|cdr|dxf)$/i)
        ) {
          continue;
        }

        const itemPath = path.join(targetPath, fileName);
        const stats = fs.statSync(itemPath);
        const isDirectory = permissions.startsWith('d');

        let size: string;
        let fileCount: number | undefined;
        let folderCount: number | undefined;

        if (isDirectory) {
          // Get directory size and counts
          try {
            const { stdout: duOutput } = await execPromise(
              `du -sh "${itemPath}" 2>/dev/null || echo "0B\t${itemPath}"`,
            );
            size = duOutput.split('\t')[0] || '0B';

            // Count files and folders inside this directory
            try {
              const dirContents = fs.readdirSync(itemPath);
              let files = 0;
              let folders = 0;

              for (const item of dirContents) {
                // Skip hidden files
                if (item.startsWith('.')) continue;

                const itemFullPath = path.join(itemPath, item);
                const itemStats = fs.statSync(itemFullPath);

                if (itemStats.isDirectory()) {
                  folders++;
                } else {
                  files++;
                }
              }

              fileCount = files;
              folderCount = folders;
            } catch {
              // If we can't read the directory, leave counts undefined
            }
          } catch {
            size = '--';
          }
        } else {
          size = this.formatBytes(parseInt(sizeBytes) || 0);
          totalFiles++;
        }

        // Generate remote URL for files
        let remoteUrl: string | undefined;
        if (!isDirectory) {
          const relativePath = path.relative(filesRoot, itemPath);
          const baseUrl = process.env.FILES_BASE_URL || 'https://arquivos.ankaadesign.com.br';
          remoteUrl = `${baseUrl}/${encodeURIComponent(relativePath.replace(/\\/g, '/'))}`;
        }

        files.push({
          name: fileName,
          type: isDirectory ? ('directory' as const) : ('file' as const),
          size: size.trim(),
          lastModified: stats.mtime,
          permissions,
          owner,
          group,
          remoteUrl,
          fileCount,
          folderCount,
        });
      }

      // Sort: directories first, then files, both alphabetically
      files.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      // Get total size of the folder
      let totalSize = '0B';
      try {
        const { stdout: duOutput } = await execPromise(
          `du -sh "${targetPath}" 2>/dev/null || echo "0B\t${targetPath}"`,
        );
        totalSize = duOutput.split('\t')[0] || '0B';
      } catch {
        totalSize = '--';
      }

      // Determine parent path for navigation
      const parentPath = subPath ? path.dirname(subPath) : undefined;

      return {
        files,
        totalFiles,
        totalSize: totalSize.trim(),
        parentPath: parentPath === '.' ? undefined : parentPath,
      };
    } catch (error) {
      this.logger.error(`Failed to get folder contents for ${folderName}:`, error);
      throw error;
    }
  }

  private async getEnhancedFolderStats(folderPath: string): Promise<{
    size: string;
    fileCount: number;
    subdirCount: number;
  }> {
    try {
      // Get folder size
      const { stdout: duOutput } = await execPromise(
        `du -sh "${folderPath}" 2>/dev/null || echo "0B\t${folderPath}"`,
      );
      const size = duOutput.split('\t')[0] || '0B';

      // Count non-hidden files and subdirectories (excluding files starting with . unless they have a common extension)
      const { stdout: findOutput } = await execPromise(
        `find "${folderPath}" -maxdepth 1 -type f \\( ! -name ".*" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.gif" -o -name "*.pdf" -o -name "*.doc" -o -name "*.docx" -o -name "*.xls" -o -name "*.xlsx" -o -name "*.eps" -o -name "*.cdr" -o -name "*.dxf" \\) 2>/dev/null | wc -l`,
      );
      const fileCount = parseInt(findOutput.trim()) || 0;

      const { stdout: findDirOutput } = await execPromise(
        `find "${folderPath}" -maxdepth 1 -type d ! -name ".*" 2>/dev/null | tail -n +2 | wc -l`,
      );
      const subdirCount = parseInt(findDirOutput.trim()) || 0;

      return {
        size: size.trim(),
        fileCount,
        subdirCount,
      };
    } catch (error) {
      this.logger.warn(`Failed to get enhanced stats for ${folderPath}:`, error);
      return {
        size: '0B',
        fileCount: 0,
        subdirCount: 0,
      };
    }
  }

  private async getFilesFolderInfo(
    folderName: string,
    folderPath: string,
  ): Promise<{
    remotePath?: string;
    description?: string;
    type?: string;
  }> {
    try {
      // Map folder names to their purposes based on files storage service configuration
      const folderDescriptions: Record<string, { description: string; type: string }> = {
        Artes: { description: 'Arquivos de artes e designs para tarefas', type: 'artwork' },
        Auxiliares: { description: 'Arquivos auxiliares e documentos gerais', type: 'general' },
        Backup: { description: 'Arquivos de backup do sistema', type: 'backup' },
        Comprovantes: { description: 'Comprovantes de pagamento e recibos', type: 'receipts' },
        Fotos: { description: 'Imagens e fotografias', type: 'images' },
        Lixeira: { description: 'Arquivos excluídos temporariamente', type: 'trash' },
        Logo: { description: 'Logotipos de clientes e fornecedores', type: 'logos' },
        NFs: { description: 'Notas fiscais e documentos fiscais', type: 'invoices' },
        Observacoes: { description: 'Observações e avisos do sistema', type: 'observations' },
        Orcamentos: { description: 'Orçamentos de tarefas e pedidos', type: 'budgets' },
        Plotter: { description: 'Arquivos para impressão em plotter', type: 'plotter' },
        Projetos: { description: 'Arquivos de projetos', type: 'projects' },
        Rascunhos: { description: 'Rascunhos e arquivos temporários', type: 'drafts' },
        Thumbnails: { description: 'Miniaturas de imagens', type: 'thumbnails' },
      };

      const info = folderDescriptions[folderName] || {
        description: 'Pasta compartilhada files storage',
        type: 'other',
      };

      // Generate remote URL
      const baseUrl = process.env.FILES_BASE_URL || 'https://arquivos.ankaadesign.com.br';
      const remotePath = `${baseUrl}/${encodeURIComponent(folderName)}`;

      return {
        remotePath,
        description: info.description,
        type: info.type,
      };
    } catch (error) {
      this.logger.warn(`Failed to get files storage info for folder ${folderName}:`, error);
      return {};
    }
  }

  private async checkFilesServiceStatus(): Promise<{
    isRunning: boolean;
    services: Array<{ name: string; status: string }>;
  }> {
    try {
      // Check nginx (files storage is typically served through nginx)
      const nginxCheck = await this.checkSingleServiceStatus('nginx');

      // Check if apache2 is being used instead
      const apacheCheck = await this.checkSingleServiceStatus('apache2');

      const services = [
        { name: 'nginx', status: nginxCheck },
        { name: 'apache2', status: apacheCheck },
      ];

      const isRunning = nginxCheck === 'active' || apacheCheck === 'active';

      return { isRunning, services };
    } catch (error) {
      this.logger.warn('Failed to check files storage service status:', error);
      return { isRunning: false, services: [] };
    }
  }

  private async checkSingleServiceStatus(serviceName: string): Promise<string> {
    try {
      const { stdout } = await execPromise(`systemctl is-active ${serviceName} 2>/dev/null`);
      return stdout.trim();
    } catch {
      return 'inactive';
    }
  }

  private async checkFolderAccess(folderPath: string): Promise<{
    accessible?: boolean;
    accessError?: string;
  }> {
    try {
      // Test read access
      await fs.promises.access(folderPath, fs.constants.R_OK);

      // Test if folder is readable and not empty or if it's empty but writable
      const contents = await fs.promises.readdir(folderPath);

      return {
        accessible: true,
      };
    } catch (error: any) {
      return {
        accessible: false,
        accessError: error.code === 'EACCES' ? 'Acesso negado' : 'Erro de acesso',
      };
    }
  }

  async createUser(username: string, fullName?: string): Promise<void> {
    try {
      const cmd = fullName
        ? `sudo useradd -m -s /bin/bash -c "${fullName}" ${username}`
        : `sudo useradd -m -s /bin/bash ${username}`;

      await execPromise(cmd);
      this.logger.log(`User ${username} created successfully`);
    } catch (error) {
      this.logger.error(`Failed to create user ${username}`, error);
      throw new Error(`Falha ao criar usuário ${username}: ${error.message}`);
    }
  }

  async setUserPassword(username: string, password: string): Promise<void> {
    try {
      await execPromise(`echo '${username}:${password}' | sudo chpasswd`);
      this.logger.log(`Password set for user ${username}`);
    } catch (error) {
      this.logger.error(`Failed to set password for user ${username}`, error);
      throw new Error(`Falha ao definir senha para usuário ${username}: ${error.message}`);
    }
  }

  async getServiceLogs(serviceName: string, lines: number = 50): Promise<string> {
    try {
      const { stdout } = await execPromise(`journalctl -u ${serviceName} -n ${lines} --no-pager`);
      return stdout;
    } catch (error) {
      this.logger.error(`Failed to get logs for service ${serviceName}`, error);
      throw error;
    }
  }

  private mapServiceStatus(activeState: string): SystemService['status'] {
    switch (activeState) {
      case 'active':
        return 'active';
      case 'inactive':
        return 'inactive';
      case 'failed':
        return 'failed';
      default:
        return 'unknown';
    }
  }

  private calculateUptime(timestamp: string): string {
    try {
      const startTime = new Date(timestamp);
      const now = new Date();
      const uptimeMs = now.getTime() - startTime.getTime();

      const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) return `${days}d ${hours}h ${minutes}m`;
      if (hours > 0) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
    } catch {
      return 'unknown';
    }
  }

  private formatMemoryValue(memoryBytes: string | undefined): string | undefined {
    if (!memoryBytes || memoryBytes === 'undefined' || memoryBytes === '[not set]') {
      return undefined;
    }

    const bytes = parseInt(memoryBytes);
    if (isNaN(bytes) || bytes <= 0) {
      return undefined;
    }

    return this.formatBytes(bytes);
  }

  private formatBytes(bytes: number): string {
    if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    if (i < 0 || i >= sizes.length) return '0 B';
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private async getCpuInfo() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    // Get CPU usage percentage
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - ~~((100 * idle) / total);

    // Get CPU temperature data
    const temperatureData = await this.getDetailedTemperatureData();
    const temperature = temperatureData?.primary?.value;

    return {
      usage: Math.round(usage),
      loadAverage: loadAvg,
      cores: cpus.length,
      temperature,
      temperatureData,
    };
  }

  private async getMemoryInfo() {
    try {
      const total = os.totalmem();
      const free = os.freemem();

      // Validate that we have valid numbers
      if (!total || !free || total <= 0 || free < 0) {
        this.logger.warn('Invalid memory values detected, returning fallback data');
        return {
          total: 0,
          used: 0,
          available: 0,
          percentage: 0,
        };
      }

      const used = total - free;
      const percentage = Math.round((used / total) * 100);

      // Ensure all values are valid numbers
      return {
        total: Math.max(0, total),
        used: Math.max(0, used),
        available: Math.max(0, free),
        percentage: isNaN(percentage) ? 0 : Math.max(0, Math.min(100, percentage)),
      };
    } catch (error) {
      this.logger.error('Failed to get memory info', error);
      return {
        total: 0,
        used: 0,
        available: 0,
        percentage: 0,
      };
    }
  }

  private async getDiskInfo() {
    try {
      const { stdout } = await execPromise('df -h / | tail -1');
      const parts = stdout.split(/\s+/);

      if (parts.length < 5) {
        throw new Error('Invalid df output format');
      }

      const total = this.parseSize(parts[1]);
      const used = this.parseSize(parts[2]);
      const available = this.parseSize(parts[3]);
      const percentageStr = parts[4].replace('%', '');
      const percentage = parseInt(percentageStr);

      // Validate the parsed values
      if (isNaN(total) || isNaN(used) || isNaN(available) || isNaN(percentage)) {
        throw new Error('Failed to parse disk usage values');
      }

      return {
        total: Math.max(0, total),
        used: Math.max(0, used),
        available: Math.max(0, available),
        percentage: Math.max(0, Math.min(100, percentage)),
      };
    } catch (error) {
      this.logger.warn(`Failed to get disk info: ${error.message}`);
      return {
        total: 0,
        used: 0,
        available: 0,
        percentage: 0,
      };
    }
  }

  private async getNetworkInfo() {
    const interfaces = os.networkInterfaces();
    const networkInterfaces: Array<{
      name: string;
      ip: string;
      mac: string;
      rx: number;
      tx: number;
    }> = [];

    for (const [name, addresses] of Object.entries(interfaces)) {
      if (addresses) {
        const ipv4 = addresses.find(addr => addr.family === 'IPv4' && !addr.internal);
        if (ipv4) {
          try {
            const { stdout } = await execPromise(`cat /proc/net/dev | grep ${name}:`);
            const stats = stdout.split(/\s+/);
            const rx = parseInt(stats[1]) || 0;
            const tx = parseInt(stats[9]) || 0;

            networkInterfaces.push({
              name,
              ip: ipv4.address,
              mac: ipv4.mac,
              rx,
              tx,
            });
          } catch {
            networkInterfaces.push({
              name,
              ip: ipv4.address,
              mac: ipv4.mac,
              rx: 0,
              tx: 0,
            });
          }
        }
      }
    }

    return { interfaces: networkInterfaces };
  }

  private parseSize(sizeStr: string): number {
    if (!sizeStr || typeof sizeStr !== 'string') return 0;

    const units = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
    const match = sizeStr.trim().match(/^([\d.]+)([KMGT]?)$/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    if (isNaN(value) || value < 0) return 0;

    return Math.round(value * (units[unit] || 1));
  }

  private getUserStatus(username: string, uid: number): SystemUser['status'] {
    // Simple status determination - could be enhanced
    if (uid >= 1000) return 'active';
    return 'active'; // Service accounts are typically active if they exist
  }

  private async getCpuTemperature(): Promise<number | undefined> {
    const tempData = await this.getDetailedTemperatureData();
    return tempData?.primary?.value;
  }

  private async getDetailedTemperatureData(): Promise<CpuTemperatureData | undefined> {
    try {
      // First try to get data from lm-sensors (preferred method for AMD)
      const sensorsData = await this.getSensorsTemperatureData();
      if (sensorsData && sensorsData.sensors.length > 0) {
        return sensorsData;
      }

      // Fallback to hwmon interfaces
      const hwmonData = await this.getHwmonTemperatureData();
      if (hwmonData && hwmonData.sensors.length > 0) {
        return hwmonData;
      }

      // Final fallback to thermal zones
      const thermalData = await this.getThermalZoneTemperatureData();
      if (thermalData && thermalData.sensors.length > 0) {
        return thermalData;
      }

      this.logger.warn('Could not read CPU temperature from any available source');
      return undefined;
    } catch (error) {
      this.logger.warn(`Failed to get detailed CPU temperature: ${error.message}`);
      return undefined;
    }
  }

  private async getSensorsTemperatureData(): Promise<CpuTemperatureData | undefined> {
    try {
      const { stdout } = await execPromise('sensors 2>/dev/null');
      const sections = stdout.split('\n\n').filter(section => section.trim());

      for (const section of sections) {
        const lines = section.split('\n');
        const headerLine = lines[0];

        // Check for AMD k10temp sensor (primary target for AMD CPUs)
        if (headerLine.includes('k10temp')) {
          const sensors = [];
          let primaryTemp = undefined;

          for (const line of lines.slice(1)) {
            if (line.includes('°C')) {
              const labelMatch = line.match(/^([^:]+):\s*([+-]?\d+(?:\.\d+)?)\s*°C/);
              if (labelMatch) {
                const label = labelMatch[1].trim();
                const temp = parseFloat(labelMatch[2]);

                if (temp > 0 && temp < 150) {
                  const sensor = {
                    name: label,
                    value: Math.round(temp * 10) / 10, // Round to 1 decimal
                    unit: 'C' as const,
                    label: label,
                  };

                  sensors.push(sensor);

                  // Use Tctl as primary for AMD k10temp
                  if (label === 'Tctl' || (!primaryTemp && label.includes('temp'))) {
                    primaryTemp = sensor;
                  }
                }
              }
            }
          }

          if (sensors.length > 0 && primaryTemp) {
            return {
              source: 'k10temp',
              sensors,
              primary: {
                value: primaryTemp.value,
                unit: 'C',
                source: `k10temp - ${primaryTemp.label}`,
              },
              thermalStatus: {
                isThrottling: primaryTemp.value > 90,
                maxTemp: Math.max(...sensors.map(s => s.value)),
                criticalTemp: primaryTemp.critical,
                thermalEvents: 0,
              },
            };
          }
        }

        // Check for Intel coretemp sensor
        if (headerLine.includes('coretemp')) {
          const sensors = [];
          let primaryTemp = undefined;

          for (const line of lines.slice(1)) {
            if (line.includes('°C')) {
              const labelMatch = line.match(/^([^:]+):\s*([+-]?\d+(?:\.\d+)?)\s*°C/);
              if (labelMatch) {
                const label = labelMatch[1].trim();
                const temp = parseFloat(labelMatch[2]);

                if (temp > 0 && temp < 150) {
                  const sensor = {
                    name: label,
                    value: Math.round(temp * 10) / 10,
                    unit: 'C' as const,
                    label: label,
                  };

                  sensors.push(sensor);

                  // Use Package id 0 as primary for Intel, otherwise first core
                  if (label.includes('Package id 0') || (!primaryTemp && label.includes('Core'))) {
                    primaryTemp = sensor;
                  }
                }
              }
            }
          }

          if (sensors.length > 0 && primaryTemp) {
            return {
              source: 'coretemp',
              sensors,
              primary: {
                value: primaryTemp.value,
                unit: 'C',
                source: `coretemp - ${primaryTemp.label}`,
              },
              thermalStatus: {
                isThrottling: primaryTemp.value > 90,
                maxTemp: Math.max(...sensors.map(s => s.value)),
                criticalTemp: primaryTemp.critical,
                thermalEvents: 0,
              },
            };
          }
        }
      }

      return undefined;
    } catch (error) {
      this.logger.debug(`sensors command failed: ${error.message}`);
      return undefined;
    }
  }

  private async getHwmonTemperatureData(): Promise<CpuTemperatureData | undefined> {
    try {
      const hwmonDirs = await execPromise('ls /sys/class/hwmon/');
      const dirs = hwmonDirs.stdout.split('\n').filter(d => d.trim());

      for (const dir of dirs) {
        const hwmonPath = `/sys/class/hwmon/${dir}`;

        try {
          // Check if this is a CPU temperature sensor
          const namePath = `${hwmonPath}/name`;
          if (!fs.existsSync(namePath)) continue;

          const name = fs.readFileSync(namePath, 'utf8').trim();

          // Focus on CPU temperature sensors
          if (!name.match(/k10temp|coretemp|cpu|thermal/i)) continue;

          const sensors = [];
          const tempFiles = fs.readdirSync(hwmonPath).filter(f => f.match(/^temp\d+_input$/));

          for (const tempFile of tempFiles) {
            const tempPath = `${hwmonPath}/${tempFile}`;
            const labelPath = `${hwmonPath}/${tempFile.replace('_input', '_label')}`;

            try {
              const tempRaw = fs.readFileSync(tempPath, 'utf8').trim();
              const temp = parseInt(tempRaw) / 1000;

              if (temp > 0 && temp < 150) {
                let label = tempFile.replace('_input', '');

                // Try to get a more descriptive label
                if (fs.existsSync(labelPath)) {
                  label = fs.readFileSync(labelPath, 'utf8').trim();
                }

                sensors.push({
                  name: label,
                  value: Math.round(temp * 10) / 10,
                  unit: 'C' as const,
                  label: label,
                });
              }
            } catch {
              continue;
            }
          }

          if (sensors.length > 0) {
            const primarySensor = sensors[0]; // Use first sensor as primary

            let source: CpuTemperatureData['source'] = 'unknown';
            if (name.includes('k10temp')) source = 'k10temp';
            else if (name.includes('coretemp')) source = 'coretemp';

            return {
              source,
              sensors,
              primary: {
                value: primarySensor.value,
                unit: 'C',
                source: `${name} - ${primarySensor.label}`,
              },
              thermalStatus: {
                isThrottling: primarySensor.value > 90,
                maxTemp: Math.max(...sensors.map(s => s.value)),
                criticalTemp: undefined,
                thermalEvents: 0,
              },
            };
          }
        } catch {
          continue;
        }
      }

      return undefined;
    } catch (error) {
      this.logger.debug(`hwmon temperature reading failed: ${error.message}`);
      return undefined;
    }
  }

  private async getThermalZoneTemperatureData(): Promise<CpuTemperatureData | undefined> {
    try {
      const sensors = [];
      const thermalZones = [
        '/sys/class/thermal/thermal_zone0/temp',
        '/sys/class/thermal/thermal_zone1/temp',
      ];

      for (let i = 0; i < thermalZones.length; i++) {
        const zonePath = thermalZones[i];

        try {
          if (fs.existsSync(zonePath)) {
            const tempRaw = fs.readFileSync(zonePath, 'utf8').trim();
            const temp = parseInt(tempRaw) / 1000;

            if (temp > 0 && temp < 150) {
              sensors.push({
                name: `thermal_zone${i}`,
                value: Math.round(temp * 10) / 10,
                unit: 'C' as const,
                label: `Thermal Zone ${i}`,
              });
            }
          }
        } catch {
          continue;
        }
      }

      if (sensors.length > 0) {
        const primarySensor = sensors[0];

        return {
          source: 'thermal_zone',
          sensors,
          primary: {
            value: primarySensor.value,
            unit: 'C',
            source: `thermal_zone - ${primarySensor.label}`,
          },
          thermalStatus: {
            isThrottling: primarySensor.value > 90,
            maxTemp: Math.max(...sensors.map(s => s.value)),
            criticalTemp: undefined,
            thermalEvents: 0,
          },
        };
      }

      return undefined;
    } catch (error) {
      this.logger.debug(`thermal zone temperature reading failed: ${error.message}`);
      return undefined;
    }
  }

  async getDetailedCpuTemperature(): Promise<CpuTemperatureData | undefined> {
    return this.getDetailedTemperatureData();
  }

  async getSsdHealthData(): Promise<SsdHealthData[]> {
    try {
      // First check if smartctl is available
      const smartctlAvailable = await this.checkSmartctlAvailable();
      if (!smartctlAvailable) {
        this.logger.warn('smartctl is not available on this system, using lsblk fallback');
        // Use lsblk fallback to get basic disk information
        return await this.getBasicDiskInfo();
      }

      const devices = await this.getStorageDevices();
      const healthPromises = devices.map(device => this.getSingleSsdHealth(device));
      const results = await Promise.all(healthPromises);
      return results.filter(result => result !== null);
    } catch (error) {
      this.logger.error('Failed to get SSD health data', error);
      // Try fallback before throwing
      try {
        return await this.getBasicDiskInfo();
      } catch {
        throw error;
      }
    }
  }

  /**
   * Fallback method to get basic disk information using lsblk
   * when smartctl is not available
   */
  private async getBasicDiskInfo(): Promise<SsdHealthData[]> {
    try {
      const { stdout } = await execPromise(
        'lsblk -d -b -o NAME,SIZE,MODEL,ROTA,TRAN,TYPE -J 2>/dev/null || lsblk -d -b -o NAME,SIZE,MODEL,ROTA,TYPE -J',
      );

      const data = JSON.parse(stdout);
      const disks: SsdHealthData[] = [];

      for (const device of data.blockdevices || []) {
        // Skip loop devices, ram disks, etc
        if (
          device.type !== 'disk' ||
          device.name.startsWith('loop') ||
          device.name.startsWith('ram')
        ) {
          continue;
        }

        const isRotational = device.rota === true || device.rota === '1' || device.rota === 1;
        const sizeBytes = parseInt(device.size) || 0;
        const sizeGB = (sizeBytes / (1024 * 1024 * 1024)).toFixed(1);

        disks.push({
          device: `/dev/${device.name}`,
          model: device.model?.trim() || 'Unknown Model',
          serialNumber: 'N/A (smartctl não instalado)',
          capacity: `${sizeGB} GB`,
          firmwareVersion: 'N/A',
          interfaceType: device.tran?.toUpperCase() || (isRotational ? 'SATA' : 'NVMe/SATA'),
          health: {
            overall: 'UNKNOWN',
            status: 'Instale smartmontools para dados SMART detalhados',
          },
          temperature: {
            unit: 'C',
          },
          powerOn: {},
          wearLevel: {},
          errorCounts: {},
          attributes: [],
          lastUpdated: new Date(),
        });
      }

      return disks;
    } catch (error) {
      this.logger.error('Failed to get basic disk info via lsblk', error);
      return [];
    }
  }

  private async checkSmartctlAvailable(): Promise<boolean> {
    try {
      await execPromise('which smartctl');
      return true;
    } catch {
      try {
        // Try direct path
        await execPromise('/usr/sbin/smartctl --version');
        return true;
      } catch {
        return false;
      }
    }
  }

  private async getStorageDevices(): Promise<string[]> {
    try {
      // First, try to get a list of all storage devices
      const { stdout } = await execPromise('sudo smartctl --scan');
      const devices = stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.split(' ')[0])
        .filter(device => device.startsWith('/dev/'));

      if (devices.length > 0) {
        return devices;
      }

      // If no devices found, try alternative methods
      const { stdout: lsblkOutput } = await execPromise(
        'lsblk -d -n -o NAME | grep -E "(sd|nvme)" | head -5',
      );
      const altDevices = lsblkOutput
        .split('\n')
        .filter(line => line.trim())
        .map(device => `/dev/${device.trim()}`);

      return altDevices.length > 0 ? altDevices : ['/dev/sda']; // final fallback
    } catch (error) {
      this.logger.warn('Failed to scan storage devices, using fallback', error);
      return ['/dev/sda']; // fallback to most common device name
    }
  }

  private async getSingleSsdHealth(device: string): Promise<SsdHealthData | null> {
    try {
      // Check if device exists
      const { stdout: deviceCheck } = await execPromise(
        `ls ${device} 2>/dev/null || echo "not found"`,
      );
      if (deviceCheck.includes('not found')) {
        this.logger.warn(`Device ${device} not found`);
        return null;
      }

      // Get basic device info
      let infoOutput = '';
      try {
        const { stdout } = await execPromise(`sudo smartctl -i ${device}`);
        infoOutput = stdout;
      } catch (error) {
        this.logger.warn(`Failed to get device info for ${device}: ${error.message}`);
        return null;
      }

      // Check if SMART is supported and enabled
      let smartOutput = '';
      try {
        const { stdout } = await execPromise(`sudo smartctl -A ${device}`);
        smartOutput = stdout;
      } catch (error) {
        this.logger.debug(`SMART attributes not available for ${device}: ${error.message}`);
        // If SMART attributes fail, we'll still try to get basic info
      }

      // Get health status
      let healthOutput = '';
      try {
        const { stdout } = await execPromise(`sudo smartctl -H ${device}`);
        healthOutput = stdout;
      } catch (error) {
        this.logger.debug(`Health check not available for ${device}: ${error.message}`);
        // Health check might fail on some devices
      }

      return this.parseSsdHealthData(device, infoOutput, smartOutput, healthOutput);
    } catch (error) {
      this.logger.warn(`Failed to get health data for device ${device}: ${error.message}`);
      return null;
    }
  }

  private parseSsdHealthData(
    device: string,
    infoOutput: string,
    smartOutput: string,
    healthOutput: string,
  ): SsdHealthData {
    const info = this.parseDeviceInfo(infoOutput);
    const attributes = this.parseSmartAttributes(smartOutput);
    const health = this.parseHealthStatus(healthOutput);

    // Extract specific metrics from attributes
    const temperature = this.extractTemperature(attributes);
    const powerOn = this.extractPowerOnData(attributes);
    const wearLevel = this.extractWearLevel(attributes);
    const errorCounts = this.extractErrorCounts(attributes);

    return {
      device,
      model: info.model || 'Unknown',
      serialNumber: info.serialNumber || 'Unknown',
      capacity: info.capacity || 'Unknown',
      firmwareVersion: info.firmwareVersion || 'Unknown',
      interfaceType: info.interfaceType || 'Unknown',
      health: {
        overall: health.overall,
        percentage: health.percentage,
        status: health.status,
      },
      temperature,
      powerOn,
      wearLevel,
      errorCounts,
      attributes,
      lastUpdated: new Date(),
    };
  }

  private parseDeviceInfo(output: string): {
    model?: string;
    serialNumber?: string;
    capacity?: string;
    firmwareVersion?: string;
    interfaceType?: string;
  } {
    const info = {};
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.includes('Device Model:') || line.includes('Model Number:')) {
        info['model'] = line.split(':')[1]?.trim();
      } else if (line.includes('Serial Number:')) {
        info['serialNumber'] = line.split(':')[1]?.trim();
      } else if (line.includes('User Capacity:')) {
        info['capacity'] = line.split(':')[1]?.trim();
      } else if (line.includes('Firmware Version:')) {
        info['firmwareVersion'] = line.split(':')[1]?.trim();
      } else if (line.includes('Interface:') || line.includes('Transport protocol:')) {
        info['interfaceType'] = line.split(':')[1]?.trim();
      }
    }

    return info;
  }

  private parseHealthStatus(output: string): {
    overall: 'PASSED' | 'FAILED' | 'UNKNOWN';
    percentage?: number;
    status: string;
  } {
    if (!output) {
      return {
        overall: 'UNKNOWN',
        status: 'SMART health information not available',
      };
    }

    if (output.includes('PASSED')) {
      return {
        overall: 'PASSED',
        status: 'Device is healthy',
      };
    } else if (output.includes('FAILED')) {
      return {
        overall: 'FAILED',
        status: 'Device health check failed',
      };
    } else {
      return {
        overall: 'UNKNOWN',
        status: 'Health status unknown',
      };
    }
  }

  private parseSmartAttributes(output: string): Array<{
    id: number;
    name: string;
    value: number;
    worst: number;
    threshold: number;
    raw: string;
    status: 'OK' | 'WARNING' | 'CRITICAL';
  }> {
    if (!output) return [];

    const attributes = [];
    const lines = output.split('\n');
    let inAttributeSection = false;

    for (const line of lines) {
      if (line.includes('ID# ATTRIBUTE_NAME')) {
        inAttributeSection = true;
        continue;
      }

      if (inAttributeSection && line.trim()) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 10 && /^\d+$/.test(parts[0])) {
          const id = parseInt(parts[0]);
          const name = parts[1];
          const flag = parts[2];
          const value = parseInt(parts[3]);
          const worst = parseInt(parts[4]);
          const threshold = parseInt(parts[5]);
          const type = parts[6];
          const updated = parts[7];
          const whenFailed = parts[8];
          const raw = parts.slice(9).join(' ');

          // Determine status based on value vs threshold
          let status: 'OK' | 'WARNING' | 'CRITICAL' = 'OK';
          if (threshold > 0) {
            if (value <= threshold) {
              status = 'CRITICAL';
            } else if (value <= threshold + 10) {
              status = 'WARNING';
            }
          }

          attributes.push({
            id,
            name,
            value,
            worst,
            threshold,
            raw,
            status,
          });
        }
      }
    }

    return attributes;
  }

  private extractTemperature(attributes: Array<any>): {
    current?: number;
    max?: number;
    unit: 'C' | 'F';
  } {
    const tempAttr = attributes.find(
      attr =>
        attr.name.toLowerCase().includes('temperature') ||
        attr.name.toLowerCase().includes('airflow') ||
        attr.id === 194, // Common temperature attribute ID
    );

    if (tempAttr) {
      const raw = tempAttr.raw;
      const tempMatch = raw.match(/(\d+)/);
      if (tempMatch) {
        return {
          current: parseInt(tempMatch[1]),
          unit: 'C',
        };
      }
    }

    return { unit: 'C' };
  }

  private extractPowerOnData(attributes: Array<any>): {
    hours?: number;
    count?: number;
  } {
    const powerOnHours = attributes.find(
      attr => attr.name.toLowerCase().includes('power_on_hours') || attr.id === 9,
    );

    const powerOnCount = attributes.find(
      attr => attr.name.toLowerCase().includes('power_cycle') || attr.id === 12,
    );

    return {
      hours: powerOnHours ? parseInt(powerOnHours.raw) : undefined,
      count: powerOnCount ? parseInt(powerOnCount.raw) : undefined,
    };
  }

  private extractWearLevel(attributes: Array<any>): {
    percentage?: number;
    spareBlocks?: number;
  } {
    const wearAttr = attributes.find(
      attr =>
        attr.name.toLowerCase().includes('wear') ||
        attr.name.toLowerCase().includes('life') ||
        attr.name.toLowerCase().includes('endurance') ||
        attr.id === 173 ||
        attr.id === 202 ||
        attr.id === 233,
    );

    const spareAttr = attributes.find(
      attr =>
        attr.name.toLowerCase().includes('spare') ||
        attr.name.toLowerCase().includes('available') ||
        attr.id === 232,
    );

    return {
      percentage: wearAttr ? 100 - wearAttr.value : undefined,
      spareBlocks: spareAttr ? spareAttr.value : undefined,
    };
  }

  private extractErrorCounts(attributes: Array<any>): {
    reallocatedSectors?: number;
    pendingSectors?: number;
    uncorrectableErrors?: number;
  } {
    const reallocated = attributes.find(
      attr => attr.name.toLowerCase().includes('reallocated') || attr.id === 5,
    );

    const pending = attributes.find(
      attr => attr.name.toLowerCase().includes('pending') || attr.id === 197,
    );

    const uncorrectable = attributes.find(
      attr => attr.name.toLowerCase().includes('uncorrectable') || attr.id === 198,
    );

    return {
      reallocatedSectors: reallocated ? parseInt(reallocated.raw) : undefined,
      pendingSectors: pending ? parseInt(pending.raw) : undefined,
      uncorrectableErrors: uncorrectable ? parseInt(uncorrectable.raw) : undefined,
    };
  }

  private validateCpuInfo(cpu: any) {
    return {
      usage: this.validateNumber(cpu?.usage, 0, 0, 100),
      loadAverage: Array.isArray(cpu?.loadAverage)
        ? cpu.loadAverage.map(val => this.validateNumber(val, 0))
        : [0, 0, 0],
      cores: this.validateNumber(cpu?.cores, 1, 1),
      temperature:
        cpu?.temperature !== undefined
          ? this.validateNumber(cpu.temperature, undefined, 0, 150)
          : undefined,
    };
  }

  private validateMemoryInfo(memory: any) {
    const total = this.validateNumber(memory?.total, 0, 0);
    const used = this.validateNumber(memory?.used, 0, 0, total);
    const available = this.validateNumber(memory?.available, 0, 0, total);
    const percentage = total > 0 ? Math.round((used / total) * 100) : 0;

    return {
      total,
      used,
      available,
      percentage: this.validateNumber(percentage, 0, 0, 100),
    };
  }

  private validateDiskInfo(disk: any) {
    const total = this.validateNumber(disk?.total, 0, 0);
    const used = this.validateNumber(disk?.used, 0, 0, total);
    const available = this.validateNumber(disk?.available, 0, 0, total);
    const percentage = this.validateNumber(disk?.percentage, 0, 0, 100);

    return {
      total,
      used,
      available,
      percentage,
    };
  }

  private validateNetworkInfo(network: any) {
    const interfaces = Array.isArray(network?.interfaces)
      ? network.interfaces.map(iface => ({
          name: String(iface?.name || 'unknown'),
          ip: String(iface?.ip || '0.0.0.0'),
          mac: iface?.mac ? String(iface.mac) : undefined,
          rx: this.validateNumber(iface?.rx, 0, 0),
          tx: this.validateNumber(iface?.tx, 0, 0),
        }))
      : [];

    return { interfaces };
  }

  private validateNumber(value: any, fallback: number = 0, min?: number, max?: number): number {
    if (value === null || value === undefined || isNaN(Number(value))) {
      return fallback;
    }

    const num = Number(value);

    if (min !== undefined && num < min) return min;
    if (max !== undefined && num > max) return max;

    return num;
  }

  private getFallbackMetrics(): SystemMetrics {
    return {
      cpu: {
        usage: 0,
        loadAverage: [0, 0, 0],
        cores: 1,
      },
      memory: {
        total: 0,
        used: 0,
        available: 0,
        percentage: 0,
      },
      disk: {
        total: 0,
        used: 0,
        available: 0,
        percentage: 0,
      },
      network: {
        interfaces: [],
      },
      uptime: 0,
      hostname: 'unknown',
    };
  }

  // =====================
  // RAID Monitoring Methods
  // =====================

  async getRaidStatus(): Promise<RaidStatus> {
    try {
      const arrays = await this.getRaidArrays();
      const overall = this.calculateRaidOverallStatus(arrays);

      return {
        arrays,
        overall,
        lastUpdated: new Date(),
      };
    } catch (error) {
      this.logger.error('Failed to get RAID status', error);
      throw error;
    }
  }

  private async getRaidArrays(): Promise<RaidArray[]> {
    try {
      // Check if mdstat exists (Linux software RAID)
      const mdstatExists = await this.checkFileExists('/proc/mdstat');
      if (!mdstatExists) {
        this.logger.warn('/proc/mdstat not found - no software RAID arrays detected');
        return [];
      }

      // Read mdstat content
      const mdstatContent = await this.readFile('/proc/mdstat');
      const arrays = this.parseMdstatOutput(mdstatContent);

      // Enhance each array with detailed information
      const enhancedArrays = await Promise.all(
        arrays.map(array => this.enhanceRaidArrayInfo(array)),
      );

      return enhancedArrays;
    } catch (error) {
      this.logger.warn('Failed to get RAID arrays', error);
      return [];
    }
  }

  private async checkFileExists(filePath: string): Promise<boolean> {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  private async readFile(filePath: string): Promise<string> {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      this.logger.error(`Failed to read file ${filePath}`, error);
      throw error;
    }
  }

  private parseMdstatOutput(content: string): RaidArray[] {
    const arrays: RaidArray[] = [];
    const lines = content.split('\n');

    let currentArray: Partial<RaidArray> | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and header
      if (!line || line.startsWith('Personalities') || line.startsWith('unused devices')) {
        continue;
      }

      // Check if this is a new array definition line
      const arrayMatch = line.match(/^(md\d+)\s*:\s*(\w+)\s+(\w+)\s+(.+)/);
      if (arrayMatch) {
        // Save previous array if exists
        if (currentArray && currentArray.name) {
          arrays.push(this.finalizeRaidArray(currentArray));
        }

        // Start new array
        const [, name, state, level, deviceInfo] = arrayMatch;
        currentArray = {
          name,
          device: `/dev/${name}`,
          level: level.toUpperCase(),
          state: this.mapRaidState(state),
          devices: this.parseDeviceList(deviceInfo),
          activeDevices: 0,
          totalDevices: 0,
          workingDevices: 0,
          failedDevices: 0,
          spareDevices: 0,
          uuid: '', // Will be filled later
        };

        // Parse the next line for additional info
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          this.parseRaidStatusLine(currentArray, nextLine);
        }
      }
    }

    // Don't forget the last array
    if (currentArray && currentArray.name) {
      arrays.push(this.finalizeRaidArray(currentArray));
    }

    return arrays;
  }

  private mapRaidState(state: string): RaidArray['state'] {
    switch (state.toLowerCase()) {
      case 'active':
        return 'active';
      case 'clean':
        return 'clean';
      case 'degraded':
        return 'degraded';
      case 'recovering':
        return 'recovering';
      case 'resyncing':
        return 'resyncing';
      case 'failed':
        return 'failed';
      default:
        return 'active';
    }
  }

  private parseDeviceList(deviceInfo: string): RaidDevice[] {
    const devices: RaidDevice[] = [];

    // Match patterns like: sda1[0] sdb1[1]
    const deviceMatches = deviceInfo.match(/(\w+)\[(\d+)\](\([A-Z]\))?/g);

    if (deviceMatches) {
      deviceMatches.forEach(match => {
        const deviceMatch = match.match(/(\w+)\[(\d+)\](\([A-Z]\))?/);
        if (deviceMatch) {
          const [, deviceName, , statusFlag] = deviceMatch;

          let role: RaidDevice['role'] = 'active';
          let state: RaidDevice['state'] = 'in_sync';

          if (statusFlag) {
            switch (statusFlag) {
              case '(F)':
                role = 'faulty';
                state = 'faulty';
                break;
              case '(S)':
                role = 'spare';
                state = 'spare';
                break;
              case '(R)':
                role = 'active';
                state = 'rebuilding';
                break;
              default:
                role = 'active';
                state = 'in_sync';
            }
          }

          devices.push({
            device: `/dev/${deviceName}`,
            role,
            state,
            errors: 0, // Will be updated later if error info is available
          });
        }
      });
    }

    return devices;
  }

  private parseRaidStatusLine(array: Partial<RaidArray>, statusLine: string): void {
    // Parse status line like: "123456 blocks super 1.2 [2/2] [UU]" or "[2/1] [U_]" for degraded
    const statusMatch = statusLine.match(/\[(\d+)\/(\d+)\]\s*\[([U_F]+)\]/);
    if (statusMatch) {
      const [, total, active, statusFlags] = statusMatch;
      array.totalDevices = parseInt(total);
      array.activeDevices = parseInt(active);

      // Check if array is degraded based on active vs total devices
      if (array.activeDevices < array.totalDevices) {
        array.state = 'degraded';
      }

      // Update device states based on status flags
      if (array.devices) {
        statusFlags.split('').forEach((flag, index) => {
          if (index < array.devices!.length) {
            if (flag === 'U') {
              array.devices![index].state = 'in_sync';
              array.devices![index].role = 'active';
            } else if (flag === '_') {
              array.devices![index].state = 'faulty';
              array.devices![index].role = 'faulty';
            } else if (flag === 'F') {
              array.devices![index].state = 'faulty';
              array.devices![index].role = 'faulty';
            }
          }
        });
      }

      // Check for missing devices and update state
      const missingDevices = statusFlags.split('').filter(f => f === '_').length;
      if (missingDevices > 0) {
        array.state = 'degraded';
      }
    }

    // Parse rebuild progress if present
    const rebuildMatch = statusLine.match(
      /\[.*\]\s+recovery\s*=\s*([\d.]+)%.*\(([\d.]+[KMGT]\/sec)\)/,
    );
    if (rebuildMatch) {
      const [, percentage, speed] = rebuildMatch;
      array.rebuildProgress = {
        percentage: parseFloat(percentage),
        speed,
      };
    }
  }

  private finalizeRaidArray(array: Partial<RaidArray>): RaidArray {
    // Count device types
    const devices = array.devices || [];
    const workingDevices = devices.filter(d => d.state === 'in_sync').length;
    const failedDevices = devices.filter(d => d.state === 'faulty').length;
    const spareDevices = devices.filter(d => d.role === 'spare').length;

    return {
      name: array.name || '',
      device: array.device || '',
      level: array.level || 'UNKNOWN',
      state: array.state || 'active',
      activeDevices: array.activeDevices || workingDevices,
      totalDevices: array.totalDevices || devices.length,
      workingDevices,
      failedDevices,
      spareDevices,
      uuid: array.uuid || '',
      devices,
      rebuildProgress: array.rebuildProgress,
      lastCheck: array.lastCheck,
      nextCheck: array.nextCheck,
    };
  }

  private async enhanceRaidArrayInfo(array: RaidArray): Promise<RaidArray> {
    try {
      // Try to get more detailed info using mdadm
      const { stdout } = await execPromise(
        `sudo mdadm --detail ${array.device} 2>/dev/null || echo "not available"`,
      );

      if (!stdout.includes('not available')) {
        const lines = stdout.split('\n');

        // Extract UUID
        const uuidLine = lines.find(line => line.includes('UUID'));
        if (uuidLine) {
          const uuidMatch = uuidLine.match(/UUID\s*:\s*([a-f0-9-]+)/i);
          if (uuidMatch) {
            array.uuid = uuidMatch[1];
          }
        }

        // Extract last check time
        const lastCheckLine = lines.find(line => line.includes('Last Check'));
        if (lastCheckLine) {
          const dateMatch = lastCheckLine.match(/Last Check\s*:\s*(.+)/);
          if (dateMatch) {
            try {
              array.lastCheck = new Date(dateMatch[1].trim());
            } catch {
              // Ignore invalid date
            }
          }
        }

        // Update device error counts
        const deviceSection = lines.findIndex(line => line.includes('Number   Major   Minor'));
        if (deviceSection > -1) {
          for (let i = deviceSection + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.includes('---')) break;

            const deviceMatch = line.match(/\s*\d+\s+\d+\s+\d+\s+\w+\s+\w+\s+(.+)/);
            if (deviceMatch) {
              const devicePath = deviceMatch[1].trim();
              const device = array.devices.find(d => d.device === devicePath);
              if (device) {
                // Error count would be parsed here if available in the output
                // For now, we'll keep it at 0 as mdadm --detail doesn't always show error counts
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.debug(`Could not enhance RAID array info for ${array.device}: ${error.message}`);
    }

    return array;
  }

  private calculateRaidOverallStatus(arrays: RaidArray[]): RaidStatus['overall'] {
    const totalArrays = arrays.length;
    const healthyArrays = arrays.filter(
      arr => arr.state === 'clean' || arr.state === 'active',
    ).length;
    const degradedArrays = arrays.filter(arr => arr.state === 'degraded').length;
    const failedArrays = arrays.filter(arr => arr.state === 'failed').length;
    const rebuildingArrays = arrays.filter(
      arr => arr.state === 'recovering' || arr.state === 'resyncing',
    ).length;

    let status: 'healthy' | 'degraded' | 'failed' | 'rebuilding' = 'healthy';

    if (failedArrays > 0) {
      status = 'failed';
    } else if (rebuildingArrays > 0) {
      status = 'rebuilding';
    } else if (degradedArrays > 0) {
      status = 'degraded';
    }

    return {
      status,
      totalArrays,
      healthyArrays,
      degradedArrays,
      failedArrays,
      rebuildingArrays,
    };
  }

  // =====================
  // Database Sync Methods
  // =====================

  async triggerDatabaseSync(): Promise<{ success: boolean; message: string; jobId?: string }> {
    try {
      // Check if NODE_ENV is production to prevent syncing from test
      if (process.env.NODE_ENV !== 'production') {
        throw new Error('Database sync can only be triggered from production environment');
      }

      // Check if a sync is already running
      const isRunning = await this.isSyncRunning();
      if (isRunning) {
        return {
          success: false,
          message: 'A database sync is already in progress',
        };
      }

      // Execute the sync script in the background
      const scriptPath = '/home/kennedy/repositories/sync-prod-to-test.sh';

      // Use spawn to run in background and don't wait for completion
      const { spawn } = require('child_process');
      const syncProcess = spawn(scriptPath, [], {
        detached: true,
        stdio: 'ignore',
      });

      syncProcess.unref(); // Allow parent process to exit independently

      this.logger.log('Database sync triggered successfully');

      return {
        success: true,
        message: 'Database sync initiated successfully',
        jobId: `sync-${Date.now()}`,
      };
    } catch (error) {
      this.logger.error('Failed to trigger database sync', error);
      throw new Error(`Failed to trigger database sync: ${error.message}`);
    }
  }

  async getSyncStatus(): Promise<{
    lastSync?: Date;
    isRunning: boolean;
    lastSyncSuccess?: boolean;
    nextScheduledSync?: Date;
    recentLogs?: string;
  }> {
    try {
      const logFile = '/home/kennedy/repositories/sync.log';
      const isRunning = await this.isSyncRunning();

      let lastSync: Date | undefined;
      let lastSyncSuccess: boolean | undefined;
      let recentLogs: string | undefined;

      // Read the last few lines of the log file
      try {
        const { stdout } = await execPromise(`tail -n 100 "${logFile}" 2>/dev/null || echo ""`);
        recentLogs = stdout;

        // Extract last sync time from logs
        const successMatch = stdout.match(
          /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\].*✅ Sync completed successfully/,
        );
        if (successMatch) {
          lastSync = new Date(successMatch[1]);
          lastSyncSuccess = true;
        } else {
          const errorMatch = stdout.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\].*ERROR/);
          if (errorMatch) {
            lastSync = new Date(errorMatch[1]);
            lastSyncSuccess = false;
          }
        }
      } catch (error) {
        this.logger.debug('Could not read sync log file', error);
      }

      // Calculate next scheduled sync (00:00 or 12:00)
      const now = new Date();
      const nextSync = new Date(now);

      if (now.getHours() < 12) {
        nextSync.setHours(12, 0, 0, 0);
      } else {
        nextSync.setDate(nextSync.getDate() + 1);
        nextSync.setHours(0, 0, 0, 0);
      }

      return {
        lastSync,
        isRunning,
        lastSyncSuccess,
        nextScheduledSync: nextSync,
        recentLogs,
      };
    } catch (error) {
      this.logger.error('Failed to get sync status', error);
      throw new Error(`Failed to get sync status: ${error.message}`);
    }
  }

  private async isSyncRunning(): Promise<boolean> {
    try {
      const lockFile = '/tmp/db-sync.lock';

      // Check if lock file exists
      if (!fs.existsSync(lockFile)) {
        return false;
      }

      // Read PID from lock file
      const pid = fs.readFileSync(lockFile, 'utf8').trim();

      // Check if process is actually running
      try {
        await execPromise(`ps -p ${pid} > /dev/null 2>&1`);
        return true; // Process exists
      } catch {
        // Lock file exists but process doesn't - remove stale lock file
        fs.unlinkSync(lockFile);
        return false;
      }
    } catch (error) {
      this.logger.debug('Error checking if sync is running', error);
      return false;
    }
  }
}
