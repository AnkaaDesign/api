import { Controller, Get, Post, Query, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { TimeEntryReminderService, TimeEntryType } from './time-entry-reminder.service';
import { TimeEntryReminderScheduler } from './time-entry-reminder.scheduler';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ReadRateLimit } from '@modules/common/throttler/throttler.decorators';
import { SECTOR_PRIVILEGES } from '../../../../constants/enums';

@Controller('integrations/secullum/time-entry-reminder')
export class TimeEntryReminderController {
  private readonly logger = new Logger(TimeEntryReminderController.name);

  constructor(
    private readonly timeEntryReminderService: TimeEntryReminderService,
    private readonly timeEntryReminderScheduler: TimeEntryReminderScheduler,
  ) {}

  /**
   * Get schedule summary for debugging
   * GET /integrations/secullum/time-entry-reminder/schedules
   */
  @Get('schedules')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getScheduleSummary(@UserId() userId: string): Promise<any> {
    this.logger.log(`User ${userId} requesting schedule summary`);
    return await this.timeEntryReminderService.getScheduleSummary();
  }

  /**
   * Check if today is a working day
   * GET /integrations/secullum/time-entry-reminder/is-working-day
   */
  @Get('is-working-day')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async checkWorkingDay(@UserId() userId: string): Promise<{ isWorkingDay: boolean }> {
    this.logger.log(`User ${userId} checking if today is a working day`);
    const isWorkingDay = await this.timeEntryReminderService.isWorkingDay();
    return { isWorkingDay };
  }

  /**
   * Get list of active users for time check
   * GET /integrations/secullum/time-entry-reminder/users
   */
  @Get('users')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getActiveUsers(@UserId() userId: string): Promise<any> {
    this.logger.log(`User ${userId} requesting active users for time check`);
    const users = await this.timeEntryReminderService.getActiveUsersForTimeCheck();
    return {
      count: users.length,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        sector: u.sectorPrivilege,
        hasMapping: !!(u.cpf || u.pis || u.payrollNumber),
      })),
    };
  }

  /**
   * Trigger a manual time entry check (admin only)
   * POST /integrations/secullum/time-entry-reminder/trigger?entryType=ENTRADA1
   */
  @Post('trigger')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async triggerManualCheck(
    @UserId() userId: string,
    @Query('entryType') entryType: string,
  ): Promise<any> {
    const validEntryTypes: TimeEntryType[] = ['ENTRADA1', 'SAIDA1', 'ENTRADA2', 'SAIDA2'];

    if (!entryType || !validEntryTypes.includes(entryType as TimeEntryType)) {
      return {
        success: false,
        message: `Invalid entryType. Must be one of: ${validEntryTypes.join(', ')}`,
      };
    }

    this.logger.log(`User ${userId} triggering manual check for ${entryType}`);

    const result = await this.timeEntryReminderScheduler.triggerManualCheck(
      entryType as TimeEntryType,
    );

    return {
      success: true,
      entryType,
      result,
    };
  }

  /**
   * Check a specific user's time entry status
   * GET /integrations/secullum/time-entry-reminder/check-user?userId=xxx&entryType=ENTRADA1
   */
  @Get('check-user')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async checkUserTimeEntry(
    @UserId() requesterId: string,
    @Query('userId') targetUserId: string,
    @Query('entryType') entryType: string,
  ): Promise<any> {
    if (!targetUserId) {
      return { success: false, message: 'userId query parameter is required' };
    }

    const validEntryTypes: TimeEntryType[] = ['ENTRADA1', 'SAIDA1', 'ENTRADA2', 'SAIDA2'];
    if (!entryType || !validEntryTypes.includes(entryType as TimeEntryType)) {
      return {
        success: false,
        message: `Invalid entryType. Must be one of: ${validEntryTypes.join(', ')}`,
      };
    }

    this.logger.log(`User ${requesterId} checking time entry for user ${targetUserId}`);

    // Get user details
    const users = await this.timeEntryReminderService.getActiveUsersForTimeCheck();
    const user = users.find((u) => u.id === targetUserId);

    if (!user) {
      return {
        success: false,
        message: 'User not found or not active',
      };
    }

    const result = await this.timeEntryReminderService.checkUserTimeEntry(
      user,
      entryType as TimeEntryType,
    );

    return {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        sector: user.sectorPrivilege,
      },
      entryType,
      result,
    };
  }
}
