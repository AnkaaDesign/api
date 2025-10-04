import {
  NotificationPreference,
  NotificationPreferenceIncludes,
  NotificationPreferenceOrderBy,
} from '../../../../../types';
import { Prisma } from '@prisma/client';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class NotificationPreferenceRepository {
  abstract findMany(params: {
    where?: Prisma.NotificationPreferenceWhereInput;
    include?: NotificationPreferenceIncludes;
    orderBy?: NotificationPreferenceOrderBy | NotificationPreferenceOrderBy[];
    skip?: number;
    take?: number;
  }): Promise<NotificationPreference[]>;

  abstract findById(
    id: string,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference | null>;

  abstract create(
    data: Prisma.NotificationPreferenceCreateInput,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference>;

  abstract update(
    id: string,
    data: Prisma.NotificationPreferenceUpdateInput,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference>;

  abstract delete(id: string): Promise<NotificationPreference>;

  abstract count(where?: Prisma.NotificationPreferenceWhereInput): Promise<number>;

  abstract findByPreferencesId(
    preferencesId: string,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference[]>;

  abstract findByNotificationType(
    notificationType: string,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference[]>;

  abstract upsertByPreferencesAndType(
    preferencesId: string,
    notificationType: string,
    data: Prisma.NotificationPreferenceCreateInput,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference>;

  abstract batchCreate(
    data: Prisma.NotificationPreferenceCreateManyInput[],
  ): Promise<Prisma.BatchPayload>;

  abstract batchUpdate(
    updates: { id: string; data: Prisma.NotificationPreferenceUpdateInput }[],
  ): Promise<NotificationPreference[]>;

  abstract batchDelete(ids: string[]): Promise<Prisma.BatchPayload>;

  // Transaction methods
  abstract createWithTransaction(
    tx: PrismaTransaction,
    data: Prisma.NotificationPreferenceCreateInput,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference>;

  abstract updateWithTransaction(
    tx: PrismaTransaction,
    id: string,
    data: Prisma.NotificationPreferenceUpdateInput,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference>;

  abstract deleteWithTransaction(
    tx: PrismaTransaction,
    id: string,
  ): Promise<NotificationPreference>;

  abstract batchCreateWithTransaction(
    tx: PrismaTransaction,
    data: Prisma.NotificationPreferenceCreateManyInput[],
  ): Promise<Prisma.BatchPayload>;

  abstract batchUpdateWithTransaction(
    tx: PrismaTransaction,
    updates: { id: string; data: Prisma.NotificationPreferenceUpdateInput }[],
  ): Promise<NotificationPreference[]>;

  abstract batchDeleteWithTransaction(
    tx: PrismaTransaction,
    ids: string[],
  ): Promise<Prisma.BatchPayload>;
}
