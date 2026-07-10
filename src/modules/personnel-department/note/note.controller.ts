// note.controller.ts
// Notas unificadas — qualquer usuário autenticado (sem @Roles). Cada nota é
// visível ao dono E aos usuários com quem foi compartilhada; a edição e a
// gestão de compartilhamento/exclusão são restringidas no service.

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
import { NoteService } from './note.service';
import {
  noteGetManySchema,
  noteCreateSchema,
  noteUpdateSchema,
  noteReorderSchema,
  noteShareSchema,
  noteQuerySchema,
} from '../../../schemas';
import type {
  NoteGetManyFormData,
  NoteCreateFormData,
  NoteUpdateFormData,
  NoteReorderFormData,
  NoteShareFormData,
  NoteQueryFormData,
} from '../../../schemas';
import type {
  NoteGetManyResponse,
  NoteGetUniqueResponse,
  NoteCreateResponse,
  NoteUpdateResponse,
  NoteDeleteResponse,
  NoteReorderResponse,
  NoteShareResponse,
} from '../../../types';

@Controller('notes')
@UseGuards(AuthGuard)
export class NoteController {
  constructor(private readonly service: NoteService) {}

  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(noteGetManySchema)) query: NoteGetManyFormData,
    @UserId() userId: string,
  ): Promise<NoteGetManyResponse> {
    return this.service.findMany(query, userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async create(
    @Body(new ZodValidationPipe(noteCreateSchema)) data: NoteCreateFormData,
    @Query(new ZodQueryValidationPipe(noteQuerySchema)) query: NoteQueryFormData,
    @UserId() userId: string,
  ): Promise<NoteCreateResponse> {
    return this.service.create(data, userId, query.include);
  }

  // Static routes (must come before dynamic routes)
  @Put('reorder')
  @WriteRateLimit()
  async reorder(
    @Body(new ZodValidationPipe(noteReorderSchema)) data: NoteReorderFormData,
    @UserId() userId: string,
  ): Promise<NoteReorderResponse> {
    return this.service.reorder(data, userId);
  }

  // Dynamic routes
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(noteQuerySchema)) query: NoteQueryFormData,
    @UserId() userId: string,
  ): Promise<NoteGetUniqueResponse> {
    return this.service.findById(id, userId, query.include);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(noteUpdateSchema)) data: NoteUpdateFormData,
    @Query(new ZodQueryValidationPipe(noteQuerySchema)) query: NoteQueryFormData,
    @UserId() userId: string,
  ): Promise<NoteUpdateResponse> {
    return this.service.update(id, data, userId, query.include);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<NoteDeleteResponse> {
    return this.service.delete(id, userId);
  }

  // Compartilhamento — substitui todo o conjunto de shares (owner only).
  @Put(':id/share')
  @WriteRateLimit()
  async share(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(noteShareSchema)) data: NoteShareFormData,
    @UserId() userId: string,
  ): Promise<NoteShareResponse> {
    return this.service.share(id, data, userId);
  }

  // Remoção de um único compartilhamento (owner only).
  @Delete(':id/share/:userId')
  @WriteRateLimit()
  async removeShare(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @UserId() userId: string,
  ): Promise<NoteShareResponse> {
    return this.service.removeShare(id, targetUserId, userId);
  }

  @Put(':id/archive')
  @WriteRateLimit()
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<NoteUpdateResponse> {
    return this.service.archive(id, userId);
  }

  @Put(':id/unarchive')
  @WriteRateLimit()
  async unarchive(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<NoteUpdateResponse> {
    return this.service.unarchive(id, userId);
  }
}
