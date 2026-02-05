import { Test, TestingModule } from '@nestjs/testing';
import { MessageService } from '../message.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  CreateMessageDto,
  UpdateMessageDto,
  MESSAGE_TARGET_TYPE,
  MESSAGE_PRIORITY,
  CONTENT_BLOCK_TYPE,
} from '../dto';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';

describe('MessageService', () => {
  let service: MessageService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    $executeRaw: jest.fn(),
  };

  const mockAdminId = '550e8400-e29b-41d4-a716-446655440000';
  const mockUserId = '550e8400-e29b-41d4-a716-446655440001';
  const mockMessageId = '550e8400-e29b-41d4-a716-446655440002';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<MessageService>(MessageService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a message successfully', async () => {
      const createDto: CreateMessageDto = {
        title: 'Test Message',
        contentBlocks: [
          {
            type: CONTENT_BLOCK_TYPE.TEXT,
            content: 'Test content',
          },
        ],
        targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
      };

      const mockMessage = {
        id: mockMessageId,
        ...createDto,
        contentBlocks: JSON.stringify(createDto.contentBlocks),
        targetUserIds: null,
        targetRoles: null,
        startsAt: null,
        endsAt: null,
        actionUrl: null,
        actionText: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: mockAdminId,
      };

      mockPrismaService.$queryRaw.mockResolvedValue([mockMessage]);

      const result = await service.create(createDto, mockAdminId);

      expect(result).toEqual(mockMessage);
      expect(mockPrismaService.$queryRaw).toHaveBeenCalled();
    });

    it('should throw BadRequestException if content blocks are empty', async () => {
      const createDto: CreateMessageDto = {
        title: 'Test Message',
        contentBlocks: [],
        targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
      };

      await expect(service.create(createDto, mockAdminId)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if SPECIFIC_USERS without userIds', async () => {
      const createDto: CreateMessageDto = {
        title: 'Test Message',
        contentBlocks: [
          {
            type: CONTENT_BLOCK_TYPE.TEXT,
            content: 'Test',
          },
        ],
        targetType: MESSAGE_TARGET_TYPE.SPECIFIC_USERS,
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
      };

      await expect(service.create(createDto, mockAdminId)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if SPECIFIC_ROLES without roles', async () => {
      const createDto: CreateMessageDto = {
        title: 'Test Message',
        contentBlocks: [
          {
            type: CONTENT_BLOCK_TYPE.TEXT,
            content: 'Test',
          },
        ],
        targetType: MESSAGE_TARGET_TYPE.SPECIFIC_ROLES,
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
      };

      await expect(service.create(createDto, mockAdminId)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if endsAt is before startsAt', async () => {
      const createDto: CreateMessageDto = {
        title: 'Test Message',
        contentBlocks: [
          {
            type: CONTENT_BLOCK_TYPE.TEXT,
            content: 'Test',
          },
        ],
        targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
        startsAt: '2026-01-10T00:00:00Z',
        endsAt: '2026-01-09T00:00:00Z',
      };

      await expect(service.create(createDto, mockAdminId)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('should return paginated messages', async () => {
      const mockMessages = [
        {
          id: mockMessageId,
          title: 'Test Message 1',
          contentBlocks: [],
          targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
          targetUserIds: null,
          targetRoles: null,
          priority: MESSAGE_PRIORITY.NORMAL,
          isActive: true,
          startsAt: null,
          endsAt: null,
          actionUrl: null,
          actionText: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdById: mockAdminId,
        },
      ];

      mockPrismaService.$queryRawUnsafe
        .mockResolvedValueOnce([{ count: 10 }])
        .mockResolvedValueOnce(mockMessages);

      const result = await service.findAll({
        page: 1,
        limit: 10,
      });

      expect(result.data).toEqual(mockMessages);
      expect(result.total).toBe(10);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('should filter by isActive', async () => {
      mockPrismaService.$queryRawUnsafe
        .mockResolvedValueOnce([{ count: 5 }])
        .mockResolvedValueOnce([]);

      await service.findAll({
        isActive: true,
        page: 1,
        limit: 10,
      });

      expect(mockPrismaService.$queryRawUnsafe).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a message by id', async () => {
      const mockMessage = {
        id: mockMessageId,
        title: 'Test Message',
        contentBlocks: [],
        targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
        targetUserIds: null,
        targetRoles: null,
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
        startsAt: null,
        endsAt: null,
        actionUrl: null,
        actionText: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: mockAdminId,
      };

      mockPrismaService.$queryRaw.mockResolvedValue([mockMessage]);

      const result = await service.findOne(mockMessageId);

      expect(result).toEqual(mockMessage);
    });

    it('should throw NotFoundException if message not found', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      await expect(service.findOne(mockMessageId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update a message successfully', async () => {
      const mockMessage = {
        id: mockMessageId,
        title: 'Original Title',
        contentBlocks: [],
        targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
        targetUserIds: null,
        targetRoles: null,
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
        startsAt: null,
        endsAt: null,
        actionUrl: null,
        actionText: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: mockAdminId,
      };

      const updateDto: UpdateMessageDto = {
        title: 'Updated Title',
      };

      const updatedMessage = {
        ...mockMessage,
        title: 'Updated Title',
      };

      mockPrismaService.$queryRaw.mockResolvedValue([mockMessage]);
      mockPrismaService.$queryRawUnsafe.mockResolvedValue([updatedMessage]);

      const result = await service.update(mockMessageId, updateDto);

      expect(result.title).toBe('Updated Title');
    });

    it('should throw NotFoundException if message to update not found', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      await expect(service.update(mockMessageId, { title: 'New Title' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should delete a message successfully', async () => {
      const mockMessage = {
        id: mockMessageId,
        title: 'Test Message',
        contentBlocks: [],
        targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
        targetUserIds: null,
        targetRoles: null,
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
        startsAt: null,
        endsAt: null,
        actionUrl: null,
        actionText: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: mockAdminId,
      };

      mockPrismaService.$queryRaw.mockResolvedValue([mockMessage]);
      mockPrismaService.$executeRaw.mockResolvedValue(undefined);

      await service.remove(mockMessageId);

      expect(mockPrismaService.$executeRaw).toHaveBeenCalledTimes(2); // Delete views and message
    });

    it('should throw NotFoundException if message to delete not found', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      await expect(service.remove(mockMessageId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUnviewedForUser', () => {
    it('should return unviewed messages for user', async () => {
      const mockMessages = [
        {
          id: mockMessageId,
          title: 'Unviewed Message',
          contentBlocks: [],
          targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
          targetUserIds: null,
          targetRoles: null,
          priority: MESSAGE_PRIORITY.NORMAL,
          isActive: true,
          startsAt: null,
          endsAt: null,
          actionUrl: null,
          actionText: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdById: mockAdminId,
        },
      ];

      mockPrismaService.$queryRaw.mockResolvedValue(mockMessages);

      const result = await service.getUnviewedForUser(mockUserId, 'ADMIN');

      expect(result).toEqual(mockMessages);
    });

    it('should filter out messages outside date range', async () => {
      const futureMessage = {
        id: mockMessageId,
        title: 'Future Message',
        contentBlocks: [],
        targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
        targetUserIds: null,
        targetRoles: null,
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
        startsAt: new Date('2030-01-01'),
        endsAt: null,
        actionUrl: null,
        actionText: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: mockAdminId,
      };

      mockPrismaService.$queryRaw.mockResolvedValue([futureMessage]);

      const result = await service.getUnviewedForUser(mockUserId, 'ADMIN');

      expect(result).toEqual([]);
    });
  });

  describe('markAsViewed', () => {
    it('should mark message as viewed', async () => {
      const mockMessage = {
        id: mockMessageId,
        title: 'Test Message',
        contentBlocks: [],
        targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
        targetUserIds: null,
        targetRoles: null,
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
        startsAt: null,
        endsAt: null,
        actionUrl: null,
        actionText: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: mockAdminId,
      };

      const mockView = {
        id: '550e8400-e29b-41d4-a716-446655440003',
        messageId: mockMessageId,
        userId: mockUserId,
        viewedAt: new Date(),
        createdAt: new Date(),
      };

      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([mockMessage]) // findOne
        .mockResolvedValueOnce([]) // check existing view
        .mockResolvedValueOnce([mockView]); // create view

      const result = await service.markAsViewed(mockMessageId, mockUserId, 'ADMIN');

      expect(result).toEqual(mockView);
    });

    it('should return existing view if already viewed', async () => {
      const mockMessage = {
        id: mockMessageId,
        title: 'Test Message',
        contentBlocks: [],
        targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
        targetUserIds: null,
        targetRoles: null,
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
        startsAt: null,
        endsAt: null,
        actionUrl: null,
        actionText: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: mockAdminId,
      };

      const existingView = {
        id: '550e8400-e29b-41d4-a716-446655440003',
        messageId: mockMessageId,
        userId: mockUserId,
        viewedAt: new Date(),
        createdAt: new Date(),
      };

      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([mockMessage]) // findOne
        .mockResolvedValueOnce([existingView]); // check existing view

      const result = await service.markAsViewed(mockMessageId, mockUserId, 'ADMIN');

      expect(result).toEqual(existingView);
    });

    it('should throw ForbiddenException if user cannot view message', async () => {
      const mockMessage = {
        id: mockMessageId,
        title: 'Test Message',
        contentBlocks: [],
        targetType: MESSAGE_TARGET_TYPE.SPECIFIC_ROLES,
        targetUserIds: null,
        targetRoles: ['PRODUCTION'],
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
        startsAt: null,
        endsAt: null,
        actionUrl: null,
        actionText: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: mockAdminId,
      };

      mockPrismaService.$queryRaw.mockResolvedValue([mockMessage]);

      await expect(service.markAsViewed(mockMessageId, mockUserId, 'WAREHOUSE')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getStats', () => {
    it('should return message statistics', async () => {
      const mockMessage = {
        id: mockMessageId,
        title: 'Test Message',
        contentBlocks: [],
        targetType: MESSAGE_TARGET_TYPE.ALL_USERS,
        targetUserIds: null,
        targetRoles: null,
        priority: MESSAGE_PRIORITY.NORMAL,
        isActive: true,
        startsAt: null,
        endsAt: null,
        actionUrl: null,
        actionText: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: mockAdminId,
      };

      const mockStats = {
        total_views: 100,
        unique_viewers: 50,
      };

      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([mockMessage]) // findOne
        .mockResolvedValueOnce([mockStats]) // view stats
        .mockResolvedValueOnce([mockMessage]) // findOne again
        .mockResolvedValueOnce([{ count: 200 }]); // total users

      const result = await service.getStats(mockMessageId);

      expect(result.totalViews).toBe(100);
      expect(result.uniqueViewers).toBe(50);
      expect(result.targetedUsers).toBe(200);
    });
  });
});
