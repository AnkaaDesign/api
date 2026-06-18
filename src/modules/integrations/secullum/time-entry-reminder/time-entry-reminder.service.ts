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

  private nowInSaoPaulo(): Date {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) => parseInt(parts.find(p => p.type === type)!.value, 10);
    return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  }

  private todayStrSaoPaulo(): string {
    const now = this.nowInSaoPaulo();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

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

    const todayDow = this.nowInSaoPaulo().getDay(); // 0=Sun .. 6=Sat
    const dayEntry = raw.Dias.find(d => d.DiaSemana === todayDow);

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
    const now = this.nowInSaoPaulo();
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
   * Redis dedup key for a sector escalation (independent of the employee reminder key,
   * since the escalation fires on a later tick with a larger grace window).
   */
  private escalationDedupKey(date: string, userId: string, entryType: TimeEntryType): string {
    return `time-entry-escalation:${date}:${userId}:${entryType}`;
  }

  /**
   * Check if today is a working day (not weekend and not holiday)
   */
  async isWorkingDay(): Promise<boolean> {
    const today = this.nowInSaoPaulo();

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
        const todayStr = this.todayStrSaoPaulo(); // YYYY-MM-DD

        const isHoliday = holidaysResponse.data.some(holiday => {
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
   * Get all active users who should be working and have time clock requirements.
   * Only returns users with a populated `secullumEmployeeId` — runtime CPF/PIS/payrollNumber
   * matching is no longer performed here; mapping is owned by the user-secullum-sync.service.
   */
  async getActiveUsersForTimeCheck(): Promise<
    Array<{
      id: string;
      name: string;
      secullumEmployeeId: number;
    }>
  > {
    // Fetch all active users (linked AND unlinked) so we can log how many
    // were skipped due to missing secullumEmployeeId — mirrors the canonical
    // skip-with-log pattern in secullum.service.ts:getTimeEntriesByDay.
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        currentContractStatus: { not: 'TERMINATED' },
      },
      select: {
        id: true,
        name: true,
        secullumEmployeeId: true,
      },
    });

    const linked: Array<{ id: string; name: string; secullumEmployeeId: number }> = [];
    let skippedUnlinked = 0;
    for (const user of users) {
      if (user.secullumEmployeeId == null) {
        skippedUnlinked++;
        this.logger.debug(
          `getActiveUsersForTimeCheck: skipping user ${user.id} (${user.name}) — secullumEmployeeId is null`,
        );
        continue;
      }
      linked.push({
        id: user.id,
        name: user.name,
        secullumEmployeeId: user.secullumEmployeeId,
      });
    }

    if (skippedUnlinked > 0) {
      this.logger.debug(
        `getActiveUsersForTimeCheck: ${skippedUnlinked}/${users.length} user(s) had no secullumEmployeeId and were skipped`,
      );
    }

    return linked;
  }

  /**
   * Look up a Secullum employee from a pre-fetched list using the user's
   * persisted `secullumEmployeeId` (no CPF/PIS/payrollNumber matching).
   */
  private findEmployeeById(secullumEmployeeId: number, employees: any[]): any | null {
    return employees.find((emp: any) => Number(emp.Id) === secullumEmployeeId) || null;
  }

  /**
   * Check if a specific time entry is missing for a user
   */
  async checkUserTimeEntry(
    user: {
      id: string;
      name: string;
      secullumEmployeeId: number;
    },
    entryType: TimeEntryType,
    preloadedEmployees?: any[],
  ): Promise<TimeEntryCheckResult | null> {
    // Resolve the Secullum employee record (from preloaded list or via single fetch).
    // We always use User.secullumEmployeeId — never CPF/PIS/payrollNumber.
    let secullumEmployee: any;
    let horarioId: number | undefined;

    if (preloadedEmployees) {
      const match = this.findEmployeeById(user.secullumEmployeeId, preloadedEmployees);
      if (!match) {
        this.logger.debug(
          `Secullum employee Id ${user.secullumEmployeeId} not found in preloaded list for user ${user.name}`,
        );
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
        const empResponse = await this.secullumService.getEmployees();
        if (!empResponse.success || !Array.isArray(empResponse.data)) {
          this.logger.warn(`Failed to fetch Secullum employees for ${user.name}`);
          return null;
        }
        const match = this.findEmployeeById(user.secullumEmployeeId, empResponse.data);
        if (!match) {
          this.logger.debug(
            `Secullum employee Id ${user.secullumEmployeeId} not returned for user ${user.name}`,
          );
          return null;
        }
        secullumEmployee = {
          secullumId: match.Id,
          nome: match.Nome,
          horarioId: match.HorarioId,
        };
        horarioId = match.HorarioId;
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
    const today = this.todayStrSaoPaulo();
    let timeEntries;
    try {
      // Always use the persisted FK (User.secullumEmployeeId) — never CPF/PIS/payroll.
      timeEntries = await this.secullumService.getTimeEntriesBySecullumId(
        user.secullumEmployeeId,
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
    const actualTime = todayEntry?.[fieldName] ?? null;
    const isMissing = !actualTime || actualTime === '';

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
   * Fetch Secullum employees and clear the schedule cache.
   * Called once per scheduler run before iterating all entry types,
   * so the /Funcionarios and /Horarios calls are not repeated 4× per tick.
   * Returns the employee list, or null if the fetch failed (caller should abort the run).
   */
  async prepareRun(): Promise<any[] | null> {
    this.scheduleCache.clear();
    try {
      const empResponse = await this.secullumService.getEmployees();
      if (empResponse.success && Array.isArray(empResponse.data)) {
        return empResponse.data;
      }
      this.logger.warn('Secullum getEmployees returned no data');
      return [];
    } catch (error) {
      this.logger.error(`Failed to fetch Secullum employees: ${error.message}`);
      return null;
    }
  }

  /**
   * Check all users for missing time entries and send notifications.
   * Called for each entry type. Uses Redis dedup to avoid duplicate notifications.
   * Pass `preloadedEmployees` (from prepareRun) to skip per-call employee fetch.
   */
  async checkAndNotifyMissingEntries(
    entryType: TimeEntryType,
    preloadedEmployees?: any[],
  ): Promise<{
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

    // Use preloaded employees if provided (scheduler pre-fetches once per run);
    // otherwise fetch independently (e.g. manual trigger for a single type).
    let allSecullumEmployees: any[];
    if (preloadedEmployees !== undefined) {
      allSecullumEmployees = preloadedEmployees;
    } else {
      this.scheduleCache.clear();
      try {
        const empResponse = await this.secullumService.getEmployees();
        if (empResponse.success && Array.isArray(empResponse.data)) {
          allSecullumEmployees = empResponse.data;
        } else {
          allSecullumEmployees = [];
        }
      } catch (error) {
        this.logger.error(`Failed to fetch Secullum employees: ${error.message}`);
        return stats;
      }
    }

    // Get active users
    const users = await this.getActiveUsersForTimeCheck();
    this.logger.log(`Found ${users.length} active users to check`);

    const today = this.todayStrSaoPaulo();

    // Check each user
    for (const user of users) {
      try {
        stats.checked++;

        const result = await this.checkUserTimeEntry(user, entryType, allSecullumEmployees);
        if (!result) continue;

        if (result.isMissing) {
          stats.missing++;

          // Redis dedup check (employee reminder)
          const key = this.dedupKey(today, user.id, entryType);
          const alreadySent = await this.cacheService.exists(key);
          if (alreadySent) {
            stats.skippedDedup++;
            this.logger.debug(
              `Skipping duplicate ${entryType} reminder for ${user.name} (already sent today)`,
            );
          } else {
            // Send notification
            await this.sendTimeEntryReminder(user.id, user.name, entryType, result.expectedTime);

            // Mark as sent (24h TTL)
            await this.cacheService.set(key, '1', 24 * 60 * 60);

            stats.notified++;

            this.logger.log(
              `Sent ${entryType} reminder to ${user.name} (expected: ${result.expectedTime})`,
            );
          }

          // Sector escalation: fires on the same 15-min grace window as the
          // employee reminder, so HR/admin/production-manager are notified at the
          // same tick the employee is. Own dedup key, independent of the employee
          // reminder's.
          if (this.isTimePastEntry(result.expectedTime, 15)) {
            const escalationKey = this.escalationDedupKey(today, user.id, entryType);
            const escalationSent = await this.cacheService.exists(escalationKey);
            if (!escalationSent) {
              await this.sendTimeEntryEscalation(
                { id: user.id, name: user.name },
                entryType,
                result.expectedTime,
              );

              // Mark as sent (24h TTL)
              await this.cacheService.set(escalationKey, '1', 24 * 60 * 60);

              this.logger.log(
                `Sent ${entryType} escalation for ${user.name} (expected: ${result.expectedTime})`,
              );
            }
          }
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
            allowExtendedHours: true, // Clock-out (SAIDA2) reminders may fire until 18:45
          },
          overrides: {
            actionUrl: '/pessoal/meus-pontos',
            webUrl: '/pessoal/meus-pontos',
            mobileUrl: '/(tabs)/pessoal/meus-pontos',
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
   * Escalate a still-missing punch to the responsible sectors.
   * Config key: timeentry.missing.escalation (sector-routed — the config row carries
   * ADMIN + HUMAN_RESOURCES + PRODUCTION_MANAGER in allowedSectors).
   * Fired on the same 15-min grace window as the employee reminder.
   */
  async sendTimeEntryEscalation(
    user: { id: string; name: string },
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
      await this.dispatchService.dispatchByConfiguration(
        'timeentry.missing.escalation',
        'system', // Cron-triggered, no actor user
        {
          entityType: 'TimeEntry',
          entityId: user.id, // Use userId as entity since there's no TimeEntry entity
          action: 'missing_escalation',
          data: {
            userName: user.name,
            entryType,
            entryLabel,
            expectedTime,
            date: today,
          },
          metadata: {
            entryType,
            expectedTime,
            date: today,
            noReschedule: true, // Time-sensitive — drop if outside work hours
            allowExtendedHours: true, // Clock-out (SAIDA2) escalations may fire until 18:45
          },
          overrides: {
            webUrl: '/departamento-pessoal/controle-ponto',
            mobileUrl: '/(tabs)/recursos-humanos/controle-ponto',
            relatedEntityType: 'TIME_ENTRY',
            title: `Ponto não registrado — ${user.name}`,
            body: `${user.name} não registrou ${entryLabel} (horário esperado: ${expectedTime}) em ${today}.`,
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to send time entry escalation for ${user.name}: ${error.message}`,
      );
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
          response.data.map(async h => {
            const raw = await this.secullumService.getHorarioRawById(h.Id);
            if (!raw) return null;
            return {
              id: raw.Id,
              descricao: raw.Descricao,
              dias: (raw.Dias || []).map(d => ({
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

  /**
   * Resolve the active escalation-sector user ids (HUMAN_RESOURCES + PRODUCTION_MANAGER)
   * once per scan. These users receive an RH/management-facing copy of every
   * unjustified-absence event (the employee gets their own employee-facing copy).
   * Returns [] on any failure so the scan never breaks the business flow.
   */
  private async resolveEscalationUserIds(): Promise<string[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          sector: { privileges: { in: ['HUMAN_RESOURCES', 'PRODUCTION_MANAGER'] as any } },
        },
        select: { id: true },
      });
      return users.map((u) => u.id);
    } catch (err: any) {
      this.logger.warn(
        `Failed to resolve escalation-sector users for unjustified-absence dispatch: ${err?.message ?? err}`,
      );
      return [];
    }
  }

  /**
   * Daily unjustified-absence detector.
   * Config key: secullum.absence.unjustified (targeted=true).
   *
   * Notifies BOTH the absent employee (employee-facing deep link → meus-pontos)
   * AND the HUMAN_RESOURCES sector users (RH-facing deep link → calculos). The
   * employee and RH copies use independent Redis dedup keys. Rows without a
   * linked Ankaa user still generate an RH notification so the event is never
   * silently dropped.
   *
   * Scans the given day (defaults to "yesterday" in São Paulo) via
   * SecullumService.getUnjustifiedAbsences, which already fans out one
   * /Calculos call per linked employee and resolves each row to an internal
   * userId/name. Per-(user,date) Redis dedup prevents re-notifying on retries.
   *
   * NOTE: invoked by TimeEntryReminderScheduler's daily cron. Heavy fan-out —
   * runs once per day only.
   */
  async checkAndNotifyUnjustifiedAbsences(targetDate?: string): Promise<{
    scanned: number;
    notified: number;
    skippedDedup: number;
    errors: number;
  }> {
    const stats = { scanned: 0, notified: 0, skippedDedup: 0, errors: 0 };

    // Default to yesterday (São Paulo) so the previous workday's calculations
    // have settled. Format YYYY-MM-DD.
    let day = targetDate;
    if (!day) {
      const nowSp = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
      );
      nowSp.setDate(nowSp.getDate() - 1);
      const y = nowSp.getFullYear();
      const m = String(nowSp.getMonth() + 1).padStart(2, '0');
      const d = String(nowSp.getDate()).padStart(2, '0');
      day = `${y}-${m}-${d}`;
    }

    let response;
    try {
      response = await this.secullumService.getUnjustifiedAbsences({
        startDate: day,
        endDate: day,
      });
    } catch (error: any) {
      this.logger.error(
        `Unjustified-absence scan failed for ${day}: ${error?.message ?? error}`,
      );
      stats.errors++;
      return stats;
    }

    const rows = response?.success && Array.isArray(response.data) ? response.data : [];
    stats.scanned = rows.length;

    // Resolve escalation-sector recipients (HR + production managers) once;
    // every row also notifies them so the sector is no longer silently left out
    // (the previous code only ever notified the employee). Wrapped so a failure
    // here cannot break the scan.
    const hrUserIds = await this.resolveEscalationUserIds();

    for (const row of rows) {
      try {
        const userId = (row as any).userId as string | undefined;
        const userName = (row as any).userName as string | undefined;
        // SecullumAggregatedAbsence carries `Inicio` (ISO, YYYY-MM-DDT00:00:00).
        const absenceDate = String((row as any).Inicio ?? '').slice(0, 10) || day;
        const funcionarioId = (row as any).FuncionarioId as number | undefined;
        const displayName = userName ?? `Funcionário ${funcionarioId ?? '?'}`;

        // 1) Employee-facing copy (only when the row maps to a linked Ankaa user).
        if (userId) {
          const dedup = `secullum-unjustified:${day}:${userId}`;
          const seen = await this.cacheService.get(dedup);
          if (seen) {
            stats.skippedDedup++;
          } else {
            await this.dispatchService.dispatchByConfigurationToUsers(
              'secullum.absence.unjustified',
              'system',
              {
                entityType: 'SecullumSolicitacao',
                entityId: `${userId}:${absenceDate}`,
                action: 'unjustified',
                data: {
                  userName: displayName,
                  date: absenceDate,
                },
                metadata: { date: absenceDate },
                overrides: {
                  title: 'Ausência não justificada',
                  body: `Foi detectada uma ausência não justificada em ${absenceDate}. Justifique ou procure o RH.`,
                  webUrl: '/pessoal/meus-pontos',
                  mobileUrl: '/(tabs)/pessoal/meus-pontos',
                  relatedEntityType: 'SECULLUM_SOLICITACAO',
                },
              },
              [userId],
            );
            await this.cacheService.set(dedup, '1', 7 * 24 * 60 * 60);
            stats.notified++;
          }
        }

        // 2) RH-facing copy (always, including rows with no linked Ankaa user so
        // the event is never silently dropped). Independent dedup key.
        if (hrUserIds.length > 0) {
          const rhDedupId = userId ?? `func-${funcionarioId ?? 'unknown'}`;
          const rhDedup = `secullum-unjustified-rh:${day}:${rhDedupId}`;
          const rhSeen = await this.cacheService.get(rhDedup);
          if (rhSeen) {
            stats.skippedDedup++;
          } else {
            await this.dispatchService.dispatchByConfigurationToUsers(
              'secullum.absence.unjustified',
              'system',
              {
                entityType: 'SecullumSolicitacao',
                entityId: `${rhDedupId}:${absenceDate}`,
                action: 'unjustified',
                data: {
                  userName: displayName,
                  date: absenceDate,
                },
                metadata: { date: absenceDate },
                overrides: {
                  title: 'Ausência não justificada de funcionário',
                  body: `Foi detectada uma ausência não justificada de ${displayName} em ${absenceDate}.${
                    userId ? '' : ' (funcionário sem usuário vinculado no Ankaa).'
                  }`,
                  webUrl: '/departamento-pessoal/controle-ponto/ausencias',
                  mobileUrl: '/(tabs)/recursos-humanos/calculos',
                  relatedEntityType: 'SECULLUM_SOLICITACAO',
                },
              },
              hrUserIds,
            );
            await this.cacheService.set(rhDedup, '1', 7 * 24 * 60 * 60);
            stats.notified++;
          }
        }
      } catch (error: any) {
        this.logger.error(
          `Failed to dispatch unjustified-absence notification: ${error?.message ?? error}`,
        );
        stats.errors++;
      }
    }

    this.logger.log(
      `Unjustified-absence scan ${day}: scanned=${stats.scanned} notified=${stats.notified} dedup=${stats.skippedDedup} errors=${stats.errors}`,
    );
    return stats;
  }
}
