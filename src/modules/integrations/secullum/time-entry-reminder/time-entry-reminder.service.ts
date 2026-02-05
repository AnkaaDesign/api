import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SecullumService } from '../secullum.service';
import { NotificationService } from '@modules/common/notification/notification.service';
import { NotificationGatewayService } from '@modules/common/notification/notification-gateway.service';
import { isWeekend } from '../../../../utils/date';
import { SectorPrivileges } from '@prisma/client';

/**
 * Entry type for time clock reminders
 */
export type TimeEntryType = 'ENTRADA1' | 'SAIDA1' | 'ENTRADA2' | 'SAIDA2';

/**
 * Schedule configuration mapping sectors to their expected schedules
 */
interface ScheduleConfig {
  sectorPrivileges: SectorPrivileges[];
  scheduleCode?: string;
  scheduleDescription?: string;
  entrada1?: string; // HH:mm format
  saida1?: string;
  entrada2?: string;
  saida2?: string;
}

/**
 * Default schedule configurations by sector
 * These map our system's sectors to expected work times
 */
const SECTOR_SCHEDULE_CONFIGS: ScheduleConfig[] = [
  {
    // PINTURA schedule - 07:15 to 17:30 with lunch break
    sectorPrivileges: ['PRODUCTION', 'WAREHOUSE', 'MAINTENANCE'],
    scheduleCode: '1',
    scheduleDescription: 'PINTURA',
    entrada1: '07:15',
    saida1: '11:30',
    entrada2: '13:00',
    saida2: '17:30',
  },
  {
    // ADMINISTRAÇÃO schedule - 08:00 to 18:00 with lunch break
    sectorPrivileges: ['ADMIN', 'HUMAN_RESOURCES', 'FINANCIAL', 'COMMERCIAL'],
    scheduleCode: '2',
    scheduleDescription: 'ADMINISTRACAO',
    entrada1: '08:00',
    saida1: '12:00',
    entrada2: '13:00',
    saida2: '18:00',
  },
  {
    // DESIGNER/PLOTTING schedule - 08:00 to 17:30 with lunch break
    sectorPrivileges: ['DESIGNER', 'PLOTTING'],
    scheduleCode: '3',
    scheduleDescription: 'DESIGNER',
    entrada1: '08:00',
    saida1: '12:00',
    entrada2: '13:00',
    saida2: '17:30',
  },
  {
    // LOGISTIC schedule - 07:00 to 17:00 with lunch break
    sectorPrivileges: ['LOGISTIC'],
    scheduleCode: '4',
    scheduleDescription: 'LOGISTICA',
    entrada1: '07:00',
    saida1: '11:00',
    entrada2: '12:00',
    saida2: '17:00',
  },
];

/**
 * Result of checking a user's time entry
 */
interface TimeEntryCheckResult {
  userId: string;
  userName: string;
  secullumId: number;
  entryType: TimeEntryType;
  expectedTime: string;
  isMissing: boolean;
  actualTime?: string;
}

@Injectable()
export class TimeEntryReminderService {
  private readonly logger = new Logger(TimeEntryReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secullumService: SecullumService,
    private readonly notificationService: NotificationService,
    private readonly notificationGatewayService: NotificationGatewayService,
  ) {}

  /**
   * Get the schedule configuration for a user's sector
   */
  private getScheduleConfigForSector(sectorPrivilege: SectorPrivileges): ScheduleConfig | null {
    return (
      SECTOR_SCHEDULE_CONFIGS.find((config) =>
        config.sectorPrivileges.includes(sectorPrivilege),
      ) || null
    );
  }

  /**
   * Parse time string to minutes from midnight for comparison
   */
  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Check if current time is past the expected entry time (with tolerance)
   */
  private isTimePastEntry(expectedTime: string, toleranceMinutes: number = 15): boolean {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const expectedMinutes = this.timeToMinutes(expectedTime);
    return currentMinutes >= expectedMinutes + toleranceMinutes;
  }

