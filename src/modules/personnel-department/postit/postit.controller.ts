// postit.controller.ts
// Post-its pessoais — qualquer usuário autenticado (sem @Roles): cada um
// vê e gerencia SOMENTE os próprios post-its (escopo aplicado no service).

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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { PostitService } from './postit.service';
import {
  postitGetManySchema,
  postitCreateSchema,
  postitUpdateSchema,
  postitReorderSchema,
  postitQuerySchema,
} from '../../../schemas';
import type {
  PostitGetManyFormData,
  PostitCreateFormData,
  PostitUpdateFormData,
  PostitReorderFormData,
  PostitQueryFormData,
} from '../../../schemas';
import type {
  PostitGetManyResponse,
  PostitGetUniqueResponse,
  PostitCreateResponse,
  PostitUpdateResponse,
  PostitDeleteResponse,
  PostitReorderResponse,
} from '../../../types';

@Controller('postits')
@UseGuards(AuthGuard)
export class PostitController {
  constructor(private readonly service: PostitService) {}

  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(postitGetManySchema)) query: PostitGetManyFormData,
    @UserId() userId: string,
  ): Promise<PostitGetManyResponse> {
    return this.service.findMany(query, userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async create(
    @Body(new ZodValidationPipe(postitCreateSchema)) data: PostitCreateFormData,
    @Query(new ZodQueryValidationPipe(postitQuerySchema)) query: PostitQueryFormData,
    @UserId() userId: string,
  ): Promise<PostitCreateResponse> {
    return this.service.create(data, userId, query.include);
  }

  // Static routes (must come before dynamic routes)
  @Put('reorder')
  @WriteRateLimit()
  async reorder(
    @Body(new ZodValidationPipe(postitReorderSchema)) data: PostitReorderFormData,
    @UserId() userId: string,
  ): Promise<PostitReorderResponse> {
    return this.service.reorder(data, userId);
  }

  // Dynamic routes
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(postitQuerySchema)) query: PostitQueryFormData,
    @UserId() userId: string,
  ): Promise<PostitGetUniqueResponse> {
    return this.service.findById(id, userId, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(postitUpdateSchema)) data: PostitUpdateFormData,
    @Query(new ZodQueryValidationPipe(postitQuerySchema)) query: PostitQueryFormData,
    @UserId() userId: string,
  ): Promise<PostitUpdateResponse> {
    return this.service.update(id, data, userId, query.include);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PostitDeleteResponse> {
    return this.service.delete(id, userId);
  }
}
