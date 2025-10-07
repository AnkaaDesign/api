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
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(taskCreateSchema)) data: TaskCreateFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<TaskCreateResponse> {
    return this.tasksService.create(data, query.include, userId);
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
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(taskUpdateSchema)) data: TaskUpdateFormData,
    @Query(new ZodQueryValidationPipe(taskQuerySchema)) query: TaskQueryFormData,
    @UserId() userId: string,
  ): Promise<TaskUpdateResponse> {
    return this.tasksService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<TaskDeleteResponse> {
    return this.tasksService.delete(id, userId);
  }

  // File Upload Endpoints
  @Post(':id/upload/budgets')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadBudget(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @UserId() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const task = await this.tasksService.findById(id, { include: { customer: true } });
    const customerName = task.data.customer?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'taskBudgets',
      entityId: id,
      entityType: 'task',
      customerName,
    });
  }

  @Post(':id/upload/invoices')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @UserId() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const task = await this.tasksService.findById(id, { include: { customer: true } });
    const customerName = task.data.customer?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'taskNfes',
      entityId: id,
      entityType: 'task',
      customerName,
    });
  }

  @Post(':id/upload/receipts')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @UserId() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const task = await this.tasksService.findById(id, { include: { customer: true } });
    const customerName = task.data.customer?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'taskReceipts',
      entityId: id,
      entityType: 'task',
      customerName,
    });
  }

  @Post(':id/upload/reimbursements')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadReimbursement(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @UserId() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const task = await this.tasksService.findById(id, { include: { customer: true } });
    const customerName = task.data.customer?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'taskReembolsos',
      entityId: id,
      entityType: 'task',
      customerName,
    });
  }

  @Post(':id/upload/reimbursement-invoices')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadReimbursementInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @UserId() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const task = await this.tasksService.findById(id, { include: { customer: true } });
    const customerName = task.data.customer?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'taskNfeReembolsos',
      entityId: id,
      entityType: 'task',
      customerName,
    });
  }

  @Post(':id/upload/artworks')
  @Roles(SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadArtwork(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @UserId() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const task = await this.tasksService.findById(id, { include: { customer: true } });
    const customerName = task.data.customer?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'tasksArtworks',
      entityId: id,
      entityType: 'task',
      customerName,
    });
  }
}
