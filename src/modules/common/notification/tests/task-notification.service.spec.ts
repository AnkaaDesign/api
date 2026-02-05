import { Test, TestingModule } from '@nestjs/testing';
import { TaskNotificationService } from '../task-notification.service';
import { NotificationPreferenceService } from '../notification-preference.service';
import { NotificationService } from '../notification.service';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
} from '../../../../constants';
import type { Task } from '../../../../types';

describe('TaskNotificationService', () => {
  let service: TaskNotificationService;
  let preferenceService: jest.Mocked<NotificationPreferenceService>;
  let notificationService: jest.Mocked<NotificationService>;

  const mockTask: Task = {
    id: 'task-123',
    name: 'Test Task',
    status: 'IN_PROGRESS' as any,
    priority: 'NORMAL',
    details: 'Test details',
    sectorId: 'sector-1',
    term: new Date('2026-01-10'),
    artworks: [],
  } as Task;

  beforeEach(async () => {
    const mockPreferenceService = {
      getChannelsForEvent: jest.fn().mockResolvedValue([NOTIFICATION_CHANNEL.IN_APP]),
    };

    const mockNotificationService = {
      createNotification: jest.fn().mockResolvedValue({
        data: { id: 'notification-123' },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskNotificationService,
        {
          provide: NotificationPreferenceService,
          useValue: mockPreferenceService,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    service = module.get<TaskNotificationService>(TaskNotificationService);
    preferenceService = module.get(NotificationPreferenceService);
    notificationService = module.get(NotificationService);
  });

  afterEach(async () => {
    await service.cleanup();
  });

  describe('trackTaskChanges', () => {
    it('should detect no changes when tasks are identical', () => {
      const oldTask = { ...mockTask };
      const newTask = { ...mockTask };

      const changes = service.trackTaskChanges(oldTask, newTask);

      expect(changes).toHaveLength(0);
    });

    it('should detect single field change', () => {
      const oldTask = { ...mockTask };
      const newTask = { ...mockTask, status: 'COMPLETED' as any };

      const changes = service.trackTaskChanges(oldTask, newTask);

      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('status');
      expect(changes[0].fieldLabel).toBe('Status');
      expect(changes[0].oldValue).toBe('IN_PROGRESS');
      expect(changes[0].newValue).toBe('COMPLETED');
    });

    it('should detect multiple field changes', () => {
      const oldTask = { ...mockTask };
      const newTask = {
        ...mockTask,
        status: 'COMPLETED' as any,
        priority: 'HIGH',
        details: 'Updated details',
      };

      const changes = service.trackTaskChanges(oldTask, newTask);

      expect(changes).toHaveLength(3);
      expect(changes.map(c => c.field)).toContain('status');
      expect(changes.map(c => c.field)).toContain('priority');
      expect(changes.map(c => c.field)).toContain('details');
    });

    it('should detect date changes', () => {
      const oldTask = { ...mockTask, term: new Date('2026-01-10') };
      const newTask = { ...mockTask, term: new Date('2026-01-15') };

      const changes = service.trackTaskChanges(oldTask, newTask);

      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('term');
      expect(changes[0].fieldLabel).toBe('Prazo');
    });

    it('should detect array changes', () => {
      const oldTask = { ...mockTask, artworks: [] as any };
      const newTask = {
        ...mockTask,
        artworks: [{ id: 'file-1' }, { id: 'file-2' }] as any,
      };

      const changes = service.trackTaskChanges(oldTask, newTask);

      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('artworks');
      expect(changes[0].fieldLabel).toBe('Anexos');
    });

    it('should detect object changes', () => {
      const oldTask = {
        ...mockTask,
        negotiatingWith: { name: 'John', phone: '123' },
      } as Task;
      const newTask = {
        ...mockTask,
        negotiatingWith: { name: 'Jane', phone: '456' },
      } as Task;

      const changes = service.trackTaskChanges(oldTask, newTask);

      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('negotiatingWith');
    });

    it('should handle null to value changes', () => {
      const oldTask = { ...mockTask, details: null };
      const newTask = { ...mockTask, details: 'New details' };

      const changes = service.trackTaskChanges(oldTask, newTask);

      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('details');
      expect(changes[0].oldValue).toBeNull();
      expect(changes[0].newValue).toBe('New details');
    });

    it('should handle value to null changes', () => {
      const oldTask = { ...mockTask, details: 'Old details' };
      const newTask = { ...mockTask, details: null };

      const changes = service.trackTaskChanges(oldTask, newTask);

      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('details');
      expect(changes[0].oldValue).toBe('Old details');
      expect(changes[0].newValue).toBeNull();
    });
  });

  describe('formatFieldChange', () => {
    it('should format field change message correctly', () => {
      const change = {
        field: 'status',
        fieldLabel: 'Status',
        oldValue: 'PENDING',
        newValue: 'IN_PROGRESS',
        formattedOldValue: 'PENDING',
        formattedNewValue: 'IN_PROGRESS',
        changedAt: new Date(),
      };

      const message = service.formatFieldChange('Test Task', change);

      expect(message).toBe('Campo Status alterado em Test Task: PENDING → IN_PROGRESS');
    });

    it('should format with null values', () => {
      const change = {
        field: 'details',
        fieldLabel: 'Descrição',
        oldValue: null,
        newValue: 'New details',
        formattedOldValue: 'N/A',
        formattedNewValue: 'New details',
        changedAt: new Date(),
      };

      const message = service.formatFieldChange('Test Task', change);

      expect(message).toBe('Campo Descrição alterado em Test Task: N/A → New details');
    });
  });

  describe('getFieldLabel', () => {
    it('should return correct Portuguese labels for known fields', () => {
      expect(service.getFieldLabel('name')).toBe('Título');
      expect(service.getFieldLabel('details')).toBe('Descrição');
      expect(service.getFieldLabel('status')).toBe('Status');
      expect(service.getFieldLabel('priority')).toBe('Prioridade');
      expect(service.getFieldLabel('sectorId')).toBe('Responsável');
      expect(service.getFieldLabel('term')).toBe('Prazo');
      expect(service.getFieldLabel('artworks')).toBe('Anexos');
      expect(service.getFieldLabel('observation')).toBe('Comentários');
    });

    it('should capitalize unknown field names', () => {
      const label = service.getFieldLabel('unknownField');
      expect(label.charAt(0)).toBe('U');
    });
  });

  describe('shouldNotifyField', () => {
    it('should return true when user has channels enabled for field', async () => {
      preferenceService.getChannelsForEvent.mockResolvedValue([NOTIFICATION_CHANNEL.IN_APP]);

      const result = await service.shouldNotifyField('user-123', 'status');

      expect(result).toBe(true);
      expect(preferenceService.getChannelsForEvent).toHaveBeenCalledWith(
        'user-123',
        NOTIFICATION_TYPE.TASK,
        'task.field.status',
      );
    });

    it('should return false when user has no channels enabled for field', async () => {
      preferenceService.getChannelsForEvent.mockResolvedValue([]);

      const result = await service.shouldNotifyField('user-123', 'details');

      expect(result).toBe(false);
    });

    it('should default to true on error', async () => {
      preferenceService.getChannelsForEvent.mockRejectedValue(new Error('Database error'));

      const result = await service.shouldNotifyField('user-123', 'status');

      expect(result).toBe(true);
    });
  });

  describe('createFieldChangeNotifications', () => {
    it('should create notifications for allowed field changes', async () => {
      const changes = [
        {
          field: 'status',
          fieldLabel: 'Status',
          oldValue: 'PENDING',
          newValue: 'IN_PROGRESS',
          formattedOldValue: 'PENDING',
          formattedNewValue: 'IN_PROGRESS',
          changedAt: new Date(),
        },
      ];

      preferenceService.getChannelsForEvent.mockResolvedValue([NOTIFICATION_CHANNEL.IN_APP]);

      const notificationIds = await service.createFieldChangeNotifications(
        mockTask,
        changes,
        'user-123',
        'user-admin',
      );

      expect(notificationIds).toHaveLength(1);
      expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NOTIFICATION_TYPE.TASK,
          title: 'Alteração em tarefa: Test Task',
          message: expect.stringContaining('Campo Status alterado'),
          userId: 'user-123',
          entityType: 'Task',
          entityId: 'task-123',
        }),
      );
    });

    it('should skip notifications for disabled fields', async () => {
      const changes = [
        {
          field: 'details',
          fieldLabel: 'Descrição',
          oldValue: 'Old',
          newValue: 'New',
          formattedOldValue: 'Old',
          formattedNewValue: 'New',
          changedAt: new Date(),
        },
      ];

      preferenceService.getChannelsForEvent.mockResolvedValue([]);

      const notificationIds = await service.createFieldChangeNotifications(
        mockTask,
        changes,
        'user-123',
        'user-admin',
      );

      expect(notificationIds).toHaveLength(0);
      expect(notificationService.createNotification).not.toHaveBeenCalled();
    });

    it('should create multiple notifications for multiple changes', async () => {
      const changes = [
        {
          field: 'status',
          fieldLabel: 'Status',
          oldValue: 'PENDING',
          newValue: 'IN_PROGRESS',
          formattedOldValue: 'PENDING',
          formattedNewValue: 'IN_PROGRESS',
          changedAt: new Date(),
        },
        {
          field: 'priority',
          fieldLabel: 'Prioridade',
          oldValue: 'NORMAL',
          newValue: 'HIGH',
          formattedOldValue: 'NORMAL',
          formattedNewValue: 'HIGH',
          changedAt: new Date(),
        },
      ];

      preferenceService.getChannelsForEvent.mockResolvedValue([NOTIFICATION_CHANNEL.IN_APP]);

      const notificationIds = await service.createFieldChangeNotifications(
        mockTask,
        changes,
        'user-123',
        'user-admin',
      );

      expect(notificationIds).toHaveLength(2);
      expect(notificationService.createNotification).toHaveBeenCalledTimes(2);
    });

    it('should use HIGH importance for important fields', async () => {
      const changes = [
        {
          field: 'status',
          fieldLabel: 'Status',
          oldValue: 'PENDING',
          newValue: 'IN_PROGRESS',
          formattedOldValue: 'PENDING',
          formattedNewValue: 'IN_PROGRESS',
          changedAt: new Date(),
        },
      ];

      preferenceService.getChannelsForEvent.mockResolvedValue([NOTIFICATION_CHANNEL.IN_APP]);

      await service.createFieldChangeNotifications(mockTask, changes, 'user-123', 'user-admin');

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: NOTIFICATION_IMPORTANCE.HIGH,
        }),
      );
    });
  });

  describe('aggregateFieldChanges', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should aggregate changes within time window', async () => {
      const changes = [
        {
          field: 'status',
          fieldLabel: 'Status',
          oldValue: 'PENDING',
          newValue: 'IN_PROGRESS',
          formattedOldValue: 'PENDING',
          formattedNewValue: 'IN_PROGRESS',
          changedAt: new Date(),
        },
      ];

      preferenceService.getChannelsForEvent.mockResolvedValue([NOTIFICATION_CHANNEL.IN_APP]);

      await service.aggregateFieldChanges(mockTask, changes, 'user-123', 'user-admin', false);

      expect(notificationService.createNotification).not.toHaveBeenCalled();

      // Fast-forward time
      jest.advanceTimersByTime(5 * 60 * 1000);

      // Wait for async operations
      await new Promise(resolve => setImmediate(resolve));

      expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
    });

    it('should send immediately when immediate flag is true', async () => {
      const changes = [
        {
          field: 'status',
          fieldLabel: 'Status',
          oldValue: 'PENDING',
          newValue: 'IN_PROGRESS',
          formattedOldValue: 'PENDING',
          formattedNewValue: 'IN_PROGRESS',
          changedAt: new Date(),
        },
      ];

      preferenceService.getChannelsForEvent.mockResolvedValue([NOTIFICATION_CHANNEL.IN_APP]);

      await service.aggregateFieldChanges(
        mockTask,
        changes,
        'user-123',
        'user-admin',
        true, // immediate
      );

      expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
    });

    it('should combine multiple changes in aggregation', async () => {
      const changes1 = [
        {
          field: 'status',
          fieldLabel: 'Status',
          oldValue: 'PENDING',
          newValue: 'IN_PROGRESS',
          formattedOldValue: 'PENDING',
          formattedNewValue: 'IN_PROGRESS',
          changedAt: new Date(),
        },
      ];

      const changes2 = [
        {
          field: 'priority',
          fieldLabel: 'Prioridade',
          oldValue: 'NORMAL',
          newValue: 'HIGH',
          formattedOldValue: 'NORMAL',
          formattedNewValue: 'HIGH',
          changedAt: new Date(),
        },
      ];

      preferenceService.getChannelsForEvent.mockResolvedValue([NOTIFICATION_CHANNEL.IN_APP]);

      // Add first change
      await service.aggregateFieldChanges(mockTask, changes1, 'user-123', 'user-admin', false);

      // Add second change
      await service.aggregateFieldChanges(mockTask, changes2, 'user-123', 'user-admin', false);

      // Fast-forward time
      jest.advanceTimersByTime(5 * 60 * 1000);
      await new Promise(resolve => setImmediate(resolve));

      expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('2 alterações'),
          metadata: expect.objectContaining({
            aggregated: true,
            changeCount: 2,
          }),
        }),
      );
    });

    it('should not aggregate changes if user disabled all fields', async () => {
      const changes = [
        {
          field: 'details',
          fieldLabel: 'Descrição',
          oldValue: 'Old',
          newValue: 'New',
          formattedOldValue: 'Old',
          formattedNewValue: 'New',
          changedAt: new Date(),
        },
      ];

      preferenceService.getChannelsForEvent.mockResolvedValue([]);

      await service.aggregateFieldChanges(mockTask, changes, 'user-123', 'user-admin', false);

      jest.advanceTimersByTime(5 * 60 * 1000);
      await new Promise(resolve => setImmediate(resolve));

      expect(notificationService.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should send all pending aggregations immediately', async () => {
      const changes = [
        {
          field: 'status',
          fieldLabel: 'Status',
          oldValue: 'PENDING',
          newValue: 'IN_PROGRESS',
          formattedOldValue: 'PENDING',
          formattedNewValue: 'IN_PROGRESS',
          changedAt: new Date(),
        },
      ];

      preferenceService.getChannelsForEvent.mockResolvedValue([NOTIFICATION_CHANNEL.IN_APP]);

      await service.aggregateFieldChanges(mockTask, changes, 'user-123', 'user-admin', false);

      expect(notificationService.createNotification).not.toHaveBeenCalled();

      await service.cleanup();

      expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
    });
  });
});
