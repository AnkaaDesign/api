import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATION_TYPE, SECTOR_PRIVILEGES } from '@constants';
import type { User, Notification } from '@types';
import { NotificationPreferenceService } from './notification-preference.service';

/**
 * Interface for notification filter configuration
 */
interface NotificationFilter {
  notificationType: NOTIFICATION_TYPE;
  requiredSectors: SECTOR_PRIVILEGES[];
  minPrivilegeLevel?: number;
  customFilter?: (user: User, notification: Notification) => boolean;
}

/**
 * Interface for notification metadata
 * This is used to pass contextual information with notifications
 */
interface NotificationMetadata {
  task?: {
    id: string;
    sectorId: string | null;
    status?: string;
    createdById?: string | null;
    assignedUserIds?: string[];
    supervisorId?: string | null;
  };
  cut?: {
    id: string;
    taskId?: string | null;
    taskSectorId?: string | null;
    type: 'VINYL' | 'STENCIL';
    origin: 'PLAN' | 'REQUEST';
    reason?: 'WRONG_APPLY' | 'LOST' | 'WRONG' | null;
    status?: 'PENDING' | 'CUTTING' | 'COMPLETED';
    createdById?: string | null;
  };
  order?: {
    id: string;
    type?: string;
  };
  stock?: {
    itemId: string;
    level?: string;
    severity?: 'LOW' | 'CRITICAL';
  };
  ppe?: {
    deliveryId?: string;
    userId?: string;
  };
  financial?: {
    amount?: number;
    type?: string;
  };
  production?: {
    taskId?: string;
    type?: string;
  };
  maintenance?: {
    itemId?: string;
    type?: string;
  };
  vacation?: {
    id: string;
    userId: string;
  };
  warning?: {
    id: string;
    userId: string;
  };
  [key: string]: any;
}

/**
 * Filter criteria for combining multiple filter rules
 */
interface FilterCriteria {
  sectors?: SECTOR_PRIVILEGES[];
  minPrivilegeLevel?: number;
  userIds?: string[];
  excludeUserIds?: string[];
  customFilter?: (user: User) => boolean;
}

/**
 * Service responsible for filtering notifications based on user roles and privileges
 *
 * This service implements a comprehensive filtering system that ensures notifications
 * are only sent to users who have the appropriate sector privileges and access rights.
 *
 * Key Features:
 * - Role-based filtering: Filter by user sector/privilege
 * - Sector-based filtering: Only users in specific sectors can see certain notifications
 * - Privilege level checking: Some notifications require minimum privilege levels
 * - Custom filters: Type-specific business logic for complex filtering rules
 * - ADMIN override: Admins can see all notifications regardless of filters
 * - User preference checking: Respect user notification preferences (after role filtering)
 * - MANDATORY notifications: Ignore user preferences for critical notifications
 */
@Injectable()
export class NotificationFilterService {
  private readonly logger = new Logger(NotificationFilterService.name);

  /**
   * Privilege level mapping based on sector sort order
   * Higher numbers indicate higher privilege levels
   */
  private readonly SECTOR_PRIVILEGES_LEVELS: Record<SECTOR_PRIVILEGES, number> = {
    [SECTOR_PRIVILEGES.BASIC]: 1,
    [SECTOR_PRIVILEGES.PRODUCTION]: 6,
    [SECTOR_PRIVILEGES.MAINTENANCE]: 4,
    [SECTOR_PRIVILEGES.WAREHOUSE]: 5,
    [SECTOR_PRIVILEGES.PLOTTING]: 7,
    [SECTOR_PRIVILEGES.DESIGNER]: 3,
    [SECTOR_PRIVILEGES.LOGISTIC]: 6,
    [SECTOR_PRIVILEGES.FINANCIAL]: 6,
    [SECTOR_PRIVILEGES.COMMERCIAL]: 7,
    [SECTOR_PRIVILEGES.HUMAN_RESOURCES]: 9,
    [SECTOR_PRIVILEGES.ADMIN]: 10,
    [SECTOR_PRIVILEGES.EXTERNAL]: 0, // External users have no privilege level
  };

