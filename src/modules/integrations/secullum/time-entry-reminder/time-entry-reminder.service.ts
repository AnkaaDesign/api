import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CacheService } from '@modules/common/cache/cache.service';
import { SecullumService } from '../secullum.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { isWeekend } from '../../../../utils/date';
import { SecullumHorarioRaw } from '../dto';

/**
 * Entry type for time clock reminders
 */
export type TimeEntryType = 'ENTRADA1' | 'SAIDA1' | 'ENTRADA2' | 'SAIDA2';

/**
 * Resolved schedule times for a given day
 */
interface ScheduleTimes {
  entrada1: string | null; // HH:mm
  saida1: string | null;
  entrada2: string | null;
  saida2: string | null;
}

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

  /** In-memory schedule cache, cleared at the start of each checkAndNotifyMissingEntries run */
  private scheduleCache = new Map<number, ScheduleTimes | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly secullumService: SecullumService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Convert "HH:mm:ss" to "HH:mm", or return as-is if already "HH:mm"
   */
  private normalizeTime(time: string | null): string | null {
    if (!time) return null;
    // Handle "HH:mm:ss" -> "HH:mm"
    const parts = time.split(':');
    if (parts.length >= 2) {
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }
    return time;
  }

  /**
   * Fetch and cache schedule times for today from Secullum by horarioId
   */
  private async getScheduleTimesForToday(horarioId: number): Promise<ScheduleTimes | null> {
    // Check in-memory cache first
    if (this.scheduleCache.has(horarioId)) {
      return this.scheduleCache.get(horarioId)!;
    }

    const raw: SecullumHorarioRaw | null = await this.secullumService.getHorarioRawById(horarioId);
    if (!raw || !raw.Dias || raw.Dias.length === 0) {
      this.scheduleCache.set(horarioId, null);
      return null;
    }

    const todayDow = new Date().getDay(); // 0=Sun .. 6=Sat
    const dayEntry = raw.Dias.find((d) => d.DiaSemana === todayDow);

    if (!dayEntry) {
      this.scheduleCache.set(horarioId, null);
      return null;
    }

    const times: ScheduleTimes = {
      entrada1: this.normalizeTime(dayEntry.Entrada1),
      saida1: this.normalizeTime(dayEntry.Saida1),
      entrada2: this.normalizeTime(dayEntry.Entrada2),
      saida2: this.normalizeTime(dayEntry.Saida2),
    };

    this.scheduleCache.set(horarioId, times);
    return times;
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
   * Redis dedup key for a reminder
   */
  private dedupKey(date: string, userId: string, entryType: TimeEntryType): string {
    return `time-entry-reminder:${date}:${userId}:${entryType}`;
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
      },
    });

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      pis: user.pis,
      payrollNumber: user.payrollNumber,
    }));
  }

  /**
   * Match a user to a Secullum employee from a pre-fetched employee list (avoids N+1)
   */
  private matchEmployeeInList(
    user: { cpf: string | null; pis: string | null; payrollNumber: number | null },
    employees: any[],
  ): any | null {
    const normalizeCpf = (cpf: string): string => (cpf ? cpf.replace(/[.-]/g, '') : '');

    const userCpf = user.cpf ? normalizeCpf(user.cpf) : '';
    const userPis = user.pis || '';
    const userPayrollNumber = user.payrollNumber?.toString() || '';

    return (
      employees.find((emp: any) => {
        const empCpf = normalizeCpf(emp.Cpf || '');
        const empPis = emp.NumeroPis || '';
        const empPayrollNumber = emp.NumeroFolha || '';

        const cpfMatch = userCpf && empCpf === userCpf;
        const pisMatch = userPis && empPis === userPis;
        const payrollMatch = userPayrollNumber && empPayrollNumber === userPayrollNumber;

        return cpfMatch || pisMatch || payrollMatch;
      }) || null
    );
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
    },
    entryType: TimeEntryType,
    preloadedEmployees?: any[],
  ): Promise<TimeEntryCheckResult | null> {
    // Find Secullum employee (from preloaded list or via API)
    let secullumEmployee: any;
    let horarioId: number | undefined;

    if (preloadedEmployees) {
      const match = this.matchEmployeeInList(user, preloadedEmployees);
      if (!match) {
        this.logger.debug(`No Secullum mapping for user ${user.name}`);
        return null;
      }
      secullumEmployee = {
        secullumId: match.Id,
        nome: match.Nome,
        horarioId: match.HorarioId,
      };
      horarioId = match.HorarioId;
    } else {
      try {
        const result = await this.secullumService.findSecullumEmployee({
          cpf: user.cpf || undefined,
          pis: user.pis || undefined,
          payrollNumber: user.payrollNumber || undefined,
        });

        if (!result.success || !result.data) {
          this.logger.debug(`No Secullum mapping for user ${user.name}`);
          return null;
        }
        secullumEmployee = result.data;
        horarioId = result.data.horarioId;
      } catch (error) {
        this.logger.warn(`Failed to find Secullum employee for ${user.name}: ${error.message}`);
        return null;
      }
    }

    // Must have a horarioId to look up schedule
    if (!horarioId) {
      this.logger.debug(`User ${user.name} has no horarioId in Secullum`);
      return null;
    }

    // Get schedule times for today
    const scheduleTimes = await this.getScheduleTimesForToday(horarioId);
    if (!scheduleTimes) {
      this.logger.debug(`No schedule found for horarioId ${horarioId} on today's day of week`);
      return null;
    }

    // Get expected time for this entry type
    const entryTypeToKey: Record<TimeEntryType, keyof ScheduleTimes> = {
      ENTRADA1: 'entrada1',
      SAIDA1: 'saida1',
      ENTRADA2: 'entrada2',
      SAIDA2: 'saida2',
    };
    const expectedTime = scheduleTimes[entryTypeToKey[entryType]];

    if (!expectedTime) {
      this.logger.debug(`No ${entryType} time in schedule for user ${user.name}`);
      return null;
    }

    // Check if current time is past expected + tolerance
    if (!this.isTimePastEntry(expectedTime, 15)) {
      return null;
    }

    // Get today's time entries
    const today = new Date().toISOString().split('T')[0];
    let timeEntries;
    try {
      timeEntries = await this.secullumService.getTimeEntriesBySecullumId(
        secullumEmployee.secullumId,
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
      secullumId: secullumEmployee.secullumId,
      entryType,
      expectedTime,
      isMissing,
      actualTime: actualTime || undefined,
    };
  }

  /**
   * Check all users for missing time entries and send notifications.
   * Called for each entry type. Uses Redis dedup to avoid duplicate notifications.
   */
  async checkAndNotifyMissingEntries(entryType: TimeEntryType): Promise<{
    checked: number;
    missing: number;
    notified: number;
    skippedDedup: number;
    errors: number;
  }> {
    const stats = { checked: 0, missing: 0, notified: 0, skippedDedup: 0, errors: 0 };

    this.logger.log(`Starting time entry check for ${entryType}`);

    // Check if it's a working day
    const isWorkingDay = await this.isWorkingDay();
    if (!isWorkingDay) {
      this.logger.log('Not a working day, skipping checks');
      return stats;
    }

    // Clear in-memory schedule cache at the start of each run
    this.scheduleCache.clear();

    // Fetch all Secullum employees once (avoid N+1)
    let allSecullumEmployees: any[] = [];
    try {
      const empResponse = await this.secullumService.getEmployees();
      if (empResponse.success && Array.isArray(empResponse.data)) {
        allSecullumEmployees = empResponse.data;
      }
    } catch (error) {
      this.logger.error(`Failed to fetch Secullum employees: ${error.message}`);
      return stats;
    }

    // Get active users
    const users = await this.getActiveUsersForTimeCheck();
    this.logger.log(`Found ${users.length} active users to check`);

    const today = new Date().toISOString().split('T')[0];

    // Check each user
    for (const user of users) {
      try {
        stats.checked++;

        const result = await this.checkUserTimeEntry(user, entryType, allSecullumEmployees);
        if (!result) continue;

        if (result.isMissing) {
          stats.missing++;

          // Redis dedup check
          const key = this.dedupKey(today, user.id, entryType);
          const alreadySent = await this.cacheService.exists(key);
          if (alreadySent) {
            stats.skippedDedup++;
            this.logger.debug(
              `Skipping duplicate ${entryType} reminder for ${user.name} (already sent today)`,
            );
            continue;
          }

          // Send notification
          await this.sendTimeEntryReminder(user.id, user.name, entryType, result.expectedTime);

          // Mark as sent (24h TTL)
          await this.cacheService.set(key, '1', 24 * 60 * 60);

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
      `Time entry check completed: checked=${stats.checked}, missing=${stats.missing}, notified=${stats.notified}, skippedDedup=${stats.skippedDedup}, errors=${stats.errors}`,
    );

    return stats;
  }

  /**
   * Send a time entry reminder notification to a user
   * Config key: timeentry.reminder
   * Uses dispatchByConfigurationToUsers for targeted user dispatch
   * (checks config enablement + user notification preferences before sending).
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
      await this.dispatchService.dispatchByConfigurationToUsers(
        'timeentry.reminder',
        'system', // Cron-triggered, no actor user
        {
          entityType: 'TimeEntry',
          entityId: userId, // Use userId as entity since there's no TimeEntry entity
          action: 'reminder',
          data: {
            userName,
            entryType,
            entryLabel,
            expectedTime,
            date: today,
          },
          metadata: {
            entryType,
            expectedTime,
            date: today,
            noReschedule: true, // Time entry reminders are time-sensitive — drop if outside work hours
          },
          overrides: {
            actionUrl: '/pessoal/meus-pontos',
            webUrl: '/pessoal/meus-pontos',
            relatedEntityType: 'TIME_ENTRY',
            title: 'Lembrete de Ponto',
            body: `Você ainda não registrou sua ${entryLabel}. Horário esperado: ${expectedTime}.`,
          },
        },
        [userId],
      );
    } catch (error) {
      this.logger.error(`Failed to send notification to ${userName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get schedule summary for debugging/admin purposes.
   * Now shows actual Secullum schedules instead of hardcoded configs.
   */
  async getScheduleSummary(): Promise<{
    secullumSchedules: Array<{
      id: number;
      descricao: string;
      dias: Array<{
        diaSemana: number;
        entrada1: string | null;
        saida1: string | null;
        entrada2: string | null;
        saida2: string | null;
      }>;
    }>;
  }> {
    let secullumSchedules: any[] = [];
    try {
      const response = await this.secullumService.getHorarios();
      if (response.success && response.data) {
        // Fetch raw data for each to get the Dias array
        const rawSchedules = await Promise.all(
          response.data.map(async (h) => {
            const raw = await this.secullumService.getHorarioRawById(h.Id);
            if (!raw) return null;
            return {
              id: raw.Id,
              descricao: raw.Descricao,
              dias: (raw.Dias || []).map((d) => ({
                diaSemana: d.DiaSemana,
                entrada1: this.normalizeTime(d.Entrada1),
                saida1: this.normalizeTime(d.Saida1),
                entrada2: this.normalizeTime(d.Entrada2),
                saida2: this.normalizeTime(d.Saida2),
              })),
            };
          }),
        );
        secullumSchedules = rawSchedules.filter(Boolean);
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch Secullum schedules: ${error.message}`);
    }

    return { secullumSchedules };
  }
}
