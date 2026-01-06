import { IsEnum, IsString, IsUUID, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REMINDER_INTERVAL } from '../notification-reminder-scheduler.service';

/**
 * DTO for scheduling a reminder
 */
export class ScheduleReminderDto {
  @ApiProperty({
    description: 'Notification ID to set reminder for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  notificationId: string;

  @ApiProperty({
    description: 'Time interval for reminder',
    enum: REMINDER_INTERVAL,
    example: REMINDER_INTERVAL.ONE_HOUR,
  })
  @IsEnum(REMINDER_INTERVAL)
  interval: REMINDER_INTERVAL;
}

/**
 * DTO for rescheduling a reminder
 */
export class RescheduleReminderDto {
  @ApiProperty({
    description: 'Notification ID to reschedule reminder for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  notificationId: string;

  @ApiProperty({
    description: 'New time interval for reminder',
    enum: REMINDER_INTERVAL,
    example: REMINDER_INTERVAL.THREE_HOURS,
  })
  @IsEnum(REMINDER_INTERVAL)
  newInterval: REMINDER_INTERVAL;
}

/**
 * DTO for cancelling a reminder
 */
export class CancelReminderDto {
  @ApiProperty({
    description: 'Notification ID to cancel reminder for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  notificationId: string;
}

/**
 * DTO for cleanup request
 */
export class CleanupRemindersDto {
  @ApiPropertyOptional({
    description: 'Number of days old to consider expired',
    example: 30,
    default: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  daysOld?: number;
}

/**
 * Response DTO for reminder statistics
 */
export class ReminderStatsResponseDto {
  @ApiProperty({ description: 'Total pending reminders' })
  totalPending: number;

  @ApiProperty({ description: 'Number of overdue reminders' })
  overdue: number;

  @ApiProperty({ description: 'Number of upcoming reminders (within 1 hour)' })
  upcoming: number;

  @ApiProperty({ description: 'Reminders grouped by user ID' })
  byUser: Record<string, number>;

  @ApiProperty({ description: 'Reminders grouped by interval' })
  byInterval: Record<string, number>;
}

/**
 * Response DTO for reminder options
 */
export class ReminderOptionResponseDto {
  @ApiProperty({ description: 'Interval value', enum: REMINDER_INTERVAL })
  value: REMINDER_INTERVAL;

  @ApiProperty({ description: 'Display label', example: '1 hour' })
  label: string;

  @ApiProperty({ description: 'Description', example: 'Remind me in 1 hour' })
  description: string;

  @ApiProperty({ description: 'Time in milliseconds', example: 3600000 })
  milliseconds: number;
}

/**
 * Response DTO for reminder with notification data
 */
export class ReminderWithDataResponseDto {
  @ApiProperty({ description: 'Reminder ID' })
  id: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'Notification ID' })
  notificationId: string;

  @ApiProperty({ description: 'Reminder time' })
  remindAt: Date;

  @ApiProperty({ description: 'When notification was seen' })
  seenAt: Date;

  @ApiProperty({ description: 'Number of reminders set for this notification' })
  reminderCount: number;

  @ApiProperty({ description: 'Notification data' })
  notification: {
    id: string;
    title: string;
    body: string;
    type: string;
    importance: string;
    actionUrl?: string;
    actionType?: string;
  };

  @ApiProperty({ description: 'User data' })
  user: {
    id: string;
    name: string;
    email: string;
  };
}

/**
 * Response DTO for manual processing result
 */
export class ManualProcessingResponseDto {
  @ApiProperty({ description: 'Number of reminders processed successfully' })
  processed: number;

  @ApiProperty({ description: 'Number of reminders that failed processing' })
  errors: number;
}

/**
 * Response DTO for cleanup result
 */
export class CleanupResponseDto {
  @ApiProperty({ description: 'Number of expired reminders cleaned up' })
  count: number;

  @ApiProperty({ description: 'Success message' })
  message: string;
}

/**
 * Response DTO for reminder operation success
 */
export class ReminderSuccessResponseDto {
  @ApiProperty({ description: 'Success status' })
  success: boolean;

  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiPropertyOptional({ description: 'Optional data payload' })
  data?: any;
}