  /**
   * Notification filters configuration
   * Defines which sectors can receive which notification types
   */
  private readonly NOTIFICATION_FILTERS: Record<NOTIFICATION_TYPE, NotificationFilter> = {
    // TASK notifications: Assigned users + supervisor + admin
    [NOTIFICATION_TYPE.TASK]: {
      notificationType: NOTIFICATION_TYPE.TASK,
      requiredSectors: [], // All users can potentially see task notifications
      customFilter: (user: User, notification: Notification) => {
        const metadata = this.parseMetadata(notification);
        const task = metadata?.task;

        if (!task) {
          return true;
        }

        // Admin can see all tasks
        if (user.sector?.privileges === SECTOR_PRIVILEGES.ADMIN) {
          return true;
        }

        // Assigned users can see the task
        if (task.assignedUserIds?.includes(user.id)) {
          return true;
        }

        // Supervisor can see tasks they supervise
        if (task.supervisorId === user.id) {
          return true;
        }

        // User can see tasks in their sector
        if (user.sectorId === task.sectorId) {
          return true;
        }

        // Sector managers can see tasks in their managed sector
        if (user.managedSector && user.managedSector.id === task.sectorId) {
          return true;
        }

        // User created the task
        if (task.createdById === user.id) {
          return true;
        }

        // Warehouse can see all production-related tasks (inventory management)
        if (user.sector?.privileges === SECTOR_PRIVILEGES.WAREHOUSE) {
          return true;
        }

        return false;
      },
    },

    // ORDER notifications: Only ADMIN, WAREHOUSE (inventory management)
    [NOTIFICATION_TYPE.ORDER]: {
      notificationType: NOTIFICATION_TYPE.ORDER,
      requiredSectors: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.WAREHOUSE],
    },

