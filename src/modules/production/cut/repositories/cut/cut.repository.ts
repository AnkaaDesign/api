// apps/api/src/modules/production/cut/repositories/cut/cut.repository.ts

import { Cut } from '../../../../../types';
import {
  CutCreateFormData,
  CutUpdateFormData,
  CutInclude,
  CutOrderBy,
  CutWhere,
} from '../../../../../schemas/cut';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import {
  BatchCreateResult,
  BatchDeleteResult,
  BatchUpdateResult,
  FindManyOptions,
  FindManyResult,
  CreateOptions,
  UpdateOptions,
  CreateManyOptions,
  UpdateManyOptions,
} from '../../../../../types';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class CutRepository extends BaseStringRepository<
  Cut,
  CutCreateFormData,
  CutUpdateFormData,
  CutInclude,
  CutOrderBy,
  CutWhere
> {
  // Explicitly declare all the methods the service needs
  abstract findById(id: string, options?: CreateOptions<CutInclude>): Promise<Cut | null>;
  abstract findByIdWithTransaction(
    transaction: any,
    id: string,
    options?: CreateOptions<CutInclude>,
  ): Promise<Cut | null>;

  abstract findByIds(ids: string[], options?: CreateOptions<CutInclude>): Promise<Cut[]>;
  abstract findByIdsWithTransaction(
    transaction: any,
    ids: string[],
    options?: CreateOptions<CutInclude>,
  ): Promise<Cut[]>;

  abstract findMany(
    options?: FindManyOptions<CutOrderBy, CutWhere, CutInclude>,
  ): Promise<FindManyResult<Cut>>;
  abstract findManyWithTransaction(
    transaction: any,
    options?: FindManyOptions<CutOrderBy, CutWhere, CutInclude>,
  ): Promise<FindManyResult<Cut>>;

  abstract create(data: CutCreateFormData, options?: CreateOptions<CutInclude>): Promise<Cut>;
  abstract createWithTransaction(
    transaction: any,
    data: CutCreateFormData,
    options?: CreateOptions<CutInclude>,
  ): Promise<Cut>;

  abstract update(
    id: string,
    data: CutUpdateFormData,
    options?: UpdateOptions<CutInclude>,
  ): Promise<Cut>;
  abstract updateWithTransaction(
    transaction: any,
    id: string,
    data: CutUpdateFormData,
    options?: UpdateOptions<CutInclude>,
  ): Promise<Cut>;

  abstract delete(id: string): Promise<Cut>;
  abstract deleteWithTransaction(transaction: any, id: string): Promise<Cut>;

  abstract count(where?: CutWhere): Promise<number>;
  abstract countWithTransaction(transaction: any, where?: CutWhere): Promise<number>;
}
