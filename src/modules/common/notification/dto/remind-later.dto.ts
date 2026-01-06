import {
  IsEnum,
  IsUUID,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REMINDER_INTERVAL } from '../notification-reminder-scheduler.service';

/**
 * DTO for setting a reminder for a notification
 */
export class RemindLaterDto {
  @ApiProperty({
    description: 'Notification ID to set reminder for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
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
 * DTO for setting a custom reminder time
 */
export class RemindAtDto {
  @ApiProperty({
    description: 'Notification ID to set reminder for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  notificationId: string;

  @ApiProperty({
    description: 'Specific date and time to remind (ISO date string)',
    example: '2026-01-10T10:00:00Z',
  })
  @IsDateString()
  remindAt: string;
}

/**
 * DTO for snoozing a notification (relative time)
 */
export class SnoozeNotificationDto {
  @ApiProperty({
    description: 'Notification ID to snooze',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  notificationId: string;

  @ApiProperty({
    description: 'Snooze duration in minutes',
    example: 30,
    minimum: 5,
    maximum: 10080,
  })
  @IsInt()
  @Min(5)
  @Max(10080)
  durationMinutes: number;
}

/**
 * DTO for rescheduling an existing reminder
 */
export class RescheduleReminderDto {
  @ApiProperty({
    description: 'Notification ID to reschedule reminder for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
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
 * DTO for rescheduling reminder to a specific time
 */
export class RescheduleReminderAtDto {
  @ApiProperty({
    description: 'Notification ID to reschedule reminder for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  notificationId: string;

  @ApiProperty({
    description: 'New date and time to remind (ISO date string)',
    example: '2026-01-10T15:00:00Z',
  })
  @IsDateString()
  newRemindAt: string;
}

/**
 * DTO for cancelling a reminder
 */
export class CancelReminderDto {
  @ApiProperty({
    description: 'Notification ID to cancel reminder for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  notificationId: string;
}

/**
 * DTO for getting reminder status
 */
export class GetReminderStatusDto {
  @ApiProperty({
    description: 'Notification ID to get reminder status for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  notificationId: string;
}

/**
 * DTO for setting default snooze preferences
 */
export class UpdateSnoozePreferencesDto {
  @ApiProperty({
    description: 'Default snooze interval',
    enum: REMINDER_INTERVAL,
    example: REMINDER_INTERVAL.ONE_HOUR,
  })
  @IsEnum(REMINDER_INTERVAL)
  defaultInterval: REMINDER_INTERVAL;

  @ApiPropertyOptional({
    description: 'Maximum number of times a notification can be snoozed',
    example: 3,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxSnoozeCount?: number;
}

/**
 * DTO for batch reminder operations
 */
export class BatchRemindLaterDto {
  @ApiProperty({
    description: 'Array of notification IDs to set reminders for',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
  })
  @IsUUID('4', { each: true })
  notificationIds: string[];

  @ApiProperty({
    description: 'Time interval for all reminders',
    enum: REMINDER_INTERVAL,
    example: REMINDER_INTERVAL.ONE_HOUR,
  })
  @IsEnum(REMINDER_INTERVAL)
  interval: REMINDER_INTERVAL;
}

/**
 * DTO for smart reminder suggestions
 */
export class GetReminderSuggestionsDto {
  @ApiProperty({
    description: 'Notification ID to get reminder suggestions for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  notificationId: string;
}
