import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Task, ServiceOrder, Order, Sector } from '../../../types';
import { SectorPrivileges, VacationStatus } from '@prisma/client';

/**
 * Predefined filter types for recipient resolution
 */
export enum PredefinedFilterType {
  /** User is assigned to the task */
  TASK_ASSIGNEE = 'TASK_ASSIGNEE',
  /** User created the task */
  TASK_CREATOR = 'TASK_CREATOR',
  /** Users in the task's sector */
  TASK_SECTOR_MEMBERS = 'TASK_SECTOR_MEMBERS',
  /** Only the sector manager */
  SECTOR_MANAGER = 'SECTOR_MANAGER',
  /** User who requested the order */
  ORDER_REQUESTER = 'ORDER_REQUESTER',
  /** User assigned to service order */
  SERVICE_ORDER_ASSIGNEE = 'SERVICE_ORDER_ASSIGNEE',
  /** All users in allowed sectors (default) */
  ALL_IN_SECTORS = 'ALL_IN_SECTORS',
}

/**
 * Target rule configuration for notification recipients
 */
export interface TargetRule {
  /** Sectors that should receive this notification */
  allowedSectors: SectorPrivileges[];
  /** Optional: specific user IDs to include */
  includeUserIds?: string[];
  /** Optional: specific user IDs to exclude */
  excludeUserIds?: string[];
}

/**
 * Notification configuration for recipient resolution
 */
export interface NotificationConfiguration {
  /** Target rule defining who should receive notifications */
  targetRule: TargetRule;
  /** Whether to exclude inactive users (default: true) */
  excludeInactive?: boolean;
  /** Whether to exclude users currently on vacation (default: false) */
  excludeOnVacation?: boolean;
  /** Custom filter function name */
  customFilter?: PredefinedFilterType;
}

/**
 * Context information for notification resolution
 * Contains entity data that may be used for filtering
 */
export interface NotificationContext {
  /** The task related to this notification */
  task?: Task & {
    sector?: Sector;
    createdBy?: User;
    serviceOrders?: ServiceOrder[];
  };
  /** The order related to this notification */
  order?: Order & {
    requestedBy?: User;
  };
  /** The service order related to this notification */
  serviceOrder?: ServiceOrder & {
    assignedTo?: User;
    createdBy?: User;
  };
  /** The sector related to this notification */
  sector?: Sector & {
    manager?: User;
    users?: User[];
  };
  /** User who triggered the notification */
  triggeredBy?: User;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Service responsible for determining WHO should receive a notification
 * based on configuration rules and context.
 */
@Injectable()
export class NotificationRecipientResolverService {
  private readonly logger = new Logger(NotificationRecipientResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the list of users who should receive a notification
   * based on configuration and context.
   *
   * @param config - Notification configuration with target rules
   * @param context - Context containing related entities (task, order, etc.)
   * @returns Array of users who should receive the notification
   */
  async resolveRecipients(
    config: NotificationConfiguration,
    context: NotificationContext,
  ): Promise<User[]> {
    this.logger.debug('Resolving notification recipients', {
      allowedSectors: config.targetRule.allowedSectors,
      customFilter: config.customFilter,
      excludeInactive: config.excludeInactive,
      excludeOnVacation: config.excludeOnVacation,
    });

    // Step 1: Get users based on allowed sectors
    let users = await this.getUsersBySectors(config.targetRule.allowedSectors);

    this.logger.debug(`Found ${users.length} users in allowed sectors`);

    // Step 2: Apply includeUserIds if specified (add users that might not be in sectors)
    if (config.targetRule.includeUserIds?.length) {
      const additionalUsers = await this.getUsersByIds(config.targetRule.includeUserIds);
      const existingIds = new Set(users.map(u => u.id));
      for (const user of additionalUsers) {
        if (!existingIds.has(user.id)) {
          users.push(user);
        }
      }
      this.logger.debug(`Added ${additionalUsers.length} users from includeUserIds`);
    }

    // Step 3: Apply excludeUserIds if specified
    if (config.targetRule.excludeUserIds?.length) {
      const excludeSet = new Set(config.targetRule.excludeUserIds);
      const beforeCount = users.length;
      users = users.filter(u => !excludeSet.has(u.id));
      this.logger.debug(`Excluded ${beforeCount - users.length} users from excludeUserIds`);
    }

    // Step 4: Apply excludeInactive filter (default: true)
    if (config.excludeInactive !== false) {
      const beforeCount = users.length;
      users = this.filterActiveUsers(users);
      this.logger.debug(`Filtered out ${beforeCount - users.length} inactive users`);
    }

    // Step 5: Apply excludeOnVacation filter if specified
    if (config.excludeOnVacation) {
      const beforeCount = users.length;
      users = await this.filterUsersOnVacation(users);
      this.logger.debug(`Filtered out ${beforeCount - users.length} users on vacation`);
    }

    // Step 6: Apply custom filter if specified
    if (config.customFilter) {
      const beforeCount = users.length;
      users = this.applyPredefinedFilter(users, config.customFilter, context);
      this.logger.debug(
        `Applied ${config.customFilter} filter, ${beforeCount - users.length} users filtered`,
      );
    }

    this.logger.debug(`Final recipient count: ${users.length}`);

    return users;
  }

  /**
   * Applies a predefined filter type to the user list based on context
   *
   * @param users - List of users to filter
   * @param filterType - The predefined filter type to apply
   * @param context - Context containing related entities
   * @returns Filtered list of users
   */
  applyPredefinedFilter(
    users: User[],
    filterType: PredefinedFilterType,
    context: NotificationContext,
  ): User[] {
    switch (filterType) {
      case PredefinedFilterType.TASK_ASSIGNEE:
        return this.filterTaskAssignees(users, context);

      case PredefinedFilterType.TASK_CREATOR:
        return this.filterTaskCreator(users, context);

      case PredefinedFilterType.TASK_SECTOR_MEMBERS:
        return this.filterTaskSectorMembers(users, context);

      case PredefinedFilterType.SECTOR_MANAGER:
        return this.filterSectorManager(users, context);

      case PredefinedFilterType.ORDER_REQUESTER:
        return this.filterOrderRequester(users, context);

      case PredefinedFilterType.SERVICE_ORDER_ASSIGNEE:
        return this.filterServiceOrderAssignee(users, context);

      case PredefinedFilterType.ALL_IN_SECTORS:
      default:
        // Return all users in allowed sectors (no additional filtering)
        return users;
    }
  }

  /**
   * Gets users whose sector has one of the specified privileges
   *
   * @param sectors - Array of sector privileges to query
   * @returns Array of users in those sectors
   */
  async getUsersBySectors(sectors: SectorPrivileges[]): Promise<User[]> {
    if (!sectors || sectors.length === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: {
        sector: {
          privileges: {
            in: sectors,
          },
        },
      },
      include: {
        sector: true,
      },
    });

    return users as unknown as User[];
  }

