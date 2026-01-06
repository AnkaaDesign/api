/**
 * Notification Queue Processors
 *
 * This module exports all notification queue processors for background job processing.
 * Each processor handles a specific notification channel with appropriate configuration.
 */

// Export Email Processor
export { EmailProcessor } from './email.processor';
export type {
  EmailJobData,
  EmailDeliveryResult,
} from './email.processor';

// Export Push Processor
export { PushProcessor } from './push.processor';
export type {
  PushJobData,
  PushDeliveryResult,
} from './push.processor';

// Export WhatsApp Processor
export { WhatsAppProcessor } from './whatsapp.processor';
export type {
  WhatsAppJobData,
  WhatsAppDeliveryResult,
} from './whatsapp.processor';

// Export Reminder Processor
export { ReminderProcessor } from './reminder.processor';
export type {
  ReminderJobData,
  ReminderProcessingResult,
} from './reminder.processor';

/**
 * Queue Configuration Summary
 *
 * Email Queue (email-notifications):
 * - Concurrency: 5
 * - Rate Limit: 60 per minute
 * - Retry: 3 attempts with exponential backoff (base: 2s)
 * - Use case: Email delivery via EmailService (SMTP)
 *
 * Push Queue (push-notifications):
 * - Concurrency: 10
 * - Rate Limit: 100 per minute
 * - Retry: 3 attempts with exponential backoff (base: 2s)
 * - Use case: Push notifications via Firebase Cloud Messaging
 *
 * WhatsApp Queue (whatsapp-notifications):
 * - Concurrency: 3
 * - Rate Limit: 20 per minute
 * - Retry: 3 attempts with exponential backoff (base: 5s)
 * - Use case: WhatsApp messages via WhatsApp Web API
 *
 * Reminder Queue (reminder-notifications):
 * - Concurrency: 5
 * - Retry: 3 attempts with exponential backoff (base: 3s)
 * - Use case: Scheduled reminders (one-time and recurring)
 * - Features: Multi-channel dispatch, automatic rescheduling
 */
