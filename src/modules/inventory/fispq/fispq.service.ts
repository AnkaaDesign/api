// fispq.service.ts
// FISPQ / FDS — Ficha de Informações de Segurança de Produtos Químicos (Medicina
// do Trabalho — inventário de produtos químicos). Estrutura espelha medical-exam.service.ts.
//
// Status é DERIVADO na escrita (refreshStatus):
//   DRAFT    — sem PDF e sem validade (cadastro incompleto)
//   EXPIRED  — validade vencida (validUntil < agora)
//   ACTIVE   — caso contrário (FDS vigente)
//   ARCHIVED — só por override explícito (produto descontinuado) — preservado.

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { existsSync, unlinkSync } from 'fs';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FileService } from '@modules/common/file/file.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY, FISPQ_STATUS } from '../../../constants';
import type {
  Fispq,
  FispqGetManyResponse,
  FispqGetUniqueResponse,
  FispqCreateResponse,
  FispqUpdateResponse,
  FispqDeleteResponse,
  FispqBatchCreateResponse,
  FispqBatchUpdateResponse,
  FispqBatchDeleteResponse,
} from '../../../types';
import type {
  FispqGetManyFormData,
  FispqCreateFormData,
  FispqUpdateFormData,
  FispqBatchCreateFormData,
  FispqBatchUpdateFormData,
  FispqBatchDeleteFormData,
  FispqInclude,
} from '../../../schemas';

const FISPQ_TRACKED_FIELDS = [
  'itemId',
  'productName',
  'manufacturer',
  'supplierName',
  'recommendedUse',
  'emergencyPhone',
  'ghsPictograms',
  'signalWord',
  'hazardStatements',
  'precautionStatements',
  'casNumber',
  'onuNumber',
  'unRiskClass',
  'packingGroup',
  'physicalState',
  'color',
  'odor',
  'flashPoint',
  'phValue',
  'firstAidMeasures',
  'fireFightingMeasures',
  'accidentalRelease',
  'handlingStorage',
  'requiredPpeText',
  'pdfFileId',
  'revisionNumber',
  'issueDate',
  'revisionDate',
  'validUntil',
  'status',
  'notes',
  'isActive',
];

@Injectable()
export class FispqService {
  private readonly logger = new Logger(FispqService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
  ) {}

  /**
   * Deriva o status da FDS a partir do PDF + validade. ARCHIVED é preservado
   * (estado manual terminal — produto descontinuado).
   */
  private computeStatus(input: {
    pdfFileId: string | null | undefined;
    validUntil: Date | null | undefined;
    current?: string | null;
    explicit?: string | null;
  }): string {
    if (input.explicit === FISPQ_STATUS.ARCHIVED || input.current === FISPQ_STATUS.ARCHIVED) {
      return FISPQ_STATUS.ARCHIVED;
    }
    const hasPdf = !!input.pdfFileId;
    const validUntil = input.validUntil ?? null;
    if (!hasPdf && !validUntil) {
      return FISPQ_STATUS.DRAFT;
    }
    if (validUntil && validUntil.getTime() < Date.now()) {
      return FISPQ_STATUS.EXPIRED;
    }
    return FISPQ_STATUS.ACTIVE;
  }

  private async fispqValidation(
    data: Partial<FispqCreateFormData | FispqUpdateFormData>,
    currentId: string | null,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    if (data.itemId) {
      const item = await transaction.item.findUnique({ where: { id: data.itemId } });
      if (!item) {
        throw new NotFoundException('Produto químico (item) não encontrado.');
      }
      // 1:1 — um item só pode ter uma FISPQ.
      const existingForItem = await transaction.fispq.findUnique({
        where: { itemId: data.itemId },
        select: { id: true },
      });
      if (existingForItem && existingForItem.id !== currentId) {
        throw new BadRequestException('Este produto já possui uma FISPQ cadastrada.');
      }
    }

    const ppeIds = (data as any).requiredPpeItemIds as string[] | undefined;
    if (ppeIds && ppeIds.length > 0) {
      const count = await transaction.item.count({ where: { id: { in: ppeIds } } });
      if (count !== ppeIds.length) {
        throw new BadRequestException('Um ou mais EPIs informados não foram encontrados.');
      }
    }
  }

  /**
   * Separa os campos m2m (requiredPpeItemIds) do payload escalar e devolve o
   * data pronto para Prisma create/update + o connect-set de EPIs.
   */
  private buildWriteData(
    data: Partial<FispqCreateFormData | FispqUpdateFormData>,
    statusValue: string,
  ): any {
    const { requiredPpeItemIds, ...scalar } = data as any;
    const writeData: any = { ...scalar, status: statusValue as any };
    if (requiredPpeItemIds !== undefined) {
      writeData.requiredPpeItems = {
        set: (requiredPpeItemIds as string[]).map((id: string) => ({ id })),
      };
    }
    return writeData;
  }

