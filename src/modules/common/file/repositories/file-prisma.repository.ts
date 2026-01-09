import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { File } from '../../../../types';
import {
  FileCreateFormData,
  FileUpdateFormData,
  FileInclude,
  FileOrderBy,
  FileWhere,
} from '../../../../schemas/file';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { FileRepository } from './file.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class FilePrismaRepository
  extends BaseStringPrismaRepository<
    File,
    FileCreateFormData,
    FileUpdateFormData,
    FileInclude,
    FileOrderBy,
    FileWhere,
    Prisma.FileGetPayload<{ include: any }>,
    Prisma.FileCreateInput,
    Prisma.FileUpdateInput,
    Prisma.FileInclude,
    Prisma.FileOrderByWithRelationInput,
    Prisma.FileWhereInput
  >
  implements FileRepository
{
  protected readonly logger = new Logger(FilePrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): File {
    return databaseEntity as File;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: FileCreateFormData,
  ): Prisma.FileCreateInput {
    return {
      filename: formData.filename,
      originalName: formData.originalName,
      mimetype: formData.mimetype,
      path: formData.path,
      size: formData.size,
      thumbnailUrl: formData.thumbnailUrl || null,
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: FileUpdateFormData,
  ): Prisma.FileUpdateInput {
    return {
      ...formData,
    };
  }

  protected mapIncludeToDatabaseInclude(include?: FileInclude): Prisma.FileInclude | undefined {
    if (!include) return undefined;

    const mappedInclude: any = {};

    // Map valid File relations with explicit field validation
    if (include.tasksArtworks !== undefined) {
      mappedInclude.tasksArtworks = include.tasksArtworks;
    }
    if (include.customerLogo !== undefined) {
      mappedInclude.customerLogo = include.customerLogo;
    }
    if (include.supplierLogo !== undefined) {
      mappedInclude.supplierLogo = include.supplierLogo;
    }
    if (include.observations !== undefined) {
      mappedInclude.observations = include.observations;
    }
    if (include.warning !== undefined) {
      mappedInclude.warning = include.warning;
    }
    if (include.orderBudgets !== undefined) {
      mappedInclude.orderBudgets = include.orderBudgets;
    }
    if (include.orderInvoices !== undefined) {
      mappedInclude.orderInvoices = include.orderInvoices;
    }
    if (include.orderReceipts !== undefined) {
      mappedInclude.orderReceipts = include.orderReceipts;
    }
    if (include.taskBudgets !== undefined) {
      mappedInclude.taskBudgets = include.taskBudgets;
    }
    if (include.taskInvoices !== undefined) {
      mappedInclude.taskInvoices = include.taskInvoices;
    }
    if (include.taskReceipts !== undefined) {
      mappedInclude.taskReceipts = include.taskReceipts;
    }

    return Object.keys(mappedInclude).length > 0 ? mappedInclude : undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: FileOrderBy,
  ): Prisma.FileOrderByWithRelationInput | undefined {
    return orderBy as Prisma.FileOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: FileWhere): Prisma.FileWhereInput | undefined {
    return where as Prisma.FileWhereInput;
  }

  protected getDefaultInclude(): Prisma.FileInclude {
    return {
      tasksArtworks: {
        select: {
          id: true,
          name: true,
        },
      },
      customerLogo: {
        select: {
          id: true,
          fantasyName: true,
        },
      },
      supplierLogo: {
        select: {
          id: true,
          fantasyName: true,
        },
      },
      observations: {
        select: {
          id: true,
          description: true,
        },
      },
      warning: {
        select: {
          id: true,
          reason: true,
        },
      },
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: FileCreateFormData,
    options?: CreateOptions<FileInclude>,
  ): Promise<File> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.file.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar arquivo', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<FileInclude>,
  ): Promise<File | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.file.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar arquivo por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<FileInclude>,
  ): Promise<File[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.file.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar arquivos por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<FileOrderBy, FileWhere, FileInclude>,
  ): Promise<FindManyResult<File>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, files] = await Promise.all([
      transaction.file.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.file.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: files.map(file => this.mapDatabaseEntityToEntity(file)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: FileUpdateFormData,
    options?: UpdateOptions<FileInclude>,
  ): Promise<File> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.file.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar arquivo ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<File> {
    try {
      const result = await transaction.file.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar arquivo ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: FileWhere): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.file.count({ where: whereInput });
    } catch (error) {
      this.logError('contar arquivos', error, { where });
      throw error;
    }
  }
}