  /**
   * Gets users by their IDs
   *
   * @param userIds - Array of user IDs
   * @returns Array of users
   */
  async getUsersByIds(userIds: string[]): Promise<User[]> {
    if (!userIds || userIds.length === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: userIds,
        },
      },
      include: {
        sector: true,
      },
    });

    return users as unknown as User[];
  }

  /**
   * Filters users to only include active users
   *
   * @param users - List of users to filter
   * @returns Users where isActive = true
   */
  filterActiveUsers(users: User[]): User[] {
    return users.filter(user => user.isActive === true);
  }

  /**
   * Filters out users who are currently on vacation
   * Checks for approved and in-progress vacations that overlap with today
   *
   * @param users - List of users to filter
   * @returns Users not currently on vacation
   */
  async filterUsersOnVacation(users: User[]): Promise<User[]> {
    if (users.length === 0) {
      return [];
    }

    const userIds = users.map(u => u.id);
    const today = new Date();

    // Find users who are currently on vacation
    const usersOnVacation = await this.prisma.vacation.findMany({
      where: {
        userId: {
          in: userIds,
        },
        status: {
          in: [VacationStatus.APPROVED, VacationStatus.IN_PROGRESS],
        },
        startAt: {
          lte: today,
        },
        endAt: {
          gte: today,
        },
      },
      select: {
        userId: true,
      },
    });

    const vacationUserIds = new Set(
      usersOnVacation.map(v => v.userId).filter((id): id is string => id !== null),
    );

    return users.filter(user => !vacationUserIds.has(user.id));
  }

  /**
   * Filter to get users assigned to service orders of the task
   * Checks assignedToId on service orders related to the task
   */
  private filterTaskAssignees(users: User[], context: NotificationContext): User[] {
    const task = context.task;
    if (!task?.serviceOrders?.length) {
      this.logger.debug('No service orders found for task assignee filter');
      return [];
    }

    // Get all assignee IDs from service orders
    const assigneeIds = new Set(
      task.serviceOrders
        .map(so => so.assignedToId)
        .filter((id): id is string => id !== null && id !== undefined),
    );

    if (assigneeIds.size === 0) {
      this.logger.debug('No assignees found in service orders');
      return [];
    }

    return users.filter(user => assigneeIds.has(user.id));
  }

  /**
   * Filter to get only the task creator
   */
  private filterTaskCreator(users: User[], context: NotificationContext): User[] {
    const task = context.task;
    if (!task?.createdById) {
      this.logger.debug('No createdById found for task creator filter');
      return [];
    }

    return users.filter(user => user.id === task.createdById);
  }

  /**
   * Filter to get users in the task's sector
   */
  private filterTaskSectorMembers(users: User[], context: NotificationContext): User[] {
    const task = context.task;
    if (!task?.sectorId) {
      this.logger.debug('No sectorId found for task sector members filter');
      return [];
    }

    return users.filter(user => user.sectorId === task.sectorId);
  }

  /**
   * Filter to get only the sector manager
   */
  private filterSectorManager(users: User[], context: NotificationContext): User[] {
    // Try to get manager from context.sector first, then from task.sector
    const sector = context.sector || context.task?.sector;

    if (!sector?.managerId) {
      this.logger.debug('No managerId found for sector manager filter');
      return [];
    }

    return users.filter(user => user.id === sector.managerId);
  }

  /**
   * Filter to get the user who requested the order
   * Note: Orders don't have a direct requestedBy field in schema,
   * so this might need to be derived from context or changelog
   */
  private filterOrderRequester(users: User[], context: NotificationContext): User[] {
    const order = context.order;
    const requestedBy = order?.requestedBy;

    if (!requestedBy?.id) {
      this.logger.debug('No requestedBy found for order requester filter');
      return [];
    }

    return users.filter(user => user.id === requestedBy.id);
  }

  /**
   * Filter to get the user assigned to the service order
   */
  private filterServiceOrderAssignee(users: User[], context: NotificationContext): User[] {
    const serviceOrder = context.serviceOrder;
    if (!serviceOrder?.assignedToId) {
      this.logger.debug('No assignedToId found for service order assignee filter');
      return [];
    }

    return users.filter(user => user.id === serviceOrder.assignedToId);
  }

  /**
   * Resolves recipients for a specific sector privilege
   * Convenience method for simple sector-based notifications
   *
   * @param privilege - Single sector privilege
   * @param options - Optional configuration
   * @returns Array of users in that sector
   */
  async resolveRecipientsForSector(
    privilege: SectorPrivileges,
    options?: {
      excludeInactive?: boolean;
      excludeOnVacation?: boolean;
      excludeUserIds?: string[];
    },
  ): Promise<User[]> {
    return this.resolveRecipients(
      {
        targetRule: {
          allowedSectors: [privilege],
          excludeUserIds: options?.excludeUserIds,
        },
        excludeInactive: options?.excludeInactive,
        excludeOnVacation: options?.excludeOnVacation,
      },
      {},
    );
  }

  /**
   * Resolves recipients for multiple sector privileges
   * Convenience method for multi-sector notifications
   *
   * @param privileges - Array of sector privileges
   * @param options - Optional configuration
   * @returns Array of users in those sectors
   */
  async resolveRecipientsForSectors(
    privileges: SectorPrivileges[],
    options?: {
      excludeInactive?: boolean;
      excludeOnVacation?: boolean;
      excludeUserIds?: string[];
    },
  ): Promise<User[]> {
    return this.resolveRecipients(
      {
        targetRule: {
          allowedSectors: privileges,
          excludeUserIds: options?.excludeUserIds,
        },
        excludeInactive: options?.excludeInactive,
        excludeOnVacation: options?.excludeOnVacation,
      },
      {},
    );
  }

  /**
   * Gets all managers for the specified sector privileges
   *
   * @param privileges - Array of sector privileges
   * @returns Array of sector managers
   */
  async getSectorManagers(privileges: SectorPrivileges[]): Promise<User[]> {
    if (!privileges || privileges.length === 0) {
      return [];
    }

    const sectors = await this.prisma.sector.findMany({
      where: {
        privileges: {
          in: privileges,
        },
        managerId: {
          not: null,
        },
      },
      include: {
        manager: {
          include: {
            sector: true,
          },
        },
      },
    });

    const managers = sectors
      .map(s => s.manager)
      .filter((m): m is NonNullable<typeof m> => m !== null);

    return managers as unknown as User[];
  }

  /**
   * Gets users in a specific sector by sector ID
   *
   * @param sectorId - The sector ID
   * @returns Array of users in that sector
   */
  async getUsersBySectorId(sectorId: string): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      where: {
        sectorId,
      },
      include: {
        sector: true,
      },
    });

    return users as unknown as User[];
  }

  /**
   * Checks if a user should receive notifications based on their sector
   *
   * @param userId - The user ID to check
   * @param allowedSectors - Array of allowed sector privileges
   * @returns Boolean indicating if user should receive notification
   */
  async shouldUserReceiveNotification(
    userId: string,
    allowedSectors: SectorPrivileges[],
  ): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { sector: true },
    });

    if (!user || !user.isActive) {
      return false;
    }

    if (!user.sector) {
      return false;
    }

    return allowedSectors.includes(user.sector.privileges);
  }
}
