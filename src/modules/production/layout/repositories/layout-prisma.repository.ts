// apps/api/src/modules/production/layout/repositories/layout-prisma.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Layout } from '@prisma/client';
import type { LayoutCreateFormData, LayoutUpdateFormData } from '../../../../schemas';
import { LayoutRepository } from './layout.repository';

@Injectable()
export class LayoutPrismaRepository implements LayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, include?: any): Promise<Layout | null> {
    // Always include layoutSections by default, sorted by position
    const defaultInclude = {
      layoutSections: {
        orderBy: { position: 'asc' as const },
      },
      ...include,
    };

    return this.prisma.layout.findUnique({
      where: { id },
      include: defaultInclude,
    });
  }

  async findByTruckId(truckId: string): Promise<{
    leftSideLayout: Layout | null;
    rightSideLayout: Layout | null;
    backSideLayout: Layout | null;
  }> {
    const truck = await this.prisma.truck.findUnique({
      where: { id: truckId },
      include: {
        leftSideLayout: {
          include: {
            photo: true,
            layoutSections: {
              orderBy: { position: 'asc' },
            },
          },
        },
        rightSideLayout: {
          include: {
            photo: true,
            layoutSections: {
              orderBy: { position: 'asc' },
            },
          },
        },
        backSideLayout: {
          include: {
            photo: true,
            layoutSections: {
              orderBy: { position: 'asc' },
            },
          },
        },
      },
    });

    if (!truck) {
      return {
        leftSideLayout: null,
        rightSideLayout: null,
        backSideLayout: null,
      };
    }

    return {
      leftSideLayout: truck.leftSideLayout,
      rightSideLayout: truck.rightSideLayout,
      backSideLayout: truck.backSideLayout,
    };
  }

  async create(data: LayoutCreateFormData, userId?: string): Promise<Layout> {
    const layout = await this.prisma.layout.create({
      data: {
        height: data.height,
        ...(data.photoId && { photo: { connect: { id: data.photoId } } }),
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

    return layout;
  }

  async update(id: string, data: LayoutUpdateFormData, userId?: string): Promise<Layout> {
    // Use a transaction to update layout and replace all sections
    const layout = await this.prisma.$transaction(async tx => {
      // Delete existing sections if we're updating them
      if (data.layoutSections) {
        await tx.layoutSection.deleteMany({
          where: { layoutId: id },
        });
      }

      // Update layout with new sections
      return await tx.layout.update({
        where: { id },
        data: {
          ...(data.height !== undefined && { height: data.height }),
          ...(data.photoId !== undefined &&
            data.photoId && { photo: { connect: { id: data.photoId } } }),
          ...(data.photoId === null && { photo: { disconnect: true } }),
          ...(data.layoutSections && {
            layoutSections: {
              create: data.layoutSections.map((section, index) => ({
                width: section.width,
                isDoor: section.isDoor,
                doorHeight: section.doorHeight,
                position: section.position ?? index,
              })),
            },
          }),
        },
        include: {
          photo: true,
          layoutSections: {
            orderBy: { position: 'asc' },
          },
        },
      });
    });

    return layout;
  }

  async delete(id: string, userId?: string): Promise<void> {
    await this.prisma.layout.delete({
      where: { id },
    });
  }
}
