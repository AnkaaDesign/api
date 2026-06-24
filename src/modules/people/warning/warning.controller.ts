// warning.controller.ts

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { WarningService } from './warning.service';
import { WarningSignatureService } from './warning-signature.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import type {
  WarningBatchCreateResponse,
  WarningBatchDeleteResponse,
  WarningBatchUpdateResponse,
  WarningCreateResponse,
  WarningDeleteResponse,
  WarningGetManyResponse,
  WarningGetUniqueResponse,
  WarningUpdateResponse,
  Warning,
} from '../../../types';
import type {
  WarningCreateFormData,
  WarningUpdateFormData,
  WarningGetManyFormData,
  WarningBatchCreateFormData,
  WarningBatchUpdateFormData,
  WarningBatchDeleteFormData,
  WarningQueryFormData,
  WarningGetByIdFormData,
  WarningBatchQueryFormData,
} from '../../../schemas';
import {
  warningCreateSchema,
  warningBatchCreateSchema,
  warningBatchDeleteSchema,
  warningBatchUpdateSchema,
  warningGetManySchema,
  warningUpdateSchema,
  warningGetByIdSchema,
  warningQuerySchema,
  warningBatchQuerySchema,
  warningSignSchema,
  warningRefuseSignSchema,
} from '../../../schemas';
import type { WarningSignFormData, WarningRefuseSignFormData } from '../../../schemas';

/**
 * Extract the best-effort client IP from the request (proxy-aware).
 */
function extractRequestIp(req: Request): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  if (Array.isArray(fwd) && fwd.length > 0) {
    return fwd[0];
  }
  return req.ip || req.socket?.remoteAddress || undefined;
}

@Controller('warnings')
export class WarningController {
  constructor(
    private readonly warningService: WarningService,
    private readonly warningSignatureService: WarningSignatureService,
  ) {}

  // Basic CRUD Operations
  @Get()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async findMany(
    @Query(new ZodQueryValidationPipe(warningGetManySchema)) query: WarningGetManyFormData,
  ): Promise<WarningGetManyResponse> {
    return this.warningService.findMany(query);
  }

  // User-specific endpoint (must be before dynamic :id route)
  @Get('my-warnings')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyWarnings(
    @Query(new ZodQueryValidationPipe(warningGetManySchema)) query: WarningGetManyFormData,
    @UserId() userId: string,
  ): Promise<WarningGetManyResponse> {
    // Users can only see warnings where they are the collaborator
    const filteredQuery: WarningGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        collaboratorId: userId,
      },
    };
    return this.warningService.findMany(filteredQuery);
  }

  // Team warnings endpoint for team leaders (must be before dynamic :id route)
  @Get('team-warnings')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async getTeamWarnings(
    @Query(new ZodQueryValidationPipe(warningGetManySchema)) query: WarningGetManyFormData,
    @UserId() userId: string,
  ): Promise<WarningGetManyResponse> {
    // Get the user's led sector to filter team members
    const userWithSector = await this.warningService.getUserLedSector(userId);

    if (!userWithSector?.ledSectorId) {
      // User is not a team leader, return empty result
      return {
        success: true,
        message: 'Nenhuma advertência encontrada',
        data: [],
        meta: {
          page: 1,
          totalPages: 0,
          take: query.limit || 25,
          totalRecords: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }

    // Filter warnings by collaborators in the leader's led sector
    const filteredQuery: WarningGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        collaborator: {
          sectorId: userWithSector.ledSectorId,
        },
      },
    };
    return this.warningService.findMany(filteredQuery);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FilesInterceptor('attachments', 10, multerConfig))
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(warningCreateSchema))
    data: WarningCreateFormData,
    @Query(new ZodQueryValidationPipe(warningQuerySchema)) query: WarningQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() attachments?: Express.Multer.File[],
  ): Promise<WarningCreateResponse> {
    return this.warningService.create(data, query.include, userId, attachments);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(warningBatchCreateSchema)) data: WarningBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(warningBatchQuerySchema)) query: WarningBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<WarningBatchCreateResponse<WarningCreateFormData>> {
    return this.warningService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async batchUpdate(
    @Body(new ZodValidationPipe(warningBatchUpdateSchema)) data: WarningBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(warningBatchQuerySchema)) query: WarningBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<WarningBatchUpdateResponse<WarningUpdateFormData>> {
    return this.warningService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(warningBatchDeleteSchema)) data: WarningBatchDeleteFormData,
    @Query(new ZodQueryValidationPipe(warningBatchQuerySchema)) query: WarningBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<WarningBatchDeleteResponse> {
    return this.warningService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(warningQuerySchema)) query: WarningQueryFormData,
  ): Promise<WarningGetUniqueResponse> {
    return this.warningService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @UseInterceptors(FilesInterceptor('attachments', 10, multerConfig))
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(warningUpdateSchema))
    data: WarningUpdateFormData,
    @Query(new ZodQueryValidationPipe(warningQuerySchema)) query: WarningQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() attachments?: Express.Multer.File[],
  ): Promise<WarningUpdateResponse> {
    return this.warningService.update(id, data, query.include, userId, attachments);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<WarningDeleteResponse> {
    return this.warningService.delete(id, userId);
  }

  // ============================================================
  // In-app signature / refusal
  // ============================================================

  /**
   * Collaborator OR witness signs the warning with biometric ciência.
   * Authorization mirrors the PPE owner-sign route (any employee may be a
   * signer); the service enforces that the user is the collaborator or a
   * listed witness.
   */
  @Post(':id/sign')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  @HttpCode(HttpStatus.OK)
  async signWarning(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(warningSignSchema)) evidence: WarningSignFormData,
    @UserId() userId: string,
    @Req() req: Request,
  ): Promise<{ success: true; signatureId: string; hmac: string; signerRole: string }> {
    const ip = extractRequestIp(req);
    return this.warningSignatureService.signWarning(id, evidence, userId, ip);
  }

  /**
   * Supervisor/RH registers that the collaborator REFUSED to sign (recusa
   * testemunhada — CLT). Guarded by the same privilege as @Put(':id').
   */
  @Post(':id/refuse-signature')
  @Roles(
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  )
  @HttpCode(HttpStatus.OK)
  async refuseWarningSignature(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(warningRefuseSignSchema)) data: WarningRefuseSignFormData,
    @UserId() registeredBy: string,
    @Req() req: Request,
  ): Promise<{ success: true; signatureId: string }> {
    const ip = extractRequestIp(req);
    const result = await this.warningSignatureService.refuseWarningSignature(
      id,
      data,
      registeredBy,
      ip,
    );
    // Best-effort: notify each witness to confirm/sign the refusal.
    await this.warningService.notifyWitnessesOfRefusal(id);
    return result;
  }

  /**
   * Verify the integrity of every signature on a warning (recompute HMAC).
   */
  @Get(':id/signature/verify')
  @Roles(
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  )
  async verifyWarningSignature(@Param('id', ParseUUIDPipe) id: string): Promise<{
    valid: boolean;
    signatures: Array<{ signatureId: string; signerRole: string; valid: boolean }>;
    details: string;
  }> {
    return this.warningSignatureService.verifyWarningSignature(id);
  }

  /**
   * On-demand warning term as a real PDF, rendered INLINE so a browser tab
   * opens the native PDF viewer. Returns the authoritative sealed document when
   * one exists, otherwise a freshly rendered preview. Authorized identically to
   * the findById route.
   */
  @Get(':id/document')
  @Roles(
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  )
  async getWarningDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.warningSignatureService.getWarningDocumentPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }
}
