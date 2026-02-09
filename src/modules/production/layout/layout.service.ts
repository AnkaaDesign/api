// apps/api/src/modules/production/layout/layout.service.ts

import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Layout } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FileService } from '@modules/common/file/file.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import {
  ENTITY_TYPE,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
} from '../../../constants/enums';
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
    private readonly dispatchService: NotificationDispatchService,
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

  /**
   * Find all layouts (for layout library/selection)
   * Returns layouts with usage count and which trucks use them
   */
  async findAll(options?: {
    includeUsage?: boolean;
    includeSections?: boolean;
  }): Promise<Array<Layout & { usageCount?: number }>> {
    const layouts = await this.prisma.layout.findMany({
      include: {
        photo: true,
        layoutSections: options?.includeSections
          ? {
              orderBy: { position: 'asc' },
            }
          : false,
        ...(options?.includeUsage && {
          trucksBackSide: { select: { id: true } },
          trucksLeftSide: { select: { id: true } },
          trucksRightSide: { select: { id: true } },
        }),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (options?.includeUsage) {
      return layouts.map(layout => ({
        ...layout,
        usageCount:
          ((layout as any).trucksBackSide?.length || 0) +
          ((layout as any).trucksLeftSide?.length || 0) +
          ((layout as any).trucksRightSide?.length || 0),
      }));
    }

    return layouts;
  }

  /**
   * Assign an existing layout to a truck side
   * This is a simpler alternative to createOrUpdateTruckLayout when you just want to assign existing
   */
  async assignLayoutToTruck(
    truckId: string,
    side: 'left' | 'right' | 'back',
    layoutId: string,
    userId?: string,
  ): Promise<void> {
    // Verify layout exists
    const layout = await this.findById(layoutId);
    if (!layout) {
      throw new NotFoundException(`Layout ${layoutId} não encontrado`);
    }

    // Verify truck exists
    const truck = await this.prisma.truck.findUnique({ where: { id: truckId } });
    if (!truck) {
      throw new NotFoundException(`Caminhão ${truckId} não encontrado`);
    }

    const layoutFieldMap = {
      left: 'leftSideLayoutId',
      right: 'rightSideLayoutId',
      back: 'backSideLayoutId',
    };

    await this.prisma.truck.update({
      where: { id: truckId },
      data: {
        [layoutFieldMap[side]]: layoutId,
      },
    });

    // Log the change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.TRUCK,
      entityId: truckId,
      action: CHANGE_ACTION.UPDATE,
      reason: `Layout ${layoutId} atribuído ao lado ${side} do caminhão`,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId || null,
      userId: userId || null,
    });
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

  async delete(id: string, userId?: string, force: boolean = false): Promise<void> {
    // Check if layout exists
    const existingLayout = await this.layoutRepository.findById(id);
    if (!existingLayout) {
      throw new NotFoundException('Layout não encontrado');
    }

    // Check if layout is being used by any trucks (SHARED RESOURCE PROTECTION)
    const usageCount = await this.getLayoutUsageCount(id);
    if (usageCount > 0 && !force) {
      throw new Error(
        `Este layout está sendo usado por ${usageCount} caminhão(ões). ` +
          `Não é possível deletar um layout compartilhado. ` +
          `Primeiro, remova o layout de todos os caminhões ou use force=true para deletar mesmo assim.`,
      );
    }

    await this.layoutRepository.delete(id, userId);

    // Log the change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.LAYOUT,
      entityId: id,
      action: CHANGE_ACTION.DELETE,
      reason: force ? 'Layout deletado (forçado)' : 'Layout deletado',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId || null,
      userId: userId || null,
    });
  }

  /**
   * Get count of trucks using this layout
   * Returns total count across all three sides (back, left, right)
   */
  async getLayoutUsageCount(layoutId: string): Promise<number> {
    const [backCount, leftCount, rightCount] = await Promise.all([
      this.prisma.truck.count({ where: { backSideLayoutId: layoutId } }),
      this.prisma.truck.count({ where: { leftSideLayoutId: layoutId } }),
      this.prisma.truck.count({ where: { rightSideLayoutId: layoutId } }),
    ]);
    return backCount + leftCount + rightCount;
  }

  /**
   * Get count of trucks using this layout (within transaction)
   * Returns total count across all three sides (back, left, right)
   */
  private async getLayoutUsageCountInTransaction(tx: any, layoutId: string): Promise<number> {
    const [backCount, leftCount, rightCount] = await Promise.all([
      tx.truck.count({ where: { backSideLayoutId: layoutId } }),
      tx.truck.count({ where: { leftSideLayoutId: layoutId } }),
      tx.truck.count({ where: { rightSideLayoutId: layoutId } }),
    ]);
    return backCount + leftCount + rightCount;
  }

  /**
   * Get all trucks using this layout (detailed)
   * Returns which trucks use this layout and on which sides
   */
  async getTrucksUsingLayout(layoutId: string): Promise<{
    backSide: Array<{ truckId: string; taskId: string; plate: string | null }>;
    leftSide: Array<{ truckId: string; taskId: string; plate: string | null }>;
    rightSide: Array<{ truckId: string; taskId: string; plate: string | null }>;
    totalCount: number;
  }> {
    const [backTrucks, leftTrucks, rightTrucks] = await Promise.all([
      this.prisma.truck.findMany({
        where: { backSideLayoutId: layoutId },
        select: { id: true, taskId: true, plate: true },
      }),
      this.prisma.truck.findMany({
        where: { leftSideLayoutId: layoutId },
        select: { id: true, taskId: true, plate: true },
      }),
      this.prisma.truck.findMany({
        where: { rightSideLayoutId: layoutId },
        select: { id: true, taskId: true, plate: true },
      }),
    ]);

    return {
      backSide: backTrucks.map(t => ({ truckId: t.id, taskId: t.taskId, plate: t.plate })),
      leftSide: leftTrucks.map(t => ({ truckId: t.id, taskId: t.taskId, plate: t.plate })),
      rightSide: rightTrucks.map(t => ({ truckId: t.id, taskId: t.taskId, plate: t.plate })),
      totalCount: backTrucks.length + leftTrucks.length + rightTrucks.length,
    };
  }

  /**
   * Format a layout summary string: "{totalWidth} x {height} {doorDescription}"
   */
  private formatLayoutSummary(
    layout: { height: number; layoutSections?: Array<{ width: number; isDoor: boolean }> },
  ): string {
    const sections = layout.layoutSections || [];
    const totalWidth = sections.reduce((sum, s) => sum + s.width, 0);
    const doorCount = sections.filter(s => s.isDoor).length;
    const doorText =
      doorCount === 0
        ? 'nenhuma porta'
        : doorCount === 1
          ? 'uma porta'
          : `${doorCount} portas`;
    return `${totalWidth} x ${layout.height} ${doorText}`;
  }

  /**
   * Build a human-readable PT-BR description comparing old vs new layout
   */
  private formatLayoutChangeDescription(
    side: 'left' | 'right' | 'back',
    oldLayout: { height: number; layoutSections?: Array<{ width: number; isDoor: boolean }> } | null,
    newLayout: { height: number; layoutSections?: Array<{ width: number; isDoor: boolean }> },
  ): string {
    const sideLabels: Record<string, string> = {
      left: 'Motorista',
      right: 'Sapo',
      back: 'Traseira',
    };
    const sideLabel = sideLabels[side] || side;

    if (!oldLayout || !oldLayout.layoutSections?.length) {
      const newSummary = this.formatLayoutSummary(newLayout);
      return `Layout ${sideLabel} definido: ${newSummary}`;
    }

    const oldSections = oldLayout.layoutSections || [];
    const newSections = newLayout.layoutSections || [];

    const oldWidth = oldSections.reduce((sum, s) => sum + s.width, 0);
    const newWidth = newSections.reduce((sum, s) => sum + s.width, 0);
    const oldDoors = oldSections.filter(s => s.isDoor).length;
    const newDoors = newSections.filter(s => s.isDoor).length;

    const dimensionsChanged = oldWidth !== newWidth || oldLayout.height !== newLayout.height;
    const doorsChanged = oldDoors !== newDoors;

    const oldSummary = this.formatLayoutSummary(oldLayout);
    const newSummary = this.formatLayoutSummary(newLayout);

    if (dimensionsChanged && doorsChanged) {
      return `${oldSummary} para ${newSummary}`;
    }

    if (dimensionsChanged) {
      return `Medidas alteradas de ${oldWidth} x ${oldLayout.height} para ${newWidth} x ${newLayout.height}`;
    }

    if (doorsChanged) {
      const doorAction = newDoors > oldDoors ? 'Porta adicionada' : 'Porta removida';
      return `${doorAction} no ${sideLabel} (medidas mantidas: ${oldWidth} x ${oldLayout.height})`;
    }

    return `Layout ${sideLabel} atualizado: ${newSummary}`;
  }

  async createOrUpdateTruckLayout(
    truckId: string,
    side: 'left' | 'right' | 'back',
    data: LayoutCreateFormData,
    userId?: string,
    photoFile?: Express.Multer.File,
    existingLayoutId?: string, // NEW: Assign existing layout instead of creating new
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

    let oldLayoutSnapshot: { height: number; layoutSections: Array<{ width: number; isDoor: boolean }> } | null = null;

    const result = await this.prisma.$transaction(async tx => {
      this.logger.log('[BACKEND] Transaction started');

      // Get the truck
      this.logger.log(`[BACKEND] Fetching truck with ID: ${truckId}`);
      const truck = await tx.truck.findUnique({
        where: { id: truckId },
        include: {
          leftSideLayout: { include: { layoutSections: { orderBy: { position: 'asc' as const } } } },
          rightSideLayout: { include: { layoutSections: { orderBy: { position: 'asc' as const } } } },
          backSideLayout: { include: { layoutSections: { orderBy: { position: 'asc' as const } } } },
        },
      });

      if (!truck) {
        this.logger.error(`[BACKEND] ❌ Truck NOT FOUND: ${truckId}`);
        throw new NotFoundException(
          `Caminhão não encontrado para ID ${truckId}. Certifique-se de que a tarefa foi criada corretamente antes de adicionar layouts.`,
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

      // Capture old layout snapshot for notification comparison (before any modifications)
      if (existingLayout && (existingLayout as any).layoutSections) {
        oldLayoutSnapshot = {
          height: existingLayout.height,
          layoutSections: ((existingLayout as any).layoutSections as Array<{ width: number; isDoor: boolean }>).map(s => ({
            width: s.width,
            isDoor: s.isDoor,
          })),
        };
      }

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

      // NEW LOGIC: Check if we should use an existing shared layout
      if (existingLayoutId) {
        this.logger.log(
          `[BACKEND] 🔗 SHARED LAYOUT MODE - Assigning existing layout ${existingLayoutId}`,
        );

        // Verify the layout exists
        const sharedLayout = await tx.layout.findUnique({
          where: { id: existingLayoutId },
          include: {
            photo: true,
            layoutSections: {
              orderBy: { position: 'asc' },
            },
          },
        });

        if (!sharedLayout) {
          throw new NotFoundException(`Layout compartilhado ${existingLayoutId} não encontrado`);
        }

        // If there's an old layout, handle it
        if (existingLayout && existingLayout.id !== existingLayoutId) {
          // Check if old layout is used by other trucks
          const oldLayoutUsageCount = await this.getLayoutUsageCountInTransaction(
            tx,
            existingLayout.id,
          );
          this.logger.log(
            `[BACKEND] Old layout ${existingLayout.id} is used by ${oldLayoutUsageCount} truck(s)`,
          );

          if (oldLayoutUsageCount === 1) {
            // Only this truck uses it, safe to delete
            this.logger.log(`[BACKEND] 🗑️  Deleting unused old layout ${existingLayout.id}`);
            await tx.layoutSection.deleteMany({ where: { layoutId: existingLayout.id } });
            await tx.layout.delete({ where: { id: existingLayout.id } });
            this.logger.log(`[BACKEND] ✅ Old layout deleted`);
          } else {
            // Other trucks use it, just unlink
            this.logger.log(
              `[BACKEND] ℹ️  Old layout is shared, keeping it (used by ${oldLayoutUsageCount} trucks)`,
            );
          }
        }

        // Link shared layout to this truck
        await tx.truck.update({
          where: { id: truckId },
          data: { [layoutField]: existingLayoutId },
        });
        this.logger.log(`[BACKEND] ✅ Shared layout ${existingLayoutId} linked to truck`);

        layout = sharedLayout;

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TRUCK,
          entityId: truckId,
          action: CHANGE_ACTION.UPDATE,
          reason: `Layout compartilhado atribuído ao lado ${side} do caminhão`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId || null,
          userId: userId || null,
          transaction: tx,
        });
      } else if (existingLayout) {
        this.logger.log(`[BACKEND] ⚙️  REPLACE MODE - Existing layout found for ${side} side`);

        // Check if existing layout is used by other trucks
        const usageCount = await this.getLayoutUsageCountInTransaction(tx, existingLayout.id);
        this.logger.log(
          `[BACKEND] Existing layout ${existingLayout.id} is used by ${usageCount} truck(s)`,
        );

        if (usageCount > 1) {
          // Layout is shared! Don't delete it, just create a new one for this truck
          this.logger.log(
            `[BACKEND] ⚠️  Layout is SHARED by ${usageCount} trucks - creating new layout instead of modifying shared one`,
          );
        } else {
          // Only this truck uses it, safe to delete
          this.logger.log(
            `[BACKEND] 🗑️  Deleting old layout ${existingLayout.id} (only used by this truck)`,
          );

          // First, disconnect the layout from the truck
          await tx.truck.update({
            where: { id: truckId },
            data: { [layoutField]: null },
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
        }

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
          reason: `Layout do lado ${side} do caminhão criado`,
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

    // Build new layout snapshot for notification comparison
    const newLayoutSnapshot = {
      height: data.height,
      layoutSections: (data.layoutSections || []).map(s => ({
        width: s.width,
        isDoor: s.isDoor,
      })),
    };

    // Send notifications for layout change (outside transaction to not block it)
    this.sendLayoutChangeNotifications(
      truckId,
      side,
      existingLayoutId ? 'assign' : 'update',
      userId,
      oldLayoutSnapshot,
      newLayoutSnapshot,
    ).catch(err => {
      this.logger.error('Error sending layout change notifications:', err);
    });

    return result;
  }

  async generateSVG(layoutId: string): Promise<string> {
    const layout = await this.layoutRepository.findById(layoutId);
    if (!layout) {
      throw new NotFoundException('Layout não encontrado');
    }

    // Use layoutSections from database
    const layoutSections = (layout as any).layoutSections || [];
    // Scale: 1cm = 1mm in SVG (so 840cm layout becomes 840mm SVG)
    const height = layout.height * 100; // Convert m to cm scale (as mm in SVG)
    const totalLength = layoutSections.reduce((sum: number, s: any) => sum + s.width * 100, 0);

    const marginX = 50;
    const marginY = 50;
    const svgWidth = totalLength + marginX * 2 + 50;
    const svgHeight = height + marginY * 2 + 50;

    let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${svgWidth}mm" height="${svgHeight}mm" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${marginX}" y="${marginY}" width="${totalLength}" height="${height}" fill="none" stroke="#000" stroke-width="1"/>`;

    // Draw vertical section lines and door lines
    let currentX = marginX;
    for (let i = 0; i < layoutSections.length; i++) {
      const section = layoutSections[i];
      const sectionWidth = section.width * 100; // cm scale

      // Draw vertical line between sections (except for the last one)
      if (i < layoutSections.length - 1) {
        svgContent += `
    <line x1="${currentX + sectionWidth}" y1="${marginY}" x2="${currentX + sectionWidth}" y2="${marginY + height}" stroke="#000" stroke-width="1"/>`;
      }

      // Draw door top line if this section is a door
      // doorHeight is measured from bottom of layout to top of door opening
      // So the door top line Y position = marginY + (height - doorHeight)
      if (section.isDoor && section.doorHeight !== null && section.doorHeight !== undefined) {
        const doorHeightCm = section.doorHeight * 100; // cm scale
        const doorTopY = marginY + (height - doorHeightCm);
        svgContent += `
    <line x1="${currentX}" y1="${doorTopY}" x2="${currentX + sectionWidth}" y2="${doorTopY}" stroke="#000" stroke-width="1"/>`;
      }

      currentX += sectionWidth;
    }

    // Add dimension annotations (values in cm)
    svgContent += `
    <line x1="${marginX - 20}" y1="${marginY}" x2="${marginX - 20}" y2="${marginY + height}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${marginX - 25}" y1="${marginY}" x2="${marginX - 15}" y2="${marginY}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${marginX - 25}" y1="${marginY + height}" x2="${marginX - 15}" y2="${marginY + height}" stroke="#0066cc" stroke-width="0.5"/>
    <polygon points="${marginX - 20},${marginY + 5} ${marginX - 17},${marginY + 10} ${marginX - 23},${marginY + 10}" fill="#0066cc"/>
    <polygon points="${marginX - 20},${marginY + height - 5} ${marginX - 17},${marginY + height - 10} ${marginX - 23},${marginY + height - 10}" fill="#0066cc"/>
    <text x="${marginX - 30}" y="${marginY + height / 2}" text-anchor="middle" font-size="12" font-family="Arial" fill="#0066cc" transform="rotate(-90, ${marginX - 30}, ${marginY + height / 2})">${Math.round(height)} cm</text>`;

    // Add width dimensions for each section
    currentX = marginX;
    for (let i = 0; i < layoutSections.length; i++) {
      const section = layoutSections[i];
      const sectionWidth = section.width * 100; // cm scale

      svgContent += `
    <line x1="${currentX}" y1="${marginY + height + 20}" x2="${currentX + sectionWidth}" y2="${marginY + height + 20}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX}" y1="${marginY + height + 15}" x2="${currentX}" y2="${marginY + height + 25}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX + sectionWidth}" y1="${marginY + height + 15}" x2="${currentX + sectionWidth}" y2="${marginY + height + 25}" stroke="#0066cc" stroke-width="0.5"/>
    <polygon points="${currentX + 5},${marginY + height + 20} ${currentX + 10},${marginY + height + 17} ${currentX + 10},${marginY + height + 23}" fill="#0066cc"/>
    <polygon points="${currentX + sectionWidth - 5},${marginY + height + 20} ${currentX + sectionWidth - 10},${marginY + height + 17} ${currentX + sectionWidth - 10},${marginY + height + 23}" fill="#0066cc"/>
    <text x="${currentX + sectionWidth / 2}" y="${marginY + height + 35}" text-anchor="middle" font-size="12" font-family="Arial" fill="#0066cc">${Math.round(sectionWidth)} cm</text>`;

      // Add door height dimension if this section is a door
      // doorHeight is measured from bottom of layout to top of door opening
      if (section.isDoor && section.doorHeight !== null && section.doorHeight !== undefined) {
        const doorHeightCm = section.doorHeight * 100; // cm scale
        const doorTopY = marginY + (height - doorHeightCm);
        svgContent += `
    <line x1="${currentX + sectionWidth + 20}" y1="${doorTopY}" x2="${currentX + sectionWidth + 20}" y2="${marginY + height}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX + sectionWidth + 15}" y1="${doorTopY}" x2="${currentX + sectionWidth + 25}" y2="${doorTopY}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX + sectionWidth + 15}" y1="${marginY + height}" x2="${currentX + sectionWidth + 25}" y2="${marginY + height}" stroke="#0066cc" stroke-width="0.5"/>
    <polygon points="${currentX + sectionWidth + 20},${doorTopY + 5} ${currentX + sectionWidth + 17},${doorTopY + 10} ${currentX + sectionWidth + 23},${doorTopY + 10}" fill="#0066cc"/>
    <polygon points="${currentX + sectionWidth + 20},${marginY + height - 5} ${currentX + sectionWidth + 17},${marginY + height - 10} ${currentX + sectionWidth + 23},${marginY + height - 10}" fill="#0066cc"/>
    <text x="${currentX + sectionWidth + 30}" y="${doorTopY + doorHeightCm / 2}" text-anchor="middle" font-size="12" font-family="Arial" fill="#0066cc" transform="rotate(90, ${currentX + sectionWidth + 30}, ${doorTopY + doorHeightCm / 2})">${Math.round(doorHeightCm)} cm</text>`;
      }

      currentX += sectionWidth;
    }

    svgContent += `
</svg>`;

    return svgContent;
  }

  /**
   * Send notifications to relevant users when a layout is created/updated via the standalone endpoint.
   * Looks up the associated task from the truck to determine notification targets.
   */
  private async sendLayoutChangeNotifications(
    truckId: string,
    side: 'left' | 'right' | 'back',
    action: 'update' | 'assign',
    userId?: string,
    oldLayout?: { height: number; layoutSections: Array<{ width: number; isDoor: boolean }> } | null,
    newLayout?: { height: number; layoutSections: Array<{ width: number; isDoor: boolean }> } | null,
  ): Promise<void> {
    const sideLabels: Record<string, string> = {
      left: 'Lado Motorista',
      right: 'Lado Sapo',
      back: 'Traseira',
    };
    const sideLabel = sideLabels[side] || side;

    // Build layout change description
    const layoutChangeDescription = newLayout
      ? this.formatLayoutChangeDescription(side, oldLayout || null, newLayout)
      : `Layout ${sideLabel} alterado`;
    const oldLayoutSummary = oldLayout ? this.formatLayoutSummary(oldLayout) : '';
    const newLayoutSummary = newLayout ? this.formatLayoutSummary(newLayout) : '';

    // Find the task associated with this truck
    const truck = await this.prisma.truck.findUnique({
      where: { id: truckId },
      select: {
        taskId: true,
        task: {
          select: {
            id: true,
            name: true,
            sectorId: true,
            sector: {
              select: { managerId: true },
            },
          },
        },
      },
    });

    if (!truck?.task) {
      this.logger.warn(`[sendLayoutChangeNotifications] No task found for truck ${truckId}`);
      return;
    }

    const task = truck.task;

    // Map side to existing notification configuration keys
    const sideConfigKeys: Record<string, string> = {
      left: 'task.field.truck.leftSideLayoutId',
      right: 'task.field.truck.rightSideLayoutId',
      back: 'task.field.truck.backSideLayoutId',
    };
    const configKey = sideConfigKeys[side];

    if (!configKey) {
      this.logger.warn(`[sendLayoutChangeNotifications] Unknown side: ${side}`);
      return;
    }

    try {
      await this.dispatchService.dispatchByConfiguration(
        configKey,
        userId || 'system',
        {
          entityType: 'Task',
          entityId: task.id,
          action,
          data: {
            taskName: task.name,
            sideLabel,
            truckId,
            side,
            actorId: userId,
            layoutChangeDescription,
            oldLayoutSummary,
            newLayoutSummary,
          },
        },
      );

      this.logger.log(
        `[sendLayoutChangeNotifications] Dispatched ${configKey} for layout ${action} on ${sideLabel}: ${layoutChangeDescription}`,
      );
    } catch (err) {
      this.logger.error(
        `[sendLayoutChangeNotifications] Failed to dispatch notification:`,
        err,
      );
    }
  }
}
