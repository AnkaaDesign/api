import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NotificationPreferenceService } from './notification-preference.service';

/**
 * Service responsible for initializing notification preferences
 * This service provides methods to be called when a new user is created
 */
@Injectable()
export class NotificationPreferenceInitService implements OnModuleInit {
  private readonly logger = new Logger(NotificationPreferenceInitService.name);

  constructor(private readonly preferenceService: NotificationPreferenceService) {}

  onModuleInit() {
    this.logger.log('NotificationPreferenceInitService initialized');
  }

  /**
   * Initialize notification preferences for a newly created user
   * This method should be called in the user creation flow
   *
   * @param userId - The ID of the newly created user
   * @returns Promise<void>
   */
  async initializeForNewUser(userId: string): Promise<void> {
    try {
      this.logger.log(`Initializing notification preferences for new user: ${userId}`);

      await this.preferenceService.initializeUserPreferences(userId);

      this.logger.log(`Successfully initialized notification preferences for user: ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to initialize notification preferences for user ${userId}`, error);
      // Don't throw - we don't want to block user creation if preference initialization fails
      // The preferences will be auto-initialized on first access
    }
  }

  /**
   * Initialize notification preferences for multiple users (batch operation)
   * Useful for migrating existing users or bulk operations
   *
   * @param userIds - Array of user IDs
   * @returns Promise<void>
   */
  async initializeForMultipleUsers(userIds: string[]): Promise<void> {
    this.logger.log(`Batch initializing notification preferences for ${userIds.length} users`);

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const userId of userIds) {
      try {
        await this.preferenceService.initializeUserPreferences(userId);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(`User ${userId}: ${error.message}`);
        this.logger.error(`Failed to initialize preferences for user ${userId}`, error);
      }
    }

    this.logger.log(
      `Batch initialization completed: ${results.success} succeeded, ${results.failed} failed`,
    );

    if (results.failed > 0) {
      this.logger.warn(`Errors during batch initialization:`, results.errors);
    }
  }

  /**
   * Check if a user has notification preferences initialized
   *
   * @param userId - The user ID to check
   * @returns Promise<boolean>
   */
  async hasPreferencesInitialized(userId: string): Promise<boolean> {
    try {
      const preferences = await this.preferenceService.getUserPreferences(userId);
      return preferences.length > 0;
    } catch (error) {
      this.logger.error(`Failed to check preferences for user ${userId}`, error);
      return false;
    }
  }
}
