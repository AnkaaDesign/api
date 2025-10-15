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
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { FileService } from '@modules/common/file/file.service';
import { TaskService } from './task.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
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
} from '../../../schemas/task';
import type {
  TaskCreateFormData,
  TaskUpdateFormData,
  TaskGetManyFormData,
  TaskBatchCreateFormData,
  TaskBatchUpdateFormData,
  TaskBatchDeleteFormData,
  TaskDuplicateFormData,
  TaskQueryFormData,
} from '../../../schemas/task';
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
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(taskGetManySchema)) query: TaskGetManyFormData,
    @UserId() userId: string,
  ): Promise<TaskGetManyResponse> {
    return this.tasksService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'budgets', maxCount: 10 },
      { name: 'invoices', maxCount: 10 },
      { name: 'receipts', maxCount: 10 },
      { name: 'artworks', maxCount: 10 },
    ], multerConfig)
  )
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(taskCreateSchema)) data: TaskCreateFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: {
      budgets?: Express.Multer.File[],
      invoices?: Express.Multer.File[],
      receipts?: Express.Multer.File[],
      artworks?: Express.Multer.File[]
    },
  ): Promise<TaskCreateResponse> {
    return this.tasksService.create(data, query.include, userId, files);
  }

  // Batch Operations
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(taskBatchCreateSchema)) data: TaskBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<TaskBatchCreateResponse<TaskCreateFormData>> {
    return this.tasksService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(taskBatchUpdateSchema)) data: TaskBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<TaskBatchUpdateResponse<TaskUpdateFormData>> {
    return this.tasksService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(taskBatchDeleteSchema)) data: TaskBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<TaskBatchDeleteResponse> {
    return this.tasksService.batchDelete(data, userId);
  }

  // =====================
  // SPECIFIC ENDPOINTS (before dynamic routes)
  // =====================

  @Post(':id/duplicate')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
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

  @Put(':id/start')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  async rollbackFieldChange(
    @Body() data: { changeLogId: string },
    @UserId() userId: string,
  ): Promise<TaskUpdateResponse> {
    return this.tasksService.rollbackFieldChange(data.changeLogId, userId);
  }

  // =====================
  // DYNAMIC ROUTES (must come last)
  // =====================

  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<TaskGetUniqueResponse> {
    return this.tasksService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'budgets', maxCount: 10 },
      { name: 'invoices', maxCount: 10 },
      { name: 'receipts', maxCount: 10 },
      { name: 'artworks', maxCount: 10 },
    ], multerConfig)
  )
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(taskUpdateSchema)) data: TaskUpdateFormData = {} as TaskUpdateFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: {
      budgets?: Express.Multer.File[],
      invoices?: Express.Multer.File[],
      receipts?: Express.Multer.File[],
      artworks?: Express.Multer.File[]
    },
  ): Promise<TaskUpdateResponse> {
    // Debug logging - FIRST LINE to see if controller is reached
    console.log('[TaskController.update] ========== REQUEST RECEIVED ==========');
    console.log('[TaskController.update] Task ID:', id);
    console.log('[TaskController.update] Body keys:', Object.keys(data || {}));
    console.log('[TaskController.update] Body:', JSON.stringify(data).substring(0, 200));

    // Debug logging for file upload
    console.log('[TaskController.update] Files received:', {
      hasBudgets: !!files?.budgets && files.budgets.length > 0,
      hasNfes: !!files?.invoices && files.invoices.length > 0,
      hasReceipts: !!files?.receipts && files.receipts.length > 0,
      hasArtworks: !!files?.artworks && files.artworks.length > 0,
      budgetsCount: files?.budgets?.length || 0,
      invoicesCount: files?.invoices?.length || 0,
      receiptsCount: files?.receipts?.length || 0,
      artworksCount: files?.artworks?.length || 0,
    });

    return this.tasksService.update(id, data, query.include, userId, files);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async uploadBudget() {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a atualização da tarefa. ' +
      'Use PUT /tasks/:id com FormData incluindo o campo "budgets".'
    );
  }

  @Post(':id/upload/invoices')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async uploadInvoice() {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a atualização da tarefa. ' +
      'Use PUT /tasks/:id com FormData incluindo o campo "invoices".'
    );
  }

  @Post(':id/upload/receipts')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async uploadReceipt() {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a atualização da tarefa. ' +
      'Use PUT /tasks/:id com FormData incluindo o campo "receipts".'
    );
  }

  @Post(':id/upload/reimbursements')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async uploadReimbursement() {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a atualização da tarefa. ' +
      'Use PUT /tasks/:id com FormData incluindo o campo apropriado.'
    );
  }

  @Post(':id/upload/reimbursement-invoices')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async uploadReimbursementInvoice() {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a atualização da tarefa. ' +
      'Use PUT /tasks/:id com FormData incluindo o campo apropriado.'
    );
  }

  @Post(':id/upload/artworks')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async uploadArtwork() {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a atualização da tarefa. ' +
      'Use PUT /tasks/:id com FormData incluindo o campo "artworks".'
    );
  }
}
