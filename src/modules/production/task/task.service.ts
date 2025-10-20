import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { FileService } from '@modules/common/file/file.service';
import type {
  Task,
  TaskBatchCreateResponse,
  TaskBatchDeleteResponse,
  TaskBatchUpdateResponse,
  TaskCreateResponse,
  TaskDeleteResponse,
  TaskGetManyResponse,
  TaskGetUniqueResponse,
  TaskUpdateResponse,
} from '../../../types';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
  getEssentialFields,
  hasValueChanged,
  extractEssentialFields,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  TASK_STATUS,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../../constants/enums';
import { TaskRepository, PrismaTransaction } from './repositories/task.repository';
import {
  TaskCreateFormData,
  TaskUpdateFormData,
  TaskInclude,
  TaskOrderBy,
  TaskBatchUpdateFormData,
  TaskGetManyFormData,
  TaskBatchDeleteFormData,
  TaskBatchCreateFormData,
} from '../../../schemas/task';
import {
  isValidTaskStatusTransition,
  getTaskStatusLabel,
  getTaskStatusOrder,
} from '../../../utils';

/**
 * Task Service
 *
 * Handles task operations. Commission creation logic has been removed.
 * The task's commission status field is maintained for reference but
 * no commission entries are automatically created.
 */
@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksRepository: TaskRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
  ) {}


  /**
   * Create a new task with complete changelog tracking and file uploads
   */
  async create(
    data: TaskCreateFormData,
    include?: TaskInclude,
    userId?: string,
    files?: {
      budgets?: Express.Multer.File[],
      invoices?: Express.Multer.File[],
      receipts?: Express.Multer.File[],
      artworks?: Express.Multer.File[],
      cutFiles?: Express.Multer.File[]
    },
  ): Promise<TaskCreateResponse> {
    try {
      // Create task within transaction with file uploads
      const task = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validate task data
        await this.validateTask(data, undefined, tx);

        // Process cut files BEFORE creating the task (so fileIds are available for cut creation)
        if (files?.cutFiles && files.cutFiles.length > 0 && data.cuts) {
          const customerName = data.customerId ? (await tx.customer.findUnique({ where: { id: data.customerId }, select: { fantasyName: true } }))?.fantasyName : undefined;

          // Upload each cut file and update the corresponding cut with its fileId
          for (let i = 0; i < Math.min(files.cutFiles.length, data.cuts.length); i++) {
            const cutFile = files.cutFiles[i];
            const cutRecord = await this.fileService.createFromUploadWithTransaction(
              tx,
              cutFile,
              'cutFiles',
              userId,
              {
                entityId: '', // Will be updated after task creation
                entityType: 'CUT',
                customerName,
              },
            );
            // Update the cut with the uploaded file's ID
            data.cuts[i].fileId = cutRecord.id;
          }
        }

        // Create the task first WITHOUT files
        const newTask = await this.tasksRepository.createWithTransaction(tx, data, { include });

        // Log task creation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TASK,
          entityId: newTask.id,
          action: CHANGE_ACTION.CREATE,
          entity: extractEssentialFields(
            newTask,
            getEssentialFields(ENTITY_TYPE.TASK) as (keyof Task)[],
          ),
          reason: 'Nova tarefa criada no sistema',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Process and save files WITHIN the transaction
        // This ensures files are only created if the task creation succeeds
        if (files) {
          const fileUpdates: any = {};
          const customerName = newTask.customer?.fantasyName;

          // Budget files (multiple)
          if (files.budgets && files.budgets.length > 0) {
            const budgetIds: string[] = [];
            for (const budgetFile of files.budgets) {
              const budgetRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                budgetFile,
                'taskBudgets',
                userId,
                {
                  entityId: newTask.id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              budgetIds.push(budgetRecord.id);
            }
            fileUpdates.budgets = { connect: budgetIds.map(id => ({ id })) };
          }

          // NFe files (multiple)
          if (files.invoices && files.invoices.length > 0) {
            const nfeIds: string[] = [];
            for (const nfeFile of files.invoices) {
              const nfeRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                nfeFile,
                'taskInvoices',
                userId,
                {
                  entityId: newTask.id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              nfeIds.push(nfeRecord.id);
            }
            fileUpdates.invoices = { connect: nfeIds.map(id => ({ id })) };
          }

          // Receipt files (multiple)
          if (files.receipts && files.receipts.length > 0) {
            const receiptIds: string[] = [];
            for (const receiptFile of files.receipts) {
              const receiptRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                receiptFile,
                'taskReceipts',
                userId,
                {
                  entityId: newTask.id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              receiptIds.push(receiptRecord.id);
            }
            fileUpdates.receipts = { connect: receiptIds.map(id => ({ id })) };
          }

          // Artwork files
          if (files.artworks && files.artworks.length > 0) {
            const artworkIds: string[] = [];
            for (const artworkFile of files.artworks) {
              const artworkRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                artworkFile,
                'tasksArtworks',
                userId,
                {
                  entityId: newTask.id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              artworkIds.push(artworkRecord.id);
            }
            fileUpdates.artworks = { connect: artworkIds.map(id => ({ id })) };
          }

          // Airbrushing files - process files for each airbrushing
          const airbrushingFileFields = Object.keys(files).filter(key => key.startsWith('airbrushings['));
          if (airbrushingFileFields.length > 0 && newTask.airbrushing) {
            console.log('[TaskService] Processing airbrushing files:', airbrushingFileFields.length, 'fields');

            for (const fieldName of airbrushingFileFields) {
              // Parse field name: airbrushings[0].receipts -> index: 0, type: receipts
              const match = fieldName.match(/airbrushings\[(\d+)\]\.(receipts|invoices|artworks)/);
              if (!match) continue;

              const index = parseInt(match[1], 10);
              const fileType = match[2] as 'receipts' | 'invoices' | 'artworks';
              const airbrushingFiles = (files as any)[fieldName] as Express.Multer.File[];

              if (!airbrushingFiles || airbrushingFiles.length === 0) continue;
              if (!newTask.airbrushing[index]) {
                console.warn(`[TaskService] Airbrushing at index ${index} not found`);
                continue;
              }

              const airbrushing = newTask.airbrushing[index];
              console.log(`[TaskService] Processing ${airbrushingFiles.length} ${fileType} for airbrushing ${index} (ID: ${airbrushing.id})`);

              const fileIds: string[] = [];
              for (const file of airbrushingFiles) {
                const fileRecord = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  file,
                  `airbrushing${fileType.charAt(0).toUpperCase() + fileType.slice(1)}` as any,
                  userId,
                  {
                    entityId: airbrushing.id,
                    entityType: 'AIRBRUSHING',
                    customerName,
                  },
                );
                fileIds.push(fileRecord.id);
              }

              // Update the airbrushing with file IDs
              if (fileIds.length > 0) {
                await tx.airbrushing.update({
                  where: { id: airbrushing.id },
                  data: {
                    [fileType]: { connect: fileIds.map(id => ({ id })) },
                  },
                });
                console.log(`[TaskService] Connected ${fileIds.length} ${fileType} to airbrushing ${airbrushing.id}`);
              }
            }
          }

          // Update task with file IDs if any files were uploaded
          if (Object.keys(fileUpdates).length > 0) {
            const updatedTask = await tx.task.update({
              where: { id: newTask.id },
              data: fileUpdates,
              include: include,
            });
            return updatedTask;
          }
        }

        return newTask!;
      });

      return {
        success: true,
        message: 'Tarefa criada com sucesso.',
        data: task as Task,
      };
    } catch (error) {
      this.logger.error('Erro ao criar tarefa:', error);

      // Clean up uploaded files if task creation failed
      if (files) {
        const allFiles = [
          ...(files.budgets || []),
          ...(files.invoices || []),
          ...(files.receipts || []),
          ...(files.artworks || []),
          ...(files.cutFiles || []),
        ];

        for (const file of allFiles) {
          try {
            const fs = await import('fs');
            fs.unlinkSync(file.path);
          } catch (cleanupError) {
            this.logger.warn(`Failed to cleanup temp file: ${file.path}`);
          }
        }
      }

      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao criar a tarefa. Tente novamente.',
      );
    }
  }

  /**
   * Batch create tasks
   */
  async batchCreate(
    data: TaskBatchCreateFormData,
    include?: TaskInclude,
    userId?: string,
  ): Promise<TaskBatchCreateResponse<TaskCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validate all tasks before creating
        const validationErrors: Array<{ index: number; error: string }> = [];

        for (const [index, task] of data.tasks.entries()) {
          try {
            await this.validateTask(task, undefined, tx);
          } catch (error) {
            if (error instanceof BadRequestException || error instanceof NotFoundException) {
              validationErrors.push({ index, error: error.message });
            }
          }
        }

        if (validationErrors.length > 0) {
          const errors = validationErrors
            .map(e => `Tarefa na posição ${e.index + 1}: ${e.error}`)
            .join('; ');
          throw new BadRequestException(errors);
        }

        // Batch create
        const result = await this.tasksRepository.createManyWithTransaction(tx, data.tasks, {
          include,
        });

        // Log successful task creations
        for (const task of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            action: CHANGE_ACTION.CREATE,
            entity: extractEssentialFields(
              task,
              getEssentialFields(ENTITY_TYPE.TASK) as (keyof Task)[],
            ),
            reason: 'Tarefa criada em operação de lote',
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            transaction: tx,
          });
        }

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 tarefa criada com sucesso'
          : `${result.totalCreated} tarefas criadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalCreated + result.totalFailed,
        totalSuccess: result.totalCreated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na criação em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor na criação em lote. Tente novamente.',
      );
    }
  }

  /**
   * Update an existing task with comprehensive changelog tracking and file uploads
   */
  async update(
    id: string,
    data: TaskUpdateFormData,
    include?: TaskInclude,
    userId?: string,
    userPrivilege?: string,
    files?: {
      budgets?: Express.Multer.File[],
      invoices?: Express.Multer.File[],
      receipts?: Express.Multer.File[],
      artworks?: Express.Multer.File[],
      cutFiles?: Express.Multer.File[],
      observationFiles?: Express.Multer.File[]
    },
  ): Promise<TaskUpdateResponse> {
    try {
      const updatedTask = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get existing task - always include customer for file organization
        const existingTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
          include: {
            ...include,
            customer: true, // Always include customer for file path organization
          },
        });

        if (!existingTask) {
          throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
        }

        // Field-level access control for FINANCIAL sector
        if (userPrivilege === 'FINANCIAL') {
          this.validateFinancialSectorAccess(data);
        }

        // Validate task data
        await this.validateTask(data, id, tx);

        // Validate status transition if status is being updated
        if (data.status && (data.status as TASK_STATUS) !== (existingTask.status as TASK_STATUS)) {
          if (
            !isValidTaskStatusTransition(
              existingTask.status as TASK_STATUS,
              data.status as TASK_STATUS,
            )
          ) {
            throw new BadRequestException(
              `Transição de status inválida: ${getTaskStatusLabel(existingTask.status as TASK_STATUS)} → ${getTaskStatusLabel(data.status as TASK_STATUS)}`,
            );
          }

          // Validate date requirements based on status
          if (
            (data.status as TASK_STATUS) === TASK_STATUS.IN_PRODUCTION &&
            !existingTask.startedAt &&
            !data.startedAt
          ) {
            throw new BadRequestException(
              'Data de início é obrigatória ao mover tarefa para EM PRODUÇÃO',
            );
          }
          if (
            (data.status as TASK_STATUS) === TASK_STATUS.COMPLETED &&
            !existingTask.finishedAt &&
            !data.finishedAt
          ) {
            throw new BadRequestException(
              'Data de conclusão é obrigatória ao mover tarefa para CONCLUÍDO',
            );
          }
        }

        // Process cut files BEFORE updating the task (so fileIds are available for cut creation)
        if (files?.cutFiles && files.cutFiles.length > 0 && data.cuts) {
          const customerName = existingTask.customer?.fantasyName || (data.customerId ? (await tx.customer.findUnique({ where: { id: data.customerId }, select: { fantasyName: true } }))?.fantasyName : undefined);

          // Upload each cut file and update the corresponding cut with its fileId
          for (let i = 0; i < Math.min(files.cutFiles.length, data.cuts.length); i++) {
            const cutFile = files.cutFiles[i];
            const cutRecord = await this.fileService.createFromUploadWithTransaction(
              tx,
              cutFile,
              'cutFiles',
              userId,
              {
                entityId: id,
                entityType: 'CUT',
                customerName,
              },
            );
            // Update the cut with the uploaded file's ID
            data.cuts[i].fileId = cutRecord.id;
          }
        }

        // Process observation files BEFORE task update (to replace temporary IDs with real UUIDs)
        if (files?.observationFiles && files.observationFiles.length > 0 && data.observation) {
          console.log('[TaskService] Processing observation files BEFORE task update:', files.observationFiles.length);
          const customerName = existingTask.customer?.fantasyName;

          // Get existing observation file IDs (only real UUIDs, not temporary IDs)
          const existingFileIds = data.observation.fileIds?.filter(id =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
          ) || [];
          console.log('[TaskService] Existing valid file IDs:', existingFileIds);

          const newFileIds: string[] = [...existingFileIds];

          // Upload each observation file
          for (const observationFile of files.observationFiles) {
            const fileRecord = await this.fileService.createFromUploadWithTransaction(
              tx,
              observationFile,
              'observationFiles',
              userId,
              {
                entityId: id,
                entityType: 'OBSERVATION',
                customerName,
              },
            );
            newFileIds.push(fileRecord.id);
            console.log('[TaskService] Uploaded observation file:', fileRecord.id);
          }

          // Replace temporary IDs with real UUIDs
          data.observation.fileIds = newFileIds;
          console.log('[TaskService] Updated observation.fileIds:', newFileIds);
        } else if (data.observation?.fileIds) {
          // No new files to upload, but observation has fileIds - filter out temporary IDs
          data.observation.fileIds = data.observation.fileIds.filter(id =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
          );
          console.log('[TaskService] Filtered observation.fileIds (no new files):', data.observation.fileIds);
        }

        // Ensure statusOrder is updated when status changes
        const updateData = {
          ...data,
          ...(data.status && { statusOrder: getTaskStatusOrder(data.status as TASK_STATUS) }),
        };

        // Update the task - always include customer for file organization
        let updatedTask = await this.tasksRepository.updateWithTransaction(tx, id, updateData, {
          include: {
            ...include,
            customer: true, // Always include customer for file path organization
          },
        });

        // Process and save files WITHIN the transaction
        // This ensures files are only created if the task update succeeds
        if (files) {
          const fileUpdates: any = {};
          const customerName = updatedTask.customer?.fantasyName || existingTask.customer?.fantasyName;

          this.logger.log(`[Task Update] Processing files with customer name: "${customerName}" (from updatedTask: ${!!updatedTask.customer?.fantasyName}, from existingTask: ${!!existingTask.customer?.fantasyName})`);

          // Budget files (multiple)
          if (files.budgets && files.budgets.length > 0) {
            const budgetIds: string[] = data.budgetIds ? [...data.budgetIds] : (existingTask.budgets?.map((b: any) => b.id) || []);
            for (const budgetFile of files.budgets) {
              const budgetRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                budgetFile,
                'taskBudgets',
                userId,
                {
                  entityId: id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              budgetIds.push(budgetRecord.id);
            }
            fileUpdates.budgets = { connect: budgetIds.map(id => ({ id })) };
          }

          // NFe files (multiple)
          if (files.invoices && files.invoices.length > 0) {
            const nfeIds: string[] = data.nfeIds ? [...data.nfeIds] : (existingTask.invoices?.map((n: any) => n.id) || []);
            for (const nfeFile of files.invoices) {
              const nfeRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                nfeFile,
                'taskInvoices',
                userId,
                {
                  entityId: id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              nfeIds.push(nfeRecord.id);
            }
            fileUpdates.invoices = { connect: nfeIds.map(id => ({ id })) };
          }

          // Receipt files (multiple)
          if (files.receipts && files.receipts.length > 0) {
            const receiptIds: string[] = data.receiptIds ? [...data.receiptIds] : (existingTask.receipts?.map((r: any) => r.id) || []);
            for (const receiptFile of files.receipts) {
              const receiptRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                receiptFile,
                'taskReceipts',
                userId,
                {
                  entityId: id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              receiptIds.push(receiptRecord.id);
            }
            fileUpdates.receipts = { connect: receiptIds.map(id => ({ id })) };
          }

          // Artwork files
          if (files.artworks && files.artworks.length > 0) {
            const artworkIds: string[] = data.artworkIds ? [...data.artworkIds] : (existingTask.artworks?.map((a: any) => a.id) || []);
            for (const artworkFile of files.artworks) {
              const artworkRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                artworkFile,
                'tasksArtworks',
                userId,
                {
                  entityId: id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              artworkIds.push(artworkRecord.id);
            }
            fileUpdates.artworks = { connect: artworkIds.map(id => ({ id })) };
          }

          // Airbrushing files - process files for each airbrushing
          const airbrushingFileFields = Object.keys(files).filter(key => key.startsWith('airbrushings['));
          if (airbrushingFileFields.length > 0 && updatedTask?.airbrushing) {
            console.log('[TaskService.update] Processing airbrushing files:', airbrushingFileFields.length, 'fields');

            for (const fieldName of airbrushingFileFields) {
              // Parse field name: airbrushings[0].receipts -> index: 0, type: receipts
              const match = fieldName.match(/airbrushings\[(\d+)\]\.(receipts|invoices|artworks)/);
              if (!match) continue;

              const index = parseInt(match[1], 10);
              const fileType = match[2] as 'receipts' | 'invoices' | 'artworks';
              const airbrushingFiles = (files as any)[fieldName] as Express.Multer.File[];

              if (!airbrushingFiles || airbrushingFiles.length === 0) continue;
              if (!updatedTask.airbrushing[index]) {
                console.warn(`[TaskService.update] Airbrushing at index ${index} not found`);
                continue;
              }

              const airbrushing = updatedTask.airbrushing[index];
              console.log(`[TaskService.update] Processing ${airbrushingFiles.length} ${fileType} for airbrushing ${index} (ID: ${airbrushing.id})`);

              const fileIds: string[] = [];
              for (const file of airbrushingFiles) {
                const fileRecord = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  file,
                  `airbrushing${fileType.charAt(0).toUpperCase() + fileType.slice(1)}` as any,
                  userId,
                  {
                    entityId: airbrushing.id,
                    entityType: 'AIRBRUSHING',
                    customerName,
                  },
                );
                fileIds.push(fileRecord.id);
              }

              // Update the airbrushing with file IDs
              if (fileIds.length > 0) {
                await tx.airbrushing.update({
                  where: { id: airbrushing.id },
                  data: {
                    [fileType]: { connect: fileIds.map(id => ({ id })) },
                  },
                });
                console.log(`[TaskService.update] Connected ${fileIds.length} ${fileType} to airbrushing ${airbrushing.id}`);
              }
            }
          }

          // NOTE: Observation files are processed BEFORE the first task update
          // (see lines 462-501) to avoid Prisma errors with temporary file IDs

          // Update task with file IDs if any files were uploaded
          if (Object.keys(fileUpdates).length > 0) {
            updatedTask = await tx.task.update({
              where: { id },
              data: fileUpdates,
              include: include,
            }) as any;
          }
        }

        // Track individual field changes
        const fieldsToTrack = [
          'status',
          'startedAt',
          'finishedAt',
          'commission',
          'customerId',
          'sectorId',
          'paintId',
          'details',
          'name',
          'serialNumber',
          'plate',
          'term',
          'entryDate',
          'priority',
          'statusOrder',
          'createdById',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TASK,
          entityId: id,
          oldEntity: existingTask,
          newEntity: updatedTask,
          fieldsToTrack,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Track services array changes
        if (data.services !== undefined) {
          const oldServices = existingTask.services || [];
          const newServices = updatedTask?.services || [];

          // Serialize services for changelog - store full data for rollback support
          const serializeServices = (services: any[]) => {
            return services.map((s: any) => ({
              description: s.description,
              status: s.status,
              ...(s.startedAt && { startedAt: s.startedAt }),
              ...(s.finishedAt && { finishedAt: s.finishedAt }),
            }));
          };

          const oldServicesSerialized = JSON.stringify(serializeServices(oldServices));
          const newServicesSerialized = JSON.stringify(serializeServices(newServices));

          // Only create changelog if services actually changed
          if (oldServicesSerialized !== newServicesSerialized) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'services',
              oldValue: serializeServices(oldServices),
              newValue: serializeServices(newServices),
              reason: `Serviços alterados de ${oldServices.length} para ${newServices.length}`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        // Track artworks array changes
        if (data.artworkIds) {
          const oldArtworks = existingTask.artworks || [];
          const newArtworks = updatedTask?.artworks || [];

          const oldArtworkIds = oldArtworks.map((f: any) => f.id);
          const newArtworkIds = newArtworks.map((f: any) => f.id);

          const addedArtworks = newArtworks.filter((f: any) => !oldArtworkIds.includes(f.id));
          const removedArtworks = oldArtworks.filter((f: any) => !newArtworkIds.includes(f.id));

          if (addedArtworks.length > 0) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'artworks',
              oldValue: null,
              newValue: addedArtworks,
              reason: `${addedArtworks.length} arte(s) adicionada(s)`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }

          if (removedArtworks.length > 0) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'artworks',
              oldValue: removedArtworks,
              newValue: null,
              reason: `${removedArtworks.length} arte(s) removida(s)`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        // Track logoPaints array changes (paintIds)
        if (data.paintIds) {
          const oldPaintIds = existingTask.logoPaints?.map((p: any) => p.id) || [];
          const newPaintIds = data.paintIds || [];

          const addedPaintIds = newPaintIds.filter((id: string) => !oldPaintIds.includes(id));
          const removedPaintIds = oldPaintIds.filter((id: string) => !newPaintIds.includes(id));

          if (addedPaintIds.length > 0) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'logoPaints',
              oldValue: null,
              newValue: addedPaintIds,
              reason: `${addedPaintIds.length} tinta(s) adicionada(s)`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }

          if (removedPaintIds.length > 0) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'logoPaints',
              oldValue: removedPaintIds,
              newValue: null,
              reason: `${removedPaintIds.length} tinta(s) removida(s)`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        // Track cuts array changes (CRITICAL - user reported this missing)
        if (data.cuts !== undefined) {
          const oldCuts = existingTask.cuts || [];
          const newCuts = updatedTask?.cuts || [];

          // Serialize cuts for changelog - store full data for rollback support
          // Count how many cuts have the same fileId+type+origin to determine quantity
          const serializeCuts = (cuts: any[]) => {
            const grouped = new Map<string, any>();

            cuts.forEach((c: any) => {
              const key = `${c.type}-${c.fileId || c.file?.id}-${c.origin}-${c.reason || 'none'}-${c.parentCutId || 'none'}`;

              if (grouped.has(key)) {
                grouped.get(key).quantity += 1;
              } else {
                grouped.set(key, {
                  fileId: c.fileId || c.file?.id || null,
                  type: c.type,
                  origin: c.origin,
                  quantity: 1,
                  ...(c.reason && { reason: c.reason }),
                  ...(c.parentCutId && { parentCutId: c.parentCutId }),
                });
              }
            });

            return Array.from(grouped.values());
          };

          const oldCutsSerialized = JSON.stringify(serializeCuts(oldCuts));
          const newCutsSerialized = JSON.stringify(serializeCuts(newCuts));

          // Only create changelog if cuts actually changed
          if (oldCutsSerialized !== newCutsSerialized) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'cuts',
              oldValue: serializeCuts(oldCuts),
              newValue: serializeCuts(newCuts),
              reason: `Recortes alterados de ${oldCuts.length} para ${newCuts.length}`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        // Track airbrushings array changes
        if (data.airbrushings !== undefined) {
          const oldAirbrushings = existingTask.airbrushings || [];
          const newAirbrushings = updatedTask?.airbrushings || [];

          // Serialize airbrushings for comparison
          const serializeAirbrushings = (airbrushings: any[]) => {
            return airbrushings.map((a: any) => ({
              description: a.description,
              status: a.status,
            }));
          };

          const oldAirbrushingsSerialized = JSON.stringify(serializeAirbrushings(oldAirbrushings));
          const newAirbrushingsSerialized = JSON.stringify(serializeAirbrushings(newAirbrushings));

          // Only create changelog if airbrushings actually changed
          if (oldAirbrushingsSerialized !== newAirbrushingsSerialized) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'airbrushings',
              oldValue: serializeAirbrushings(oldAirbrushings),
              newValue: serializeAirbrushings(newAirbrushings),
              reason: `Aerografias alteradas de ${oldAirbrushings.length} para ${newAirbrushings.length}`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        return updatedTask!;
      });

      return {
        success: true,
        message: 'Tarefa atualizada com sucesso.',
        data: updatedTask,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar tarefa:', error);

      // Clean up uploaded files if task update failed
      if (files) {
        const allFiles = [
          ...(files.budgets || []),
          ...(files.invoices || []),
          ...(files.receipts || []),
          ...(files.artworks || []),
          ...(files.cutFiles || []),
        ];

        for (const file of allFiles) {
          try {
            const fs = await import('fs');
            fs.unlinkSync(file.path);
          } catch (cleanupError) {
            this.logger.warn(`Failed to cleanup temp file: ${file.path}`);
          }
        }
      }

      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao atualizar a tarefa. Tente novamente.',
      );
    }
  }

  /**
   * Batch update tasks
   */
  async batchUpdate(
    data: TaskBatchUpdateFormData,
    include?: TaskInclude,
    userId?: string,
  ): Promise<TaskBatchUpdateResponse<TaskUpdateFormData>> {
    this.logger.log('[batchUpdate] ========== BATCH UPDATE STARTED ==========');
    this.logger.log(`[batchUpdate] Number of tasks to update: ${data.tasks?.length || 0}`);
    this.logger.log(`[batchUpdate] Tasks data: ${JSON.stringify(data.tasks?.map(t => ({ id: t.id, data: t.data })))}`);
    this.logger.log(`[batchUpdate] userId: ${userId}`);
    this.logger.log(`[batchUpdate] include: ${JSON.stringify(include)}`);

    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        this.logger.log('[batchUpdate] Inside transaction');
        // Prepare updates with change tracking and validation
        const updatesWithChangeTracking: { id: string; data: TaskUpdateFormData }[] = [];
        const validationErrors: Array<{ id: string; error: string }> = [];

        for (const update of data.tasks) {
          this.logger.log(`[batchUpdate] Processing task ${update.id}`);
          const existingTask = await this.tasksRepository.findByIdWithTransaction(tx, update.id, {
            include,
          });
          if (existingTask) {
            this.logger.log(`[batchUpdate] Found existing task ${update.id}, validating...`);
            try {
              await this.validateTask(update.data, update.id, tx);

              // Validate status transition if status is being updated
              if (
                update.data.status &&
                (update.data.status as TASK_STATUS) !== (existingTask.status as TASK_STATUS)
              ) {
                if (
                  !isValidTaskStatusTransition(
                    existingTask.status as TASK_STATUS,
                    update.data.status as TASK_STATUS,
                  )
                ) {
                  throw new BadRequestException(
                    `Transição de status inválida: ${getTaskStatusLabel(existingTask.status as TASK_STATUS)} → ${getTaskStatusLabel(update.data.status as TASK_STATUS)}`,
                  );
                }

                // Validate date requirements based on status
                if (
                  (update.data.status as TASK_STATUS) === TASK_STATUS.IN_PRODUCTION &&
                  !existingTask.startedAt &&
                  !update.data.startedAt
                ) {
                  throw new BadRequestException(
                    'Data de início é obrigatória ao mover tarefa para EM PRODUÇÃO',
                  );
                }
                if (
                  (update.data.status as TASK_STATUS) === TASK_STATUS.COMPLETED &&
                  !existingTask.finishedAt &&
                  !update.data.finishedAt
                ) {
                  throw new BadRequestException(
                    'Data de conclusão é obrigatória ao mover tarefa para CONCLUÍDO',
                  );
                }
              }

              // Ensure statusOrder is updated when status changes
              const updateData = {
                ...update.data,
                ...(update.data.status && {
                  statusOrder: getTaskStatusOrder(update.data.status as TASK_STATUS),
                }),
              };

              updatesWithChangeTracking.push({
                id: update.id,
                data: updateData,
              });
            } catch (error) {
              this.logger.error(`[batchUpdate] Validation error for task ${update.id}:`, error);
              if (error instanceof BadRequestException) {
                validationErrors.push({ id: update.id, error: error.message });
              } else {
                // Log and re-throw unexpected errors
                this.logger.error(`[batchUpdate] Unexpected error during validation:`, error);
                throw error;
              }
            }
          } else {
            this.logger.warn(`[batchUpdate] Task ${update.id} not found`);
          }
        }

        // If there are validation errors, include them in the batch result
        const failedItems = validationErrors.map(e => ({
          id: e.id,
          error: e.error,
          data: data.tasks.find(u => u.id === e.id)?.data || ({} as TaskUpdateFormData),
        }));

        // Batch update only valid items
        const result = await this.tasksRepository.updateManyWithTransaction(
          tx,
          updatesWithChangeTracking,
          { include },
        );

        // Add validation failures to the result
        if (failedItems.length > 0) {
          result.failed = [...(result.failed || []), ...failedItems];
          result.totalFailed = (result.totalFailed || 0) + failedItems.length;
        }

        // Track individual field changes for successful updates
        for (const task of result.success) {
          const updateData = data.tasks.find(u => u.id === task.id)?.data;
          const existingTask = await this.tasksRepository.findByIdWithTransaction(tx, task.id);

          // Track individual field changes for batch update
          if (existingTask && updateData) {
            const fieldsToTrack = Object.keys(updateData) as Array<keyof typeof updateData>;

            for (const field of fieldsToTrack) {
              const oldValue = existingTask[field as keyof typeof existingTask];
              const newValue = task[field as keyof typeof task];

              // Only log if the value actually changed
              if (hasValueChanged(oldValue, newValue)) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: field as string,
                  oldValue: oldValue,
                  newValue: newValue,
                  reason: `Campo ${String(field)} atualizado em operação de lote`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });
              }
            }
          }
        }

        this.logger.log(`[batchUpdate] Transaction complete. Success: ${result.totalUpdated}, Failed: ${result.totalFailed}`);
        return result;
      });

      this.logger.log('[batchUpdate] ========== BATCH UPDATE COMPLETED ==========');
      const successMessage =
        result.totalUpdated === 1
          ? '1 tarefa atualizada com sucesso'
          : `${result.totalUpdated} tarefas atualizadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalUpdated + result.totalFailed,
        totalSuccess: result.totalUpdated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('[batchUpdate] ========== BATCH UPDATE FAILED ==========');
      this.logger.error('[batchUpdate] Error details:', error);
      this.logger.error('[batchUpdate] Error stack:', error instanceof Error ? error.stack : 'No stack trace');

      // Re-throw BadRequestException and other client errors as-is
      if (error instanceof BadRequestException) {
        throw error;
      }

      // For other errors, provide more detailed information
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new InternalServerErrorException(
        `Erro na atualização em lote: ${errorMessage}`,
      );
    }
  }

  /**
   * Delete a task
   */
  async delete(id: string, userId?: string): Promise<TaskDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const task = await this.tasksRepository.findByIdWithTransaction(tx, id);

        if (!task) {
          throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
        }

        // Log deletion
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TASK,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: extractEssentialFields(
            task,
            getEssentialFields(ENTITY_TYPE.TASK) as (keyof Task)[],
          ),
          reason: 'Tarefa excluída do sistema',
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.tasksRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Tarefa excluída com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao excluir tarefa:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao excluir a tarefa. Tente novamente.',
      );
    }
  }

  /**
   * Batch delete tasks
   */
  async batchDelete(
    data: TaskBatchDeleteFormData,
    userId?: string,
  ): Promise<TaskBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get tasks before deletion for logging
        const tasks = await this.tasksRepository.findByIdsWithTransaction(tx, data.taskIds);

        // Log deletions
        for (const task of tasks) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: extractEssentialFields(
              task,
              getEssentialFields(ENTITY_TYPE.TASK) as (keyof Task)[],
            ),
            reason: 'Tarefa excluída em operação de lote',
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            transaction: tx,
          });
        }

        // Batch delete
        return this.tasksRepository.deleteManyWithTransaction(tx, data.taskIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 tarefa excluída com sucesso'
          : `${result.totalDeleted} tarefas excluídas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalDeleted + result.totalFailed,
        totalSuccess: result.totalDeleted,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
    }
  }

  /**
   * Find a task by ID
   */
  async findById(id: string, include?: TaskInclude): Promise<TaskGetUniqueResponse> {
    try {
      const task = await this.tasksRepository.findById(id, { include });

      if (!task) {
        throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
      }

      return {
        success: true,
        message: 'Tarefa carregada com sucesso.',
        data: task,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar tarefa por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar a tarefa. Tente novamente.',
      );
    }
  }

  /**
   * Find many tasks with filtering
   */
  async findMany(query: TaskGetManyFormData): Promise<TaskGetManyResponse> {
    try {
      console.log("[TaskService.findMany] Query received:", {
        hasWhere: !!query.where,
        whereKeys: query.where ? Object.keys(query.where) : [],
        whereStringified: query.where ? JSON.stringify(query.where).substring(0, 200) : "undefined",
        searchingFor: (query as any).searchingFor,
        page: query.page,
        limit: query.limit,
      });

      // The schema transform already handles searchingFor and converts it to where clause
      // No need for additional handling here
      const params = {
        where: query.where,
        page: query.page,
        take: query.limit,
        orderBy: query.orderBy as TaskOrderBy,
        include: query.include as TaskInclude,
      };

      const result = await this.tasksRepository.findMany(params);

      return {
        success: true,
        message: 'Tarefas carregadas com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar tarefas:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar as tarefas. Tente novamente.',
      );
    }
  }

  /**
   * Validate task data
   */
  /**
   * Validate field-level access for FINANCIAL sector
   * Financial can ONLY update: budget, customer, serialNumber, chassis, documents (budgets, invoices, receipts)
   */
  private validateFinancialSectorAccess(data: TaskUpdateFormData): void {
    const allowedFields = [
      'budgetIds',
      'customerId',
      'serialNumber',
      'chassis',
      'nfeIds',
      'receiptIds',
      // Note: budget/invoice/receipt file uploads are handled separately via files parameter
    ];

    const attemptedFields = Object.keys(data);
    const disallowedFields = attemptedFields.filter(field => !allowedFields.includes(field));

    if (disallowedFields.length > 0) {
      throw new BadRequestException(
        `Setor Financeiro não tem permissão para atualizar os seguintes campos: ${disallowedFields.join(', ')}. ` +
        `Campos permitidos: orçamento, cliente, número de série, chassi, documentos.`
      );
    }
  }

  private async validateTask(
    data: Partial<TaskCreateFormData | TaskUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validate services for creation
    if (!existingId && (!data.services || data.services.length === 0)) {
      throw new BadRequestException('A tarefa deve conter pelo menos um serviço para ser criada.');
    }

    // Validate customer exists
    if (data.customerId) {
      const customer = await transaction.customer.findUnique({ where: { id: data.customerId } });
      if (!customer) {
        throw new NotFoundException('Cliente não encontrado.');
      }
    }

    // Services are created inline with the task, no need to validate they exist

    // Validate user exists
    if ('createdById' in data && (data as any).createdById) {
      const user = await transaction.user.findUnique({ where: { id: (data as any).createdById } });
      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }
    }

    // Validate sector exists if provided
    if (data.sectorId) {
      const sector = await transaction.sector.findUnique({ where: { id: data.sectorId } });
      if (!sector) {
        throw new NotFoundException('Setor não encontrado.');
      }
    }


    // Validate status-specific requirements
    if (data.status) {
      // For update, we need to check the existing task
      let existingTask: { status: any; startedAt: Date | null; finishedAt: Date | null } | null =
        null;
      if (existingId) {
        existingTask = await transaction.task.findUnique({
          where: { id: existingId },
          select: { status: true, startedAt: true, finishedAt: true },
        });
      }

      // If status is IN_PRODUCTION, require startedAt
      if ((data.status as TASK_STATUS) === TASK_STATUS.IN_PRODUCTION) {
        const hasStartedAt = data.startedAt || existingTask?.startedAt;
        if (!hasStartedAt) {
          throw new BadRequestException('Data de início é obrigatória para tarefas em produção.');
        }
      }

      // If status is COMPLETED, require finishedAt
      if ((data.status as TASK_STATUS) === TASK_STATUS.COMPLETED) {
        const hasFinishedAt = data.finishedAt || existingTask?.finishedAt;
        if (!hasFinishedAt) {
          throw new BadRequestException('Data de conclusão é obrigatória para tarefas concluídas.');
        }

        // Ensure finishedAt > startedAt
        const startedAt = data.startedAt || existingTask?.startedAt;
        const finishedAt = data.finishedAt || existingTask?.finishedAt;

        if (startedAt && finishedAt) {
          const startDate = new Date(startedAt);
          const finishDate = new Date(finishedAt);

          if (finishDate <= startDate) {
            throw new BadRequestException('Data de conclusão deve ser posterior à data de início.');
          }
        }
      }
    }

    // Validate unique serial number
    if (data.serialNumber) {
      const existing = await transaction.task.findFirst({
        where: {
          serialNumber: data.serialNumber,
          ...(existingId && { id: { not: existingId } }),
        },
      });
      if (existing) {
        throw new BadRequestException('Número de série já está em uso.');
      }
    }

    // Validate unique plate
    if (data.plate) {
      const existing = await transaction.task.findFirst({
        where: {
          plate: data.plate,
          ...(existingId && { id: { not: existingId } }),
        },
      });
      if (existing) {
        throw new BadRequestException('Placa já está cadastrada.');
      }
    }
  }

  /**
   * Rollback a field change based on a changelog entry
   * Reverts the specified field to its previous value from the changelog
   */
  async rollbackFieldChange(changeLogId: string, userId: string): Promise<TaskUpdateResponse> {
    return await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // 1. Get the changelog entry
      const changeLog = await tx.changeLog.findUnique({
        where: { id: changeLogId },
      });

      if (!changeLog) {
        throw new NotFoundException('Entrada de changelog não encontrada');
      }

      if (changeLog.entityType !== 'TASK') {
        throw new BadRequestException('Entrada de changelog não é de uma tarefa');
      }

      // 2. Get current task
      const currentTask = await this.tasksRepository.findByIdWithTransaction(
        tx,
        changeLog.entityId,
      );

      if (!currentTask) {
        throw new NotFoundException('Tarefa não encontrada');
      }

      // 3. Extract the field and old value from changelog
      const fieldToRevert = changeLog.field;
      const oldValue = changeLog.oldValue;

      if (!fieldToRevert) {
        throw new BadRequestException(
          'Não é possível reverter: campo não especificado na entrada de changelog',
        );
      }

      // 4. Create update data with just the field being rolled back
      const updateData: any = {
        [fieldToRevert]: oldValue,
      };

      // 5. Special handling for status changes
      if (fieldToRevert === 'status') {
        const targetStatus = oldValue as TASK_STATUS;
        const currentStatus = currentTask.status as TASK_STATUS;

        // Validate if we can rollback to this status
        if (!isValidTaskStatusTransition(currentStatus, targetStatus)) {
          throw new BadRequestException(
            `Não é possível reverter status de ${getTaskStatusLabel(currentStatus)} para ${getTaskStatusLabel(targetStatus)}: transição inválida`,
          );
        }

        // Update statusOrder when status changes
        updateData.statusOrder = getTaskStatusOrder(targetStatus);

        // Handle date field validation for rolled back status
        if (targetStatus === TASK_STATUS.IN_PRODUCTION && !currentTask.startedAt) {
          throw new BadRequestException(
            'Não é possível reverter para EM PRODUÇÃO: data de início não está definida',
          );
        }
        if (targetStatus === TASK_STATUS.COMPLETED && !currentTask.finishedAt) {
          throw new BadRequestException(
            'Não é possível reverter para CONCLUÍDO: data de conclusão não está definida',
          );
        }
      }


      // 7. Update the task
      const updatedTask = await this.tasksRepository.updateWithTransaction(
        tx,
        changeLog.entityId,
        updateData,
      );


      // 9. Log the rollback action
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.TASK,
        entityId: changeLog.entityId,
        action: CHANGE_ACTION.ROLLBACK,
        field: fieldToRevert,
        oldValue: changeLog.newValue, // What we're rolling back from
        newValue: changeLog.oldValue, // What we're rolling back to
        reason: `Campo '${fieldToRevert}' revertido via changelog ${changeLogId}`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: changeLog.entityId,
        userId,
        transaction: tx,
      });

      this.logger.log(
        `Field '${fieldToRevert}' rolled back for task ${changeLog.entityId} by user ${userId}`,
      );

      return {
        success: true,
        message: `Campo '${fieldToRevert}' revertido com sucesso`,
        data: updatedTask,
      };
    });
  }

  // =====================
  // TRUCK POSITIONING METHODS
  // =====================

  /**
   * Update the position of a truck associated with a task
   */
  async updateTaskPosition(
    taskId: string,
    positionData: {
      xPosition?: number | null;
      yPosition?: number | null;
      garageId?: string | null;
      laneId?: string | null;
    },
    include?: TaskInclude,
    userId?: string,
  ): Promise<TaskUpdateResponse> {
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Find the task with its truck
      const task = await tx.task.findUnique({
        where: { id: taskId },
        include: {
          truck: {
            include: {
              leftSideLayout: { include: { layoutSections: true } },
              rightSideLayout: { include: { layoutSections: true } },
              backSideLayout: { include: { layoutSections: true } },
            },
          },
        },
      });

      if (!task) {
        throw new NotFoundException(`Tarefa ${taskId} não encontrada`);
      }

      if (!task.truck) {
        throw new BadRequestException(`Tarefa ${taskId} não possui caminhão associado`);
      }

      // Validate that truck has layout before positioning
      if (!task.truck.leftSideLayout && !task.truck.rightSideLayout && !task.truck.backSideLayout) {
        throw new BadRequestException(
          `Caminhão da tarefa ${taskId} não possui layout definido. Layouts são necessários para posicionamento.`
        );
      }

      // Validate position if provided
      if (positionData.xPosition !== undefined && positionData.yPosition !== undefined &&
          positionData.garageId && positionData.garageId !== null) {
        await this.validateTruckPosition(
          task.truck.id,
          positionData.xPosition,
          positionData.yPosition,
          positionData.garageId,
          positionData.laneId || null,
          task.truck,
          tx
        );
      }

      // Update truck position
      await tx.truck.update({
        where: { id: task.truck.id },
        data: {
          xPosition: positionData.xPosition,
          yPosition: positionData.yPosition,
          garageId: positionData.garageId,
          laneId: positionData.laneId,
        },
      });

      // Log the change
      if (userId) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TRUCK,
          entityId: task.truck.id,
          action: CHANGE_ACTION.UPDATE,
          userId,
          metadata: {
            taskId: task.id,
            oldPosition: {
              xPosition: task.truck.xPosition,
              yPosition: task.truck.yPosition,
              garageId: task.truck.garageId,
              laneId: task.truck.laneId,
            },
            newPosition: positionData,
          },
          transaction: tx,
        });
      }

      // Fetch updated task
      const updatedTask = await this.tasksRepository.findById(
        taskId,
        include,
        tx
      );

      return {
        success: true,
        message: 'Posição do caminhão atualizada com sucesso',
        data: updatedTask,
      };
    });
  }

  /**
   * Bulk update positions for multiple trucks
   */
  async bulkUpdatePositions(
    data: {
      updates: Array<{
        taskId: string;
        xPosition?: number | null;
        yPosition?: number | null;
        garageId?: string | null;
        laneId?: string | null;
      }>;
    },
    include?: TaskInclude,
    userId?: string,
  ): Promise<TaskBatchUpdateResponse<any>> {
    const results: Task[] = [];
    const errors: Array<{ input: any; error: string }> = [];

    for (const update of data.updates) {
      try {
        const result = await this.updateTaskPosition(
          update.taskId,
          update,
          include,
          userId
        );
        results.push(result.data);
      } catch (error) {
        errors.push({
          input: update,
          error: error.message || 'Erro desconhecido',
        });
      }
    }

    return {
      success: errors.length === 0,
      message: errors.length === 0
        ? 'Todas as posições foram atualizadas com sucesso'
        : `${results.length} posições atualizadas, ${errors.length} falharam`,
      data: results,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Swap positions of two trucks
   */
  async swapTaskPositions(
    taskId1: string,
    taskId2: string,
    include?: TaskInclude,
    userId?: string,
  ): Promise<{ success: boolean; message: string; data: { task1: Task; task2: Task } }> {
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Fetch both tasks with trucks
      const task1 = await tx.task.findUnique({
        where: { id: taskId1 },
        include: { truck: true },
      });

      const task2 = await tx.task.findUnique({
        where: { id: taskId2 },
        include: { truck: true },
      });

      if (!task1 || !task2) {
        throw new NotFoundException('Uma ou ambas as tarefas não foram encontradas');
      }

      if (!task1.truck || !task2.truck) {
        throw new BadRequestException('Ambas as tarefas devem ter caminhões associados');
      }

      // Store original positions
      const truck1Position = {
        xPosition: task1.truck.xPosition,
        yPosition: task1.truck.yPosition,
        garageId: task1.truck.garageId,
        laneId: task1.truck.laneId,
      };

      const truck2Position = {
        xPosition: task2.truck.xPosition,
        yPosition: task2.truck.yPosition,
        garageId: task2.truck.garageId,
        laneId: task2.truck.laneId,
      };

      // Swap positions
      await tx.truck.update({
        where: { id: task1.truck.id },
        data: truck2Position,
      });

      await tx.truck.update({
        where: { id: task2.truck.id },
        data: truck1Position,
      });

      // Log changes
      if (userId) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TRUCK,
          entityId: task1.truck.id,
          action: CHANGE_ACTION.UPDATE,
          userId,
          metadata: {
            operation: 'swap',
            swappedWith: task2.truck.id,
            oldPosition: truck1Position,
            newPosition: truck2Position,
          },
          transaction: tx,
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TRUCK,
          entityId: task2.truck.id,
          action: CHANGE_ACTION.UPDATE,
          userId,
          metadata: {
            operation: 'swap',
            swappedWith: task1.truck.id,
            oldPosition: truck2Position,
            newPosition: truck1Position,
          },
          transaction: tx,
        });
      }

      // Fetch updated tasks
      const updatedTask1 = await this.tasksRepository.findById(taskId1, include, tx);
      const updatedTask2 = await this.tasksRepository.findById(taskId2, include, tx);

      return {
        success: true,
        message: 'Posições dos caminhões trocadas com sucesso',
        data: {
          task1: updatedTask1,
          task2: updatedTask2,
        },
      };
    });
  }

  /**
   * Validate truck position within garage and lane constraints
   */
  private async validateTruckPosition(
    truckId: string,
    xPosition: number | null,
    yPosition: number | null,
    garageId: string,
    laneId: string | null,
    truck: any,
    tx: PrismaTransaction
  ): Promise<void> {
    // If position is null, it means truck is in virtual "Patio" garage
    if (xPosition === null || yPosition === null) {
      return;
    }

    // Fetch garage
    const garage = await tx.garage.findUnique({
      where: { id: garageId },
      include: { lanes: true },
    });

    if (!garage) {
      throw new NotFoundException(`Garagem ${garageId} não encontrada`);
    }

    // Calculate truck dimensions from layouts
    const truckWidth = this.calculateTruckWidth(truck);
    const truckLength = this.calculateTruckLength(truck);

    // Validate truck fits within garage dimensions
    if (xPosition + truckWidth > garage.width) {
      throw new BadRequestException(
        `Caminhão não cabe na garagem: largura do caminhão (${truckWidth}m) + posição X (${xPosition}m) excede largura da garagem (${garage.width}m)`
      );
    }

    if (yPosition + truckLength > garage.length) {
      throw new BadRequestException(
        `Caminhão não cabe na garagem: comprimento do caminhão (${truckLength}m) + posição Y (${yPosition}m) excede comprimento da garagem (${garage.length}m)`
      );
    }

    // Validate lane constraints if lane is specified
    if (laneId) {
      const lane = garage.lanes.find(l => l.id === laneId);
      if (!lane) {
        throw new BadRequestException(`Faixa ${laneId} não encontrada na garagem ${garageId}`);
      }

      // Check if truck fits within lane boundaries
      if (xPosition < lane.xPosition || xPosition + truckWidth > lane.xPosition + lane.width) {
        throw new BadRequestException(
          `Caminhão não cabe na faixa: posição horizontal fora dos limites da faixa`
        );
      }

      if (yPosition < lane.yPosition || yPosition + truckLength > lane.yPosition + lane.length) {
        throw new BadRequestException(
          `Caminhão não cabe na faixa: posição vertical fora dos limites da faixa`
        );
      }
    }

    // Check for overlapping trucks in the same garage
    const overlappingTrucks = await tx.truck.findMany({
      where: {
        garageId,
        id: { not: truckId },
        xPosition: { not: null },
        yPosition: { not: null },
      },
      include: {
        leftSideLayout: { include: { layoutSections: true } },
        rightSideLayout: { include: { layoutSections: true } },
        backSideLayout: { include: { layoutSections: true } },
      },
    });

    for (const otherTruck of overlappingTrucks) {
      const otherWidth = this.calculateTruckWidth(otherTruck);
      const otherLength = this.calculateTruckLength(otherTruck);

      const overlaps =
        xPosition < (otherTruck.xPosition || 0) + otherWidth &&
        xPosition + truckWidth > (otherTruck.xPosition || 0) &&
        yPosition < (otherTruck.yPosition || 0) + otherLength &&
        yPosition + truckLength > (otherTruck.yPosition || 0);

      if (overlaps) {
        throw new BadRequestException(
          `Posição conflita com outro caminhão na garagem`
        );
      }
    }
  }

  /**
   * Calculate truck width from layouts
   */
  private calculateTruckWidth(truck: any): number {
    // Width is typically from the side layouts (left or right)
    const leftWidth = truck.leftSideLayout?.layoutSections?.reduce(
      (sum: number, section: any) => sum + section.width,
      0
    ) || 0;

    const rightWidth = truck.rightSideLayout?.layoutSections?.reduce(
      (sum: number, section: any) => sum + section.width,
      0
    ) || 0;

    // Use the maximum width from available layouts, default to 2.5m if no layout
    return Math.max(leftWidth, rightWidth) || 2.5;
  }

  /**
   * Calculate truck length from layouts
   */
  private calculateTruckLength(truck: any): number {
    // Length is typically the height from layouts, use back layout as primary
    const backLength = truck.backSideLayout?.height || 0;
    const leftLength = truck.leftSideLayout?.height || 0;
    const rightLength = truck.rightSideLayout?.height || 0;

    // Use the maximum length from available layouts, default to 12.5m if no layout
    return Math.max(backLength, leftLength, rightLength) || 12.5;
  }
}
