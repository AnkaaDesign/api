// apps/api/src/modules/production/layout/layout.service.ts

import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Layout } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FileService } from '@modules/common/file/file.service';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../constants/enums';
import type { LayoutCreateFormData, LayoutUpdateFormData } from '../../../schemas';
import { LayoutPrismaRepository } from './repositories/layout-prisma.repository';

@Injectable()
export class LayoutService {
  private readonly logger = new Logger(LayoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly layoutRepository: LayoutPrismaRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
  ) {}

  async findById(id: string, include?: any): Promise<Layout | null> {
    return this.layoutRepository.findById(id, include);
  }

  async findByTruckId(truckId: string): Promise<{
    leftSideLayout: Layout | null;
    rightSideLayout: Layout | null;
    backSideLayout: Layout | null;
  }> {
    return this.layoutRepository.findByTruckId(truckId);
  }

  async create(data: LayoutCreateFormData, userId?: string): Promise<Layout> {
    const layout = await this.layoutRepository.create(data, userId);

    // Log the change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.LAYOUT,
      entityId: layout.id,
      action: CHANGE_ACTION.CREATE,
      reason: 'Layout criado',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId || null,
      userId: userId || null,
    });

    return layout;
  }

  async update(id: string, data: LayoutUpdateFormData, userId?: string): Promise<Layout> {
    // Check if layout exists
    const existingLayout = await this.layoutRepository.findById(id);
    if (!existingLayout) {
      throw new NotFoundException('Layout não encontrado');
    }

    const layout = await this.layoutRepository.update(id, data, userId);

    // Log the change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.LAYOUT,
      entityId: id,
      action: CHANGE_ACTION.UPDATE,
      reason: 'Layout atualizado',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId || null,
      userId: userId || null,
    });

    return layout;
  }

  async delete(id: string, userId?: string): Promise<void> {
    // Check if layout exists
    const existingLayout = await this.layoutRepository.findById(id);
    if (!existingLayout) {
      throw new NotFoundException('Layout não encontrado');
    }

    await this.layoutRepository.delete(id, userId);

    // Log the change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.LAYOUT,
      entityId: id,
      action: CHANGE_ACTION.DELETE,
      reason: 'Layout deletado',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId || null,
      userId: userId || null,
    });
  }

  async createOrUpdateTruckLayout(
    truckId: string,
    side: 'left' | 'right' | 'back',
    data: LayoutCreateFormData,
    userId?: string,
    photoFile?: Express.Multer.File,
  ): Promise<Layout> {
    this.logger.log('');
    this.logger.log('═══════════════════════════════════════════════════════════════');
    this.logger.log('🚚 [BACKEND] createOrUpdateTruckLayout - REQUEST RECEIVED');
    this.logger.log('═══════════════════════════════════════════════════════════════');
    this.logger.log(`[BACKEND] Input parameters:`, {
      truckId,
      side,
      userId,
      hasPhotoFile: !!photoFile,
      photoFileName: photoFile?.originalname,
      data: {
        height: data.height,
        layoutSectionsCount: data.layoutSections?.length,
        layoutSections: data.layoutSections?.map(s => ({
          width: s.width,
          isDoor: s.isDoor,
          doorHeight: s.doorHeight,
          position: s.position,
        })),
        totalWidth: data.layoutSections?.reduce((sum, s) => sum + s.width, 0),
        photoId: data.photoId,
      },
    });

    return await this.prisma.$transaction(async tx => {
      this.logger.log('[BACKEND] Transaction started');

      // Get the truck
      this.logger.log(`[BACKEND] Fetching truck with ID: ${truckId}`);
      const truck = await tx.truck.findUnique({
        where: { id: truckId },
        include: {
          leftSideLayout: true,
          rightSideLayout: true,
          backSideLayout: true,
        },
      });

      if (!truck) {
        this.logger.error(`[BACKEND] ❌ Truck NOT FOUND: ${truckId}`);
        throw new NotFoundException(
          `Caminhão não encontrado para ID ${truckId}. Certifique-se de que a tarefa foi criada corretamente antes de adicionar layouts.`
        );
      }

      this.logger.log(`[BACKEND] ✅ Truck found:`, {
        id: truck.id,
        hasLeftLayout: !!truck.leftSideLayout,
        hasRightLayout: !!truck.rightSideLayout,
        hasBackLayout: !!truck.backSideLayout,
      });

      // Determine which layout to update
      const layoutFieldMap = {
        left: 'leftSideLayoutId',
        right: 'rightSideLayoutId',
        back: 'backSideLayoutId',
      };

      const existingLayoutMap = {
        left: truck.leftSideLayout,
        right: truck.rightSideLayout,
        back: truck.backSideLayout,
      };

      const layoutField = layoutFieldMap[side];
      const existingLayout = existingLayoutMap[side];

      this.logger.log(`[BACKEND] Side '${side}' - Checking existing layout:`, {
        hasExistingLayout: !!existingLayout,
        existingLayoutId: existingLayout?.id,
      });

      // Upload photo file if provided (only for backside)
      let photoId = data.photoId || null;
      if (photoFile && side === 'back') {
        this.logger.log(`[BACKEND] 📷 Uploading layout photo for ${side} side`);
        const uploadedPhoto = await this.fileService.createFromUploadWithTransaction(
          tx,
          photoFile,
          'layoutPhotos',
          userId || '',
          {
            entityType: 'LAYOUT',
          },
        );
        photoId = uploadedPhoto.id;
        this.logger.log(`[BACKEND] ✅ Photo uploaded successfully:`, {
          photoId,
          filename: photoFile.originalname,
        });
      }

      let layout: Layout;

      if (existingLayout) {
        this.logger.log(`[BACKEND] ⚙️  REPLACE MODE - Existing layout found for ${side} side`);
        this.logger.log(`[BACKEND] 🗑️  Deleting old layout ${existingLayout.id} (delete-then-create approach)`);

        // First, disconnect the layout from the truck
        await tx.truck.update({
          where: { id: truckId },
          data: {
            [layoutField]: null,
          },
        });
        this.logger.log(`[BACKEND] Layout disconnected from truck`);

        // Delete old layout sections
        await tx.layoutSection.deleteMany({
          where: { layoutId: existingLayout.id },
        });
        this.logger.log(`[BACKEND] Old layout sections deleted`);

        // Delete the old layout
        await tx.layout.delete({
          where: { id: existingLayout.id },
        });
        this.logger.log(`[BACKEND] Old layout deleted successfully`);

        // Create new layout
        this.logger.log(`[BACKEND] 🆕 Creating new layout to replace old one`);
        layout = await tx.layout.create({
          data: {
            height: data.height,
            ...(photoId && { photo: { connect: { id: photoId } } }),
            layoutSections: {
              create: data.layoutSections.map((section, index) => ({
                width: section.width,
                isDoor: section.isDoor,
                doorHeight: section.doorHeight,
                position: section.position ?? index,
              })),
            },
          },
          include: {
            photo: true,
            layoutSections: {
              orderBy: { position: 'asc' },
            },
          },
        });

        this.logger.log(`[BACKEND] ✅ New layout created successfully:`, {
          oldLayoutId: existingLayout.id,
          newLayoutId: layout.id,
          height: layout.height,
          sectionsCount: (layout as any).layoutSections?.length || 0,
        });

        // Link new layout to truck
        await tx.truck.update({
          where: { id: truckId },
          data: {
            [layoutField]: layout.id,
          },
        });
        this.logger.log(`[BACKEND] ✅ New layout linked to truck`);

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.LAYOUT,
          entityId: layout.id,
          action: CHANGE_ACTION.CREATE,
          reason: `Layout do lado ${side} do caminhão substituído (deletar e criar novo)`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId || null,
          userId: userId || null,
          transaction: tx,
        });
      } else {
        this.logger.log(`[BACKEND] ➕ CREATE MODE - No existing layout for ${side} side`);
        this.logger.log(`[BACKEND] 🆕 Creating new layout (always create, no duplicate check)`);

        // Create new layout
        layout = await tx.layout.create({
          data: {
            height: data.height,
            ...(photoId && { photo: { connect: { id: photoId } } }),
            layoutSections: {
              create: data.layoutSections.map((section, index) => ({
                width: section.width,
                isDoor: section.isDoor,
                doorHeight: section.doorHeight,
                position: section.position ?? index,
              })),
            },
          },
          include: {
            photo: true,
            layoutSections: {
              orderBy: { position: 'asc' },
            },
          },
        });

        this.logger.log(`[BACKEND] ✅ New layout created successfully:`, {
          layoutId: layout.id,
          height: layout.height,
          layoutSectionsCount: (layout as any).layoutSections?.length || 0,
        });

        // Update truck with new layout
        this.logger.log(`[BACKEND] Linking layout ${layout.id} to truck ${truckId} (${side} side)`);
        await tx.truck.update({
          where: { id: truckId },
          data: {
            [layoutField]: layout.id,
          },
        });
        this.logger.log(`[BACKEND] ✅ Truck updated with layout link`);

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.LAYOUT,
          entityId: layout.id,
          action: CHANGE_ACTION.CREATE,
          reason: 'Layout do caminhão criado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId || null,
          userId: userId || null,
          transaction: tx,
        });
      }

      this.logger.log(`[BACKEND] Transaction committed successfully`);
      this.logger.log(`[BACKEND] 🎉 FINAL RESULT:`, {
        layoutId: layout.id,
        height: layout.height,
        layoutSectionsCount: (layout as any).layoutSections?.length || 0,
        side,
        truckId,
      });
      this.logger.log('═══════════════════════════════════════════════════════════════');
      this.logger.log('');

      return layout;
    });
  }

  async generateSVG(layoutId: string): Promise<string> {
    const layout = await this.layoutRepository.findById(layoutId);
    if (!layout) {
      throw new NotFoundException('Layout não encontrado');
    }

    // Use layoutSections from database
    const layoutSections = (layout as any).layoutSections || [];
    const height = layout.height * 1000; // Convert to mm
    const totalLength = layoutSections.reduce((sum: number, s: any) => sum + s.width * 1000, 0);

    const marginX = 50;
    const marginY = 50;
    const svgWidth = totalLength + marginX * 2 + 50;
    const svgHeight = height + marginY * 2 + 50;

    let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${svgWidth}mm" height="${svgHeight}mm" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg">
    <!-- Background -->
    <rect width="100%" height="100%" fill="white"/>

    <!-- Main container outline -->
    <rect x="${marginX}" y="${marginY}" width="${totalLength}" height="${height}" fill="none" stroke="#000" stroke-width="1"/>`;

    // Draw vertical section lines and door lines
    let currentX = marginX;
    for (let i = 0; i < layoutSections.length; i++) {
      const section = layoutSections[i];
      const sectionWidth = section.width * 1000;

      // Draw vertical line between sections (except for the last one)
      if (i < layoutSections.length - 1) {
        svgContent += `
    <line x1="${currentX + sectionWidth}" y1="${marginY}" x2="${currentX + sectionWidth}" y2="${marginY + height}" stroke="#000" stroke-width="1"/>`;
      }

      // Draw door top line if this section is a door
      // doorHeight is measured from bottom of layout to top of door opening
      // So the door top line Y position = marginY + (height - doorHeight)
      if (section.isDoor && section.doorHeight !== null && section.doorHeight !== undefined) {
        const doorHeightMm = section.doorHeight * 1000;
        const doorTopY = marginY + (height - doorHeightMm);
        svgContent += `
    <line x1="${currentX}" y1="${doorTopY}" x2="${currentX + sectionWidth}" y2="${doorTopY}" stroke="#000" stroke-width="1"/>`;
      }

      currentX += sectionWidth;
    }

    // Add dimension annotations
    svgContent += `

    <!-- Height dimension -->
    <line x1="${marginX - 20}" y1="${marginY}" x2="${marginX - 20}" y2="${marginY + height}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${marginX - 25}" y1="${marginY}" x2="${marginX - 15}" y2="${marginY}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${marginX - 25}" y1="${marginY + height}" x2="${marginX - 15}" y2="${marginY + height}" stroke="#0066cc" stroke-width="0.5"/>
    <polygon points="${marginX - 20},${marginY + 5} ${marginX - 17},${marginY + 10} ${marginX - 23},${marginY + 10}" fill="#0066cc"/>
    <polygon points="${marginX - 20},${marginY + height - 5} ${marginX - 17},${marginY + height - 10} ${marginX - 23},${marginY + height - 10}" fill="#0066cc"/>
    <text x="${marginX - 30}" y="${marginY + height / 2}" text-anchor="middle" font-size="12" font-family="Arial" fill="#0066cc" transform="rotate(-90, ${marginX - 30}, ${marginY + height / 2})">${height} mm</text>`;

    // Add width dimensions for each section
    currentX = marginX;
    for (let i = 0; i < layoutSections.length; i++) {
      const section = layoutSections[i];
      const sectionWidth = section.width * 1000;

      svgContent += `

    <!-- Section ${i + 1} width -->
    <line x1="${currentX}" y1="${marginY + height + 20}" x2="${currentX + sectionWidth}" y2="${marginY + height + 20}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX}" y1="${marginY + height + 15}" x2="${currentX}" y2="${marginY + height + 25}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX + sectionWidth}" y1="${marginY + height + 15}" x2="${currentX + sectionWidth}" y2="${marginY + height + 25}" stroke="#0066cc" stroke-width="0.5"/>
    <polygon points="${currentX + 5},${marginY + height + 20} ${currentX + 10},${marginY + height + 17} ${currentX + 10},${marginY + height + 23}" fill="#0066cc"/>
    <polygon points="${currentX + sectionWidth - 5},${marginY + height + 20} ${currentX + sectionWidth - 10},${marginY + height + 17} ${currentX + sectionWidth - 10},${marginY + height + 23}" fill="#0066cc"/>
    <text x="${currentX + sectionWidth / 2}" y="${marginY + height + 35}" text-anchor="middle" font-size="12" font-family="Arial" fill="#0066cc">${sectionWidth} mm</text>`;

      // Add door height dimension if this section is a door
      // doorHeight is measured from bottom of layout to top of door opening
      if (section.isDoor && section.doorHeight !== null && section.doorHeight !== undefined) {
        const doorHeightMm = section.doorHeight * 1000;
        const doorTopY = marginY + (height - doorHeightMm);
        svgContent += `

    <!-- Door height for section ${i + 1} -->
    <line x1="${currentX + sectionWidth + 20}" y1="${doorTopY}" x2="${currentX + sectionWidth + 20}" y2="${marginY + height}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX + sectionWidth + 15}" y1="${doorTopY}" x2="${currentX + sectionWidth + 25}" y2="${doorTopY}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX + sectionWidth + 15}" y1="${marginY + height}" x2="${currentX + sectionWidth + 25}" y2="${marginY + height}" stroke="#0066cc" stroke-width="0.5"/>
    <polygon points="${currentX + sectionWidth + 20},${doorTopY + 5} ${currentX + sectionWidth + 17},${doorTopY + 10} ${currentX + sectionWidth + 23},${doorTopY + 10}" fill="#0066cc"/>
    <polygon points="${currentX + sectionWidth + 20},${marginY + height - 5} ${currentX + sectionWidth + 17},${marginY + height - 10} ${currentX + sectionWidth + 23},${marginY + height - 10}" fill="#0066cc"/>
    <text x="${currentX + sectionWidth + 30}" y="${doorTopY + doorHeightMm / 2}" text-anchor="middle" font-size="12" font-family="Arial" fill="#0066cc" transform="rotate(90, ${currentX + sectionWidth + 30}, ${doorTopY + doorHeightMm / 2})">${doorHeightMm} mm</text>`;
      }

      currentX += sectionWidth;
    }

    svgContent += `
</svg>`;

    return svgContent;
  }
}
