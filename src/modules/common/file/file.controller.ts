import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Req,
  Res,
  BadRequestException,
  UseGuards,
  Options,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { FileService } from './file.service';
import { FilesStorageService } from './services/files-storage.service';
import { FileOrganizationSchedulerService } from './services/file-organization-scheduler.service';
import { FileMigrationService } from './services/file-migration.service';
import { multerConfig } from './config/upload.config';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import {
  WriteRateLimit,
  ReadRateLimit,
  CustomRateLimit,
  FileUploadRateLimit,
  NoRateLimit,
  FileOperationBypass,
} from '../throttler/throttler.decorators';
import {
  fileGetManySchema,
  fileGetByIdSchema,
  fileCreateSchema,
  fileUpdateSchema,
  fileBatchCreateSchema,
  fileBatchUpdateSchema,
  fileBatchDeleteSchema,
  fileQuerySchema,
} from '../../../schemas/file';
import type {
  FileGetManyFormData,
  FileGetByIdFormData,
  FileCreateFormData,
  FileUpdateFormData,
  FileBatchCreateFormData,
  FileBatchUpdateFormData,
  FileBatchDeleteFormData,
  FileQueryFormData,
} from '../../../schemas/file';
import type {
  FileCreateResponse,
  FileGetUniqueResponse,
  FileGetManyResponse,
  FileUpdateResponse,
  FileDeleteResponse,
  FileBatchCreateResponse,
  FileBatchUpdateResponse,
  FileBatchDeleteResponse,
} from '../../../types';

@Controller('files')
@UseGuards(AuthGuard)
export class FileController {
  constructor(
    private readonly fileService: FileService,
    private readonly filesStorageService: FilesStorageService,
    private readonly fileOrganizationScheduler: FileOrganizationSchedulerService,
    private readonly fileMigrationService: FileMigrationService,
  ) {}

