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
  ServiceOrder,
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
  SECTOR_PRIVILEGES,
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE,
  CUT_STATUS,
  AIRBRUSHING_STATUS,
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
import { COPYABLE_TASK_FIELDS, type CopyableTaskField } from '../../../schemas/task-copy';
import {
  isValidTaskStatusTransition,
  getTaskStatusLabel,
  getTaskStatusOrder,
  getCommissionStatusOrder,
  generateBaseFileName,
} from '../../../utils';
import {
  getServiceOrderUpdatesForTaskStatusChange,
  getTaskUpdateForServiceOrderStatusChange,
  getTaskUpdateForArtworkServiceOrderStatusChange,
  calculateCorrectTaskStatus,
} from '../../../utils/task-service-order-sync';
import { getServiceOrderStatusOrder } from '../../../utils/sortOrder';
import {
  getBidirectionalSyncActions,
  combineServiceOrderToPricingDescription,
  type SyncServiceOrder,
  type SyncPricingItem,
} from '../../../utils/task-pricing-service-order-sync';
import { TaskCreatedEvent, TaskStatusChangedEvent, TaskFieldUpdatedEvent } from './task.events';
import { ArtworkApprovedEvent, ArtworkReprovedEvent } from './artwork.events';
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
   * Helper: Check if user has permission to approve/reprove artworks
   * Only COMMERCIAL and ADMIN users can change artwork status
   */
  private canApproveArtworks(userRole?: string): boolean {
    const allowedRoles = [SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.ADMIN];
    return userRole ? allowedRoles.includes(userRole as any) : false;
  }

  /**
   * Helper: Convert File IDs to Artwork entity IDs
   * Finds existing Artwork records or creates new ones for the given File IDs.
   *
   * IMPORTANT: Artworks are SHARED across tasks (many-to-many relationship).
   * - Each File has at most ONE Artwork entity (fileId is unique in Artwork)
   * - Multiple Tasks can reference the same Artwork
   * - Status changes on an Artwork reflect on ALL tasks that share it
   *
   * @param fileIds - Array of File IDs
   * @param artworkStatuses - Map of File ID to artwork status
   * @param userRole - User role for permission checking
   * @param tx - Prisma transaction
   * @param eventContext - Optional context for emitting artwork events (user, task)
   * @returns Array of Artwork IDs (to be connected to Task via many-to-many)
   */
  private async convertFileIdsToArtworkIds(
    fileIds: string[],
    _taskId?: string | null, // Deprecated: kept for backwards compatibility, not used
    airbrushingId?: string | null,
    artworkStatuses?: Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'>,
    userRole?: string,
    tx?: PrismaTransaction,
    eventContext?: { user?: any; task?: any },
  ): Promise<string[]> {
    const prisma = tx || this.prisma;
    const artworkIds: string[] = [];

    // Debug: Log permission check info
    const hasApprovalPermission = this.canApproveArtworks(userRole);
    this.logger.log(
      `[convertFileIdsToArtworkIds] Permission check: userRole=${userRole}, canApproveArtworks=${hasApprovalPermission}`,
    );
    this.logger.log(
      `[convertFileIdsToArtworkIds] Processing ${fileIds.length} files with statuses: ${JSON.stringify(artworkStatuses)}`,
    );

    for (const fileId of fileIds) {
      this.logger.log(`[convertFileIdsToArtworkIds] Processing fileId: ${fileId}`);

      // Find existing Artwork by fileId only (since fileId is unique in the new schema)
      // Artworks are now SHARED across tasks, so we don't filter by taskId
      let artwork = await prisma.artwork.findUnique({
        where: { fileId },
      });

      this.logger.log(
        `[convertFileIdsToArtworkIds] Lookup result for ${fileId}: ${artwork ? `found (id: ${artwork.id})` : 'not found'}`,
      );

      // Determine the status to use
      const requestedStatus = artworkStatuses?.[fileId];
      const status = requestedStatus || 'DRAFT'; // Default to DRAFT for new uploads

      this.logger.log(
        `[convertFileIdsToArtworkIds] File ${fileId}: found=${!!artwork}, currentStatus=${artwork?.status}, requestedStatus=${requestedStatus}`,
      );

      if (!artwork) {
        // Create new Artwork (shared across all tasks that will reference it)
        // Note: airbrushingId is only set for airbrushing-specific artworks
        if (status !== 'DRAFT' && !hasApprovalPermission) {
          this.logger.warn(
            `[convertFileIdsToArtworkIds] User without approval permission tried to create artwork with status ${status}. Using DRAFT instead.`,
          );
          artwork = await prisma.artwork.create({
            data: {
              fileId,
              status: 'DRAFT', // Force DRAFT if user doesn't have permission
              airbrushingId: airbrushingId || null,
            },
          });
        } else {
          artwork = await prisma.artwork.create({
            data: {
              fileId,
              status,
              airbrushingId: airbrushingId || null,
            },
          });
        }
        this.logger.log(
          `[convertFileIdsToArtworkIds] Created new shared Artwork record ${artwork.id} for File ${fileId} with status ${artwork.status}`,
        );
      } else if (requestedStatus && artwork.status !== requestedStatus) {
        // Update existing Artwork status if it changed
        // This will affect ALL tasks that share this artwork!
        const oldStatus = artwork.status;
        // Check permissions for status changes
        if (!hasApprovalPermission) {
          this.logger.warn(
            `[convertFileIdsToArtworkIds] User without approval permission (role=${userRole}) tried to change artwork status from ${oldStatus} to ${requestedStatus}. Ignoring.`,
          );
        } else {
          artwork = await prisma.artwork.update({
            where: { id: artwork.id },
            data: { status: requestedStatus },
          });
          this.logger.log(
            `[convertFileIdsToArtworkIds] ✅ Updated shared Artwork ${artwork.id} status from ${oldStatus} to ${requestedStatus} (affects all connected tasks)`,
          );

          // Emit artwork status change events if context is provided
          if (eventContext?.user) {
            const artworkForEvent = { ...artwork, fileId };
            const taskForEvent = eventContext.task || null;

            if (requestedStatus === 'APPROVED') {
              this.logger.log(`[convertFileIdsToArtworkIds] 🎨 Emitting artwork.approved event for artwork ${artwork.id}`);
              this.eventEmitter.emit(
                'artwork.approved',
                new ArtworkApprovedEvent(artworkForEvent, taskForEvent, eventContext.user),
              );
            } else if (requestedStatus === 'REPROVED') {
              this.logger.log(`[convertFileIdsToArtworkIds] 🎨 Emitting artwork.reproved event for artwork ${artwork.id}`);
              this.eventEmitter.emit(
                'artwork.reproved',
                new ArtworkReprovedEvent(artworkForEvent, taskForEvent, eventContext.user),
              );
            }

          }
        }
      } else {
        // Log why we're not updating
        if (!requestedStatus) {
          this.logger.log(
            `[convertFileIdsToArtworkIds] No status change for File ${fileId}: requestedStatus is undefined`,
          );
        } else {
          this.logger.log(
            `[convertFileIdsToArtworkIds] No status change for File ${fileId}: current status (${artwork.status}) already matches requested (${requestedStatus})`,
          );
        }
      }

      artworkIds.push(artwork.id);
    }

    return artworkIds;
  }

  /**
   * Helper: Create Artwork entity when uploading a new artwork file
   * Creates a shared Artwork that can be connected to multiple Tasks.
   *
   * @param fileRecord - The uploaded File entity
   * @param airbrushingId - Airbrushing ID (optional, for airbrushing-specific artworks)
   * @param status - Initial artwork status
   * @param tx - Prisma transaction
   * @returns Artwork entity ID
   */
  private async createArtworkForFile(
    fileRecord: { id: string },
    _taskId?: string | null, // Deprecated: kept for backwards compatibility, not used
    airbrushingId?: string | null,
    status: 'DRAFT' | 'APPROVED' | 'REPROVED' = 'DRAFT',
    tx?: PrismaTransaction,
  ): Promise<string> {
    const prisma = tx || this.prisma;

    // First check if artwork already exists for this file
    const existing = await prisma.artwork.findUnique({
      where: { fileId: fileRecord.id },
    });

    if (existing) {
      this.logger.log(
        `[createArtworkForFile] Found existing shared Artwork ${existing.id} for File ${fileRecord.id}`,
      );
      return existing.id;
    }

    // Create new shared Artwork (no taskId - tasks connect via many-to-many)
    const artwork = await prisma.artwork.create({
      data: {
        fileId: fileRecord.id,
        status,
        airbrushingId: airbrushingId || null,
      },
    });

    this.logger.log(
      `[createArtworkForFile] Created shared Artwork ${artwork.id} for File ${fileRecord.id} with status ${status}`,
    );

    return artwork.id;
  }

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
      // Capture pre-uploaded file IDs before any processing
      // These come from the web form when files are pre-uploaded (e.g., serial range creation)
      const preUploadedArtworkFileIds = data.artworkIds ? [...(data.artworkIds as string[])] : [];
      const preUploadedBaseFileIds = (data as any).baseFileIds ? [...((data as any).baseFileIds as string[])] : [];
      const artworkStatusesMap = (data as any).artworkStatuses || null;

      this.logger.log(`[Task Create] Incoming data keys: ${Object.keys(data).join(', ')}`);
      this.logger.log(`[Task Create] preUploadedArtworkFileIds: ${JSON.stringify(preUploadedArtworkFileIds)}`);
      this.logger.log(`[Task Create] preUploadedBaseFileIds: ${JSON.stringify(preUploadedBaseFileIds)}`);
      this.logger.log(`[Task Create] artworkStatusesMap: ${JSON.stringify(artworkStatusesMap)}`);

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

        // artworkIds/baseFileIds connection is handled AFTER task creation (post-create update).
        // Strip them from data before repository processing because:
        // - artworkIds are File IDs but mapCreateFormDataToDatabaseCreateInput tries to connect them as Artwork entity IDs
        // - baseFileIds are stripped too to avoid double-processing (post-create update handles them)
        // Create the task first
        // Add createdById to data for service orders creation
        const dataWithCreator = { ...data, createdById: userId } as typeof data;
        delete (dataWithCreator as any).artworkIds;
        delete (dataWithCreator as any).baseFileIds;
        delete (dataWithCreator as any).artworkStatuses;
        const newTask = await this.tasksRepository.createWithTransaction(tx, dataWithCreator, {
          include,
        });

        // ======= EXPLICIT POST-CREATION: Connect pre-uploaded artworks and base files =======
        // This guarantees the connection happens even if mapCreateFormDataToDatabaseCreateInput
        // doesn't handle these fields (e.g., when sent as JSON from serial range creation).
        this.logger.log(`[Task Create] Post-creation check: artworkFileIds=${preUploadedArtworkFileIds.length}, baseFileIds=${preUploadedBaseFileIds.length}`);
        if (preUploadedArtworkFileIds.length > 0 || preUploadedBaseFileIds.length > 0) {
          const postCreateUpdates: any = {};

          // Convert artwork File IDs to Artwork entity IDs and connect
          if (preUploadedArtworkFileIds.length > 0) {
            const artworkEntityIds = await this.convertFileIdsToArtworkIds(
              preUploadedArtworkFileIds,
              null,
              null,
              artworkStatusesMap,
              undefined,
              tx,
            );
            if (artworkEntityIds.length > 0) {
              postCreateUpdates.artworks = { connect: artworkEntityIds.map(id => ({ id })) };
            }
          }

          // Connect base files directly (they're already File IDs)
          if (preUploadedBaseFileIds.length > 0) {
            postCreateUpdates.baseFiles = { connect: preUploadedBaseFileIds.map(id => ({ id })) };
          }

          if (Object.keys(postCreateUpdates).length > 0) {
            await tx.task.update({
              where: { id: newTask.id },
              data: postCreateUpdates,
            });

          }
        }

        // Handle truck layouts: either create NEW layouts or connect to EXISTING shared layouts
        // Note: Basic truck creation (plate, chassisNumber, spot, category, implementType) is handled by the repository
        const truckData = (data as any).truck;
        const hasLayouts =
          truckData &&
          (truckData.leftSideLayout || truckData.rightSideLayout || truckData.backSideLayout);
        const hasSharedLayoutIds =
          truckData &&
          (truckData.leftSideLayoutId || truckData.rightSideLayoutId || truckData.backSideLayoutId);

        if (hasSharedLayoutIds && !hasLayouts) {
          // Connect to existing shared layouts (for batch creation - reuse layouts from first task)
          this.logger.log(`[Task Create] Connecting shared layouts for task ${newTask.id}`);
          const truck = await tx.truck.findUnique({ where: { taskId: newTask.id } });
          if (truck) {
            await tx.truck.update({
              where: { id: truck.id },
              data: {
                ...(truckData.leftSideLayoutId && { leftSideLayoutId: truckData.leftSideLayoutId }),
                ...(truckData.rightSideLayoutId && { rightSideLayoutId: truckData.rightSideLayoutId }),
                ...(truckData.backSideLayoutId && { backSideLayoutId: truckData.backSideLayoutId }),
              },
            });
            this.logger.log(`[Task Create] Shared layouts connected to truck ${truck.id}`);
          }
        } else if (hasLayouts) {
          this.logger.log(`[Task Create] Creating truck with layouts for task ${newTask.id}`);

          // Find the truck already created by the repository (via nested create)
          let truck = await tx.truck.findUnique({ where: { taskId: newTask.id } });
          if (!truck) {
            // Fallback: create truck if repository didn't create one (e.g., no basic truck fields were provided)
            truck = await tx.truck.create({
              data: {
                taskId: newTask.id,
                plate: truckData.plate || null,
                chassisNumber: truckData.chassisNumber || null,
                spot: truckData.spot || null,
              },
            });
          }
          this.logger.log(`[Task Create] Truck found/created: ${truck.id}`);

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

            this.logger.log(
              `[Task Create] ${sideName} layout created: ${layout.id} with changelog`,
            );
          };

          // Create layouts for each side using the new consolidated format
          await createLayout(truckData.leftSideLayout, 'leftSideLayoutId', 'left');
          await createLayout(truckData.rightSideLayout, 'rightSideLayoutId', 'right');
          await createLayout(truckData.backSideLayout, 'backSideLayoutId', 'back');

          this.logger.log(`[Task Create] Layouts created for truck ${truck.id}`);
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

          // Artwork files - Create File entities and then Artwork entities
          if (files.artworks && files.artworks.length > 0) {
            const artworkEntityIds: string[] = [];
            for (const artworkFile of files.artworks) {
              // First, create the File entity
              const fileRecord = await this.fileService.createFromUploadWithTransaction(
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
              // Then, create the Artwork entity that references this File
              const artworkEntityId = await this.createArtworkForFile(
                fileRecord,
                newTask.id,
                null,
                'DRAFT', // Default status for new uploads
                tx,
              );
              artworkEntityIds.push(artworkEntityId);
            }
            // Connect Artwork entities (not File entities) to the Task
            fileUpdates.artworks = { connect: artworkEntityIds.map(id => ({ id })) };
          }

          // Base files (files used as base for artwork design)
          // Files are renamed to match task name with measures format
          if (files.baseFiles && files.baseFiles.length > 0) {
            const baseFileIds: string[] = [];

            // Get task name for file renaming
            const taskNameForFile = newTask.name || 'Tarefa';

            // Construct task-like object with truck layout data for measures calculation
            // The truck layouts come from the input data (truckData)
            const taskWithTruck = {
              truck: truckData
                ? {
                    leftSideLayout: truckData.leftSideLayout || null,
                    rightSideLayout: truckData.rightSideLayout || null,
                  }
                : null,
            };

            for (let i = 0; i < files.baseFiles.length; i++) {
              const baseFile = files.baseFiles[i];

              // Generate new filename with task name and measures
              // Pass file index (1-based) to add suffix for multiple files
              const newFilename = generateBaseFileName(
                taskNameForFile,
                taskWithTruck,
                baseFile.originalname,
                i + 1, // 1-based index for file numbering
              );

              this.logger.log(
                `[Task Create] Renaming base file from "${baseFile.originalname}" to "${newFilename}"`,
              );

              // Update the file's originalname before upload
              baseFile.originalname = newFilename;

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

              // For artworks, we need to create both File AND Artwork entities
              if (fileType === 'artworks') {
                const artworkEntityIds: string[] = [];
                for (const file of airbrushingFiles) {
                  // Create File entity
                  const fileRecord = await this.fileService.createFromUploadWithTransaction(
                    tx,
                    file,
                    'airbrushingArtworks',
                    userId,
                    {
                      entityId: airbrushing.id,
                      entityType: 'AIRBRUSHING',
                      customerName,
                    },
                  );
                  // Create Artwork entity
                  const artworkEntityId = await this.createArtworkForFile(
                    fileRecord,
                    null,
                    airbrushing.id,
                    'DRAFT', // Default status for airbrushing uploads
                    tx,
                  );
                  artworkEntityIds.push(artworkEntityId);
                }

                // Update the airbrushing with Artwork entity IDs
                if (artworkEntityIds.length > 0) {
                  await tx.airbrushing.update({
                    where: { id: airbrushing.id },
                    data: {
                      artworks: { connect: artworkEntityIds.map(id => ({ id })) },
                    },
                  });
                  console.log(
                    `[TaskService] Connected ${artworkEntityIds.length} Artwork entities to airbrushing ${airbrushing.id}`,
                  );
                }
              } else {
                // For receipts and invoices, handle as before (File entities only)
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

        // Re-fetch task if layouts or artworks/baseFiles were created/connected so response includes them
        if (hasLayouts || hasSharedLayoutIds || preUploadedArtworkFileIds.length > 0 || preUploadedBaseFileIds.length > 0) {
          const refetchedTask = await this.tasksRepository.findByIdWithTransaction(
            tx,
            newTask.id,
            include,
          );
          if (refetchedTask) return refetchedTask;
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
      baseFiles?: Express.Multer.File[];
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

        // Pre-create shared layouts if layout data is present (for serial range / batch creation)
        // This prevents duplicate layout creation for each task
        const sharedLayoutIds: {
          leftSideLayoutId: string | null;
          rightSideLayoutId: string | null;
          backSideLayoutId: string | null;
        } = { leftSideLayoutId: null, rightSideLayoutId: null, backSideLayoutId: null };
        let hasSharedLayouts = false;

        if (data.tasks.length > 0) {
          const firstTruckData = (data.tasks[0] as any).truck;
          const hasLayoutData = firstTruckData &&
            (firstTruckData.leftSideLayout || firstTruckData.rightSideLayout || firstTruckData.backSideLayout);

          if (hasLayoutData) {
            this.logger.log('[batchCreate] Pre-creating shared layouts from first task data');

            const createSharedLayout = async (layoutData: any, sideName: string): Promise<string | null> => {
              if (!layoutData || !layoutData.layoutSections) return null;
              const layout = await tx.layout.create({
                data: {
                  height: layoutData.height,
                  ...(layoutData.photoId && { photo: { connect: { id: layoutData.photoId } } }),
                  layoutSections: {
                    create: layoutData.layoutSections.map((section: any, idx: number) => ({
                      width: section.width,
                      isDoor: section.isDoor,
                      doorHeight: section.doorHeight,
                      position: section.position ?? idx,
                    })),
                  },
                },
              });
              this.logger.log(`[batchCreate] Shared ${sideName} layout created: ${layout.id}`);
              return layout.id;
            };

            sharedLayoutIds.leftSideLayoutId = await createSharedLayout(firstTruckData.leftSideLayout, 'left');
            sharedLayoutIds.rightSideLayoutId = await createSharedLayout(firstTruckData.rightSideLayout, 'right');
            sharedLayoutIds.backSideLayoutId = await createSharedLayout(firstTruckData.backSideLayout, 'back');
            hasSharedLayouts = !!(sharedLayoutIds.leftSideLayoutId || sharedLayoutIds.rightSideLayoutId || sharedLayoutIds.backSideLayoutId);

            if (hasSharedLayouts) {
              // Replace layout DATA with layout IDs in all tasks so they connect instead of create
              for (const task of data.tasks) {
                const truckData = (task as any).truck;
                if (truckData) {
                  delete truckData.leftSideLayout;
                  delete truckData.rightSideLayout;
                  delete truckData.backSideLayout;
                  if (sharedLayoutIds.leftSideLayoutId) truckData.leftSideLayoutId = sharedLayoutIds.leftSideLayoutId;
                  if (sharedLayoutIds.rightSideLayoutId) truckData.rightSideLayoutId = sharedLayoutIds.rightSideLayoutId;
                  if (sharedLayoutIds.backSideLayoutId) truckData.backSideLayoutId = sharedLayoutIds.backSideLayoutId;
                }
              }
              this.logger.log(`[batchCreate] Layout IDs injected into ${data.tasks.length} tasks`);
            }
          }
        }

        // Pre-convert artworkIds from File IDs to Artwork entity IDs
        // The web create form pre-uploads artwork files and sends File IDs as artworkIds.
        // The repository expects Artwork entity IDs, so we need to convert them first.
        // We do this ONCE and share the Artwork entities across all tasks (shared artworks).
        if (data.tasks.length > 0 && (data.tasks[0] as any).artworkIds?.length > 0) {
          const fileIds = (data.tasks[0] as any).artworkIds as string[];
          const batchArtworkStatuses = (data.tasks[0] as any).artworkStatuses || undefined;
          this.logger.log(`[batchCreate] Converting ${fileIds.length} artwork File IDs to Artwork entity IDs`);
          const artworkEntityIds = await this.convertFileIdsToArtworkIds(
            fileIds,
            null,
            null,
            batchArtworkStatuses,
            undefined,
            tx,
          );
          this.logger.log(`[batchCreate] Converted to ${artworkEntityIds.length} Artwork entity IDs`);
          // Replace File IDs with Artwork entity IDs in all tasks
          // and remove artworkStatuses (already processed above)
          for (const task of data.tasks) {
            (task as any).artworkIds = artworkEntityIds;
            delete (task as any).artworkStatuses;
          }
        }

        for (const [index, task] of data.tasks.entries()) {
          try {
            // Validate task
            await this.validateTask(task, undefined, tx);

            // Create the task with createdById for service orders
            const taskWithCreator = { ...task, createdById: userId } as typeof task;
            const createdTask = await this.tasksRepository.createWithTransaction(
              tx,
              taskWithCreator,
              {
                include,
              },
            );

            // Connect shared layouts to the truck (repository doesn't handle layout IDs)
            if (hasSharedLayouts) {
              const truck = await tx.truck.findUnique({ where: { taskId: createdTask.id } });
              if (truck) {
                const layoutUpdate: any = {};
                if (sharedLayoutIds.leftSideLayoutId) layoutUpdate.leftSideLayoutId = sharedLayoutIds.leftSideLayoutId;
                if (sharedLayoutIds.rightSideLayoutId) layoutUpdate.rightSideLayoutId = sharedLayoutIds.rightSideLayoutId;
                if (sharedLayoutIds.backSideLayoutId) layoutUpdate.backSideLayoutId = sharedLayoutIds.backSideLayoutId;
                if (Object.keys(layoutUpdate).length > 0) {
                  await tx.truck.update({ where: { id: truck.id }, data: layoutUpdate });
                  this.logger.log(`[batchCreate] Connected shared layouts to truck ${truck.id} for task ${createdTask.id}`);
                }
              }
            }

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
      pricingLayoutFile?: Express.Multer.File[];
    },
  ): Promise<TaskUpdateResponse> {
    try {
      // DEBUG: Log what data actually enters the service
      this.logger.log('[Task Update] === SERVICE METHOD ENTRY ===');
      this.logger.log('[Task Update] Full data received:', JSON.stringify(data, null, 2));
      this.logger.log(`[Task Update] customerId: ${data.customerId}`);
      this.logger.log(`[Task Update] pricing: ${JSON.stringify((data as any).pricing)}`);
      this.logger.log('[Task Update] === END SERVICE METHOD ENTRY ===');

      // Track if task was auto-transitioned to WAITING_PRODUCTION for notification after transaction
      let taskAutoTransitionedToWaitingProduction = false;

      const transactionResult = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get existing task - always include customer for file organization
        // Also include file relations for changelog tracking
        // Include truck layouts with sections for file naming with measures
        const existingTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
          include: {
            ...include,
            customer: true, // Always include customer for file path organization
            artworks: {
              include: {
                file: {
                  select: {
                    id: true,
                    filename: true,
                    thumbnailUrl: true,
                  },
                },
              },
            }, // Include for changelog tracking with file info
            baseFiles: true, // Include for changelog tracking
            logoPaints: true, // Include for changelog tracking
            observation: { include: { files: true } }, // Include for changelog tracking
            truck: {
              include: {
                leftSideLayout: { include: { layoutSections: true } },
                rightSideLayout: { include: { layoutSections: true } },
              },
            }, // Include truck with layouts for file naming with measures
            serviceOrders: true, // Include for services field changelog tracking
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
              const truck = existingTask.truck;

              // Helper: only delete a layout if no other trucks reference it
              const safeDeleteLayout = async (
                layoutId: string,
                relationName: 'trucksLeftSide' | 'trucksRightSide' | 'trucksBackSide',
                fieldName: string,
              ) => {
                // Count how many trucks reference this layout (excluding the one being deleted)
                const layout = await tx.layout.findUnique({
                  where: { id: layoutId },
                  include: { layoutSections: true, [relationName]: { select: { id: true } } },
                });
                if (!layout) return;

                const referencingTrucks = (layout as any)[relationName] || [];
                const otherTrucks = referencingTrucks.filter((t: any) => t.id !== truck.id);

                if (otherTrucks.length === 0) {
                  // No other trucks reference this layout - safe to delete
                  await tx.layoutSection.deleteMany({ where: { layoutId } });
                  await tx.layout.delete({ where: { id: layoutId } });
                  await logEntityChange({
                    changeLogService: this.changeLogService,
                    entityType: ENTITY_TYPE.LAYOUT,
                    entityId: layoutId,
                    action: CHANGE_ACTION.DELETE,
                    entity: layout,
                    userId: userId || '',
                    triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                    reason: `Layout ${fieldName} removido (caminhão deletado)`,
                    transaction: tx,
                  });
                } else {
                  this.logger.log(
                    `[Task Update] Layout ${layoutId} shared by ${otherTrucks.length} other truck(s), skipping deletion`,
                  );
                }
              };

              if (truck.leftSideLayoutId) {
                await safeDeleteLayout(truck.leftSideLayoutId, 'trucksLeftSide', 'leftSideLayoutId');
              }
              if (truck.rightSideLayoutId) {
                await safeDeleteLayout(truck.rightSideLayoutId, 'trucksRightSide', 'rightSideLayoutId');
              }
              if (truck.backSideLayoutId) {
                await safeDeleteLayout(truck.backSideLayoutId, 'trucksBackSide', 'backSideLayoutId');
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
                  category: truckData.category || null,
                  implementType: truckData.implementType || null,
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
              if (truckData.category !== undefined) updateFields.category = truckData.category;
              if (truckData.implementType !== undefined)
                updateFields.implementType = truckData.implementType;
              if (truckData.spot !== undefined) updateFields.spot = truckData.spot;

              if (Object.keys(updateFields).length > 0) {
                const updatedTruck = await tx.truck.update({
                  where: { id: truckId },
                  data: updateFields,
                });
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
                      reason: `Caminhão atualizado`,
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
                // Remove layout from this truck
                if (existingLayoutId) {
                  this.logger.log(`[Task Update] Removing ${layoutField} from truck`);

                  // Disconnect this truck from the layout first
                  await tx.truck.update({ where: { id: truckId! }, data: { [layoutField]: null } });

                  // Check if other trucks still reference this layout
                  const relationName = layoutField === 'leftSideLayoutId' ? 'trucksLeftSide'
                    : layoutField === 'rightSideLayoutId' ? 'trucksRightSide' : 'trucksBackSide';
                  const layoutWithRefs = await tx.layout.findUnique({
                    where: { id: existingLayoutId },
                    include: { layoutSections: true, [relationName]: { select: { id: true } } },
                  });

                  if (layoutWithRefs) {
                    const remainingTrucks = (layoutWithRefs as any)[relationName] || [];
                    if (remainingTrucks.length === 0) {
                      // No other trucks reference this layout - safe to delete
                      await tx.layoutSection.deleteMany({ where: { layoutId: existingLayoutId } });
                      await tx.layout.delete({ where: { id: existingLayoutId } });

                      await logEntityChange({
                        changeLogService: this.changeLogService,
                        entityType: ENTITY_TYPE.LAYOUT,
                        entityId: existingLayoutId,
                        action: CHANGE_ACTION.DELETE,
                        entity: layoutWithRefs,
                        userId: userId || '',
                        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                        reason: `Layout ${layoutField} removido`,
                        transaction: tx,
                      });
                      this.logger.log(`[Task Update] Deleted ${layoutField} (no other references)`);
                    } else {
                      this.logger.log(
                        `[Task Update] Layout ${existingLayoutId} still shared by ${remainingTrucks.length} truck(s), only disconnected`,
                      );
                    }
                  }
                }
              } else {
                // Create or update layout
                if (existingLayoutId) {
                  // Get layout details before update for changelog
                  const existingLayout = await tx.layout.findUnique({
                    where: { id: existingLayoutId },
                    include: { layoutSections: true },
                  });

                  // Update in-place: replace sections but keep the same Layout record
                  // This preserves shared layout references (multiple trucks pointing to same layout)
                  await tx.layoutSection.deleteMany({ where: { layoutId: existingLayoutId } });
                  const updatedLayout = await tx.layout.update({
                    where: { id: existingLayoutId },
                    data: {
                      height: layoutData.height,
                      photoId: layoutData.photoId || null,
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

                  // Create changelog for layout update
                  await logEntityChange({
                    changeLogService: this.changeLogService,
                    entityType: ENTITY_TYPE.LAYOUT,
                    entityId: existingLayoutId,
                    action: CHANGE_ACTION.UPDATE,
                    entity: updatedLayout,
                    userId: userId || '',
                    triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                    reason: `Layout ${layoutField} atualizado`,
                    transaction: tx,
                  });

                  this.logger.log(
                    `[Task Update] ${layoutField} updated in-place: ${existingLayoutId} with changelog`,
                  );
                } else {
                  // No existing layout - create new one
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
                    reason: `Layout ${layoutField} criado`,
                    transaction: tx,
                  });

                  this.logger.log(
                    `[Task Update] ${layoutField} created: ${newLayout.id} with changelog`,
                  );
                }
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
          const fromStatus = existingTask.status as TASK_STATUS;
          const toStatus = data.status as TASK_STATUS;

          if (!isValidTaskStatusTransition(fromStatus, toStatus)) {
            throw new BadRequestException(
              `Transição de status inválida: ${getTaskStatusLabel(fromStatus)} → ${getTaskStatusLabel(toStatus)}`,
            );
          }

          // Additional validation for PREPARATION → IN_PRODUCTION
          // This transition requires all ARTWORK service orders to be completed
          if (fromStatus === TASK_STATUS.PREPARATION && toStatus === TASK_STATUS.IN_PRODUCTION) {
            // Build the final state of artwork service orders by merging existing with updates
            const existingArtworkSOs =
              existingTask.serviceOrders?.filter(
                (so: any) => so.type === SERVICE_ORDER_TYPE.ARTWORK,
              ) || [];

            // If user is submitting service order updates, apply them to get final state
            let finalArtworkSOs: ServiceOrder[] = existingArtworkSOs;
            if (data.serviceOrders && Array.isArray(data.serviceOrders)) {
              finalArtworkSOs = existingArtworkSOs.map(existingSO => {
                const update = data.serviceOrders!.find((so: any) => so.id === existingSO.id);
                if (update && update.status) {
                  // User is updating this service order's status
                  return { ...existingSO, status: update.status as SERVICE_ORDER_STATUS };
                }
                return existingSO;
              });
            }

            if (finalArtworkSOs.length > 0) {
              const incompleteArtworks = finalArtworkSOs.filter(
                (so: any) => so.status !== SERVICE_ORDER_STATUS.COMPLETED,
              );

              if (incompleteArtworks.length > 0) {
                this.logger.warn(
                  `[VALIDATION] User attempted PREPARATION → IN_PRODUCTION with ${incompleteArtworks.length} incomplete artwork(s). IDs: ${incompleteArtworks.map((so: any) => so.id).join(', ')}`,
                );
                throw new BadRequestException(
                  `Não é possível iniciar produção: ${incompleteArtworks.length} ordem(ns) de serviço de arte ainda não foi(ram) concluída(s). Complete todas as artes antes de iniciar a produção.`,
                );
              }
            }
          }

          // Auto-fill date requirements based on status transition
          // Instead of throwing an error, automatically set the required dates
          if (
            toStatus === TASK_STATUS.IN_PRODUCTION &&
            !existingTask.startedAt &&
            !data.startedAt
          ) {
            this.logger.log(
              `[AUTO-FILL] Auto-setting startedAt for task ${id} (status → IN_PRODUCTION)`,
            );
            data.startedAt = new Date();
          }
          if (toStatus === TASK_STATUS.COMPLETED && !existingTask.finishedAt && !data.finishedAt) {
            this.logger.log(
              `[AUTO-FILL] Auto-setting finishedAt for task ${id} (status → COMPLETED)`,
            );
            data.finishedAt = new Date();
            // Also auto-fill startedAt if it's not set (task going directly to completed)
            if (!existingTask.startedAt && !data.startedAt) {
              this.logger.log(
                `[AUTO-FILL] Auto-setting startedAt for task ${id} (completing without start date)`,
              );
              data.startedAt = new Date();
            }
          }
        }

        // =====================
        // DATE CASCADING SYNC LOGIC
        // =====================
        // Priority order: forecastDate (lowest) → entryDate → startedAt (highest)
        // When a higher priority date is set, auto-fill lower priority dates if not set
        // Higher priority dates are NEVER affected by lower priority date changes

        // Get the final values being used (prefer data over existing)
        const finalStartedAt = data.startedAt ?? existingTask.startedAt;
        const finalEntryDate = data.entryDate ?? existingTask.entryDate;
        const finalForecastDate = data.forecastDate ?? existingTask.forecastDate;

        // When startedAt is being set (explicitly or via status change)
        if (data.startedAt) {
          // Auto-fill entryDate if not set
          if (!existingTask.entryDate && !data.entryDate) {
            this.logger.log(
              `[DATE-SYNC] Auto-setting entryDate for task ${id} (startedAt is being set)`,
            );
            data.entryDate = data.startedAt;
          }
          // Auto-fill forecastDate if not set
          if (!existingTask.forecastDate && !data.forecastDate) {
            this.logger.log(
              `[DATE-SYNC] Auto-setting forecastDate for task ${id} (startedAt is being set)`,
            );
            data.forecastDate = data.startedAt;
          }
        }

        // When entryDate is being set (and startedAt was not just set)
        if (data.entryDate && !data.startedAt) {
          // Auto-fill forecastDate if not set
          if (!existingTask.forecastDate && !data.forecastDate) {
            this.logger.log(
              `[DATE-SYNC] Auto-setting forecastDate for task ${id} (entryDate is being set)`,
            );
            data.forecastDate = data.entryDate;
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

        // Process pricing layout file BEFORE task update (to get the file ID for pricing)
        if (
          files?.pricingLayoutFile &&
          files.pricingLayoutFile.length > 0 &&
          (data as any).pricing
        ) {
          console.log('[TaskService] Processing pricing layout file');
          const customerName = existingTask.customer?.fantasyName;

          const layoutFile = files.pricingLayoutFile[0];
          const fileRecord = await this.fileService.createFromUploadWithTransaction(
            tx,
            layoutFile,
            'pricing-layouts',
            userId,
            {
              entityId: id,
              entityType: 'PRICING_LAYOUT',
              customerName,
            },
          );
          console.log('[TaskService] Uploaded pricing layout file:', fileRecord.id);

          // Set the layoutFileId in the pricing data
          (data as any).pricing.layoutFileId = fileRecord.id;
        }

        // Extract service orders from data to handle them explicitly
        // This prevents Prisma from doing a silent nested create without events/changelogs
        const serviceOrdersData = (data as any).serviceOrders;
        const createdServiceOrders: any[] = [];
        const observationChangedSOs: Array<{ serviceOrder: any; oldObservation: string | null }> = [];

        // Ensure statusOrder and commissionOrder are updated when status/commission changes
        const updateData = {
          ...data,
          ...(data.status && { statusOrder: getTaskStatusOrder(data.status as TASK_STATUS) }),
          ...((data as any).commission && { commissionOrder: getCommissionStatusOrder((data as any).commission) }),
        };

        // CRITICAL: Check for artwork data BEFORE deleting fields
        // This flag determines if file processing block should run
        const hasArtworkData =
          !!(updateData as any).artworkIds ||
          !!(updateData as any).fileIds ||
          !!(updateData as any).artworkStatuses;

        // Remove service orders from updateData to prevent Prisma nested create
        // We'll handle them explicitly below (serviceOrdersData was already extracted at line 1393)
        delete (updateData as any).serviceOrders;

        // Extract airbrushings data - we'll handle updates/creates explicitly
        // The repository only handles deletions (via notIn), preserving existing airbrushings and their artworks
        const airbrushingsData = (updateData as any).airbrushings;

        // CRITICAL FIX: Remove artwork-related fields from updateData
        // These will be handled explicitly in the file processing section below (around line 1665)
        delete (updateData as any).artworkIds;
        delete (updateData as any).artworkStatuses;
        delete (updateData as any).newArtworkStatuses;
        delete (updateData as any).fileIds; // Legacy field name for artworkIds

        // Update the task - always include customer for file organization
        // Also include file relations for changelog tracking
        let updatedTask = await this.tasksRepository.updateWithTransaction(
          tx,
          id,
          updateData,
          {
            include: {
              ...include,
              customer: true, // Always include customer for file path organization
              artworks: {
                include: {
                  file: {
                    select: {
                      id: true,
                      filename: true,
                      thumbnailUrl: true,
                    },
                  },
                },
              }, // Include for changelog tracking with file info
              baseFiles: true, // Include for changelog tracking
              logoPaints: true, // Include for changelog tracking
              observation: { include: { files: true } }, // Include for changelog tracking
              truck: true, // Include for truck field changelog tracking
              serviceOrders: true, // Include for services field changelog tracking
              airbrushings: true, // Include for airbrushing file uploads
            },
          },
          userId,
        );

        // Handle service orders explicitly if provided
        // FIX: Implement proper upsert logic - update existing service orders instead of always creating new ones
        // NOTE: If serviceOrdersData is provided as an array (even empty), we process deletions
        // If serviceOrdersData is undefined/null, service orders are not being modified
        if (serviceOrdersData && Array.isArray(serviceOrdersData)) {
          this.logger.log(
            `[Task Update] Processing ${serviceOrdersData.length} service orders for task ${id}`,
          );
          this.logger.log(
            `[Task Update] Service orders data (with observation): ${JSON.stringify(serviceOrdersData.map((so: any) => ({ id: so.id, description: so.description, type: so.type, observation: so.observation })))}`,
          );

          // Get all existing service orders for this task to handle duplicates and deletions
          const existingServiceOrders = await tx.serviceOrder.findMany({
            where: { taskId: id },
          });
          this.logger.log(
            `[Task Update] Found ${existingServiceOrders.length} existing service orders for task`,
          );

          // Process creates/updates for each service order in the submitted data
          for (const serviceOrderData of serviceOrdersData) {
            // Check if this is an existing service order (has an ID) or a new one
            if (serviceOrderData.id) {
              // UPDATE existing service order - preserve existing data
              this.logger.log(
                `[Task Update] Updating existing service order ${serviceOrderData.id}`,
              );

              // Get the old service order data for changelog
              const oldServiceOrder = await tx.serviceOrder.findUnique({
                where: { id: serviceOrderData.id },
              });

              if (oldServiceOrder) {
                // Only update fields that are explicitly provided
                const updatePayload: any = {};
                if (serviceOrderData.type !== undefined) updatePayload.type = serviceOrderData.type;
                if (serviceOrderData.status !== undefined)
                  updatePayload.status = serviceOrderData.status;
                if (serviceOrderData.description !== undefined)
                  updatePayload.description = serviceOrderData.description;
                if (serviceOrderData.observation !== undefined)
                  updatePayload.observation = serviceOrderData.observation;
                if (serviceOrderData.assignedToId !== undefined)
                  updatePayload.assignedToId = serviceOrderData.assignedToId;

                // Handle date setting/clearing for status transitions
                if (
                  serviceOrderData.status !== undefined &&
                  serviceOrderData.status !== oldServiceOrder.status
                ) {
                  const oldStatus = oldServiceOrder.status as SERVICE_ORDER_STATUS;
                  const newStatus = serviceOrderData.status as SERVICE_ORDER_STATUS;

                  // If transitioning to IN_PROGRESS, set startedAt/startedById if not already set
                  if (
                    newStatus === SERVICE_ORDER_STATUS.IN_PROGRESS &&
                    oldStatus !== SERVICE_ORDER_STATUS.IN_PROGRESS
                  ) {
                    if (!oldServiceOrder.startedById) {
                      updatePayload.startedById = userId || null;
                      updatePayload.startedAt = new Date();
                    }
                  }

                  // If transitioning to COMPLETED, set completedBy/finishedAt and startedAt if not already set
                  if (
                    newStatus === SERVICE_ORDER_STATUS.COMPLETED &&
                    oldStatus !== SERVICE_ORDER_STATUS.COMPLETED
                  ) {
                    if (!oldServiceOrder.completedById) {
                      updatePayload.completedById = userId || null;
                      updatePayload.finishedAt = new Date();
                    }
                    // Also set startedAt/startedById if not already set (e.g., skipped IN_PROGRESS)
                    if (!oldServiceOrder.startedById) {
                      updatePayload.startedById = userId || null;
                      updatePayload.startedAt = updatePayload.finishedAt || new Date();
                    }
                  }

                  // If rolling back to PENDING, clear all progress dates
                  if (
                    newStatus === SERVICE_ORDER_STATUS.PENDING &&
                    oldStatus !== SERVICE_ORDER_STATUS.PENDING
                  ) {
                    this.logger.log(
                      `[Task Update] Clearing dates for SO ${serviceOrderData.id}: ${oldStatus} → PENDING`,
                    );
                    updatePayload.startedById = null;
                    updatePayload.startedAt = null;
                    updatePayload.approvedById = null;
                    updatePayload.approvedAt = null;
                    updatePayload.completedById = null;
                    updatePayload.finishedAt = null;
                  }
                  // If rolling back from COMPLETED to IN_PROGRESS, clear completion dates
                  else if (
                    newStatus === SERVICE_ORDER_STATUS.IN_PROGRESS &&
                    oldStatus === SERVICE_ORDER_STATUS.COMPLETED
                  ) {
                    this.logger.log(
                      `[Task Update] Clearing completion dates for SO ${serviceOrderData.id}: COMPLETED → IN_PROGRESS`,
                    );
                    updatePayload.completedById = null;
                    updatePayload.finishedAt = null;
                  }
                }

                // Only update if there are actual changes
                if (Object.keys(updatePayload).length > 0) {
                  const updatedServiceOrder = await tx.serviceOrder.update({
                    where: { id: serviceOrderData.id },
                    data: updatePayload,
                  });

                  createdServiceOrders.push(updatedServiceOrder);

                  // Track observation changes for post-transaction event emission
                  if (
                    serviceOrderData.observation !== undefined &&
                    oldServiceOrder.observation !== updatedServiceOrder.observation
                  ) {
                    observationChangedSOs.push({
                      serviceOrder: updatedServiceOrder,
                      oldObservation: oldServiceOrder.observation,
                    });
                  }

                  // Create changelog for service order update with field tracking
                  await trackAndLogFieldChanges({
                    changeLogService: this.changeLogService,
                    entityType: ENTITY_TYPE.SERVICE_ORDER,
                    entityId: serviceOrderData.id,
                    oldEntity: oldServiceOrder,
                    newEntity: updatedServiceOrder,
                    fieldsToTrack: [
                      'status',
                      'description',
                      'observation',
                      'type',
                      'assignedToId',
                      'startedAt',
                      'startedById',
                      'approvedAt',
                      'approvedById',
                      'finishedAt',
                      'completedById',
                    ],
                    userId: userId || '',
                    triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                    transaction: tx,
                  });

                  this.logger.log(
                    `[Task Update] Updated service order ${serviceOrderData.id} (${updatedServiceOrder.type})`,
                  );

                  // =====================================================================
                  // ARTWORK SYNC: Check if artwork status change should update task status
                  // =====================================================================
                  if (
                    serviceOrderData.status !== undefined &&
                    serviceOrderData.status !== oldServiceOrder.status &&
                    updatedServiceOrder.type === SERVICE_ORDER_TYPE.ARTWORK
                  ) {
                    // Get current task status
                    const currentTask = await tx.task.findUnique({
                      where: { id },
                      select: { id: true, status: true },
                    });

                    if (currentTask) {
                      // Get all service orders with their current statuses (including this update)
                      const allServiceOrders = await tx.serviceOrder.findMany({
                        where: { taskId: id },
                        select: { id: true, status: true, type: true },
                      });

                      const artworkSyncResult = getTaskUpdateForArtworkServiceOrderStatusChange(
                        allServiceOrders.map(so => ({
                          id: so.id,
                          status: so.status as SERVICE_ORDER_STATUS,
                          type: so.type as SERVICE_ORDER_TYPE,
                        })),
                        updatedServiceOrder.id,
                        oldServiceOrder.status as SERVICE_ORDER_STATUS,
                        updatedServiceOrder.status as SERVICE_ORDER_STATUS,
                        updatedServiceOrder.type as SERVICE_ORDER_TYPE,
                        currentTask.status as TASK_STATUS,
                      );

                      if (artworkSyncResult?.shouldUpdate) {
                        this.logger.log(
                          `[ARTWORK→TASK SYNC] Artwork SO ${updatedServiceOrder.id} status changed, updating task ${id}: ${currentTask.status} → ${artworkSyncResult.newTaskStatus}`,
                        );

                        await tx.task.update({
                          where: { id },
                          data: {
                            status: artworkSyncResult.newTaskStatus,
                            statusOrder: getTaskStatusOrder(artworkSyncResult.newTaskStatus),
                          },
                        });

                        // Log the auto-transition in changelog
                        await this.changeLogService.logChange({
                          entityType: ENTITY_TYPE.TASK,
                          entityId: id,
                          action: CHANGE_ACTION.UPDATE,
                          field: 'status',
                          oldValue: currentTask.status,
                          newValue: artworkSyncResult.newTaskStatus,
                          reason: artworkSyncResult.reason,
                          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                          triggeredById: updatedServiceOrder.id,
                          userId: userId || '',
                          transaction: tx,
                        });
                      }
                    }
                  }
                } else {
                  // No changes, just add existing service order to the result
                  createdServiceOrders.push(oldServiceOrder);
                  this.logger.log(
                    `[Task Update] No changes for service order ${serviceOrderData.id}`,
                  );
                }
              } else {
                this.logger.warn(
                  `[Task Update] Service order ${serviceOrderData.id} not found, skipping update`,
                );
              }
            } else {
              // No ID provided - check if this service order already exists (prevent duplicates)
              // Match by description AND type for this task
              const existingMatch = existingServiceOrders.find(
                so =>
                  so.description === serviceOrderData.description &&
                  so.type === serviceOrderData.type,
              );

              if (existingMatch) {
                // UPDATE existing service order (found by description+type match)
                this.logger.log(
                  `[Task Update] Found existing service order by description+type match: ${existingMatch.id}`,
                );

                const updatePayload: any = {};
                if (
                  serviceOrderData.status !== undefined &&
                  serviceOrderData.status !== existingMatch.status
                ) {
                  updatePayload.status = serviceOrderData.status;
                }
                if (
                  serviceOrderData.observation !== undefined &&
                  serviceOrderData.observation !== existingMatch.observation
                ) {
                  updatePayload.observation = serviceOrderData.observation;
                }
                if (
                  serviceOrderData.assignedToId !== undefined &&
                  serviceOrderData.assignedToId !== existingMatch.assignedToId
                ) {
                  updatePayload.assignedToId = serviceOrderData.assignedToId;
                }

                // Handle date setting/clearing for status transitions
                if (
                  serviceOrderData.status !== undefined &&
                  serviceOrderData.status !== existingMatch.status
                ) {
                  const oldStatus = existingMatch.status as SERVICE_ORDER_STATUS;
                  const newStatus = serviceOrderData.status as SERVICE_ORDER_STATUS;

                  // If transitioning to IN_PROGRESS, set startedAt/startedById if not already set
                  if (
                    newStatus === SERVICE_ORDER_STATUS.IN_PROGRESS &&
                    oldStatus !== SERVICE_ORDER_STATUS.IN_PROGRESS
                  ) {
                    if (!existingMatch.startedById) {
                      updatePayload.startedById = userId || null;
                      updatePayload.startedAt = new Date();
                    }
                  }

                  // If transitioning to COMPLETED, set completedBy/finishedAt and startedAt if not already set
                  if (
                    newStatus === SERVICE_ORDER_STATUS.COMPLETED &&
                    oldStatus !== SERVICE_ORDER_STATUS.COMPLETED
                  ) {
                    if (!existingMatch.completedById) {
                      updatePayload.completedById = userId || null;
                      updatePayload.finishedAt = new Date();
                    }
                    // Also set startedAt/startedById if not already set (e.g., skipped IN_PROGRESS)
                    if (!existingMatch.startedById) {
                      updatePayload.startedById = userId || null;
                      updatePayload.startedAt = updatePayload.finishedAt || new Date();
                    }
                  }

                  // If rolling back to PENDING, clear all progress dates
                  if (
                    newStatus === SERVICE_ORDER_STATUS.PENDING &&
                    oldStatus !== SERVICE_ORDER_STATUS.PENDING
                  ) {
                    updatePayload.startedById = null;
                    updatePayload.startedAt = null;
                    updatePayload.approvedById = null;
                    updatePayload.approvedAt = null;
                    updatePayload.completedById = null;
                    updatePayload.finishedAt = null;
                  }
                  // If rolling back from COMPLETED to IN_PROGRESS, clear completion dates
                  else if (
                    newStatus === SERVICE_ORDER_STATUS.IN_PROGRESS &&
                    oldStatus === SERVICE_ORDER_STATUS.COMPLETED
                  ) {
                    updatePayload.completedById = null;
                    updatePayload.finishedAt = null;
                  }
                }

                if (Object.keys(updatePayload).length > 0) {
                  const updatedServiceOrder = await tx.serviceOrder.update({
                    where: { id: existingMatch.id },
                    data: updatePayload,
                  });

                  createdServiceOrders.push(updatedServiceOrder);

                  // Track observation changes for post-transaction event emission
                  if (
                    serviceOrderData.observation !== undefined &&
                    existingMatch.observation !== updatedServiceOrder.observation
                  ) {
                    observationChangedSOs.push({
                      serviceOrder: updatedServiceOrder,
                      oldObservation: existingMatch.observation,
                    });
                  }

                  // Create changelog for service order update
                  await trackAndLogFieldChanges({
                    changeLogService: this.changeLogService,
                    entityType: ENTITY_TYPE.SERVICE_ORDER,
                    entityId: existingMatch.id,
                    oldEntity: existingMatch,
                    newEntity: updatedServiceOrder,
                    fieldsToTrack: ['status', 'observation', 'assignedToId', 'startedAt', 'startedById', 'finishedAt', 'completedById'],
                    userId: userId || '',
                    triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                    transaction: tx,
                  });

                  this.logger.log(
                    `[Task Update] Updated existing service order ${existingMatch.id} (matched by description+type)`,
                  );

                  // =====================================================================
                  // ARTWORK SYNC: Check if artwork status change should update task status
                  // =====================================================================
                  if (
                    serviceOrderData.status !== undefined &&
                    serviceOrderData.status !== existingMatch.status &&
                    updatedServiceOrder.type === SERVICE_ORDER_TYPE.ARTWORK
                  ) {
                    // Get current task status
                    const currentTask = await tx.task.findUnique({
                      where: { id },
                      select: { id: true, status: true },
                    });

                    if (currentTask) {
                      // Get all service orders with their current statuses (including this update)
                      const allServiceOrders = await tx.serviceOrder.findMany({
                        where: { taskId: id },
                        select: { id: true, status: true, type: true },
                      });

                      const artworkSyncResult = getTaskUpdateForArtworkServiceOrderStatusChange(
                        allServiceOrders.map(so => ({
                          id: so.id,
                          status: so.status as SERVICE_ORDER_STATUS,
                          type: so.type as SERVICE_ORDER_TYPE,
                        })),
                        updatedServiceOrder.id,
                        existingMatch.status as SERVICE_ORDER_STATUS,
                        updatedServiceOrder.status as SERVICE_ORDER_STATUS,
                        updatedServiceOrder.type as SERVICE_ORDER_TYPE,
                        currentTask.status as TASK_STATUS,
                      );

                      if (artworkSyncResult?.shouldUpdate) {
                        this.logger.log(
                          `[ARTWORK→TASK SYNC] Artwork SO ${updatedServiceOrder.id} status changed, updating task ${id}: ${currentTask.status} → ${artworkSyncResult.newTaskStatus}`,
                        );

                        await tx.task.update({
                          where: { id },
                          data: {
                            status: artworkSyncResult.newTaskStatus,
                            statusOrder: getTaskStatusOrder(artworkSyncResult.newTaskStatus),
                          },
                        });

                        // Log the auto-transition in changelog
                        await this.changeLogService.logChange({
                          entityType: ENTITY_TYPE.TASK,
                          entityId: id,
                          action: CHANGE_ACTION.UPDATE,
                          field: 'status',
                          oldValue: currentTask.status,
                          newValue: artworkSyncResult.newTaskStatus,
                          reason: artworkSyncResult.reason,
                          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                          triggeredById: updatedServiceOrder.id,
                          userId: userId || '',
                          transaction: tx,
                        });
                      }
                    }
                  }
                } else {
                  createdServiceOrders.push(existingMatch);
                  this.logger.log(
                    `[Task Update] No changes for existing service order ${existingMatch.id} (matched by description+type)`,
                  );
                }
              } else {
                // CREATE new service order (no ID and no existing match)
                this.logger.log(
                  `[Task Update] Creating new service order: ${serviceOrderData.description} (${serviceOrderData.type})`,
                );

                const createdServiceOrder = await tx.serviceOrder.create({
                  data: {
                    taskId: id,
                    type: serviceOrderData.type,
                    status: serviceOrderData.status || 'PENDING',
                    description: serviceOrderData.description || null,
                    observation: serviceOrderData.observation || null,
                    assignedToId: serviceOrderData.assignedToId || null,
                    createdById: userId || '',
                    shouldSync: (serviceOrderData as any).shouldSync !== false, // Preserve shouldSync flag (default true)
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

                this.logger.log(
                  `[Task Update] Created service order ${createdServiceOrder.id} (${createdServiceOrder.type})`,
                );

                // =====================================================================
                // ARTWORK SYNC: Check if newly created artwork with COMPLETED status should update task
                // =====================================================================
                if (
                  createdServiceOrder.type === SERVICE_ORDER_TYPE.ARTWORK &&
                  createdServiceOrder.status === SERVICE_ORDER_STATUS.COMPLETED
                ) {
                  // Get current task status
                  const currentTask = await tx.task.findUnique({
                    where: { id },
                    select: { id: true, status: true },
                  });

                  if (currentTask && currentTask.status === TASK_STATUS.PREPARATION) {
                    this.logger.log(
                      `[ARTWORK→TASK SYNC] New artwork SO ${createdServiceOrder.id} created with COMPLETED status, updating task ${id}: PREPARATION → WAITING_PRODUCTION`,
                    );

                    await tx.task.update({
                      where: { id },
                      data: {
                        status: TASK_STATUS.WAITING_PRODUCTION,
                        statusOrder: getTaskStatusOrder(TASK_STATUS.WAITING_PRODUCTION),
                      },
                    });

                    // Log the auto-transition in changelog
                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.TASK,
                      entityId: id,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'status',
                      oldValue: TASK_STATUS.PREPARATION,
                      newValue: TASK_STATUS.WAITING_PRODUCTION,
                      reason: `Tarefa liberada automaticamente para produção quando ordem de serviço de arte foi criada como concluída`,
                      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                      triggeredById: createdServiceOrder.id,
                      userId: userId || '',
                      transaction: tx,
                    });
                  }
                }
              }
            }
          }

          // =====================================================================
          // DELETE SERVICE ORDERS: Remove service orders not in submitted list
          // This runs even when serviceOrdersData is empty (to handle case where user deletes ALL service orders)
          // If a service order existed before but is not in the current submission,
          // the user has deleted it from the form, so we should delete it.
          // =====================================================================
          const submittedServiceOrderIds = new Set<string>();
          const submittedDescriptionTypeKeys = new Set<string>();

          for (const serviceOrderData of serviceOrdersData) {
            if (serviceOrderData.id) {
              submittedServiceOrderIds.add(serviceOrderData.id);
            } else if (serviceOrderData.description) {
              // For new items without ID, track by description+type to avoid deleting items that match
              const key = `${(serviceOrderData.description || '').toLowerCase().trim()}|${serviceOrderData.type}`;
              submittedDescriptionTypeKeys.add(key);
            }
          }

          // CRITICAL DEBUG: Log deletion comparison data
          this.logger.log(`[Task Update] 🔍 Deletion analysis:`);
          this.logger.log(
            `[Task Update]   - Existing SO IDs: ${existingServiceOrders.map(so => so.id).join(', ')}`,
          );
          this.logger.log(
            `[Task Update]   - Submitted SO IDs: ${Array.from(submittedServiceOrderIds).join(', ') || 'none'}`,
          );
          this.logger.log(
            `[Task Update]   - Submitted desc+type keys: ${Array.from(submittedDescriptionTypeKeys).join(', ') || 'none'}`,
          );
          this.logger.log(
            `[Task Update]   - Existing SO descriptions: ${existingServiceOrders.map(so => `${so.description}|${so.type}`).join(', ')}`,
          );

          // Find service orders to delete (exist in DB but not in submission)
          const serviceOrdersToDelete = existingServiceOrders.filter(existing => {
            // If the existing SO's ID is in the submitted list, don't delete
            if (submittedServiceOrderIds.has(existing.id)) {
              this.logger.log(
                `[Task Update]   ✓ Keeping SO ${existing.id} (${existing.description}) - ID in submitted list`,
              );
              return false;
            }
            // If a new item was submitted with same description+type, don't delete
            const existingKey = `${(existing.description || '').toLowerCase().trim()}|${existing.type}`;
            if (submittedDescriptionTypeKeys.has(existingKey)) {
              this.logger.log(
                `[Task Update]   ✓ Keeping SO ${existing.id} (${existing.description}) - desc+type matches submitted item`,
              );
              return false;
            }
            // This service order should be deleted
            this.logger.log(
              `[Task Update]   ✗ DELETING SO ${existing.id} (${existing.description}) - not in submitted list`,
            );
            return true;
          });

          // Log deletion summary
          this.logger.log(
            `[Task Update] 🗑️ Service orders to delete: ${serviceOrdersToDelete.length} of ${existingServiceOrders.length} total`,
          );

          // Delete the service orders
          for (const soToDelete of serviceOrdersToDelete) {
            this.logger.log(
              `[Task Update] Deleting service order ${soToDelete.id} (${soToDelete.type}: ${soToDelete.description})`,
            );

            await tx.serviceOrder.delete({
              where: { id: soToDelete.id },
            });

            // Create changelog for service order deletion
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.SERVICE_ORDER,
              entityId: soToDelete.id,
              action: CHANGE_ACTION.DELETE,
              entity: soToDelete,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              reason: 'Ordem de serviço removida via atualização de tarefa',
              transaction: tx,
            });

            // CRITICAL FIX: Set shouldSync = false on corresponding pricing items
            // This permanently prevents the sync from recreating this service order
            if (soToDelete.description && soToDelete.type === SERVICE_ORDER_TYPE.PRODUCTION) {
              const normalizedDesc = soToDelete.description.toLowerCase().trim();

              // Find matching pricing items by normalized description
              const matchingPricingItems = await tx.taskPricingItem.findMany({
                where: {
                  pricing: {
                    tasks: {
                      some: { id: id },
                    },
                  },
                },
              });

              for (const pricingItem of matchingPricingItems) {
                const pricingNormalizedDesc = (pricingItem.description || '').toLowerCase().trim();
                // Check if descriptions match (pricing item description may include observation suffix)
                if (
                  pricingNormalizedDesc === normalizedDesc ||
                  pricingNormalizedDesc.startsWith(normalizedDesc + ' - ')
                ) {
                  this.logger.log(
                    `[Task Update] Setting shouldSync=false on pricing item ${pricingItem.id} (${pricingItem.description})`,
                  );
                  await tx.taskPricingItem.update({
                    where: { id: pricingItem.id },
                    data: { shouldSync: false },
                  });
                }
              }
            }
          }

          if (serviceOrdersToDelete.length > 0) {
            this.logger.log(`[Task Update] Deleted ${serviceOrdersToDelete.length} service orders`);

            // =====================================================================
            // ARTWORK SYNC: Check if deleting artwork SOs should rollback task status
            // If task is in WAITING_PRODUCTION and no completed artworks remain, rollback to PREPARATION
            // =====================================================================
            const deletedArtworkSOs = serviceOrdersToDelete.filter(
              so =>
                so.type === SERVICE_ORDER_TYPE.ARTWORK &&
                so.status === SERVICE_ORDER_STATUS.COMPLETED,
            );

            if (deletedArtworkSOs.length > 0) {
              // Get current task status
              const currentTask = await tx.task.findUnique({
                where: { id },
                select: { id: true, status: true },
              });

              if (currentTask && currentTask.status === TASK_STATUS.WAITING_PRODUCTION) {
                // Get remaining service orders (after deletions)
                const remainingServiceOrders = await tx.serviceOrder.findMany({
                  where: { taskId: id },
                  select: { id: true, status: true, type: true },
                });

                // Check if any artwork SOs remain completed
                const anyArtworkCompleted = remainingServiceOrders.some(
                  so =>
                    so.type === SERVICE_ORDER_TYPE.ARTWORK &&
                    so.status === SERVICE_ORDER_STATUS.COMPLETED,
                );

                if (!anyArtworkCompleted) {
                  this.logger.log(
                    `[ARTWORK→TASK SYNC] Completed artwork SOs deleted, no completed artworks remain, rolling back task ${id}: WAITING_PRODUCTION → PREPARATION`,
                  );

                  await tx.task.update({
                    where: { id },
                    data: {
                      status: TASK_STATUS.PREPARATION,
                      statusOrder: getTaskStatusOrder(TASK_STATUS.PREPARATION),
                    },
                  });

                  // Log the rollback in changelog
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'status',
                    oldValue: TASK_STATUS.WAITING_PRODUCTION,
                    newValue: TASK_STATUS.PREPARATION,
                    reason: `Tarefa retornada para preparação pois nenhuma ordem de serviço de arte permanece concluída`,
                    triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                    triggeredById: deletedArtworkSOs[0].id,
                    userId: userId || '',
                    transaction: tx,
                  });
                }
              }
            }
          }

          // CRITICAL FIX: Track deleted service order descriptions to prevent bidirectional sync from recreating them
          // This Set is used later in the PRICING↔SO SYNC section to skip creating service orders
          // that were explicitly deleted by the user
          const deletedServiceOrderDescriptions = new Set(
            serviceOrdersToDelete.map(so => (so.description || '').toLowerCase().trim()),
          );
          if (deletedServiceOrderDescriptions.size > 0) {
            this.logger.log(
              `[Task Update] Tracking ${deletedServiceOrderDescriptions.size} deleted SO descriptions to prevent sync recreation: ${Array.from(deletedServiceOrderDescriptions).join(', ')}`,
            );
          }

          // Store in a variable accessible to the sync section
          (data as any)._deletedServiceOrderDescriptions = deletedServiceOrderDescriptions;

          // Refetch the task with updated serviceOrders for changelog tracking
          updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
            include: {
              ...include,
              customer: true,
              artworks: true,
              observation: { include: { files: true } },
              truck: true,
              serviceOrders: true, // Include updated service orders
            },
          });

          this.logger.log(
            `[Task Update] After refetch, updatedTask.serviceOrders count: ${updatedTask?.serviceOrders?.length || 0}`,
          );

          // =====================================================================
          // REVERSE SYNC: Service Order Status Changes → Task Status
          // Check if any service order status changes should trigger task status changes
          // This handles cases where service orders are updated via task edit form
          // =====================================================================
          if (
            data.serviceOrders &&
            Array.isArray(data.serviceOrders) &&
            data.serviceOrders.length > 0
          ) {
            this.logger.log(
              `[REVERSE SYNC] Checking if service order updates require task status change`,
            );

            // Check each service order that was updated
            for (const serviceOrderData of data.serviceOrders) {
              // Only check service orders with IDs (existing records that were updated)
              if (serviceOrderData.id && serviceOrderData.status) {
                // Find the old service order data from existingTask
                const oldServiceOrder = existingTask.serviceOrders?.find(
                  so => so.id === serviceOrderData.id,
                );

                if (oldServiceOrder && oldServiceOrder.status !== serviceOrderData.status) {
                  // Service order status changed - check if task should update
                  const taskUpdate = getTaskUpdateForServiceOrderStatusChange(
                    updatedTask.serviceOrders || [],
                    serviceOrderData.id,
                    oldServiceOrder.status as SERVICE_ORDER_STATUS,
                    serviceOrderData.status as SERVICE_ORDER_STATUS,
                    updatedTask.status as TASK_STATUS,
                  );

                  if (taskUpdate && taskUpdate.shouldUpdate && taskUpdate.newTaskStatus) {
                    this.logger.log(
                      `[REVERSE SYNC] Service order ${serviceOrderData.id} status change (${oldServiceOrder.status} → ${serviceOrderData.status}) triggers task status change: ${updatedTask.status} → ${taskUpdate.newTaskStatus}`,
                    );

                    // Build task update data
                    const taskUpdateData: any = {
                      status: taskUpdate.newTaskStatus,
                      statusOrder: getTaskStatusOrder(taskUpdate.newTaskStatus),
                    };

                    if (taskUpdate.setStartedAt) {
                      taskUpdateData.startedAt = new Date();
                    }
                    if (taskUpdate.setFinishedAt) {
                      taskUpdateData.finishedAt = new Date();
                    }
                    if (taskUpdate.clearStartedAt) {
                      taskUpdateData.startedAt = null;
                    }
                    if (taskUpdate.clearFinishedAt) {
                      taskUpdateData.finishedAt = null;
                    }

                    // Update task status
                    updatedTask = (await tx.task.update({
                      where: { id },
                      data: taskUpdateData,
                      include: {
                        ...include,
                        customer: true,
                        artworks: true,
                        observation: { include: { files: true } },
                        truck: true,
                        serviceOrders: true,
                      },
                    })) as any;

                    // Log the reverse sync in changelog
                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.TASK,
                      entityId: id,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'status',
                      oldValue: existingTask.status,
                      newValue: taskUpdate.newTaskStatus,
                      reason: taskUpdate.reason,
                      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                      triggeredById: serviceOrderData.id,
                      userId: userId || '',
                      transaction: tx,
                    });

                    // Break after first status change (avoid multiple status changes in one update)
                    break;
                  }
                }
              }
            }
          }

          // Auto-transition task from PREPARATION to WAITING_PRODUCTION when all ARTWORK service orders are COMPLETED
          // This ensures the task workflow progresses automatically when all artwork approvals are complete
          if (updatedTask && updatedTask.status === TASK_STATUS.PREPARATION) {
            // Get all ARTWORK service orders for this task (from the refetched data)
            const artworkServiceOrders = (updatedTask.serviceOrders || []).filter(
              (so: any) => so.type === SERVICE_ORDER_TYPE.ARTWORK,
            );

            // Check if there's at least 1 artwork service order and ALL are COMPLETED
            const hasArtworkOrders = artworkServiceOrders.length > 0;
            const allArtworkCompleted = artworkServiceOrders.every(
              (so: any) => so.status === SERVICE_ORDER_STATUS.COMPLETED,
            );

            if (hasArtworkOrders && allArtworkCompleted) {
              this.logger.log(
                `[AUTO-TRANSITION Task Update] All ${artworkServiceOrders.length} ARTWORK service orders completed for task ${id}, transitioning PREPARATION → WAITING_PRODUCTION`,
              );

              // Update task status to WAITING_PRODUCTION
              // Using tx.task.update directly to include statusOrder which is not in the form data type
              updatedTask = (await tx.task.update({
                where: { id },
                data: {
                  status: TASK_STATUS.WAITING_PRODUCTION,
                  statusOrder: 2, // WAITING_PRODUCTION statusOrder
                },
                include: {
                  ...include,
                  customer: true,
                  artworks: true,
                  observation: { include: { files: true } },
                  truck: true,
                  serviceOrders: true,
                },
              })) as any;

              // Log the auto-transition in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: TASK_STATUS.PREPARATION,
                newValue: TASK_STATUS.WAITING_PRODUCTION,
                reason: `Tarefa liberada automaticamente para produção quando todas as ${artworkServiceOrders.length} ordens de serviço de arte foram concluídas`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              // Track that task was auto-transitioned for event/notification emission after transaction
              taskAutoTransitionedToWaitingProduction = true;
            }
          }

          // Auto-complete task when all PRODUCTION service orders are COMPLETED
          // This ensures task workflow progresses automatically when all production work is done
          // IMPORTANT: CANCELLED service orders are excluded - they don't block task completion
          if (
            updatedTask &&
            (updatedTask.status === TASK_STATUS.IN_PRODUCTION ||
              updatedTask.status === TASK_STATUS.WAITING_PRODUCTION)
          ) {
            // Get all PRODUCTION service orders for this task (from the refetched data)
            const productionServiceOrders = (updatedTask.serviceOrders || []).filter(
              (so: any) => so.type === SERVICE_ORDER_TYPE.PRODUCTION,
            );

            // Filter out CANCELLED orders - they don't block task completion
            const activeProductionOrders = productionServiceOrders.filter(
              (so: any) => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
            );

            // Check if there's at least 1 active production service order and ALL are COMPLETED
            const hasActiveProductionOrders = activeProductionOrders.length > 0;
            const allActiveProductionCompleted = activeProductionOrders.every(
              (so: any) => so.status === SERVICE_ORDER_STATUS.COMPLETED,
            );

            // If ALL production orders are now cancelled, rollback task (not cancel - only COMMERCIAL cancellation cancels task)
            if (!hasActiveProductionOrders && productionServiceOrders.length > 0) {
              // If task is IN_PRODUCTION, rollback to WAITING_PRODUCTION
              if (updatedTask.status === TASK_STATUS.IN_PRODUCTION) {
                this.logger.log(
                  `[ROLLBACK TASK ON ALL PRODUCTION SO CANCEL] All ${productionServiceOrders.length} PRODUCTION service orders cancelled for task ${id}, rolling back to WAITING_PRODUCTION`,
                );

                // Update task status to WAITING_PRODUCTION (rollback)
                updatedTask = (await tx.task.update({
                  where: { id },
                  data: {
                    status: TASK_STATUS.WAITING_PRODUCTION,
                    statusOrder: 2, // WAITING_PRODUCTION statusOrder
                    startedAt: null, // Clear start date on rollback
                  },
                  include: {
                    ...include,
                    customer: true,
                    artworks: true,
                    observation: { include: { files: true } },
                    truck: true,
                    serviceOrders: true,
                  },
                })) as any;

                // Log the rollback in changelog
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'status',
                  oldValue: existingTask.status,
                  newValue: TASK_STATUS.WAITING_PRODUCTION,
                  reason: `Tarefa retornada para aguardando produção pois todas as ${productionServiceOrders.length} ordens de serviço de produção foram canceladas`,
                  triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                  triggeredById: id,
                  userId: userId || '',
                  transaction: tx,
                });

                taskAutoTransitionedToWaitingProduction = true;
              }
              // If task is not IN_PRODUCTION, don't change task status
            } else if (hasActiveProductionOrders && allActiveProductionCompleted) {
              this.logger.log(
                `[AUTO-COMPLETE TASK] All ${activeProductionOrders.length} active PRODUCTION service orders completed for task ${id}, transitioning to COMPLETED`,
              );

              // Update task status to COMPLETED
              updatedTask = (await tx.task.update({
                where: { id },
                data: {
                  status: TASK_STATUS.COMPLETED,
                  statusOrder: 4, // COMPLETED statusOrder
                  finishedAt: updatedTask.finishedAt || new Date(),
                  startedAt: updatedTask.startedAt || new Date(),
                },
                include: {
                  ...include,
                  customer: true,
                  artworks: true,
                  observation: { include: { files: true } },
                  truck: true,
                  serviceOrders: true,
                },
              })) as any;

              // Log the auto-complete in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: existingTask.status,
                newValue: TASK_STATUS.COMPLETED,
                reason: `Tarefa concluída automaticamente quando todas as ${activeProductionOrders.length} ordens de serviço de produção ativas foram finalizadas`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              // Track that task was auto-completed for event/notification emission after transaction
              taskAutoTransitionedToWaitingProduction = true; // Reuse this flag for event emission
            }
          }

          // =====================================================================
          // ROLLBACK COMPLETED TASK: When new service orders are added to a COMPLETED task
          // If a task is COMPLETED but now has non-completed production SOs (e.g. a new
          // PENDING SO was added), recalculate the correct status and rollback accordingly.
          // =====================================================================
          if (updatedTask && updatedTask.status === TASK_STATUS.COMPLETED) {
            const correctStatus = calculateCorrectTaskStatus(
              (updatedTask.serviceOrders || []).map((so: any) => ({
                status: so.status as SERVICE_ORDER_STATUS,
                type: so.type as SERVICE_ORDER_TYPE,
              })),
            );

            if (correctStatus !== TASK_STATUS.COMPLETED) {
              this.logger.log(
                `[ROLLBACK COMPLETED TASK] Task ${id} is COMPLETED but calculated status is ${correctStatus} (new service orders may have been added), rolling back`,
              );

              updatedTask = (await tx.task.update({
                where: { id },
                data: {
                  status: correctStatus,
                  statusOrder: getTaskStatusOrder(correctStatus),
                  finishedAt: null, // Clear finish date since task is being reopened
                },
                include: {
                  ...include,
                  customer: true,
                  artworks: true,
                  observation: { include: { files: true } },
                  truck: true,
                  serviceOrders: true,
                },
              })) as any;

              // Log the rollback in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: TASK_STATUS.COMPLETED,
                newValue: correctStatus,
                reason: `Tarefa reaberta automaticamente de concluída para ${correctStatus === TASK_STATUS.IN_PRODUCTION ? 'em produção' : 'aguardando produção'} pois novas ordens de serviço foram adicionadas`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });
            }
          }

          // =====================================================================
          // AUTO-CANCEL TASK WHEN ALL COMMERCIAL SERVICE ORDERS ARE CANCELLED
          // When all COMMERCIAL service orders are cancelled, cancel task and all other SOs
          // =====================================================================
          if (updatedTask && updatedTask.status !== TASK_STATUS.CANCELLED) {
            const commercialServiceOrders = (updatedTask.serviceOrders || []).filter(
              (so: any) => so.type === SERVICE_ORDER_TYPE.COMMERCIAL,
            );

            const activeCommercialOrders = commercialServiceOrders.filter(
              (so: any) => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
            );

            // If ALL commercial orders are now cancelled, cancel the task and all other service orders
            if (activeCommercialOrders.length === 0 && commercialServiceOrders.length > 0) {
              this.logger.log(
                `[AUTO-CANCEL TASK] All ${commercialServiceOrders.length} COMMERCIAL service orders cancelled for task ${id}, cancelling task and all remaining service orders`,
              );

              // Cancel all remaining non-cancelled service orders
              const otherServiceOrders = (updatedTask.serviceOrders || []).filter(
                (so: any) => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
              );

              for (const otherSO of otherServiceOrders) {
                await tx.serviceOrder.update({
                  where: { id: otherSO.id },
                  data: {
                    status: SERVICE_ORDER_STATUS.CANCELLED,
                    statusOrder: 5,
                  },
                });

                // Log each service order cancellation
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.SERVICE_ORDER,
                  entityId: otherSO.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'status',
                  oldValue: otherSO.status,
                  newValue: SERVICE_ORDER_STATUS.CANCELLED,
                  reason: `Ordem de serviço ${otherSO.type} cancelada automaticamente pois todas as ordens de serviço comerciais foram canceladas`,
                  triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                  triggeredById: id,
                  userId: userId || '',
                  transaction: tx,
                });
              }

              // Update task status to CANCELLED
              updatedTask = (await tx.task.update({
                where: { id },
                data: {
                  status: TASK_STATUS.CANCELLED,
                  statusOrder: 5, // CANCELLED statusOrder
                },
                include: {
                  ...include,
                  customer: true,
                  artworks: true,
                  observation: { include: { files: true } },
                  truck: true,
                  serviceOrders: true,
                },
              })) as any;

              // Log the auto-cancel in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: existingTask.status,
                newValue: TASK_STATUS.CANCELLED,
                reason: `Tarefa cancelada automaticamente pois todas as ${commercialServiceOrders.length} ordens de serviço comerciais foram canceladas`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              taskAutoTransitionedToWaitingProduction = true;
            }
          }

          // =====================================================================
          // ROLLBACK: COMMERCIAL Service Order Un-Cancelled → Task Status Rollback
          // Check if any COMMERCIAL SO was un-cancelled (CANCELLED → other status)
          // If so and task is CANCELLED, calculate correct status based on all SOs
          // =====================================================================
          if (updatedTask.status === TASK_STATUS.CANCELLED && data.serviceOrders) {
            // Check if any COMMERCIAL SO was un-cancelled
            for (const serviceOrderData of data.serviceOrders) {
              if (serviceOrderData.id && serviceOrderData.status) {
                const oldServiceOrder = existingTask.serviceOrders?.find(
                  (so: any) => so.id === serviceOrderData.id,
                );

                // Check if this is a COMMERCIAL SO being un-cancelled
                if (
                  oldServiceOrder &&
                  oldServiceOrder.type === SERVICE_ORDER_TYPE.COMMERCIAL &&
                  oldServiceOrder.status === SERVICE_ORDER_STATUS.CANCELLED &&
                  serviceOrderData.status !== SERVICE_ORDER_STATUS.CANCELLED
                ) {
                  // Calculate the correct task status based on all service orders
                  const correctStatus = calculateCorrectTaskStatus(
                    (updatedTask.serviceOrders || []).map((so: any) => ({
                      status: so.status as SERVICE_ORDER_STATUS,
                      type: so.type as SERVICE_ORDER_TYPE,
                    })),
                  );

                  this.logger.log(
                    `[COMMERCIAL ROLLBACK] Commercial service order ${serviceOrderData.id} un-cancelled (${oldServiceOrder.status} → ${serviceOrderData.status}), rolling back task ${id} from CANCELLED to ${correctStatus}`,
                  );

                  const newStatusOrder =
                    correctStatus === TASK_STATUS.PREPARATION
                      ? 1
                      : correctStatus === TASK_STATUS.WAITING_PRODUCTION
                        ? 2
                        : correctStatus === TASK_STATUS.IN_PRODUCTION
                          ? 3
                          : correctStatus === TASK_STATUS.COMPLETED
                            ? 4
                            : 5;

                  // Update task status to the correct status
                  updatedTask = (await tx.task.update({
                    where: { id },
                    data: {
                      status: correctStatus,
                      statusOrder: newStatusOrder,
                    },
                    include: {
                      ...include,
                      customer: true,
                      artworks: true,
                      observation: { include: { files: true } },
                      truck: true,
                      serviceOrders: true,
                    },
                  })) as any;

                  // Log the rollback in changelog
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'status',
                    oldValue: TASK_STATUS.CANCELLED,
                    newValue: correctStatus,
                    reason: `Tarefa retornada para ${correctStatus === TASK_STATUS.PREPARATION ? 'preparação' : correctStatus === TASK_STATUS.WAITING_PRODUCTION ? 'aguardando produção' : correctStatus === TASK_STATUS.IN_PRODUCTION ? 'em produção' : 'concluída'} pois ordem de serviço comercial foi reativada`,
                    triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                    triggeredById: serviceOrderData.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  taskAutoTransitionedToWaitingProduction = true;
                  break; // Only need to rollback once
                }
              }
            }
          }
        }

        // =====================================================================
        // BIDIRECTIONAL SYNC: Task Status → Service Order Status
        // When task status changes, sync production service orders accordingly
        // =====================================================================
        if (data.status && data.status !== existingTask.status) {
          const oldTaskStatus = existingTask.status as TASK_STATUS;
          const newTaskStatus = data.status as TASK_STATUS;

          // Get service order updates needed for this task status change
          const serviceOrderUpdates = getServiceOrderUpdatesForTaskStatusChange(
            (updatedTask?.serviceOrders || []).map((so: any) => ({
              id: so.id,
              status: so.status as SERVICE_ORDER_STATUS,
              type: so.type as SERVICE_ORDER_TYPE,
              startedAt: so.startedAt,
              finishedAt: so.finishedAt,
            })),
            oldTaskStatus,
            newTaskStatus,
          );

          if (serviceOrderUpdates.length > 0) {
            this.logger.log(
              `[TASK→SO SYNC] Task ${id} status changed ${oldTaskStatus} → ${newTaskStatus}, updating ${serviceOrderUpdates.length} service orders`,
            );

            for (const update of serviceOrderUpdates) {
              const so = (updatedTask?.serviceOrders || []).find(
                (s: any) => s.id === update.serviceOrderId,
              );
              if (!so) continue;

              const updateData: any = {
                status: update.newStatus,
                statusOrder: getServiceOrderStatusOrder(update.newStatus),
              };

              // Set dates based on update flags
              if (update.setStartedAt && !so.startedAt) {
                updateData.startedAt = new Date();
                updateData.startedById = userId || null;
              }
              if (update.setFinishedAt && !so.finishedAt) {
                updateData.finishedAt = new Date();
                updateData.completedById = userId || null;
              }
              if (update.clearStartedAt) {
                updateData.startedAt = null;
                updateData.startedById = null;
              }
              if (update.clearFinishedAt) {
                updateData.finishedAt = null;
                updateData.completedById = null;
              }

              await tx.serviceOrder.update({
                where: { id: update.serviceOrderId },
                data: updateData,
              });

              // Log the sync in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.SERVICE_ORDER,
                entityId: update.serviceOrderId,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: so.status,
                newValue: update.newStatus,
                reason: update.reason,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              this.logger.log(
                `[TASK→SO SYNC] Service order ${update.serviceOrderId} (${so.description}) status: ${so.status} → ${update.newStatus}`,
              );
            }

            // Refetch task with updated service orders
            updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
              include: {
                ...include,
                customer: true,
                artworks: true,
                observation: { include: { files: true } },
                truck: true,
                serviceOrders: true,
              },
            });
          }
        }

        // =====================================================================
        // BIDIRECTIONAL SYNC: Pricing Items ↔ Production Service Orders
        // When pricing items or PRODUCTION service orders are added/updated,
        // sync them bidirectionally:
        // - PRODUCTION SO → Pricing Item (description + observation → item description)
        // - Pricing Item → PRODUCTION SO (item description → SO description + observation)
        // =====================================================================
        // CRITICAL: Only run sync if NEW items are being ADDED (items without IDs)
        // This prevents the sync from running when the form just sends existing data back
        // without any actual changes to pricing or service orders.
        const hasNewServiceOrders =
          serviceOrdersData &&
          Array.isArray(serviceOrdersData) &&
          serviceOrdersData.length > 0 &&
          serviceOrdersData.some((so: any) => !so.id); // NEW service orders have no ID

        const hasNewPricingItems =
          (data as any).pricing?.items &&
          Array.isArray((data as any).pricing.items) &&
          (data as any).pricing.items.length > 0 &&
          (data as any).pricing.items.some((item: any) => !item.id); // NEW pricing items have no ID

        if (hasNewServiceOrders || hasNewPricingItems) {
          try {
            // CRITICAL: Refetch task with pricing items to ensure we have the latest shouldSync values
            // This is necessary because:
            // 1. New pricing might have been created by the repository
            // 2. shouldSync might have been set to false on pricing items when service orders were deleted
            // 3. Previous refetches might not have included pricing items
            const taskWithPricing = await tx.task.findUnique({
              where: { id },
              include: {
                pricing: { include: { items: true } },
                serviceOrders: true,
              },
            });

            // Get current state of pricing and service orders from the fresh refetch
            const currentPricing = taskWithPricing?.pricing;
            const currentServiceOrders = taskWithPricing?.serviceOrders || [];

            this.logger.log(
              `[PRICING↔SO SYNC] Refetched pricing items: ${currentPricing?.items?.length || 0}, service orders: ${currentServiceOrders.length}`,
            );

            // Only proceed if we have data to sync
            if (currentPricing?.items || currentServiceOrders.length > 0) {
              // Log ALL pricing items with their shouldSync values for debugging
              this.logger.log(`[PRICING↔SO SYNC] ALL pricing items BEFORE filtering:`);
              for (const item of currentPricing?.items || []) {
                this.logger.log(
                  `  - "${item.description}" (id: ${item.id}, shouldSync: ${item.shouldSync})`,
                );
              }

              // CRITICAL: Filter out pricing items with shouldSync = false
              // These are items whose corresponding service orders were explicitly deleted
              const syncEligiblePricingItems = (currentPricing?.items || []).filter(
                (item: any) => item.shouldSync !== false,
              );
              const syncEligibleServiceOrders = currentServiceOrders.filter(
                (so: any) => so.shouldSync !== false,
              );

              this.logger.log(
                `[PRICING↔SO SYNC] Filtering: ${(currentPricing?.items || []).length} total pricing items, ${syncEligiblePricingItems.length} eligible for sync`,
              );
              this.logger.log(
                `[PRICING↔SO SYNC] Filtering: ${currentServiceOrders.length} total service orders, ${syncEligibleServiceOrders.length} eligible for sync`,
              );

              // Log which items were filtered out
              const filteredOutItems = (currentPricing?.items || []).filter(
                (item: any) => item.shouldSync === false,
              );
              if (filteredOutItems.length > 0) {
                this.logger.log(
                  `[PRICING↔SO SYNC] ⚠️ Items EXCLUDED from sync (shouldSync=false):`,
                );
                for (const item of filteredOutItems) {
                  this.logger.log(`  - "${item.description}" (id: ${item.id})`);
                }
              }

              const pricingItems: SyncPricingItem[] = syncEligiblePricingItems.map((item: any) => ({
                id: item.id,
                description: item.description,
                observation: item.observation,
                amount: item.amount,
              }));

              const serviceOrders: SyncServiceOrder[] = syncEligibleServiceOrders.map(
                (so: any) => ({
                  id: so.id,
                  description: so.description,
                  observation: so.observation,
                  type: so.type,
                }),
              );

              // Get sync actions
              const syncActions = getBidirectionalSyncActions(pricingItems, serviceOrders);

              this.logger.log(
                `[PRICING↔SO SYNC] Task ${id}: Found ${syncActions.pricingItemsToCreate.length} pricing items to create, ` +
                  `${syncActions.serviceOrdersToCreate.length} service orders to create`,
              );

              // Create missing pricing items from service orders
              if (syncActions.pricingItemsToCreate.length > 0 && currentPricing?.id) {
                for (const itemToCreate of syncActions.pricingItemsToCreate) {
                  this.logger.log(
                    `[PRICING↔SO SYNC] Creating pricing item: "${itemToCreate.description}" (amount: ${itemToCreate.amount})`,
                  );

                  await tx.taskPricingItem.create({
                    data: {
                      pricingId: currentPricing.id,
                      description: itemToCreate.description,
                      observation: itemToCreate.observation || null,
                      amount: itemToCreate.amount,
                      shouldSync: true, // Items created by sync should participate in sync
                    },
                  });
                }

                // Recalculate pricing subtotal and total
                const allItems = await tx.taskPricingItem.findMany({
                  where: { pricingId: currentPricing.id },
                });
                const newSubtotal = allItems.reduce(
                  (sum, item) => sum + Number(item.amount || 0),
                  0,
                );

                await tx.taskPricing.update({
                  where: { id: currentPricing.id },
                  data: {
                    subtotal: newSubtotal,
                    total: newSubtotal, // Assuming no discount, adjust if needed
                  },
                });

                this.logger.log(
                  `[PRICING↔SO SYNC] Updated pricing totals. New subtotal: ${newSubtotal}`,
                );
              }

              // Create missing service orders from pricing items
              // CRITICAL FIX: Skip creating service orders that were explicitly deleted in this same request
              const deletedDescriptions = (data as any)._deletedServiceOrderDescriptions as
                | Set<string>
                | undefined;

              if (syncActions.serviceOrdersToCreate.length > 0) {
                for (const soToCreate of syncActions.serviceOrdersToCreate) {
                  // Check if this description was explicitly deleted - if so, skip creating it
                  const normalizedDesc = (soToCreate.description || '').toLowerCase().trim();
                  if (deletedDescriptions?.has(normalizedDesc)) {
                    this.logger.log(
                      `[PRICING↔SO SYNC] SKIPPING service order creation for "${soToCreate.description}" - was explicitly deleted by user`,
                    );
                    continue; // Skip this one, user explicitly deleted it
                  }

                  this.logger.log(
                    `[PRICING↔SO SYNC] Creating service order: description="${soToCreate.description}", observation="${soToCreate.observation || ''}"`,
                  );

                  const newServiceOrder = await tx.serviceOrder.create({
                    data: {
                      taskId: id,
                      description: soToCreate.description,
                      observation: soToCreate.observation,
                      type: SERVICE_ORDER_TYPE.PRODUCTION,
                      status: SERVICE_ORDER_STATUS.PENDING,
                      statusOrder: getServiceOrderStatusOrder(SERVICE_ORDER_STATUS.PENDING),
                      createdById: userId || '',
                      shouldSync: true, // Service orders created by sync should participate in sync
                    },
                  });

                  // Log the creation
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.SERVICE_ORDER,
                    entityId: newServiceOrder.id,
                    action: CHANGE_ACTION.CREATE,
                    reason:
                      'Ordem de serviço criada automaticamente a partir do item de precificação',
                    triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                    triggeredById: id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  this.logger.log(`[PRICING↔SO SYNC] Created service order ${newServiceOrder.id}`);
                }
              }

              // Update service orders with new observations (if pricing item had extra text)
              if (syncActions.serviceOrdersToUpdate.length > 0) {
                for (const soToUpdate of syncActions.serviceOrdersToUpdate) {
                  this.logger.log(
                    `[PRICING↔SO SYNC] Updating service order ${soToUpdate.id} with observation="${soToUpdate.observation || ''}"`,
                  );

                  const oldSo = currentServiceOrders.find((so: any) => so.id === soToUpdate.id);

                  await tx.serviceOrder.update({
                    where: { id: soToUpdate.id },
                    data: {
                      observation: soToUpdate.observation,
                    },
                  });

                  // Log the update
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.SERVICE_ORDER,
                    entityId: soToUpdate.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'observation',
                    oldValue: oldSo?.observation || null,
                    newValue: soToUpdate.observation,
                    reason:
                      'Observação atualizada automaticamente a partir do item de precificação',
                    triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                    triggeredById: id,
                    userId: userId || '',
                    transaction: tx,
                  });
                }
              }

              // Refetch task if any sync actions were performed
              if (
                syncActions.pricingItemsToCreate.length > 0 ||
                syncActions.serviceOrdersToCreate.length > 0 ||
                syncActions.serviceOrdersToUpdate.length > 0
              ) {
                updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
                  include: {
                    ...include,
                    customer: true,
                    artworks: true,
                    observation: { include: { files: true } },
                    truck: true,
                    serviceOrders: true,
                    pricing: { include: { items: true } },
                  },
                });

                this.logger.log(
                  `[PRICING↔SO SYNC] Task refetched after sync. Pricing items: ${updatedTask?.pricing?.items?.length || 0}, Service orders: ${updatedTask?.serviceOrders?.length || 0}`,
                );
              }
            }
          } catch (syncError) {
            this.logger.error('[PRICING↔SO SYNC] Error during bidirectional sync:', syncError);
            // Don't throw - sync errors shouldn't block the main update
          }
        }

        // Handle airbrushings explicitly - update existing and create new ones
        // The repository only handles deletions (via notIn), we handle updates/creates here
        // This prevents cascade deletion of artworks (which have onDelete: Cascade on airbrushing)
        if (airbrushingsData && Array.isArray(airbrushingsData) && airbrushingsData.length > 0) {
          this.logger.log(
            `[Task Update] Processing ${airbrushingsData.length} airbrushings for task ${id}`,
          );

          for (const airbrushingData of airbrushingsData) {
            // Check if this is an existing airbrushing (valid UUID) or a new one (temp ID)
            const isExisting =
              airbrushingData.id &&
              typeof airbrushingData.id === 'string' &&
              !airbrushingData.id.startsWith('airbrushing-');

            if (isExisting) {
              // UPDATE existing airbrushing - preserves artworks (no deletion)
              this.logger.log(`[Task Update] Updating existing airbrushing ${airbrushingData.id}`);

              const updatePayload: any = {
                status: airbrushingData.status || 'PENDING',
                price:
                  airbrushingData.price !== undefined && airbrushingData.price !== null
                    ? Number(airbrushingData.price)
                    : null,
                startDate: airbrushingData.startDate || null,
                finishDate: airbrushingData.finishDate || null,
              };

              // Handle receipts (File IDs)
              if (airbrushingData.receiptIds !== undefined) {
                updatePayload.receipts =
                  airbrushingData.receiptIds.length > 0
                    ? { set: airbrushingData.receiptIds.map((fid: string) => ({ id: fid })) }
                    : { set: [] };
              }

              // Handle invoices (File IDs)
              if (airbrushingData.invoiceIds !== undefined) {
                updatePayload.invoices =
                  airbrushingData.invoiceIds.length > 0
                    ? { set: airbrushingData.invoiceIds.map((fid: string) => ({ id: fid })) }
                    : { set: [] };
              }

              // Handle artworks (File IDs -> Artwork entity IDs)
              // CRITICAL: This must be handled here to preserve artworks when no file uploads occur
              if (airbrushingData.artworkIds !== undefined) {
                if (airbrushingData.artworkIds.length > 0) {
                  // Convert File IDs to Artwork entity IDs
                  const artworkEntityIds = await this.convertFileIdsToArtworkIds(
                    airbrushingData.artworkIds,
                    null, // taskId - null for airbrushing artworks
                    airbrushingData.id, // airbrushingId
                    undefined, // artworkStatuses
                    userPrivilege,
                    tx,
                  );
                  updatePayload.artworks = {
                    set: artworkEntityIds.map((aid: string) => ({ id: aid })),
                  };
                  this.logger.log(
                    `[Task Update] Setting ${artworkEntityIds.length} artworks for airbrushing ${airbrushingData.id}`,
                  );
                } else {
                  updatePayload.artworks = { set: [] };
                  this.logger.log(
                    `[Task Update] Clearing artworks for airbrushing ${airbrushingData.id}`,
                  );
                }
              }

              await tx.airbrushing.update({
                where: { id: airbrushingData.id },
                data: updatePayload,
              });

              this.logger.log(`[Task Update] Updated airbrushing ${airbrushingData.id}`);
            } else {
              // CREATE new airbrushing
              this.logger.log(`[Task Update] Creating new airbrushing for task ${id}`);

              const newAirbrushing = await tx.airbrushing.create({
                data: {
                  taskId: id,
                  status: airbrushingData.status || 'PENDING',
                  price:
                    airbrushingData.price !== undefined && airbrushingData.price !== null
                      ? Number(airbrushingData.price)
                      : null,
                  startDate: airbrushingData.startDate || null,
                  finishDate: airbrushingData.finishDate || null,
                  receipts:
                    airbrushingData.receiptIds && airbrushingData.receiptIds.length > 0
                      ? { connect: airbrushingData.receiptIds.map((fid: string) => ({ id: fid })) }
                      : undefined,
                  invoices:
                    airbrushingData.invoiceIds && airbrushingData.invoiceIds.length > 0
                      ? { connect: airbrushingData.invoiceIds.map((fid: string) => ({ id: fid })) }
                      : undefined,
                },
              });

              this.logger.log(`[Task Update] Created airbrushing ${newAirbrushing.id}`);
            }
          }

          // Refetch task with updated airbrushings for file processing
          updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
            include: {
              ...include,
              customer: true,
              artworks: true,
              observation: { include: { files: true } },
              truck: true,
              serviceOrders: true,
              airbrushings: true,
            },
          });

          this.logger.log(
            `[Task Update] After airbrushings refetch, task has ${updatedTask?.airbrushings?.length || 0} airbrushings`,
          );
        }

        // Process and save files WITHIN the transaction
        // This ensures files are only created if the task update succeeds
        // CRITICAL: Also process if artworkStatuses is provided (even without file uploads)
        // hasArtworkData was already computed at line 1393 BEFORE deleting fields
        if (files || hasArtworkData) {
          // Ensure files is defined (set to empty object if undefined)
          // This is needed when hasArtworkData is true but no files were uploaded
          if (!files) {
            files = {} as any;
          }

          const fileUpdates: any = {};
          const customerName =
            updatedTask.customer?.fantasyName || existingTask.customer?.fantasyName;

          this.logger.log(
            `[Task Update] Processing files with customer name: "${customerName}" (from updatedTask: ${!!updatedTask.customer?.fantasyName}, from existingTask: ${!!existingTask.customer?.fantasyName})`,
          );

          // Budget files (multiple)
          // Process if new files are being uploaded OR if budgetIds is explicitly provided (for deletions)
          if ((files?.budgets && files.budgets.length > 0) || data.budgetIds !== undefined) {
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
          if ((files?.invoices && files.invoices.length > 0) || data.invoiceIds !== undefined) {
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
          if ((files?.receipts && files.receipts.length > 0) || data.receiptIds !== undefined) {
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

          // Artwork files - CRITICAL FIX for Artwork entity
          // Frontend sends artworkIds as File IDs, we need to convert to Artwork entity IDs
          // Process if new files are being uploaded OR if artworkIds/fileIds is explicitly provided (for deletions)
          let fileIdsFromRequest = (data as any).artworkIds || (data as any).fileIds;
          const artworkStatuses = (data as any).artworkStatuses; // Status map: File ID → status (for existing files)
          const newArtworkStatuses = (data as any).newArtworkStatuses; // Status array for new files (matches files array order)

          this.logger.log(`[Task Update] 🎨 ARTWORK DEBUG - Received data:`);
          this.logger.log(`  - artworkIds in request: ${JSON.stringify((data as any).artworkIds)}`);
          this.logger.log(`  - fileIds in request: ${JSON.stringify((data as any).fileIds)}`);
          this.logger.log(`  - fileIdsFromRequest (final): ${JSON.stringify(fileIdsFromRequest)}`);
          this.logger.log(`  - artworkStatuses: ${JSON.stringify(artworkStatuses)}`);
          this.logger.log(`  - newArtworkStatuses: ${JSON.stringify(newArtworkStatuses)}`);
          this.logger.log(`  - files.artworks: ${files.artworks?.length || 0} files`);

          // SAFEGUARD: Only restore artworks if artworkStatuses was provided but artworkIds was completely missing (undefined).
          // If artworkIds is an EMPTY ARRAY [], that's an intentional removal by the user - respect it.
          // The frontend now cleans up artworkStatuses when files are removed, so this safeguard
          // should only trigger in edge cases where frontend sends status changes without file IDs.
          const hasArtworkStatusChanges =
            artworkStatuses && Object.keys(artworkStatuses).length > 0;
          const artworkIdsWasNotSent = fileIdsFromRequest === undefined;
          const artworkIdsIsEmptyArray =
            Array.isArray(fileIdsFromRequest) && fileIdsFromRequest.length === 0;

          // Only restore if artworkIds was completely missing (undefined), NOT if it was explicitly sent as empty array
          if (hasArtworkStatusChanges && artworkIdsWasNotSent) {
            this.logger.warn(
              `[Task Update] 🛡️ SAFEGUARD TRIGGERED: artworkStatuses provided (${Object.keys(artworkStatuses).length} statuses) but artworkIds was NOT sent (undefined). Fetching current artworks to prevent data loss.`,
            );
            const currentTask = await tx.task.findUnique({
              where: { id },
              include: { artworks: { select: { fileId: true, id: true } } },
            });
            if (currentTask && currentTask.artworks && currentTask.artworks.length > 0) {
              // Initialize array since it was undefined
              fileIdsFromRequest = [];
              // Restore File IDs from current artworks
              const currentFileIds = currentTask.artworks.map(a => a.fileId);
              fileIdsFromRequest.push(...currentFileIds);
              this.logger.log(
                `[Task Update] 🛡️ SAFEGUARD: Restored ${fileIdsFromRequest.length} artwork File IDs: [${fileIdsFromRequest.join(', ')}]`,
              );
            } else {
              this.logger.warn(
                `[Task Update] ⚠️ SAFEGUARD: Task ${id} has no current artworks, cannot restore.`,
              );
            }
          } else if (artworkIdsIsEmptyArray) {
            // Empty array was explicitly sent - this is intentional removal, log and allow it
            this.logger.log(
              `[Task Update] 📋 artworkIds is empty array (intentional removal). hasArtworkStatusChanges: ${hasArtworkStatusChanges}, artworkStatuses entries: ${Object.keys(artworkStatuses || {}).length}`,
            );
          }

          if ((files?.artworks && files.artworks.length > 0) || fileIdsFromRequest !== undefined) {
            // Start with empty array for Artwork entity IDs
            const artworkEntityIds: string[] = [];

            // Fetch user for event context (if artworkStatuses are being processed)
            let artworkEventUser: any = null;
            if (artworkStatuses && Object.keys(artworkStatuses).length > 0 && userId) {
              artworkEventUser = await tx.user.findUnique({
                where: { id: userId },
                select: { id: true, name: true, email: true },
              });
            }

            // Step 1: Convert existing File IDs to Artwork entity IDs (with status updates if provided)
            if (fileIdsFromRequest && fileIdsFromRequest.length > 0) {
              this.logger.log(
                `[Task Update] Converting ${fileIdsFromRequest.length} File IDs to Artwork entity IDs: [${fileIdsFromRequest.join(', ')}]`,
              );
              const existingArtworkIds = await this.convertFileIdsToArtworkIds(
                fileIdsFromRequest,
                id,
                null,
                artworkStatuses,
                userPrivilege,
                tx,
                // Pass event context for artwork status change notifications
                artworkEventUser ? { user: artworkEventUser, task: existingTask } : undefined,
              );
              artworkEntityIds.push(...existingArtworkIds);
              this.logger.log(
                `[Task Update] Converted to ${existingArtworkIds.length} Artwork entity IDs`,
              );
            }

            // Step 2: Upload new artwork files and create Artwork entities for them
            if (files?.artworks && files.artworks.length > 0) {
              this.logger.log(`[Task Update] Uploading ${files.artworks.length} new artwork files`);
              for (let i = 0; i < files.artworks.length; i++) {
                const artworkFile = files.artworks[i];
                // First, create the File entity
                const fileRecord = await this.fileService.createFromUploadWithTransaction(
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
                this.logger.log(`[Task Update] Created new artwork File with ID: ${fileRecord.id}`);

                // Determine status for new upload
                // Use newArtworkStatuses array (by index) if provided, otherwise try artworkStatuses map, otherwise DRAFT
                let newFileStatus: 'DRAFT' | 'APPROVED' | 'REPROVED' = 'DRAFT';
                if (
                  newArtworkStatuses &&
                  Array.isArray(newArtworkStatuses) &&
                  newArtworkStatuses[i]
                ) {
                  newFileStatus = newArtworkStatuses[i];
                  this.logger.log(
                    `[Task Update] Using status from newArtworkStatuses[${i}]: ${newFileStatus}`,
                  );
                } else if (artworkStatuses?.[fileRecord.id]) {
                  newFileStatus = artworkStatuses[fileRecord.id];
                  this.logger.log(
                    `[Task Update] Using status from artworkStatuses map: ${newFileStatus}`,
                  );
                } else {
                  this.logger.log(`[Task Update] Using default status: DRAFT`);
                }

                // Then, create the Artwork entity for this File
                const artworkEntityId = await this.createArtworkForFile(
                  fileRecord,
                  id,
                  null,
                  newFileStatus,
                  tx,
                );
                artworkEntityIds.push(artworkEntityId);
                this.logger.log(
                  `[Task Update] Created Artwork entity with ID: ${artworkEntityId} and status: ${newFileStatus}`,
                );

              }
            }

            // Step 3: Merge with existing artworks if only new files were uploaded (no explicit artworkIds sent)
            // This prevents replacing all existing artworks when the frontend only sends new file uploads
            if (artworkIdsWasNotSent && artworkEntityIds.length > 0) {
              const currentTaskForMerge = await tx.task.findUnique({
                where: { id },
                include: { artworks: { select: { id: true } } },
              });
              if (currentTaskForMerge?.artworks?.length) {
                const currentArtworkIds = currentTaskForMerge.artworks.map(a => a.id);
                const mergedIds = [...new Set([...currentArtworkIds, ...artworkEntityIds])];
                this.logger.log(
                  `[Task Update] 🔄 MERGE: artworkIds was not sent, merging ${currentArtworkIds.length} existing artworks with ${artworkEntityIds.length} new uploads (total: ${mergedIds.length})`,
                );
                artworkEntityIds.length = 0;
                artworkEntityIds.push(...mergedIds);
              }
            }

            // Step 4: Set the Artwork entities on the Task
            this.logger.log(
              `[Task Update] Final Artwork entity IDs array (${artworkEntityIds.length} total): [${artworkEntityIds.join(', ')}]`,
            );

            // CRITICAL WARNING: Empty array will remove all artworks!
            if (artworkEntityIds.length === 0 && fileIdsFromRequest !== undefined) {
              this.logger.warn(
                `[Task Update] ⚠️ WARNING: About to set artworks to EMPTY ARRAY! This will disconnect all artworks from the task. ` +
                  `fileIdsFromRequest=${fileIdsFromRequest?.length || 0}, ` +
                  `artworkStatuses=${artworkStatuses ? Object.keys(artworkStatuses).length : 0}, ` +
                  `hasArtworkStatusChanges=${hasArtworkStatusChanges}`,
              );
            }

            fileUpdates.artworks = { set: artworkEntityIds.map(id => ({ id })) };
            this.logger.log(
              `[Task Update] Setting artworks to ${artworkEntityIds.length} Artwork entities (${fileIdsFromRequest?.length || 0} existing + ${files.artworks?.length || 0} new)`,
            );
          }

          // Base files (files used as base for artwork design)
          // Process if new files are being uploaded OR if baseFileIds is explicitly provided (for deletions)
          if ((files?.baseFiles && files.baseFiles.length > 0) || data.baseFileIds !== undefined) {
            // Start with the baseFileIds provided in the form data (files that should be kept)
            // If not provided, default to empty array (will only have the new uploads)
            const baseFileIds: string[] = data.baseFileIds ? [...data.baseFileIds] : [];
            this.logger.log(
              `[Task Update] Processing baseFiles - Received ${data.baseFileIds?.length || 0} existing IDs: [${data.baseFileIds?.join(', ') || 'none'}]`,
            );

            // Upload new files and add their IDs
            // Files are renamed to match task name with measures format
            if (files.baseFiles && files.baseFiles.length > 0) {
              this.logger.log(`[Task Update] Uploading ${files.baseFiles.length} new base files`);

              // Get task name for file renaming (use updated name if provided, otherwise existing)
              const taskNameForFile = data.name || existingTask.name || 'Tarefa';

              for (let i = 0; i < files.baseFiles.length; i++) {
                const baseFile = files.baseFiles[i];

                // Generate new filename with task name and measures
                // Pass file index (1-based) to add suffix for multiple files
                const newFilename = generateBaseFileName(
                  taskNameForFile,
                  existingTask, // existingTask has truck with layouts for measures
                  baseFile.originalname,
                  i + 1, // 1-based index for file numbering
                );

                this.logger.log(
                  `[Task Update] Renaming base file from "${baseFile.originalname}" to "${newFilename}"`,
                );

                // Update the file's originalname before upload
                baseFile.originalname = newFilename;

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

              // Get existing file/artwork IDs from the form data for this airbrushing
              const airbrushingData = (data as any).airbrushings?.[index];
              const fileIdKey = `${fileType === 'invoices' ? 'invoiceIds' : fileType === 'receipts' ? 'receiptIds' : 'artworkIds'}`;
              const existingFileIds = airbrushingData?.[fileIdKey] || [];

              // Special handling for artworks (need Artwork entities, not File entities)
              if (fileType === 'artworks') {
                // Start with empty array for Artwork entity IDs
                const artworkEntityIds: string[] = [];

                // Step 1: Convert existing File IDs to Artwork entity IDs
                if (existingFileIds && existingFileIds.length > 0) {
                  console.log(
                    `[TaskService.update] Converting ${existingFileIds.length} File IDs to Artwork entity IDs for airbrushing ${airbrushing.id}`,
                  );
                  const existingArtworkIds = await this.convertFileIdsToArtworkIds(
                    existingFileIds,
                    null,
                    airbrushing.id,
                    undefined, // No artwork statuses for airbrushing in this context
                    userPrivilege,
                    tx,
                  );
                  artworkEntityIds.push(...existingArtworkIds);
                }

                // Step 2: Upload new artwork files and create Artwork entities
                for (const file of airbrushingFiles) {
                  // Create File entity
                  const fileRecord = await this.fileService.createFromUploadWithTransaction(
                    tx,
                    file,
                    'airbrushingArtworks',
                    userId,
                    {
                      entityId: airbrushing.id,
                      entityType: 'AIRBRUSHING',
                      customerName,
                    },
                  );
                  // Create Artwork entity
                  const artworkEntityId = await this.createArtworkForFile(
                    fileRecord,
                    null,
                    airbrushing.id,
                    'DRAFT', // Default status for airbrushing uploads
                    tx,
                  );
                  artworkEntityIds.push(artworkEntityId);
                }

                // Update the airbrushing with Artwork entity IDs
                if (artworkEntityIds.length > 0) {
                  await tx.airbrushing.update({
                    where: { id: airbrushing.id },
                    data: {
                      artworks: { set: artworkEntityIds.map(id => ({ id })) },
                    },
                  });
                  console.log(
                    `[TaskService.update] Set ${artworkEntityIds.length} Artwork entities for airbrushing ${airbrushing.id} (${existingFileIds.length} existing + ${airbrushingFiles.length} new)`,
                  );
                }
              } else {
                // For receipts and invoices, handle as before (File entities only)
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
          }

          // NOTE: Observation files are processed BEFORE the first task update
          // (see lines 462-501) to avoid Prisma errors with temporary file IDs

          // Update task with file IDs if any files were uploaded
          if (Object.keys(fileUpdates).length > 0) {
            await tx.task.update({
              where: { id },
              data: fileUpdates,
            });
            // Refetch through repository to get consistent includes (DEFAULT_TASK_INCLUDE)
            // This prevents false changelog entries for fields like representatives
            updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, id, {
              include: {
                ...include,
                customer: true,
                artworks: {
                  include: {
                    file: {
                      select: {
                        id: true,
                        filename: true,
                        thumbnailUrl: true,
                      },
                    },
                  },
                },
                baseFiles: true,
                logoPaints: true,
                observation: { include: { files: true } },
                truck: true,
                serviceOrders: true,
              },
            });
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
          'forecastDate',
          'invoiceToId',
          'representatives',
          'bonusDiscountId',
          // statusOrder removed - it's auto-calculated from status, creating redundant changelog entries
          'createdById',
          // Note: chassisNumber and plate are now on Truck entity, not Task
          // Note: pricingId is handled separately below with enriched data
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

        // Special handling for pricingId to include pricing details (budgetNumber, total, items)
        if (hasValueChanged(existingTask.pricingId, updatedTask.pricingId)) {
          let oldPricingDetails: any = null;
          let newPricingDetails: any = null;

          // Fetch old pricing details if it existed
          if (existingTask.pricingId) {
            const oldPricing = await tx.taskPricing.findUnique({
              where: { id: existingTask.pricingId },
              select: {
                id: true,
                budgetNumber: true,
                total: true,
                items: {
                  select: {
                    description: true,
                    amount: true,
                  },
                },
              },
            });
            if (oldPricing) {
              oldPricingDetails = {
                id: oldPricing.id,
                budgetNumber: oldPricing.budgetNumber,
                total: oldPricing.total,
                items: oldPricing.items,
              };
            }
          }

          // Fetch new pricing details if exists
          if (updatedTask.pricingId) {
            const newPricing = await tx.taskPricing.findUnique({
              where: { id: updatedTask.pricingId },
              select: {
                id: true,
                budgetNumber: true,
                total: true,
                items: {
                  select: {
                    description: true,
                    amount: true,
                  },
                },
              },
            });
            if (newPricing) {
              newPricingDetails = {
                id: newPricing.id,
                budgetNumber: newPricing.budgetNumber,
                total: newPricing.total,
                items: newPricing.items,
              };
            }
          }

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'pricingId',
            oldValue: oldPricingDetails,
            newValue: newPricingDetails,
            reason: 'Campo Orçamento atualizado',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || '',
            transaction: tx,
          });
        }

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
              const importantFields = ['term', 'forecastDate', 'sectorId', 'details'];

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
                    const targetUsers = await this.getTargetUsersForNotification(updatedTask, tx);

                    // Create notifications for each target user
                    for (const targetUserId of targetUsers) {
                      // Skip notifying the user who made the change
                      if (targetUserId === userId) continue;

                      await this.taskNotificationService.createFieldChangeNotifications(
                        updatedTask as Task,
                        taskChanges,
                        targetUserId,
                        userId,
                        userId, // Pass userId as actorId for self-action filtering
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
        // NOTE: We skip creating TASK "services" changelog when service orders are only ADDED
        // because individual SERVICE_ORDER CREATE changelogs are already created above.
        // We only create this changelog when service orders are REMOVED to track deletions.
        // CRITICAL: Only track if user explicitly sent serviceOrders data AND there were actual removals
        if (data.serviceOrders !== undefined && Array.isArray(data.serviceOrders)) {
          const oldServices = existingTask.serviceOrders || [];
          const newServices = updatedTask?.serviceOrders || [];

          this.logger.log(
            `[Task Update Changelog] Old services count: ${oldServices.length}, New services count: ${newServices.length}`,
          );
          this.logger.log(
            `[Task Update Changelog] updatedTask has serviceOrders?: ${!!updatedTask?.serviceOrders}`,
          );

          // Skip if both are empty - no point in tracking "nothing changed"
          if (oldServices.length === 0 && newServices.length === 0) {
            this.logger.log(
              `[Task Update Changelog] Skipping serviceOrders changelog - both old and new are empty`,
            );
          } else {
            // Check if any service orders were removed (by comparing IDs)
            const oldServiceIds = new Set(oldServices.map((s: any) => s.id));
            const newServiceIds = new Set(newServices.map((s: any) => s.id));
            const removedServices = oldServices.filter((s: any) => !newServiceIds.has(s.id));

            this.logger.log(
              `[Task Update Changelog] Removed services count: ${removedServices.length}`,
            );

            // Only create TASK services changelog if service orders were REMOVED
            // Service order ADDITIONS are already covered by individual SERVICE_ORDER CREATE changelogs
            if (removedServices.length > 0) {
              // Serialize services for changelog - store full data for rollback support
              const serializeServices = (services: any[]) => {
                return services.map((s: any) => ({
                  description: s.description,
                  status: s.status,
                  ...(s.startedAt && { startedAt: s.startedAt }),
                  ...(s.finishedAt && { finishedAt: s.finishedAt }),
                }));
              };

              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field: 'serviceOrders',
                oldValue: serializeServices(oldServices),
                newValue: serializeServices(newServices),
                reason: `${removedServices.length} ordem(ns) de serviço removida(s)`,
                triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });
            }
          }
        }

        // Track artworks array changes
        // CRITICAL: Only check if the request artworkIds are DIFFERENT from existing ones
        // The frontend may send artworkIds even when not modifying them, so we need to compare
        const requestedArtworkIds = (data as any).artworkIds || (data as any).fileIds;

        if (requestedArtworkIds !== undefined) {
          const oldArtworks = existingTask.artworks || [];

          // Normalize existing artwork IDs to strings and sort
          const oldArtworkIds = oldArtworks.map((f: any) => String(f.id)).sort();

          // Normalize requested IDs to strings and sort
          const requestedIds = requestedArtworkIds.map((id: any) => String(id)).sort();

          // Compare requested IDs with existing IDs - only proceed if different
          const artworkIdsInRequestAreDifferent =
            oldArtworkIds.length !== requestedIds.length ||
            !oldArtworkIds.every((id, index) => id === requestedIds[index]);

          // Only check DB state if the request indicates a change
          if (artworkIdsInRequestAreDifferent) {
            const newArtworks = updatedTask?.artworks || [];
            const newArtworkIds = newArtworks.map((f: any) => String(f.id)).sort();

            const addedArtworks = newArtworks.filter(
              (f: any) => !oldArtworkIds.includes(String(f.id)),
            );
            const removedArtworks = oldArtworks.filter(
              (f: any) => !newArtworkIds.includes(String(f.id)),
            );

            // Only log if there are actual additions or removals
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
        }

        // Track baseFiles array changes
        // CRITICAL: Only check if the request baseFileIds are DIFFERENT from existing ones
        if (data.baseFileIds !== undefined) {
          const oldBaseFiles = existingTask.baseFiles || [];

          // Normalize existing baseFile IDs to strings and sort
          const oldBaseFileIds = oldBaseFiles.map((f: any) => String(f.id)).sort();

          // Normalize requested IDs to strings and sort
          const requestedIds = data.baseFileIds.map((id: any) => String(id)).sort();

          // Compare requested IDs with existing IDs - only proceed if different
          const baseFileIdsInRequestAreDifferent =
            oldBaseFileIds.length !== requestedIds.length ||
            !oldBaseFileIds.every((id, index) => id === requestedIds[index]);

          // Only check DB state if the request indicates a change
          if (baseFileIdsInRequestAreDifferent) {
            const newBaseFiles = updatedTask?.baseFiles || [];
            const newBaseFileIds = newBaseFiles.map((f: any) => String(f.id)).sort();

            const addedBaseFiles = newBaseFiles.filter(
              (f: any) => !oldBaseFileIds.includes(String(f.id)),
            );
            const removedBaseFiles = oldBaseFiles.filter(
              (f: any) => !newBaseFileIds.includes(String(f.id)),
            );

            // Only log if there are actual additions or removals
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
        }

        // Track logoPaints array changes (paintIds)
        // CRITICAL: Only check if the request paintIds are DIFFERENT from existing ones
        if (data.paintIds !== undefined) {
          const oldLogoPaints = existingTask.logoPaints || [];

          // Normalize existing paint IDs to strings and sort
          const oldPaintIds = oldLogoPaints.map((p: any) => String(p.id)).sort();

          // Normalize requested IDs to strings and sort
          const requestedIds = data.paintIds.map((id: any) => String(id)).sort();

          // Compare requested IDs with existing IDs - only proceed if different
          const paintIdsInRequestAreDifferent =
            oldPaintIds.length !== requestedIds.length ||
            !oldPaintIds.every((id, index) => id === requestedIds[index]);

          // Only check DB state if the request indicates a change
          if (paintIdsInRequestAreDifferent) {
            const newLogoPaints = updatedTask?.logoPaints || [];
            const newPaintIds = newLogoPaints.map((p: any) => String(p.id)).sort();

            const addedPaintIds = newPaintIds.filter((id: string) => !oldPaintIds.includes(id));
            const removedPaintIds = oldPaintIds.filter((id: string) => !newPaintIds.includes(id));

            // Only log if there are actual additions or removals
            if (addedPaintIds.length > 0 || removedPaintIds.length > 0) {
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

        return {
          updatedTask: updatedTask!,
          createdServiceOrders,
          observationChangedSOs,
          taskAutoTransitionedToWaitingProduction,
        };
      });

      // Destructure transaction result
      const {
        updatedTask,
        createdServiceOrders,
        observationChangedSOs: soObservationChanges,
        taskAutoTransitionedToWaitingProduction: wasAutoTransitioned,
      } = transactionResult;

      // Emit events for created service orders AFTER transaction commits
      if (createdServiceOrders && createdServiceOrders.length > 0) {
        this.logger.log(
          `[Task Update] Emitting events for ${createdServiceOrders.length} service orders`,
        );

        for (const serviceOrder of createdServiceOrders) {
          this.logger.log(
            `[Task Update] Emitting service_order.created event for SO ${serviceOrder.id} (type: ${serviceOrder.type})`,
          );

          // Emit creation event
          this.eventEmitter.emit('service_order.created', {
            serviceOrder,
            userId,
          });

          // If service order is assigned, emit assignment event
          if (serviceOrder.assignedToId) {
            this.logger.log(
              `[Task Update] Emitting service_order.assigned event for SO ${serviceOrder.id} to user ${serviceOrder.assignedToId}`,
            );
            this.eventEmitter.emit('service_order.assigned', {
              serviceOrder,
              userId,
              assignedToId: serviceOrder.assignedToId,
            });
          }
        }
      } else {
        this.logger.log(`[Task Update] No service orders to emit events for`);
      }

      // Emit observation change events for service orders whose observation was modified
      if (soObservationChanges && soObservationChanges.length > 0) {
        for (const { serviceOrder, oldObservation } of soObservationChanges) {
          this.logger.log(
            `[Task Update] Emitting service_order.observation.changed for SO ${serviceOrder.id}`,
          );
          this.eventEmitter.emit('service_order.observation.changed', {
            serviceOrder,
            oldObservation,
            newObservation: serviceOrder.observation,
            userId,
          });
        }
      }

      // If task was auto-transitioned to WAITING_PRODUCTION, emit event and send notifications
      // This notifies production sector users that a new task is ready for production
      if (wasAutoTransitioned) {
        this.logger.log(
          `[Task Update] Task ${id} was auto-transitioned to WAITING_PRODUCTION, emitting events and notifications`,
        );

        // Get the user who triggered the auto-transition
        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        // Emit task status changed event
        this.eventEmitter.emit('task.status.changed', {
          task: {
            id: updatedTask.id,
            name: updatedTask.name,
            serialNumber: updatedTask.serialNumber,
            status: updatedTask.status,
            sectorId: updatedTask.sectorId,
          },
          oldStatus: TASK_STATUS.PREPARATION,
          newStatus: TASK_STATUS.WAITING_PRODUCTION,
          changedBy: changedByUser || { id: 'system', name: 'Sistema' },
        });

        // Send notification to production sector users about new task ready for production
        // This is like a "task created" notification for them since WAITING_PRODUCTION is the first status they see
        try {
          // Emit task.created event to notify production sector users
          // For production users, WAITING_PRODUCTION is effectively the "new task" status
          this.eventEmitter.emit(
            'task.created',
            new TaskCreatedEvent(updatedTask as Task, changedByUser as any),
          );
          this.logger.log(
            `[Task Update] Emitted task.created event for task ${id} (auto-transitioned to WAITING_PRODUCTION)`,
          );
        } catch (notificationError) {
          this.logger.warn(`[Task Update] Failed to emit task notification: ${notificationError}`);
        }
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
      baseFiles?: Express.Multer.File[];
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

        // Look up user's sector privilege for artwork status permission checks
        // Note: batchUpdate endpoint requires @Roles(ADMIN), so the user already has ADMIN access.
        // We still fetch the privilege for logging, but fall back to ADMIN since the endpoint guard
        // already validated the user's permission level.
        let userPrivilege: string | undefined;
        if (userId) {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { sector: { select: { privileges: true } } },
          });
          userPrivilege = user?.sector?.privileges || SECTOR_PRIVILEGES.ADMIN;
          this.logger.log(`[batchUpdate] User ${userId} privilege: ${userPrivilege} (sector: ${user?.sector?.privileges || 'none'})`);
        } else {
          userPrivilege = SECTOR_PRIVILEGES.ADMIN;
        }

        // Prepare updates with change tracking and validation
        const updatesWithChangeTracking: { id: string; data: TaskUpdateFormData }[] = [];
        const validationErrors: Array<{ id: string; error: string }> = [];

        // Store existing task states BEFORE updates for changelog comparison
        const existingTaskStates: Map<string, any> = new Map();

        // Store field changes for event emission after transaction
        const fieldChangesForEvents: Array<{
          taskId: string;
          task: any;
          field: string;
          oldValue: any;
          newValue: any;
          isFileArray: boolean;
        }> = [];

        for (const update of data.tasks) {
          this.logger.log(`[batchUpdate] Processing task ${update.id}`);
          const existingTask = await this.tasksRepository.findByIdWithTransaction(tx, update.id, {
            include: {
              ...include,
              artworks: {
                include: {
                  file: {
                    select: {
                      id: true,
                      filename: true,
                      thumbnailUrl: true,
                    },
                  },
                },
              },
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

                // Note: startedAt and finishedAt are no longer required as they are auto-filled
                // when task status changes to IN_PRODUCTION or COMPLETED respectively
              }

              // Ensure statusOrder and commissionOrder are updated when status/commission changes
              const updateData = {
                ...update.data,
                ...(update.data.status && {
                  statusOrder: getTaskStatusOrder(update.data.status as TASK_STATUS),
                }),
                ...((update.data as any).commission && {
                  commissionOrder: getCommissionStatusOrder((update.data as any).commission),
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
          baseFiles?: string[];
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

          // Upload artworks and create Artwork entities
          if (files.artworks && files.artworks.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.artworks.length} artwork files`);
            uploadedFileIds.artworks = [];
            const uploadedArtworkFileIds: string[] = [];

            // Step 1: Upload files and get File IDs
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
              uploadedArtworkFileIds.push(artworkRecord.id);
            }

            // Step 2: Convert File IDs to Artwork entity IDs
            // This creates Artwork entities that wrap the uploaded Files
            this.logger.log(
              `[batchUpdate] Converting ${uploadedArtworkFileIds.length} File IDs to Artwork entity IDs`,
            );
            const artworkEntityIds = await this.convertFileIdsToArtworkIds(
              uploadedArtworkFileIds,
              null, // taskId - null since these artworks will be connected to multiple tasks
              null, // airbrushingId
              undefined, // artworkStatuses - new uploads default to DRAFT (frontend doesn't know File IDs yet)
              userPrivilege,
              tx,
            );

            // Store Artwork entity IDs (not File IDs) for merging
            uploadedFileIds.artworks = artworkEntityIds;
            this.logger.log(
              `[batchUpdate] Created ${artworkEntityIds.length} Artwork entities for uploaded files`,
            );
          }

          // Upload base files (shared across all tasks, like artworks)
          if (files.baseFiles && files.baseFiles.length > 0) {
            this.logger.log(`[batchUpdate] Uploading ${files.baseFiles.length} base files`);
            uploadedFileIds.baseFiles = [];
            for (const baseFile of files.baseFiles) {
              const baseFileRecord = await this.fileService.createFromUploadWithTransaction(
                tx,
                baseFile,
                'taskBaseFiles',
                userId,
                {
                  entityId: data.tasks[0].id,
                  entityType: 'TASK',
                  customerName,
                },
              );
              uploadedFileIds.baseFiles.push(baseFileRecord.id);
            }
            this.logger.log(
              `[batchUpdate] Uploaded ${uploadedFileIds.baseFiles.length} base files`,
            );
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

          // Process layout photo files for bulk layout operations
          // Upload photos and inject photoId into truck data for all tasks
          this.logger.log(`[batchUpdate] ===== LAYOUT PHOTO PROCESSING START =====`);
          this.logger.log(`[batchUpdate] All file keys: ${Object.keys(files).join(', ')}`);
          const uploadedLayoutPhotoIds: {
            leftSide?: string;
            rightSide?: string;
            backSide?: string;
          } = {};
          const layoutPhotoKeys = Object.keys(files).filter(k => k.startsWith('layoutPhotos.'));
          this.logger.log(
            `[batchUpdate] Layout photo keys found: ${layoutPhotoKeys.length > 0 ? layoutPhotoKeys.join(', ') : 'NONE'}`,
          );
          if (layoutPhotoKeys.length > 0) {
            this.logger.log(
              `[batchUpdate] Processing ${layoutPhotoKeys.length} layout photo files`,
            );

            for (const key of layoutPhotoKeys) {
              const side = key.replace('layoutPhotos.', '') as
                | 'leftSide'
                | 'rightSide'
                | 'backSide';
              const photoFile = Array.isArray((files as any)[key])
                ? (files as any)[key][0]
                : (files as any)[key];

              if (photoFile) {
                this.logger.log(`[batchUpdate] Uploading layout photo for ${side}`);
                const uploadedPhoto = await this.fileService.createFromUploadWithTransaction(
                  tx,
                  photoFile,
                  'layoutPhotos',
                  userId,
                  { entityType: 'LAYOUT', customerName },
                );
                uploadedLayoutPhotoIds[side] = uploadedPhoto.id;
                this.logger.log(
                  `[batchUpdate] Layout photo uploaded for ${side}: ${uploadedPhoto.id}`,
                );
              }
            }

            // Inject uploaded photo IDs into truck data for all tasks
            if (Object.keys(uploadedLayoutPhotoIds).length > 0) {
              for (const task of data.tasks) {
                const truckData = (task.data as any)?.truck;
                if (truckData) {
                  if (uploadedLayoutPhotoIds.leftSide && truckData.leftSideLayout) {
                    truckData.leftSideLayout.photoId = uploadedLayoutPhotoIds.leftSide;
                  }
                  if (uploadedLayoutPhotoIds.rightSide && truckData.rightSideLayout) {
                    truckData.rightSideLayout.photoId = uploadedLayoutPhotoIds.rightSide;
                  }
                  if (uploadedLayoutPhotoIds.backSide && truckData.backSideLayout) {
                    truckData.backSideLayout.photoId = uploadedLayoutPhotoIds.backSide;
                  }
                }
              }
              this.logger.log(
                '[batchUpdate] Injected layout photo IDs into truck data for all tasks',
              );
            }
          }
        }

        // Extract artworkStatuses from each update before processing
        // artworkStatuses is a map of File ID -> status ('DRAFT' | 'APPROVED' | 'REPROVED')
        // IMPORTANT: This must run OUTSIDE the if(files) block so status-only updates work
        const perUpdateArtworkStatuses = new Map<string, Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'>>();
        for (const update of updatesWithChangeTracking) {
          const artworkStatuses = (update.data as any).artworkStatuses;
          if (artworkStatuses) {
            perUpdateArtworkStatuses.set(update.id, artworkStatuses);
            delete (update.data as any).artworkStatuses;
          }
        }

        // Convert artworkIds from File IDs to Artwork entity IDs for ALL tasks
        // DEFENSIVE: Handle both File IDs and Artwork entity IDs (in case frontend sends wrong type)
        this.logger.log(
          '[batchUpdate] Converting artworkIds from File IDs to Artwork entity IDs',
        );
        for (const update of updatesWithChangeTracking) {
          const artworkStatuses = perUpdateArtworkStatuses.get(update.id);

          if (
            update.data.artworkIds &&
            Array.isArray(update.data.artworkIds) &&
            update.data.artworkIds.length > 0
          ) {
            this.logger.log(
              `[batchUpdate] Task ${update.id}: Processing ${update.data.artworkIds.length} artwork IDs: ${JSON.stringify(update.data.artworkIds)}`,
            );

            // DEFENSIVE CHECK: Determine if these are File IDs or Artwork entity IDs
            // Try to find them as Artwork entities first
            const existingArtworks = await tx.artwork.findMany({
              where: {
                id: { in: update.data.artworkIds },
              },
              select: { id: true, fileId: true },
            });

            this.logger.log(
              `[batchUpdate] Task ${update.id}: Checked ${update.data.artworkIds.length} IDs as Artwork entities, found ${existingArtworks.length}`,
            );

            if (existingArtworks.length === update.data.artworkIds.length) {
              // All IDs were found as Artwork entities - frontend sent Artwork entity IDs directly
              this.logger.log(
                `[batchUpdate] Task ${update.id}: ✅ All ${existingArtworks.length} IDs are valid Artwork entity IDs (no conversion needed)`,
              );
              // Keep artworkIds as-is, but still apply artworkStatuses if present
              // artworkStatuses keys are File IDs, so use existingArtworks to map fileId -> status
              if (artworkStatuses && Object.keys(artworkStatuses).length > 0) {
                const fileIds = existingArtworks.map(a => a.fileId);
                this.logger.log(
                  `[batchUpdate] Task ${update.id}: Applying artworkStatuses to ${fileIds.length} existing artworks (File IDs: ${JSON.stringify(fileIds)})`,
                );
                await this.convertFileIdsToArtworkIds(fileIds, null, null, artworkStatuses, userPrivilege, tx);
              }
            } else if (existingArtworks.length > 0) {
              // PARTIAL MATCH - some are Artwork IDs, some might be File IDs
              this.logger.warn(
                `[batchUpdate] Task ${update.id}: ⚠️ PARTIAL MATCH: Found ${existingArtworks.length}/${update.data.artworkIds.length} as Artwork entities`,
              );
              const foundIds = existingArtworks.map(a => a.id);
              const missingIds = update.data.artworkIds.filter(id => !foundIds.includes(id));
              this.logger.warn(
                `[batchUpdate] Task ${update.id}: Missing Artwork entity IDs: ${JSON.stringify(missingIds)}`,
              );

              // Try to convert missing IDs as File IDs
              this.logger.log(
                `[batchUpdate] Task ${update.id}: Attempting to convert ${missingIds.length} missing IDs as File IDs`,
              );
              const convertedIds = await this.convertFileIdsToArtworkIds(
                missingIds,
                null,
                null,
                artworkStatuses,
                userPrivilege,
                tx,
              );

              // Combine found Artwork IDs with newly converted ones
              update.data.artworkIds = [...foundIds, ...convertedIds];
              this.logger.log(
                `[batchUpdate] Task ${update.id}: Combined result: ${foundIds.length} existing + ${convertedIds.length} converted = ${update.data.artworkIds.length} total`,
              );
            } else {
              // Not all IDs were found as Artwork entities - they must be File IDs
              this.logger.log(
                `[batchUpdate] Task ${update.id}: IDs are File IDs, converting to Artwork entity IDs (found ${existingArtworks.length} existing, converting ${update.data.artworkIds.length})`,
              );

              try {
                const artworkEntityIds = await this.convertFileIdsToArtworkIds(
                  update.data.artworkIds,
                  null, // taskId - null since these are shared artworks
                  null, // airbrushingId
                  artworkStatuses, // artworkStatuses from frontend
                  userPrivilege,
                  tx,
                );

                if (!artworkEntityIds || artworkEntityIds.length === 0) {
                  this.logger.error(
                    `[batchUpdate] Task ${update.id}: Conversion returned empty array! Input IDs: ${JSON.stringify(update.data.artworkIds)}`,
                  );
                  // Keep original IDs as fallback (might be Artwork entity IDs that we missed)
                } else {
                  update.data.artworkIds = artworkEntityIds;
                  this.logger.log(
                    `[batchUpdate] Task ${update.id}: Successfully converted to ${artworkEntityIds.length} Artwork entity IDs: ${JSON.stringify(artworkEntityIds)}`,
                  );
                }
              } catch (conversionError) {
                this.logger.error(
                  `[batchUpdate] Task ${update.id}: Conversion failed: ${conversionError.message}`,
                );
                this.logger.error(
                  `[batchUpdate] Task ${update.id}: Input IDs that failed: ${JSON.stringify(update.data.artworkIds)}`,
                );
                // Try to verify if these IDs exist as Files
                const files = await tx.file.findMany({
                  where: { id: { in: update.data.artworkIds } },
                  select: { id: true },
                });
                this.logger.error(
                  `[batchUpdate] Task ${update.id}: Found ${files.length} matching File records`,
                );
                throw new Error(
                  `Failed to convert artwork IDs for task ${update.id}: ${conversionError.message}. ` +
                    `IDs provided: ${update.data.artworkIds.join(', ')}. ` +
                    `These might be invalid File IDs or Artwork entity IDs that don't exist.`,
                );
              }
            }
          }
        }

        // Handle status-only updates (artworkStatuses present but no artworkIds changes)
        // This applies status changes to existing artworks without changing which artworks are connected
        for (const update of updatesWithChangeTracking) {
          const artworkStatuses = perUpdateArtworkStatuses.get(update.id);
          if (artworkStatuses && !update.data.artworkIds) {
            const existingTask = existingTaskStates.get(update.id);
            // mapDatabaseEntityToEntity flattens artworks: a.id=FileID, no a.fileId
            const currentFileIds = existingTask?.artworks?.map((a: any) => a.fileId || a.id).filter(Boolean) || [];
            this.logger.log(
              `[batchUpdate] Task ${update.id}: Status-only update path - artworkStatuses=${JSON.stringify(artworkStatuses)}, currentFileIds=${JSON.stringify(currentFileIds)}, userPrivilege=${userPrivilege}`,
            );
            if (currentFileIds.length > 0) {
              this.logger.log(
                `[batchUpdate] Task ${update.id}: Applying status-only updates to ${currentFileIds.length} existing artworks (canApprove=${this.canApproveArtworks(userPrivilege)})`,
              );
              const updatedArtworkIds = await this.convertFileIdsToArtworkIds(
                currentFileIds,
                null,
                null,
                artworkStatuses,
                userPrivilege,
                tx,
              );
              this.logger.log(
                `[batchUpdate] Task ${update.id}: Status-only update completed, ${updatedArtworkIds.length} artworks processed`,
              );
            } else {
              this.logger.warn(
                `[batchUpdate] Task ${update.id}: No existing artworks found for status-only update`,
              );
            }
          } else if (artworkStatuses && update.data.artworkIds) {
            this.logger.log(
              `[batchUpdate] Task ${update.id}: Skipping status-only path because artworkIds is set (${(update.data.artworkIds as string[]).length} IDs) - statuses applied during conversion`,
            );
          }
        }

        // Add uploaded files to all tasks in the batch (only when files were uploaded)
        if (files && data.tasks.length > 0) {
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
                baseFiles: true,
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
              // Only merge uploaded artwork File IDs if artworkIds was NOT explicitly provided in the request
              // If artworkIds is present, it means user wants to SET specific artworks (copy-from-task, bulk operations)
              // If artworkIds is missing, it means user wants to ADD to existing artworks
              const hasExplicitArtworkIds = update.data.artworkIds !== undefined;

              if (!hasExplicitArtworkIds) {
                // ADD mode: Merge uploaded artwork entities with current artwork entities
                // IMPORTANT: Both arrays must use Artwork ENTITY IDs (not File IDs)
                // uploadedFileIds.artworks already contains Artwork entity IDs (from convertFileIdsToArtworkIds)
                // mapDatabaseEntityToEntity flattens artworks: a.id=FileID, a.artworkId=EntityID
                const currentArtworkEntityIds =
                  currentTask.artworks?.map((a: any) => a.artworkId || a.id) || [];
                const mergedArtworkIds = [
                  ...new Set([...currentArtworkEntityIds, ...uploadedFileIds.artworks]),
                ];
                update.data.artworkIds = mergedArtworkIds;
                this.logger.log(
                  `[batchUpdate] Adding ${uploadedFileIds.artworks.length} artworks to task ${update.id} (merged with ${currentArtworkEntityIds.length} existing, total: ${mergedArtworkIds.length} Artwork entity IDs)`,
                );
              } else {
                // SET/REPLACE mode: artworkIds was explicitly provided, so just add uploaded files to it
                // The existing update.data.artworkIds contains the explicit list the user wants
                const currentArtworkIds = Array.isArray(update.data.artworkIds)
                  ? update.data.artworkIds
                  : [];
                const mergedIds = [...new Set([...currentArtworkIds, ...uploadedFileIds.artworks])];
                update.data.artworkIds = mergedIds;
                this.logger.log(
                  `[batchUpdate] Artwork IDs explicitly provided (${currentArtworkIds.length}), adding ${uploadedFileIds.artworks.length} uploaded files (total: ${mergedIds.length})`,
                );
              }
            }

            // Merge uploaded base files with each task (same SET/ADD pattern as artworks)
            if (uploadedFileIds.baseFiles && uploadedFileIds.baseFiles.length > 0) {
              const hasExplicitBaseFileIds = update.data.baseFileIds !== undefined;

              if (!hasExplicitBaseFileIds) {
                // ADD mode: merge uploaded files with current base files
                const currentBaseFileIds =
                  currentTask.baseFiles?.map((f: any) => f.id) || [];
                const mergedBaseFileIds = [
                  ...new Set([...currentBaseFileIds, ...uploadedFileIds.baseFiles]),
                ];
                update.data.baseFileIds = mergedBaseFileIds;
                this.logger.log(
                  `[batchUpdate] Adding ${uploadedFileIds.baseFiles.length} base files to task ${update.id} (merged with ${currentBaseFileIds.length} existing, total: ${mergedBaseFileIds.length})`,
                );
              } else {
                // SET/REPLACE mode: baseFileIds was explicitly provided, add uploaded files to it
                const currentBaseFileIds = Array.isArray(update.data.baseFileIds)
                  ? update.data.baseFileIds
                  : [];
                const mergedIds = [...new Set([...currentBaseFileIds, ...uploadedFileIds.baseFiles])];
                update.data.baseFileIds = mergedIds;
                this.logger.log(
                  `[batchUpdate] Base file IDs explicitly provided (${currentBaseFileIds.length}), adding ${uploadedFileIds.baseFiles.length} uploaded files (total: ${mergedIds.length})`,
                );
              }
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
              const removeCutIds = update.data.removeCutIds;
              // Delete the cuts directly using prisma
              await tx.cut.deleteMany({
                where: {
                  id: { in: removeCutIds },
                  taskId: update.id,
                },
              });
              delete update.data.removeCutIds;
              this.logger.log(
                `[batchUpdate] Removed ${removeCutIds.length} cuts from task ${update.id}`,
              );
            }

            // Handle new cuts additively (don't pass to repository which would do deleteMany+create)
            if (update.data.cuts && Array.isArray(update.data.cuts) && update.data.cuts.length > 0) {
              const cutsToAdd = update.data.cuts;
              this.logger.log(
                `[batchUpdate] Adding ${cutsToAdd.length} new cuts to task ${update.id} (additive)`,
              );

              for (const cutItem of cutsToAdd) {
                if (!cutItem.fileId) continue;
                const quantity = (cutItem as any).quantity || 1;
                for (let i = 0; i < quantity; i++) {
                  await tx.cut.create({
                    data: {
                      fileId: cutItem.fileId,
                      type: cutItem.type as any,
                      origin: (cutItem.origin || 'PLAN') as any,
                      reason: cutItem.reason || null,
                      status: CUT_STATUS.PENDING as any,
                      statusOrder: 1,
                      taskId: update.id,
                    },
                  });
                }
              }

              // Remove cuts from update data so repository doesn't do deleteMany+create
              delete update.data.cuts;
            }

            this.logger.log(
              `[batchUpdate] After merge and removals - update.data:`,
              JSON.stringify(update.data),
            );
          }
        }

        // FINAL VALIDATION: Verify all artwork IDs exist before attempting Prisma update
        this.logger.log('[batchUpdate] Final validation: Verifying all artwork IDs exist');
        for (const update of updatesWithChangeTracking) {
          if (
            update.data.artworkIds &&
            Array.isArray(update.data.artworkIds) &&
            update.data.artworkIds.length > 0
          ) {
            const finalCheck = await tx.artwork.findMany({
              where: {
                id: { in: update.data.artworkIds },
              },
              select: { id: true },
            });

            if (finalCheck.length !== update.data.artworkIds.length) {
              const foundIds = finalCheck.map(a => a.id);
              const missingIds = update.data.artworkIds.filter(id => !foundIds.includes(id));
              this.logger.error(
                `[batchUpdate] ❌ VALIDATION FAILED for task ${update.id}: ` +
                  `Expected ${update.data.artworkIds.length} artwork entities, found ${finalCheck.length}. ` +
                  `Missing IDs: ${JSON.stringify(missingIds)}`,
              );

              throw new Error(
                `Cannot update task ${update.id}: ${missingIds.length} artwork ID(s) don't exist in database. ` +
                  `Missing: ${missingIds.join(', ')}. These IDs were either deleted or never existed.`,
              );
            }

            this.logger.log(
              `[batchUpdate] ✅ Task ${update.id}: All ${update.data.artworkIds.length} artwork IDs validated successfully`,
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
        // Phase 1: Collect all tasks that need layout updates and determine shared layout data
        const tasksNeedingLayoutUpdate: Array<{
          taskId: string;
          truckData: any;
        }> = [];

        for (const task of result.success) {
          const updateData = data.tasks.find(u => u.id === task.id)?.data;
          const truckData = (updateData as any)?.truck;
          if (
            truckData &&
            (truckData.leftSideLayout || truckData.rightSideLayout || truckData.backSideLayout)
          ) {
            tasksNeedingLayoutUpdate.push({ taskId: task.id, truckData });
          }
        }

        if (tasksNeedingLayoutUpdate.length > 0) {
          this.logger.log(
            `[batchUpdate] Processing shared layouts for ${tasksNeedingLayoutUpdate.length} tasks`,
          );

          // Create ONE shared layout per side (from the first task's layout data, since batch sends identical data)
          const firstTruckData = tasksNeedingLayoutUpdate[0].truckData;
          const sharedLayoutIds: {
            leftSideLayoutId: string | null;
            rightSideLayoutId: string | null;
            backSideLayoutId: string | null;
          } = {
            leftSideLayoutId: null,
            rightSideLayoutId: null,
            backSideLayoutId: null,
          };

          // Helper to create a single shared layout for a side
          const createSharedLayout = async (
            layoutData: any,
            sideName: string,
          ): Promise<string | null> => {
            if (!layoutData) return null;

            this.logger.log(`[batchUpdate] Creating shared ${sideName} layout`);
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
            this.logger.log(`[batchUpdate] Shared ${sideName} layout created: ${newLayout.id}`);
            return newLayout.id;
          };

          // Create shared layouts (one per side)
          sharedLayoutIds.leftSideLayoutId = await createSharedLayout(
            firstTruckData.leftSideLayout,
            'left',
          );
          sharedLayoutIds.rightSideLayoutId = await createSharedLayout(
            firstTruckData.rightSideLayout,
            'right',
          );
          sharedLayoutIds.backSideLayoutId = await createSharedLayout(
            firstTruckData.backSideLayout,
            'back',
          );

          // Helper to safely disconnect a truck from a layout (check usage count before deleting)
          const safeDisconnectLayout = async (
            truckId: string,
            existingLayoutId: string | null,
            layoutField: 'leftSideLayoutId' | 'rightSideLayoutId' | 'backSideLayoutId',
            sideName: string,
          ) => {
            if (!existingLayoutId) return;

            // Disconnect this truck from the layout first
            await tx.truck.update({
              where: { id: truckId },
              data: { [layoutField]: null },
            });

            // Check if other trucks still reference this layout
            const relationName =
              layoutField === 'leftSideLayoutId'
                ? 'trucksLeftSide'
                : layoutField === 'rightSideLayoutId'
                  ? 'trucksRightSide'
                  : 'trucksBackSide';
            const layoutWithRefs = await tx.layout.findUnique({
              where: { id: existingLayoutId },
              include: { [relationName]: { select: { id: true } } },
            });

            if (layoutWithRefs) {
              const remainingTrucks = (layoutWithRefs as any)[relationName] || [];
              if (remainingTrucks.length === 0) {
                // No other trucks reference this layout - safe to delete
                await tx.layoutSection.deleteMany({ where: { layoutId: existingLayoutId } });
                await tx.layout.delete({ where: { id: existingLayoutId } });
                this.logger.log(
                  `[batchUpdate] Deleted orphaned ${sideName} layout: ${existingLayoutId}`,
                );
              } else {
                this.logger.log(
                  `[batchUpdate] Layout ${existingLayoutId} still shared by ${remainingTrucks.length} truck(s), only disconnected`,
                );
              }
            }
          };

          // Phase 2: For each task, ensure truck exists, safely disconnect old layouts, point to shared layouts
          for (const { taskId, truckData } of tasksNeedingLayoutUpdate) {
            this.logger.log(`[batchUpdate] Processing truck layouts for task ${taskId}`);

            // Get the task with truck info
            const taskWithTruck = await tx.task.findUnique({
              where: { id: taskId },
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

            if (!truckId) {
              this.logger.log(`[batchUpdate] No truck exists for task ${taskId} - creating one`);
              const newTruck = await tx.truck.create({
                data: {
                  taskId: taskId,
                  plate: truckData.plate || null,
                  chassisNumber: truckData.chassisNumber || null,
                  category: truckData.category || null,
                  implementType: truckData.implementType || null,
                  spot: truckData.spot || null,
                },
              });
              truckId = newTruck.id;
              this.logger.log(`[batchUpdate] Truck created: ${truckId}`);
            } else {
              this.logger.log(`[batchUpdate] Using existing truck: ${truckId}`);
            }

            // Safely disconnect from old layouts (check usage count before deleting)
            const existingLeftId = taskWithTruck?.truck?.leftSideLayoutId ?? null;
            const existingRightId = taskWithTruck?.truck?.rightSideLayoutId ?? null;
            const existingBackId = taskWithTruck?.truck?.backSideLayoutId ?? null;

            if (sharedLayoutIds.leftSideLayoutId && existingLeftId !== sharedLayoutIds.leftSideLayoutId) {
              await safeDisconnectLayout(truckId, existingLeftId, 'leftSideLayoutId', 'left');
            }
            if (sharedLayoutIds.rightSideLayoutId && existingRightId !== sharedLayoutIds.rightSideLayoutId) {
              await safeDisconnectLayout(truckId, existingRightId, 'rightSideLayoutId', 'right');
            }
            if (sharedLayoutIds.backSideLayoutId && existingBackId !== sharedLayoutIds.backSideLayoutId) {
              await safeDisconnectLayout(truckId, existingBackId, 'backSideLayoutId', 'back');
            }

            // Point truck to the shared layouts
            const layoutUpdate: any = {};
            if (sharedLayoutIds.leftSideLayoutId) {
              layoutUpdate.leftSideLayoutId = sharedLayoutIds.leftSideLayoutId;
            }
            if (sharedLayoutIds.rightSideLayoutId) {
              layoutUpdate.rightSideLayoutId = sharedLayoutIds.rightSideLayoutId;
            }
            if (sharedLayoutIds.backSideLayoutId) {
              layoutUpdate.backSideLayoutId = sharedLayoutIds.backSideLayoutId;
            }

            if (Object.keys(layoutUpdate).length > 0) {
              await tx.truck.update({
                where: { id: truckId },
                data: layoutUpdate,
              });
              this.logger.log(
                `[batchUpdate] Truck ${truckId} pointed to shared layouts: ${JSON.stringify(layoutUpdate)}`,
              );
            }

            this.logger.log(`[batchUpdate] Finished processing layouts for task ${taskId}`);
          }
        }

        // Track individual field changes for successful updates
        for (const task of result.success) {
          const updateData = data.tasks.find(u => u.id === task.id)?.data;
          const existingTask = existingTaskStates.get(task.id);

          // Fetch updated task with all relations for comparison
          const updatedTask = await this.tasksRepository.findByIdWithTransaction(tx, task.id, {
            include: {
              artworks: {
                include: {
                  file: {
                    select: {
                      id: true,
                      filename: true,
                      thumbnailUrl: true,
                    },
                  },
                },
              },
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

              // Normalize IDs to strings and sort for consistent comparison
              const oldArtworkIds = oldArtworks.map((f: any) => String(f.id)).sort();
              const newArtworkIds = newArtworks.map((f: any) => String(f.id)).sort();

              // Check if arrays are actually different
              const idsChanged =
                oldArtworkIds.length !== newArtworkIds.length ||
                !oldArtworkIds.every((id, index) => id === newArtworkIds[index]);

              if (idsChanged) {
                const addedArtworks = newArtworks.filter(
                  (f: any) => !oldArtworkIds.includes(String(f.id)),
                );
                const removedArtworks = oldArtworks.filter(
                  (f: any) => !newArtworkIds.includes(String(f.id)),
                );

                if (addedArtworks.length > 0 || removedArtworks.length > 0) {
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'artworks',
                    oldValue: oldArtworks.length > 0 ? oldArtworks : null,
                    newValue: newArtworks.length > 0 ? newArtworks : null,
                    reason: `Campo artes atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: 'artworks',
                    oldValue: oldArtworks,
                    newValue: newArtworks,
                    isFileArray: true,
                  });
                }
              }
            }

            // Track baseFiles changes
            if (updateData.baseFileIds !== undefined) {
              const oldBaseFiles = existingTask.baseFiles || [];
              const newBaseFiles = updatedTask.baseFiles || [];

              // Normalize IDs to strings and sort for consistent comparison
              const oldBaseFileIds = oldBaseFiles.map((f: any) => String(f.id)).sort();
              const newBaseFileIds = newBaseFiles.map((f: any) => String(f.id)).sort();

              // Check if arrays are actually different
              const idsChanged =
                oldBaseFileIds.length !== newBaseFileIds.length ||
                !oldBaseFileIds.every((id, index) => id === newBaseFileIds[index]);

              if (idsChanged) {
                const addedBaseFiles = newBaseFiles.filter(
                  (f: any) => !oldBaseFileIds.includes(String(f.id)),
                );
                const removedBaseFiles = oldBaseFiles.filter(
                  (f: any) => !newBaseFileIds.includes(String(f.id)),
                );

                if (addedBaseFiles.length > 0 || removedBaseFiles.length > 0) {
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'baseFiles',
                    oldValue: oldBaseFiles.length > 0 ? oldBaseFiles : null,
                    newValue: newBaseFiles.length > 0 ? newBaseFiles : null,
                    reason: `Campo arquivos base atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: 'baseFiles',
                    oldValue: oldBaseFiles,
                    newValue: newBaseFiles,
                    isFileArray: true,
                  });
                }
              }
            }

            // Track budgets changes
            if (updateData.budgetIds !== undefined) {
              const oldBudgets = existingTask.budgets || [];
              const newBudgets = updatedTask.budgets || [];

              // Normalize IDs to strings and sort for consistent comparison
              const oldBudgetIds = oldBudgets.map((f: any) => String(f.id)).sort();
              const newBudgetIds = newBudgets.map((f: any) => String(f.id)).sort();

              // Check if arrays are actually different
              const idsChanged =
                oldBudgetIds.length !== newBudgetIds.length ||
                !oldBudgetIds.every((id, index) => id === newBudgetIds[index]);

              if (idsChanged) {
                const addedBudgets = newBudgets.filter(
                  (f: any) => !oldBudgetIds.includes(String(f.id)),
                );
                const removedBudgets = oldBudgets.filter(
                  (f: any) => !newBudgetIds.includes(String(f.id)),
                );

                if (addedBudgets.length > 0 || removedBudgets.length > 0) {
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'budgets',
                    oldValue: oldBudgets.length > 0 ? oldBudgets : null,
                    newValue: newBudgets.length > 0 ? newBudgets : null,
                    reason: `Campo orçamentos atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: 'budgets',
                    oldValue: oldBudgets,
                    newValue: newBudgets,
                    isFileArray: true,
                  });
                }
              }
            }

            // Track invoices changes
            if (updateData.invoiceIds !== undefined) {
              const oldInvoices = existingTask.invoices || [];
              const newInvoices = updatedTask.invoices || [];

              // Normalize IDs to strings and sort for consistent comparison
              const oldInvoiceIds = oldInvoices.map((f: any) => String(f.id)).sort();
              const newInvoiceIds = newInvoices.map((f: any) => String(f.id)).sort();

              // Check if arrays are actually different
              const idsChanged =
                oldInvoiceIds.length !== newInvoiceIds.length ||
                !oldInvoiceIds.every((id, index) => id === newInvoiceIds[index]);

              if (idsChanged) {
                const addedInvoices = newInvoices.filter(
                  (f: any) => !oldInvoiceIds.includes(String(f.id)),
                );
                const removedInvoices = oldInvoices.filter(
                  (f: any) => !newInvoiceIds.includes(String(f.id)),
                );

                if (addedInvoices.length > 0 || removedInvoices.length > 0) {
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'invoices',
                    oldValue: oldInvoices.length > 0 ? oldInvoices : null,
                    newValue: newInvoices.length > 0 ? newInvoices : null,
                    reason: `Campo notas fiscais atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: 'invoices',
                    oldValue: oldInvoices,
                    newValue: newInvoices,
                    isFileArray: true,
                  });
                }
              }
            }

            // Track receipts changes
            if (updateData.receiptIds !== undefined) {
              const oldReceipts = existingTask.receipts || [];
              const newReceipts = updatedTask.receipts || [];

              // Normalize IDs to strings and sort for consistent comparison
              const oldReceiptIds = oldReceipts.map((f: any) => String(f.id)).sort();
              const newReceiptIds = newReceipts.map((f: any) => String(f.id)).sort();

              // Check if arrays are actually different
              const idsChanged =
                oldReceiptIds.length !== newReceiptIds.length ||
                !oldReceiptIds.every((id, index) => id === newReceiptIds[index]);

              if (idsChanged) {
                const addedReceipts = newReceipts.filter(
                  (f: any) => !oldReceiptIds.includes(String(f.id)),
                );
                const removedReceipts = oldReceipts.filter(
                  (f: any) => !newReceiptIds.includes(String(f.id)),
                );

                if (addedReceipts.length > 0 || removedReceipts.length > 0) {
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'receipts',
                    oldValue: oldReceipts.length > 0 ? oldReceipts : null,
                    newValue: newReceipts.length > 0 ? newReceipts : null,
                    reason: `Campo comprovantes atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: 'receipts',
                    oldValue: oldReceipts,
                    newValue: newReceipts,
                    isFileArray: true,
                  });
                }
              }
            }

            // Track logoPaints changes
            if (updateData.paintIds !== undefined) {
              const oldPaintIds = (
                existingTask.logoPaints?.map((p: any) => String(p.id)) || []
              ).sort();
              const newPaintIds = (
                updatedTask.logoPaints?.map((p: any) => String(p.id)) || []
              ).sort();

              // Check if arrays are actually different
              const idsChanged =
                oldPaintIds.length !== newPaintIds.length ||
                !oldPaintIds.every((id, index) => id === newPaintIds[index]);

              if (idsChanged) {
                const addedPaintIds = newPaintIds.filter((id: string) => !oldPaintIds.includes(id));
                const removedPaintIds = oldPaintIds.filter(
                  (id: string) => !newPaintIds.includes(id),
                );

                if (addedPaintIds.length > 0 || removedPaintIds.length > 0) {
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'logoPaints',
                    oldValue: oldPaintIds.length > 0 ? oldPaintIds : null,
                    newValue: newPaintIds.length > 0 ? newPaintIds : null,
                    reason: `Campo tintas de logo atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: 'logoPaints',
                    oldValue: existingTask.logoPaints || [],
                    newValue: updatedTask.logoPaints || [],
                    isFileArray: true,
                  });
                }
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
                  reason: `Campo tinta atualizado`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });

                // Store for event emission
                fieldChangesForEvents.push({
                  taskId: task.id,
                  task: updatedTask,
                  field: 'paintId',
                  oldValue: oldPaintId,
                  newValue: newPaintId,
                  isFileArray: false,
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
                  reason: `Campo recortes atualizado`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: task.id,
                  userId: userId || '',
                  transaction: tx,
                });

                // Store for event emission
                fieldChangesForEvents.push({
                  taskId: task.id,
                  task: updatedTask,
                  field: 'cuts',
                  oldValue: oldCuts,
                  newValue: newCuts,
                  isFileArray: false,
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
                  const fieldLabel = translateFieldName(field);
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: field,
                    oldValue: oldValue,
                    newValue: newValue,
                    reason: `Campo ${fieldLabel} atualizado`,
                    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  // Store for event emission
                  fieldChangesForEvents.push({
                    taskId: task.id,
                    task: updatedTask,
                    field: field,
                    oldValue: oldValue,
                    newValue: newValue,
                    isFileArray: false,
                  });
                }
              }
            }

            // =====================================================================
            // BIDIRECTIONAL SYNC: Task Status → Service Order Status (Batch)
            // When task status changes, sync production service orders accordingly
            // =====================================================================
            if (updateData.status && updateData.status !== existingTask.status) {
              const oldTaskStatus = existingTask.status as TASK_STATUS;
              const newTaskStatus = updateData.status as TASK_STATUS;

              // Get all service orders for this task
              const taskServiceOrders = await tx.serviceOrder.findMany({
                where: { taskId: task.id },
                select: {
                  id: true,
                  status: true,
                  type: true,
                  description: true,
                  startedAt: true,
                  finishedAt: true,
                },
              });

              // Get service order updates needed for this task status change
              const serviceOrderUpdates = getServiceOrderUpdatesForTaskStatusChange(
                taskServiceOrders.map((so: any) => ({
                  id: so.id,
                  status: so.status as SERVICE_ORDER_STATUS,
                  type: so.type as SERVICE_ORDER_TYPE,
                  startedAt: so.startedAt,
                  finishedAt: so.finishedAt,
                })),
                oldTaskStatus,
                newTaskStatus,
              );

              if (serviceOrderUpdates.length > 0) {
                this.logger.log(
                  `[TASK→SO SYNC BATCH] Task ${task.id} status changed ${oldTaskStatus} → ${newTaskStatus}, updating ${serviceOrderUpdates.length} service orders`,
                );

                for (const update of serviceOrderUpdates) {
                  const so = taskServiceOrders.find((s: any) => s.id === update.serviceOrderId);
                  if (!so) continue;

                  const soUpdateData: any = {
                    status: update.newStatus,
                    statusOrder: getServiceOrderStatusOrder(update.newStatus),
                  };

                  // Set dates based on update flags
                  if (update.setStartedAt && !so.startedAt) {
                    soUpdateData.startedAt = new Date();
                    soUpdateData.startedById = userId || null;
                  }
                  if (update.setFinishedAt && !so.finishedAt) {
                    soUpdateData.finishedAt = new Date();
                    soUpdateData.completedById = userId || null;
                  }
                  if (update.clearStartedAt) {
                    soUpdateData.startedAt = null;
                    soUpdateData.startedById = null;
                  }
                  if (update.clearFinishedAt) {
                    soUpdateData.finishedAt = null;
                    soUpdateData.completedById = null;
                  }

                  await tx.serviceOrder.update({
                    where: { id: update.serviceOrderId },
                    data: soUpdateData,
                  });

                  // Log the sync in changelog
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.SERVICE_ORDER,
                    entityId: update.serviceOrderId,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'status',
                    oldValue: so.status,
                    newValue: update.newStatus,
                    reason: update.reason + ' (batch)',
                    triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                    triggeredById: task.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  this.logger.log(
                    `[TASK→SO SYNC BATCH] Service order ${update.serviceOrderId} (${so.description}) status: ${so.status} → ${update.newStatus}`,
                  );
                }
              }
            }
          }
        }

        this.logger.log(
          `[batchUpdate] Transaction complete. Success: ${result.totalUpdated}, Failed: ${result.totalFailed}`,
        );
        return { ...result, fieldChangesForEvents };
      });

      // After transaction: Emit field change events for notifications
      if (result.fieldChangesForEvents && result.fieldChangesForEvents.length > 0) {
        this.logger.log(
          `[batchUpdate] Emitting ${result.fieldChangesForEvents.length} field change event(s) for notifications`,
        );

        for (const change of result.fieldChangesForEvents) {
          try {
            // Emit task.field.changed event (handled by task.listener.ts for notifications)
            this.eventEmitter.emit('task.field.changed', {
              task: change.task,
              field: change.field,
              oldValue: change.oldValue,
              newValue: change.newValue,
              changedBy: userId,
              isFileArray: change.isFileArray,
            });

            this.logger.debug(
              `[batchUpdate] Emitted task.field.changed for task ${change.taskId}, field: ${change.field}`,
            );
          } catch (eventError) {
            this.logger.error(
              `[batchUpdate] Error emitting event for task ${change.taskId}, field ${change.field}:`,
              eventError,
            );
            // Don't throw - event emission is not critical
          }
        }
      }

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

      // Clean up uploaded temp files to prevent orphans
      if (files) {
        const allFiles = [
          ...(files.budgets || []),
          ...(files.invoices || []),
          ...(files.receipts || []),
          ...(files.artworks || []),
          ...(files.cutFiles || []),
          ...(files.baseFiles || []),
        ];
        for (const file of allFiles) {
          try {
            const fs = await import('fs');
            if (file.path) fs.unlinkSync(file.path);
          } catch (cleanupError) {
            this.logger.warn(`[batchUpdate] Failed to cleanup temp file: ${file.path}`);
          }
        }
        this.logger.log(`[batchUpdate] Cleaned up ${allFiles.length} temp files after failure`);
      }

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
  async findById(
    id: string,
    include?: TaskInclude,
    userRole?: string,
  ): Promise<TaskGetUniqueResponse> {
    try {
      const task = await this.tasksRepository.findById(id, { include });

      if (!task) {
        throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
      }

      // Filter artworks based on user role
      // Only COMMERCIAL, DESIGNER, LOGISTIC, and ADMIN can see all artworks
      // Others can only see APPROVED artworks
      if (task.artworks && userRole) {
        const canSeeAllArtworks = ['COMMERCIAL', 'DESIGNER', 'LOGISTIC', 'ADMIN'].includes(
          userRole,
        );

        if (!canSeeAllArtworks) {
          task.artworks = task.artworks.filter(
            artwork => artwork.status === 'APPROVED' || artwork.status === null,
          );
        }
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
  async findMany(query: TaskGetManyFormData, userRole?: string): Promise<TaskGetManyResponse> {
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
        select: query.select,
      };

      const result = await this.tasksRepository.findMany(params);

      // Filter artworks based on user role for each task
      // Only COMMERCIAL, DESIGNER, LOGISTIC, and ADMIN can see all artworks
      // Others can only see APPROVED artworks
      if (userRole) {
        const canSeeAllArtworks = ['COMMERCIAL', 'DESIGNER', 'LOGISTIC', 'ADMIN'].includes(
          userRole,
        );

        if (!canSeeAllArtworks) {
          result.data = result.data.map(task => {
            if (task.artworks) {
              return {
                ...task,
                artworks: task.artworks.filter(
                  artwork => artwork.status === 'APPROVED' || artwork.status === null,
                ),
              };
            }
            return task;
          });
        }
      }

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
      'serviceOrders', // Financial can manage COMMERCIAL, LOGISTIC, FINANCIAL service orders
      'artworkIds', // Sent by form to preserve existing artwork state (Financial can't add/remove artworks via UI)
      'artworkStatuses', // Sent by form to preserve existing artwork statuses
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
   * Commercial CAN edit: truck (plate, chassisNumber, category, implementType, spot, layouts), base files
   * Commercial CANNOT edit: financial (budgets, invoices, receipts, NFEs), cut plan (cuts)
   */
  private validateCommercialSectorAccess(data: TaskUpdateFormData): void {
    const disallowedFields = [
      'budgetIds', // Cannot edit financial documents
      'nfeIds', // Cannot edit financial documents
      'receiptIds', // Cannot edit financial documents
      'cuts', // Cannot edit cut plans
    ];

    // Only block fields that have actual values (not empty arrays or undefined)
    // The frontend may send empty arrays to clear files, which should be allowed
    const blockedFields = disallowedFields.filter(field => {
      const value = (data as any)[field];
      // Block only if field exists and has actual content
      return value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0);
    });

    if (blockedFields.length > 0) {
      throw new BadRequestException(
        `Setor Comercial não tem permissão para atualizar os seguintes campos: ${blockedFields.join(', ')}. ` +
          `Campos bloqueados: financeiro (orçamentos, NFEs, recibos), plano de corte.`,
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

        // Ensure finishedAt >= startedAt (allow same timestamp for instant completion)
        const startedAt = data.startedAt || existingTask?.startedAt;
        const finishedAt = data.finishedAt || existingTask?.finishedAt;

        if (startedAt && finishedAt) {
          const startDate = new Date(startedAt);
          const finishDate = new Date(finishedAt);

          if (finishDate < startDate) {
            throw new BadRequestException(
              'Data de conclusão deve ser posterior ou igual à data de início.',
            );
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
      else if (['statusOrder'].includes(fieldToRevert)) {
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

      // Update commissionOrder when commission changes
      if (fieldToRevert === 'commission' && convertedValue) {
        updateData.commissionOrder = getCommissionStatusOrder(convertedValue as string);
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

    // Wrap all position updates in a transaction for atomicity
    // Either all succeed or none do, preventing partial position state
    try {
      await this.prisma.$transaction(async () => {
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

        // If any errors, throw to roll back all changes
        if (errors.length > 0) {
          throw new Error(`${errors.length} position updates failed`);
        }
      });
    } catch (txError) {
      // If transaction failed, the errors array already has details
      if (errors.length === 0) {
        // Unexpected transaction error
        errors.push({
          index: -1,
          data: null,
          error: txError.message || 'Erro na transação',
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
        success: errors.length === 0 ? results : [],
        failed: errors,
        totalProcessed: data.updates.length,
        totalSuccess: errors.length === 0 ? results.length : 0,
        totalFailed: errors.length > 0 ? data.updates.length : 0,
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

    // Store field changes for event emission after transaction
    const fieldChangesForEvents: Array<{
      taskId: string;
      task: any;
      oldValue: any[];
      newValue: any[];
    }> = [];

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
            oldValue: currentArtworkIds,
            newValue: mergedArtworkIds,
            reason: `Campo artes atualizado`,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            triggeredById: task.id,
            userId: userId || '',
            transaction: tx,
          });

          // Store for event emission
          fieldChangesForEvents.push({
            taskId: task.id,
            task: currentTask,
            oldValue: currentArtworkIds,
            newValue: mergedArtworkIds,
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

    // After transaction: Emit field change events for notifications
    if (fieldChangesForEvents.length > 0) {
      this.logger.log(
        `[bulkAddArtworks] Emitting ${fieldChangesForEvents.length} field change event(s) for notifications`,
      );

      for (const change of fieldChangesForEvents) {
        try {
          this.eventEmitter.emit('task.field.changed', {
            task: change.task,
            field: 'artworks',
            oldValue: change.oldValue,
            newValue: change.newValue,
            changedBy: userId,
            isFileArray: true,
          });
        } catch (eventError) {
          this.logger.error(
            `[bulkAddArtworks] Error emitting event for task ${change.taskId}:`,
            eventError,
          );
        }
      }
    }

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

    // Store field changes for event emission after transaction
    const fieldChangesForEvents: Array<{
      taskId: string;
      task: any;
      field: string;
      oldValue: any[];
      newValue: any[];
    }> = [];

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
          const fieldLabel = translateFieldName(relationName);
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            action: CHANGE_ACTION.UPDATE,
            field: relationName,
            oldValue: currentDocumentIds,
            newValue: mergedDocumentIds,
            reason: `Campo ${fieldLabel} atualizado`,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            triggeredById: task.id,
            userId: userId || '',
            transaction: tx,
          });

          // Store for event emission
          fieldChangesForEvents.push({
            taskId: task.id,
            task: currentTask,
            field: relationName,
            oldValue: currentDocumentIds,
            newValue: mergedDocumentIds,
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

    // After transaction: Emit field change events for notifications
    if (fieldChangesForEvents.length > 0) {
      this.logger.log(
        `[bulkAddDocuments] Emitting ${fieldChangesForEvents.length} field change event(s) for notifications`,
      );

      for (const change of fieldChangesForEvents) {
        try {
          this.eventEmitter.emit('task.field.changed', {
            task: change.task,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            changedBy: userId,
            isFileArray: true,
          });
        } catch (eventError) {
          this.logger.error(
            `[bulkAddDocuments] Error emitting event for task ${change.taskId}:`,
            eventError,
          );
        }
      }
    }

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

    // Store field changes for event emission after transaction
    const fieldChangesForEvents: Array<{
      taskId: string;
      task: any;
      oldValue: any[];
      newValue: any[];
    }> = [];

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
            oldValue: currentPaintIds,
            newValue: mergedPaintIds,
            reason: `Campo tintas de logo atualizado`,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            triggeredById: task.id,
            userId: userId || '',
            transaction: tx,
          });

          // Store for event emission
          fieldChangesForEvents.push({
            taskId: task.id,
            task: currentTask,
            oldValue: currentPaintIds,
            newValue: mergedPaintIds,
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

    // After transaction: Emit field change events for notifications
    if (fieldChangesForEvents.length > 0) {
      this.logger.log(
        `[bulkAddPaints] Emitting ${fieldChangesForEvents.length} field change event(s) for notifications`,
      );

      for (const change of fieldChangesForEvents) {
        try {
          this.eventEmitter.emit('task.field.changed', {
            task: change.task,
            field: 'logoPaints',
            oldValue: change.oldValue,
            newValue: change.newValue,
            changedBy: userId,
            isFileArray: false,
          });
        } catch (eventError) {
          this.logger.error(
            `[bulkAddPaints] Error emitting event for task ${change.taskId}:`,
            eventError,
          );
        }
      }
    }

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

    // Store field changes for event emission after transaction
    const fieldChangesForEvents: Array<{
      taskId: string;
      task: any;
      oldValue: any[];
      newValue: any[];
    }> = [];

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
            newValue: createdCuts.map(c => c.id),
            reason: `Campo recortes atualizado`,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            triggeredById: task.id,
            userId: userId || '',
            transaction: tx,
          });

          // Store for event emission
          fieldChangesForEvents.push({
            taskId: task.id,
            task,
            oldValue: [],
            newValue: createdCuts,
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

    // After transaction: Emit field change events for notifications
    if (fieldChangesForEvents.length > 0) {
      this.logger.log(
        `[bulkAddCuttingPlans] Emitting ${fieldChangesForEvents.length} field change event(s) for notifications`,
      );

      for (const change of fieldChangesForEvents) {
        try {
          this.eventEmitter.emit('task.field.changed', {
            task: change.task,
            field: 'cuts',
            oldValue: change.oldValue,
            newValue: change.newValue,
            changedBy: userId,
            isFileArray: false,
          });
        } catch (eventError) {
          this.logger.error(
            `[bulkAddCuttingPlans] Error emitting event for task ${change.taskId}:`,
            eventError,
          );
        }
      }
    }

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

  /**
   * Copy fields from one task to another
   *
   * @param destinationTaskId - Task to copy fields to
   * @param sourceTaskId - Task to copy fields from
   * @param fields - Array of fields to copy
   * @param userId - User performing the copy operation
   * @returns Result object with success status, message, and details
   */
  async copyFromTask(
    destinationTaskId: string,
    sourceTaskId: string,
    fields: CopyableTaskField[],
    userId: string,
    userPrivilege?: string,
  ): Promise<{
    success: boolean;
    message: string;
    copiedFields: CopyableTaskField[];
    details: Record<string, any>;
  }> {
    this.logger.log(
      `[copyFromTask] Copying ${fields.length} field(s) from task ${sourceTaskId} to ${destinationTaskId}`,
    );
    this.logger.debug(`[copyFromTask] Requested fields: ${JSON.stringify(fields)}`);
    this.logger.debug(`[copyFromTask] User privilege: ${userPrivilege}`);

    // Import permission filter function
    const { expandAllFieldsForUser } = require('../../../schemas/task-copy');

    // Expand 'all' to only fields user has permission to copy, and filter all fields by privilege
    const fieldsToProcess: CopyableTaskField[] = expandAllFieldsForUser(fields, userPrivilege);
    this.logger.log(
      `[copyFromTask] After privilege filtering: ${fieldsToProcess.length} fields for privilege ${userPrivilege}`,
    );

    // Ensure we have fields to process
    if (fieldsToProcess.length === 0) {
      return {
        success: false,
        message: 'Nenhum campo permitido para cópia com seu nível de privilégio',
        copiedFields: [],
        details: {},
      };
    }

    try {
      const transactionResult = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Fetch source task with all necessary relations
        const sourceTask = await tx.task.findUnique({
          where: { id: sourceTaskId },
          include: {
            truck: {
              select: {
                id: true,
                category: true,
                implementType: true,
                spot: true,
                // CRITICAL: Include layout IDs for copy functionality
                backSideLayoutId: true,
                leftSideLayoutId: true,
                rightSideLayoutId: true,
                // Include layout details for dimensions
                backSideLayout: {
                  select: {
                    id: true,
                    height: true,
                    layoutSections: {
                      select: {
                        width: true,
                      },
                    },
                  },
                },
                leftSideLayout: {
                  select: {
                    id: true,
                    height: true,
                    layoutSections: {
                      select: {
                        width: true,
                      },
                    },
                  },
                },
                rightSideLayout: {
                  select: {
                    id: true,
                    height: true,
                    layoutSections: {
                      select: {
                        width: true,
                      },
                    },
                  },
                },
              },
            },
            observation: true,
            artworks: {
              select: {
                id: true,
                fileId: true,
                file: {
                  select: {
                    id: true,
                    filename: true,
                    thumbnailUrl: true,
                  },
                },
              },
            },
            budgets: { select: { id: true } },
            invoices: { select: { id: true } },
            receipts: { select: { id: true } },
            reimbursements: { select: { id: true } },
            invoiceReimbursements: { select: { id: true } },
            baseFiles: {
              select: {
                id: true,
                filename: true,
                thumbnailUrl: true,
              },
            },
            logoPaints: { select: { id: true } },
            cuts: {
              select: {
                fileId: true,
                type: true,
                origin: true,
                reason: true,
                parentCutId: true,
              },
            },
            airbrushings: {
              include: {
                receipts: { select: { id: true } },
                invoices: { select: { id: true } },
                artworks: { select: { id: true } },
              },
            },
            serviceOrders: {
              select: {
                id: true,
                description: true,
                type: true,
              },
            },
            pricing: {
              select: {
                id: true,
                budgetNumber: true,
                total: true,
                items: {
                  select: {
                    description: true,
                    amount: true,
                  },
                },
              },
            },
            representatives: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                role: true,
              },
            },
          },
        });

        if (!sourceTask) {
          throw new NotFoundException(`Tarefa de origem não encontrada (ID: ${sourceTaskId})`);
        }

        this.logger.debug(
          `[copyFromTask] Source task loaded: ${sourceTask.name} (${sourceTask.id})`,
        );
        this.logger.debug(`[copyFromTask] Source has truck: ${!!sourceTask.truck}`);
        this.logger.debug(`[copyFromTask] Source has cuts: ${sourceTask.cuts?.length || 0}`);
        this.logger.debug(
          `[copyFromTask] Source has airbrushings: ${sourceTask.airbrushings?.length || 0}`,
        );
        this.logger.debug(`[copyFromTask] 🔍 RAW SOURCE TASK DATES:`);
        this.logger.debug(`[copyFromTask]   - term: ${JSON.stringify(sourceTask.term)}`);
        this.logger.debug(`[copyFromTask]   - entryDate: ${JSON.stringify(sourceTask.entryDate)}`);
        this.logger.debug(
          `[copyFromTask]   - forecastDate: ${JSON.stringify(sourceTask.forecastDate)}`,
        );
        this.logger.debug(`[copyFromTask]   - term type: ${typeof sourceTask.term}`);
        this.logger.debug(`[copyFromTask]   - entryDate type: ${typeof sourceTask.entryDate}`);
        this.logger.debug(
          `[copyFromTask]   - forecastDate type: ${typeof sourceTask.forecastDate}`,
        );

        // Fetch destination task with all relations (for old value comparison in changelogs)
        const destinationTask = await tx.task.findUnique({
          where: { id: destinationTaskId },
          include: {
            truck: {
              select: {
                id: true,
                category: true,
                implementType: true,
                spot: true,
                backSideLayoutId: true,
                leftSideLayoutId: true,
                rightSideLayoutId: true,
              },
            },
            observation: true,
            artworks: { select: { id: true } },
            baseFiles: { select: { id: true } },
            logoPaints: { select: { id: true } },
            cuts: { select: { id: true } },
            airbrushings: { select: { id: true } },
            serviceOrders: { select: { id: true } },
            // Include pricing for enriched oldValue in changelog
            pricing: {
              select: {
                id: true,
                budgetNumber: true,
                total: true,
                items: {
                  select: {
                    description: true,
                    amount: true,
                  },
                },
              },
            },
            representatives: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                role: true,
              },
            },
          },
        });

        if (!destinationTask) {
          throw new NotFoundException(
            `Tarefa de destino não encontrada (ID: ${destinationTaskId})`,
          );
        }

        this.logger.debug(
          `[copyFromTask] Destination task loaded: ${destinationTask.name} (${destinationTask.id})`,
        );

        // Store old values for changelog tracking
        const oldValues: Record<string, any> = {
          name: destinationTask.name,
          details: destinationTask.details,
          term: destinationTask.term,
          entryDate: destinationTask.entryDate,
          forecastDate: destinationTask.forecastDate,
          commission: destinationTask.commission,
          representatives: destinationTask.representatives?.map(r => r.id) || [],
          customerId: destinationTask.customerId,
          invoiceToId: destinationTask.invoiceToId,
          // Store enriched pricing data for changelog display (not just UUID)
          pricingId: destinationTask.pricing
            ? {
                id: destinationTask.pricing.id,
                budgetNumber: destinationTask.pricing.budgetNumber,
                total: destinationTask.pricing.total,
                items: destinationTask.pricing.items || [],
              }
            : null,
          paintId: destinationTask.paintId,
          artworkIds: destinationTask.artworks?.map(a => a.id) || [],
          baseFileIds: destinationTask.baseFiles?.map(f => f.id) || [],
          logoPaintIds: destinationTask.logoPaints?.map(p => p.id) || [],
          cuts: destinationTask.cuts?.length || 0,
          airbrushings: destinationTask.airbrushings?.length || 0,
          serviceOrders: destinationTask.serviceOrders?.length || 0,
          implementType: destinationTask.truck?.implementType || null,
          category: destinationTask.truck?.category || null,
          layouts: {
            backSideLayoutId: destinationTask.truck?.backSideLayoutId || null,
            leftSideLayoutId: destinationTask.truck?.leftSideLayoutId || null,
            rightSideLayoutId: destinationTask.truck?.rightSideLayoutId || null,
          },
          observation: destinationTask.observation?.description || null,
        };

        // Array to store field changes for events (emitted after transaction)
        const fieldChangesForEvents: Array<{
          field: string;
          oldValue: any;
          newValue: any;
        }> = [];

        // Prepare update data
        const updateData: any = {};
        const copiedFields: CopyableTaskField[] = [];
        const details: Record<string, any> = {};

        this.logger.log(`[copyFromTask] Processing ${fieldsToProcess.length} fields...`);
        this.logger.debug(`[copyFromTask] Fields to process: ${fieldsToProcess.join(', ')}`);
        this.logger.debug(
          `[copyFromTask] Source task dates - term: ${sourceTask.term}, entryDate: ${sourceTask.entryDate}, forecastDate: ${sourceTask.forecastDate}`,
        );

        // Helper to check if field has data
        const hasData = (value: any): boolean => {
          if (value === null || value === undefined) return false;
          if (Array.isArray(value)) return value.length > 0;
          // Special handling for Date objects
          if (value instanceof Date) return !isNaN(value.getTime());
          if (typeof value === 'object') return Object.keys(value).length > 0;
          return true;
        };

        // Process each field
        for (const field of fieldsToProcess) {
          switch (field) {
            // ===== SIMPLE FIELDS =====
            case 'name':
              if (hasData(sourceTask.name)) {
                updateData.name = sourceTask.name;
                copiedFields.push(field);
                details.name = sourceTask.name;
              }
              break;

            case 'details':
              if (hasData(sourceTask.details)) {
                updateData.details = sourceTask.details;
                copiedFields.push(field);
                details.details = sourceTask.details;
              }
              break;

            case 'term':
              this.logger.debug(
                `[copyFromTask] term value: ${sourceTask.term}, hasData: ${hasData(sourceTask.term)}`,
              );
              if (hasData(sourceTask.term)) {
                updateData.term = sourceTask.term;
                copiedFields.push(field);
                details.term = sourceTask.term;
                this.logger.debug(`[copyFromTask] term copied: ${sourceTask.term}`);
              } else {
                this.logger.debug(`[copyFromTask] term NOT copied (no data)`);
              }
              break;

            case 'entryDate':
              this.logger.debug(
                `[copyFromTask] entryDate value: ${sourceTask.entryDate}, hasData: ${hasData(sourceTask.entryDate)}`,
              );
              if (hasData(sourceTask.entryDate)) {
                updateData.entryDate = sourceTask.entryDate;
                copiedFields.push(field);
                details.entryDate = sourceTask.entryDate;
                this.logger.debug(`[copyFromTask] entryDate copied: ${sourceTask.entryDate}`);
              } else {
                this.logger.debug(`[copyFromTask] entryDate NOT copied (no data)`);
              }
              break;

            case 'forecastDate':
              this.logger.debug(
                `[copyFromTask] forecastDate value: ${sourceTask.forecastDate}, hasData: ${hasData(sourceTask.forecastDate)}`,
              );
              if (hasData(sourceTask.forecastDate)) {
                updateData.forecastDate = sourceTask.forecastDate;
                copiedFields.push(field);
                details.forecastDate = sourceTask.forecastDate;
                this.logger.debug(`[copyFromTask] forecastDate copied: ${sourceTask.forecastDate}`);
              } else {
                this.logger.debug(`[copyFromTask] forecastDate NOT copied (no data)`);
              }
              break;

            case 'commission':
              if (hasData(sourceTask.commission)) {
                updateData.commission = sourceTask.commission;
                updateData.commissionOrder = getCommissionStatusOrder(sourceTask.commission);
                copiedFields.push(field);
                details.commission = sourceTask.commission;
              }
              break;

            case 'representatives':
              if (hasData(sourceTask.representatives)) {
                const representativeIds = sourceTask.representatives.map(r => r.id);
                updateData.representatives = {
                  set: representativeIds.map(id => ({ id })),
                };
                copiedFields.push(field);
                details.representatives = sourceTask.representatives.map(r => ({
                  id: r.id,
                  name: r.name,
                  role: r.role,
                  phone: r.phone,
                  email: r.email,
                }));
              }
              break;

            // ===== REFERENCES =====
            case 'customerId':
              if (hasData(sourceTask.customerId)) {
                updateData.customerId = sourceTask.customerId;
                copiedFields.push(field);
                details.customerId = sourceTask.customerId;
              }
              break;

            case 'invoiceToId':
              if (hasData(sourceTask.invoiceToId)) {
                updateData.invoiceToId = sourceTask.invoiceToId;
                copiedFields.push(field);
                details.invoiceToId = sourceTask.invoiceToId;
              }
              break;

            case 'pricingId':
              if (hasData(sourceTask.pricingId)) {
                updateData.pricingId = sourceTask.pricingId;
                copiedFields.push(field);
                // Store pricing info for changelog display
                details.pricingId = {
                  id: sourceTask.pricingId,
                  budgetNumber: sourceTask.pricing?.budgetNumber || null,
                  total: sourceTask.pricing?.total || null,
                  items: sourceTask.pricing?.items || [],
                };
              }
              break;

            case 'paintId':
              if (hasData(sourceTask.paintId)) {
                updateData.paintId = sourceTask.paintId;
                copiedFields.push(field);
                details.paintId = sourceTask.paintId;
              }
              break;

            // ===== SHARED FILE IDS =====
            case 'artworkIds':
              if (hasData(sourceTask.artworks)) {
                const artworkIds = sourceTask.artworks.map(a => a.id);
                updateData.artworks = {
                  set: artworkIds.map(id => ({ id })),
                };
                copiedFields.push(field);
                // Store file info for changelog display
                details.artworkIds = sourceTask.artworks.map(a => ({
                  id: a.id,
                  fileId: a.fileId,
                  filename: a.file?.filename,
                  thumbnailUrl: a.file?.thumbnailUrl,
                }));
              }
              break;

            case 'baseFileIds':
              if (hasData(sourceTask.baseFiles)) {
                const baseFileIds = sourceTask.baseFiles.map(f => f.id);
                updateData.baseFiles = {
                  set: baseFileIds.map(id => ({ id })),
                };
                copiedFields.push(field);
                // Store file info for changelog display
                details.baseFileIds = sourceTask.baseFiles.map(f => ({
                  id: f.id,
                  filename: f.filename,
                  thumbnailUrl: f.thumbnailUrl,
                }));
              }
              break;

            case 'logoPaintIds':
              if (hasData(sourceTask.logoPaints)) {
                const logoPaintIds = sourceTask.logoPaints.map(p => p.id);
                updateData.logoPaints = {
                  set: logoPaintIds.map(id => ({ id })),
                };
                copiedFields.push(field);
                details.logoPaintIds = logoPaintIds;
              }
              break;

            // ===== INDIVIDUAL RESOURCES (Create New) =====
            case 'cuts':
              if (hasData(sourceTask.cuts)) {
                // Create new cut records with PENDING status
                const newCuts = await Promise.all(
                  sourceTask.cuts.map(async cut => {
                    return await tx.cut.create({
                      data: {
                        taskId: destinationTaskId,
                        fileId: cut.fileId,
                        type: cut.type,
                        status: CUT_STATUS.PENDING,
                        statusOrder: 1, // PENDING order
                        origin: cut.origin,
                        reason: cut.reason,
                        parentCutId: cut.parentCutId,
                      },
                    });
                  }),
                );
                copiedFields.push(field);
                details.cuts = {
                  count: newCuts.length,
                  ids: newCuts.map(c => c.id),
                };
              }
              break;

            case 'airbrushings':
              if (hasData(sourceTask.airbrushings)) {
                // Create new airbrushing records with PENDING status
                const newAirbrushings = await Promise.all(
                  sourceTask.airbrushings.map(async airbrushing => {
                    return await tx.airbrushing.create({
                      data: {
                        taskId: destinationTaskId,
                        price: airbrushing.price,
                        status: AIRBRUSHING_STATUS.PENDING,
                        startDate: null,
                        finishDate: null,
                        // Connect shared files/artworks
                        receipts: airbrushing.receipts?.length
                          ? { connect: airbrushing.receipts.map(r => ({ id: r.id })) }
                          : undefined,
                        invoices: airbrushing.invoices?.length
                          ? { connect: airbrushing.invoices.map(i => ({ id: i.id })) }
                          : undefined,
                        artworks: airbrushing.artworks?.length
                          ? { connect: airbrushing.artworks.map(a => ({ id: a.id })) }
                          : undefined,
                      },
                    });
                  }),
                );
                copiedFields.push(field);
                details.airbrushings = {
                  count: newAirbrushings.length,
                  ids: newAirbrushings.map(a => a.id),
                };
              }
              break;

            // ===== IMPLEMENT TYPE (Shared Reference) =====
            case 'implementType':
              if (hasData(sourceTask.truck?.implementType)) {
                const existingTruck = await tx.truck.findUnique({
                  where: { taskId: destinationTaskId },
                });

                if (existingTruck) {
                  await tx.truck.update({
                    where: { taskId: destinationTaskId },
                    data: { implementType: sourceTask.truck.implementType },
                  });
                } else {
                  await tx.truck.create({
                    data: {
                      implementType: sourceTask.truck.implementType,
                      taskId: destinationTaskId,
                    },
                  });
                }
                copiedFields.push(field);
                details.implementType = sourceTask.truck.implementType;
              }
              break;

            // ===== CATEGORY (Shared Reference) =====
            case 'category':
              if (hasData(sourceTask.truck?.category)) {
                const existingTruck = await tx.truck.findUnique({
                  where: { taskId: destinationTaskId },
                });

                if (existingTruck) {
                  await tx.truck.update({
                    where: { taskId: destinationTaskId },
                    data: { category: sourceTask.truck.category },
                  });
                } else {
                  await tx.truck.create({
                    data: {
                      category: sourceTask.truck.category,
                      taskId: destinationTaskId,
                    },
                  });
                }
                copiedFields.push(field);
                details.category = sourceTask.truck.category;
              }
              break;

            // ===== LAYOUTS (Shared Resources) =====
            case 'layouts':
              if (hasData(sourceTask.truck)) {
                const existingTruck = await tx.truck.findUnique({
                  where: { taskId: destinationTaskId },
                });

                const layoutData: any = {
                  backSideLayoutId: sourceTask.truck.backSideLayoutId,
                  leftSideLayoutId: sourceTask.truck.leftSideLayoutId,
                  rightSideLayoutId: sourceTask.truck.rightSideLayoutId,
                };

                if (existingTruck) {
                  await tx.truck.update({
                    where: { taskId: destinationTaskId },
                    data: layoutData,
                  });
                } else {
                  // Create truck with layouts if it doesn't exist
                  await tx.truck.create({
                    data: {
                      ...layoutData,
                      taskId: destinationTaskId,
                    },
                  });
                }
                copiedFields.push(field);

                // Helper to calculate dimensions from layout
                const getLayoutDimensions = (layout: any) => {
                  if (!layout) return null;
                  const height = layout.height ? Math.round(layout.height * 100) : 0;
                  const totalWidth = layout.layoutSections
                    ? layout.layoutSections.reduce(
                        (sum: number, s: any) => sum + (s.width || 0) * 100,
                        0,
                      )
                    : 0;
                  return { height, width: Math.round(totalWidth) };
                };

                // Store layout data with dimensions for changelog display
                details.layouts = {
                  ...layoutData,
                  leftSideDimensions: getLayoutDimensions(sourceTask.truck.leftSideLayout),
                  rightSideDimensions: getLayoutDimensions(sourceTask.truck.rightSideLayout),
                  backSideDimensions: getLayoutDimensions(sourceTask.truck.backSideLayout),
                };
              }
              break;

            // ===== OBSERVATION =====
            case 'observation':
              if (hasData(sourceTask.observation)) {
                // Check if destination already has an observation
                const existingObservation = await tx.observation.findUnique({
                  where: { taskId: destinationTaskId },
                });

                const observationData = {
                  description: sourceTask.observation.description,
                };

                if (existingObservation) {
                  await tx.observation.update({
                    where: { taskId: destinationTaskId },
                    data: observationData,
                  });
                } else {
                  await tx.observation.create({
                    data: {
                      ...observationData,
                      taskId: destinationTaskId,
                    },
                  });
                }
                copiedFields.push(field);
                details.observation = observationData;
              }
              break;

            // ===== SERVICE ORDERS (Replace - Delete existing, then Create New) =====
            case 'serviceOrders':
              if (hasData(sourceTask.serviceOrders)) {
                // First, delete existing service orders on the destination task (set behavior)
                const deletedServiceOrders = await tx.serviceOrder.deleteMany({
                  where: { taskId: destinationTaskId },
                });
                this.logger.log(
                  `[copyFromTask] Deleted ${deletedServiceOrders.count} existing service orders from destination task`,
                );

                // Fetch full service order details for copying
                const fullServiceOrders = await tx.serviceOrder.findMany({
                  where: {
                    id: { in: sourceTask.serviceOrders.map(so => so.id) },
                  },
                  select: {
                    description: true,
                    type: true,
                    observation: true,
                    assignedToId: true,
                  },
                });

                // Create new service order records with PENDING status
                const newServiceOrders = await Promise.all(
                  fullServiceOrders.map(async so => {
                    return await tx.serviceOrder.create({
                      data: {
                        taskId: destinationTaskId,
                        description: so.description,
                        type: so.type,
                        observation: so.observation,
                        assignedToId: so.assignedToId,
                        status: SERVICE_ORDER_STATUS.PENDING,
                        statusOrder: 1, // PENDING order
                        createdById: userId,
                        shouldSync: true, // Copied service orders should participate in sync
                      },
                    });
                  }),
                );
                copiedFields.push(field);
                // Store full service order details for changelog display
                details.serviceOrders = {
                  deletedCount: deletedServiceOrders.count,
                  count: newServiceOrders.length,
                  ids: newServiceOrders.map(so => so.id),
                  items: fullServiceOrders.map(so => ({
                    description: so.description,
                    type: so.type,
                  })),
                };
              }
              break;

            default:
              this.logger.warn(`[copyFromTask] Unknown field: ${field}`);
          }
        }

        this.logger.log(
          `[copyFromTask] Finished processing fields. Copied ${copiedFields.length} field(s)`,
        );
        this.logger.debug(`[copyFromTask] Copied fields: ${JSON.stringify(copiedFields)}`);
        this.logger.debug(
          `[copyFromTask] UpdateData keys: ${JSON.stringify(Object.keys(updateData))}`,
        );

        // Update the destination task with collected data
        if (Object.keys(updateData).length > 0) {
          this.logger.log(
            `[copyFromTask] Updating task with ${Object.keys(updateData).length} field(s)`,
          );
          await tx.task.update({
            where: { id: destinationTaskId },
            data: updateData,
          });
          this.logger.log(`[copyFromTask] Task update successful`);
        } else {
          this.logger.log(`[copyFromTask] No fields to update via task.update()`);
        }

        // Create INDIVIDUAL changelog entries for each copied field
        if (copiedFields.length > 0) {
          this.logger.debug(`[copyFromTask] Creating individual changelog entries...`);
          this.logger.debug(`[copyFromTask] Copied fields: ${copiedFields.join(', ')}`);

          for (const field of copiedFields) {
            try {
              const oldValue = oldValues[field];
              const newValue = details[field];
              const fieldLabel = translateFieldName(field);

              // Create individual changelog entry for this field
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: destinationTaskId,
                action: CHANGE_ACTION.UPDATE,
                field,
                oldValue,
                newValue,
                reason: `Campo ${fieldLabel} copiado da tarefa "${sourceTask.name || sourceTaskId}"`,
                triggeredBy: CHANGE_TRIGGERED_BY.TASK_COPY_FROM_TASK,
                triggeredById: sourceTaskId,
                userId,
                transaction: tx,
                metadata: {
                  sourceTaskId,
                  sourceTaskName: sourceTask.name,
                },
              });

              // Track field change for event emission (after transaction)
              fieldChangesForEvents.push({
                field,
                oldValue,
                newValue,
              });

              this.logger.debug(`[copyFromTask] Changelog entry created for field: ${field}`);
            } catch (changelogError) {
              this.logger.error(
                `[copyFromTask] Error creating changelog for field ${field}:`,
                changelogError,
              );
              // Don't throw - changelog is not critical for the copy operation
            }
          }
        }

        return {
          success: true,
          message: `${copiedFields.length} campo(s) copiado(s) com sucesso da tarefa ${sourceTask.name || sourceTaskId}`,
          copiedFields,
          details,
          fieldChangesForEvents,
          sourceTask: { id: sourceTask.id, name: sourceTask.name },
          destinationTaskId,
        };
      });

      // After transaction success: Emit field change events for notifications
      // This triggers the notification system to send individual notifications per field
      if (
        transactionResult.fieldChangesForEvents &&
        transactionResult.fieldChangesForEvents.length > 0
      ) {
        this.logger.log(
          `[copyFromTask] Emitting ${transactionResult.fieldChangesForEvents.length} field change event(s) for notifications`,
        );

        // Fetch the updated task for event emission
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: destinationTaskId },
          include: {
            customer: { select: { id: true, fantasyName: true } },
          },
        });

        if (updatedTask) {
          for (const change of transactionResult.fieldChangesForEvents) {
            try {
              // Emit task.field.changed event (handled by task.listener.ts for notifications)
              this.eventEmitter.emit('task.field.changed', {
                task: updatedTask,
                field: change.field,
                oldValue: change.oldValue,
                newValue: change.newValue,
                changedBy: userId,
                isFileArray: ['artworkIds', 'baseFileIds', 'logoPaintIds'].includes(change.field),
              });

              this.logger.debug(
                `[copyFromTask] Emitted task.field.changed event for field: ${change.field}`,
              );
            } catch (eventError) {
              this.logger.error(
                `[copyFromTask] Error emitting event for field ${change.field}:`,
                eventError,
              );
              // Don't throw - event emission is not critical
            }
          }
        }
      }

      return {
        success: transactionResult.success,
        message: transactionResult.message,
        copiedFields: transactionResult.copiedFields,
        details: transactionResult.details,
      };
    } catch (error) {
      this.logger.error(
        `[copyFromTask] Error copying fields from task ${sourceTaskId} to ${destinationTaskId}:`,
        error,
      );

      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(`Erro ao copiar campos da tarefa: ${error.message}`);
    }
  }
}