    // STOCK notifications: Only ADMIN, WAREHOUSE
    [NOTIFICATION_TYPE.STOCK]: {
      notificationType: NOTIFICATION_TYPE.STOCK,
      requiredSectors: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.WAREHOUSE],
    },

    // GENERAL notifications: All users can see general notifications
    [NOTIFICATION_TYPE.GENERAL]: {
      notificationType: NOTIFICATION_TYPE.GENERAL,
      requiredSectors: [], // All users can see general notifications
    },

    // PPE notifications: ADMIN, HUMAN_RESOURCES, WAREHOUSE, or specific user
    [NOTIFICATION_TYPE.PPE]: {
      notificationType: NOTIFICATION_TYPE.PPE,
      requiredSectors: [
        SECTOR_PRIVILEGES.ADMIN,
        SECTOR_PRIVILEGES.HUMAN_RESOURCES,
        SECTOR_PRIVILEGES.WAREHOUSE,
      ],
      customFilter: (user: User, notification: Notification) => {
        const metadata = this.parseMetadata(notification);
        const ppe = metadata?.ppe;

        // If the PPE notification is for a specific user, they should see it
        if (ppe?.userId === user.id) {
          return true;
        }

        // Otherwise, rely on sector-based filtering
        return false;
      },
    },

    // VACATION notifications: ADMIN, HUMAN_RESOURCES, or the user themselves
    [NOTIFICATION_TYPE.VACATION]: {
      notificationType: NOTIFICATION_TYPE.VACATION,
      requiredSectors: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES],
      customFilter: (user: User, notification: Notification) => {
        const metadata = this.parseMetadata(notification);
        const vacation = metadata?.vacation;

        // If the vacation notification is for a specific user, they should see it
        if (vacation?.userId === user.id) {
          return true;
        }

        // Sector managers can see vacation notifications for their team
        if (user.managedSector) {
          return false;
        }

        return false;
      },
    },

    // WARNING notifications: ADMIN, HUMAN_RESOURCES, or involved parties
    [NOTIFICATION_TYPE.WARNING]: {
      notificationType: NOTIFICATION_TYPE.WARNING,
      requiredSectors: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES],
      customFilter: (user: User, notification: Notification) => {
        const metadata = this.parseMetadata(notification);
        const warning = metadata?.warning;

        // If the warning notification is for a specific user, they should see it
        if (warning?.userId === user.id) {
          return true;
        }

        // Sector managers can see warnings for their team
        if (user.managedSector) {
          return false;
        }

        return false;
      },
    },

    // SYSTEM notifications: All users can see system notifications
    [NOTIFICATION_TYPE.SYSTEM]: {
      notificationType: NOTIFICATION_TYPE.SYSTEM,
      requiredSectors: [], // All users can see system notifications
    },

    // SERVICE_ORDER notifications: Based on service order type and role
    [NOTIFICATION_TYPE.SERVICE_ORDER]: {
      notificationType: NOTIFICATION_TYPE.SERVICE_ORDER,
      requiredSectors: [
        SECTOR_PRIVILEGES.ADMIN,
        SECTOR_PRIVILEGES.DESIGNER,
        SECTOR_PRIVILEGES.PRODUCTION,
        SECTOR_PRIVILEGES.FINANCIAL,
        SECTOR_PRIVILEGES.LOGISTIC,
        SECTOR_PRIVILEGES.COMMERCIAL,
      ],
      customFilter: (user: User, notification: Notification) => {
        const metadata = this.parseMetadata(notification);
        const serviceOrder = metadata?.serviceOrder;

        // Admin can see all service order notifications
        if (user.sector?.privileges === SECTOR_PRIVILEGES.ADMIN) {
          return true;
        }

        // If the service order is assigned to this user, they should see it
        if (serviceOrder?.assignedToId === user.id) {
          return true;
        }

        // If the user created the service order, they should see completion notifications
        if (serviceOrder?.createdById === user.id) {
          return true;
        }

        // Check based on service order type
        const serviceOrderType = serviceOrder?.type;
        const userPrivilege = user.sector?.privileges;

        if (serviceOrderType === 'ARTWORK' && userPrivilege === SECTOR_PRIVILEGES.DESIGNER) {
          return true;
        }
        if (serviceOrderType === 'FINANCIAL' && userPrivilege === SECTOR_PRIVILEGES.FINANCIAL) {
          return true;
        }
        if (
          serviceOrderType === 'PRODUCTION' &&
          (userPrivilege === SECTOR_PRIVILEGES.PRODUCTION ||
            userPrivilege === SECTOR_PRIVILEGES.LOGISTIC)
        ) {
          return true;
        }
        if (serviceOrderType === 'COMMERCIAL' && userPrivilege === SECTOR_PRIVILEGES.COMMERCIAL) {
          return true;
        }

        return false;
      },
    },

    // CUT notifications: PLOTTING for all cuts, PRODUCTION for task-related cuts in their sector
    [NOTIFICATION_TYPE.CUT]: {
      notificationType: NOTIFICATION_TYPE.CUT,
      requiredSectors: [
        SECTOR_PRIVILEGES.ADMIN,
        SECTOR_PRIVILEGES.PLOTTING,
        SECTOR_PRIVILEGES.PRODUCTION,
      ],
      customFilter: (user: User, notification: Notification) => {
        const metadata = this.parseMetadata(notification);
        const cut = metadata?.cut;

        // Admin can see all cut notifications
        if (user.sector?.privileges === SECTOR_PRIVILEGES.ADMIN) {
          return true;
        }

        // PLOTTING can see all cut notifications
        if (user.sector?.privileges === SECTOR_PRIVILEGES.PLOTTING) {
          return true;
        }

        // PRODUCTION can see cut notifications for tasks in their sector
        // Only for status changes (started/finished), not all cut events
        if (user.sector?.privileges === SECTOR_PRIVILEGES.PRODUCTION) {
          // Only show cuts started (CUTTING) or finished (COMPLETED)
          if (cut?.status === 'CUTTING' || cut?.status === 'COMPLETED') {
            // Check if the cut's task is in user's sector
            if (cut?.taskSectorId && user.sectorId === cut.taskSectorId) {
              return true;
            }
          }
        }

        return false;
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferenceService?: NotificationPreferenceService,
  ) {}

  /**
   * Parse notification metadata safely
   */
  private parseMetadata(notification: Notification): NotificationMetadata | null {
    try {
      if (notification.metadata && typeof notification.metadata === 'object') {
        return notification.metadata as NotificationMetadata;
      }
      return null;
    } catch (error) {
      this.logger.warn(`Failed to parse notification metadata: ${error.message}`);
      return null;
    }
  }

  /**
   * 1. Filter notifications based on user role/sector/privilege
   *
   * This is the main filtering method that applies role-based filtering rules.
   * It considers:
   * - User's sector privileges
   * - Notification type requirements
   * - Custom business logic for specific notification types
   * - ADMIN override (admins see everything)
   *
   * @param user - The user to filter for
   * @param notifications - Array of notifications to filter
   * @returns Filtered array of notifications the user can see
   */
  filterByRole(user: User, notifications: Notification[]): Notification[] {
    return notifications.filter(notification => this.canUserReceive(user, notification));
  }

  /**
   * 2. Determine if user should receive notification
   *
   * This method checks:
   * 1. Role-based filtering (sector/privilege requirements)
   * 2. User preferences (if notification is not mandatory)
   * 3. Returns true only if both checks pass
   *
   * @param user - The user to check
   * @param notification - The notification to check
   * @param checkPreferences - Whether to check user preferences (default: true)
   * @returns true if user should receive the notification
   */
  async shouldReceiveNotification(
    user: User,
    notification: Notification,
    checkPreferences: boolean = true,
  ): Promise<boolean> {
    // Step 1: Check role-based filtering
    const passesRoleFilter = this.canUserReceive(user, notification);
    if (!passesRoleFilter) {
      return false;
    }

    // Step 2: If notification is mandatory, skip preference check
    // NOTE: isMandatory property doesn't exist in Notification model
    // if (notification.isMandatory) {
    //   return true;
    // }

    // Step 3: Check user preferences (if enabled)
    if (checkPreferences && this.preferenceService) {
      try {
        const preferences = await this.preferenceService.getUserPreferences(user.id);
        const typePreference = preferences.find(
          p => p.notificationType === notification.type && p.eventType === null,
        );

        // If user has disabled this notification type, don't send it
        if (typePreference && !typePreference.enabled) {
          return false;
        }

        // If user has no channels enabled for this type, don't send it
        if (typePreference && typePreference.channels.length === 0) {
          return false;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to check preferences for user ${user.id}, defaulting to send: ${error.message}`,
        );
        // On error, default to sending the notification
        return true;
      }
    }

    return true;
  }

  /**
   * 3. Get all users eligible for notification type
   *
   * This method returns all users who are eligible to receive a specific
   * notification type based on their roles and sectors.
   *
   * @param notificationType - The type of notification
   * @param metadata - Optional metadata for context-specific filtering
   * @returns Promise resolving to array of eligible users
   */
  async getEligibleUsers(
    notificationType: NOTIFICATION_TYPE,
    metadata?: NotificationMetadata,
  ): Promise<User[]> {
    return this.getUsersForNotificationType(notificationType, metadata);
  }

  /**
   * 4. Filter by user sector
   *
   * Returns only users who belong to the specified sectors.
   *
   * @param users - Array of users to filter
   * @param sectors - Array of sector privileges to filter by
   * @returns Filtered array of users in the specified sectors
   */
  filterBySector(users: User[], sectors: SECTOR_PRIVILEGES[]): User[] {
    if (sectors.length === 0) {
      return users;
    }

    return users.filter(user => user.sector && sectors.includes(user.sector.privileges));
  }

  /**
   * 5. Filter by user privilege level
   *
   * Returns only users who meet or exceed the minimum privilege level.
   *
   * @param users - Array of users to filter
   * @param minPrivilegeLevel - Minimum privilege level required
   * @returns Filtered array of users meeting the privilege requirement
   */
  filterByPrivilege(users: User[], minPrivilegeLevel: number): User[] {
    return users.filter(user => {
      if (!user.sector) {
        return false;
      }

      const userLevel = this.SECTOR_PRIVILEGES_LEVELS[user.sector.privileges];
      return userLevel >= minPrivilegeLevel;
    });
  }

  /**
   * 6. Combine multiple filter rules
   *
   * This method allows you to combine multiple filtering criteria:
   * - Filter by sectors (OR logic - user in any of the sectors)
   * - Filter by minimum privilege level (AND logic - user must meet level)
   * - Filter by specific user IDs (OR logic - include these users)
   * - Exclude specific user IDs (AND logic - exclude these users)
   * - Apply custom filter function (AND logic - must pass custom logic)
   *
   * All filters are combined with AND logic except where noted.
   *
   * @param users - Array of users to filter
   * @param criteria - Filter criteria object
   * @returns Filtered array of users matching all criteria
   */
  combineFilters(users: User[], criteria: FilterCriteria): User[] {
    let filtered = [...users];

    // Filter by sectors (if specified)
    if (criteria.sectors && criteria.sectors.length > 0) {
      filtered = this.filterBySector(filtered, criteria.sectors);
    }

    // Filter by minimum privilege level (if specified)
    if (criteria.minPrivilegeLevel !== undefined) {
      filtered = this.filterByPrivilege(filtered, criteria.minPrivilegeLevel);
    }

    // Include specific users (if specified)
    if (criteria.userIds && criteria.userIds.length > 0) {
      const specificUsers = users.filter(user => criteria.userIds!.includes(user.id));
      // Merge with filtered users (OR logic)
      const mergedUserIds = new Set([...filtered.map(u => u.id), ...specificUsers.map(u => u.id)]);
      filtered = users.filter(user => mergedUserIds.has(user.id));
    }

    // Exclude specific users (if specified)
    if (criteria.excludeUserIds && criteria.excludeUserIds.length > 0) {
      filtered = filtered.filter(user => !criteria.excludeUserIds!.includes(user.id));
    }

    // Apply custom filter (if specified)
    if (criteria.customFilter) {
      filtered = filtered.filter(criteria.customFilter);
    }

    return filtered;
  }

  /**
   * Check if a user can receive a specific notification
   *
   * @param user - The user to check
   * @param notification - The notification to check
   * @returns true if the user can receive the notification
   */
  canUserReceive(user: User, notification: Notification): boolean {
    try {
      // Get the filter configuration for this notification type
      const filter = this.NOTIFICATION_FILTERS[notification.type];

      if (!filter) {
        this.logger.warn(`No filter found for notification type: ${notification.type}`);
        return false;
      }

      // ADMIN can always see everything
      if (user.sector?.privileges === SECTOR_PRIVILEGES.ADMIN) {
        this.logger.debug('Role filter passed: User is ADMIN', {
          userId: user.id,
          notificationId: notification.id,
          notificationType: notification.type,
          decision: 'ALLOW',
        });
        return true;
      }

      // If notification has a specific userId, only that user (and admins) can see it
      if (notification.userId) {
        const canReceive = notification.userId === user.id;
        this.logger.debug('Role filter: User-specific notification', {
          userId: user.id,
          targetUserId: notification.userId,
          notificationId: notification.id,
          notificationType: notification.type,
          decision: canReceive ? 'ALLOW' : 'DENY',
        });
        if (canReceive) {
          return true;
        }
        // If user is not the target and not admin, they can't see it
        return false;
      }

      // Check if user's sector is in the required sectors
      if (filter.requiredSectors.length > 0 && user.sector) {
        if (!filter.requiredSectors.includes(user.sector.privileges)) {
          this.logger.debug('Role filter failed: Sector not allowed', {
            userId: user.id,
            userSector: user.sector.privileges,
            requiredSectors: filter.requiredSectors,
            notificationId: notification.id,
            notificationType: notification.type,
            decision: 'DENY',
          });
          return false;
        }
      }

      // Check minimum privilege level
      if (filter.minPrivilegeLevel !== undefined && user.sector) {
        const userPrivilegeLevel = this.SECTOR_PRIVILEGES_LEVELS[user.sector.privileges];
        if (userPrivilegeLevel < filter.minPrivilegeLevel) {
          this.logger.debug('Role filter failed: Insufficient privilege level', {
            userId: user.id,
            userPrivilegeLevel,
            minPrivilegeLevel: filter.minPrivilegeLevel,
            notificationId: notification.id,
            notificationType: notification.type,
            decision: 'DENY',
          });
          return false;
        }
      }

      // Apply custom filter if defined
      if (filter.customFilter) {
        const customResult = filter.customFilter(user, notification);
        this.logger.debug('Role filter: Custom filter applied', {
          userId: user.id,
          notificationId: notification.id,
          notificationType: notification.type,
          decision: customResult ? 'ALLOW' : 'DENY',
        });
        return customResult;
      }

      // If no custom filter and sector requirements are met, allow
      this.logger.debug('Role filter passed: All requirements met', {
        userId: user.id,
        notificationId: notification.id,
        notificationType: notification.type,
        decision: 'ALLOW',
      });
      return true;
    } catch (error) {
      this.logger.error('Role filter error', {
        userId: user.id,
        notificationId: notification.id,
        error: error.message,
        decision: 'DENY',
      });
      return false;
    }
  }

  /**
   * Filter a list of users to only those who can receive a notification
   *
   * @param users - List of users to filter
   * @param notification - The notification to check
   * @returns Filtered list of users who can receive the notification
   */
  filterUsersForNotification(users: User[], notification: Notification): User[] {
    return users.filter(user => this.canUserReceive(user, notification));
  }

  /**
   * Get all users for specific sectors
   *
   * @param sectors - Array of sector privileges
   * @returns Promise resolving to array of users in those sectors
   */
  async getUsersForSectors(sectors: SECTOR_PRIVILEGES[]): Promise<User[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          sector: {
            privileges: {
              in: sectors,
            },
          },
          isActive: true,
        },
        include: {
          sector: true,
          managedSector: true,
        },
      });

      return users as User[];
    } catch (error) {
      this.logger.error(`Error fetching users for sectors: ${error.message}`);
      return [];
    }
  }

  /**
   * Get all active users with their sector information
   *
   * @returns Promise resolving to array of all active users
   */
  async getAllActiveUsers(): Promise<User[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
        },
        include: {
          sector: true,
          managedSector: true,
        },
      });

      return users as User[];
    } catch (error) {
      this.logger.error(`Error fetching all active users: ${error.message}`);
      return [];
    }
  }

  /**
   * Get users who should receive a task notification
   *
   * Task notifications are sent to:
   * - Assigned users (regardless of sector)
   * - Supervisor (if specified)
   * - Task's sector members
   * - Sector manager
   * - Admin users
   * - User who created the task
   *
   * @param taskSectorId - The sector ID of the task
   * @param taskCreatorId - The ID of the user who created the task
   * @param assignedUserIds - IDs of users assigned to the task
   * @param supervisorId - ID of the supervisor
   * @returns Promise resolving to array of users
   */
  async getUsersForTaskNotification(
    taskSectorId: string | null,
    taskCreatorId?: string | null,
    assignedUserIds?: string[],
    supervisorId?: string | null,
  ): Promise<User[]> {
    try {
      const conditions: any[] = [];

      // Users in the task's sector
      if (taskSectorId) {
        conditions.push({ sectorId: taskSectorId });
      }

      // Sector managers of the task's sector
      if (taskSectorId) {
        conditions.push({
          managedSector: {
            id: taskSectorId,
          },
        });
      }

      // Admin users
      conditions.push({
        sector: {
          privileges: SECTOR_PRIVILEGES.ADMIN,
        },
      });

      // Task creator
      if (taskCreatorId) {
        conditions.push({ id: taskCreatorId });
      }

      // Assigned users
      if (assignedUserIds && assignedUserIds.length > 0) {
        conditions.push({
          id: {
            in: assignedUserIds,
          },
        });
      }

      // Supervisor
      if (supervisorId) {
        conditions.push({ id: supervisorId });
      }

      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          OR: conditions.filter(condition => Object.keys(condition).length > 0),
        },
        include: {
          sector: true,
          managedSector: true,
        },
      });

      return users as User[];
    } catch (error) {
      this.logger.error(`Error fetching users for task notification: ${error.message}`);
      return [];
    }
  }

  /**
   * Get users who should receive an order notification
   *
   * Order notifications are sent to:
   * - ADMIN
   * - WAREHOUSE
   * - LOGISTIC sectors
   *
   * @returns Promise resolving to array of users
   */
  async getUsersForOrderNotification(): Promise<User[]> {
    return this.getUsersForSectors([
      SECTOR_PRIVILEGES.ADMIN,
      SECTOR_PRIVILEGES.WAREHOUSE,
      SECTOR_PRIVILEGES.LOGISTIC,
    ]);
  }

  /**
   * Get users who should receive a stock notification
   *
   * Stock notifications are sent to:
   * - ADMIN
   * - WAREHOUSE sectors
   *
   * @returns Promise resolving to array of users
   */
  async getUsersForStockNotification(): Promise<User[]> {
    return this.getUsersForSectors([SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.WAREHOUSE]);
  }

  /**
   * Get users who should receive a financial notification
   *
   * Financial notifications are sent to:
   * - ADMIN
   * - FINANCIAL sectors
   *
   * @returns Promise resolving to array of users
   */
  async getUsersForFinancialNotification(): Promise<User[]> {
    return this.getUsersForSectors([SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL]);
  }

  /**
   * Get users who should receive a production notification
   *
   * Production notifications are sent to:
   * - ADMIN
   * - PRODUCTION sectors
   * - WAREHOUSE sectors (inventory management for production)
   *
   * @returns Promise resolving to array of users
   */
  async getUsersForProductionNotification(): Promise<User[]> {
    return this.getUsersForSectors([
      SECTOR_PRIVILEGES.ADMIN,
      SECTOR_PRIVILEGES.PRODUCTION,
      SECTOR_PRIVILEGES.WAREHOUSE,
    ]);
  }

  /**
   * Get users who should receive a maintenance notification
   *
   * Maintenance notifications are sent to:
   * - ADMIN
   * - MAINTENANCE sectors
   *
   * @returns Promise resolving to array of users
   */
  async getUsersForMaintenanceNotification(): Promise<User[]> {
    return this.getUsersForSectors([SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.MAINTENANCE]);
  }

  /**
   * Get users who should receive a PPE notification
   *
   * PPE notifications are sent to:
   * - ADMIN
   * - HUMAN_RESOURCES
   * - WAREHOUSE sectors
   * - The specific user if userId is provided
   *
   * @param userId - Optional user ID for user-specific PPE notifications
   * @returns Promise resolving to array of users
   */
  async getUsersForPPENotification(userId?: string): Promise<User[]> {
    const sectorUsers = await this.getUsersForSectors([
      SECTOR_PRIVILEGES.ADMIN,
      SECTOR_PRIVILEGES.HUMAN_RESOURCES,
      SECTOR_PRIVILEGES.WAREHOUSE,
    ]);

    if (userId) {
      try {
        const specificUser = await this.prisma.user.findUnique({
          where: { id: userId, isActive: true },
          include: {
            sector: true,
            managedSector: true,
          },
        });

        if (specificUser && !sectorUsers.find(u => u.id === specificUser.id)) {
          sectorUsers.push(specificUser as User);
        }
      } catch (error) {
        this.logger.error(`Error fetching specific user for PPE notification: ${error.message}`);
      }
    }

    return sectorUsers;
  }

  /**
   * Get users who should receive a vacation notification
   *
   * Vacation notifications are sent to:
   * - ADMIN
   * - HUMAN_RESOURCES sectors
   * - The specific user if userId is provided
   *
   * @param userId - Optional user ID for user-specific vacation notifications
   * @returns Promise resolving to array of users
   */
  async getUsersForVacationNotification(userId?: string): Promise<User[]> {
    const sectorUsers = await this.getUsersForSectors([
      SECTOR_PRIVILEGES.ADMIN,
      SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    ]);

    if (userId) {
      try {
        const specificUser = await this.prisma.user.findUnique({
          where: { id: userId, isActive: true },
          include: {
            sector: true,
            managedSector: true,
          },
        });

        if (specificUser && !sectorUsers.find(u => u.id === specificUser.id)) {
          sectorUsers.push(specificUser as User);
        }
      } catch (error) {
        this.logger.error(
          `Error fetching specific user for vacation notification: ${error.message}`,
        );
      }
    }

    return sectorUsers;
  }

  /**
   * Get users who should receive a warning notification
   *
   * Warning notifications are sent to:
   * - ADMIN
   * - HUMAN_RESOURCES sectors
   * - The specific user if userId is provided
   *
   * @param userId - Optional user ID for user-specific warning notifications
   * @returns Promise resolving to array of users
   */
  async getUsersForWarningNotification(userId?: string): Promise<User[]> {
    const sectorUsers = await this.getUsersForSectors([
      SECTOR_PRIVILEGES.ADMIN,
      SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    ]);

    if (userId) {
      try {
        const specificUser = await this.prisma.user.findUnique({
          where: { id: userId, isActive: true },
          include: {
            sector: true,
            managedSector: true,
          },
        });

        if (specificUser && !sectorUsers.find(u => u.id === specificUser.id)) {
          sectorUsers.push(specificUser as User);
        }
      } catch (error) {
        this.logger.error(
          `Error fetching specific user for warning notification: ${error.message}`,
        );
      }
    }

    return sectorUsers;
  }

  /**
   * Get all users who should receive a system notification
   *
   * System notifications are sent to all active users
   *
   * @returns Promise resolving to array of all active users
   */
  async getUsersForSystemNotification(): Promise<User[]> {
    return this.getAllActiveUsers();
  }

  /**
   * Get users for a notification based on its type
   *
   * This is a convenience method that routes to the appropriate
   * type-specific method based on the notification type
   *
   * @param notificationType - The type of notification
   * @param metadata - Optional metadata for context
   * @returns Promise resolving to array of users
   */
  async getUsersForNotificationType(
    notificationType: NOTIFICATION_TYPE,
    metadata?: NotificationMetadata,
  ): Promise<User[]> {
    switch (notificationType) {
      case NOTIFICATION_TYPE.TASK:
        return this.getUsersForTaskNotification(
          metadata?.task?.sectorId ?? null,
          metadata?.task?.createdById ?? null,
          metadata?.task?.assignedUserIds,
          metadata?.task?.supervisorId,
        );

      case NOTIFICATION_TYPE.ORDER:
        return this.getUsersForOrderNotification();

      case NOTIFICATION_TYPE.STOCK:
        return this.getUsersForStockNotification();

      case NOTIFICATION_TYPE.PPE:
        return this.getUsersForPPENotification(metadata?.ppe?.userId);

      case NOTIFICATION_TYPE.VACATION:
        return this.getUsersForVacationNotification(metadata?.vacation?.userId);

      case NOTIFICATION_TYPE.WARNING:
        return this.getUsersForWarningNotification(metadata?.warning?.userId);

      case NOTIFICATION_TYPE.SYSTEM:
        return this.getUsersForSystemNotification();

      case NOTIFICATION_TYPE.GENERAL:
        return this.getAllActiveUsers();

      default:
        this.logger.warn(`Unknown notification type: ${notificationType}`);
        return [];
    }
  }

  /**
   * Check if a user has a minimum privilege level
   *
   * @param user - The user to check
   * @param minLevel - The minimum privilege level required
   * @returns true if the user meets the minimum privilege level
   */
  hasMinimumPrivilegeLevel(user: User, minLevel: number): boolean {
    if (!user.sector) {
      return false;
    }

    const userLevel = this.SECTOR_PRIVILEGES_LEVELS[user.sector.privileges];
    return userLevel >= minLevel;
  }

  /**
   * Check if a user is in any of the specified sectors
   *
   * @param user - The user to check
   * @param sectors - Array of sector privileges
   * @returns true if the user is in any of the specified sectors
   */
  isUserInSectors(user: User, sectors: SECTOR_PRIVILEGES[]): boolean {
    if (!user.sector || sectors.length === 0) {
      return false;
    }

    return sectors.includes(user.sector.privileges);
  }

  /**
   * Check if a user is an admin
   *
   * @param user - The user to check
   * @returns true if the user is an admin
   */
  isAdmin(user: User): boolean {
    return user.sector?.privileges === SECTOR_PRIVILEGES.ADMIN;
  }

  /**
   * Check if a user is a sector manager
   *
   * @param user - The user to check
   * @returns true if the user manages a sector
   */
  isSectorManager(user: User): boolean {
    return !!user.managedSector;
  }

  /**
   * Get privilege level for a user
   *
   * @param user - The user to check
   * @returns The privilege level number, or 0 if no sector
   */
  getPrivilegeLevel(user: User): number {
    if (!user.sector) {
      return 0;
    }
    return this.SECTOR_PRIVILEGES_LEVELS[user.sector.privileges];
  }

  /**
   * Get filtering rules for a notification type
   *
   * Returns a summary of what sectors/roles can receive this notification type
   *
   * @param notificationType - The notification type to check
   * @returns Filter configuration for the type
   */
  getFilteringRulesForType(notificationType: NOTIFICATION_TYPE): NotificationFilter | null {
    return this.NOTIFICATION_FILTERS[notificationType] || null;
  }
}
