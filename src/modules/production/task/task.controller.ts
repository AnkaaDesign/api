import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  UsePipes,
} from '@nestjs/common';
import { validateIncludes } from '@modules/common/base/include-access-control';
import { FileInterceptor, FilesInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { FileService } from '@modules/common/file/file.service';
import { TaskService } from './task.service';
import { UserId, User, UserPayload } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES, TASK_STATUS } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import {
  taskCreateSchema,
  taskUpdateSchema,
  taskGetManySchema,
  taskBatchCreateSchema,
  taskBatchUpdateSchema,
  taskBatchDeleteSchema,
  taskDuplicateSchema,
  taskQuerySchema,
  taskPositionUpdateSchema,
  taskBulkPositionUpdateSchema,
  taskSwapPositionSchema,
} from '../../../schemas/task';
import { taskCopyFromSchema, type TaskCopyFromFormData } from '../../../schemas/task-copy';
import {
  taskBulkArtsSchema,
  taskBulkDocumentsSchema,
  taskBulkPaintsSchema,
  taskBulkCuttingPlansSchema,
  taskBulkFileUploadSchema,
} from '../../../schemas/task-bulk';
import type {
  TaskCreateFormData,
  TaskUpdateFormData,
  TaskGetManyFormData,
  TaskBatchCreateFormData,
  TaskBatchUpdateFormData,
  TaskBatchDeleteFormData,
  TaskDuplicateFormData,
  TaskQueryFormData,
  TaskPositionUpdateFormData,
  TaskBulkPositionUpdateFormData,
  TaskSwapPositionFormData,
} from '../../../schemas/task';
import type {
  TaskBulkArtsFormData,
  TaskBulkDocumentsFormData,
  TaskBulkPaintsFormData,
  TaskBulkCuttingPlansFormData,
  TaskBulkFileUploadFormData,
} from '../../../schemas/task-bulk';
import type {
  Task,
  TaskCreateResponse,
  TaskGetUniqueResponse,
  TaskGetManyResponse,
  TaskUpdateResponse,
  TaskDeleteResponse,
  TaskBatchCreateResponse,
  TaskBatchUpdateResponse,
  TaskBatchDeleteResponse,
} from '../../../types';
import type { SuccessResponse } from '../../../types';

@Controller('tasks')
export class TaskController {
  constructor(
    private readonly tasksService: TaskService,
    private readonly fileService: FileService,
  ) {}

