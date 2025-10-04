// apps/api/src/modules/production/layout/layout.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { Layout } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../constants/enums';
import type { LayoutCreateFormData, LayoutUpdateFormData } from '../../../schemas';
import { LayoutPrismaRepository } from './repositories/layout-prisma.repository';

@Injectable()
export class LayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly layoutRepository: LayoutPrismaRepository,
    private readonly changeLogService: ChangeLogService,
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
  ): Promise<Layout> {
    return await this.prisma.$transaction(async tx => {
      // Get the truck
      const truck = await tx.truck.findUnique({
        where: { id: truckId },
        include: {
          leftSideLayout: true,
          rightSideLayout: true,
          backSideLayout: true,
        },
      });

      if (!truck) {
        throw new NotFoundException('Caminhão não encontrado');
      }

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

      let layout: Layout;

      if (existingLayout) {
        // Update existing layout - delete old sections and create new ones
        await tx.layoutSection.deleteMany({
          where: { layoutId: existingLayout.id },
        });

        layout = await tx.layout.update({
          where: { id: existingLayout.id },
          data: {
            height: data.height,
            ...(data.photoId && { photo: { connect: { id: data.photoId } } }),
            ...(data.photoId === null && { photo: { disconnect: true } }),
            layoutSections: {
              create: data.sections.map((section, index) => ({
                width: section.width,
                isDoor: section.isDoor,
                doorOffset: section.doorOffset,
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

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.LAYOUT,
          entityId: layout.id,
          action: CHANGE_ACTION.UPDATE,
          reason: 'Layout do caminhão atualizado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId || null,
          userId: userId || null,
          transaction: tx,
        });
      } else {
        // Create new layout
        layout = await tx.layout.create({
          data: {
            height: data.height,
            ...(data.photoId && { photo: { connect: { id: data.photoId } } }),
            layoutSections: {
              create: data.sections.map((section, index) => ({
                width: section.width,
                isDoor: section.isDoor,
                doorOffset: section.doorOffset,
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

        // Update truck with new layout
        await tx.truck.update({
          where: { id: truckId },
          data: {
            [layoutField]: layout.id,
          },
        });

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

      // Log layout creation/update for truck
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.LAYOUT,
        entityId: layout.id,
        action: CHANGE_ACTION.UPDATE,
        reason: `Layout do lado ${side} do caminhão atualizado`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: userId || null,
        userId: userId || null,
        transaction: tx,
      });

      return layout;
    });
  }

  async generateSVG(layoutId: string): Promise<string> {
    const layout = await this.layoutRepository.findById(layoutId);
    if (!layout) {
      throw new NotFoundException('Layout não encontrado');
    }

    // Handle both old JSON format and new LayoutSection entity format
    const sections = (layout.sections as any[]) || [];
    const height = layout.height * 1000; // Convert to mm
    const totalLength = sections.reduce((sum, s) => sum + s.width * 1000, 0);

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
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const sectionWidth = section.width * 1000;

      // Draw vertical line between sections (except for the last one)
      if (i < sections.length - 1) {
        svgContent += `
    <line x1="${currentX + sectionWidth}" y1="${marginY}" x2="${currentX + sectionWidth}" y2="${marginY + height}" stroke="#000" stroke-width="1"/>`;
      }

      // Draw door top line if this section is a door
      if (section.isDoor && section.doorOffset !== null && section.doorOffset !== undefined) {
        const doorOffset = section.doorOffset * 1000;
        svgContent += `
    <line x1="${currentX}" y1="${marginY + doorOffset}" x2="${currentX + sectionWidth}" y2="${marginY + doorOffset}" stroke="#000" stroke-width="1"/>`;
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
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const sectionWidth = section.width * 1000;

      svgContent += `

    <!-- Section ${i + 1} width -->
    <line x1="${currentX}" y1="${marginY + height + 20}" x2="${currentX + sectionWidth}" y2="${marginY + height + 20}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX}" y1="${marginY + height + 15}" x2="${currentX}" y2="${marginY + height + 25}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX + sectionWidth}" y1="${marginY + height + 15}" x2="${currentX + sectionWidth}" y2="${marginY + height + 25}" stroke="#0066cc" stroke-width="0.5"/>
    <polygon points="${currentX + 5},${marginY + height + 20} ${currentX + 10},${marginY + height + 17} ${currentX + 10},${marginY + height + 23}" fill="#0066cc"/>
    <polygon points="${currentX + sectionWidth - 5},${marginY + height + 20} ${currentX + sectionWidth - 10},${marginY + height + 17} ${currentX + sectionWidth - 10},${marginY + height + 23}" fill="#0066cc"/>
    <text x="${currentX + sectionWidth / 2}" y="${marginY + height + 35}" text-anchor="middle" font-size="12" font-family="Arial" fill="#0066cc">${sectionWidth} mm</text>`;

      // Add door offset dimension if this section is a door
      if (section.isDoor && section.doorOffset !== null && section.doorOffset !== undefined) {
        const doorOffset = section.doorOffset * 1000;
        svgContent += `

    <!-- Door offset for section ${i + 1} -->
    <line x1="${currentX + sectionWidth + 20}" y1="${marginY}" x2="${currentX + sectionWidth + 20}" y2="${marginY + doorOffset}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX + sectionWidth + 15}" y1="${marginY}" x2="${currentX + sectionWidth + 25}" y2="${marginY}" stroke="#0066cc" stroke-width="0.5"/>
    <line x1="${currentX + sectionWidth + 15}" y1="${marginY + doorOffset}" x2="${currentX + sectionWidth + 25}" y2="${marginY + doorOffset}" stroke="#0066cc" stroke-width="0.5"/>
    <polygon points="${currentX + sectionWidth + 20},${marginY + 5} ${currentX + sectionWidth + 17},${marginY + 10} ${currentX + sectionWidth + 23},${marginY + 10}" fill="#0066cc"/>
    <polygon points="${currentX + sectionWidth + 20},${marginY + doorOffset - 5} ${currentX + sectionWidth + 17},${marginY + doorOffset - 10} ${currentX + sectionWidth + 23},${marginY + doorOffset - 10}" fill="#0066cc"/>
    <text x="${currentX + sectionWidth + 30}" y="${marginY + doorOffset / 2}" text-anchor="middle" font-size="12" font-family="Arial" fill="#0066cc" transform="rotate(90, ${currentX + sectionWidth + 30}, ${marginY + doorOffset / 2})">${doorOffset} mm</text>`;
      }

      currentX += sectionWidth;
    }

    svgContent += `
</svg>`;

    return svgContent;
  }
}
