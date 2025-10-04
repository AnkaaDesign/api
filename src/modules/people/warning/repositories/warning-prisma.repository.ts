// repositories/warning-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Warning } from '../../../../types';
import {
  WarningCreateFormData,
  WarningUpdateFormData,
  WarningInclude,
  WarningOrderBy,
  WarningWhere,
} from '../../../../schemas';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { WarningRepository } from './warning.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma, Warning as PrismaWarning, WarningCategory, WarningSeverity } from '@prisma/client';
import { WARNING_CATEGORY, WARNING_SEVERITY } from '../../../../constants';
import { getWarningSeverityOrder } from '../../../../utils';

@Injectable()
export class WarningPrismaRepository
  extends BaseStringPrismaRepository<
    Warning,
    WarningCreateFormData,
    WarningUpdateFormData,
    WarningInclude,
    WarningOrderBy,
    WarningWhere,
    PrismaWarning,
    Prisma.WarningCreateInput,
    Prisma.WarningUpdateInput,
    Prisma.WarningInclude,
    Prisma.WarningOrderByWithRelationInput,
    Prisma.WarningWhereInput
  >
  implements WarningRepository
{
  protected readonly logger = new Logger(WarningPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): Warning {
    return {
      id: databaseEntity.id,
      severity: databaseEntity.severity,
      severityOrder: databaseEntity.severityOrder,
      category: databaseEntity.category,
      reason: databaseEntity.reason,
      description: databaseEntity.description,
      isActive: databaseEntity.isActive,
      collaboratorId: databaseEntity.collaboratorId,
      supervisorId: databaseEntity.supervisorId,
      followUpDate: databaseEntity.followUpDate,
      hrNotes: databaseEntity.hrNotes,
      resolvedAt: databaseEntity.resolvedAt,
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
      // Map relations if present
      collaborator: databaseEntity.collaborator,
      supervisor: databaseEntity.supervisor,
      witness: databaseEntity.witness,
      attachments: databaseEntity.attachments,
    };
  }

  /**
   * Maps form data to Prisma create input.
   * Note: Form uses witnessIds/attachmentIds while Prisma uses witness/attachments relations
   */

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: WarningCreateFormData,
  ): Prisma.WarningCreateInput {
    const {
      category,
      severity,
      collaboratorId,
      supervisorId,
      reason,
      witnessIds,
      attachmentIds,
      ...rest
    } = formData;

    // Validate required fields
    if (!supervisorId) {
      throw new Error('Supervisor ID is required for creating a warning');
    }
    if (!collaboratorId) {
      throw new Error('Collaborator ID is required for creating a warning');
    }
    if (!formData.followUpDate) {
      throw new Error('Follow-up date is required for creating a warning');
    }

    const createInput: Prisma.WarningCreateInput = {
      ...rest,
      collaborator: { connect: { id: collaboratorId } },
      supervisor: { connect: { id: supervisorId } },
      category: (category || WARNING_CATEGORY.OTHER) as WarningCategory,
      severity: (severity || WARNING_SEVERITY.VERBAL) as WarningSeverity,
      reason: reason || 'Não especificado',
      followUpDate: formData.followUpDate,
      severityOrder: getWarningSeverityOrder(severity || WARNING_SEVERITY.VERBAL),
    };

    // Handle witness connections (witnessIds from form -> witness relation in Prisma)
    if (witnessIds && witnessIds.length > 0) {
      createInput.witness = { connect: witnessIds.map(id => ({ id })) };
    }

    // Handle file attachments (attachmentIds from form -> attachments relation in Prisma)
    if (attachmentIds && attachmentIds.length > 0) {
      createInput.attachments = { connect: attachmentIds.map(id => ({ id })) };
    }

    return { ...createInput, ...rest };
  }

  /**
   * Maps form data to Prisma update input.
   * Note: Form uses witnessIds/attachmentIds while Prisma uses witness/attachments relations
   */
  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: WarningUpdateFormData,
  ): Prisma.WarningUpdateInput {
    const { collaboratorId, supervisorId, witnessIds, attachmentIds, category, severity, ...rest } =
      formData;

    const updateInput: Prisma.WarningUpdateInput = {};

    // Handle non-enum fields
    if (formData.reason !== undefined) updateInput.reason = formData.reason;
    if (formData.description !== undefined) updateInput.description = formData.description;
    if (formData.isActive !== undefined) updateInput.isActive = formData.isActive;
    if (formData.hrNotes !== undefined) updateInput.hrNotes = formData.hrNotes;
    if (formData.followUpDate !== undefined) updateInput.followUpDate = formData.followUpDate;
    if (formData.resolvedAt !== undefined) updateInput.resolvedAt = formData.resolvedAt;

    // Handle enums
    if (category !== undefined) {
      updateInput.category = category as WarningCategory;
    }

    if (severity !== undefined) {
      updateInput.severity = severity as WarningSeverity;
      updateInput.severityOrder = getWarningSeverityOrder(severity);
    }

    // Handle collaborator update
    if (collaboratorId !== undefined) {
      updateInput.collaborator = { connect: { id: collaboratorId } };
    }

    // Handle supervisor update (required field, cannot be null)
    if (supervisorId) {
      updateInput.supervisor = { connect: { id: supervisorId } };
    }

    // Handle witness updates (witnessIds from form -> witness relation in Prisma)
    if (witnessIds !== undefined) {
      updateInput.witness = { set: witnessIds.map(id => ({ id })) };
    }

    // Handle file attachment updates (attachmentIds from form -> attachments relation in Prisma)
    if (attachmentIds !== undefined) {
      updateInput.attachments = { set: attachmentIds.map(id => ({ id })) };
    }

    return { ...updateInput, ...rest };
  }

  /**
   * Maps include options to Prisma include.
   * Schema now uses correct Prisma field names, so no transformation needed.
   */
  protected mapIncludeToDatabaseInclude(
    include?: WarningInclude,
  ): Prisma.WarningInclude | undefined {
    if (!include) return undefined;

    // Now the schema field names match Prisma field names, so no mapping needed
    return include as Prisma.WarningInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: WarningOrderBy,
  ): Prisma.WarningOrderByWithRelationInput | undefined {
    return orderBy as Prisma.WarningOrderByWithRelationInput | undefined;
  }

  /**
   * Maps where conditions to Prisma where input.
   * Schema now uses correct Prisma field names, so no transformation needed.
   */
  protected mapWhereToDatabaseWhere(where?: WarningWhere): Prisma.WarningWhereInput | undefined {
    if (!where) return undefined;

    // Now the schema field names match Prisma field names, so no mapping needed
    return where as Prisma.WarningWhereInput;
  }

  protected getDefaultInclude(): Prisma.WarningInclude {
    return {
      collaborator: {
        include: {
          position: true,
          sector: true,
        },
      },
      supervisor: {
        include: {
          position: true,
          sector: true,
        },
      },
      witness: {
        include: {
          position: true,
          sector: true,
        },
      },
      attachments: true,
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: WarningCreateFormData,
    options?: CreateOptions<WarningInclude>,
  ): Promise<Warning> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.warning.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar advertência', error, { data });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: WarningUpdateFormData,
    options?: UpdateOptions<WarningInclude>,
  ): Promise<Warning> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.warning.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar advertência ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Warning> {
    try {
      const result = await transaction.warning.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar advertência ${id}`, error);
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<WarningInclude>,
  ): Promise<Warning | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.warning.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar advertência por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<WarningInclude>,
  ): Promise<Warning[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.warning.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar advertências por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<WarningOrderBy, WarningWhere, WarningInclude>,
  ): Promise<FindManyResult<Warning>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    try {
      const [total, warnings] = await Promise.all([
        transaction.warning.count({
          where: this.mapWhereToDatabaseWhere(where),
        }),
        transaction.warning.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
          skip,
          take,
          include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
        }),
      ]);

      return {
        data: warnings.map(warning => this.mapDatabaseEntityToEntity(warning)),
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError('buscar múltiplas advertências', error, { where, orderBy, page, take });
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: WarningWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.warning.count({ where: whereInput });
    } catch (error) {
      this.logError('contar advertências', error, { where });
      throw error;
    }
  }
}
