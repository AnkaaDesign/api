import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  Inject,
} from '@nestjs/common';
import { EventEmitter } from 'events';
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
  translateFieldName,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  TASK_STATUS,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
  TRUCK_SPOT,
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
  TaskBulkPositionUpdateFormData,
} from '../../../schemas/task';
import {
  isValidTaskStatusTransition,
  getTaskStatusLabel,
  getTaskStatusOrder,
} from '../../../utils';
import { TaskCreatedEvent, TaskStatusChangedEvent, TaskFieldUpdatedEvent } from './task.events';
import { TaskFieldTrackerService } from './task-field-tracker.service';
import { TaskNotificationService } from '@modules/common/notification/task-notification.service';

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
    private readonly fieldTracker: TaskFieldTrackerService,
    private readonly taskNotificationService: TaskNotificationService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  /**
   * Create a new task with complete changelog tracking and file uploads
   */
  async create(
    data: TaskCreateFormData,
    include?: TaskInclude,
    userId?: string,
    files?: {
      budgets?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      receipts?: Express.Multer.File[];
      artworks?: Express.Multer.File[];
      cutFiles?: Express.Multer.File[];
      baseFiles?: Express.Multer.File[];
    },
  ): Promise<TaskCreateResponse> {
    try {
      // Check if this is a bulk create from serial number range
      const serialNumberFrom = (data as any).serialNumberFrom;
      const serialNumberTo = (data as any).serialNumberTo;

      if (serialNumberFrom !== undefined && serialNumberTo !== undefined) {
        // Bulk create multiple tasks with sequential serial numbers
        return this.createTasksFromSerialRange(
          data,
          serialNumberFrom,
          serialNumberTo,
          include,
          userId,
          files,
        );
      }

      // Create task within transaction with file uploads
      const task = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validate task data
        await this.validateTask(data, undefined, tx);

        // Process cut files BEFORE creating the task (so fileIds are available for cut creation)
        if (files?.cutFiles && files.cutFiles.length > 0 && data.cuts) {
          const customerName = data.customerId
            ? (
                await tx.customer.findUnique({
                  where: { id: data.customerId },
                  select: { fantasyName: true },
                })
              )?.fantasyName
            : undefined;

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
        // Add createdById to data for service orders creation
        const dataWithCreator = { ...data, createdById: userId } as typeof data;
        const newTask = await this.tasksRepository.createWithTransaction(tx, dataWithCreator, { include });

        // Create truck with layouts ONLY if layouts are provided
        // Note: Basic truck creation (plate, chassisNumber, spot) is handled by the repository
        const truckData = (data as any).truck;
        const hasLayouts =
          truckData &&
          (truckData.leftSideLayout || truckData.rightSideLayout || truckData.backSideLayout);
        if (hasLayouts) {
          this.logger.log(`[Task Create] Creating truck with layouts for task ${newTask.id}`);

          // Create truck with basic fields
          const truck = await tx.truck.create({
            data: {
              taskId: newTask.id,
              plate: truckData.plate || null,
              chassisNumber: truckData.chassisNumber || null,
              spot: truckData.spot || null,
            },
          });
          this.logger.log(`[Task Create] Truck created: ${truck.id}`);

          // Helper function to create layout for a side
          const createLayout = async (
            layoutData: any,
            layoutField: 'leftSideLayoutId' | 'rightSideLayoutId' | 'backSideLayoutId',
            sideName: string,
          ) => {
            if (!layoutData) return;

            this.logger.log(`[Task Create] Creating ${sideName} layout`);
            const layout = await tx.layout.create({
              data: {
                height: layoutData.height,
                ...(layoutData.photoId && {
                  photo: { connect: { id: layoutData.photoId } },
                }),
                layoutSections: {
                  create: layoutData.layoutSections.map((section, index) => ({
                    width: section.width,
                    isDoor: section.isDoor,
                    doorHeight: section.doorHeight,
                    position: section.position ?? index,
                  })),
                },
              },
              include: {
                layoutSections: true,
              },
            });
            await tx.truck.update({
              where: { id: truck.id },
              data: { [layoutField]: layout.id },
            });

            // Create changelog for layout creation
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.LAYOUT,
              entityId: layout.id,
              action: CHANGE_ACTION.CREATE,
              entity: layout,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              reason: `Layout ${layoutField} criado`,
              transaction: tx,
            });

            this.logger.log(`[Task Create] ${sideName} layout created: ${layout.id} with changelog`);
          };

          // Create layouts for each side using the new consolidated format
          await createLayout(truckData.leftSideLayout, 'leftSideLayoutId', 'left');
          await createLayout(truckData.rightSideLayout, 'rightSideLayoutId', 'right');
          await createLayout(truckData.backSideLayout, 'backSideLayoutId', 'back');

          // Update task with truck
          await tx.task.update({
            where: { id: newTask.id },
            data: { truck: { connect: { id: truck.id } } },
          });
          this.logger.log(`[Task Create] Task updated with truck`);
        }

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

          // Base files (files used as base for artwork design)
          if (files.baseFiles && files.baseFiles.length > 0) {
            const baseFileIds: string[] = [];
            for (const baseFile of files.baseFiles) {
              const baseFileRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                baseFile,
                'taskBaseFiles',
                userId,
                {
                  entityId: newTask.id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              baseFileIds.push(baseFileRecord.id);
            }
            fileUpdates.baseFiles = { connect: baseFileIds.map(id => ({ id })) };
          }

          // Airbrushing files - process files for each airbrushing
          const airbrushingFileFields = Object.keys(files).filter(key =>
            key.startsWith('airbrushings['),
          );
          if (airbrushingFileFields.length > 0 && newTask.airbrushings) {
            console.log(
              '[TaskService] Processing airbrushing files:',
              airbrushingFileFields.length,
              'fields',
            );

            for (const fieldName of airbrushingFileFields) {
              // Parse field name: airbrushings[0].receipts -> index: 0, type: receipts
              const match = fieldName.match(/airbrushings\[(\d+)\]\.(receipts|invoices|artworks)/);
              if (!match) continue;

              const index = parseInt(match[1], 10);
              const fileType = match[2] as 'receipts' | 'invoices' | 'artworks';
              const airbrushingFiles = (files as any)[fieldName] as Express.Multer.File[];

              if (!airbrushingFiles || airbrushingFiles.length === 0) continue;
              if (!newTask.airbrushings[index]) {
                console.warn(`[TaskService] Airbrushing at index ${index} not found`);
                continue;
              }

              const airbrushing = newTask.airbrushings[index];
              console.log(
                `[TaskService] Processing ${airbrushingFiles.length} ${fileType} for airbrushing ${index} (ID: ${airbrushing.id})`,
              );

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
                console.log(
                  `[TaskService] Connected ${fileIds.length} ${fileType} to airbrushing ${airbrushing.id}`,
                );
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

      // Emit task created event
      if (userId) {
        try {
          const createdByUser = await this.prisma.user.findUnique({
            where: { id: userId },
          });
          if (createdByUser) {
            this.eventEmitter.emit(
              'task.created',
              new TaskCreatedEvent(task as Task, createdByUser as any),
            );
          }
        } catch (error) {
          this.logger.error('Error emitting task created event:', error);
        }
      }

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
   * Create multiple tasks from a serial number range
   * Example: serialNumberFrom=1, serialNumberTo=5 creates tasks with serial numbers 1, 2, 3, 4, 5
   */
  private async createTasksFromSerialRange(
    data: TaskCreateFormData,
    serialNumberFrom: number,
    serialNumberTo: number,
    include?: TaskInclude,
    userId?: string,
    files?: {
      budgets?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      receipts?: Express.Multer.File[];
      artworks?: Express.Multer.File[];
      cutFiles?: Express.Multer.File[];
    },
  ): Promise<TaskCreateResponse> {
    // Calculate number of tasks to create
    const taskCount = serialNumberTo - serialNumberFrom + 1;

    if (taskCount > 100) {
      throw new BadRequestException(
        `O intervalo não pode exceder 100 tarefas (tentando criar ${taskCount} tarefas de ${serialNumberFrom} a ${serialNumberTo})`,
      );
    }

    this.logger.log(
      `Creating ${taskCount} tasks with serial numbers from ${serialNumberFrom} to ${serialNumberTo}`,
    );

    // Create task data for each serial number
    const tasks: TaskCreateFormData[] = [];
    for (let serialNum = serialNumberFrom; serialNum <= serialNumberTo; serialNum++) {
      const taskData = { ...data };
      // Remove the range fields and set the actual serial number
      delete (taskData as any).serialNumberFrom;
      delete (taskData as any).serialNumberTo;
      taskData.serialNumber = String(serialNum);
      tasks.push(taskData);
    }

    // Use the existing batchCreate logic
    const batchResult = await this.batchCreate({ tasks }, include, userId);

    // Return all created tasks in the response
    if (batchResult.success && batchResult.data.success.length > 0) {
      return {
        success: true,
        message: `${taskCount} tarefas criadas com sucesso com números de série de ${serialNumberFrom} a ${serialNumberTo}`,
        data: batchResult.data.success as any, // Array of tasks when creating from range
      };
    } else {
      throw new InternalServerErrorException(
        `Falha ao criar tarefas em lote: ${batchResult.data.failed.length} falharam`,
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
        // Process each task individually - "best effort" approach
        const successfulTasks: Task[] = [];
        const failedTasks: Array<{ index: number; error: string; data: any }> = [];

        for (const [index, task] of data.tasks.entries()) {
          try {
            // Validate task
            await this.validateTask(task, undefined, tx);

            // Create the task with createdById for service orders
            const taskWithCreator = { ...task, createdById: userId } as typeof task;
            const createdTask = await this.tasksRepository.createWithTransaction(tx, taskWithCreator, {
              include,
            });

            // Log successful task creation
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.TASK,
              entityId: createdTask.id,
              action: CHANGE_ACTION.CREATE,
              entity: extractEssentialFields(
                createdTask,
                getEssentialFields(ENTITY_TYPE.TASK) as (keyof Task)[],
              ),
              reason: 'Tarefa criada em operação de lote',
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              transaction: tx,
            });

            successfulTasks.push(createdTask);
          } catch (error) {
            // Collect validation/creation errors but continue processing
            const errorMessage =
              error instanceof BadRequestException || error instanceof NotFoundException
                ? error.message
                : 'Erro desconhecido ao criar tarefa';

            failedTasks.push({
              index,
              error: errorMessage,
              data: task,
            });
          }
        }

        return {
          success: successfulTasks,
          failed: failedTasks,
          totalCreated: successfulTasks.length,
          totalFailed: failedTasks.length,
        };
      });

      // Emit task.created events for all successfully created tasks (outside transaction)
      if (userId && result.success.length > 0) {
        try {
          const createdByUser = await this.prisma.user.findUnique({
            where: { id: userId },
          });
          if (createdByUser) {
            for (const task of result.success) {
              this.eventEmitter.emit(
                'task.created',
                new TaskCreatedEvent(task as Task, createdByUser as any),
              );
            }
            this.logger.log(
              `Emitted ${result.success.length} task.created events for batch creation`,
            );
          }
        } catch (error) {
          this.logger.error('Error emitting task.created events for batch creation:', error);
        }
      }

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
      budgets?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      receipts?: Express.Multer.File[];
      artworks?: Express.Multer.File[];
      cutFiles?: Express.Multer.File[];
      observationFiles?: Express.Multer.File[];
      baseFiles?: Express.Multer.File[];
    },
  ): Promise<TaskUpdateResponse> {
    try {
      const transactionResult = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get existing task - always include customer for file organization
        // Also include file relations for changelog tracking
        const existingTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
          include: {
            ...include,
            customer: true, // Always include customer for file path organization
            artworks: true, // Include for changelog tracking
            observation: { include: { files: true } }, // Include for changelog tracking
            truck: true, // Include for truck field changelog tracking
          },
        });

        if (!existingTask) {
          throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
        }

        // Field-level access control for FINANCIAL sector
        if (userPrivilege === 'FINANCIAL') {
          this.validateFinancialSectorAccess(data);
        }

        // Field-level access control for COMMERCIAL sector
        if (userPrivilege === 'COMMERCIAL') {
          this.validateCommercialSectorAccess(data);
        }

        // Validate task data
        await this.validateTask(data, id, tx);

        // Handle truck and layout updates (consolidated in single truck object)
        const truckData = (data as any).truck;
        if (truckData !== undefined) {
          if (truckData === null) {
            // Delete truck if explicitly set to null
            if (existingTask.truck) {
              this.logger.log(`[Task Update] Deleting truck for task ${id}`);
              // Layouts will be cascade deleted if configured, otherwise delete manually
              const truck = existingTask.truck;

              // Delete layouts and create changelogs
              if (truck.leftSideLayoutId) {
                const layoutToDelete = await tx.layout.findUnique({
                  where: { id: truck.leftSideLayoutId },
                  include: { layoutSections: true },
                });
                await tx.layoutSection.deleteMany({ where: { layoutId: truck.leftSideLayoutId } });
                await tx.layout.delete({ where: { id: truck.leftSideLayoutId } });

                if (layoutToDelete) {
                  await logEntityChange({
                    changeLogService: this.changeLogService,
                    entityType: ENTITY_TYPE.LAYOUT,
                    entityId: truck.leftSideLayoutId,
                    action: CHANGE_ACTION.DELETE,
                    entity: layoutToDelete,
                    userId: userId || '',
                    triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                    reason: 'Layout leftSideLayoutId removido (caminhão deletado)',
                    transaction: tx,
                  });
                }
              }
              if (truck.rightSideLayoutId) {
                const layoutToDelete = await tx.layout.findUnique({
                  where: { id: truck.rightSideLayoutId },
                  include: { layoutSections: true },
                });
                await tx.layoutSection.deleteMany({ where: { layoutId: truck.rightSideLayoutId } });
                await tx.layout.delete({ where: { id: truck.rightSideLayoutId } });

                if (layoutToDelete) {
                  await logEntityChange({
                    changeLogService: this.changeLogService,
                    entityType: ENTITY_TYPE.LAYOUT,
                    entityId: truck.rightSideLayoutId,
                    action: CHANGE_ACTION.DELETE,
                    entity: layoutToDelete,
                    userId: userId || '',
                    triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                    reason: 'Layout rightSideLayoutId removido (caminhão deletado)',
                    transaction: tx,
                  });
                }
              }
              if (truck.backSideLayoutId) {
                const layoutToDelete = await tx.layout.findUnique({
                  where: { id: truck.backSideLayoutId },
                  include: { layoutSections: true },
                });
                await tx.layoutSection.deleteMany({ where: { layoutId: truck.backSideLayoutId } });
                await tx.layout.delete({ where: { id: truck.backSideLayoutId } });

                if (layoutToDelete) {
                  await logEntityChange({
                    changeLogService: this.changeLogService,
                    entityType: ENTITY_TYPE.LAYOUT,
                    entityId: truck.backSideLayoutId,
                    action: CHANGE_ACTION.DELETE,
                    entity: layoutToDelete,
                    userId: userId || '',
                    triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                    reason: 'Layout backSideLayoutId removido (caminhão deletado)',
                    transaction: tx,
                  });
                }
              }

              // Delete truck and create changelog
              await tx.truck.delete({ where: { id: truck.id } });

              await logEntityChange({
                changeLogService: this.changeLogService,
                entityType: ENTITY_TYPE.TRUCK,
                entityId: truck.id,
                action: CHANGE_ACTION.DELETE,
                entity: truck,
                userId: userId || '',
                triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                reason: 'Caminhão removido da tarefa',
                transaction: tx,
              });

              this.logger.log(`[Task Update] Deleted truck ${truck.id} with changelog`);
            }
          } else {
            // Create or update truck
            let truckId = existingTask.truck?.id;
            const existingTruck = existingTask.truck;

            if (!truckId) {
              // Create new truck
              this.logger.log(`[Task Update] Creating truck for task ${id}`);
              const newTruck = await tx.truck.create({
                data: {
                  taskId: id,
                  plate: truckData.plate || null,
                  chassisNumber: truckData.chassisNumber || null,
                  spot: truckData.spot || null,
                },
              });
              truckId = newTruck.id;

              // Create changelog for truck creation
              await logEntityChange({
                changeLogService: this.changeLogService,
                entityType: ENTITY_TYPE.TRUCK,
                entityId: newTruck.id,
                action: CHANGE_ACTION.CREATE,
                entity: newTruck,
                userId: userId || '',
                triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                reason: 'Caminhão criado via atualização de tarefa',
                transaction: tx,
              });

              this.logger.log(`[Task Update] Created truck ${newTruck.id} with changelog`);
            } else {
              // Update existing truck basic fields
              const updateFields: any = {};
              if (truckData.plate !== undefined) updateFields.plate = truckData.plate;
              if (truckData.chassisNumber !== undefined)
                updateFields.chassisNumber = truckData.chassisNumber;
              if (truckData.spot !== undefined) updateFields.spot = truckData.spot;

              if (Object.keys(updateFields).length > 0) {
                const updatedTruck = await tx.truck.update({ where: { id: truckId }, data: updateFields });
                this.logger.log(`[Task Update] Truck basic fields updated`);

                // Create changelog for each changed field
                for (const [field, newValue] of Object.entries(updateFields)) {
                  const oldValue = (existingTruck as any)?.[field];
                  if (oldValue !== newValue) {
                    await logEntityChange({
                      changeLogService: this.changeLogService,
                      entityType: ENTITY_TYPE.TRUCK,
                      entityId: truckId,
                      action: CHANGE_ACTION.UPDATE,
                      entity: updatedTruck,
                      userId: userId || '',
                      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                      reason: `Campo ${field} atualizado`,
                      field,
                      oldValue,
                      newValue,
                      transaction: tx,
                    });
                  }
                }

                this.logger.log(`[Task Update] Truck field changes logged to changelog`);
              }
            }

            // Handle layouts - helper function to process each side
            const processLayout = async (
              layoutData: any,
              existingLayoutId: string | null,
              layoutField: 'leftSideLayoutId' | 'rightSideLayoutId' | 'backSideLayoutId',
            ) => {
              if (layoutData === undefined) return; // Not in payload, skip

              if (layoutData === null) {
                // Delete existing layout
                if (existingLayoutId) {
                  this.logger.log(`[Task Update] Deleting ${layoutField}`);

                  // Get layout details before deletion for changelog
                  const layoutToDelete = await tx.layout.findUnique({
                    where: { id: existingLayoutId },
                    include: { layoutSections: true },
                  });

                  await tx.layoutSection.deleteMany({ where: { layoutId: existingLayoutId } });
                  await tx.layout.delete({ where: { id: existingLayoutId } });
                  await tx.truck.update({ where: { id: truckId! }, data: { [layoutField]: null } });

                  // Create changelog for layout deletion
                  if (layoutToDelete) {
                    await logEntityChange({
                      changeLogService: this.changeLogService,
                      entityType: ENTITY_TYPE.LAYOUT,
                      entityId: existingLayoutId,
                      action: CHANGE_ACTION.DELETE,
                      entity: layoutToDelete,
                      userId: userId || '',
                      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                      reason: `Layout ${layoutField} removido`,
                      transaction: tx,
                    });
                  }

                  this.logger.log(`[Task Update] Deleted ${layoutField} with changelog`);
                }
              } else {
                // Create or update layout
                let layoutToDelete = null;
                if (existingLayoutId) {
                  // Get layout details before deletion for changelog
                  layoutToDelete = await tx.layout.findUnique({
                    where: { id: existingLayoutId },
                    include: { layoutSections: true },
                  });

                  // Delete existing and recreate (simpler than complex update)
                  await tx.layoutSection.deleteMany({ where: { layoutId: existingLayoutId } });
                  await tx.layout.delete({ where: { id: existingLayoutId } });

                  // Create changelog for layout deletion (as part of update)
                  if (layoutToDelete) {
                    await logEntityChange({
                      changeLogService: this.changeLogService,
                      entityType: ENTITY_TYPE.LAYOUT,
                      entityId: existingLayoutId,
                      action: CHANGE_ACTION.DELETE,
                      entity: layoutToDelete,
                      userId: userId || '',
                      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                      reason: `Layout ${layoutField} atualizado (removido antigo)`,
                      transaction: tx,
                    });
                  }
                }

                const newLayout = await tx.layout.create({
                  data: {
                    height: layoutData.height,
                    ...(layoutData.photoId && { photo: { connect: { id: layoutData.photoId } } }),
                    layoutSections: {
                      create: layoutData.layoutSections.map((section: any, index: number) => ({
                        width: section.width,
                        isDoor: section.isDoor,
                        doorHeight: section.doorHeight,
                        position: section.position ?? index,
                      })),
                    },
                  },
                  include: {
                    layoutSections: true,
                  },
                });
                await tx.truck.update({
                  where: { id: truckId! },
                  data: { [layoutField]: newLayout.id },
                });

                // Create changelog for new layout creation
                await logEntityChange({
                  changeLogService: this.changeLogService,
                  entityType: ENTITY_TYPE.LAYOUT,
                  entityId: newLayout.id,
                  action: CHANGE_ACTION.CREATE,
                  entity: newLayout,
                  userId: userId || '',
                  triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                  reason: `Layout ${layoutField} ${layoutToDelete ? 'atualizado (novo criado)' : 'criado'}`,
                  transaction: tx,
                });

                this.logger.log(`[Task Update] ${layoutField} created: ${newLayout.id} with changelog`);
              }
            };

            // Process each layout side
            await processLayout(
              truckData.leftSideLayout,
              existingTruck?.leftSideLayoutId || null,
              'leftSideLayoutId',
            );
            await processLayout(
              truckData.rightSideLayout,
              existingTruck?.rightSideLayoutId || null,
              'rightSideLayoutId',
            );
            await processLayout(
              truckData.backSideLayout,
              existingTruck?.backSideLayoutId || null,
              'backSideLayoutId',
            );

            // Handle layout photo uploads
            if (files) {
              const customerName = existingTask.customer?.fantasyName;
              const layoutPhotoKeys = Object.keys(files).filter(k => k.startsWith('layoutPhotos.'));

              for (const key of layoutPhotoKeys) {
                const side = key.replace('layoutPhotos.', '') as
                  | 'leftSide'
                  | 'rightSide'
                  | 'backSide';
                const photoFile = Array.isArray((files as any)[key])
                  ? (files as any)[key][0]
                  : (files as any)[key];

                if (photoFile) {
                  const uploadedPhoto = await this.fileService.createFromUploadWithTransaction(
                    tx,
                    photoFile,
                    'layoutPhotos',
                    userId,
                    { entityId: id, entityType: 'LAYOUT', customerName },
                  );

                  const layoutFieldMap = {
                    leftSide: 'leftSideLayoutId',
                    rightSide: 'rightSideLayoutId',
                    backSide: 'backSideLayoutId',
                  } as const;

                  const layoutId = await tx.truck
                    .findUnique({
                      where: { id: truckId },
                      select: { [layoutFieldMap[side]]: true },
                    })
                    .then(t => t?.[layoutFieldMap[side]]);

                  if (layoutId) {
                    await tx.layout.update({
                      where: { id: layoutId },
                      data: { photoId: uploadedPhoto.id },
                    });
                  }
                }
              }
            }
          }

          // After processing layouts in service, remove layout fields from truck data
          // so the repository doesn't try to process them again
          if (truckData) {
            delete truckData.leftSideLayout;
            delete truckData.rightSideLayout;
            delete truckData.backSideLayout;
          }
        }

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
          const customerName =
            existingTask.customer?.fantasyName ||
            (data.customerId
              ? (
                  await tx.customer.findUnique({
                    where: { id: data.customerId },
                    select: { fantasyName: true },
                  })
                )?.fantasyName
              : undefined);

          // Upload each unique file once and store the file records
          const uploadedFileRecords = [];
          for (const cutFile of files.cutFiles) {
            const fileRecord = await this.fileService.createFromUploadWithTransaction(
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
            uploadedFileRecords.push(fileRecord);
          }

          // Assign fileIds to cuts based on _fileIndex (if present) or sequential index (backward compat)
          data.cuts.forEach((cut, index) => {
            const fileIndex = cut._fileIndex !== undefined ? cut._fileIndex : index;
            if (fileIndex < uploadedFileRecords.length) {
              cut.fileId = uploadedFileRecords[fileIndex].id;
            }
            // Clean up the temporary _fileIndex field
            delete cut._fileIndex;
          });
        }

        // Process observation files BEFORE task update (to replace temporary IDs with real UUIDs)
        if (files?.observationFiles && files.observationFiles.length > 0 && data.observation) {
          console.log(
            '[TaskService] Processing observation files BEFORE task update:',
            files.observationFiles.length,
          );
          const customerName = existingTask.customer?.fantasyName;

          // Get existing observation file IDs (only real UUIDs, not temporary IDs)
          const existingFileIds =
            data.observation.fileIds?.filter(id =>
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
            ) || [];
          console.log('[TaskService] Existing valid file IDs:', existingFileIds);

          const newFileIds: string[] = [...existingFileIds];

          // Upload each observation file
          for (const observationFile of files.observationFiles) {
            const fileRecord = await this.fileService.createFromUploadWithTransaction(
              tx,
              observationFile,
              'observations',
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
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
          );
          console.log(
            '[TaskService] Filtered observation.fileIds (no new files):',
            data.observation.fileIds,
          );
        }

        // Extract service orders from data to handle them explicitly
        // This prevents Prisma from doing a silent nested create without events/changelogs
        const serviceOrdersData = (data as any).serviceOrders;
        let createdServiceOrders: any[] = [];

        // Ensure statusOrder is updated when status changes
        const updateData = {
          ...data,
          ...(data.status && { statusOrder: getTaskStatusOrder(data.status as TASK_STATUS) }),
        };

        // Remove service orders from updateData to prevent Prisma nested create
        // We'll handle them explicitly below
        delete (updateData as any).serviceOrders;

        // Update the task - always include customer for file organization
        // Also include file relations for changelog tracking
        let updatedTask = await this.tasksRepository.updateWithTransaction(tx, id, updateData, {
          include: {
            ...include,
            customer: true, // Always include customer for file path organization
            artworks: true, // Include for changelog tracking
            observation: { include: { files: true } }, // Include for changelog tracking
            truck: true, // Include for truck field changelog tracking
          },
        }, userId);

        // Handle service orders explicitly if provided
        if (serviceOrdersData && Array.isArray(serviceOrdersData) && serviceOrdersData.length > 0) {
          this.logger.log(`[Task Update] Processing ${serviceOrdersData.length} service orders for task ${id}`);

          for (const serviceOrderData of serviceOrdersData) {
            // Create the service order
            const createdServiceOrder = await tx.serviceOrder.create({
              data: {
                taskId: id,
                type: serviceOrderData.type,
                status: serviceOrderData.status || 'PENDING',
                description: serviceOrderData.description || null,
                assignedToId: serviceOrderData.assignedToId || null,
                createdById: userId || '',
              },
            });

            createdServiceOrders.push(createdServiceOrder);

            // Create changelog for service order creation
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.SERVICE_ORDER,
              entityId: createdServiceOrder.id,
              action: CHANGE_ACTION.CREATE,
              entity: createdServiceOrder,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              reason: 'Ordem de serviço criada via atualização de tarefa',
              transaction: tx,
            });

            this.logger.log(`[Task Update] Created service order ${createdServiceOrder.id} (${createdServiceOrder.type})`);
          }
        }

        // Process and save files WITHIN the transaction
        // This ensures files are only created if the task update succeeds
        if (files) {
          const fileUpdates: any = {};
          const customerName =
            updatedTask.customer?.fantasyName || existingTask.customer?.fantasyName;

          this.logger.log(
            `[Task Update] Processing files with customer name: "${customerName}" (from updatedTask: ${!!updatedTask.customer?.fantasyName}, from existingTask: ${!!existingTask.customer?.fantasyName})`,
          );

          // Budget files (multiple)
          // Process if new files are being uploaded OR if budgetIds is explicitly provided (for deletions)
          if ((files.budgets && files.budgets.length > 0) || data.budgetIds !== undefined) {
            // Start with the budgetIds provided in the form data (files that should be kept)
            // If not provided, default to empty array (will only have the new uploads)
            const budgetIds: string[] = data.budgetIds ? [...data.budgetIds] : [];

            // Upload new files and add their IDs
            if (files.budgets && files.budgets.length > 0) {
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
            }

            // CRITICAL FIX: Use 'set' instead of 'connect' to REPLACE files instead of adding to them
            fileUpdates.budgets = { set: budgetIds.map(id => ({ id })) };
            this.logger.log(
              `[Task Update] Setting budgets to ${budgetIds.length} files (${data.budgetIds?.length || 0} existing + ${files.budgets?.length || 0} new)`,
            );
          }

          // NFe files (multiple)
          // Process if new files are being uploaded OR if invoiceIds is explicitly provided (for deletions)
          if ((files.invoices && files.invoices.length > 0) || data.invoiceIds !== undefined) {
            // Start with the invoiceIds provided in the form data (files that should be kept)
            // If not provided, default to empty array (will only have the new uploads)
            const invoiceIds: string[] = data.invoiceIds ? [...data.invoiceIds] : [];

            // Upload new files and add their IDs
            if (files.invoices && files.invoices.length > 0) {
              for (const invoiceFile of files.invoices) {
                const invoiceRecord = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  invoiceFile,
                  'taskInvoices',
                  userId,
                  {
                    entityId: id,
                    entityType: 'TASK',
                    customerName,
                  },
                );
                invoiceIds.push(invoiceRecord.id);
              }
            }

            // CRITICAL FIX: Use 'set' instead of 'connect' to REPLACE files instead of adding to them
            fileUpdates.invoices = { set: invoiceIds.map(id => ({ id })) };
            this.logger.log(
              `[Task Update] Setting invoices to ${invoiceIds.length} files (${data.invoiceIds?.length || 0} existing + ${files.invoices?.length || 0} new)`,
            );
          }

          // Receipt files (multiple)
          // Process if new files are being uploaded OR if receiptIds is explicitly provided (for deletions)
          if ((files.receipts && files.receipts.length > 0) || data.receiptIds !== undefined) {
            // Start with the receiptIds provided in the form data (files that should be kept)
            // If not provided, default to empty array (will only have the new uploads)
            const receiptIds: string[] = data.receiptIds ? [...data.receiptIds] : [];

            // Upload new files and add their IDs
            if (files.receipts && files.receipts.length > 0) {
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
            }

            // CRITICAL FIX: Use 'set' instead of 'connect' to REPLACE files instead of adding to them
            fileUpdates.receipts = { set: receiptIds.map(id => ({ id })) };
            this.logger.log(
              `[Task Update] Setting receipts to ${receiptIds.length} files (${data.receiptIds?.length || 0} existing + ${files.receipts?.length || 0} new)`,
            );
          }

          // Artwork files
          // Process if new files are being uploaded OR if artworkIds/fileIds is explicitly provided (for deletions)
          // Note: The schema transforms artworkIds to fileIds, so we check both
          const artworkIdsFromRequest = (data as any).artworkIds || (data as any).fileIds;
          if (
            (files.artworks && files.artworks.length > 0) ||
            artworkIdsFromRequest !== undefined
          ) {
            // Start with the artworkIds provided in the form data (files that should be kept)
            // If not provided, default to empty array (will only have the new uploads)
            const artworkIds: string[] = artworkIdsFromRequest ? [...artworkIdsFromRequest] : [];
            this.logger.log(
              `[Task Update] Processing artworks - Received ${artworkIdsFromRequest?.length || 0} existing IDs: [${artworkIdsFromRequest?.join(', ') || 'none'}]`,
            );

            // Upload new files and add their IDs
            if (files.artworks && files.artworks.length > 0) {
              this.logger.log(`[Task Update] Uploading ${files.artworks.length} new artwork files`);
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
                this.logger.log(
                  `[Task Update] Created new artwork file with ID: ${artworkRecord.id}`,
                );
                artworkIds.push(artworkRecord.id);
              }
            }

            // CRITICAL FIX: Use 'set' instead of 'connect' to REPLACE files instead of adding to them
            // This ensures removed files are actually removed from the relationship
            this.logger.log(
              `[Task Update] Final artworkIds array (${artworkIds.length} total): [${artworkIds.join(', ')}]`,
            );
            fileUpdates.artworks = { set: artworkIds.map(id => ({ id })) };
            this.logger.log(
              `[Task Update] Setting artworks to ${artworkIds.length} files (${artworkIdsFromRequest?.length || 0} existing + ${files.artworks?.length || 0} new)`,
            );
          }

          // Base files (files used as base for artwork design)
          // Process if new files are being uploaded OR if baseFileIds is explicitly provided (for deletions)
          if ((files.baseFiles && files.baseFiles.length > 0) || data.baseFileIds !== undefined) {
            // Start with the baseFileIds provided in the form data (files that should be kept)
            // If not provided, default to empty array (will only have the new uploads)
            const baseFileIds: string[] = data.baseFileIds ? [...data.baseFileIds] : [];
            this.logger.log(
              `[Task Update] Processing baseFiles - Received ${data.baseFileIds?.length || 0} existing IDs: [${data.baseFileIds?.join(', ') || 'none'}]`,
            );

            // Upload new files and add their IDs
            if (files.baseFiles && files.baseFiles.length > 0) {
              this.logger.log(`[Task Update] Uploading ${files.baseFiles.length} new base files`);
              for (const baseFile of files.baseFiles) {
                const baseFileRecord = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  baseFile,
                  'taskBaseFiles',
                  userId,
                  {
                    entityId: id,
                    entityType: 'TASK',
                    customerName,
                  },
                );
                this.logger.log(
                  `[Task Update] Created new base file with ID: ${baseFileRecord.id}`,
                );
                baseFileIds.push(baseFileRecord.id);
              }
            }

            // Use 'set' instead of 'connect' to REPLACE files instead of adding to them
            this.logger.log(
              `[Task Update] Final baseFileIds array (${baseFileIds.length} total): [${baseFileIds.join(', ')}]`,
            );
            fileUpdates.baseFiles = { set: baseFileIds.map(id => ({ id })) };
            this.logger.log(
              `[Task Update] Setting baseFiles to ${baseFileIds.length} files (${data.baseFileIds?.length || 0} existing + ${files.baseFiles?.length || 0} new)`,
            );
          }

          // Logo paints (paintIds) - no file upload, just relation management
          if (data.paintIds !== undefined) {
            fileUpdates.logoPaints = { set: data.paintIds.map(id => ({ id })) };
            this.logger.log(`[Task Update] Setting logo paints to ${data.paintIds.length} paints`);
          }

          // Airbrushing files - process files for each airbrushing
          const airbrushingFileFields = Object.keys(files).filter(key =>
            key.startsWith('airbrushings['),
          );
          if (airbrushingFileFields.length > 0 && updatedTask?.airbrushings) {
            console.log(
              '[TaskService.update] Processing airbrushing files:',
              airbrushingFileFields.length,
              'fields',
            );

            for (const fieldName of airbrushingFileFields) {
              // Parse field name: airbrushings[0].receipts -> index: 0, type: receipts
              const match = fieldName.match(/airbrushings\[(\d+)\]\.(receipts|invoices|artworks)/);
              if (!match) continue;

              const index = parseInt(match[1], 10);
              const fileType = match[2] as 'receipts' | 'invoices' | 'artworks';
              const airbrushingFiles = (files as any)[fieldName] as Express.Multer.File[];

              if (!airbrushingFiles || airbrushingFiles.length === 0) continue;
              if (!updatedTask.airbrushings[index]) {
                console.warn(`[TaskService.update] Airbrushing at index ${index} not found`);
                continue;
              }

              const airbrushing = updatedTask.airbrushings[index];
              console.log(
                `[TaskService.update] Processing ${airbrushingFiles.length} ${fileType} for airbrushing ${index} (ID: ${airbrushing.id})`,
              );

              // Get existing file IDs from the form data for this airbrushing
              // The form should include the IDs of files that should be kept
              const airbrushingData = (data as any).airbrushings?.[index];
              const fileIdKey = `${fileType === 'invoices' ? 'invoiceIds' : fileType === 'receipts' ? 'receiptIds' : 'artworkIds'}`;
              const existingFileIds = airbrushingData?.[fileIdKey] || [];

              // Start with existing files from form data
              const fileIds: string[] = [...existingFileIds];

              // Upload new files and add their IDs
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

              // CRITICAL FIX: Use 'set' instead of 'connect' to REPLACE files instead of adding to them
              if (fileIds.length > 0) {
                await tx.airbrushing.update({
                  where: { id: airbrushing.id },
                  data: {
                    [fileType]: { set: fileIds.map(id => ({ id })) },
                  },
                });
                console.log(
                  `[TaskService.update] Set ${fileIds.length} ${fileType} for airbrushing ${airbrushing.id} (${existingFileIds.length} existing + ${airbrushingFiles.length} new)`,
                );
              }
            }
          }

          // NOTE: Observation files are processed BEFORE the first task update
          // (see lines 462-501) to avoid Prisma errors with temporary file IDs

          // Update task with file IDs if any files were uploaded
          if (Object.keys(fileUpdates).length > 0) {
            updatedTask = (await tx.task.update({
              where: { id },
              data: fileUpdates,
              include: {
                ...include,
                artworks: true, // Include for changelog tracking
                observation: { include: { files: true } }, // Include for changelog tracking
                truck: true, // Include for truck field changelog tracking
              },
            })) as any;
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
          'term',
          'entryDate',
          'priority',
          'bonusDiscountId',
          // statusOrder removed - it's auto-calculated from status, creating redundant changelog entries
          'createdById',
          // Note: chassisNumber and plate are now on Truck entity, not Task
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

        // Emit field update events for important fields
        if (userId) {
          try {
            const updatedByUser = await tx.user.findUnique({
              where: { id: userId },
            });
            if (updatedByUser) {
              // Check for status change
              if (existingTask.status !== updatedTask.status) {
                // Ensure task has a name before emitting event
                // If name is null/undefined, reload the task to get it
                if (!updatedTask.name) {
                  this.logger.warn(
                    `[Task Update] Task ${id} has null/undefined name, reloading task data...`,
                  );
                  const taskWithName = await tx.task.findUnique({
                    where: { id },
                    select: {
                      id: true,
                      name: true,
                      serialNumber: true,
                      status: true,
                    },
                  });
                  if (taskWithName && taskWithName.name) {
                    updatedTask.name = taskWithName.name;
                    this.logger.log(`[Task Update] Task name reloaded: "${taskWithName.name}"`);
                  } else {
                    // If still no name, use a default
                    updatedTask.name = updatedTask.serialNumber
                      ? `Tarefa ${updatedTask.serialNumber}`
                      : 'Tarefa sem nome';
                    this.logger.warn(
                      `[Task Update] Task ${id} has no name in database, using default: "${updatedTask.name}"`,
                    );
                  }
                }

                this.eventEmitter.emit(
                  'task.status.changed',
                  new TaskStatusChangedEvent(
                    updatedTask as Task,
                    existingTask.status,
                    updatedTask.status,
                    updatedByUser as any,
                  ),
                );
              }

              // Emit events for other important field changes
              const importantFields = ['term', 'forecastDate', 'sectorId', 'priority', 'details'];

              for (const field of importantFields) {
                if (
                  hasValueChanged(
                    existingTask[field as keyof typeof existingTask],
                    updatedTask[field as keyof typeof updatedTask],
                  )
                ) {
                  this.eventEmitter.emit(
                    'task.field.updated',
                    new TaskFieldUpdatedEvent(
                      updatedTask as Task,
                      field,
                      existingTask[field as keyof typeof existingTask],
                      updatedTask[field as keyof typeof updatedTask],
                      updatedByUser as any,
                    ),
                  );
                }
              }
            }

            // Track field changes with the field tracker service
            try {
              const fieldChanges = await this.fieldTracker.trackChanges(
                id,
                existingTask as Task,
                updatedTask as Task,
                userId,
              );

              if (fieldChanges.length > 0) {
                // Store field changes in database
                for (const change of fieldChanges) {
                  const isFileArray = [
                    'artworks',
                    'budgets',
                    'invoices',
                    'receipts',
                    'reimbursements',
                    'invoiceReimbursements',
                  ].includes(change.field);
                  let filesAdded = 0;
                  let filesRemoved = 0;
                  let metadata: any = null;

                  if (isFileArray) {
                    const fileChange = this.fieldTracker.analyzeFileArrayChange(
                      change.oldValue || [],
                      change.newValue || [],
                    );
                    filesAdded = fileChange.added;
                    filesRemoved = fileChange.removed;
                    metadata = {
                      addedFiles: fileChange.addedFiles?.map(f => ({
                        id: f.id,
                        filename: f.filename,
                      })),
                      removedFiles: fileChange.removedFiles?.map(f => ({
                        id: f.id,
                        filename: f.filename,
                      })),
                    };
                  }

                  await tx.taskFieldChangeLog.create({
                    data: {
                      taskId: id,
                      field: change.field,
                      oldValue: change.oldValue,
                      newValue: change.newValue,
                      changedBy: userId,
                      changedAt: change.changedAt,
                      isFileArray,
                      filesAdded,
                      filesRemoved,
                      metadata,
                    },
                  });
                }

                // Emit field change events
                await this.fieldTracker.emitFieldChangeEvents(
                  updatedTask as Task,
                  fieldChanges,
                  existingTask as Task,
                );

                // Track changes using TaskNotificationService for granular field-level notifications
                try {
                  const taskChanges = this.taskNotificationService.trackTaskChanges(
                    existingTask as Task,
                    updatedTask as Task,
                  );

                  if (taskChanges.length > 0) {
                    this.logger.log(
                      `Detected ${taskChanges.length} field changes for notification tracking`,
                    );

                    // Get target users for notifications: sector manager + admins
                    const targetUsers = await this.getTargetUsersForNotification(
                      updatedTask,
                      tx,
                    );

                    // Create notifications for each target user
                    for (const targetUserId of targetUsers) {
                      // Skip notifying the user who made the change
                      if (targetUserId === userId) continue;

                      await this.taskNotificationService.createFieldChangeNotifications(
                        updatedTask as Task,
                        taskChanges,
                        targetUserId,
                        userId,
                      );
                    }
                  }
                } catch (notificationError) {
                  this.logger.error('Error creating task field notifications:', notificationError);
                }
              }
            } catch (error) {
              this.logger.error('Error tracking field changes:', error);
            }
          } catch (error) {
            this.logger.error('Error emitting task update events:', error);
          }
        }

        // Track services array changes
        if (data.serviceOrders !== undefined) {
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
        // Note: The schema transforms artworkIds to fileIds, so we check both
        const artworkIdsForChangelog = (data as any).artworkIds || (data as any).fileIds;
        if (artworkIdsForChangelog) {
          const oldArtworks = existingTask.artworks || [];
          const newArtworks = updatedTask?.artworks || [];

          const oldArtworkIds = oldArtworks.map((f: any) => f.id);
          const newArtworkIds = newArtworks.map((f: any) => f.id);

          const addedArtworks = newArtworks.filter((f: any) => !oldArtworkIds.includes(f.id));
          const removedArtworks = oldArtworks.filter((f: any) => !newArtworkIds.includes(f.id));

          // Log artwork changes with proper before/after values
          if (addedArtworks.length > 0 || removedArtworks.length > 0) {
            const changeDescription = [];
            if (addedArtworks.length > 0) {
              changeDescription.push(`${addedArtworks.length} arte(s) adicionada(s)`);
            }
            if (removedArtworks.length > 0) {
              changeDescription.push(`${removedArtworks.length} arte(s) removida(s)`);
            }

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'artworks',
              oldValue: oldArtworks.length > 0 ? oldArtworks : null,
              newValue: newArtworks.length > 0 ? newArtworks : null,
              reason: changeDescription.join(', '),
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        // Track baseFiles array changes
        if (data.baseFileIds !== undefined) {
          const oldBaseFiles = existingTask.baseFiles || [];
          const newBaseFiles = updatedTask?.baseFiles || [];

          const oldBaseFileIds = oldBaseFiles.map((f: any) => f.id);
          const newBaseFileIds = newBaseFiles.map((f: any) => f.id);

          const addedBaseFiles = newBaseFiles.filter((f: any) => !oldBaseFileIds.includes(f.id));
          const removedBaseFiles = oldBaseFiles.filter((f: any) => !newBaseFileIds.includes(f.id));

          // Log baseFiles changes with proper before/after values
          if (addedBaseFiles.length > 0 || removedBaseFiles.length > 0) {
            const changeDescription = [];
            if (addedBaseFiles.length > 0) {
              changeDescription.push(`${addedBaseFiles.length} arquivo(s) base adicionado(s)`);
            }
            if (removedBaseFiles.length > 0) {
              changeDescription.push(`${removedBaseFiles.length} arquivo(s) base removido(s)`);
            }

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'baseFiles',
              oldValue: oldBaseFiles.length > 0 ? oldBaseFiles : null,
              newValue: newBaseFiles.length > 0 ? newBaseFiles : null,
              reason: changeDescription.join(', '),
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        // Track logoPaints array changes (paintIds)
        if (data.paintIds !== undefined) {
          const oldPaintIds = existingTask.logoPaints?.map((p: any) => p.id) || [];
          const newPaintIds = data.paintIds || [];

          const addedPaintIds = newPaintIds.filter((id: string) => !oldPaintIds.includes(id));
          const removedPaintIds = oldPaintIds.filter((id: string) => !newPaintIds.includes(id));

          // Only log if there are actual changes
          if (addedPaintIds.length > 0 || removedPaintIds.length > 0) {
            // Create a single log entry showing complete before/after state
            const changeReasons = [];
            if (addedPaintIds.length > 0) {
              changeReasons.push(`${addedPaintIds.length} tinta(s) adicionada(s)`);
            }
            if (removedPaintIds.length > 0) {
              changeReasons.push(`${removedPaintIds.length} tinta(s) removida(s)`);
            }

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'logoPaints',
              oldValue: oldPaintIds.length > 0 ? oldPaintIds : null,
              newValue: newPaintIds.length > 0 ? newPaintIds : null,
              reason: changeReasons.join(', '),
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
                  status: c.status,
                  ...(c.reason && { reason: c.reason }),
                  ...(c.parentCutId && { parentCutId: c.parentCutId }),
                  // Include file details for changelog display with thumbnails
                  ...(c.file && {
                    file: {
                      id: c.file.id,
                      filename: c.file.filename,
                      mimetype: c.file.mimetype,
                      size: c.file.size,
                      thumbnailUrl: c.file.thumbnailUrl,
                      path: c.file.path,
                    },
                  }),
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

        // Track observation changes
        if (data.observation !== undefined) {
          const oldObservation = existingTask.observation;
          const newObservation = updatedTask?.observation;

          // Serialize observation for comparison
          const serializeObservation = (obs: any) => {
            if (!obs) return null;
            return {
              description: obs.description || '',
              fileIds: obs.files?.map((f: any) => f.id) || obs.fileIds || [],
            };
          };

          const oldObsSerialized = JSON.stringify(serializeObservation(oldObservation));
          const newObsSerialized = JSON.stringify(serializeObservation(newObservation));

          // Only create changelog if observation actually changed
          if (oldObsSerialized !== newObsSerialized) {
            const oldObs = serializeObservation(oldObservation);
            const newObs = serializeObservation(newObservation);

            // Build reason description
            const changeReasons: string[] = [];
            if (!oldObservation && newObservation) {
              changeReasons.push('Observação adicionada');
            } else if (oldObservation && !newObservation) {
              changeReasons.push('Observação removida');
            } else {
              if (oldObs?.description !== newObs?.description) {
                changeReasons.push('Descrição alterada');
              }
              const oldFileCount = oldObs?.fileIds?.length || 0;
              const newFileCount = newObs?.fileIds?.length || 0;
              if (oldFileCount !== newFileCount) {
                changeReasons.push(`Arquivos: ${oldFileCount} → ${newFileCount}`);
              }
            }

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'observation',
              oldValue: oldObs,
              newValue: newObs,
              reason: changeReasons.join(', ') || 'Observação alterada',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });
          }
        }

        return { updatedTask: updatedTask!, createdServiceOrders };
      });

      // Destructure transaction result
      const { updatedTask, createdServiceOrders } = transactionResult;

      // Emit events for created service orders AFTER transaction commits
      if (createdServiceOrders && createdServiceOrders.length > 0) {
        this.logger.log(`[Task Update] Emitting events for ${createdServiceOrders.length} service orders`);

        for (const serviceOrder of createdServiceOrders) {
          this.logger.log(`[Task Update] Emitting service-order.created event for SO ${serviceOrder.id} (type: ${serviceOrder.type})`);

          // Emit creation event
          this.eventEmitter.emit('service-order.created', {
            serviceOrder,
            userId,
          });

          // If service order is assigned, emit assignment event
          if (serviceOrder.assignedToId) {
            this.logger.log(`[Task Update] Emitting service-order.assigned event for SO ${serviceOrder.id} to user ${serviceOrder.assignedToId}`);
            this.eventEmitter.emit('service-order.assigned', {
              serviceOrder,
              userId,
              assignedToId: serviceOrder.assignedToId,
            });
          }
        }
      } else {
        this.logger.log(`[Task Update] No service orders to emit events for`);
      }

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
    files?: {
      budgets?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      receipts?: Express.Multer.File[];
      artworks?: Express.Multer.File[];
      cutFiles?: Express.Multer.File[];
    },
  ): Promise<TaskBatchUpdateResponse<TaskUpdateFormData>> {
    this.logger.log('[batchUpdate] ========== BATCH UPDATE STARTED ==========');
    this.logger.log(`[batchUpdate] Number of tasks to update: ${data.tasks?.length || 0}`);
    this.logger.log(
      `[batchUpdate] Tasks data: ${JSON.stringify(data.tasks?.map(t => ({ id: t.id, data: t.data })))}`,
    );
    this.logger.log(`[batchUpdate] userId: ${userId}`);
    this.logger.log(`[batchUpdate] include: ${JSON.stringify(include)}`);

    // Log files received
    this.logger.log(
      `[batchUpdate] Files received: ${files ? Object.keys(files).join(', ') : 'none'}`,
    );
    if (files) {
      Object.entries(files).forEach(([key, fileArray]) => {
        this.logger.log(`[batchUpdate] ${key}: ${fileArray.length} files`);
      });
    }

    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        this.logger.log('[batchUpdate] Inside transaction');
        // Prepare updates with change tracking and validation
        const updatesWithChangeTracking: { id: string; data: TaskUpdateFormData }[] = [];
        const validationErrors: Array<{ id: string; error: string }> = [];

        // Store existing task states BEFORE updates for changelog comparison
        const existingTaskStates: Map<string, any> = new Map();

        for (const update of data.tasks) {
          this.logger.log(`[batchUpdate] Processing task ${update.id}`);
          const existingTask = await this.tasksRepository.findByIdWithTransaction(tx, update.id, {
            include: {
              ...include,
              artworks: true,
              budgets: true,
              invoices: true,
              receipts: true,
              logoPaints: true,
              generalPainting: true,
              cuts: { include: { file: true } },
            },
          });
          if (existingTask) {
            // Store existing state for changelog comparison after update
            existingTaskStates.set(update.id, {
              ...existingTask,
              artworks: existingTask.artworks ? [...existingTask.artworks] : [],
              budgets: existingTask.budgets ? [...existingTask.budgets] : [],
              invoices: existingTask.invoices ? [...existingTask.invoices] : [],
              receipts: existingTask.receipts ? [...existingTask.receipts] : [],
              logoPaints: existingTask.logoPaints ? [...existingTask.logoPaints] : [],
              cuts: existingTask.cuts ? [...existingTask.cuts] : [],
            });

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

        // Process file uploads if provided - upload files once and add to all tasks
        const uploadedFileIds: {
          budgets?: string[];
          invoices?: string[];
          receipts?: string[];
          artworks?: string[];
        } = {};

        if (files && data.tasks.length > 0) {
          this.logger.log('[batchUpdate] Processing file uploads for batch operation');
          this.logger.log(`[batchUpdate] Files object keys: ${Object.keys(files).join(', ')}`);
          this.logger.log(
            `[batchUpdate] Has artworks: ${!!files.artworks}, Count: ${files.artworks?.length || 0}`,
          );

          // Get customer name from first task for file metadata
          const firstTask = await this.tasksRepository.findByIdWithTransaction(
            tx,
            data.tasks[0].id,
            {
              include: { customer: true },
            },
          );
          const customerName = firstTask?.customer?.fantasyName;

          // Upload budgets
          if (files.budgets && files.budgets.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.budgets.length} budget files`);
            uploadedFileIds.budgets = [];
            for (const budgetFile of files.budgets) {
              const budgetRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                budgetFile,
                'taskBudgets',
                userId,
                {
                  entityId: data.tasks[0].id, // Use first task ID for reference
                  entityType: 'TASK',
                  customerName,
                },
              );
              uploadedFileIds.budgets.push(budgetRecord.id);
            }
          }

          // Upload invoices
          if (files.invoices && files.invoices.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.invoices.length} invoice files`);
            uploadedFileIds.invoices = [];
            for (const invoiceFile of files.invoices) {
              const invoiceRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                invoiceFile,
                'taskInvoices',
                userId,
                {
                  entityId: data.tasks[0].id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              uploadedFileIds.invoices.push(invoiceRecord.id);
            }
          }

          // Upload receipts
          if (files.receipts && files.receipts.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.receipts.length} receipt files`);
            uploadedFileIds.receipts = [];
            for (const receiptFile of files.receipts) {
              const receiptRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                receiptFile,
                'taskReceipts',
                userId,
                {
                  entityId: data.tasks[0].id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              uploadedFileIds.receipts.push(receiptRecord.id);
            }
          }

          // Upload artworks
          if (files.artworks && files.artworks.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.artworks.length} artwork files`);
            uploadedFileIds.artworks = [];
            for (const artworkFile of files.artworks) {
              const artworkRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                artworkFile,
                'tasksArtworks',
                userId,
                {
                  entityId: data.tasks[0].id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              uploadedFileIds.artworks.push(artworkRecord.id);
            }
          }

          // Process cut files for batch update
          // Note: These files will be referenced in the cuts data for each task
          const uploadedCutFiles: Array<{ id: string }> = [];
          if (files.cutFiles && files.cutFiles.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.cutFiles.length} cut files`);
            for (const cutFile of files.cutFiles) {
              const cutRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                cutFile,
                'cutFiles',
                userId,
                {
                  entityId: data.tasks[0].id,
                  entityType: 'CUT',
                  customerName,
                },
              );
              uploadedCutFiles.push({ id: cutRecord.id });
            }

            // Update cuts data with uploaded file IDs
            // Each task's cuts array should have _fileIndex that maps to the uploaded files
            for (const task of data.tasks) {
              if (task.data.cuts && Array.isArray(task.data.cuts)) {
                task.data.cuts.forEach((cut: any) => {
                  if (
                    typeof cut._fileIndex === 'number' &&
                    cut._fileIndex < uploadedCutFiles.length
                  ) {
                    cut.fileId = uploadedCutFiles[cut._fileIndex].id;
                    delete cut._fileIndex; // Clean up the temporary field
                  }
                });
              }
            }
          }

          // Add uploaded files to all tasks in the batch
          // We need to merge with existing files to avoid replacing them
          this.logger.log('[batchUpdate] Adding uploaded files to all tasks in batch');
          this.logger.log(
            `[batchUpdate] Tasks to update with files: ${updatesWithChangeTracking.length}`,
          );
          this.logger.log(`[batchUpdate] Uploaded file IDs:`, uploadedFileIds);

          for (const update of updatesWithChangeTracking) {
            this.logger.log(
              `[batchUpdate] Processing task ${update.id} for file connections and removals`,
            );

            // Get current task to merge existing files and process removals
            const currentTask = await this.tasksRepository.findByIdWithTransaction(tx, update.id, {
              include: {
                budgets: true,
                invoices: true,
                receipts: true,
                artworks: true,
                logoPaints: true,
                cuts: true,
              },
            });

            if (!currentTask) {
              this.logger.error(`[batchUpdate] Task ${update.id} not found`);
              continue;
            }

            // Process file additions (merge with existing)
            if (uploadedFileIds.budgets && uploadedFileIds.budgets.length > 0) {
              const currentBudgetIds = currentTask.budgets?.map(f => f.id) || [];
              const mergedBudgetIds = [
                ...new Set([...currentBudgetIds, ...uploadedFileIds.budgets]),
              ];
              update.data.budgetIds = mergedBudgetIds;
              this.logger.log(
                `[batchUpdate] Adding ${uploadedFileIds.budgets.length} budgets to task ${update.id} (total: ${mergedBudgetIds.length})`,
              );
            }

            if (uploadedFileIds.invoices && uploadedFileIds.invoices.length > 0) {
              const currentInvoiceIds = currentTask.invoices?.map(f => f.id) || [];
              const mergedInvoiceIds = [
                ...new Set([...currentInvoiceIds, ...uploadedFileIds.invoices]),
              ];
              update.data.invoiceIds = mergedInvoiceIds;
              this.logger.log(
                `[batchUpdate] Adding ${uploadedFileIds.invoices.length} invoices to task ${update.id} (total: ${mergedInvoiceIds.length})`,
              );
            }

            if (uploadedFileIds.receipts && uploadedFileIds.receipts.length > 0) {
              const currentReceiptIds = currentTask.receipts?.map(f => f.id) || [];
              const mergedReceiptIds = [
                ...new Set([...currentReceiptIds, ...uploadedFileIds.receipts]),
              ];
              update.data.receiptIds = mergedReceiptIds;
              this.logger.log(
                `[batchUpdate] Adding ${uploadedFileIds.receipts.length} receipts to task ${update.id} (total: ${mergedReceiptIds.length})`,
              );
            }

            if (uploadedFileIds.artworks && uploadedFileIds.artworks.length > 0) {
              const currentArtworkIds = currentTask.artworks?.map(f => f.id) || [];
              const mergedArtworkIds = [
                ...new Set([...currentArtworkIds, ...uploadedFileIds.artworks]),
              ];
              update.data.artworkIds = mergedArtworkIds;
              this.logger.log(
                `[batchUpdate] Adding ${uploadedFileIds.artworks.length} artworks to task ${update.id} (total: ${mergedArtworkIds.length})`,
              );
            }

            // Process removals
            // Remove artworks
            if (update.data.removeArtworkIds && update.data.removeArtworkIds.length > 0) {
              const currentArtworkIds = currentTask.artworks?.map(f => f.id) || [];
              const filteredArtworkIds = currentArtworkIds.filter(
                id => !update.data.removeArtworkIds.includes(id),
              );
              update.data.artworkIds = filteredArtworkIds;
              delete update.data.removeArtworkIds;
              this.logger.log(
                `[batchUpdate] Removing ${update.data.removeArtworkIds.length} artworks from task ${update.id}`,
              );
            }

            // Remove budgets
            if (update.data.removeBudgetIds && update.data.removeBudgetIds.length > 0) {
              const currentBudgetIds = currentTask.budgets?.map(f => f.id) || [];
              const filteredBudgetIds = currentBudgetIds.filter(
                id => !update.data.removeBudgetIds.includes(id),
              );
              update.data.budgetIds = filteredBudgetIds;
              delete update.data.removeBudgetIds;
              this.logger.log(
                `[batchUpdate] Removing ${update.data.removeBudgetIds.length} budgets from task ${update.id}`,
              );
            }

            // Remove invoices
            if (update.data.removeInvoiceIds && update.data.removeInvoiceIds.length > 0) {
              const currentInvoiceIds = currentTask.invoices?.map(f => f.id) || [];
              const filteredInvoiceIds = currentInvoiceIds.filter(
                id => !update.data.removeInvoiceIds.includes(id),
              );
              update.data.invoiceIds = filteredInvoiceIds;
              delete update.data.removeInvoiceIds;
              this.logger.log(
                `[batchUpdate] Removing ${update.data.removeInvoiceIds.length} invoices from task ${update.id}`,
              );
            }

            // Remove receipts
            if (update.data.removeReceiptIds && update.data.removeReceiptIds.length > 0) {
              const currentReceiptIds = currentTask.receipts?.map(f => f.id) || [];
              const filteredReceiptIds = currentReceiptIds.filter(
                id => !update.data.removeReceiptIds.includes(id),
              );
              update.data.receiptIds = filteredReceiptIds;
              delete update.data.removeReceiptIds;
              this.logger.log(
                `[batchUpdate] Removing ${update.data.removeReceiptIds.length} receipts from task ${update.id}`,
              );
            }

            // Remove general painting
            if (update.data.removeGeneralPainting) {
              update.data.paintId = null;
              delete update.data.removeGeneralPainting;
              this.logger.log(`[batchUpdate] Removing general painting from task ${update.id}`);
            }

            // Remove logo paints
            if (update.data.removeLogoPaints && update.data.removeLogoPaints.length > 0) {
              const currentLogoPaintIds = currentTask.logoPaints?.map(p => p.id) || [];
              const filteredLogoPaintIds = currentLogoPaintIds.filter(
                id => !update.data.removeLogoPaints.includes(id),
              );
              update.data.paintIds = filteredLogoPaintIds;
              delete update.data.removeLogoPaints;
              this.logger.log(
                `[batchUpdate] Removing ${update.data.removeLogoPaints.length} logo paints from task ${update.id}`,
              );
            }

            // Remove cuts
            if (update.data.removeCutIds && update.data.removeCutIds.length > 0) {
              // Delete the cuts directly using prisma
              await tx.cut.deleteMany({
                where: {
                  id: { in: update.data.removeCutIds },
                  taskId: update.id,
                },
              });
              delete update.data.removeCutIds;
              this.logger.log(
                `[batchUpdate] Removing ${update.data.removeCutIds.length} cuts from task ${update.id}`,
              );
            }

            this.logger.log(
              `[batchUpdate] After merge and removals - update.data:`,
              JSON.stringify(update.data),
            );
          }
        }

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

        // Process consolidated truck data with layouts for each successfully updated task
        for (const task of result.success) {
          const updateData = data.tasks.find(u => u.id === task.id)?.data;
          const truckData = (updateData as any)?.truck;
          if (
            truckData &&
            (truckData.leftSideLayout || truckData.rightSideLayout || truckData.backSideLayout)
          ) {
            this.logger.log(`[batchUpdate] Processing truck layouts for task ${task.id}`);

            // Get the task with truck info
            const taskWithTruck = await tx.task.findUnique({
              where: { id: task.id },
              include: {
                truck: {
                  include: {
                    leftSideLayout: true,
                    rightSideLayout: true,
                    backSideLayout: true,
                  },
                },
              },
            });

            // Get or create truck
            let truckId = taskWithTruck?.truck?.id;
            const leftLayoutId = taskWithTruck?.truck?.leftSideLayoutId;
            const rightLayoutId = taskWithTruck?.truck?.rightSideLayoutId;
            const backLayoutId = taskWithTruck?.truck?.backSideLayoutId;

            if (!truckId) {
              this.logger.log(`[batchUpdate] No truck exists for task ${task.id} - creating one`);
              const newTruck = await tx.truck.create({
                data: {
                  taskId: task.id,
                  plate: truckData.plate || null,
                  chassisNumber: truckData.chassisNumber || null,
                  spot: truckData.spot || null,
                },
              });
              truckId = newTruck.id;
              this.logger.log(`[batchUpdate] Truck created: ${truckId}`);
            } else {
              this.logger.log(`[batchUpdate] Using existing truck: ${truckId}`);
            }

            // Helper function to process layout updates
            const processLayout = async (
              layoutData: any,
              existingLayoutId: string | null,
              layoutField: 'leftSideLayoutId' | 'rightSideLayoutId' | 'backSideLayoutId',
              sideName: string,
            ) => {
              if (!layoutData) return;

              // Delete existing layout if present
              if (existingLayoutId) {
                this.logger.log(
                  `[batchUpdate] Deleting existing ${sideName} layout: ${existingLayoutId}`,
                );
                await tx.layoutSection.deleteMany({ where: { layoutId: existingLayoutId } });
                await tx.layout.delete({ where: { id: existingLayoutId } });
                await tx.truck.update({ where: { id: truckId! }, data: { [layoutField]: null } });
              }

              // Create new layout
              this.logger.log(`[batchUpdate] Creating new ${sideName} layout for task ${task.id}`);
              const newLayout = await tx.layout.create({
                data: {
                  height: layoutData.height,
                  ...(layoutData.photoId && {
                    photo: { connect: { id: layoutData.photoId } },
                  }),
                  layoutSections: {
                    create: layoutData.layoutSections.map((section: any, index: number) => ({
                      width: section.width,
                      isDoor: section.isDoor,
                      doorHeight: section.doorHeight,
                      position: section.position ?? index,
                    })),
                  },
                },
              });
              await tx.truck.update({
                where: { id: truckId! },
                data: { [layoutField]: newLayout.id },
              });
              this.logger.log(`[batchUpdate] ${sideName} layout created: ${newLayout.id}`);
            };

            // Process each side using the consolidated format
            await processLayout(truckData.leftSideLayout, leftLayoutId, 'leftSideLayoutId', 'left');
            await processLayout(
              truckData.rightSideLayout,
              rightLayoutId,
              'rightSideLayoutId',
              'right',
            );
            await processLayout(truckData.backSideLayout, backLayoutId, 'backSideLayoutId', 'back');

            this.logger.log(`[batchUpdate] Finished processing layouts for task ${task.id}`);
          }
        }

        // Track individual field changes for successful updates
        for (const task of result.success) {
          const updateData = data.tasks.find(u => u.id === task.id)?.data;
          const existingTask = existingTaskStates.get(task.id);

          // Fetch updated task with all relations for comparison
          const updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, task.id, {
            include: {
              artworks: true,
              baseFiles: true,
              budgets: true,
              invoices: true,
              receipts: true,
              logoPaints: true,
              generalPainting: true,
              cuts: { include: { file: true } },
            },
          });

          // Track individual field changes for batch update
          if (existingTask && updateData && updatedTask) {
            // Track artworks changes
            const artworkIdsForChangelog =
              (updateData as any).artworkIds || (updateData as any).fileIds;
            if (artworkIdsForChangelog !== undefined) {
              const oldArtworks = existingTask.artworks || [];
              const newArtworks = updatedTask.artworks || [];

              const oldArtworkIds = oldArtworks.map((f: any) => f.id);
              const newArtworkIds = newArtworks.map((f: any) => f.id);

              const addedArtworks = newArtworks.filter((f: any) => !oldArtworkIds.includes(f.id));
              const removedArtworks = oldArtworks.filter((f: any) => !newArtworkIds.includes(f.id));

              if (addedArtworks.length > 0 || removedArtworks.length > 0) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'artworks',
                  oldValue: oldArtworks.length > 0 ? oldArtworks : null,
                  newValue: newArtworks.length > 0 ? newArtworks : null,
                  reason: `Artes atualizadas em operação de lote`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });
              }
            }

            // Track baseFiles changes
            if (updateData.baseFileIds !== undefined) {
              const oldBaseFiles = existingTask.baseFiles || [];
              const newBaseFiles = updatedTask.baseFiles || [];

              const oldBaseFileIds = oldBaseFiles.map((f: any) => f.id);
              const newBaseFileIds = newBaseFiles.map((f: any) => f.id);

              const addedBaseFiles = newBaseFiles.filter((f: any) => !oldBaseFileIds.includes(f.id));
              const removedBaseFiles = oldBaseFiles.filter((f: any) => !newBaseFileIds.includes(f.id));

              if (addedBaseFiles.length > 0 || removedBaseFiles.length > 0) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'baseFiles',
                  oldValue: oldBaseFiles.length > 0 ? oldBaseFiles : null,
                  newValue: newBaseFiles.length > 0 ? newBaseFiles : null,
                  reason: `Arquivos base atualizados em operação de lote`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });
              }
            }

            // Track budgets changes
            if (updateData.budgetIds !== undefined) {
              const oldBudgets = existingTask.budgets || [];
              const newBudgets = updatedTask.budgets || [];

              const oldBudgetIds = oldBudgets.map((f: any) => f.id);
              const newBudgetIds = newBudgets.map((f: any) => f.id);

              const addedBudgets = newBudgets.filter((f: any) => !oldBudgetIds.includes(f.id));
              const removedBudgets = oldBudgets.filter((f: any) => !newBudgetIds.includes(f.id));

              if (addedBudgets.length > 0 || removedBudgets.length > 0) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'budgets',
                  oldValue: oldBudgets.length > 0 ? oldBudgets : null,
                  newValue: newBudgets.length > 0 ? newBudgets : null,
                  reason: `Orçamentos atualizados em operação de lote`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });
              }
            }

            // Track invoices changes
            if (updateData.invoiceIds !== undefined) {
              const oldInvoices = existingTask.invoices || [];
              const newInvoices = updatedTask.invoices || [];

              const oldInvoiceIds = oldInvoices.map((f: any) => f.id);
              const newInvoiceIds = newInvoices.map((f: any) => f.id);

              const addedInvoices = newInvoices.filter((f: any) => !oldInvoiceIds.includes(f.id));
              const removedInvoices = oldInvoices.filter((f: any) => !newInvoiceIds.includes(f.id));

              if (addedInvoices.length > 0 || removedInvoices.length > 0) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'invoices',
                  oldValue: oldInvoices.length > 0 ? oldInvoices : null,
                  newValue: newInvoices.length > 0 ? newInvoices : null,
                  reason: `Notas fiscais atualizadas em operação de lote`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });
              }
            }

            // Track receipts changes
            if (updateData.receiptIds !== undefined) {
              const oldReceipts = existingTask.receipts || [];
              const newReceipts = updatedTask.receipts || [];

              const oldReceiptIds = oldReceipts.map((f: any) => f.id);
              const newReceiptIds = newReceipts.map((f: any) => f.id);

              const addedReceipts = newReceipts.filter((f: any) => !oldReceiptIds.includes(f.id));
              const removedReceipts = oldReceipts.filter((f: any) => !newReceiptIds.includes(f.id));

              if (addedReceipts.length > 0 || removedReceipts.length > 0) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'receipts',
                  oldValue: oldReceipts.length > 0 ? oldReceipts : null,
                  newValue: newReceipts.length > 0 ? newReceipts : null,
                  reason: `Comprovantes atualizados em operação de lote`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });
              }
            }

            // Track logoPaints changes
            if (updateData.paintIds !== undefined) {
              const oldPaintIds = existingTask.logoPaints?.map((p: any) => p.id) || [];
              const newPaintIds = updatedTask.logoPaints?.map((p: any) => p.id) || [];

              const addedPaintIds = newPaintIds.filter((id: string) => !oldPaintIds.includes(id));
              const removedPaintIds = oldPaintIds.filter((id: string) => !newPaintIds.includes(id));

              if (addedPaintIds.length > 0 || removedPaintIds.length > 0) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'logoPaints',
                  oldValue: oldPaintIds.length > 0 ? oldPaintIds : null,
                  newValue: newPaintIds.length > 0 ? newPaintIds : null,
                  reason: `Tintas de logo atualizadas em operação de lote`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });
              }
            }

            // Track general painting (paintId) changes
            if (updateData.paintId !== undefined) {
              const oldPaintId = existingTask.paintId;
              const newPaintId = updatedTask.paintId;

              if (oldPaintId !== newPaintId) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'paintId',
                  oldValue: oldPaintId,
                  newValue: newPaintId,
                  reason: `Pintura geral atualizada em operação de lote`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });
              }
            }

            // Track cuts changes
            if (updateData.cuts !== undefined) {
              const oldCuts = existingTask.cuts || [];
              const newCuts = updatedTask.cuts || [];

              if (JSON.stringify(oldCuts) !== JSON.stringify(newCuts)) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'cuts',
                  oldValue: oldCuts.length > 0 ? oldCuts : null,
                  newValue: newCuts.length > 0 ? newCuts : null,
                  reason: `Planos de corte atualizados em operação de lote`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });
              }
            }

            // Track other simple field changes
            const simpleFieldsToTrack = [
              'status',
              'sectorId',
              'assignedToUserId',
              'description',
              'observations',
            ];
            for (const field of simpleFieldsToTrack) {
              if ((updateData as any)[field] !== undefined) {
                const oldValue = existingTask[field as keyof typeof existingTask];
                const newValue = updatedTask[field as keyof typeof updatedTask];

                if (hasValueChanged(oldValue, newValue)) {
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: field,
                    oldValue: oldValue,
                    newValue: newValue,
                    reason: `Campo ${field} atualizado em operação de lote`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });
                }
              }
            }
          }
        }

        this.logger.log(
          `[batchUpdate] Transaction complete. Success: ${result.totalUpdated}, Failed: ${result.totalFailed}`,
        );
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
      this.logger.error(
        '[batchUpdate] Error stack:',
        error instanceof Error ? error.stack : 'No stack trace',
      );

      // Re-throw BadRequestException and other client errors as-is
      if (error instanceof BadRequestException) {
        throw error;
      }

      // For other errors, provide more detailed information
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new InternalServerErrorException(`Erro na atualização em lote: ${errorMessage}`);
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

      // Debug logging for logo paints
      this.logger.log(`[Task findById] Task ${task.id} (${task.name}):`);
      this.logger.log(
        `  - General painting: ${task.generalPainting ? task.generalPainting.name : 'none'}`,
      );
      this.logger.log(`  - Logo paints count: ${task.logoPaints?.length || 0}`);
      if (task.logoPaints && task.logoPaints.length > 0) {
        this.logger.log(
          `  - Logo paints: ${JSON.stringify(task.logoPaints.map(p => ({ id: p.id, name: p.name, paintType: p.paintType?.name, paintBrand: p.paintBrand?.name })))}`,
        );
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
      console.log('[TaskService.findMany] Query received:', {
        hasWhere: !!query.where,
        whereKeys: query.where ? Object.keys(query.where) : [],
        whereStringified: query.where ? JSON.stringify(query.where).substring(0, 200) : 'undefined',
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
          `Campos permitidos: orçamento, cliente, número de série, chassi, documentos.`,
      );
    }
  }

  /**
   * Validate field-level access for COMMERCIAL sector
   * Commercial can access: agenda, cronograma, history, customer, garages, observation, airbrushing, paint basic catalogue
   * Commercial can create and update tasks
   * Commercial CANNOT edit: layout (truck layouts), financial (budgets, invoices, receipts, NFEs), cut plan (cuts)
   */
  private validateCommercialSectorAccess(data: TaskUpdateFormData): void {
    const disallowedFields = [
      'truck', // Cannot edit truck/layouts
      'budgetIds', // Cannot edit financial documents
      'nfeIds', // Cannot edit financial documents
      'receiptIds', // Cannot edit financial documents
      'cuts', // Cannot edit cut plans
    ];

    const attemptedFields = Object.keys(data);
    const blockedFields = attemptedFields.filter(field => disallowedFields.includes(field));

    if (blockedFields.length > 0) {
      throw new BadRequestException(
        `Setor Comercial não tem permissão para atualizar os seguintes campos: ${blockedFields.join(', ')}. ` +
          `Campos bloqueados: layout (caminhão), financeiro (orçamentos, NFEs, recibos), plano de corte.`,
      );
    }
  }

  private async validateTask(
    data: Partial<TaskCreateFormData | TaskUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validate customer exists (only if customerId is provided)
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

    // Validate unique plate (plate is nested under truck object)
    const plate = (data as any).truck?.plate;
    if (plate) {
      const existing = await transaction.truck.findFirst({
        where: {
          plate: plate,
          ...(existingId && { taskId: { not: existingId } }),
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

      // 4. Convert oldValue to appropriate type based on field
      let convertedValue: any = oldValue;

      // Handle null, undefined, and empty string values
      if (oldValue === null || oldValue === undefined || oldValue === '') {
        convertedValue = null;
      }
      // Handle date fields
      else if (
        ['startedAt', 'finishedAt', 'entryDate', 'term', 'createdAt', 'updatedAt'].includes(
          fieldToRevert,
        )
      ) {
        // Dates must be either a valid Date object or null, never empty string
        convertedValue = new Date(oldValue as string);
      }
      // Handle number fields
      else if (['priority', 'statusOrder'].includes(fieldToRevert)) {
        convertedValue = typeof oldValue === 'number' ? oldValue : parseInt(oldValue as string, 10);
      }
      // Handle enum fields (status, commission) - must not be empty string
      else if (['status', 'commission'].includes(fieldToRevert)) {
        convertedValue = oldValue as string;
      }
      // Handle UUID/string fields - convert empty strings to null for optional fields
      else if (
        [
          'customerId',
          'sectorId',
          'paintId',
          'createdById',
          'bonusDiscountId',
          'serialNumber',
          'details',
        ].includes(fieldToRevert)
      ) {
        convertedValue = oldValue;
        // Note: chassisNumber and plate are now on Truck entity, not Task
      }
      // Handle required string fields (name) - keep as is
      else if (['name'].includes(fieldToRevert)) {
        convertedValue = oldValue;
      }

      // 5. Special handling for array/relation fields that need custom rollback logic
      if (fieldToRevert === 'cuts') {
        // Cuts are a relation, not a direct field - need special handling
        // oldValue is a serialized array like: [{ fileId, type, origin, quantity, status, file: {...} }]

        this.logger.log(`[Rollback] Starting cuts rollback for task ${changeLog.entityId}`);
        this.logger.log(`[Rollback] Changelog action: ${changeLog.action}`);
        this.logger.log(`[Rollback] oldValue type: ${typeof oldValue}`);

        // Parse oldValue if it's a JSON string
        let parsedOldValue = oldValue;
        if (typeof oldValue === 'string') {
          try {
            parsedOldValue = JSON.parse(oldValue);
            this.logger.log(`[Rollback] Parsed oldValue from string to ${typeof parsedOldValue}`);
          } catch (e) {
            this.logger.error(`[Rollback] Failed to parse oldValue: ${e.message}`);
            parsedOldValue = oldValue;
          }
        }

        // Delete all current cuts for this task
        const deleteResult = await tx.cut.deleteMany({
          where: { taskId: changeLog.entityId },
        });
        this.logger.log(`[Rollback] Deleted ${deleteResult.count} existing cuts`);

        // Recreate cuts from parsedOldValue
        let cutsCreated = 0;
        if (parsedOldValue && Array.isArray(parsedOldValue)) {
          this.logger.log(`[Rollback] Recreating ${parsedOldValue.length} cut groups`);
          for (const cutData of parsedOldValue) {
            // Type assertion for cutData as it's from JSON
            const cut = cutData as any;

            // Create 'quantity' number of cuts with the same fileId/type/origin
            const quantity = cut.quantity || 1;
            this.logger.log(
              `[Rollback] Creating ${quantity} cuts for file ${cut.fileId} (${cut.file?.filename || 'unknown'})`,
            );

            for (let i = 0; i < quantity; i++) {
              const createdCut = await tx.cut.create({
                data: {
                  fileId: cut.fileId,
                  type: cut.type,
                  origin: cut.origin || 'PLAN',
                  status: cut.status || 'PENDING',
                  taskId: changeLog.entityId,
                },
              });
              cutsCreated++;
              this.logger.log(`[Rollback] Created cut ${i + 1}/${quantity}: ${createdCut.id}`);
            }
          }
        } else {
          this.logger.log(
            `[Rollback] No cuts to recreate (parsedOldValue is ${typeof parsedOldValue}, isArray: ${Array.isArray(parsedOldValue)})`,
          );
        }

        this.logger.log(`[Rollback] Total cuts created: ${cutsCreated}`);

        // Fetch updated task with cuts to return
        const updatedTask = await this.tasksRepository.findByIdWithTransaction(
          tx,
          changeLog.entityId,
          {
            include: {
              customer: true,
              sector: true,
              generalPainting: true,
              truck: true,
              createdBy: true,
              cuts: {
                include: {
                  file: true,
                },
              },
            },
          },
        );

        // Log the rollback action
        const fieldNamePt = translateFieldName(fieldToRevert);

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: changeLog.entityId,
          action: CHANGE_ACTION.ROLLBACK,
          field: fieldToRevert,
          oldValue: changeLog.newValue, // What we're rolling back from
          newValue: changeLog.oldValue, // What we're rolling back to
          reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
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
          message: `Campo '${fieldNamePt}' revertido com sucesso`,
          data: updatedTask,
        };
      }

      // 5b. Special handling for file relationship fields (many-to-many with File)
      // These are the File[] relations on Task that need Prisma's { set: [...] } syntax
      const fileRelationFields = [
        'artworks',
        'budgets',
        'invoices',
        'invoiceReimbursements',
        'receipts',
        'reimbursements',
      ];
      if (fileRelationFields.includes(fieldToRevert)) {
        this.logger.log(
          `[Rollback] Starting ${fieldToRevert} rollback for task ${changeLog.entityId}`,
        );
        this.logger.log(`[Rollback] oldValue type: ${typeof oldValue}`);

        // Parse oldValue if it's a JSON string
        let parsedOldValue = oldValue;
        if (typeof oldValue === 'string') {
          try {
            parsedOldValue = JSON.parse(oldValue);
            this.logger.log(`[Rollback] Parsed oldValue from string to ${typeof parsedOldValue}`);
          } catch (e) {
            this.logger.error(`[Rollback] Failed to parse oldValue: ${e.message}`);
            parsedOldValue = oldValue;
          }
        }

        // Extract file IDs from the parsed value
        // oldValue can be: array of file objects [{id, filename, ...}], array of IDs, or null/empty
        let fileIds: string[] = [];
        if (parsedOldValue && Array.isArray(parsedOldValue)) {
          fileIds = parsedOldValue
            .map((item: any) => {
              // Handle both full file objects and plain IDs
              return typeof item === 'string' ? item : item.id;
            })
            .filter((id: string) => id); // Filter out any null/undefined
        }

        this.logger.log(
          `[Rollback] Setting ${fieldToRevert} to ${fileIds.length} files: ${fileIds.join(', ')}`,
        );

        // Update the task using Prisma's relationship set syntax
        await tx.task.update({
          where: { id: changeLog.entityId },
          data: {
            [fieldToRevert]: {
              set: fileIds.map(id => ({ id })),
            },
          },
        });

        // Fetch updated task with proper typing using repository
        const updatedTask = await this.tasksRepository.findByIdWithTransaction(
          tx,
          changeLog.entityId,
          {
            include: {
              customer: true,
              sector: true,
              generalPainting: true,
              truck: true,
              createdBy: true,
              artworks: true,
            },
          },
        );

        // Log the rollback action
        const fieldNamePt = translateFieldName(fieldToRevert);

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: changeLog.entityId,
          action: CHANGE_ACTION.ROLLBACK,
          field: fieldToRevert,
          oldValue: changeLog.newValue, // What we're rolling back from
          newValue: changeLog.oldValue, // What we're rolling back to
          reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
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
          message: `Campo '${fieldNamePt}' revertido com sucesso`,
          data: updatedTask,
        };
      }

      // 6. Create update data with just the field being rolled back
      const updateData: any = {
        [fieldToRevert]: convertedValue,
      };

      // 6. Special handling for status changes
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

      // 7. Update the task with relations included for proper response
      const updatedTask = await this.tasksRepository.updateWithTransaction(
        tx,
        changeLog.entityId,
        updateData,
        {
          include: {
            customer: true,
            sector: true,
            generalPainting: true,
            truck: true,
            createdBy: true,
          },
        },
        userId,
      );

      // 8. Log the rollback action
      const fieldNamePt = translateFieldName(fieldToRevert);

      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.TASK,
        entityId: changeLog.entityId,
        action: CHANGE_ACTION.ROLLBACK,
        field: fieldToRevert,
        oldValue: changeLog.newValue, // What we're rolling back from
        newValue: changeLog.oldValue, // What we're rolling back to
        reason: `Campo '${fieldNamePt}' revertido via changelog ${changeLogId}`,
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
        message: `Campo '${fieldNamePt}' revertido com sucesso`,
        data: updatedTask,
      };
    });
  }

  // =====================
  // TRUCK POSITIONING METHODS
  // =====================

  /**
   * Update the spot (parking position) of a truck associated with a task
   */
  async updateTaskPosition(
    taskId: string,
    positionData: {
      spot?: TRUCK_SPOT | null;
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

      // Validate that truck has layout before positioning (except for PATIO)
      if (
        positionData.spot &&
        positionData.spot !== TRUCK_SPOT.PATIO &&
        !task.truck.leftSideLayout &&
        !task.truck.rightSideLayout &&
        !task.truck.backSideLayout
      ) {
        throw new BadRequestException(
          `O caminhão da tarefa "${task.name}" não possui layout configurado. Configure pelo menos um layout (Motorista, Sapo ou Traseira) antes de posicionar o caminhão na garagem.`,
        );
      }

      // Validate spot availability (check if spot is already occupied)
      if (positionData.spot && positionData.spot !== TRUCK_SPOT.PATIO) {
        const existingTruck = await tx.truck.findFirst({
          where: {
            spot: positionData.spot,
            id: { not: task.truck.id },
          },
        });

        if (existingTruck) {
          throw new BadRequestException(
            `A vaga ${positionData.spot} já está ocupada por outro caminhão`,
          );
        }
      }

      const oldSpot = task.truck.spot;

      // Update truck spot
      await tx.truck.update({
        where: { id: task.truck.id },
        data: {
          spot: positionData.spot,
        },
      });

      // Log the change
      if (userId) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TRUCK,
          entityId: task.truck.id,
          action: CHANGE_ACTION.UPDATE,
          userId,
          oldValue: { spot: oldSpot },
          newValue: { spot: positionData.spot },
          reason: `Spot updated for task ${task.id}`,
          triggeredBy: CHANGE_TRIGGERED_BY.TASK_UPDATE,
          triggeredById: null,
          transaction: tx,
        });
      }

      // Fetch updated task
      const updatedTask = await this.tasksRepository.findById(taskId, include);

      return {
        success: true,
        message: 'Vaga do caminhão atualizada com sucesso',
        data: updatedTask,
      };
    });
  }

  /**
   * Bulk update positions for multiple trucks
   */
  async bulkUpdatePositions(
    data: TaskBulkPositionUpdateFormData,
    include?: TaskInclude,
    userId?: string,
  ): Promise<TaskBatchUpdateResponse<any>> {
    const results: Task[] = [];
    const errors: Array<{ index: number; data: any; error: string }> = [];

    for (let i = 0; i < data.updates.length; i++) {
      const update = data.updates[i];
      try {
        const result = await this.updateTaskPosition(update.taskId, update, include, userId);
        results.push(result.data);
      } catch (error) {
        errors.push({
          index: i,
          data: update,
          error: error.message || 'Erro desconhecido',
        });
      }
    }

    return {
      success: errors.length === 0,
      message:
        errors.length === 0
          ? 'Todas as posições foram atualizadas com sucesso'
          : `${results.length} posições atualizadas, ${errors.length} falharam`,
      data: {
        success: results,
        failed: errors,
        totalProcessed: data.updates.length,
        totalSuccess: results.length,
        totalFailed: errors.length,
      },
    };
  }

  /**
   * Swap spots of two trucks
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

      // Store original spots
      const truck1Spot = task1.truck.spot;
      const truck2Spot = task2.truck.spot;

      // Swap spots
      await tx.truck.update({
        where: { id: task1.truck.id },
        data: { spot: truck2Spot },
      });

      await tx.truck.update({
        where: { id: task2.truck.id },
        data: { spot: truck1Spot },
      });

      // Log changes
      if (userId) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TRUCK,
          entityId: task1.truck.id,
          action: CHANGE_ACTION.UPDATE,
          userId,
          oldValue: { spot: truck1Spot },
          newValue: { spot: truck2Spot },
          reason: `Spot swapped with truck ${task2.truck.id}`,
          triggeredBy: CHANGE_TRIGGERED_BY.TASK_UPDATE,
          triggeredById: null,
          transaction: tx,
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TRUCK,
          entityId: task2.truck.id,
          action: CHANGE_ACTION.UPDATE,
          userId,
          oldValue: { spot: truck2Spot },
          newValue: { spot: truck1Spot },
          reason: `Spot swapped with truck ${task1.truck.id}`,
          triggeredBy: CHANGE_TRIGGERED_BY.TASK_UPDATE,
          triggeredById: null,
          transaction: tx,
        });
      }

      // Fetch updated tasks
      const updatedTask1 = await this.tasksRepository.findById(taskId1, include);
      const updatedTask2 = await this.tasksRepository.findById(taskId2, include);

      return {
        success: true,
        message: 'Vagas dos caminhões trocadas com sucesso',
        data: {
          task1: updatedTask1,
          task2: updatedTask2,
        },
      };
    });
  }

  /**
   * Calculate truck width from layouts (sum of layout section widths)
   */
  private calculateTruckWidth(truck: any): number {
    // Width is the sum of section widths from side layouts
    const leftWidth =
      truck.leftSideLayout?.layoutSections?.reduce(
        (sum: number, section: any) => sum + section.width,
        0,
      ) || 0;

    const rightWidth =
      truck.rightSideLayout?.layoutSections?.reduce(
        (sum: number, section: any) => sum + section.width,
        0,
      ) || 0;

    // Use the maximum width from available layouts, default to 5m if no layout
    const baseLength = Math.max(leftWidth, rightWidth) || 5;

    // Add cabin length for trucks under 10m
    if (baseLength < 10) {
      return baseLength + 2.8;
    }
    return baseLength;
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

  // =====================
  // BULK OPERATIONS
  // =====================

  /**
   * Bulk add artworks to multiple tasks
   */
  async bulkAddArtworks(
    taskIds: string[],
    artworkIds: string[],
    userId: string,
    include?: TaskInclude,
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    this.logger.log(
      `[bulkAddArtworks] Adding ${artworkIds.length} artworks to ${taskIds.length} tasks`,
    );

    const errors: Array<{ taskId: string; error: string }> = [];
    let successCount = 0;

    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Verify all tasks exist and user has permission
      const tasks = await tx.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, name: true },
      });

      if (tasks.length !== taskIds.length) {
        const foundIds = tasks.map(t => t.id);
        const missingIds = taskIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Tarefas não encontradas: ${missingIds.join(', ')}`);
      }

      // Verify all artwork files exist
      const artworks = await tx.file.findMany({
        where: { id: { in: artworkIds } },
        select: { id: true },
      });

      if (artworks.length !== artworkIds.length) {
        const foundIds = artworks.map(a => a.id);
        const missingIds = artworkIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Artes não encontradas: ${missingIds.join(', ')}`);
      }

      // Add artworks to each task
      for (const task of tasks) {
        try {
          // Get current artworks for this task
          const currentTask = await tx.task.findUnique({
            where: { id: task.id },
            include: { artworks: { select: { id: true } } },
          });

          // Merge current artwork IDs with new ones (avoid duplicates)
          const currentArtworkIds = currentTask?.artworks?.map(a => a.id) || [];
          const mergedArtworkIds = [...new Set([...currentArtworkIds, ...artworkIds])];

          // Update task with merged artwork IDs
          await tx.task.update({
            where: { id: task.id },
            data: {
              artworks: {
                set: mergedArtworkIds.map(id => ({ id })),
              },
            },
          });

          // Log the change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'artworks',
            oldValue: JSON.stringify(currentArtworkIds),
            newValue: JSON.stringify(mergedArtworkIds),
            reason: `Artes adicionadas em lote (${artworkIds.length} artes)`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: task.id,
            userId: userId || '',
            transaction: tx,
          });

          successCount++;
        } catch (error) {
          this.logger.error(`[bulkAddArtworks] Error updating task ${task.id}:`, error);
          errors.push({
            taskId: task.id,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
        }
      }
    });

    return {
      success: successCount,
      failed: errors.length,
      total: taskIds.length,
      errors,
    };
  }

  /**
   * Bulk add documents to multiple tasks
   */
  async bulkAddDocuments(
    taskIds: string[],
    documentType: 'budget' | 'invoice' | 'receipt',
    documentIds: string[],
    userId: string,
    include?: TaskInclude,
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    this.logger.log(
      `[bulkAddDocuments] Adding ${documentIds.length} ${documentType}s to ${taskIds.length} tasks`,
    );

    const errors: Array<{ taskId: string; error: string }> = [];
    let successCount = 0;

    // Map document type to Prisma relation name
    const relationMap = {
      budget: 'budgets',
      invoice: 'invoices',
      receipt: 'receipts',
    };
    const relationName = relationMap[documentType];

    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Verify all tasks exist
      const tasks = await tx.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, name: true },
      });

      if (tasks.length !== taskIds.length) {
        const foundIds = tasks.map(t => t.id);
        const missingIds = taskIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Tarefas não encontradas: ${missingIds.join(', ')}`);
      }

      // Verify all document files exist
      const documents = await tx.file.findMany({
        where: { id: { in: documentIds } },
        select: { id: true },
      });

      if (documents.length !== documentIds.length) {
        const foundIds = documents.map(d => d.id);
        const missingIds = documentIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Documentos não encontrados: ${missingIds.join(', ')}`);
      }

      // Add documents to each task
      for (const task of tasks) {
        try {
          // Get current documents for this task
          const currentTask = await tx.task.findUnique({
            where: { id: task.id },
            include: { [relationName]: { select: { id: true } } },
          });

          // Merge current document IDs with new ones (avoid duplicates)
          const currentDocumentIds =
            (currentTask as any)?.[relationName]?.map((d: any) => d.id) || [];
          const mergedDocumentIds = [...new Set([...currentDocumentIds, ...documentIds])];

          // Update task with merged document IDs
          await tx.task.update({
            where: { id: task.id },
            data: {
              [relationName]: {
                set: mergedDocumentIds.map(id => ({ id })),
              },
            },
          });

          // Log the change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            action: CHANGE_ACTION.UPDATE,
            field: relationName,
            oldValue: JSON.stringify(currentDocumentIds),
            newValue: JSON.stringify(mergedDocumentIds),
            reason: `Documentos (${documentType}) adicionados em lote (${documentIds.length} documentos)`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: task.id,
            userId: userId || '',
            transaction: tx,
          });

          successCount++;
        } catch (error) {
          this.logger.error(`[bulkAddDocuments] Error updating task ${task.id}:`, error);
          errors.push({
            taskId: task.id,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
        }
      }
    });

    return {
      success: successCount,
      failed: errors.length,
      total: taskIds.length,
      errors,
    };
  }

  /**
   * Bulk add paints to multiple tasks
   */
  async bulkAddPaints(
    taskIds: string[],
    paintIds: string[],
    userId: string,
    include?: TaskInclude,
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    this.logger.log(`[bulkAddPaints] Adding ${paintIds.length} paints to ${taskIds.length} tasks`);

    const errors: Array<{ taskId: string; error: string }> = [];
    let successCount = 0;

    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Verify all tasks exist
      const tasks = await tx.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, name: true },
      });

      if (tasks.length !== taskIds.length) {
        const foundIds = tasks.map(t => t.id);
        const missingIds = taskIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Tarefas não encontradas: ${missingIds.join(', ')}`);
      }

      // Verify all paints exist
      const paints = await tx.paint.findMany({
        where: { id: { in: paintIds } },
        select: { id: true },
      });

      if (paints.length !== paintIds.length) {
        const foundIds = paints.map(p => p.id);
        const missingIds = paintIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Tintas não encontradas: ${missingIds.join(', ')}`);
      }

      // Add paints to each task
      for (const task of tasks) {
        try {
          // Get current paints for this task
          const currentTask = await tx.task.findUnique({
            where: { id: task.id },
            include: { logoPaints: { select: { id: true } } },
          });

          // Merge current paint IDs with new ones (avoid duplicates)
          const currentPaintIds = currentTask?.logoPaints?.map(p => p.id) || [];
          const mergedPaintIds = [...new Set([...currentPaintIds, ...paintIds])];

          // Update task with merged paint IDs
          await tx.task.update({
            where: { id: task.id },
            data: {
              logoPaints: {
                set: mergedPaintIds.map(id => ({ id })),
              },
            },
          });

          // Log the change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'logoPaints',
            oldValue: JSON.stringify(currentPaintIds),
            newValue: JSON.stringify(mergedPaintIds),
            reason: `Tintas adicionadas em lote (${paintIds.length} tintas)`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: task.id,
            userId: userId || '',
            transaction: tx,
          });

          successCount++;
        } catch (error) {
          this.logger.error(`[bulkAddPaints] Error updating task ${task.id}:`, error);
          errors.push({
            taskId: task.id,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
        }
      }
    });

    return {
      success: successCount,
      failed: errors.length,
      total: taskIds.length,
      errors,
    };
  }

  /**
   * Bulk add cutting plans to multiple tasks
   */
  async bulkAddCuttingPlans(
    taskIds: string[],
    cutData: {
      fileId: string;
      type: string;
      origin?: string;
      reason?: string | null;
      quantity?: number;
    },
    userId: string,
    include?: TaskInclude,
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    this.logger.log(`[bulkAddCuttingPlans] Adding cutting plans to ${taskIds.length} tasks`);

    const errors: Array<{ taskId: string; error: string }> = [];
    let successCount = 0;

    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Verify all tasks exist
      const tasks = await tx.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, name: true },
      });

      if (tasks.length !== taskIds.length) {
        const foundIds = tasks.map(t => t.id);
        const missingIds = taskIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Tarefas não encontradas: ${missingIds.join(', ')}`);
      }

      // Verify the cut file exists
      const cutFile = await tx.file.findUnique({
        where: { id: cutData.fileId },
      });

      if (!cutFile) {
        throw new NotFoundException(`Arquivo de corte não encontrado: ${cutData.fileId}`);
      }

      // Create cutting plans for each task
      for (const task of tasks) {
        try {
          const quantity = cutData.quantity || 1;
          const createdCuts = [];

          // Create the specified quantity of cuts for this task
          for (let i = 0; i < quantity; i++) {
            const cut = await tx.cut.create({
              data: {
                fileId: cutData.fileId,
                type: cutData.type as any,
                origin: (cutData.origin || 'PLAN') as any,
                reason: cutData.reason ? (cutData.reason as any) : null,
                status: 'PENDING' as any,
                statusOrder: 1,
                taskId: task.id,
              },
            });
            createdCuts.push(cut);
          }

          // Log the change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'cuts',
            oldValue: null,
            newValue: JSON.stringify(createdCuts.map(c => c.id)),
            reason: `Planos de corte adicionados em lote (${quantity} cortes)`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: task.id,
            userId: userId || '',
            transaction: tx,
          });

          successCount++;
        } catch (error) {
          this.logger.error(`[bulkAddCuttingPlans] Error updating task ${task.id}:`, error);
          errors.push({
            taskId: task.id,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
        }
      }
    });

    return {
      success: successCount,
      failed: errors.length,
      total: taskIds.length,
      errors,
    };
  }

  /**
   * Bulk upload files to multiple tasks
   * Uploads files once and adds them to all selected tasks
   */
  async bulkUploadFiles(
    taskIds: string[],
    fileType: 'budgets' | 'invoices' | 'receipts' | 'artworks',
    files: Express.Multer.File[],
    userId: string,
    include?: TaskInclude,
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    this.logger.log(
      `[bulkUploadFiles] Uploading ${files.length} ${fileType} to ${taskIds.length} tasks`,
    );

    const errors: Array<{ taskId: string; error: string }> = [];
    let successCount = 0;

    // Map file type to Prisma relation name
    const relationMap = {
      budgets: 'budgets',
      invoices: 'invoices',
      receipts: 'receipts',
      artworks: 'artworks',
    };
    const relationName = relationMap[fileType];

    // Map file type to file service category
    const categoryMap = {
      budgets: 'taskBudgets',
      invoices: 'taskInvoices',
      receipts: 'taskReceipts',
      artworks: 'tasksArtworks',
    };
    const category = categoryMap[fileType];

    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Verify all tasks exist
      const tasks = await tx.task.findMany({
        where: { id: { in: taskIds } },
        include: { customer: true },
      });

      if (tasks.length !== taskIds.length) {
        const foundIds = tasks.map(t => t.id);
        const missingIds = taskIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Tarefas não encontradas: ${missingIds.join(', ')}`);
      }

      // Upload all files once
      this.logger.log(`[bulkUploadFiles] Uploading ${files.length} files`);
      const uploadedFileIds: string[] = [];
      const customerName = tasks[0]?.customer?.fantasyName;

      for (const file of files) {
        const fileRecord = await this.fileService.createFromUploadWithTransaction(
          tx,
          file,
          category as any,
          userId,
          {
            entityId: tasks[0].id, // Use first task for reference
            entityType: 'TASK',
            customerName,
          },
        );
        uploadedFileIds.push(fileRecord.id);
      }

      this.logger.log(
        `[bulkUploadFiles] ${uploadedFileIds.length} files uploaded, adding to ${tasks.length} tasks`,
      );

      // Add uploaded files to each task
      for (const task of tasks) {
        try {
          // Get current files for this task
          const currentTask = await tx.task.findUnique({
            where: { id: task.id },
            include: { [relationName]: { select: { id: true } } },
          });

          // Merge current file IDs with new ones (avoid duplicates)
          const currentFileIds = (currentTask as any)?.[relationName]?.map((f: any) => f.id) || [];
          const mergedFileIds = [...new Set([...currentFileIds, ...uploadedFileIds])];

          // Update task with merged file IDs
          await tx.task.update({
            where: { id: task.id },
            data: {
              [relationName]: {
                set: mergedFileIds.map(id => ({ id })),
              },
            },
          });

          // Log the change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            action: CHANGE_ACTION.UPDATE,
            field: relationName,
            oldValue: JSON.stringify(currentFileIds),
            newValue: JSON.stringify(mergedFileIds),
            reason: `${files.length} arquivo(s) de ${fileType} adicionado(s) em lote`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: task.id,
            userId: userId || '',
            transaction: tx,
          });

          successCount++;
        } catch (error) {
          this.logger.error(`[bulkUploadFiles] Error updating task ${task.id}:`, error);
          errors.push({
            taskId: task.id,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
        }
      }
    });

    return {
      success: successCount,
      failed: errors.length,
      total: taskIds.length,
      errors,
    };
  }

  /**
   * Get target users for task notifications
   * Returns: assigned user (sector manager) + admin users
   */
  private async getTargetUsersForNotification(
    task: any,
    tx?: PrismaTransaction,
  ): Promise<string[]> {
    const userIds = new Set<string>();
    const prismaClient = tx || this.prisma;

    // Get sector manager (assigned user)
    if (task.sectorId) {
      const sector = await prismaClient.sector.findUnique({
        where: { id: task.sectorId },
        select: { managerId: true },
      });

      if (sector?.managerId) {
        userIds.add(sector.managerId);
      }
    }

    // Get admin users (users with admin positions)
    // Note: 'position' is an optional relation, so we use 'is' to filter on its fields
    const admins = await prismaClient.user.findMany({
      where: {
        isActive: true,
        position: {
          is: {
            name: {
              in: ['Admin', 'Super Admin', 'Administrador', 'Super Administrador'],
            },
          },
        },
      },
      select: { id: true },
    });

    admins.forEach(admin => userIds.add(admin.id));

    return Array.from(userIds);
  }
}
