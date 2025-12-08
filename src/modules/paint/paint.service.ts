// paint.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PaintRepository } from './repositories/paint/paint.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { WebDAVService } from '@modules/common/file/services/webdav.service';
import { promises as fs } from 'fs';
import type {
  PaintBatchCreateResponse,
  PaintBatchDeleteResponse,
  PaintBatchUpdateResponse,
  PaintCreateResponse,
  PaintDeleteResponse,
  PaintGetManyResponse,
  PaintGetUniqueResponse,
  PaintUpdateResponse,
} from '../../types';
import { UpdateData } from '../../types';
import type {
  PaintCreateFormData,
  PaintUpdateFormData,
  PaintGetManyFormData,
  PaintBatchCreateFormData,
  PaintBatchUpdateFormData,
  PaintBatchDeleteFormData,
  PaintInclude,
} from '../../schemas/paint';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../constants/enums';
import { ItemRepository } from '@modules/inventory/item/repositories/item/item.repository';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
  extractEssentialFields,
  getEssentialFields,
  translateFieldName,
} from '@modules/common/changelog/utils/changelog-helpers';
import { hasValueChanged } from '@modules/common/changelog/utils/serialize-changelog-value';
import { findSimilarColors } from '../../utils/paint';

@Injectable()
export class PaintService {
  private readonly logger = new Logger(PaintService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paintRepository: PaintRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly itemRepository: ItemRepository,
    private readonly webdavService: WebDAVService,
  ) {}

  /**
   * Upload colorPreview file to WebDAV and return the file path
   * (URL is generated at retrieval time like task artworks - ensures correct URL in all environments)
   */
  private async uploadColorPreviewFile(
    file: Express.Multer.File,
    paintName: string,
  ): Promise<string> {
    try {
      // Generate WebDAV path for paint color preview
      const webdavPath = this.webdavService.generateWebDAVFilePath(
        file.originalname || `${paintName}.webp`,
        'paintColor',
        file.mimetype,
      );

      // Move file to WebDAV
      await this.webdavService.moveToWebDAV(file.path, webdavPath);

      // Return the path (not URL) - URL will be generated at retrieval time
      // This follows the same pattern as task artworks which work correctly
      this.logger.log(`Color preview uploaded to WebDAV path: ${webdavPath}`);
      return webdavPath;
    } catch (error: any) {
      this.logger.error('Failed to upload color preview file:', error);
      // Clean up temp file on error
      try {
        await fs.unlink(file.path);
      } catch (unlinkError) {
        this.logger.warn(`Failed to clean up temp file: ${file.path}`);
      }
      throw new InternalServerErrorException('Erro ao fazer upload da imagem de preview');
    }
  }

  /**
   * Validar entidade completa
   */
  private async paintValidation(
    data: Partial<PaintCreateFormData | PaintUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validate paint type exists
    if (data.paintTypeId) {
      const paintType = await transaction.paintType.findUnique({
        where: { id: data.paintTypeId },
        include: {
          componentItems: true,
        },
      });
      if (!paintType) {
        throw new BadRequestException('Tipo de tinta não encontrado');
      }
    }

    // Validate ground paints exist if provided
    if (data.groundIds && data.groundIds.length > 0) {
      const groundPaints = await transaction.paint.findMany({
        where: { id: { in: data.groundIds } },
        select: { id: true },
      });

      if (groundPaints.length !== data.groundIds.length) {
        throw new BadRequestException('Uma ou mais tintas de fundo não foram encontradas');
      }

      // Prevent self-reference
      if (existingId && data.groundIds.includes(existingId)) {
        throw new BadRequestException('Uma tinta não pode ser seu próprio fundo');
      }
    }
  }