  /**
   * Check if today is a working day (not weekend and not holiday)
   */
  async isWorkingDay(): Promise<boolean> {
    const today = new Date();

    // Check weekend first (quick check)
    if (isWeekend(today)) {
      this.logger.log('Today is a weekend, skipping time entry checks');
      return false;
    }

    // Check Secullum holidays
    try {
      const year = today.getFullYear();
      const holidaysResponse = await this.secullumService.getHolidays({ year });

      if (holidaysResponse.success && holidaysResponse.data) {
        const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

        const isHoliday = holidaysResponse.data.some((holiday) => {
          const holidayDate = holiday.Data.split('T')[0];
          return holidayDate === todayStr;
        });

        if (isHoliday) {
          this.logger.log('Today is a holiday, skipping time entry checks');
          return false;
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to check holidays: ${error.message}. Proceeding with checks.`);
    }

    return true;
  }

  /**
   * Get all active users who should be working and have time clock requirements
   */
  async getActiveUsersForTimeCheck(): Promise<
    Array<{
      id: string;
      name: string;
      cpf: string | null;
      pis: string | null;
      payrollNumber: number | null;
      sectorPrivilege: SectorPrivileges | null;
    }>
  > {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        dismissedAt: null,
        // Exclude users on vacation
        vacations: {
          none: {
            AND: [
              { startAt: { lte: new Date() } },
              { endAt: { gte: new Date() } },
              { status: 'APPROVED' },
            ],
          },
        },
        // Must have CPF or PIS for Secullum mapping
        OR: [{ cpf: { not: null } }, { pis: { not: null } }, { payrollNumber: { not: null } }],
      },
      select: {
        id: true,
        name: true,
        cpf: true,
        pis: true,
        payrollNumber: true,
        sector: {
          select: {
            privilege: true,
          },
        },
      },
    });

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      pis: user.pis,
      payrollNumber: user.payrollNumber,
      sectorPrivilege: user.sector?.privilege || null,
    }));
  }

  /**
   * Check if a specific time entry is missing for a user
   */
  async checkUserTimeEntry(
    user: {
      id: string;
      name: string;
      cpf: string | null;
      pis: string | null;
      payrollNumber: number | null;
      sectorPrivilege: SectorPrivileges | null;
    },
    entryType: TimeEntryType,
  ): Promise<TimeEntryCheckResult | null> {
    // Get schedule config for user's sector
    if (!user.sectorPrivilege) {
      this.logger.debug(`User ${user.name} has no sector, skipping`);
      return null;
    }

    const scheduleConfig = this.getScheduleConfigForSector(user.sectorPrivilege);
    if (!scheduleConfig) {
      this.logger.debug(`No schedule config for sector ${user.sectorPrivilege}`);
      return null;
    }

    // Get expected time for this entry type
    const expectedTimeKey = entryType.toLowerCase() as keyof ScheduleConfig;
    const expectedTime = scheduleConfig[expectedTimeKey] as string | undefined;

    if (!expectedTime) {
      this.logger.debug(`No ${entryType} time configured for sector ${user.sectorPrivilege}`);
      return null;
    }

    // Find Secullum employee
    let secullumEmployee;
    try {
      secullumEmployee = await this.secullumService.findSecullumEmployee({
        cpf: user.cpf || undefined,
        pis: user.pis || undefined,
        payrollNumber: user.payrollNumber || undefined,
      });

      if (!secullumEmployee.success || !secullumEmployee.data) {
        this.logger.debug(`No Secullum mapping for user ${user.name}`);
        return null;
      }
    } catch (error) {
      this.logger.warn(`Failed to find Secullum employee for ${user.name}: ${error.message}`);
      return null;
    }

    // Get today's time entries
    const today = new Date().toISOString().split('T')[0];
    let timeEntries;
    try {
      timeEntries = await this.secullumService.getTimeEntriesBySecullumId(
        secullumEmployee.data.secullumId,
        today,
        today,
      );
    } catch (error) {
      this.logger.warn(`Failed to get time entries for ${user.name}: ${error.message}`);
      return null;
    }

    // Check if entry exists
    const todayEntry = timeEntries?.[0];
    const entryFieldMap: Record<TimeEntryType, string> = {
      ENTRADA1: 'Entrada1',
      SAIDA1: 'Saida1',
      ENTRADA2: 'Entrada2',
      SAIDA2: 'Saida2',
    };

    const fieldName = entryFieldMap[entryType];
    const actualTime = todayEntry?.[fieldName] || null;
    const isMissing = !actualTime;

    return {
      userId: user.id,
      userName: user.name,
      secullumId: secullumEmployee.data.secullumId,
      entryType,
      expectedTime,
      isMissing,
      actualTime: actualTime || undefined,
    };
  }

  /**
   * Check all users for missing time entries and send notifications
   */
  async checkAndNotifyMissingEntries(entryType: TimeEntryType): Promise<{
    checked: number;
    missing: number;
    notified: number;
    errors: number;
  }> {
    const stats = { checked: 0, missing: 0, notified: 0, errors: 0 };

    this.logger.log(`Starting time entry check for ${entryType}`);

    // Check if it's a working day
    const isWorkingDay = await this.isWorkingDay();
    if (!isWorkingDay) {
      this.logger.log('Not a working day, skipping checks');
      return stats;
    }

    // Get active users
    const users = await this.getActiveUsersForTimeCheck();
    this.logger.log(`Found ${users.length} active users to check`);

    // Check each user
    for (const user of users) {
      try {
        stats.checked++;

        const result = await this.checkUserTimeEntry(user, entryType);
        if (!result) continue;

        if (result.isMissing) {
          stats.missing++;

          // Send notification
          await this.sendTimeEntryReminder(user.id, user.name, entryType, result.expectedTime);
          stats.notified++;

          this.logger.log(
            `Sent ${entryType} reminder to ${user.name} (expected: ${result.expectedTime})`,
          );
        }
      } catch (error) {
        stats.errors++;
        this.logger.error(`Error checking user ${user.name}: ${error.message}`);
      }
    }

    this.logger.log(
      `Time entry check completed: checked=${stats.checked}, missing=${stats.missing}, notified=${stats.notified}, errors=${stats.errors}`,
    );

    return stats;
  }

  /**
   * Send a time entry reminder notification to a user
   */
  async sendTimeEntryReminder(
    userId: string,
    userName: string,
    entryType: TimeEntryType,
    expectedTime: string,
  ): Promise<void> {
    const entryTypeLabels: Record<TimeEntryType, string> = {
      ENTRADA1: 'entrada (1º período)',
      SAIDA1: 'saída para almoço',
      ENTRADA2: 'retorno do almoço',
      SAIDA2: 'saída (fim do expediente)',
    };

    const entryLabel = entryTypeLabels[entryType];
    const today = new Date().toLocaleDateString('pt-BR');

    try {
      const notification = await this.notificationService.createNotification({
        type: 'SERVICE',
        title: 'Lembrete de Ponto',
        body: `Você ainda não registrou sua ${entryLabel}. Horário esperado: ${expectedTime}.`,
        importance: 'NORMAL',
        userId,
        actionUrl: '/pessoal/meus-pontos',
        metadata: {
          entryType,
          expectedTime,
          date: today,
          entityType: 'TimeEntry',
          notificationKey: 'timeentry.reminder',
        },
      });

      // Send via WebSocket for immediate delivery
      if (notification) {
        await this.notificationGatewayService.sendToUser(userId, notification);
      }
    } catch (error) {
      this.logger.error(`Failed to send notification to ${userName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get schedule summary for debugging/admin purposes
   */
  async getScheduleSummary(): Promise<{
    schedules: Array<{
      code: string;
      description: string;
      sectors: SectorPrivileges[];
      times: { entrada1?: string; saida1?: string; entrada2?: string; saida2?: string };
    }>;
    secullumSchedules: any[];
  }> {
    // Get our configured schedules
    const schedules = SECTOR_SCHEDULE_CONFIGS.map((config) => ({
      code: config.scheduleCode || 'N/A',
      description: config.scheduleDescription || 'N/A',
      sectors: config.sectorPrivileges,
      times: {
        entrada1: config.entrada1,
        saida1: config.saida1,
        entrada2: config.entrada2,
        saida2: config.saida2,
      },
    }));

    // Get Secullum schedules
    let secullumSchedules: any[] = [];
    try {
      const response = await this.secullumService.getHorarios();
      if (response.success && response.data) {
        secullumSchedules = response.data;
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch Secullum schedules: ${error.message}`);
    }

    return { schedules, secullumSchedules };
  }
}
