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
    @Query(new ZodQueryValidationPipe(fileQuerySchema)) query?: FileQueryFormData,
    @UserId() userId?: string,
  ): Promise<FileCreateResponse> {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a criação/atualização da entidade. ' +
        'Use os endpoints específicos de cada entidade (POST /tasks, PUT /tasks/:id, etc) com FormData incluindo os arquivos.',
    );
  }

  @Post('upload/multiple')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FilesInterceptor('files', 10, multerConfig)) // Limit to 10 files
  @FileOperationBypass() // Completely bypass ALL throttlers for file uploads
  async uploadMultipleFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Query('fileContext') fileContext?: string,
    @Query('entityId') entityId?: string,
    @Query('entityType') entityType?: string,
    @Query('projectId') projectId?: string,
    @Query('projectName') projectName?: string,
    @Query(new ZodQueryValidationPipe(fileQuerySchema)) query?: FileQueryFormData,
    @UserId() userId?: string,
  ): Promise<FileBatchCreateResponse<FileCreateFormData>> {
    throw new BadRequestException(
      'Endpoint obsoleto: Arquivos devem ser enviados junto com a criação/atualização da entidade. ' +
        'Use os endpoints específicos de cada entidade (POST /tasks, PUT /tasks/:id, etc) com FormData incluindo os arquivos.',
    );
  }

  // File Serving Endpoints - Public (no auth required)

  // OPTIONS handlers for CORS preflight
  @Options('serve/:id')
  @Public()
  @FileOperationBypass()
  async serveFileOptions(@Res() res: Response): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-request-id, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).send();
  }

  @Get('serve/:id')
  @Public()
  @FileOperationBypass() // Completely bypass ALL throttlers for file serving
  async serveFile(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    await this.fileService.serveFileById(id, res);
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
