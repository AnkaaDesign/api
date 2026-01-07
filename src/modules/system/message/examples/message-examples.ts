/**
 * Message API Usage Examples
 *
 * This file contains practical examples of how to use the Message API
 * for various common scenarios.
 */

import { MessageService } from '../message.service';
import {
  MESSAGE_TARGET_TYPE,
  MESSAGE_PRIORITY,
  CONTENT_BLOCK_TYPE,
  CreateMessageDto,
} from '../dto';

/**
 * Example 1: Create a system-wide maintenance announcement
 */
export const createMaintenanceAnnouncement = async (
  messageService: MessageService,
  adminUserId: string,
) => {
  const dto: CreateMessageDto = {
    title: 'Scheduled System Maintenance',
    contentBlocks: [
      {
        type: CONTENT_BLOCK_TYPE.HEADING,
        content: 'System Maintenance Notice',
      },
      {
        type: CONTENT_BLOCK_TYPE.TEXT,
        content:
          'Our system will undergo scheduled maintenance to improve performance and add new features.',
      },
      {
        type: CONTENT_BLOCK_TYPE.CALLOUT,
        content: 'Scheduled downtime: Saturday, January 11, 2026 from 10:00 PM to 2:00 AM',
        metadata: { variant: 'warning' },
      },
      {
        type: CONTENT_BLOCK_TYPE.LIST,
        content: '- Save all your work before 10 PM\n- System will be unavailable during maintenance\n- Normal operations resume at 2 AM',
      },
      {
        type: CONTENT_BLOCK_TYPE.LINK,
        content: 'View detailed maintenance plan',
        metadata: {
          href: '/help/maintenance-plan',
          target: '_blank',
        },
      },
    ],
    targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
    priority: MESSAGE_PRIORITY.HIGH,
    isActive: true,
    startsAt: '2026-01-06T00:00:00Z',
    endsAt: '2026-01-12T00:00:00Z',
    actionUrl: '/help/maintenance',
    actionText: 'Learn More',
  };

  return await messageService.create(dto, adminUserId);
};

/**
 * Example 2: Create a role-specific announcement for production team
 */
export const createProductionTeamUpdate = async (
  messageService: MessageService,
  adminUserId: string,
) => {
  const dto: CreateMessageDto = {
    title: 'New Production Schedule Available',
    contentBlocks: [
      {
        type: CONTENT_BLOCK_TYPE.HEADING,
        content: 'Production Schedule Update',
      },
      {
        type: CONTENT_BLOCK_TYPE.TEXT,
        content:
          'The production schedule for next week has been updated with new priorities and deadlines.',
      },
      {
        type: CONTENT_BLOCK_TYPE.CALLOUT,
        content: 'Please review the schedule and confirm your availability by Wednesday.',
        metadata: { variant: 'info' },
      },
    ],
    targetType: MESSAGE_TARGET_TYPE.SPECIFIC_ROLES,
    targetRoles: ['PRODUCTION', 'LEADER'],
    priority: MESSAGE_PRIORITY.NORMAL,
    isActive: true,
    actionUrl: '/producao/cronograma',
    actionText: 'View Schedule',
  };

  return await messageService.create(dto, adminUserId);
};

/**
 * Example 3: Create urgent announcement for specific users
 */
export const createUrgentUserNotification = async (
  messageService: MessageService,
  adminUserId: string,
  targetUserIds: string[],
) => {
  const dto: CreateMessageDto = {
    title: 'Urgent: Action Required',
    contentBlocks: [
      {
        type: CONTENT_BLOCK_TYPE.HEADING,
        content: 'Immediate Action Required',
      },
      {
        type: CONTENT_BLOCK_TYPE.TEXT,
        content:
          'You have pending approvals that require your immediate attention.',
      },
      {
        type: CONTENT_BLOCK_TYPE.CALLOUT,
        content: 'These approvals are time-sensitive and must be completed today.',
        metadata: { variant: 'error' },
      },
      {
        type: CONTENT_BLOCK_TYPE.LIST,
        content: '- Review pending items\n- Approve or reject each item\n- Add comments if necessary',
      },
    ],
    targetType: MESSAGE_TARGET_TYPE.SPECIFIC_USERS,
    targetUserIds: targetUserIds,
    priority: MESSAGE_PRIORITY.URGENT,
    isActive: true,
    actionUrl: '/administracao/aprovacoes',
    actionText: 'View Pending Approvals',
  };

  return await messageService.create(dto, adminUserId);
};

