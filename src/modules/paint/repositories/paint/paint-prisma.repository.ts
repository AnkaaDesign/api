// repositories/paint-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Paint } from '../../../../types';
import {
  PaintCreateFormData,
  PaintUpdateFormData,
  PaintInclude,
  PaintOrderBy,
  PaintWhere,
} from '../../../../schemas/paint';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { PaintRepository } from './paint.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  PaintBrand,
  PaintFinish,
  Prisma,
  Paint as PrismaPaint,
  TruckManufacturer,
} from '@prisma/client';
import { FilesStorageService } from '@modules/common/file/services/files-storage.service';

@Injectable()
export class PaintPrismaRepository
  extends BaseStringPrismaRepository<
    Paint,
    PaintCreateFormData,
    PaintUpdateFormData,
    PaintInclude,
    PaintOrderBy,
    PaintWhere,
    PrismaPaint,
    Prisma.PaintCreateInput,
    Prisma.PaintUpdateInput,
    Prisma.PaintInclude,
    Prisma.PaintOrderByWithRelationInput,
    Prisma.PaintWhereInput
  >
  implements PaintRepository
{
  protected readonly logger = new Logger(PaintPrismaRepository.name);

  constructor(
    protected readonly prisma: PrismaService,
    private readonly filesStorageService: FilesStorageService,
  ) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): Paint {
    // Map database fields to API fields
    const mapped: any = { ...databaseEntity };

    // Generate URL from colorPreview path (like task artworks workflow)
    // colorPreview stores the file path, URL is generated at retrieval time
    if (
      mapped.colorPreview &&
      !mapped.colorPreview.startsWith('http') &&
      !mapped.colorPreview.startsWith('data:')
    ) {
      // It's a path, generate URL
      mapped.colorPreview = this.filesStorageService.getFileUrl(mapped.colorPreview);
    }

    // Recursively map nested relations
    if (mapped.generalPaintings && Array.isArray(mapped.generalPaintings)) {
      mapped.generalPaintings = mapped.generalPaintings.map((task: any) => {
        if (task.createdBy) {
          task.user = task.createdBy;
          delete task.createdBy;
        }
        return task;
      });
    }

    if (mapped.logoTasks && Array.isArray(mapped.logoTasks)) {
      mapped.logoTasks = mapped.logoTasks.map((task: any) => {
        if (task.createdBy) {
          task.user = task.createdBy;
          delete task.createdBy;
        }
        return task;
      });
    }

    return mapped as Paint;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PaintCreateFormData,
  ): Prisma.PaintCreateInput {
    const { groundIds, ...restFormData } = formData;

    const createInput: Prisma.PaintCreateInput = {
      name: restFormData.name,
      hex: restFormData.hex,
      finish: restFormData.finish as PaintFinish,
      paintBrand: restFormData.paintBrandId
        ? {
            connect: { id: restFormData.paintBrandId },
          }
        : undefined,
      manufacturer: (restFormData.manufacturer as TruckManufacturer) || null,
      tags: restFormData.tags || [],
      paintType: {
        connect: { id: restFormData.paintTypeId },
      },
      colorPreview: restFormData.colorPreview || null,
    };

    // Handle ground paints connection
    if (groundIds && groundIds.length > 0) {
      createInput.paintGrounds = {
        create: groundIds.map(groundPaintId => ({
          groundPaintId,
        })),
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PaintUpdateFormData,
  ): Prisma.PaintUpdateInput {
    const { groundIds, ...restFormData } = formData;
    const updateInput: Prisma.PaintUpdateInput = {};

    // Only include defined fields to avoid undefined enum casting
    if (restFormData.name !== undefined) {
      updateInput.name = restFormData.name;
    }

    if (restFormData.hex !== undefined) {
      updateInput.hex = restFormData.hex;
    }

    if (restFormData.finish !== undefined) {
      updateInput.finish = restFormData.finish as PaintFinish;
    }

    if (restFormData.paintBrandId !== undefined) {
      updateInput.paintBrand = restFormData.paintBrandId
        ? {
            connect: { id: restFormData.paintBrandId },
          }
        : {
            disconnect: true,
          };
    }

    if (restFormData.manufacturer !== undefined) {
      updateInput.manufacturer = (restFormData.manufacturer as TruckManufacturer) || null;
    }

    if (restFormData.tags !== undefined) {
      updateInput.tags = restFormData.tags;
    }

    if (restFormData.paintTypeId !== undefined) {
      updateInput.paintType = {
        connect: { id: restFormData.paintTypeId },
      };
    }

    if (restFormData.colorPreview !== undefined) {
      updateInput.colorPreview = restFormData.colorPreview;
    }

    // Handle ground paints update - delete all existing and recreate
    if (groundIds !== undefined) {
      updateInput.paintGrounds = {
        deleteMany: {}, // Delete all existing ground relationships
        create: groundIds.map(groundPaintId => ({
          groundPaintId,
        })),
      };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(include?: any): Prisma.PaintInclude | undefined {
    if (!include) return undefined;

    // Create a completely new object with ONLY valid Prisma fields
    const prismaInclude: any = {};

    // Handle _count field - CRITICAL for proper task count display
    if (include._count !== undefined) {
      prismaInclude._count = include._count;
    }

    // Only copy fields that are valid for Prisma's Paint model
    if (include.paintType !== undefined) {
      prismaInclude.paintType = include.paintType;
    }
    if (include.paintBrand !== undefined) {
      prismaInclude.paintBrand = include.paintBrand;
    }
    if (include.formulas !== undefined) {
      prismaInclude.formulas = include.formulas;
    }
    if (include.generalPaintings !== undefined) {
      prismaInclude.generalPaintings = this.mapTaskInclude(include.generalPaintings);
    }
    if (include.logoTasks !== undefined) {
      prismaInclude.logoTasks = this.mapTaskInclude(include.logoTasks);
    }
    if (include.paintGrounds !== undefined) {
      prismaInclude.paintGrounds = include.paintGrounds;
    }
    if (include.groundPaintFor !== undefined) {
      prismaInclude.groundPaintFor = include.groundPaintFor;
    }

    // Include related paints
    if (include.relatedPaints !== undefined) {
      prismaInclude.relatedPaints = include.relatedPaints === true ? true : include.relatedPaints;
    }
    if (include.relatedTo !== undefined) {
      prismaInclude.relatedTo = include.relatedTo === true ? true : include.relatedTo;
    }

    // IMPORTANT: Return a new object without any invalid fields
    return Object.keys(prismaInclude).length > 0 ? prismaInclude : undefined;
  }

  /**
   * Maps Task includes, converting 'user' to 'createdBy'
   */
  private mapTaskInclude(taskInclude: boolean | any): any {
    if (typeof taskInclude === 'boolean') {
      return taskInclude;
    }

    if (taskInclude && typeof taskInclude === 'object' && taskInclude.include) {
      const mappedTaskInclude = { ...taskInclude };
      const nestedInclude = { ...taskInclude.include };

      // Map 'user' to 'createdBy' for Task relations
      if ('user' in nestedInclude) {
        nestedInclude.createdBy = nestedInclude.user;
        delete nestedInclude.user;
      }

      mappedTaskInclude.include = nestedInclude;
      return mappedTaskInclude;
    }

    return taskInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PaintOrderBy,
  ): Prisma.PaintOrderByWithRelationInput | undefined {
    return orderBy as Prisma.PaintOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(where?: PaintWhere): Prisma.PaintWhereInput | undefined {
    return where as Prisma.PaintWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.PaintInclude {
    // Light include for list views - avoids recursive component fetching
    return {
      paintType: true,
      paintBrand: true,
      _count: {
        select: {
          formulas: true,
          generalPaintings: true,
          logoTasks: true,
          paintGrounds: true,
        },
      },
    };
  }

  /**
   * Heavy include for detail views - includes all nested relations
   * Use this when you need full formula and component details
   */
  protected getHeavyInclude(): Prisma.PaintInclude {
    return {
      paintType: true,
      paintBrand: true,
      formulas: {
        orderBy: { createdAt: 'desc' },
        take: 10, // Limit to most recent formulas
        include: {
          components: {
            take: 20, // Limit components per formula
            include: {
              item: {
                select: {
                  id: true,
                  name: true,
                  quantity: true,
                },
              },
            },
          },
        },
      },
      paintGrounds: {
        take: 10,
        include: {
          groundPaint: {
            select: {
              id: true,
              name: true,
              hex: true,
            },
          },
        },
      },
      groundPaintFor: {
        take: 10,
        include: {
          paint: {
            select: {
              id: true,
              name: true,
              hex: true,
            },
          },
        },
      },
      _count: {
        select: {
          formulas: true,
          generalPaintings: true,
          logoTasks: true,
          paintGrounds: true,
        },
      },
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PaintCreateFormData,
    options?: CreateOptions<PaintInclude>,
  ): Promise<Paint> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paint.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar tinta', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PaintInclude>,
  ): Promise<Paint | null> {
    try {
      // Fix the include mapping directly here
      let includeInput = this.getDefaultInclude();

      if (options?.include) {
        const mappedInclude = this.mapIncludeToDatabaseInclude(options.include);
        if (mappedInclude) {
          // Ensure we're using the mapped version, not the original
          includeInput = mappedInclude;
        }
      }

      const result = await transaction.paint.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar tinta por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PaintInclude>,
  ): Promise<Paint[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.paint.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar tintas por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<PaintOrderBy, PaintWhere, PaintInclude>,
  ): Promise<FindManyResult<Paint>> {
    // Map 'limit' to 'take' for compatibility with schema

    const optionsWithTake = options
      ? { ...options, take: (options as any).limit || options.take }
      : {};

    const {
      where,
      orderBy,
      page = 1,
      take = 20,
      include,
    } = optionsWithTake as {
      where?: PaintWhere;
      orderBy?: PaintOrderBy;
      page?: number;
      take?: number;
      include?: PaintInclude;
    };
    const skip = Math.max(0, (page - 1) * take);

    const [total, paints] = await Promise.all([
      transaction.paint.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.paint.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: paints.map(paint => this.mapDatabaseEntityToEntity(paint)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PaintUpdateFormData,
    options?: UpdateOptions<PaintInclude>,
  ): Promise<Paint> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.paint.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar tinta ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Paint> {
    try {
      const result = await transaction.paint.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar tinta ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: PaintWhere): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.paint.count({ where: whereInput });
    } catch (error) {
      this.logError('contar tintas', error, { where });
      throw error;
    }
  }
}
