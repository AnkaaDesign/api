import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationPreferenceRepository } from './notification-preference.repository';
import {
  NotificationPreference,
  NotificationPreferenceIncludes,
  NotificationPreferenceOrderBy,
} from '../../../../../types';
import { Prisma } from '@prisma/client';
import { PrismaTransaction } from '@modules/common/base/base.repository';

@Injectable()
export class NotificationPreferencePrismaRepository implements NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(params: {
    where?: Prisma.NotificationPreferenceWhereInput;
    include?: NotificationPreferenceIncludes;
    orderBy?: NotificationPreferenceOrderBy | NotificationPreferenceOrderBy[];
    skip?: number;
    take?: number;
  }): Promise<NotificationPreference[]> {
    const { where, include, orderBy, skip, take } = params;

    return this.prisma.notificationPreference.findMany({
      where,
      include: include as any,
      orderBy: orderBy as any,
      skip,
      take,
    }) as Promise<NotificationPreference[]>;
  }

  async findById(
    id: string,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference | null> {
    return this.prisma.notificationPreference.findUnique({
      where: { id },
      include: include as any,
    }) as Promise<NotificationPreference | null>;
  }

  async create(
    data: Prisma.NotificationPreferenceCreateInput,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.create({
      data,
      include: include as any,
    }) as Promise<NotificationPreference>;
  }

  async update(
    id: string,
    data: Prisma.NotificationPreferenceUpdateInput,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.update({
      where: { id },
      data,
      include: include as any,
    }) as Promise<NotificationPreference>;
  }

  async delete(id: string): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.delete({
      where: { id },
    }) as Promise<NotificationPreference>;
  }

  async count(where?: Prisma.NotificationPreferenceWhereInput): Promise<number> {
    return this.prisma.notificationPreference.count({ where });
  }

  async findByPreferencesId(
    preferencesId: string,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference[]> {
    return this.prisma.notificationPreference.findMany({
      where: {
        preferences: {
          some: { id: preferencesId },
        },
      },
      include: include as any,
    }) as Promise<NotificationPreference[]>;
  }

  async findByNotificationType(
    notificationType: string,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference[]> {
    return this.prisma.notificationPreference.findMany({
      where: { notificationType },
      include: include as any,
    }) as Promise<NotificationPreference[]>;
  }

  async upsertByPreferencesAndType(
    preferencesId: string,
    notificationType: string,
    data: Prisma.NotificationPreferenceCreateInput,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference> {
    // First, try to find existing preference
    const existing = await this.prisma.notificationPreference.findFirst({
      where: {
        notificationType,
        preferences: {
          some: { id: preferencesId },
        },
      },
    });

    if (existing) {
      // Update existing
      return this.prisma.notificationPreference.update({
        where: { id: existing.id },
        data: {
          ...data,
          preferences: {
            connect: { id: preferencesId },
          },
        },
        include: include as any,
      }) as Promise<NotificationPreference>;
    } else {
      // Create new
      return this.prisma.notificationPreference.create({
        data: {
          ...data,
          preferences: {
            connect: { id: preferencesId },
          },
        },
        include: include as any,
      }) as Promise<NotificationPreference>;
    }
  }

  async batchCreate(
    data: Prisma.NotificationPreferenceCreateManyInput[],
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.notificationPreference.createMany({ data });
  }

  async batchUpdate(
    updates: { id: string; data: Prisma.NotificationPreferenceUpdateInput }[],
  ): Promise<NotificationPreference[]> {
    return this.prisma.$transaction(
      updates.map(({ id, data }) =>
        this.prisma.notificationPreference.update({
          where: { id },
          data,
        }),
      ),
    ) as Promise<NotificationPreference[]>;
  }

  async batchDelete(ids: string[]): Promise<Prisma.BatchPayload> {
    return this.prisma.notificationPreference.deleteMany({
      where: { id: { in: ids } },
    });
  }

  // Transaction methods
  async createWithTransaction(
    tx: PrismaTransaction,
    data: Prisma.NotificationPreferenceCreateInput,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference> {
    return tx.notificationPreference.create({
      data,
      include: include as any,
    }) as Promise<NotificationPreference>;
  }

  async updateWithTransaction(
    tx: PrismaTransaction,
    id: string,
    data: Prisma.NotificationPreferenceUpdateInput,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference> {
    return tx.notificationPreference.update({
      where: { id },
      data,
      include: include as any,
    }) as Promise<NotificationPreference>;
  }

  async deleteWithTransaction(tx: PrismaTransaction, id: string): Promise<NotificationPreference> {
    return tx.notificationPreference.delete({
      where: { id },
    }) as Promise<NotificationPreference>;
  }

  async batchCreateWithTransaction(
    tx: PrismaTransaction,
    data: Prisma.NotificationPreferenceCreateManyInput[],
  ): Promise<Prisma.BatchPayload> {
    return tx.notificationPreference.createMany({ data });
  }

  async batchUpdateWithTransaction(
    tx: PrismaTransaction,
    updates: { id: string; data: Prisma.NotificationPreferenceUpdateInput }[],
  ): Promise<NotificationPreference[]> {
    return Promise.all(
      updates.map(({ id, data }) =>
        tx.notificationPreference.update({
          where: { id },
          data,
        }),
      ),
    ) as Promise<NotificationPreference[]>;
  }

  async batchDeleteWithTransaction(
    tx: PrismaTransaction,
    ids: string[],
  ): Promise<Prisma.BatchPayload> {
    return tx.notificationPreference.deleteMany({
      where: { id: { in: ids } },
    });
  }
}
