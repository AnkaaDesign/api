import { Test, TestingModule } from '@nestjs/testing';
import { NotificationPreferenceService } from '../notification-preference.service';
import { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL } from '../../../../constants';

describe('NotificationPreferenceService', () => {
  let service: NotificationPreferenceService;
  let preferenceRepository: NotificationPreferenceRepository;

  const mockPreferenceRepository = {
    getUserPreferences: jest.fn(),
    getPreference: jest.fn(),
    updatePreference: jest.fn(),
    deleteUserPreferences: jest.fn(),
    getChannelsForEvent: jest.fn(),
    batchCreatePreferences: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferenceService,
        {
          provide: NotificationPreferenceRepository,
          useValue: mockPreferenceRepository,
        },
      ],
    }).compile();

    service = module.get<NotificationPreferenceService>(NotificationPreferenceService);
    preferenceRepository = module.get<NotificationPreferenceRepository>(
      NotificationPreferenceRepository,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserPreferences', () => {
    it('should return user preferences', async () => {
      const mockPreferences = [
        {
          id: 'pref-1',
          userId: 'user-1',
          notificationType: NOTIFICATION_TYPE.TASK,
          eventType: 'status',
          channels: [NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.PUSH],
          enabled: true,
          isMandatory: true,
        },
      ];

      mockPreferenceRepository.getUserPreferences.mockResolvedValue(mockPreferences);

      const result = await service.getUserPreferences('user-1');

      expect(result).toEqual(mockPreferences);
      expect(preferenceRepository.getUserPreferences).toHaveBeenCalledWith('user-1');
    });

    it('should initialize defaults when user has no preferences', async () => {
      mockPreferenceRepository.getUserPreferences.mockResolvedValueOnce([]);
      mockPreferenceRepository.batchCreatePreferences.mockResolvedValue(undefined);
      mockPreferenceRepository.getUserPreferences.mockResolvedValueOnce([
        {
          id: 'pref-1',
          userId: 'user-1',
          notificationType: NOTIFICATION_TYPE.TASK,
          eventType: 'status',
          channels: [NOTIFICATION_CHANNEL.EMAIL],
          enabled: true,
          isMandatory: true,
        },
      ]);

      const result = await service.getUserPreferences('user-1');

      expect(preferenceRepository.batchCreatePreferences).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe('updatePreference', () => {
    it('should update user preference', async () => {
      const existingPreference = {
        id: 'pref-1',
        userId: 'user-1',
        notificationType: NOTIFICATION_TYPE.TASK,
        eventType: 'status',
        channels: [NOTIFICATION_CHANNEL.EMAIL],
        enabled: true,
        isMandatory: false,
      };

      const updatedPreference = {
        ...existingPreference,
        channels: [NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.PUSH],
      };

      mockPreferenceRepository.getPreference.mockResolvedValue(existingPreference);
      mockPreferenceRepository.updatePreference.mockResolvedValue(updatedPreference);

      const result = await service.updatePreference(
        'user-1',
        'TASK',
        'status',
        ['EMAIL', 'PUSH'],
        'user-1',
      );

      expect(result).toEqual(updatedPreference);
      expect(preferenceRepository.updatePreference).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        'status',
        expect.any(Array),
        true,
      );
    });

    it('should throw ForbiddenException when user tries to update others preferences', async () => {
      await expect(
        service.updatePreference('user-1', 'TASK', 'status', ['EMAIL'], 'user-2', false),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow admin to update other users preferences', async () => {
      const existingPreference = {
        id: 'pref-1',
        userId: 'user-1',
        notificationType: NOTIFICATION_TYPE.TASK,
        eventType: 'status',
        channels: [NOTIFICATION_CHANNEL.EMAIL],
        enabled: true,
        isMandatory: false,
      };

      mockPreferenceRepository.getPreference.mockResolvedValue(existingPreference);
      mockPreferenceRepository.updatePreference.mockResolvedValue(existingPreference);

      await service.updatePreference('user-1', 'TASK', 'status', ['EMAIL'], 'admin-user', true);

      expect(preferenceRepository.updatePreference).toHaveBeenCalled();
    });

    it('should throw BadRequestException when disabling mandatory notification', async () => {
      const mandatoryPreference = {
        id: 'pref-1',
        userId: 'user-1',
        notificationType: NOTIFICATION_TYPE.TASK,
        eventType: 'status',
        channels: [NOTIFICATION_CHANNEL.EMAIL],
        enabled: true,
        isMandatory: true,
      };

      mockPreferenceRepository.getPreference.mockResolvedValue(mandatoryPreference);

      await expect(
        service.updatePreference('user-1', 'TASK', 'status', [], 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid notification type', async () => {
      await expect(
        service.updatePreference('user-1', 'INVALID_TYPE', 'status', ['EMAIL'], 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid channels', async () => {
      const existingPreference = {
        id: 'pref-1',
        userId: 'user-1',
        notificationType: NOTIFICATION_TYPE.TASK,
        eventType: 'status',
        channels: [NOTIFICATION_CHANNEL.EMAIL],
        enabled: true,
        isMandatory: false,
      };

      mockPreferenceRepository.getPreference.mockResolvedValue(existingPreference);

      await expect(
        service.updatePreference('user-1', 'TASK', 'status', ['INVALID_CHANNEL'], 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when preference not found', async () => {
      mockPreferenceRepository.getPreference.mockResolvedValue(null);

      await expect(
        service.updatePreference('user-1', 'TASK', 'status', ['EMAIL'], 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resetToDefaults', () => {
    it('should reset user preferences to defaults', async () => {
      mockPreferenceRepository.deleteUserPreferences.mockResolvedValue(undefined);
      mockPreferenceRepository.batchCreatePreferences.mockResolvedValue(undefined);

      await service.resetToDefaults('user-1', 'user-1');

      expect(preferenceRepository.deleteUserPreferences).toHaveBeenCalledWith('user-1');
      expect(preferenceRepository.batchCreatePreferences).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when non-admin resets others preferences', async () => {
      await expect(service.resetToDefaults('user-1', 'user-2', false)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow admin to reset other users preferences', async () => {
      mockPreferenceRepository.deleteUserPreferences.mockResolvedValue(undefined);
      mockPreferenceRepository.batchCreatePreferences.mockResolvedValue(undefined);

      await service.resetToDefaults('user-1', 'admin-user', true);

      expect(preferenceRepository.deleteUserPreferences).toHaveBeenCalledWith('user-1');
    });
  });

  describe('getChannelsForEvent', () => {
    it('should return enabled channels for event', async () => {
      const mockChannels = [NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.PUSH];

      mockPreferenceRepository.getChannelsForEvent.mockResolvedValue(mockChannels);

      const result = await service.getChannelsForEvent('user-1', 'TASK', 'status');

      expect(result).toEqual(mockChannels);
      expect(preferenceRepository.getChannelsForEvent).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        'status',
      );
    });

    it('should return empty array when no channels enabled', async () => {
      mockPreferenceRepository.getChannelsForEvent.mockResolvedValue([]);

      const result = await service.getChannelsForEvent('user-1', 'TASK', 'status');

      expect(result).toEqual([]);
    });
  });

  describe('validatePreferences', () => {
    it('should validate preferences successfully', async () => {
      const mockPreference = {
        id: 'pref-1',
        userId: 'user-1',
        notificationType: NOTIFICATION_TYPE.ORDER,
        eventType: 'created',
        channels: [NOTIFICATION_CHANNEL.EMAIL],
        isMandatory: false,
      };

      mockPreferenceRepository.getPreference.mockResolvedValue(mockPreference);

      const result = await service.validatePreferences('user-1', 'ORDER', 'created', ['EMAIL']);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for task notification without channels', async () => {
      const mockPreference = {
        id: 'pref-1',
        userId: 'user-1',
        notificationType: NOTIFICATION_TYPE.TASK,
        eventType: 'status',
        channels: [],
        isMandatory: true,
      };

      mockPreferenceRepository.getPreference.mockResolvedValue(mockPreference);

      const result = await service.validatePreferences('user-1', 'TASK', 'status', []);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('mandatory');
    });

    it('should return errors for mandatory notification being disabled', async () => {
      const mockPreference = {
        id: 'pref-1',
        userId: 'user-1',
        notificationType: NOTIFICATION_TYPE.TASK,
        eventType: 'deadline',
        channels: [NOTIFICATION_CHANNEL.EMAIL],
        isMandatory: true,
      };

      mockPreferenceRepository.getPreference.mockResolvedValue(mockPreference);

      const result = await service.validatePreferences('user-1', 'TASK', 'deadline', []);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('mandatory'))).toBe(true);
    });

    it('should return errors for invalid channels', async () => {
      const mockPreference = {
        id: 'pref-1',
        userId: 'user-1',
        notificationType: NOTIFICATION_TYPE.ORDER,
        eventType: 'created',
        channels: [NOTIFICATION_CHANNEL.EMAIL],
        isMandatory: false,
      };

      mockPreferenceRepository.getPreference.mockResolvedValue(mockPreference);

      const result = await service.validatePreferences('user-1', 'ORDER', 'created', [
        'INVALID_CHANNEL',
      ]);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid notification channel'))).toBe(true);
    });
  });

  describe('getChannelPreferences', () => {
    it('should group preferences by channel', async () => {
      const mockPreferences = [
        {
          id: 'pref-1',
          userId: 'user-1',
          notificationType: NOTIFICATION_TYPE.TASK,
          eventType: 'status',
          channels: [NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.PUSH],
          enabled: true,
        },
        {
          id: 'pref-2',
          userId: 'user-1',
          notificationType: NOTIFICATION_TYPE.ORDER,
          eventType: 'created',
          channels: [NOTIFICATION_CHANNEL.EMAIL],
          enabled: true,
        },
      ];

      mockPreferenceRepository.getUserPreferences.mockResolvedValue(mockPreferences);

      const result = await service.getChannelPreferences('user-1');

      expect(result[NOTIFICATION_CHANNEL.EMAIL]).toHaveLength(2);
      expect(result[NOTIFICATION_CHANNEL.PUSH]).toHaveLength(1);
      expect(result[NOTIFICATION_CHANNEL.WHATSAPP]).toHaveLength(0);
    });
  });

  describe('getTypePreferences', () => {
    it('should group preferences by notification type', async () => {
      const mockPreferences = [
        {
          id: 'pref-1',
          userId: 'user-1',
          notificationType: NOTIFICATION_TYPE.TASK,
          eventType: 'status',
          channels: [NOTIFICATION_CHANNEL.EMAIL],
          enabled: true,
        },
        {
          id: 'pref-2',
          userId: 'user-1',
          notificationType: NOTIFICATION_TYPE.TASK,
          eventType: 'deadline',
          channels: [NOTIFICATION_CHANNEL.PUSH],
          enabled: true,
        },
        {
          id: 'pref-3',
          userId: 'user-1',
          notificationType: NOTIFICATION_TYPE.ORDER,
          eventType: 'created',
          channels: [NOTIFICATION_CHANNEL.EMAIL],
          enabled: true,
        },
      ];

      mockPreferenceRepository.getUserPreferences.mockResolvedValue(mockPreferences);

      const result = await service.getTypePreferences('user-1');

      expect(result[NOTIFICATION_TYPE.TASK]).toHaveLength(2);
      expect(result[NOTIFICATION_TYPE.ORDER]).toHaveLength(1);
      expect(result[NOTIFICATION_TYPE.STOCK]).toHaveLength(0);
    });
  });

  describe('updatePreferences', () => {
    it('should update multiple preferences at once', async () => {
      const preferences = [
        {
          type: 'TASK',
          eventType: 'status',
          channels: ['EMAIL', 'PUSH'],
        },
        {
          type: 'ORDER',
          eventType: 'created',
          channels: ['EMAIL'],
        },
      ];

      const mockExistingPreferences = [
        {
          id: 'pref-1',
          userId: 'user-1',
          notificationType: NOTIFICATION_TYPE.TASK,
          eventType: 'status',
          channels: [NOTIFICATION_CHANNEL.EMAIL],
          isMandatory: false,
        },
        {
          id: 'pref-2',
          userId: 'user-1',
          notificationType: NOTIFICATION_TYPE.ORDER,
          eventType: 'created',
          channels: [NOTIFICATION_CHANNEL.EMAIL],
          isMandatory: false,
        },
      ];

      mockPreferenceRepository.getPreference
        .mockResolvedValueOnce(mockExistingPreferences[0])
        .mockResolvedValueOnce(mockExistingPreferences[1]);

      mockPreferenceRepository.updatePreference
        .mockResolvedValueOnce(mockExistingPreferences[0])
        .mockResolvedValueOnce(mockExistingPreferences[1]);

      const result = await service.updatePreferences('user-1', preferences, 'user-1');

      expect(result).toHaveLength(2);
      expect(preferenceRepository.updatePreference).toHaveBeenCalledTimes(2);
    });

    it('should throw error if any preference validation fails', async () => {
      const preferences = [
        {
          type: 'TASK',
          eventType: 'status',
          channels: [], // Invalid: task notification requires channels
        },
      ];

      const mockMandatoryPreference = {
        id: 'pref-1',
        userId: 'user-1',
        notificationType: NOTIFICATION_TYPE.TASK,
        eventType: 'status',
        channels: [NOTIFICATION_CHANNEL.EMAIL],
        isMandatory: true,
      };

      mockPreferenceRepository.getPreference.mockResolvedValue(mockMandatoryPreference);

      await expect(
        service.updatePreferences('user-1', preferences, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when non-admin updates others preferences', async () => {
      const preferences = [
        {
          type: 'TASK',
          eventType: 'status',
          channels: ['EMAIL'],
        },
      ];

      await expect(
        service.updatePreferences('user-1', preferences, 'user-2', false),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getDefaultPreferences', () => {
    it('should return default preferences', () => {
      const defaults = service.getDefaultPreferences();

      expect(defaults).toBeInstanceOf(Array);
      expect(defaults.length).toBeGreaterThan(0);

      // Check that task preferences are mandatory
      const taskPreferences = defaults.filter((p) => p.type === NOTIFICATION_TYPE.TASK);
      expect(taskPreferences.length).toBeGreaterThan(0);
      taskPreferences.forEach((pref) => {
        expect(pref.mandatory).toBe(true);
      });

      // Check that some preferences are optional
      const optionalPreferences = defaults.filter((p) => !p.mandatory);
      expect(optionalPreferences.length).toBeGreaterThan(0);
    });

    it('should include all notification types', () => {
      const defaults = service.getDefaultPreferences();
      const types = new Set(defaults.map((p) => p.type));

      expect(types.has(NOTIFICATION_TYPE.TASK)).toBe(true);
      expect(types.has(NOTIFICATION_TYPE.ORDER)).toBe(true);
      expect(types.has(NOTIFICATION_TYPE.STOCK)).toBe(true);
      expect(types.has(NOTIFICATION_TYPE.SYSTEM)).toBe(true);
    });

    it('should have valid channels for each preference', () => {
      const defaults = service.getDefaultPreferences();
      const validChannels = Object.values(NOTIFICATION_CHANNEL);

      defaults.forEach((pref) => {
        expect(pref.channels.length).toBeGreaterThan(0);
        pref.channels.forEach((channel) => {
          expect(validChannels).toContain(channel);
        });
      });
    });
  });

  describe('initializeUserPreferences', () => {
    it('should initialize preferences with defaults', async () => {
      mockPreferenceRepository.batchCreatePreferences.mockResolvedValue(undefined);

      await service.initializeUserPreferences('user-1');

      expect(preferenceRepository.batchCreatePreferences).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            userId: 'user-1',
            type: expect.any(String),
            channels: expect.any(Array),
          }),
        ]),
      );
    });
  });
});
