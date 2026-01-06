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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import { UserService } from './user.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import type {
  User,
  UserBatchCreateResponse,
  UserBatchDeleteResponse,
  UserBatchUpdateResponse,
  UserCreateResponse,
  UserDeleteResponse,
  UserGetManyResponse,
  UserGetUniqueResponse,
  UserUpdateResponse,
  UserMergeResponse,
} from '../../../types';
import type {
  UserCreateFormData,
  UserUpdateFormData,
  UserGetManyFormData,
  UserBatchCreateFormData,
  UserBatchUpdateFormData,
  UserBatchDeleteFormData,
  UserGetByIdFormData,
  UserQueryFormData,
  UserMergeFormData,
} from '../../../schemas/user';
import {
  userCreateSchema,
  userBatchCreateSchema,
  userBatchDeleteSchema,
  userBatchUpdateSchema,
  userGetManySchema,
  userUpdateSchema,
  userGetByIdSchema,
  userQuerySchema,
  userMergeSchema,
} from '../../../schemas/user';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(userGetManySchema)) query: UserGetManyFormData,
    @UserId() userId: string,
  ): Promise<UserGetManyResponse> {
    return this.userService.findMany(query, query.include, userId);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(userCreateSchema)) data: UserCreateFormData,
    @Query(new ZodQueryValidationPipe(userQuerySchema)) query: UserQueryFormData,
    @UserId() userId: string,
    @UploadedFile() avatar?: Express.Multer.File,
  ): Promise<UserCreateResponse> {
    return this.userService.create(data, query.include, userId, avatar);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(userBatchCreateSchema)) data: UserBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(userQuerySchema)) query: UserQueryFormData,
    @UserId() userId: string,
  ): Promise<UserBatchCreateResponse<UserCreateFormData>> {
    return this.userService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(userBatchUpdateSchema)) data: UserBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(userQuerySchema)) query: UserQueryFormData,
    @UserId() userId: string,
  ): Promise<UserBatchUpdateResponse<UserUpdateFormData>> {
    return this.userService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(userBatchDeleteSchema)) data: UserBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<UserBatchDeleteResponse> {
    return this.userService.batchDelete(data, userId);
  }

  @Post('merge')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async merge(
    @Body(new ZodValidationPipe(userMergeSchema)) data: UserMergeFormData,
    @Query(new ZodQueryValidationPipe(userQuerySchema)) query: UserQueryFormData,
    @UserId() userId: string,
  ): Promise<UserMergeResponse> {
    return this.userService.merge(data, query.include, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(userQuerySchema)) query: UserQueryFormData,
    @UserId() userId: string,
  ): Promise<UserGetUniqueResponse> {
    return this.userService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(userUpdateSchema)) data: UserUpdateFormData,
    @Query(new ZodQueryValidationPipe(userQuerySchema)) query: UserQueryFormData,
    @UserId() userId: string,
    @UploadedFile() avatar?: Express.Multer.File,
  ): Promise<UserUpdateResponse> {
    return this.userService.update(id, data, query.include, userId, avatar);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<UserDeleteResponse> {
    return this.userService.delete(id, userId);
  }
}