/**
 * Example 4: Create a feature announcement with rich content
 */
export const createFeatureAnnouncement = async (
  messageService: MessageService,
  adminUserId: string,
) => {
  const dto: CreateMessageDto = {
    title: 'New Feature: Advanced Reporting',
    contentBlocks: [
      {
        type: CONTENT_BLOCK_TYPE.HEADING,
        content: 'Introducing Advanced Reporting',
      },
      {
        type: CONTENT_BLOCK_TYPE.TEXT,
        content:
          'We are excited to announce a new advanced reporting feature that gives you deeper insights into your operations.',
      },
      {
        type: CONTENT_BLOCK_TYPE.IMAGE,
        content: 'Advanced Reporting Dashboard Preview',
        metadata: {
          url: '/assets/images/advanced-reporting-preview.png',
          alt: 'Screenshot of the new advanced reporting dashboard',
        },
      },
      {
        type: CONTENT_BLOCK_TYPE.HEADING,
        content: 'Key Features',
      },
      {
        type: CONTENT_BLOCK_TYPE.LIST,
        content:
          '- Customizable report templates\n- Real-time data visualization\n- Export to Excel, PDF, and CSV\n- Scheduled report delivery\n- Advanced filtering and grouping',
      },
      {
        type: CONTENT_BLOCK_TYPE.CALLOUT,
        content: 'Available now for all users!',
        metadata: { variant: 'success' },
      },
      {
        type: CONTENT_BLOCK_TYPE.LINK,
        content: 'Read the full documentation',
        metadata: {
          href: '/help/advanced-reporting-guide',
          target: '_blank',
        },
      },
    ],
    targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
    priority: MESSAGE_PRIORITY.NORMAL,
    isActive: true,
    startsAt: '2026-01-06T00:00:00Z',
    endsAt: '2026-01-20T00:00:00Z',
    actionUrl: '/estatisticas',
    actionText: 'Try It Now',
  };

  return await messageService.create(dto, adminUserId);
};

/**
 * Example 5: Create a policy update for admin and HR roles
 */
export const createPolicyUpdate = async (
  messageService: MessageService,
  adminUserId: string,
) => {
  const dto: CreateMessageDto = {
    title: 'Updated Leave Policy',
    contentBlocks: [
      {
        type: CONTENT_BLOCK_TYPE.HEADING,
        content: 'Leave Policy Update',
      },
      {
        type: CONTENT_BLOCK_TYPE.TEXT,
        content:
          'The employee leave policy has been updated effective February 1, 2026.',
      },
      {
        type: CONTENT_BLOCK_TYPE.HEADING,
        content: 'What Changed',
      },
      {
        type: CONTENT_BLOCK_TYPE.LIST,
        content:
          '- Annual leave increased from 15 to 18 days\n- Sick leave now includes mental health days\n- Parental leave extended to 12 weeks\n- New bereavement leave policy added',
      },
      {
        type: CONTENT_BLOCK_TYPE.CALLOUT,
        content:
          'Please review the updated policy and update employee records accordingly.',
        metadata: { variant: 'info' },
      },
    ],
    targetType: MESSAGE_TARGET_TYPE.SPECIFIC_ROLES,
    targetRoles: ['ADMIN', 'HUMAN_RESOURCES'],
    priority: MESSAGE_PRIORITY.HIGH,
    isActive: true,
    startsAt: '2026-01-06T00:00:00Z',
    actionUrl: '/recursos-humanos/politicas',
    actionText: 'View Full Policy',
  };

  return await messageService.create(dto, adminUserId);
};

/**
 * Example 6: Create a low-priority informational message
 */