  // File Upload Endpoints - Static routes first
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  @FileOperationBypass() // Completely bypass ALL throttlers for file uploads
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Query('filename') filename?: string,
    @Query('fileContext') fileContext?: string,
    @Query('entityId') entityId?: string,
    @Query('entityType') entityType?: string,
    @Query('projectId') projectId?: string,
    @Query('projectName') projectName?: string,
    @Query('customerName') customerName?: string,
    @Query('supplierName') supplierName?: string,
    @Query('userName') userName?: string,
    @Query('cutType') cutType?: string,
    @Query(new ZodQueryValidationPipe(fileQuerySchema)) query?: FileQueryFormData,
    @UserId() userId?: string,
  ): Promise<FileCreateResponse> {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }
    return this.fileService.createFromUpload(file, query?.include, userId, {
      fileContext: fileContext as any,
      entityId,
      entityType,
      projectId,
      projectName,
      customerName,
      supplierName,
      userName,
      cutType,
    });
  }

  @Post('upload/multiple')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FilesInterceptor('files', 30, multerConfig)) // Limit to 30 files
  @FileOperationBypass() // Completely bypass ALL throttlers for file uploads
  async uploadMultipleFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Query('fileContext') fileContext?: string,
    @Query('entityId') entityId?: string,
    @Query('entityType') entityType?: string,
    @Query('projectId') projectId?: string,
    @Query('projectName') projectName?: string,
    @Query('customerName') customerName?: string,
    @Query('supplierName') supplierName?: string,
    @Query('userName') userName?: string,
    @Query('cutType') cutType?: string,
    @Query(new ZodQueryValidationPipe(fileQuerySchema)) query?: FileQueryFormData,
    @UserId() userId?: string,
  ): Promise<FileBatchCreateResponse<FileCreateFormData>> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }
    const successful: any[] = [];
    const failed: any[] = [];
    for (const file of files) {
      try {
        const result = await this.fileService.createFromUpload(file, query?.include, userId, {
          fileContext: fileContext as any,
          entityId,
          entityType,
          projectId,
          projectName,
          customerName,
          supplierName,
          userName,
          cutType,
        });
        if (result.data) successful.push(result.data);
      } catch (error: any) {
        failed.push({ file: file.originalname, error: error.message });
      }
    }
    return {
      success: true,
      message: successful.length === 1
        ? '1 arquivo enviado com sucesso.'
        : `${successful.length} arquivos enviados com sucesso.`,
      data: { success: successful, failed, totalProcessed: successful.length + failed.length, totalSuccess: successful.length, totalFailed: failed.length },
    };
  }

  // File Serving Endpoints - Public (no auth required)

  // OPTIONS handlers for CORS preflight
  @Options('serve/:id')
  @Public()
  @FileOperationBypass()
  async serveFileOptions(@Res() res: Response): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Range, x-request-id, Authorization',
    );
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).send();
  }

  @Get('serve/:id')
  @Public()
  @FileOperationBypass() // Completely bypass ALL throttlers for file serving
  async serveFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.fileService.serveFileById(id, res, req);
  }

  @Options(':id/download')
  @Public()
  @FileOperationBypass()
  async downloadFileOptions(@Res() res: Response): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-request-id, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).send();
  }

  @Get(':id/download')
  @Public()
  @FileOperationBypass() // Completely bypass ALL throttlers for file downloads
  async downloadFile(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    await this.fileService.downloadFileById(id, res);
  }

  @Options('thumbnail/:id')
  @Public()
  @NoRateLimit()
  async serveThumbnailOptions(@Res() res: Response): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-request-id, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).send();
  }

  @Get('thumbnail/:id')
  @Public()
  @NoRateLimit() // Disable rate limiting for thumbnail serving
  async serveThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('size') size: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.fileService.serveThumbnailById(id, res, size);
  }

  // Basic CRUD Operations - Static routes first
  @Get()
  @NoRateLimit() // Disable rate limiting for file list operations
  async findMany(
    @Query(new ZodQueryValidationPipe(fileGetManySchema)) query: FileGetManyFormData,
  ): Promise<FileGetManyResponse> {
    return this.fileService.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async create(
    @Body(new ZodValidationPipe(fileCreateSchema)) data: FileCreateFormData,
    @Query(new ZodQueryValidationPipe(fileQuerySchema)) query: FileQueryFormData,
    @UserId() userId: string,
  ): Promise<FileCreateResponse> {
    return this.fileService.create(data, query.include, userId);
  }

  // File Suggestions
  @Get('suggestions')
  @ReadRateLimit()
  async getFileSuggestions(
    @Query('customerId', ParseUUIDPipe) customerId: string,
    @Query('fileContext') fileContext: 'tasksArtworks' | 'taskBaseFiles' | 'taskProjectFiles',
    @Query('limit') limit?: string,
    @Query('excludeIds') excludeIds?: string,
  ): Promise<{ success: boolean; data: any[] }> {
    const validContexts = ['tasksArtworks', 'taskBaseFiles', 'taskProjectFiles'];
    if (!validContexts.includes(fileContext)) {
      throw new BadRequestException('fileContext deve ser: tasksArtworks, taskBaseFiles ou taskProjectFiles');
    }
    return this.fileService.getFileSuggestions({
      customerId,
      fileContext,
      limit: limit ? parseInt(limit, 10) : undefined,
      excludeIds: excludeIds ? excludeIds.split(',').filter(Boolean) : undefined,
    });
  }

  // Create file from existing
  @Post('create-from-existing')
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async createFromExistingFile(
    @Body('sourceFileId', ParseUUIDPipe) sourceFileId: string,
    @UserId() userId: string,
  ): Promise<{ success: boolean; data: any }> {
    return this.fileService.createFromExistingFile(sourceFileId, userId);
  }

  // Batch Operations - Static routes before dynamic routes
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @WriteRateLimit()
  async batchCreate(
    @Body(new ZodValidationPipe(fileBatchCreateSchema)) data: FileBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(fileQuerySchema)) query: FileQueryFormData,
    @UserId() userId: string,
  ): Promise<FileBatchCreateResponse<FileCreateFormData>> {
    return this.fileService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(fileBatchUpdateSchema)) data: FileBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(fileQuerySchema)) query: FileQueryFormData,
    @UserId() userId: string,
  ): Promise<FileBatchUpdateResponse<FileUpdateFormData>> {
    return this.fileService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async batchDelete(
    @Body(new ZodValidationPipe(fileBatchDeleteSchema)) data: FileBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<FileBatchDeleteResponse> {
    return this.fileService.batchDelete(data, userId);
  }

  // File Organization Endpoints
  @Get('organization/status')
  @WriteRateLimit()
  async getOrganizationStatus(): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    const report = await this.fileOrganizationScheduler.getOrganizationReport();
    return {
      success: true,
      data: report,
      message: 'Relatório de organização de arquivos gerado.',
    };
  }

  @Post('organization/trigger')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async triggerOrganization(): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    const result = await this.fileOrganizationScheduler.triggerManualOrganization();
    return {
      success: result.success,
      data: result.stats,
      message: result.message,
    };
  }

  // File Migration Endpoints
  @Get('migration/analysis')
  @WriteRateLimit()
  async getMigrationAnalysis(): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    const report = await this.fileMigrationService.getStorageAnalysisReport();
    return {
      success: true,
      data: report,
      message: 'Relatório de análise de armazenamento gerado.',
    };
  }

  @Get('migration/root-files')
  @WriteRateLimit()
  async getRootFiles(): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    const report = await this.fileMigrationService.scanRootFiles();
    return {
      success: true,
      data: report,
      message: 'Arquivos na raiz escaneados.',
    };
  }

  @Get('migration/duplicates')
  @WriteRateLimit()
  async getDuplicateCustomers(): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    const report = await this.fileMigrationService.findDuplicateCustomers();
    return {
      success: true,
      data: report,
      message: 'Clientes duplicados identificados.',
    };
  }

  @Post('migration/run')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async runMigration(
    @Query('dryRun') dryRun?: string,
  ): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    const isDryRun = dryRun !== 'false';
    const result = await this.fileMigrationService.migrateRootFiles(isDryRun);
    return {
      success: result.errors.length === 0,
      data: result,
      message: isDryRun
        ? `Simulação de migração: ${result.matched} arquivos podem ser movidos.`
        : `Migração concluída: ${result.moved} arquivos movidos.`,
    };
  }

  @Post('migration/consolidate')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async consolidateCustomers(
    @Body() body: { primaryCustomerId: string; secondaryCustomerIds: string[]; dryRun?: boolean },
  ): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    const isDryRun = body.dryRun !== false;
    const result = await this.fileMigrationService.consolidateCustomerFolders(
      body.primaryCustomerId,
      body.secondaryCustomerIds,
      isDryRun,
    );
    return {
      success: result.errors.length === 0,
      data: result,
      message: isDryRun
        ? `Simulação: ${result.matched} arquivos podem ser consolidados.`
        : `Consolidação concluída: ${result.moved} arquivos movidos.`,
    };
  }

  // Dynamic routes last
  @Get(':id')
  @Public()
  @FileOperationBypass() // Completely bypass ALL throttlers for file reads
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(fileQuerySchema)) query: FileQueryFormData,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<FileGetUniqueResponse | void> {
    // If request accepts HTML/image (likely from img tag or browser), serve the thumbnail
    const accept = req.headers['accept'] || '';
    const isImageRequest =
      accept.includes('image/') || (accept.includes('*/*') && !accept.includes('application/json'));

    if (isImageRequest) {
      // Redirect to thumbnail endpoint for image requests
      return res.redirect(307, `/files/thumbnail/${id}`);
    }

    // Return JSON metadata for API requests
    const result = await this.fileService.findById(id, query.include);
    res.json(result);
  }

  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(fileUpdateSchema)) data: FileUpdateFormData,
    @Query(new ZodQueryValidationPipe(fileQuerySchema)) query: FileQueryFormData,
    @UserId() userId: string,
  ): Promise<FileUpdateResponse> {
    return this.fileService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @WriteRateLimit()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<FileDeleteResponse> {
    return this.fileService.delete(id, userId);
  }

  // PDF Thumbnail Operations
  @Post(':id/regenerate-thumbnail')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async regenerateThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data?: { thumbnailUrl: string };
  }> {
    const result = await this.fileService.regenerateThumbnail(id, userId);
    return {
      success: result.success,
      message: result.message,
      data: result.data?.thumbnailUrl ? { thumbnailUrl: result.data.thumbnailUrl } : undefined,
    };
  }

  // Files Storage Configuration Endpoints
  @Get('storage/contexts')
  @NoRateLimit()
  async getStorageContexts(@Query('entityType') entityType?: string): Promise<{
    success: boolean;
    data: {
      folderMapping: any;
      availableContexts: string[];
    };
    message: string;
  }> {
    const folderMapping = this.filesStorageService.getFolderMapping();
    const availableContexts = this.filesStorageService.getAvailableContextsForEntity(entityType);

    return {
      success: true,
      data: {
        folderMapping,
        availableContexts,
      },
      message: 'Contextos de armazenamento carregados com sucesso.',
    };
  }
}
