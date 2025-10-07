import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { FileRepository, PrismaTransaction } from './repositories/file.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import { detectFileRelationshipChanges, getFileRelationshipChangeDescription } from '../../../utils';
import { promises as fs, existsSync, unlinkSync, statSync } from 'fs';
import { join, extname, resolve } from 'path';
import {
  trackAndLogFieldChanges,
  logEntityChange,
  extractEssentialFields,
  getEssentialFields,
} from '@modules/common/changelog/utils/changelog-helpers';
import { Response } from 'express';
import { environmentConfig } from '../../../common/config/environment.config';
import { generateFileUrl, validateFileSize, UPLOAD_CONFIG } from './config/upload.config';
import { ThumbnailService } from './thumbnail.service';
import { ThumbnailQueueService, ThumbnailJobData } from './thumbnail-queue.service';
import { WebDAVService, type WebDAVFolderMapping } from './services/webdav.service';
import { FileRelationshipField, FILE_RELATIONSHIP_MAP } from '../../../utils';
import type {
  FileBatchCreateResponse,
  FileBatchDeleteResponse,
  FileBatchUpdateResponse,
  FileCreateResponse,
  FileDeleteResponse,
  FileGetManyResponse,
  FileGetUniqueResponse,
  FileUpdateResponse,
} from '../../../types';
import { File } from '../../../types';
import type {
  FileCreateFormData,
  FileUpdateFormData,
  FileGetManyFormData,
  FileBatchCreateFormData,
  FileBatchUpdateFormData,
  FileBatchDeleteFormData,
  FileInclude,
} from '../../../schemas/file';

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileRepository: FileRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly thumbnailService: ThumbnailService,
    private readonly thumbnailQueueService: ThumbnailQueueService,
    private readonly webdavService: WebDAVService,
  ) {}

  /**
   * Transform file data to include generated URL (supports WebDAV and upload paths)
   */
  private transformFileWithUrl(file: File): File & { url: string } {
    // Check if file is in WebDAV structure for URL generation
    const isWebDAVFile = UPLOAD_CONFIG.useWebDAV && file.path.includes(UPLOAD_CONFIG.webdavRoot);

    let url: string;

    if (isWebDAVFile) {
      // Generate WebDAV URL for files in WebDAV
      url = this.webdavService.getWebDAVUrl(file.path);
    } else {
      // For local files (temp uploads, etc.), use the file serving endpoint
      const baseUrl = process.env.API_BASE_URL || 'http://localhost:3030';
      url = `${baseUrl}/files/serve/${file.id}`;
    }

    return {
      ...file,
      url,
      // Ensure thumbnailUrl is included if it exists
      thumbnailUrl: file.thumbnailUrl || undefined,
    };
  }

  /**
   * Transform multiple files with URLs
   */
  private transformFilesWithUrls(files: File[]): Array<File & { url: string }> {
    return files.map(file => this.transformFileWithUrl(file));
  }

  /**
   * Log file attachment/detachment to entities
   */
  private async logFileRelationshipChanges(
    relationshipChanges: Array<{
      field: string;
      entityType: ENTITY_TYPE;
      action: 'attached' | 'detached';
      entityId: string;
      description: string;
    }>,
    fileId: string,
    fileName: string,
    triggeredBy: CHANGE_TRIGGERED_BY,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    for (const change of relationshipChanges) {
      const description = getFileRelationshipChangeDescription(change, fileName);

      // Log the change for the related entity
      await this.changeLogService.logChange({
        entityType: change.entityType,
        entityId: change.entityId,
        action: CHANGE_ACTION.UPDATE,
        field: 'files',
        oldValue: change.action === 'detached' ? fileId : null,
        newValue: change.action === 'attached' ? fileId : null,
        reason: description,
        triggeredBy: triggeredBy,
        triggeredById: fileId,
        userId: userId !== undefined ? userId : null,
        transaction: tx,
      });
    }
  }

  /**
   * Validar arquivo completo
   */
  private async validateFile(
    data: Partial<FileCreateFormData | FileUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar nome do arquivo
    if (data.filename) {
      if (data.filename.length < 1 || data.filename.length > 255) {
        throw new BadRequestException('Nome do arquivo deve ter entre 1 e 255 caracteres.');
      }

      // Validar caracteres inválidos no nome do arquivo
      const invalidChars = /[<>:"|?*\x00-\x1f]/;
      if (invalidChars.test(data.filename)) {
        throw new BadRequestException('Nome do arquivo contém caracteres inválidos.');
      }

      // Verificar tentativas de directory traversal
      if (data.filename.includes('../') || data.filename.includes('..\\')) {
        throw new BadRequestException('Nome do arquivo contém tentativas de directory traversal.');
      }
    }

    // Validar mimetype
    if (data.mimetype) {
      if (data.mimetype.length < 1 || data.mimetype.length > 255) {
        throw new BadRequestException('Tipo MIME deve ter entre 1 e 255 caracteres.');
      }

      // Validar formato do mimetype
      const mimetypeRegex =
        /^[a-zA-Z0-9][a-zA-Z0-9!#$&^_+-]{0,126}\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_+-]{0,126}$/;
      if (!mimetypeRegex.test(data.mimetype)) {
        throw new BadRequestException('Tipo MIME inválido.');
      }
    }

    // Validar tamanho
    if (data.size !== undefined) {
      if (data.size < 0) {
        throw new BadRequestException('Tamanho do arquivo não pode ser negativo.');
      }

      // Limite máximo configurável (padrão 500MB)
      const maxSize = process.env.MAX_FILE_SIZE
        ? parseInt(process.env.MAX_FILE_SIZE)
        : 500 * 1024 * 1024;
      if (data.size > maxSize) {
        const maxSizeMB = Math.round(maxSize / (1024 * 1024));
        throw new BadRequestException(`Tamanho do arquivo excede o limite de ${maxSizeMB}MB.`);
      }
    }
  }

  /**
   * Serve file by ID with proper headers
   */
  async serveFileById(id: string, res: Response): Promise<void> {
    try {
      const file = await this.fileRepository.findById(id);

      if (!file) {
        throw new NotFoundException('Arquivo não encontrado.');
      }

      if (!existsSync(file.path)) {
        throw new NotFoundException('Arquivo físico não encontrado no servidor.');
      }

      // Set appropriate headers
      res.setHeader('Content-Type', file.mimetype);
      res.setHeader('Content-Length', file.size);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(file.filename)}"`,
      );
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      res.setHeader('ETag', `"${file.id}"`);
      res.setHeader('Last-Modified', new Date(file.updatedAt).toUTCString());

      // Add CORS headers for cross-origin image loading
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-request-id');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      // Use X-Accel-Redirect for nginx to serve the file (10x faster than Node.js streaming)
      const webdavRoot = process.env.WEBDAV_ROOT || '/srv/webdav';
      const uploadsDir = process.env.UPLOAD_DIR || './uploads';

      let nginxInternalPath: string;

      // Check if file is in WebDAV or local uploads
      if (file.path.startsWith(webdavRoot)) {
        // WebDAV file: Map /srv/webdav/... to /internal-files/...
        const relativePath = file.path.replace(webdavRoot, '');
        nginxInternalPath = `/internal-files${relativePath}`;
      } else if (file.path.startsWith(uploadsDir) || file.path.startsWith('./uploads') || file.path.startsWith('uploads')) {
        // Local upload file: Map uploads/... to /internal-uploads/...
        const relativePath = file.path.replace(/^\.?\/?(uploads\/)/, '');
        nginxInternalPath = `/internal-uploads/${relativePath}`;
      } else {
        // Fallback: assume it's a relative path in uploads
        nginxInternalPath = `/internal-uploads/${file.path}`;
      }

      // Set X-Accel-Redirect header - nginx will intercept and serve the file
      res.setHeader('X-Accel-Redirect', nginxInternalPath);
      res.end();
    } catch (error: any) {
      this.logger.error(`Erro ao servir arquivo ${id}:`, error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao servir arquivo.');
    }
  }

  /**
   * Download file by ID with attachment disposition
   */
  async downloadFileById(id: string, res: Response): Promise<void> {
    try {
      const file = await this.fileRepository.findById(id);
      if (!file) {
        throw new NotFoundException('Arquivo não encontrado.');
      }
      if (!existsSync(file.path)) {
        throw new NotFoundException('Arquivo físico não encontrado no servidor.');
      }
      // Set appropriate headers for download
      res.setHeader('Content-Type', file.mimetype);
      res.setHeader('Content-Length', file.size);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(file.filename)}"`,
      );
      res.setHeader('Cache-Control', 'no-cache');
      // Add CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-request-id');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      // Use X-Accel-Redirect for nginx to serve the file (10x faster than Node.js streaming)
      const webdavRoot = process.env.WEBDAV_ROOT || '/srv/webdav';
      const uploadsDir = process.env.UPLOAD_DIR || './uploads';

      let nginxInternalPath: string;

      // Check if file is in WebDAV or local uploads
      if (file.path.startsWith(webdavRoot)) {
        // WebDAV file: Map /srv/webdav/... to /internal-files/...
        const relativePath = file.path.replace(webdavRoot, '');
        nginxInternalPath = `/internal-files${relativePath}`;
      } else if (file.path.startsWith(uploadsDir) || file.path.startsWith('./uploads') || file.path.startsWith('uploads')) {
        // Local upload file: Map uploads/... to /internal-uploads/...
        const relativePath = file.path.replace(/^\.?\/?(uploads\/)/, '');
        nginxInternalPath = `/internal-uploads/${relativePath}`;
      } else {
        // Fallback: assume it's a relative path in uploads
        nginxInternalPath = `/internal-uploads/${file.path}`;
      }

      // Set X-Accel-Redirect header - nginx will intercept and serve the file
      res.setHeader('X-Accel-Redirect', nginxInternalPath);
      res.end();
    } catch (error: any) {
      this.logger.error(`Erro ao baixar arquivo ${id}:`, error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao baixar arquivo.');
    }
  }

  /**
   * Serve file thumbnail by ID
   */
  async serveThumbnailById(id: string, res: Response, size?: string): Promise<void> {
    try {
      const file = await this.fileRepository.findById(id);

      if (!file) {
        throw new NotFoundException('Arquivo não encontrado.');
      }

      // Check if file type supports thumbnails
      const isImage = file.mimetype.startsWith('image/');
      const isPdf = file.mimetype === 'application/pdf';
      const isEps = file.mimetype === 'application/postscript';
      const supportsThumbnails = isImage || isPdf || isEps;

      if (!supportsThumbnails) {
        throw new NotFoundException('Este tipo de arquivo não suporta thumbnails.');
      }

      // Get the appropriate thumbnail size
      const thumbnailSize = this.thumbnailService.getThumbnailSize(size);

      // Build thumbnail path based on size and format
      const thumbnailPath = join(
        environmentConfig.upload.uploadDir,
        'thumbnails',
        `${thumbnailSize.width}x${thumbnailSize.height}`,
        `${file.id}_${thumbnailSize.width}x${thumbnailSize.height}.webp`,
      );

      // Fallback to other formats if webp doesn't exist
      let actualPath = thumbnailPath;
      let contentType = 'image/webp';

      if (!existsSync(actualPath)) {
        // Try PNG
        actualPath = thumbnailPath.replace('.webp', '.png');
        contentType = 'image/png';

        if (!existsSync(actualPath)) {
          // Try JPG
          actualPath = thumbnailPath.replace('.webp', '.jpg');
          contentType = 'image/jpeg';

          if (!existsSync(actualPath)) {
            // Thumbnail doesn't exist - try to generate it on-demand
            this.logger.log(`Thumbnail not found for ${file.id}, generating on-demand...`);
            try {
              // Resolve file path to absolute if it's relative
              const absoluteFilePath = file.path.startsWith('/')
                ? file.path
                : resolve(file.path);

              this.logger.log(`Generating thumbnail from path: ${absoluteFilePath}`);

              const result = await this.thumbnailService.generateThumbnail(
                absoluteFilePath,
                file.mimetype,
                file.id,
                { format: 'webp', quality: 80 },
              );

              this.logger.log(`Thumbnail generation result: ${JSON.stringify({ success: result.success, thumbnailPath: result.thumbnailPath, thumbnailUrl: result.thumbnailUrl })}`);

              if (result.success && result.thumbnailPath && existsSync(result.thumbnailPath)) {
                actualPath = result.thumbnailPath;
                contentType = 'image/webp';
                this.logger.log(`On-demand thumbnail generated successfully for ${file.id}`);

                // Update database with thumbnailUrl if it wasn't set
                if (!file.thumbnailUrl && result.thumbnailUrl) {
                  await this.fileRepository.update(file.id, { thumbnailUrl: result.thumbnailUrl }, {});
                  this.logger.log(`Updated thumbnailUrl in database for ${file.id}`);
                }
              } else {
                this.logger.error(`Thumbnail generation failed or file doesn't exist. Result: ${JSON.stringify(result)}`);
                throw new NotFoundException('Não foi possível gerar thumbnail para este arquivo.');
              }
            } catch (genError: any) {
              this.logger.error(`Failed to generate thumbnail on-demand: ${genError.message}`, genError.stack);
              throw new NotFoundException('Thumbnail não disponível e não foi possível gerar.');
            }
          }
        }
      }

      // Set headers for thumbnail
      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="thumbnail-${encodeURIComponent(file.filename)}.${contentType.split('/')[1]}"`,
      );
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.setHeader('ETag', `"${file.id}-thumb-${thumbnailSize.width}x${thumbnailSize.height}"`);

      // Add CORS headers for cross-origin image loading
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-request-id');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      // Use X-Accel-Redirect for nginx to serve the thumbnail (10x faster than Node.js streaming)
      // Map ./uploads/thumbnails/... to /internal-thumbnails/...
      const uploadsDir = resolve(environmentConfig.upload.uploadDir);
      const thumbnailsDir = join(uploadsDir, 'thumbnails');
      const absolutePath = resolve(actualPath);
      const relativePath = absolutePath.replace(thumbnailsDir, '');
      const nginxInternalPath = `/internal-thumbnails${relativePath}`;

      // Set X-Accel-Redirect header - nginx will intercept and serve the file
      res.setHeader('X-Accel-Redirect', nginxInternalPath);
      res.end();
    } catch (error: any) {
      this.logger.error(`Erro ao servir thumbnail ${id}:`, error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao servir thumbnail.');
    }
  }

  /**
   * Queue thumbnail generation for supported file types
   */
  private async queueThumbnailGeneration(file: File): Promise<void> {
    try {
      // Check if file type supports thumbnails
      const supportedTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/tiff',
        'application/pdf',
        'application/postscript',
        'application/x-eps',
        'application/eps',
        'image/eps',
        'image/x-eps',
        'video/mp4',
        'video/avi',
        'video/mov',
        'video/wmv',
        'video/flv',
        'video/webm',
        'video/mkv',
      ];

      this.logger.log(
        `Checking thumbnail generation for file ${file.id} with mimetype ${file.mimetype}`,
      );

      if (!supportedTypes.some(type => file.mimetype.toLowerCase() === type.toLowerCase())) {
        this.logger.log(`Mimetype ${file.mimetype} not supported for thumbnail generation`);
        return;
      }

      // Determine priority based on file type
      let priority: ThumbnailJobData['priority'] = 'normal';

      // High priority for images (fast to process)
      if (file.mimetype.startsWith('image/') && !file.mimetype.includes('eps')) {
        priority = 'high';
      }
      // Low priority for videos (slow to process)
      else if (file.mimetype.startsWith('video/')) {
        priority = 'low';
      }

      this.logger.log(
        `Queuing thumbnail generation for file ${file.id} at path ${file.path} with priority ${priority}`,
      );

      // Add job to queue
      const job = await this.thumbnailQueueService.addThumbnailJob({
        fileId: file.id,
        filePath: file.path,
        mimetype: file.mimetype,
        priority,
        options: {
          width: 300,
          height: 300,
          quality: 85,
          format: 'webp',
          fit: 'contain',
        },
      });

      this.logger.log(`Thumbnail generation job queued for file ${file.id}: ${job.id}`);
    } catch (error: any) {
      this.logger.error(
        `Error queuing thumbnail generation for file ${file.id}: ${error.message}`,
        error.stack,
      );
      // Don't throw - thumbnail generation is optional
    }
  }

  /**
   * Delete physical file from storage (supports both upload and WebDAV paths)
   */
  private async deletePhysicalFile(filePath: string, fileId?: string): Promise<void> {
    try {
      // Determine if file is in WebDAV structure
      const isWebDAVFile = UPLOAD_CONFIG.useWebDAV && filePath.includes(UPLOAD_CONFIG.webdavRoot);

      if (isWebDAVFile) {
        // Use WebDAV service for deletion
        await this.webdavService.deleteFromWebDAV(filePath);
        this.logger.log(`Arquivo WebDAV removido: ${filePath}`);
      } else {
        // Traditional file system deletion
        if (existsSync(filePath)) {
          await fs.unlink(filePath);
          this.logger.log(`Arquivo físico removido: ${filePath}`);
        }
      }

      // Also delete thumbnails if fileId is provided
      if (fileId) {
        await this.thumbnailService.deleteThumbnails(fileId);
      }
    } catch (error: any) {
      this.logger.warn(`Falha ao remover arquivo físico ${filePath}: ${error.message}`);
      // Don't throw - we still want to delete the database record
    }
  }

  /**
   * Buscar muitos arquivos com filtros
   */
  async findMany(query: FileGetManyFormData): Promise<FileGetManyResponse> {
    try {
      const result = await this.fileRepository.findMany(query);

      return {
        success: true,
        data: this.transformFilesWithUrls(result.data),
        meta: result.meta,
        message: 'Arquivos carregados com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar arquivos:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar arquivos. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Buscar um arquivo por ID
   */
  async findById(id: string, include?: FileInclude): Promise<FileGetUniqueResponse> {
    try {
      const file = await this.fileRepository.findById(id, { include });

      if (!file) {
        throw new NotFoundException('Arquivo não encontrado.');
      }

      return {
        success: true,
        data: this.transformFileWithUrl(file),
        message: 'Arquivo carregado com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar arquivo por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar arquivo. Por favor, tente novamente.');
    }
  }

  /**
   * Criar novo arquivo
   */
  async create(
    data: FileCreateFormData,
    include?: FileInclude,
    userId?: string,
  ): Promise<FileCreateResponse> {
    try {
      const file = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar arquivo completo
        await this.validateFile(data, undefined, tx);

        // Criar o arquivo
        const newFile = await this.fileRepository.createWithTransaction(tx, data, { include });

        // Registrar no changelog com campos essenciais
        const essentialFields = getEssentialFields(ENTITY_TYPE.FILE);
        const fileForLog = extractEssentialFields(newFile, essentialFields as (keyof File)[]);

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.FILE,
          entityId: newFile.id,
          action: CHANGE_ACTION.CREATE,
          entity: fileForLog,
          reason: 'Novo arquivo criado',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return newFile;
      });

      return {
        success: true,
        message: 'Arquivo criado com sucesso.',
        data: file,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar arquivo:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar arquivo. Por favor, tente novamente.');
    }
  }

  /**
   * Atualizar arquivo
   */
  async update(
    id: string,
    data: FileUpdateFormData,
    include?: FileInclude,
    userId?: string,
  ): Promise<FileUpdateResponse> {
    try {
      const updatedFile = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar arquivo existente
        const existingFile = await this.fileRepository.findByIdWithTransaction(tx, id);

        if (!existingFile) {
          throw new NotFoundException('Arquivo não encontrado.');
        }

        // Validar arquivo completo
        await this.validateFile(data, id, tx);

        // Atualizar o arquivo
        const updatedFile = await this.fileRepository.updateWithTransaction(tx, id, data, {
          include,
        });

        // Track individual field changes
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.FILE,
          entityId: id,
          oldEntity: existingFile,
          newEntity: updatedFile,
          fieldsToTrack: Object.keys(data),
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Detect and log relationship changes
        const relationshipChanges = detectFileRelationshipChanges(existingFile, updatedFile);
        await this.logFileRelationshipChanges(
          relationshipChanges,
          existingFile.id,
          existingFile.filename,
          CHANGE_TRIGGERED_BY.USER_ACTION,
          userId,
          tx,
        );

        return updatedFile;
      });

      return {
        success: true,
        message: 'Arquivo atualizado com sucesso.',
        data: updatedFile,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar arquivo:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar arquivo. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir arquivo
   */
  async delete(id: string, userId?: string): Promise<FileDeleteResponse> {
    try {
      let fileToDelete: File | null = null;

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const file = await this.fileRepository.findByIdWithTransaction(tx, id);

        if (!file) {
          throw new NotFoundException('Arquivo não encontrado.');
        }

        fileToDelete = file as File;

        // Verificar se o arquivo está associado a alguma entidade
        const associations = await tx.file.findUnique({
          where: { id },
          include: {
            tasksArtworks: { take: 1 },
            customerLogo: { take: 1 },
            supplierLogo: { take: 1 },
            observations: { take: 1 },
            warning: { take: 1 },
            taskBudgets: { take: 1 },
            taskNfes: { take: 1 },
            taskReceipts: { take: 1 },
            orderBudgets: { take: 1 },
            orderNfes: { take: 1 },
            orderReceipts: { take: 1 },
            airbrushingReceipts: { take: 1 },
            airbrushingNfes: { take: 1 },
            externalWithdrawalNfes: { take: 1 },
            externalWithdrawalReceipts: { take: 1 },
          },
        });

        if (associations) {
          const hasAssociations =
            associations.tasksArtworks.length > 0 ||
            associations.customerLogo.length > 0 ||
            associations.supplierLogo.length > 0 ||
            associations.observations.length > 0 ||
            (associations.warning?.length || 0) > 0 ||
            associations.taskBudgets.length > 0 ||
            associations.taskNfes.length > 0 ||
            associations.taskReceipts.length > 0 ||
            associations.orderBudgets.length > 0 ||
            associations.orderNfes.length > 0 ||
            associations.orderReceipts.length > 0 ||
            associations.airbrushingReceipts.length > 0 ||
            associations.airbrushingNfes.length > 0 ||
            associations.externalWithdrawalNfes.length > 0 ||
            associations.externalWithdrawalReceipts.length > 0;

          if (hasAssociations) {
            throw new BadRequestException(
              'Não é possível excluir o arquivo pois ele está associado a outras entidades.',
            );
          }
        }

        // Registrar exclusão com campos essenciais
        const essentialFields = getEssentialFields(ENTITY_TYPE.FILE);
        const fileForLog = extractEssentialFields(file, essentialFields as (keyof File)[]);

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.FILE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: fileForLog,
          reason: 'Arquivo excluído',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.fileRepository.deleteWithTransaction(tx, id);
      });

      // Delete physical files after successful database transaction
      if (fileToDelete) {
        await this.deletePhysicalFile((fileToDelete as File).path, (fileToDelete as File).id);
      }

      return {
        success: true,
        message: 'Arquivo excluído com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir arquivo:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir arquivo. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar múltiplos arquivos
   */
  async batchCreate(
    data: FileBatchCreateFormData,
    include?: FileInclude,
    userId?: string,
  ): Promise<FileBatchCreateResponse<FileCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulCreations: File[] = [];
        const failedCreations: any[] = [];

        // Processar cada arquivo individualmente para validação detalhada
        for (let index = 0; index < data.files.length; index++) {
          const fileData = data.files[index];
          try {
            // Validar arquivo completo
            await this.validateFile(fileData, undefined, tx);

            // Criar o arquivo
            const newFile = await this.fileRepository.createWithTransaction(tx, fileData, {
              include,
            });
            successfulCreations.push(newFile);

            // Registrar no changelog com campos essenciais
            const essentialFields = getEssentialFields(ENTITY_TYPE.FILE);
            const fileForLog = extractEssentialFields(newFile, essentialFields as (keyof File)[]);

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.FILE,
              entityId: newFile.id,
              action: CHANGE_ACTION.CREATE,
              entity: fileForLog,
              reason: 'Arquivo criado em lote',
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              transaction: tx,
            });
          } catch (error: any) {
            failedCreations.push({
              index,
              error: error.message || 'Erro ao criar arquivo.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: fileData,
            });
          }
        }

        return {
          success: successfulCreations,
          failed: failedCreations,
          totalCreated: successfulCreations.length,
          totalFailed: failedCreations.length,
        };
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 arquivo criado com sucesso'
          : `${result.totalCreated} arquivos criados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult format
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
    } catch (error: any) {
      this.logger.error('Erro na criação em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar arquivos em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplos arquivos
   */
  async batchUpdate(
    data: FileBatchUpdateFormData,
    include?: FileInclude,
    userId?: string,
  ): Promise<FileBatchUpdateResponse<FileUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulUpdates: File[] = [];
        const failedUpdates: any[] = [];

        // Processar cada atualização individualmente para validação detalhada
        for (let index = 0; index < data.files.length; index++) {
          const { id, data: updateData } = data.files[index];
          try {
            // Buscar arquivo existente
            const existingFile = await this.fileRepository.findByIdWithTransaction(tx, id);
            if (!existingFile) {
              throw new NotFoundException('Arquivo não encontrado.');
            }

            // Validar arquivo completo
            await this.validateFile(updateData, id, tx);

            // Atualizar o arquivo
            const updatedFile = await this.fileRepository.updateWithTransaction(
              tx,
              id,
              updateData,
              { include },
            );
            successfulUpdates.push(updatedFile);

            // Track individual field changes
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.FILE,
              entityId: id,
              oldEntity: existingFile,
              newEntity: updatedFile,
              fieldsToTrack: Object.keys(updateData),
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            // Detect and log relationship changes
            const relationshipChanges = detectFileRelationshipChanges(existingFile, updatedFile);
            await this.logFileRelationshipChanges(
              relationshipChanges,
              existingFile.id,
              existingFile.filename,
              CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              userId,
              tx,
            );
          } catch (error: any) {
            failedUpdates.push({
              index,
              id,
              error: error.message || 'Erro ao atualizar arquivo.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: { id, ...updateData },
            });
          }
        }

        return {
          success: successfulUpdates,
          failed: failedUpdates,
          totalUpdated: successfulUpdates.length,
          totalFailed: failedUpdates.length,
        };
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 arquivo atualizado com sucesso'
          : `${result.totalUpdated} arquivos atualizados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: {
            ...error.data,
            id: error.id || '',
          },
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
    } catch (error: any) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar arquivos em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch delete files
   */
  async batchDelete(
    data: FileBatchDeleteFormData,
    userId?: string,
  ): Promise<FileBatchDeleteResponse> {
    try {
      let filesToDelete: File[] = [];

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar arquivos antes de excluir para o changelog
        const files = await this.fileRepository.findByIdsWithTransaction(tx, data.fileIds);
        filesToDelete = files;

        // Verificar se algum arquivo está associado
        for (const file of files) {
          const associations = await tx.file.findUnique({
            where: { id: file.id },
            include: {
              tasksArtworks: { take: 1 },
              customerLogo: { take: 1 },
              supplierLogo: { take: 1 },
              observations: { take: 1 },
              warning: { take: 1 },
              taskBudgets: { take: 1 },
              taskNfes: { take: 1 },
              taskReceipts: { take: 1 },
              orderBudgets: { take: 1 },
              orderNfes: { take: 1 },
              orderReceipts: { take: 1 },
              airbrushingReceipts: { take: 1 },
              airbrushingNfes: { take: 1 },
              externalWithdrawalNfes: { take: 1 },
              externalWithdrawalReceipts: { take: 1 },
            },
          });

          if (associations) {
            const hasAssociations =
              (associations.tasksArtworks?.length || 0) > 0 ||
              (associations.customerLogo?.length || 0) > 0 ||
              (associations.supplierLogo?.length || 0) > 0 ||
              (associations.observations?.length || 0) > 0 ||
              (associations.warning?.length || 0) > 0 ||
              (associations.taskBudgets?.length || 0) > 0 ||
              (associations.taskNfes?.length || 0) > 0 ||
              (associations.taskReceipts?.length || 0) > 0 ||
              (associations.orderBudgets?.length || 0) > 0 ||
              (associations.orderNfes?.length || 0) > 0 ||
              (associations.orderReceipts?.length || 0) > 0 ||
              (associations.airbrushingReceipts?.length || 0) > 0 ||
              (associations.airbrushingNfes?.length || 0) > 0 ||
              (associations.externalWithdrawalNfes?.length || 0) > 0 ||
              (associations.externalWithdrawalReceipts?.length || 0) > 0;

            if (hasAssociations) {
              throw new BadRequestException(
                `O arquivo ${file.filename} está associado a outras entidades e não pode ser excluído.`,
              );
            }
          }
        }

        // Registrar exclusões com campos essenciais
        const essentialFields = getEssentialFields(ENTITY_TYPE.FILE);
        for (const file of files) {
          const fileForLog = extractEssentialFields(file, essentialFields as (keyof File)[]);

          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.FILE,
            entityId: file.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: fileForLog,
            reason: 'Arquivo excluído em lote',
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            transaction: tx,
          });
        }

        return this.fileRepository.deleteManyWithTransaction(tx, data.fileIds);
      });

      // Delete physical files after successful database transaction
      for (const file of filesToDelete) {
        if (file && file.path) {
          await this.deletePhysicalFile(file.path, file.id);
        }
      }

      const successMessage =
        result.totalDeleted === 1
          ? '1 arquivo excluído com sucesso'
          : `${result.totalDeleted} arquivos excluídos com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult format
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
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
    }
  }

  /**
   * Track file relationship changes when entities update their file associations
   * This method can be called by other services when they attach/detach files
   */
  async trackFileRelationshipChange(
    fileId: string,
    entityType: ENTITY_TYPE,
    entityId: string,
    action: 'attached' | 'detached',
    fieldName: string,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    try {
      const transaction = tx || this.prisma;

      // Get file details
      const file = await this.fileRepository.findByIdWithTransaction(transaction, fileId);
      if (!file) {
        throw new NotFoundException(`Arquivo com ID ${fileId} não encontrado`);
      }

      const description =
        action === 'attached'
          ? `Arquivo "${file.filename}" foi anexado a ${fieldName}`
          : `Arquivo "${file.filename}" foi removido de ${fieldName}`;

      // Log the change
      await this.changeLogService.logChange({
        entityType: entityType,
        entityId: entityId,
        action: CHANGE_ACTION.UPDATE,
        field: 'files',
        oldValue: action === 'detached' ? fileId : null,
        newValue: action === 'attached' ? fileId : null,
        reason: description,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: entityId,
        userId: userId !== undefined ? userId : null,
        transaction: transaction,
      });
    } catch (error: any) {
      this.logger.error(`Erro ao rastrear mudança de relacionamento do arquivo: ${error.message}`);
      // Don't throw - this is a secondary operation that shouldn't break the main flow
    }
  }

  /**
   * Track multiple file relationship changes at once
   * Useful when batch attaching/detaching files
   */
  async trackFileRelationshipChanges(
    changes: Array<{
      fileId: string;
      entityType: ENTITY_TYPE;
      entityId: string;
      action: 'attached' | 'detached';
      fieldName: string;
    }>,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Process all changes in parallel for better performance
    await Promise.all(
      changes.map(change =>
        this.trackFileRelationshipChange(
          change.fileId,
          change.entityType,
          change.entityId,
          change.action,
          change.fieldName,
          userId,
          transaction,
        ),
      ),
    );
  }

  /**
   * Detect WebDAV folder context from request or file relationships with project support
   */
  private detectFileContext(
    queryParams?: any,
    fileRelationships?: any,
  ): {
    context: keyof WebDAVFolderMapping | null;
    entityId?: string;
    entityType?: string;
    projectId?: string;
    projectName?: string;
    customerName?: string;
    supplierName?: string;
  } {
    // Priority 1: Explicit context from query parameters
    if (queryParams?.fileContext) {
      return {
        context: queryParams.fileContext as keyof WebDAVFolderMapping,
        entityId: queryParams.entityId,
        entityType: queryParams.entityType,
        projectId: queryParams.projectId,
        projectName: queryParams.projectName,
        customerName: queryParams.customerName,
        supplierName: queryParams.supplierName,
      };
    }

    // Priority 2: Detect from file relationships
    if (fileRelationships) {
      for (const [field, mapping] of Object.entries(FILE_RELATIONSHIP_MAP)) {
        if (fileRelationships[field] && fileRelationships[field].length > 0) {
          const entityId = Array.isArray(fileRelationships[field])
            ? fileRelationships[field][0]?.id || fileRelationships[field][0]
            : fileRelationships[field]?.id || fileRelationships[field];

          return {
            context: field as keyof WebDAVFolderMapping,
            entityId: entityId,
            entityType: mapping.entityType,
            projectId: queryParams?.projectId,
            projectName: queryParams?.projectName,
            customerName: queryParams?.customerName,
            supplierName: queryParams?.supplierName,
          };
        }
      }
    }

    // No specific context detected, but may have project info
    // Try to get a best default context if we have entity information
    let bestContext = null;
    if (queryParams?.entityType || queryParams?.mimetype) {
      bestContext = this.webdavService.getBestDefaultContext(
        queryParams?.mimetype,
        queryParams?.entityType,
        queryParams?.entityId,
      );
    }

    return {
      context: bestContext,
      projectId: queryParams?.projectId,
      projectName: queryParams?.projectName,
      customerName: queryParams?.customerName,
      supplierName: queryParams?.supplierName,
    };
  }

  /**
   * Move uploaded file to WebDAV folder structure with project support
   */
  private async moveFileToWebDAV(
    file: File,
    fileContext: keyof WebDAVFolderMapping | null,
    entityId?: string,
    entityType?: string,
    projectId?: string,
    projectName?: string,
    customerName?: string,
    supplierName?: string,
  ): Promise<string> {
    if (!UPLOAD_CONFIG.useWebDAV) {
      this.logger.log('WebDAV disabled, keeping file in upload directory');
      return file.path;
    }

    try {
      // Generate WebDAV path with project support and customer/supplier names
      const webdavPath = this.webdavService.generateWebDAVFilePath(
        file.filename,
        fileContext,
        file.mimetype,
        entityId,
        entityType,
        projectId,
        projectName,
        customerName,
        supplierName,
      );

      this.logger.log(`Moving file to WebDAV: ${file.path} → ${webdavPath}`, {
        context: fileContext,
        entityId,
        entityType,
        projectId,
        projectName,
        customerName,
        supplierName,
      });

      // Move file to WebDAV
      await this.webdavService.moveToWebDAV(file.path, webdavPath);

      return webdavPath;
    } catch (error: any) {
      this.logger.error(`Failed to move file to WebDAV: ${error.message}`);
      // Return original path if WebDAV operation fails
      return file.path;
    }
  }

  /**
   * Create file from uploaded file with WebDAV integration
   */
  async createFromUpload(
    file: Express.Multer.File,
    include?: FileInclude,
    userId?: string,
    queryParams?: any,
  ): Promise<FileCreateResponse> {
    try {
      // Detect file context for WebDAV routing with project support
      const enrichedParams = { ...queryParams, mimetype: file.mimetype };
      const { context, entityId, entityType, projectId, projectName, customerName, supplierName } =
        this.detectFileContext(enrichedParams);

      this.logger.log(`Processing upload for file: ${file.originalname}`, {
        context,
        entityId,
        entityType,
        projectId,
        projectName,
        customerName,
        supplierName,
        useWebDAV: UPLOAD_CONFIG.useWebDAV,
      });

      // Create the file record first (without thumbnail generation in transaction)
      const fileData = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Create file data with initial path (will be updated after WebDAV move)
        const createData: FileCreateFormData = {
          filename: file.originalname, // Keep original name for display
          originalName: file.originalname,
          mimetype: file.mimetype,
          path: file.path, // Initial staging path
          size: file.size,
        };

        // Validate file data
        await this.validateFileUpload(createData, undefined, tx);

        // Create the file record
        const newFile = await this.fileRepository.createWithTransaction(tx, createData, {
          include,
        });

        // Log the file upload with essential fields
        const essentialFields = getEssentialFields(ENTITY_TYPE.FILE);
        const fileForLog = extractEssentialFields(newFile, essentialFields as (keyof File)[]);

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.FILE,
          entityId: newFile.id,
          action: CHANGE_ACTION.CREATE,
          entity: fileForLog,
          reason: `Novo arquivo enviado: "${file.originalname}"`,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return newFile;
      });

      // Move file to WebDAV after successful database creation
      const webdavPath = await this.moveFileToWebDAV(
        fileData,
        context,
        entityId,
        entityType,
        projectId,
        projectName,
        customerName,
        supplierName,
      );

      // Update file record with final WebDAV path if it changed
      let finalFileData = fileData;
      if (webdavPath !== fileData.path) {
        finalFileData = await this.fileRepository.update(
          fileData.id,
          {
            path: webdavPath,
          },
          { include },
        );

        this.logger.log(`Updated file path in database: ${fileData.path} → ${webdavPath}`);
      }

      // Queue thumbnail generation for supported file types
      // This is done OUTSIDE the transaction to avoid timeouts
      await this.queueThumbnailGeneration(finalFileData);

      return {
        success: true,
        message: `Arquivo "${file.originalname}" enviado com sucesso.`,
        data: this.transformFileWithUrl(finalFileData),
      };
    } catch (error: any) {
      // Clean up uploaded file if database operation failed
      if (file && file.path) {
        try {
          unlinkSync(file.path);
        } catch (cleanupError) {
          this.logger.warn(`Failed to cleanup uploaded file: ${file.path}`);
        }
      }

      this.logger.error('Erro ao processar arquivo enviado:', error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Erro ao processar arquivo enviado. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Create multiple files from uploaded files with WebDAV integration
   */
  async createMultipleFromUploads(
    files: Express.Multer.File[],
    include?: FileInclude,
    userId?: string,
    queryParams?: any,
  ): Promise<FileBatchCreateResponse<FileCreateFormData>> {
    const successfulUploads: File[] = [];
    const failedUploads: any[] = [];

    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        try {
          const result = await this.createFromUpload(file, include, userId, queryParams);
          if (result.data) {
            successfulUploads.push(result.data);
          }
        } catch (error: any) {
          failedUploads.push({
            index,
            error: error.message || 'Erro ao processar arquivo.',
            errorCode: error.name || 'UPLOAD_ERROR',
            data: {
              originalName: file.originalname,
              filename: file.filename,
              mimetype: file.mimetype,
              size: file.size,
            },
          });
        }
      }

      const successMessage =
        successfulUploads.length === 1
          ? '1 arquivo enviado com sucesso'
          : `${successfulUploads.length} arquivos enviados com sucesso`;
      const failureMessage = failedUploads.length > 0 ? `, ${failedUploads.length} falharam` : '';

      // Convert to expected format
      const batchOperationResult = {
        success: successfulUploads,
        failed: failedUploads.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: successfulUploads.length + failedUploads.length,
        totalSuccess: successfulUploads.length,
        totalFailed: failedUploads.length,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      // Clean up all uploaded files if batch operation failed
      for (const file of files) {
        if (file && file.path) {
          try {
            unlinkSync(file.path);
          } catch (cleanupError) {
            this.logger.warn(`Failed to cleanup uploaded file: ${file.path}`);
          }
        }
      }

      this.logger.error('Erro no envio em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao processar arquivos enviados. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Enhanced file validation for uploads
   */
  private async validateFileUpload(
    data: Partial<FileCreateFormData | FileUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Original validation logic...
    if (data.filename) {
      if (data.filename.length < 1 || data.filename.length > 255) {
        throw new BadRequestException('Nome do arquivo deve ter entre 1 e 255 caracteres.');
      }

      const invalidChars = /[<>:"|?*\x00-\x1f]/;
      if (invalidChars.test(data.filename)) {
        throw new BadRequestException('Nome do arquivo contém caracteres inválidos.');
      }

      if (data.filename.includes('../') || data.filename.includes('..\\')) {
        throw new BadRequestException('Nome do arquivo contém tentativas de directory traversal.');
      }
    }

    // Enhanced MIME type validation
    if (data.mimetype) {
      if (data.mimetype.length < 1 || data.mimetype.length > 255) {
        throw new BadRequestException('Tipo MIME deve ter entre 1 e 255 caracteres.');
      }

      const mimetypeRegex =
        /^[a-zA-Z0-9][a-zA-Z0-9!#$&^_+-]{0,126}\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_+-]{0,126}$/;
      if (!mimetypeRegex.test(data.mimetype)) {
        throw new BadRequestException('Tipo MIME inválido.');
      }
    }

    // Path validation for uploads
    if (data.path) {
      if (!existsSync(data.path)) {
        throw new BadRequestException('Arquivo físico não encontrado no servidor.');
      }

      const stats = statSync(data.path);
      if (!stats.isFile()) {
        throw new BadRequestException('Caminho não aponta para um arquivo válido.');
      }

      // Validate file size matches
      if (data.size && stats.size !== data.size) {
        throw new BadRequestException('Tamanho do arquivo não confere com o arquivo físico.');
      }
    }

    // Enhanced size validation
    if (data.size !== undefined) {
      if (!validateFileSize(data.size)) {
        throw new BadRequestException('Tamanho do arquivo inválido ou excede o limite permitido.');
      }
    }
  }

  /**
   * Regenerate thumbnail for a file
   */
  async regenerateThumbnail(id: string, userId?: string): Promise<FileUpdateResponse> {
    try {
      const file = await this.fileRepository.findById(id);

      if (!file) {
        throw new NotFoundException('Arquivo não encontrado.');
      }

      // Check if file type supports thumbnails
      const supportedTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/tiff',
        'application/pdf',
        'application/postscript',
        'application/x-eps',
        'application/eps',
        'image/eps',
        'image/x-eps',
      ];

      if (!supportedTypes.some(type => file.mimetype.toLowerCase() === type.toLowerCase())) {
        throw new BadRequestException(
          'Thumbnail só pode ser gerado para imagens, PDFs e arquivos EPS.',
        );
      }

      // Queue thumbnail regeneration with high priority
      await this.thumbnailQueueService.addThumbnailJob({
        fileId: file.id,
        filePath: file.path,
        mimetype: file.mimetype,
        priority: 'high', // High priority for manual regeneration
        options: {
          width: 300,
          height: 300,
          quality: 85,
          format: 'webp',
          fit: 'contain',
        },
      });

      // Log the action - temporarily disabled due to enum issue
      // TODO: Re-enable after FILE is added to ChangeLogEntityType enum
      /*
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.FILE,
        entityId: file.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'thumbnailUrl',
        oldValue: file.thumbnailUrl,
        newValue: `${process.env.API_BASE_URL || 'http://localhost:3030'}/api/files/thumbnail/${file.id}`,
        reason: 'Thumbnail regenerado',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: file.id,
        userId: userId !== undefined ? userId : null,
      });
      */

      return {
        success: true,
        message: 'Thumbnail regenerado com sucesso.',
        data: file,
      };
    } catch (error: any) {
      this.logger.error(`Erro ao regenerar thumbnail para arquivo ${id}:`, error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao regenerar thumbnail.');
    }
  }
}