  /**
   * Get available components for a paint based on brand and paint type
   * Returns intersection of components from both paint type and paint brand
   */
  async getAvailableComponents(paintBrandIdOrName: string, paintTypeId: string): Promise<any[]> {
    try {
      this.logger.log(
        `=== getAvailableComponents called with paintBrandIdOrName: "${paintBrandIdOrName}", paintTypeId: "${paintTypeId}"`,
      );

      // Get paint type with component items
      const paintType = await this.prisma.paintType.findUnique({
        where: { id: paintTypeId },
        include: {
          componentItems: {
            include: {
              brand: true,
              category: true,
              measures: true,
            },
          },
        },
      });

      if (!paintType) {
        this.logger.error(`Paint type with ID "${paintTypeId}" not found`);
        throw new NotFoundException('Tipo de tinta não encontrado');
      }

      this.logger.log(
        `Paint type "${paintType.name}" found with ${paintType.componentItems.length} components`,
      );

      // Try to find paint brand by ID first, then by name for backward compatibility
      let paintBrand = await this.prisma.paintBrand.findUnique({
        where: { id: paintBrandIdOrName },
        include: {
          componentItems: {
            include: {
              brand: true,
              category: true,
              measures: true,
            },
          },
        },
      });

      // If not found by ID, try by name
      if (!paintBrand) {
        this.logger.log(`Paint brand not found by ID, trying by name: "${paintBrandIdOrName}"`);
        paintBrand = await this.prisma.paintBrand.findFirst({
          where: { name: paintBrandIdOrName },
          include: {
            componentItems: {
              include: {
                brand: true,
                category: true,
                measures: true,
              },
            },
          },
        });
      }

      if (!paintBrand) {
        this.logger.error(`Paint brand with ID or name "${paintBrandIdOrName}" not found`);
        throw new NotFoundException(`Marca de tinta "${paintBrandIdOrName}" não encontrada`);
      }

      this.logger.log(
        `Paint brand "${paintBrand.name}" (ID: ${paintBrand.id}) found with ${paintBrand.componentItems.length} components`,
      );

      // Get intersection of components (items that exist in both paint type AND paint brand)
      const paintTypeComponentIds = new Set(paintType.componentItems.map(item => item.id));
      const availableComponents = paintBrand.componentItems.filter(item =>
        paintTypeComponentIds.has(item.id),
      );

      this.logger.log(
        `Found ${availableComponents.length} common components between paint type "${paintType.name}" (${paintType.componentItems.length} total) and paint brand "${paintBrand.name}" (${paintBrand.componentItems.length} total)`,
      );

      if (availableComponents.length === 0) {
        this.logger.warn(
          `NO INTERSECTION! Paint type component IDs: [${Array.from(paintTypeComponentIds).join(', ')}]`,
        );
        this.logger.warn(
          `Paint brand component IDs: [${paintBrand.componentItems.map(i => i.id).join(', ')}]`,
        );
      }

      return availableComponents;
    } catch (error: any) {
      this.logger.error('Erro ao buscar componentes disponíveis:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar componentes disponíveis. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Validate if a component is compatible with paint brand and type
   */
  async validateComponentCompatibility(
    componentId: string,
    paintBrandId: string,
    paintTypeId: string,
  ): Promise<boolean> {
    try {
      // Check if component exists in paint type
      const paintType = await this.prisma.paintType.findUnique({
        where: { id: paintTypeId },
        include: {
          componentItems: {
            where: { id: componentId },
          },
        },
      });

      if (!paintType || paintType.componentItems.length === 0) {
        this.logger.warn(`Component ${componentId} not found in paint type ${paintTypeId}`);
        return false;
      }

      // Check if component also exists in paint brand
      const paintBrand = await this.prisma.paintBrand.findUnique({
        where: { id: paintBrandId },
        include: {
          componentItems: {
            where: { id: componentId },
          },
        },
      });

      if (!paintBrand || paintBrand.componentItems.length === 0) {
        this.logger.warn(`Component ${componentId} not found in paint brand ${paintBrandId}`);
        return false;
      }

      // Component must exist in BOTH paint type AND paint brand
      return true;
    } catch (error: any) {
      this.logger.error('Erro ao validar compatibilidade do componente:', error);
      return false;
    }
  }

  /**
   * Buscar muitas tintas com filtros
   */
  async findMany(query: PaintGetManyFormData): Promise<PaintGetManyResponse> {
    try {
      // Debug logging
      this.logger.log('Paint findMany query received:', JSON.stringify(query, null, 2));

      // Extract color similarity parameters before processing
      const similarColor = (query as any).similarColor as string | undefined;
      const similarColorThreshold = (query as any).similarColorThreshold as number | undefined;
      const hasColorSimilarity = similarColor && typeof similarColor === 'string';

      // Check if we have a searchingFor parameter that needs special handling
      const searchingFor = (query as any).searchingFor;
      const hasSearchingFor = searchingFor && typeof searchingFor === 'string';

      if (hasSearchingFor) {
        this.logger.log(`Processing search for: "${searchingFor}"`);

        // Get paints that match tag search using raw SQL
        const tagMatchingIds = await this.findPaintIdsByTagSearch(searchingFor);

        // Get paints that match task search (through generalPaintings and logoTasks)
        const taskMatchingIds = await this.findPaintIdsByTaskSearch(searchingFor);

        // Get paints that match customer search (through tasks)
        const customerMatchingIds = await this.findPaintIdsByCustomerSearch(searchingFor);

        // Create search conditions for direct paint fields
        const searchConditions: any[] = [
          { name: { contains: searchingFor, mode: 'insensitive' } },
          { code: { contains: searchingFor, mode: 'insensitive' } },
          { hex: { contains: searchingFor, mode: 'insensitive' } },
        ];

        // Collect all matching IDs from different search sources
        const allMatchingIds = new Set<string>();

        if (tagMatchingIds.length > 0) {
          tagMatchingIds.forEach(id => allMatchingIds.add(id));
        }

        if (taskMatchingIds.length > 0) {
          taskMatchingIds.forEach(id => allMatchingIds.add(id));
        }

        if (customerMatchingIds.length > 0) {
          customerMatchingIds.forEach(id => allMatchingIds.add(id));
        }

        // Add ID-based search if we have matching IDs
        if (allMatchingIds.size > 0) {
          searchConditions.push({ id: { in: Array.from(allMatchingIds) } });
        }

        // Build the modified query with search conditions
        const modifiedQuery = { ...query };
        delete (modifiedQuery as any).searchingFor; // Remove searchingFor before passing to repository
        delete (modifiedQuery as any).similarColor; // Remove color similarity params before passing to repository
        delete (modifiedQuery as any).similarColorThreshold;

        // When color similarity is active, we need to fetch ALL paints to find the most similar ones
        // The sorting will be done by the similarity algorithm, not by orderBy
        if (hasColorSimilarity) {
          delete (modifiedQuery as any).orderBy; // Remove orderBy - similarity will determine order
          (modifiedQuery as any).limit = 10000; // Fetch all paints to find similar colors across entire catalog
        }

        // Apply search conditions
        if (!modifiedQuery.where) {
          modifiedQuery.where = {};
        }

        // If there are existing conditions, combine them with AND
        if (Object.keys(modifiedQuery.where).length > 0) {
          modifiedQuery.where = {
            AND: [modifiedQuery.where, { OR: searchConditions }],
          };
        } else {
          // No existing conditions, just use OR for search
          modifiedQuery.where = {
            OR: searchConditions,
          };
        }

        this.logger.log('Modified query for search:', JSON.stringify(modifiedQuery, null, 2));

        let result = await this.paintRepository.findMany(modifiedQuery);
        this.logger.log(`Search results: ${result.data.length} paints found`);

        // Apply color similarity filtering if requested
        if (hasColorSimilarity) {
          this.logger.log(
            `Applying color similarity filter: color="${similarColor}", threshold=${similarColorThreshold || 15}`,
          );
          const similarResult = findSimilarColors(
            result.data as any[],
            similarColor,
            similarColorThreshold || 15,
          );
          result = {
            data: similarResult.data as any[],
            meta: {
              ...result.meta,
              totalRecords: similarResult.total,
              totalPages: Math.ceil(similarResult.total / (result.meta?.take || 20)),
            },
          };
          this.logger.log(`Color similarity results: ${similarResult.total} paints found`);
        }

        return {
          success: true,
          data: result.data,
          meta: result.meta,
          message: 'Tintas carregadas com sucesso.',
        };
      }

      // Normal flow without searching
      const modifiedQuery = { ...query };
      delete (modifiedQuery as any).similarColor; // Remove color similarity params before passing to repository
      delete (modifiedQuery as any).similarColorThreshold;

      // When color similarity is active, we need to fetch ALL paints to find the most similar ones
      // The sorting will be done by the similarity algorithm, not by orderBy
      if (hasColorSimilarity) {
        delete (modifiedQuery as any).orderBy; // Remove orderBy - similarity will determine order
        (modifiedQuery as any).limit = 10000; // Fetch all paints to find similar colors across entire catalog
      }

      let result = await this.paintRepository.findMany(modifiedQuery);

      // Apply color similarity filtering if requested
      if (hasColorSimilarity) {
        this.logger.log(
          `Applying color similarity filter: color="${similarColor}", threshold=${similarColorThreshold || 15}`,
        );
        const similarResult = findSimilarColors(
          result.data as any[],
          similarColor,
          similarColorThreshold || 15,
        );
        result = {
          data: similarResult.data as any[],
          meta: {
            ...result.meta,
            totalRecords: similarResult.total,
            totalPages: Math.ceil(similarResult.total / (result.meta?.take || 20)),
          },
        };
        this.logger.log(`Color similarity results: ${similarResult.total} paints found`);
      }

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Tintas carregadas com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar tintas:', error);
      throw new InternalServerErrorException('Erro ao buscar tintas. Por favor, tente novamente.');
    }
  }

  /**
   * Find paint IDs that have tags matching the search term
   */
  private async findPaintIdsByTagSearch(searchTerm: string): Promise<string[]> {
    try {
      const searchPattern = `%${searchTerm}%`;
      this.logger.log(`Tag search: searching for "${searchTerm}" with pattern "${searchPattern}"`);

      const result = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT p.id
        FROM "Paint" p,
        LATERAL unnest(p.tags) AS tag
        WHERE LOWER(tag) LIKE LOWER(${searchPattern})
      `;

      const ids = result.map(row => row.id);
      this.logger.log(`Tag search: found ${ids.length} paints matching "${searchTerm}"`);

      return ids;
    } catch (error) {
      this.logger.error('Erro ao buscar tintas por tag:', error);
      return [];
    }
  }

  /**
   * Find paint IDs that are used in tasks matching the search term
   */
  private async findPaintIdsByTaskSearch(searchTerm: string): Promise<string[]> {
    try {
      const searchPattern = `%${searchTerm}%`;
      this.logger.log(`Task search: searching for "${searchTerm}" with pattern "${searchPattern}"`);

      const result = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT p.id
        FROM "Paint" p
        LEFT JOIN "Task" t1 ON t1."paintId" = p.id
        LEFT JOIN "Truck" tr1 ON tr1."taskId" = t1.id
        LEFT JOIN "_TASK_LOGO_PAINT" tlp ON tlp."A" = p.id
        LEFT JOIN "Task" t2 ON t2.id = tlp."B"
        LEFT JOIN "Truck" tr2 ON tr2."taskId" = t2.id
        WHERE LOWER(t1.name) LIKE LOWER(${searchPattern})
           OR LOWER(t1."serialNumber") LIKE LOWER(${searchPattern})
           OR LOWER(tr1.plate) LIKE LOWER(${searchPattern})
           OR LOWER(t2.name) LIKE LOWER(${searchPattern})
           OR LOWER(t2."serialNumber") LIKE LOWER(${searchPattern})
           OR LOWER(tr2.plate) LIKE LOWER(${searchPattern})
      `;

      const ids = result.map(row => row.id);
      this.logger.log(`Task search: found ${ids.length} paints matching "${searchTerm}"`);

      return ids;
    } catch (error) {
      this.logger.error('Erro ao buscar tintas por tarefas:', error);
      return [];
    }
  }

  /**
   * Find paint IDs that are used in tasks belonging to customers matching the search term
   */
  private async findPaintIdsByCustomerSearch(searchTerm: string): Promise<string[]> {
    try {
      const searchPattern = `%${searchTerm}%`;
      this.logger.log(
        `Customer search: searching for "${searchTerm}" with pattern "${searchPattern}"`,
      );

      const result = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT p.id
        FROM "Paint" p
        LEFT JOIN "Task" t1 ON t1."paintId" = p.id
        LEFT JOIN "Customer" c1 ON c1.id = t1."customerId"
        LEFT JOIN "_TASK_LOGO_PAINT" tlp ON tlp."A" = p.id
        LEFT JOIN "Task" t2 ON t2.id = tlp."B"
        LEFT JOIN "Customer" c2 ON c2.id = t2."customerId"
        WHERE LOWER(c1."fantasyName") LIKE LOWER(${searchPattern})
           OR LOWER(c1."corporateName") LIKE LOWER(${searchPattern})
           OR LOWER(c1.cnpj) LIKE LOWER(${searchPattern})
           OR LOWER(c1.cpf) LIKE LOWER(${searchPattern})
           OR LOWER(c2."fantasyName") LIKE LOWER(${searchPattern})
           OR LOWER(c2."corporateName") LIKE LOWER(${searchPattern})
           OR LOWER(c2.cnpj) LIKE LOWER(${searchPattern})
           OR LOWER(c2.cpf) LIKE LOWER(${searchPattern})
      `;

      const ids = result.map(row => row.id);
      this.logger.log(`Customer search: found ${ids.length} paints matching "${searchTerm}"`);

      return ids;
    } catch (error) {
      this.logger.error('Erro ao buscar tintas por clientes:', error);
      return [];
    }
  }

  /**
   * Buscar uma tinta por ID
   */
  async findById(id: string, include?: PaintInclude): Promise<PaintGetUniqueResponse> {
    try {
      const paint = await this.paintRepository.findById(id, { include });

      if (!paint) {
        throw new NotFoundException('Tinta não encontrada.');
      }

      return { success: true, data: paint, message: 'Tinta carregada com sucesso.' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar tinta por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar tinta. Por favor, tente novamente.');
    }
  }

  /**
   * Criar nova tinta
   */
  async create(
    data: PaintCreateFormData,
    include?: PaintInclude,
    userId?: string,
    colorPreviewFile?: Express.Multer.File,
  ): Promise<PaintCreateResponse> {
    try {
      // Handle colorPreview file upload before transaction
      let colorPreviewUrl: string | null = null;
      if (colorPreviewFile) {
        colorPreviewUrl = await this.uploadColorPreviewFile(colorPreviewFile, data.name);
      }

      const paint = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade completa
        await this.paintValidation(data, undefined, tx);

        // Normalize tags if provided
        const createData = {
          ...data,
          tags: data.tags ? data.tags.map(tag => tag.trim().toLowerCase()) : [],
          // Use uploaded file URL if available, otherwise use provided colorPreview (for backward compat)
          colorPreview: colorPreviewUrl || data.colorPreview || null,
        };

        // Criar a tinta
        const newPaint = await this.paintRepository.createWithTransaction(tx, createData as any, {
          include,
        });

        // Registrar no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT,
          entityId: newPaint.id,
          action: CHANGE_ACTION.CREATE,
          entity: extractEssentialFields(
            newPaint,
            getEssentialFields(ENTITY_TYPE.PAINT) as (keyof typeof newPaint)[],
          ),
          reason: 'Tinta criada',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_CREATE,
          transaction: tx,
        });

        // Log ground paint relationships if any
        if (data.groundIds && data.groundIds.length > 0) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT,
            entityId: newPaint.id,
            action: CHANGE_ACTION.CREATE,
            field: 'groundPaints',
            oldValue: null,
            newValue: data.groundIds,
            reason: `${data.groundIds.length} tinta(s) de fundo associada(s)`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_CREATE,
            triggeredById: newPaint.id,
            userId: userId || null,
            transaction: tx,
          });

          // Log impact on ground paints
          for (const groundId of data.groundIds) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.PAINT,
              entityId: groundId,
              action: CHANGE_ACTION.UPDATE,
              field: 'groundPaintFor',
              reason: `Tinta ${newPaint.name} adicionada como tinta que usa este fundo`,
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_CREATE,
              triggeredById: newPaint.id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        // Log tags if any
        if (createData.tags && createData.tags.length > 0) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT,
            entityId: newPaint.id,
            action: CHANGE_ACTION.CREATE,
            field: 'tags',
            oldValue: null,
            newValue: createData.tags,
            reason: `${createData.tags.length} tag(s) adicionada(s)`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_CREATE,
            triggeredById: newPaint.id,
            userId: userId || null,
            transaction: tx,
          });
        }

        return newPaint;
      });

      return {
        success: true,
        message: 'Tinta criada com sucesso.',
        data: paint,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar tinta:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar tinta. Por favor, tente novamente.');
    }
  }

  /**
   * Atualizar tinta
   */
  async update(
    id: string,
    data: PaintUpdateFormData,
    include?: PaintInclude,
    userId?: string,
    colorPreviewFile?: Express.Multer.File,
  ): Promise<PaintUpdateResponse> {
    try {
      // Handle colorPreview file upload before transaction
      let colorPreviewUrl: string | null | undefined = undefined;
      if (colorPreviewFile) {
        // Get paint name for file naming
        const existingPaintForName = await this.paintRepository.findById(id);
        const paintName = existingPaintForName?.name || 'preview';
        colorPreviewUrl = await this.uploadColorPreviewFile(colorPreviewFile, paintName);
      }

      const updatedPaint = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar tinta existente com relações para comparação
        const existingPaint = await this.paintRepository.findByIdWithTransaction(tx, id, {
          include: {
            paintGrounds: {
              include: {
                groundPaint: true,
              },
            },
            paintType: true,
          },
        });

        if (!existingPaint) {
          throw new NotFoundException('Tinta não encontrada. Verifique se o ID está correto.');
        }

        // Validar restrições únicas
        await this.paintValidation(data, id, tx);

        // Prepare update data
        const updateData: any = { ...data };

        // Update colorPreview with uploaded file URL if available
        if (colorPreviewUrl !== undefined) {
          updateData.colorPreview = colorPreviewUrl;
        }

        // Normalize tags if provided
        if (data.tags) {
          updateData.tags = data.tags.map(tag => tag.trim().toLowerCase());
        }

        // Atualizar a tinta
        const updatedPaint = await this.paintRepository.updateWithTransaction(tx, id, updateData, {
          include,
        });

        // Enhanced field tracking - include all paint fields
        const fieldsToTrack = [
          'name',
          'hex',
          'finish',
          'brand',
          'manufacturer',
          'paintTypeId',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT,
          entityId: id,
          oldEntity: existingPaint,
          newEntity: updatedPaint,
          fieldsToTrack,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_UPDATE,
          transaction: tx,
        });

        // Track tags array changes
        if (data.tags !== undefined) {
          const oldTags = existingPaint.tags || [];
          const newTags = updateData.tags || [];

          if (hasValueChanged(oldTags, newTags)) {
            // Find added and removed tags
            const addedTags = newTags.filter((tag: string) => !oldTags.includes(tag));
            const removedTags = oldTags.filter((tag: string) => !newTags.includes(tag));

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.PAINT,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'tags',
              oldValue: oldTags,
              newValue: newTags,
              reason: this.buildTagChangeReason(addedTags, removedTags),
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_UPDATE,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        // Track ground paint relationship changes
        if (data.groundIds !== undefined) {
          const oldGroundIds = existingPaint.paintGrounds?.map(pg => pg.groundPaintId) || [];
          const newGroundIds = data.groundIds || [];

          if (hasValueChanged(oldGroundIds.sort(), newGroundIds.sort())) {
            const addedGroundIds = newGroundIds.filter(id => !oldGroundIds.includes(id));
            const removedGroundIds = oldGroundIds.filter(id => !newGroundIds.includes(id));

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.PAINT,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'groundPaints',
              oldValue: oldGroundIds,
              newValue: newGroundIds,
              reason: this.buildGroundPaintChangeReason(addedGroundIds, removedGroundIds),
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_UPDATE,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });

            // Log impact on added ground paints
            for (const groundId of addedGroundIds) {
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.PAINT,
                entityId: groundId,
                action: CHANGE_ACTION.UPDATE,
                field: 'groundPaintFor',
                reason: `Tinta ${updatedPaint.name} adicionada como tinta que usa este fundo`,
                triggeredBy: CHANGE_TRIGGERED_BY.PAINT_UPDATE,
                triggeredById: id,
                userId: userId || null,
                transaction: tx,
              });
            }

            // Log impact on removed ground paints
            for (const groundId of removedGroundIds) {
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.PAINT,
                entityId: groundId,
                action: CHANGE_ACTION.UPDATE,
                field: 'groundPaintFor',
                reason: `Tinta ${existingPaint.name} removida das tintas que usam este fundo`,
                triggeredBy: CHANGE_TRIGGERED_BY.PAINT_UPDATE,
                triggeredById: id,
                userId: userId || null,
                transaction: tx,
              });
            }
          }
        }

        // Track paint type change impact
        if (data.paintTypeId && data.paintTypeId !== existingPaint.paintTypeId) {
          // Log removal from old paint type
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_TYPE,
            entityId: existingPaint.paintTypeId,
            action: CHANGE_ACTION.UPDATE,
            field: 'paints',
            reason: `Tinta ${existingPaint.name} removida deste tipo`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_UPDATE,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });

          // Log addition to new paint type
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_TYPE,
            entityId: data.paintTypeId,
            action: CHANGE_ACTION.UPDATE,
            field: 'paints',
            reason: `Tinta ${updatedPaint.name} adicionada a este tipo`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_UPDATE,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
        }

        return updatedPaint;
      });

      return {
        success: true,
        message: 'Tinta atualizada com sucesso.',
        data: updatedPaint,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar tinta:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar tinta. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Build reason message for tag changes
   */
  private buildTagChangeReason(addedTags: string[], removedTags: string[]): string {
    const parts: string[] = [];

    if (addedTags.length > 0) {
      parts.push(`${addedTags.length} tag(s) adicionada(s): ${addedTags.join(', ')}`);
    }

    if (removedTags.length > 0) {
      parts.push(`${removedTags.length} tag(s) removida(s): ${removedTags.join(', ')}`);
    }

    return parts.join('; ') || 'Tags atualizadas';
  }

  /**
   * Build reason message for ground paint changes
   */
  private buildGroundPaintChangeReason(addedIds: string[], removedIds: string[]): string {
    const parts: string[] = [];

    if (addedIds.length > 0) {
      parts.push(`${addedIds.length} tinta(s) de fundo adicionada(s)`);
    }

    if (removedIds.length > 0) {
      parts.push(`${removedIds.length} tinta(s) de fundo removida(s)`);
    }

    return parts.join('; ') || 'Tintas de fundo atualizadas';
  }

  /**
   * Excluir tinta
   */
  async delete(id: string, userId?: string): Promise<PaintDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const paint = await this.paintRepository.findByIdWithTransaction(tx, id);

        if (!paint) {
          throw new NotFoundException('Tinta não encontrada. Verifique se o ID está correto.');
        }

        // Registrar exclusão
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: extractEssentialFields(
            paint,
            getEssentialFields(ENTITY_TYPE.PAINT) as (keyof typeof paint)[],
          ),
          reason: 'Tinta excluída',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_DELETE,
          transaction: tx,
        });

        await this.paintRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Tinta excluída com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir tinta:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao excluir tinta. Por favor, tente novamente.');
    }
  }

  /**
   * Criar múltiplas tintas
   */
  async batchCreate(
    data: PaintBatchCreateFormData,
    include?: PaintInclude,
    userId?: string,
  ): Promise<PaintBatchCreateResponse<PaintCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const result = await this.paintRepository.createManyWithTransaction(tx, data.paints, {
          include,
        });

        // Registrar criações bem-sucedidas
        for (const paint of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.PAINT,
            entityId: paint.id,
            action: CHANGE_ACTION.CREATE,
            entity: extractEssentialFields(
              paint,
              getEssentialFields(ENTITY_TYPE.PAINT) as (keyof typeof paint)[],
            ),
            reason: 'Tinta criada em lote',
            userId: userId || null,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_BATCH_CREATE,
            transaction: tx,
          });
        }

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 tinta criada com sucesso'
          : `${result.totalCreated} tintas criadas com sucesso`;
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
        'Erro ao criar tintas em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplas tintas
   */
  async batchUpdate(
    data: PaintBatchUpdateFormData,
    include?: PaintInclude,
    userId?: string,
  ): Promise<PaintBatchUpdateResponse<PaintUpdateFormData>> {
    try {
      const updates: UpdateData<PaintUpdateFormData>[] = data.paints.map(paint => ({
        id: paint.id,
        data: paint.data,
      }));

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const result = await this.paintRepository.updateManyWithTransaction(tx, updates, {
          include,
        });

        // Registrar atualizações bem-sucedidas
        const fieldsToTrack = [
          'name',
          'hex',
          'finish',
          'brand',
          'manufacturer',
          'paintTypeId',
        ];

        // Get existing paints for comparison with relationships
        const paintIds = updates.map(u => u.id);
        const existingPaints = await tx.paint.findMany({
          where: { id: { in: paintIds } },
          select: {
            id: true,
            name: true,
            hex: true,
            finish: true,
            paintBrandId: true,
            manufacturer: true,
            tags: true,
            paintTypeId: true,
            createdAt: true,
            updatedAt: true,
            paintGrounds: true,
            paintType: true,
          },
        });
        const existingPaintsMap = new Map(existingPaints.map(p => [p.id, p]));

        for (const paint of result.success) {
          const existingPaint = existingPaintsMap.get(paint.id);
          const updateData = updates.find(u => u.id === paint.id)?.data;

          if (existingPaint && updateData) {
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.PAINT,
              entityId: paint.id,
              oldEntity: existingPaint,
              newEntity: paint,
              fieldsToTrack,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_BATCH_UPDATE,
              transaction: tx,
            });

            // Track tags changes in batch
            if (updateData.tags !== undefined) {
              const oldTags = existingPaint.tags || [];
              const newTags = paint.tags || [];

              if (hasValueChanged(oldTags, newTags)) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.PAINT,
                  entityId: paint.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'tags',
                  oldValue: oldTags,
                  newValue: newTags,
                  reason: 'Tags atualizadas em lote',
                  triggeredBy: CHANGE_TRIGGERED_BY.PAINT_BATCH_UPDATE,
                  triggeredById: paint.id,
                  userId: userId || null,
                  transaction: tx,
                });
              }
            }
          }
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 tinta atualizada com sucesso'
          : `${result.totalUpdated} tintas atualizadas com sucesso`;
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
        'Erro ao atualizar tintas em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: PaintBatchDeleteFormData,
    userId?: string,
  ): Promise<PaintBatchDeleteResponse> {
    const result = await this.prisma.$transaction(async transaction => {
      const batchResult = await this.paintRepository.deleteManyWithTransaction(
        transaction,
        data.paintIds,
      );

      // Log deletion for each successful paint
      for (const deleted of batchResult.success) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT,
          entityId: deleted.id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: extractEssentialFields(
            deleted,
            getEssentialFields(ENTITY_TYPE.PAINT) as (keyof typeof deleted)[],
          ),
          reason: 'Tinta deletada em lote',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_BATCH_DELETE,
          transaction,
        });
      }

      return batchResult;
    });

    const successMessage =
      result.totalDeleted === 1
        ? '1 tinta deletada com sucesso'
        : `${result.totalDeleted} tintas deletadas com sucesso`;
    const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

    // Convert BatchDeleteResult to BatchOperationResult format
    const batchOperationResult = {
      success: result.success,
      failed: result.failed.map((error, index) => ({
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
  }

  async batchUpdateColorOrder(
    data: { updates: Array<{ id: string; colorOrder: number }> },
    userId?: string,
  ) {
    try {
      const result = await this.prisma.$transaction(async tx => {
        const updates = await Promise.allSettled(
          data.updates.map(async update => {
            const paint = await tx.paint.update({
              where: { id: update.id },
              data: { colorOrder: update.colorOrder },
            });

            // Log the change
            if (userId) {
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.PAINT,
                entityId: update.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'colorOrder',
                newValue: update.colorOrder,
                userId,
                reason: 'Atualização de ordem de cores',
                triggeredBy: CHANGE_TRIGGERED_BY.PAINT_BATCH_UPDATE,
                triggeredById: null,
              });
            }

            return paint;
          }),
        );

        const successful = updates.filter(r => r.status === 'fulfilled').map((r: any) => r.value);
        const failed = updates
          .filter(r => r.status === 'rejected')
          .map((r: any, index) => ({
            index,
            error: r.reason.message || 'Erro desconhecido',
          }));

        return {
          success: successful,
          failed,
          totalSuccess: successful.length,
          totalFailed: failed.length,
        };
      });

      const message =
        result.totalFailed > 0
          ? `${result.totalSuccess} tintas atualizadas, ${result.totalFailed} falharam`
          : `${result.totalSuccess} tintas atualizadas com sucesso`;

      return {
        success: true,
        message,
        data: result,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar ordem de cores em lote', error);
      throw new Error('Erro ao atualizar ordem de cores');
    }
  }

  /**
   * Merge multiple paints into a target paint
   */
  async merge(
    data: {
      sourcePaintIds: string[];
      targetPaintId: string;
      conflictResolutions?: Record<string, any>;
    },
    include?: PaintInclude,
    userId?: string,
  ) {
    return await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // 1. Fetch target paint and source paints
      const targetPaint = await tx.paint.findUnique({
        where: { id: data.targetPaintId },
        include: {
          formulas: {
            include: {
              components: true,
              paintProduction: true,
            },
          },
          paintGrounds: true,
          groundPaintFor: true,
          relatedPaints: true,
          relatedTo: true,
        },
      });

      if (!targetPaint) {
        throw new NotFoundException(`Tinta alvo com ID ${data.targetPaintId} não encontrada`);
      }

      const sourcePaints = await tx.paint.findMany({
        where: { id: { in: data.sourcePaintIds } },
        include: {
          formulas: {
            include: {
              components: true,
              paintProduction: true,
            },
          },
          paintGrounds: true,
          groundPaintFor: true,
          relatedPaints: true,
          relatedTo: true,
          generalPaintings: true,
          logoTasks: true,
        },
      });

      if (sourcePaints.length !== data.sourcePaintIds.length) {
        const foundIds = sourcePaints.map(p => p.id);
        const missingIds = data.sourcePaintIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Tintas de origem não encontradas: ${missingIds.join(', ')}`);
      }

      // 2. Detect conflicts and track merge details
      const mergeDetails: any = {
        targetPaintId: data.targetPaintId,
        sourcePaintIds: data.sourcePaintIds,
        conflicts: [],
        mergedRelations: {
          formulas: 0,
          paintGrounds: 0,
          relatedPaints: 0,
          tasks: 0,
        },
      };

      // Check for field conflicts
      const fieldConflicts = this.detectPaintConflicts(targetPaint, sourcePaints);
      if (Object.keys(fieldConflicts).length > 0) {
        mergeDetails.conflicts = fieldConflicts;
      }

      // 3. Merge formulas - move all formulas from source paints to target
      for (const sourcePaint of sourcePaints) {
        if (sourcePaint.formulas.length > 0) {
          await tx.paintFormula.updateMany({
            where: { paintId: sourcePaint.id },
            data: { paintId: data.targetPaintId },
          });
          mergeDetails.mergedRelations.formulas += sourcePaint.formulas.length;
        }
      }

      // 4. Merge paint grounds (base paint relationships)
      for (const sourcePaint of sourcePaints) {
        // Update where source paint requires a ground
        if (sourcePaint.paintGrounds.length > 0) {
          for (const ground of sourcePaint.paintGrounds) {
            // Check if target doesn't already have this ground relationship
            const existingGround = await tx.paintGround.findFirst({
              where: {
                paintId: data.targetPaintId,
                groundPaintId: ground.groundPaintId,
              },
            });

            if (!existingGround) {
              await tx.paintGround.create({
                data: {
                  paintId: data.targetPaintId,
                  groundPaintId: ground.groundPaintId,
                },
              });
              mergeDetails.mergedRelations.paintGrounds++;
            }
          }
          // Delete old relationships
          await tx.paintGround.deleteMany({
            where: { paintId: sourcePaint.id },
          });
        }

        // Update where source paint IS a ground for others
        if (sourcePaint.groundPaintFor.length > 0) {
          for (const groundFor of sourcePaint.groundPaintFor) {
            // Check if target doesn't already serve as ground for this paint
            const existingGround = await tx.paintGround.findFirst({
              where: {
                paintId: groundFor.paintId,
                groundPaintId: data.targetPaintId,
              },
            });

            if (!existingGround) {
              await tx.paintGround.update({
                where: { id: groundFor.id },
                data: { groundPaintId: data.targetPaintId },
              });
            } else {
              // Delete duplicate
              await tx.paintGround.delete({
                where: { id: groundFor.id },
              });
            }
          }
        }
      }

      // 5. Merge related paints (self-referential relationship)
      for (const sourcePaint of sourcePaints) {
        // Get unique related paint IDs that aren't already related to target
        const currentRelatedIds = targetPaint.relatedPaints.map(r => r.id);
        const newRelatedIds = sourcePaint.relatedPaints
          .map(r => r.id)
          .filter(id => !currentRelatedIds.includes(id) && id !== data.targetPaintId);

        if (newRelatedIds.length > 0) {
          await tx.paint.update({
            where: { id: data.targetPaintId },
            data: {
              relatedPaints: {
                connect: newRelatedIds.map(id => ({ id })),
              },
            },
          });
          mergeDetails.mergedRelations.relatedPaints += newRelatedIds.length;
        }

        // Also update reverse relationships (where source is listed as related)
        const reverseRelatedIds = sourcePaint.relatedTo.map(r => r.id);
        if (reverseRelatedIds.length > 0) {
          for (const relatedId of reverseRelatedIds) {
            await tx.paint.update({
              where: { id: relatedId },
              data: {
                relatedPaints: {
                  disconnect: { id: sourcePaint.id },
                  connect: { id: data.targetPaintId },
                },
              },
            });
          }
        }
      }

      // 6. Update task references (general paintings and logo tasks)
      for (const sourcePaint of sourcePaints) {
        // Update tasks that use this paint as general painting
        if (sourcePaint.generalPaintings.length > 0) {
          await tx.task.updateMany({
            where: { paintId: sourcePaint.id },
            data: { paintId: data.targetPaintId },
          });
          mergeDetails.mergedRelations.tasks += sourcePaint.generalPaintings.length;
        }

        // Update many-to-many relation for logo paints
        if (sourcePaint.logoTasks.length > 0) {
          for (const task of sourcePaint.logoTasks) {
            await tx.task.update({
              where: { id: task.id },
              data: {
                logoPaints: {
                  disconnect: { id: sourcePaint.id },
                  connect: { id: data.targetPaintId },
                },
              },
            });
          }
          mergeDetails.mergedRelations.tasks += sourcePaint.logoTasks.length;
        }
      }

      // 7. Apply conflict resolutions if provided
      if (data.conflictResolutions && Object.keys(data.conflictResolutions).length > 0) {
        const updateData: any = {};
        for (const [field, value] of Object.entries(data.conflictResolutions)) {
          if (value !== undefined) {
            updateData[field] = value;
          }
        }

        if (Object.keys(updateData).length > 0) {
          await tx.paint.update({
            where: { id: data.targetPaintId },
            data: updateData,
          });
        }
      }

      // 8. Merge tags (combine unique tags)
      const allTags = new Set([...targetPaint.tags, ...sourcePaints.flatMap(p => p.tags)]);

      if (allTags.size > targetPaint.tags.length) {
        await tx.paint.update({
          where: { id: data.targetPaintId },
          data: { tags: Array.from(allTags) },
        });
      }

      // 9. Delete source paints
      await tx.paint.deleteMany({
        where: { id: { in: data.sourcePaintIds } },
      });

      // 10. Create changelog entry
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PAINT,
        entityId: data.targetPaintId,
        action: CHANGE_ACTION.UPDATE,
        entity: mergeDetails,
        reason: `Mesclagem de ${sourcePaints.length} tinta(s)`,
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.PAINT_UPDATE,
        transaction: tx,
      });

      // 11. Fetch the updated paint with includes
      const updatedPaint = await tx.paint.findUnique({
        where: { id: data.targetPaintId },
        include: include || {
          paintType: true,
          paintBrand: true,
          formulas: {
            include: {
              components: true,
              paintProduction: true,
            },
          },
        },
      });

      return {
        success: true,
        message: `${sourcePaints.length} tinta(s) mesclada(s) com sucesso`,
        data: updatedPaint as any,
        targetPaintId: data.targetPaintId,
        mergedCount: sourcePaints.length,
        details: mergeDetails,
      };
    });
  }

  /**
   * Detect conflicts between target paint and source paints
   */
  private detectPaintConflicts(targetPaint: any, sourcePaints: any[]): Record<string, any> {
    const conflicts: Record<string, any> = {};

    const fieldsToCheck = [
      'name',
      'hex',
      'finish',
      'manufacturer',
      'paintTypeId',
      'paintBrandId',
    ];

    for (const field of fieldsToCheck) {
      const values = new Set(
        [targetPaint[field], ...sourcePaints.map(p => p[field])].filter(
          v => v !== null && v !== undefined,
        ),
      );

      if (values.size > 1) {
        conflicts[field] = {
          target: targetPaint[field],
          sources: sourcePaints.map((p, index) => ({
            paintId: p.id,
            paintName: p.name,
            value: p[field],
          })),
          resolution: 'kept_target',
        };
      }
    }

    return conflicts;
  }
}