  // Basic CRUD Operations (static routes first)
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(taskGetManySchema)) query: TaskGetManyFormData,
    @UserId() userId: string,
    @User() user: UserPayload,
  ): Promise<TaskGetManyResponse> {
    // Validate includes for security
    if (query.include) {
      validateIncludes('Task', query.include);
    }
    return this.tasksService.findMany(query, user.role);
  }

  @Post()
  @Roles(
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.LOGISTIC,
  )
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'budgets', maxCount: 10 },
        { name: 'invoices', maxCount: 10 },
        { name: 'receipts', maxCount: 10 },
        { name: 'bankSlips', maxCount: 10 },
        { name: 'artworks', maxCount: 10 },
        { name: 'baseFiles', maxCount: 30 },
        { name: 'cutFiles', maxCount: 20 },
        // Airbrushing files - support up to 10 airbrushings with multiple files each
        { name: 'airbrushings[0].receipts', maxCount: 10 },
        { name: 'airbrushings[0].invoices', maxCount: 10 },
        { name: 'airbrushings[0].artworks', maxCount: 20 },
        { name: 'airbrushings[1].receipts', maxCount: 10 },
        { name: 'airbrushings[1].invoices', maxCount: 10 },
        { name: 'airbrushings[1].artworks', maxCount: 20 },
        { name: 'airbrushings[2].receipts', maxCount: 10 },
        { name: 'airbrushings[2].invoices', maxCount: 10 },
        { name: 'airbrushings[2].artworks', maxCount: 20 },
        { name: 'airbrushings[3].receipts', maxCount: 10 },
        { name: 'airbrushings[3].invoices', maxCount: 10 },
        { name: 'airbrushings[3].artworks', maxCount: 20 },
        { name: 'airbrushings[4].receipts', maxCount: 10 },
        { name: 'airbrushings[4].invoices', maxCount: 10 },
        { name: 'airbrushings[4].artworks', maxCount: 20 },
        { name: 'airbrushings[5].receipts', maxCount: 10 },
        { name: 'airbrushings[5].invoices', maxCount: 10 },
        { name: 'airbrushings[5].artworks', maxCount: 20 },
        { name: 'airbrushings[6].receipts', maxCount: 10 },
        { name: 'airbrushings[6].invoices', maxCount: 10 },
        { name: 'airbrushings[6].artworks', maxCount: 20 },
        { name: 'airbrushings[7].receipts', maxCount: 10 },
        { name: 'airbrushings[7].invoices', maxCount: 10 },
        { name: 'airbrushings[7].artworks', maxCount: 20 },
        { name: 'airbrushings[8].receipts', maxCount: 10 },
        { name: 'airbrushings[8].invoices', maxCount: 10 },
        { name: 'airbrushings[8].artworks', maxCount: 20 },
        { name: 'airbrushings[9].receipts', maxCount: 10 },
        { name: 'airbrushings[9].invoices', maxCount: 10 },
        { name: 'airbrushings[9].artworks', maxCount: 20 },
      ],
      multerConfig,
    ),
  )
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(taskCreateSchema)) data: TaskCreateFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: Record<string, Express.Multer.File[]>,
  ): Promise<TaskCreateResponse> {
    return this.tasksService.create(data, query.include, userId, files);
  }

  // Diagnostic Endpoints (for debugging copy-from-task issues)
  @Get(':id/artworks/diagnostic')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async diagnosticArtworks(@Param('id', ParseUUIDPipe) id: string): Promise<any> {
    const task: any = await this.tasksService.findById(id, {
      artworks: { include: { file: true } },
    });

    if (!task || !task.data) {
      throw new Error(`Task ${id} not found`);
    }

    const taskData = task.data;
    return {
      taskId: taskData.id,
      taskName: taskData.name,
      artworkCount: taskData.artworks?.length || 0,
      artworks:
        taskData.artworks?.map((artwork: any) => ({
          artworkId: artwork.id,
          fileId: artwork.fileId,
          status: artwork.status,
          file: artwork.file
            ? {
                id: artwork.file.id,
                filename: artwork.file.filename,
                originalName: artwork.file.originalName,
              }
            : null,
        })) || [],
    };
  }

  // Batch Operations
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(taskBatchCreateSchema)) data: TaskBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<TaskBatchCreateResponse<TaskCreateFormData>> {
    return this.tasksService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'budgets', maxCount: 10 },
        { name: 'invoices', maxCount: 10 },
        { name: 'receipts', maxCount: 10 },
        { name: 'bankSlips', maxCount: 10 },
        { name: 'artworks', maxCount: 10 },
        { name: 'baseFiles', maxCount: 30 },
        { name: 'cutFiles', maxCount: 20 },
        // Layout photos for bulk layout operations
        { name: 'layoutPhotos.leftSide', maxCount: 1 },
        { name: 'layoutPhotos.rightSide', maxCount: 1 },
        { name: 'layoutPhotos.backSide', maxCount: 1 },
      ],
      multerConfig,
    ),
  )
  async batchUpdate(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(taskBatchUpdateSchema))
    data: TaskBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: Record<string, Express.Multer.File[]>,
  ): Promise<TaskBatchUpdateResponse<TaskUpdateFormData>> {
    return this.tasksService.batchUpdate(data, query.include, userId, files);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(taskBatchDeleteSchema)) data: TaskBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<TaskBatchDeleteResponse> {
    return this.tasksService.batchDelete(data, userId);
  }

  // =====================
  // BULK OPERATIONS
  // =====================

  @Post('bulk/arts')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async bulkAddArtworks(
    @Body(new ZodValidationPipe(taskBulkArtsSchema)) data: TaskBulkArtsFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    return this.tasksService.bulkAddArtworks(data.taskIds, data.artworkIds, userId, query.include);
  }

  @Post('bulk/documents')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async bulkAddDocuments(
    @Body(new ZodValidationPipe(taskBulkDocumentsSchema)) data: TaskBulkDocumentsFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    return this.tasksService.bulkAddDocuments(
      data.taskIds,
      data.documentType,
      data.documentIds,
      userId,
      query.include,
    );
  }

  @Post('bulk/paints')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async bulkAddPaints(
    @Body(new ZodValidationPipe(taskBulkPaintsSchema)) data: TaskBulkPaintsFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    return this.tasksService.bulkAddPaints(data.taskIds, data.paintIds, userId, query.include);
  }

  @Post('bulk/cutting-plans')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async bulkAddCuttingPlans(
    @Body(new ZodValidationPipe(taskBulkCuttingPlansSchema)) data: TaskBulkCuttingPlansFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    return this.tasksService.bulkAddCuttingPlans(
      data.taskIds,
      {
        fileId: data.cutData.fileId!,
        type: data.cutData.type!,
        origin: data.cutData.origin,
        reason: data.cutData.reason,
        quantity: data.cutData.quantity,
      },
      userId,
      query.include,
    );
  }

  @Post('bulk/upload-files')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('files', 30, multerConfig))
  async bulkUploadFiles(
    @Body(new ZodValidationPipe(taskBulkFileUploadSchema)) data: TaskBulkFileUploadFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<{
    success: number;
    failed: number;
    total: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    return this.tasksService.bulkUploadFiles(
      data.taskIds,
      data.fileType,
      files,
      userId,
      query.include,
    );
  }

  // =====================
  // SPECIFIC ENDPOINTS (before dynamic routes)
  // =====================

  @Post(':id/duplicate')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(taskDuplicateSchema)) data: TaskDuplicateFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<SuccessResponse<Task>> {
    // TODO: Implement duplicateTask in service
    throw new Error('duplicateTask not implemented');
    // return this.tasksService.duplicateTask(id, data, query.include);
  }

  @Put(':id/prepare')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async prepareTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<SuccessResponse<Task>> {
    return this.tasksService.update(id, { status: TASK_STATUS.PREPARATION }, query.include, userId);
  }

  @Put(':id/start')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.ADMIN)
  async startTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<SuccessResponse<Task>> {
    const startedAt = new Date();
    return this.tasksService.update(
      id,
      { status: TASK_STATUS.IN_PRODUCTION, startedAt },
      query.include,
      userId,
    );
  }

  @Put(':id/finish')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.ADMIN)
  async finishTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<SuccessResponse<Task>> {
    const finishedAt = new Date();
    return this.tasksService.update(
      id,
      { status: TASK_STATUS.COMPLETED, finishedAt },
      query.include,
      userId,
    );
  }

  @Post('rollback-field')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async rollbackFieldChange(
    @Body() data: { changeLogId: string },
    @UserId() userId: string,
  ): Promise<TaskUpdateResponse> {
    return this.tasksService.rollbackFieldChange(data.changeLogId, userId);
  }

  // =====================
  // POSITIONING ENDPOINTS
  // =====================

  @Get('in-preparation')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async getInPreparationTasks(
    @Query(new ZodQueryValidationPipe(taskGetManySchema)) query: TaskGetManyFormData,
    @UserId() userId: string,
  ): Promise<TaskGetManyResponse> {
    // Get tasks with status PREPARATION
    // Default sort: forecastDate first, then serialNumber (identificador)
    return this.tasksService.findMany({
      ...query,
      orderBy: query.orderBy || [{ forecastDate: 'asc' }, { serialNumber: 'asc' }],
      where: {
        ...query.where,
        status: TASK_STATUS.PREPARATION,
      },
      include: {
        truck: {
          include: {
            leftSideLayout: { include: { layoutSections: true } },
            rightSideLayout: { include: { layoutSections: true } },
            backSideLayout: { include: { layoutSections: true } },
          },
        },
        serviceOrders: {
          include: {
            assignedTo: true,
          },
        },
        ...query.include,
      },
    });
  }

  @Get('in-production')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async getInProductionTasks(
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<TaskGetManyResponse> {
    // Get tasks with status PENDING or IN_PRODUCTION that have truck layouts (excludes PREPARATION)
    return this.tasksService.findMany({
      ...query,
      where: {
        OR: [{ status: TASK_STATUS.WAITING_PRODUCTION }, { status: TASK_STATUS.IN_PRODUCTION }],
        truck: {
          OR: [
            { leftSideLayoutId: { not: null } },
            { rightSideLayoutId: { not: null } },
            { backSideLayoutId: { not: null } },
          ],
        },
      },
      include: {
        truck: {
          include: {
            leftSideLayout: { include: { layoutSections: true } },
            rightSideLayout: { include: { layoutSections: true } },
            backSideLayout: { include: { layoutSections: true } },
          },
        },
        ...query.include,
      },
    });
  }

  @Put(':id/position')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.ADMIN)
  async updateTaskPosition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(taskPositionUpdateSchema)) data: TaskPositionUpdateFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<TaskUpdateResponse> {
    return this.tasksService.updateTaskPosition(id, data, query.include, userId);
  }

  @Post('bulk-position')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.ADMIN)
  async bulkUpdatePositions(
    @Body(new ZodValidationPipe(taskBulkPositionUpdateSchema)) data: TaskBulkPositionUpdateFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<TaskBatchUpdateResponse<TaskPositionUpdateFormData>> {
    return this.tasksService.bulkUpdatePositions(data, query.include, userId);
  }

  @Post(':id/swap')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.ADMIN)
  async swapTaskPositions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(taskSwapPositionSchema)) data: TaskSwapPositionFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<SuccessResponse<{ task1: Task; task2: Task }>> {
    return this.tasksService.swapTaskPositions(id, data.targetTaskId, query.include, userId);
  }

  // =====================
  // DYNAMIC ROUTES (must come last)
  // =====================

  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
    @User() user: UserPayload,
  ): Promise<TaskGetUniqueResponse> {
    // Validate includes for security
    if (query.include) {
      validateIncludes('Task', query.include);
    }
    return this.tasksService.findById(id, query.include, user.role);
  }

  @Put(':id/copy-from')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.DESIGNER,
  )
  @UsePipes(new ZodValidationPipe(taskCopyFromSchema))
  async copyFromTask(
    @Param('id') destinationTaskId: string,
    @Body() data: TaskCopyFromFormData,
    @UserId() userId: string,
    @User('role') userPrivilege: string,
  ) {
    const result = await this.tasksService.copyFromTask(
      destinationTaskId,
      data.sourceTaskId,
      data.fields,
      userId,
      userPrivilege,
    );

    return {
      success: true,
      message: `Campos copiados com sucesso da tarefa ${data.sourceTaskId}`,
      data: result,
    };
  }

  @Put(':id')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'budgets', maxCount: 10 },
        { name: 'invoices', maxCount: 10 },
        { name: 'receipts', maxCount: 10 },
        { name: 'bankSlips', maxCount: 10 },
        { name: 'artworks', maxCount: 10 },
        { name: 'baseFiles', maxCount: 30 },
        { name: 'cutFiles', maxCount: 20 },
        { name: 'observationFiles', maxCount: 10 },
        // Pricing layout file
        { name: 'pricingLayoutFile', maxCount: 1 },
        // Airbrushing files - support up to 10 airbrushings with multiple files each
        { name: 'airbrushings[0].receipts', maxCount: 10 },
        { name: 'airbrushings[0].invoices', maxCount: 10 },
        { name: 'airbrushings[0].artworks', maxCount: 20 },
        { name: 'airbrushings[1].receipts', maxCount: 10 },
        { name: 'airbrushings[1].invoices', maxCount: 10 },
        { name: 'airbrushings[1].artworks', maxCount: 20 },
        { name: 'airbrushings[2].receipts', maxCount: 10 },
        { name: 'airbrushings[2].invoices', maxCount: 10 },
        { name: 'airbrushings[2].artworks', maxCount: 20 },
        { name: 'airbrushings[3].receipts', maxCount: 10 },
        { name: 'airbrushings[3].invoices', maxCount: 10 },
        { name: 'airbrushings[3].artworks', maxCount: 20 },
        { name: 'airbrushings[4].receipts', maxCount: 10 },
        { name: 'airbrushings[4].invoices', maxCount: 10 },
        { name: 'airbrushings[4].artworks', maxCount: 20 },
        { name: 'airbrushings[5].receipts', maxCount: 10 },
        { name: 'airbrushings[5].invoices', maxCount: 10 },
        { name: 'airbrushings[5].artworks', maxCount: 20 },
        { name: 'airbrushings[6].receipts', maxCount: 10 },
        { name: 'airbrushings[6].invoices', maxCount: 10 },
        { name: 'airbrushings[6].artworks', maxCount: 20 },
        { name: 'airbrushings[7].receipts', maxCount: 10 },
        { name: 'airbrushings[7].invoices', maxCount: 10 },
        { name: 'airbrushings[7].artworks', maxCount: 20 },
        { name: 'airbrushings[8].receipts', maxCount: 10 },
        { name: 'airbrushings[8].invoices', maxCount: 10 },
        { name: 'airbrushings[8].artworks', maxCount: 20 },
        { name: 'airbrushings[9].receipts', maxCount: 10 },
        { name: 'airbrushings[9].invoices', maxCount: 10 },
        { name: 'airbrushings[9].artworks', maxCount: 20 },
        // Layout photos - one photo per side (matches backend service check at line 685)
        { name: 'layoutPhotos.leftSide', maxCount: 1 },
        { name: 'layoutPhotos.rightSide', maxCount: 1 },
        { name: 'layoutPhotos.backSide', maxCount: 1 },
      ],
      multerConfig,
    ),
  )
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(taskUpdateSchema))
    data: TaskUpdateFormData = {} as TaskUpdateFormData,
    @Query(new ZodValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
    @User() user: UserPayload,
    @UploadedFiles() files?: Record<string, Express.Multer.File[]>,
  ): Promise<TaskUpdateResponse> {
    console.log('[TaskController] ========================================');
    console.log('[TaskController] UPDATE REQUEST RECEIVED');
    console.log('[TaskController] Full data:', JSON.stringify(data, null, 2));
    console.log('[TaskController] customerId:', data.customerId);
    console.log('[TaskController] pricing:', JSON.stringify((data as any).pricing));
    console.log('[TaskController] data keys:', Object.keys(data));
    console.log('[TaskController] files keys:', files ? Object.keys(files) : 'no files');
    console.log('[TaskController] ========================================');

    return this.tasksService.update(
      id,
      data,
      query.include,
      userId,
      user?.role as SECTOR_PRIVILEGES,
      files,
    );
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<TaskDeleteResponse> {
    return this.tasksService.delete(id, userId);
  }

  // =====================
  // DEPRECATED FILE UPLOAD ENDPOINTS
  // =====================
  // These endpoints are obsolete. Files should be submitted WITH the task form (POST /tasks or PUT /tasks/:id)
  // using FormData with the file fields directly in the request body

  @Post(':id/upload/budgets')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async uploadBudget() {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a atualização da tarefa. ' +
        'Use PUT /tasks/:id com FormData incluindo o campo "budgets".',
    );
  }

  @Post(':id/upload/invoices')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async uploadInvoice() {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a atualização da tarefa. ' +
        'Use PUT /tasks/:id com FormData incluindo o campo "invoices".',
    );
  }

  @Post(':id/upload/receipts')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async uploadReceipt() {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a atualização da tarefa. ' +
        'Use PUT /tasks/:id com FormData incluindo o campo "receipts".',
    );
  }

  @Post(':id/upload/reimbursements')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async uploadReimbursement() {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a atualização da tarefa. ' +
        'Use PUT /tasks/:id com FormData incluindo o campo apropriado.',
    );
  }

  @Post(':id/upload/reimbursement-invoices')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async uploadReimbursementInvoice() {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a atualização da tarefa. ' +
        'Use PUT /tasks/:id com FormData incluindo o campo apropriado.',
    );
  }

  @Post(':id/upload/artworks')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async uploadArtwork() {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a atualização da tarefa. ' +
        'Use PUT /tasks/:id com FormData incluindo o campo "artworks".',
    );
  }
}