  async findMany(query: FispqGetManyFormData): Promise<FispqGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit && query.limit > 0 ? query.limit : 20;
      const skip = (page - 1) * take;
      const where = query.where || {};
      const orderBy = query.orderBy || { createdAt: 'desc' };

      const [totalRecords, fispqs] = await Promise.all([
        this.prisma.fispq.count({ where }),
        this.prisma.fispq.findMany({
          where,
          orderBy,
          include: query.include,
          skip,
          take,
        }),
      ]);

      const totalPages = Math.max(Math.ceil(totalRecords / take), 1);

      return {
        success: true,
        message: 'FISPQs carregadas com sucesso.',
        data: fispqs as unknown as Fispq[],
        meta: {
          totalRecords,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar FISPQs:', error);
      throw new InternalServerErrorException('Erro ao buscar FISPQs. Por favor, tente novamente.');
    }
  }

  async findById(id: string, include?: FispqInclude): Promise<FispqGetUniqueResponse> {
    try {
      const fispq = await this.prisma.fispq.findUnique({ where: { id }, include });

      if (!fispq) {
        throw new NotFoundException('FISPQ não encontrada.');
      }

      return {
        success: true,
        message: 'FISPQ carregada com sucesso.',
        data: fispq as unknown as Fispq,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar FISPQ por ID:', error);
      throw new InternalServerErrorException('Erro ao buscar FISPQ. Por favor, tente novamente.');
    }
  }

  async create(
    data: FispqCreateFormData,
    include?: FispqInclude,
    userId?: string,
  ): Promise<FispqCreateResponse> {
    try {
      const fispq = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.fispqValidation(data, null, tx);

        const status = this.computeStatus({
          pdfFileId: data.pdfFileId,
          validUntil: data.validUntil,
          explicit: data.status,
        });

        const newFispq = await tx.fispq.create({
          data: this.buildWriteData(data, status),
          include,
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.FISPQ,
          entityId: newFispq.id,
          action: CHANGE_ACTION.CREATE,
          entity: newFispq,
          reason: 'FISPQ criada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newFispq;
      });

      return {
        success: true,
        message: 'FISPQ criada com sucesso.',
        data: fispq as unknown as Fispq,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao criar FISPQ:', error);
      throw new InternalServerErrorException('Erro ao criar FISPQ. Por favor, tente novamente.');
    }
  }

  async update(
    id: string,
    data: FispqUpdateFormData,
    include?: FispqInclude,
    userId?: string,
  ): Promise<FispqUpdateResponse> {
    try {
      const fispq = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.fispq.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('FISPQ não encontrada.');
        }

        await this.fispqValidation(data, id, tx);

        const status = this.computeStatus({
          pdfFileId: data.pdfFileId !== undefined ? data.pdfFileId : existing.pdfFileId,
          validUntil: data.validUntil !== undefined ? data.validUntil : existing.validUntil,
          current: existing.status,
          explicit: data.status,
        });

        const updated = await tx.fispq.update({
          where: { id },
          data: this.buildWriteData(data, status),
          include,
        });

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.FISPQ,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: FISPQ_TRACKED_FIELDS,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'FISPQ atualizada com sucesso.',
        data: fispq as unknown as Fispq,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar FISPQ:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar FISPQ. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Upload do PDF oficial da FDS — define pdfFileId e re-deriva o status.
   */
  async uploadDocument(
    id: string,
    file: Express.Multer.File,
    include?: FispqInclude,
    userId?: string,
  ): Promise<FispqUpdateResponse> {
    try {
      const fispq = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.fispq.findUnique({
          where: { id },
          include: { item: { select: { name: true } } },
        });

        if (!existing) {
          throw new NotFoundException('FISPQ não encontrada.');
        }

        const newFile = await this.fileService.createFromUploadWithTransaction(
          tx,
          file,
          'documents',
          userId,
          {
            entityId: id,
            entityType: 'FISPQ',
          },
        );

        const status = this.computeStatus({
          pdfFileId: newFile.id,
          validUntil: existing.validUntil,
          current: existing.status,
        });

        const updated = await tx.fispq.update({
          where: { id },
          data: { pdfFileId: newFile.id, status: status as any },
          include,
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.FISPQ,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'pdfFileId',
          oldValue: existing.pdfFileId,
          newValue: newFile.id,
          reason: 'PDF da FDS anexado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Documento anexado com sucesso.',
        data: fispq as unknown as Fispq,
      };
    } catch (error: any) {
      if (file && existsSync(file.path)) {
        try {
          unlinkSync(file.path);
        } catch {
          this.logger.warn(`Falha ao limpar arquivo temporário: ${file.path}`);
        }
      }

      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao anexar documento à FISPQ:', error);
      throw new InternalServerErrorException(
        'Erro ao anexar documento. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId?: string): Promise<FispqDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const fispq = await tx.fispq.findUnique({ where: { id } });

        if (!fispq) {
          throw new NotFoundException('FISPQ não encontrada.');
        }

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.FISPQ,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: fispq,
          reason: 'FISPQ excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.fispq.delete({ where: { id } });
      });

      return {
        success: true,
        message: 'FISPQ excluída com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao excluir FISPQ:', error);
      throw new InternalServerErrorException('Erro ao excluir FISPQ. Por favor, tente novamente.');
    }
  }

  async batchCreate(
    data: FispqBatchCreateFormData,
    include?: FispqInclude,
    userId?: string,
  ): Promise<FispqBatchCreateResponse<FispqCreateFormData>> {
    try {
      const success: Fispq[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: FispqCreateFormData;
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, itemData] of data.fispqs.entries()) {
          try {
            await this.fispqValidation(itemData, null, tx);

            const status = this.computeStatus({
              pdfFileId: itemData.pdfFileId,
              validUntil: itemData.validUntil,
              explicit: itemData.status,
            });

            const created = await tx.fispq.create({
              data: this.buildWriteData(itemData, status),
              include,
            });

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.FISPQ,
              entityId: created.id,
              action: CHANGE_ACTION.CREATE,
              entity: created,
              reason: 'FISPQ criada em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || null,
              transaction: tx,
            });

            success.push(created as unknown as Fispq);
          } catch (error: any) {
            failed.push({
              index,
              error: error?.message || 'Erro ao criar FISPQ.',
              data: itemData,
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 FISPQ criada com sucesso'
          : `${success.length} FISPQs criadas com sucesso`;
      const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success,
          failed,
          totalProcessed: success.length + failed.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro na criação de FISPQs em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar FISPQs em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchUpdate(
    data: FispqBatchUpdateFormData,
    include?: FispqInclude,
    userId?: string,
  ): Promise<FispqBatchUpdateResponse<FispqUpdateFormData>> {
    try {
      const success: Fispq[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: FispqUpdateFormData & { id: string };
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, update] of data.fispqs.entries()) {
          try {
            const existing = await tx.fispq.findUnique({ where: { id: update.id } });
            if (!existing) {
              throw new NotFoundException('FISPQ não encontrada.');
            }

            await this.fispqValidation(update.data, update.id, tx);

            const status = this.computeStatus({
              pdfFileId:
                update.data.pdfFileId !== undefined ? update.data.pdfFileId : existing.pdfFileId,
              validUntil:
                update.data.validUntil !== undefined
                  ? update.data.validUntil
                  : existing.validUntil,
              current: existing.status,
              explicit: update.data.status,
            });

            const updated = await tx.fispq.update({
              where: { id: update.id },
              data: this.buildWriteData(update.data, status),
              include,
            });

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.FISPQ,
              entityId: update.id,
              oldEntity: existing,
              newEntity: updated,
              fieldsToTrack: FISPQ_TRACKED_FIELDS,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            success.push(updated as unknown as Fispq);
          } catch (error: any) {
            failed.push({
              index,
              id: update.id,
              error: error?.message || 'Erro ao atualizar FISPQ.',
              data: { ...update.data, id: update.id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 FISPQ atualizada com sucesso'
          : `${success.length} FISPQs atualizadas com sucesso`;
      const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success,
          failed,
          totalProcessed: success.length + failed.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro na atualização de FISPQs em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar FISPQs em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: FispqBatchDeleteFormData,
    userId?: string,
  ): Promise<FispqBatchDeleteResponse> {
    try {
      const success: Array<{ id: string; deleted: boolean }> = [];
      const failed: Array<{ index: number; id?: string; error: string; data: { id: string } }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, id] of data.fispqIds.entries()) {
          try {
            const fispq = await tx.fispq.findUnique({ where: { id } });

            if (!fispq) {
              throw new NotFoundException('FISPQ não encontrada.');
            }

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.FISPQ,
              entityId: id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: fispq,
              reason: 'FISPQ excluída em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              userId: userId || null,
              transaction: tx,
            });

            await tx.fispq.delete({ where: { id } });
            success.push({ id, deleted: true });
          } catch (error: any) {
            failed.push({
              index,
              id,
              error: error?.message || 'Erro ao excluir FISPQ.',
              data: { id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 FISPQ excluída com sucesso'
          : `${success.length} FISPQs excluídas com sucesso`;
      const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success,
          failed,
          totalProcessed: success.length + failed.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro na exclusão de FISPQs em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir FISPQs em lote. Por favor, tente novamente.',
      );
    }
  }
}