export const createInfoMessage = async (
  messageService: MessageService,
  adminUserId: string,
) => {
  const dto: CreateMessageDto = {
    title: 'Tips: Keyboard Shortcuts',
    contentBlocks: [
      {
        type: CONTENT_BLOCK_TYPE.HEADING,
        content: 'Productivity Tip: Keyboard Shortcuts',
      },
      {
        type: CONTENT_BLOCK_TYPE.TEXT,
        content:
          'Did you know you can use keyboard shortcuts to navigate faster? Here are some helpful shortcuts:',
      },
      {
        type: CONTENT_BLOCK_TYPE.LIST,
        content:
          '- Ctrl+K: Quick search\n- Ctrl+N: Create new item\n- Ctrl+S: Save changes\n- Ctrl+/: Show all shortcuts\n- Esc: Close modal',
      },
      {
        type: CONTENT_BLOCK_TYPE.CALLOUT,
        content: 'Press Ctrl+/ anytime to see the full list of shortcuts.',
        metadata: { variant: 'info' },
      },
    ],
    targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
    priority: MESSAGE_PRIORITY.LOW,
    isActive: true,
    startsAt: '2026-01-06T00:00:00Z',
  };

  return await messageService.create(dto, adminUserId);
};

/**
 * Example 7: Get unviewed messages for a user
 */
export const getUserUnviewedMessages = async (
  messageService: MessageService,
  userId: string,
  userRole: string,
) => {
  const unviewedMessages = await messageService.getUnviewedForUser(
    userId,
    userRole,
  );

  console.log(`User has ${unviewedMessages.length} unviewed messages`);
  return unviewedMessages;
};

/**
 * Example 8: Mark message as viewed
 */
export const markMessageViewed = async (
  messageService: MessageService,
  messageId: string,
  userId: string,
  userRole: string,
) => {
  const view = await messageService.markAsViewed(messageId, userId, userRole);

  console.log(`Message marked as viewed at ${view.viewedAt}`);
  return view;
};

/**
 * Example 9: Update message to make it inactive
 */
export const deactivateMessage = async (
  messageService: MessageService,
  messageId: string,
) => {
  const updatedMessage = await messageService.update(messageId, {
    isActive: false,
  });

  console.log(`Message ${messageId} has been deactivated`);
  return updatedMessage;
};

/**
 * Example 10: Get message statistics
 */
export const getMessageEngagement = async (
  messageService: MessageService,
  messageId: string,
) => {
  const stats = await messageService.getStats(messageId);

  console.log(`Message Statistics:
    - Total views: ${stats.totalViews}
    - Unique viewers: ${stats.uniqueViewers}
    - Targeted users: ${stats.targetedUsers}
    - Engagement rate: ${((stats.uniqueViewers / stats.targetedUsers) * 100).toFixed(2)}%
  `);

  return stats;
};

/**
 * Example 11: Create time-limited announcement
 */
export const createWeeklyAnnouncement = async (
  messageService: MessageService,
  adminUserId: string,
) => {
  const now = new Date();
  const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const dto: CreateMessageDto = {
    title: 'This Week in the Company',
    contentBlocks: [
      {
        type: CONTENT_BLOCK_TYPE.HEADING,
        content: 'Weekly Highlights',
      },
      {
        type: CONTENT_BLOCK_TYPE.TEXT,
        content: 'Here are the important updates and events for this week.',
      },
      {
        type: CONTENT_BLOCK_TYPE.LIST,
        content:
          '- Monday: Team meeting at 10 AM\n- Wednesday: New employee orientation\n- Friday: End of month reports due',
      },
    ],
    targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
    priority: MESSAGE_PRIORITY.NORMAL,
    isActive: true,
    startsAt: now.toISOString(),
    endsAt: oneWeekLater.toISOString(),
  };

  return await messageService.create(dto, adminUserId);
};

/**
 * Example 12: Filter messages by criteria
 */
export const getHighPriorityActiveMessages = async (
  messageService: MessageService,
) => {
  const result = await messageService.findAll({
    priority: MESSAGE_PRIORITY.HIGH,
    isActive: true,
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  console.log(`Found ${result.total} high-priority active messages`);
  return result;
};
