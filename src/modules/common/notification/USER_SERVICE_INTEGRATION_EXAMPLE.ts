/**
 * EXAMPLE: How to integrate notification preference initialization
 * into your User Service
 *
 * This file shows different approaches to initializing notification preferences
 * when a new user is created.
 */

import { Injectable, Logger } from '@nestjs/common';
import { NotificationPreferenceInitService } from './notification-preference-init.service';

// ============================================
// APPROACH 1: Direct Service Call (Recommended)
// ============================================

@Injectable()
export class UserServiceExample1 {
  private readonly logger = new Logger(UserServiceExample1.name);

  constructor(
    // Your existing dependencies
    // private readonly userRepository: UserRepository,
    // private readonly prisma: PrismaService,

    // Add this dependency
    private readonly notificationPreferenceInitService: NotificationPreferenceInitService,
  ) {}

  async createUser(data: any): Promise<any> {
    try {
      // 1. Create the user first
      const user = await this.createUserInDatabase(data);

      // 2. Initialize notification preferences
      // This is non-blocking - if it fails, preferences will be auto-initialized on first access
      await this.notificationPreferenceInitService.initializeForNewUser(user.id);

      this.logger.log(`User created successfully with ID: ${user.id}`);
      return user;
    } catch (error) {
      this.logger.error('Failed to create user', error);
      throw error;
    }
  }

  private async createUserInDatabase(data: any): Promise<any> {
    // Your existing user creation logic
    return { id: 'user-uuid', ...data };
  }
}

// ============================================
// APPROACH 2: Non-Blocking (Fire and Forget)
// ============================================

@Injectable()
export class UserServiceExample2 {
  private readonly logger = new Logger(UserServiceExample2.name);

  constructor(
    private readonly notificationPreferenceInitService: NotificationPreferenceInitService,
  ) {}

  async createUser(data: any): Promise<any> {
    // 1. Create the user
    const user = await this.createUserInDatabase(data);

    // 2. Initialize preferences without waiting (fire and forget)
    // This won't block user creation even if preference initialization fails
    this.notificationPreferenceInitService.initializeForNewUser(user.id).catch(error => {
      this.logger.warn(`Failed to initialize notification preferences for user ${user.id}`, error);
      // Preferences will be auto-initialized when user first accesses them
    });

    return user;
  }

  private async createUserInDatabase(data: any): Promise<any> {
    return { id: 'user-uuid', ...data };
  }
}

// ============================================
// APPROACH 3: Transaction-Based (Atomic)
// ============================================

@Injectable()
export class UserServiceExample3 {
  private readonly logger = new Logger(UserServiceExample3.name);

  constructor(
    // private readonly prisma: PrismaService,
    private readonly notificationPreferenceInitService: NotificationPreferenceInitService,
  ) {}

  async createUser(data: any): Promise<any> {
    // If you need both user creation and preference initialization to be atomic
    // (both succeed or both fail), you can use a transaction

    // Note: This approach requires the preference service to support transactions
    // The current implementation doesn't require this level of atomicity since
    // preferences can be auto-initialized later if needed

    const user = await this.createUserInDatabase(data);
    await this.notificationPreferenceInitService.initializeForNewUser(user.id);

    return user;
  }

  private async createUserInDatabase(data: any): Promise<any> {
    return { id: 'user-uuid', ...data };
  }
}

// ============================================
// APPROACH 4: Event-Based (Decoupled)
// ============================================

// First, make sure you have EventEmitter installed and configured:
// npm install @nestjs/event-emitter

import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class UserServiceExample4 {
  private readonly logger = new Logger(UserServiceExample4.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async createUser(data: any): Promise<any> {
    // 1. Create the user
    const user = await this.createUserInDatabase(data);

    // 2. Emit event (don't wait for handlers)
    this.eventEmitter.emit('user.created', {
      userId: user.id,
      email: user.email,
      timestamp: new Date(),
    });

    return user;
  }

  private async createUserInDatabase(data: any): Promise<any> {
    return { id: 'user-uuid', ...data };
  }
}

// Then update notification-preference-init.service.ts to listen for the event:
@Injectable()
export class NotificationPreferenceInitServiceWithEvents {
  private readonly logger = new Logger(NotificationPreferenceInitServiceWithEvents.name);

  constructor(
    private readonly notificationPreferenceInitService: NotificationPreferenceInitService,
  ) {}

  @OnEvent('user.created')
  async handleUserCreated(payload: { userId: string; email: string; timestamp: Date }) {
    this.logger.log(`Handling user.created event for user: ${payload.userId}`);

    try {
      await this.notificationPreferenceInitService.initializeForNewUser(payload.userId);
      this.logger.log(`Notification preferences initialized for user: ${payload.userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to initialize notification preferences for user ${payload.userId}`,
        error,
      );
      // Preferences will be auto-initialized on first access
    }
  }
}

// ============================================
// APPROACH 5: Batch Initialization (Migration)
// ============================================

@Injectable()
export class UserMigrationService {
  private readonly logger = new Logger(UserMigrationService.name);

  constructor(
    // private readonly userRepository: UserRepository,
    private readonly notificationPreferenceInitService: NotificationPreferenceInitService,
  ) {}

  /**
   * Use this for migrating existing users who don't have preferences yet
   */
  async migrateAllUsers(): Promise<void> {
    this.logger.log('Starting notification preference migration for all users');

    // 1. Get all user IDs (paginated for large datasets)
    const userIds = await this.getAllUserIds();

    this.logger.log(`Found ${userIds.length} users to migrate`);

    // 2. Initialize preferences in batches
    await this.notificationPreferenceInitService.initializeForMultipleUsers(userIds);

    this.logger.log('Notification preference migration completed');
  }

  /**
   * Check which users need preference initialization
   */
  async findUsersWithoutPreferences(): Promise<string[]> {
    // This would query your database to find users without preferences
    const allUserIds = await this.getAllUserIds();
    const usersWithoutPrefs: string[] = [];

    for (const userId of allUserIds) {
      const hasPrefs =
        await this.notificationPreferenceInitService.hasPreferencesInitialized(userId);
      if (!hasPrefs) {
        usersWithoutPrefs.push(userId);
      }
    }

    return usersWithoutPrefs;
  }

  private async getAllUserIds(): Promise<string[]> {
    // Your implementation to get all user IDs
    return [];
  }
}

// ============================================
// MODULE CONFIGURATION
// ============================================

/**
 * Make sure your UserModule imports NotificationModule:
 */

/*
import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { NotificationModule } from '@modules/common/notification/notification.module';

@Module({
  imports: [
    NotificationModule, // Import to get access to NotificationPreferenceInitService
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
*/

// ============================================
// USAGE RECOMMENDATION
// ============================================

/**
 * Recommended approach for most applications:
 *
 * 1. Use APPROACH 1 (Direct Service Call) for simplicity and reliability
 * 2. If you need truly non-blocking behavior, use APPROACH 2
 * 3. If you're building a microservices architecture, use APPROACH 4
 * 4. Use APPROACH 5 for one-time migration of existing users
 *
 * The system is designed to be resilient:
 * - If initialization fails, preferences will be auto-created on first access
 * - No user data is lost if preference initialization fails
 * - All failures are logged for monitoring
 */
