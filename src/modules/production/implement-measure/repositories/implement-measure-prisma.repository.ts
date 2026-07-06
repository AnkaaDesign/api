// apps/api/src/modules/production/implement-measure/repositories/implement-measure-prisma.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ImplementMeasure } from '@prisma/client';
import type { ImplementMeasureCreateFormData, ImplementMeasureUpdateFormData } from '../../../../schemas';
import { ImplementMeasureRepository } from './implement-measure.repository';

@Injectable()
export class ImplementMeasurePrismaRepository implements ImplementMeasureRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, include?: any): Promise<ImplementMeasure | null> {
    // Always include sections by default, sorted by position
    const defaultInclude = {
      sections: {
        orderBy: { position: 'asc' as const },
      },
      ...include,
    };

    return this.prisma.implementMeasure.findUnique({
      where: { id },
      include: defaultInclude,
    });
  }

  async findByTruckId(
    truckId: string,
    options?: { includePhoto?: boolean },
  ): Promise<{
    leftSideMeasure: ImplementMeasure | null;
    rightSideMeasure: ImplementMeasure | null;
    backSideMeasure: ImplementMeasure | null;
  }> {
    // Only include photo if explicitly requested (for library/detail views)
    // Preview views don't need photo data
    const includePhoto = options?.includePhoto ?? false;

    const truck = await this.prisma.truck.findUnique({
      where: { id: truckId },
      include: {
        leftSideMeasure: {
          include: {
            ...(includePhoto && { photo: true }),
            sections: {
              orderBy: { position: 'asc' },
            },
          },
        },
        rightSideMeasure: {
          include: {
            ...(includePhoto && { photo: true }),
            sections: {
              orderBy: { position: 'asc' },
            },
          },
        },
        backSideMeasure: {
          include: {
            ...(includePhoto && { photo: true }),
            sections: {
              orderBy: { position: 'asc' },
            },
          },
        },
      },
    });

    if (!truck) {
      return {
        leftSideMeasure: null,
        rightSideMeasure: null,
        backSideMeasure: null,
      };
    }

    return {
      leftSideMeasure: truck.leftSideMeasure,
      rightSideMeasure: truck.rightSideMeasure,
      backSideMeasure: truck.backSideMeasure,
    };
  }

  async create(data: ImplementMeasureCreateFormData, userId?: string): Promise<ImplementMeasure> {
    const implementMeasure = await this.prisma.implementMeasure.create({
      data: {
        height: data.height,
        ...(data.photoId && { photo: { connect: { id: data.photoId } } }),
        sections: {
          create: data.sections.map((section, index) => ({
            width: section.width,
            isDoor: section.isDoor,
            doorHeight: section.doorHeight,
            position: section.position ?? index,
          })),
        },
      },
      include: {
        photo: true,
        sections: {
          orderBy: { position: 'asc' },
        },
      },
    });

    return implementMeasure;
  }

  async update(id: string, data: ImplementMeasureUpdateFormData, userId?: string): Promise<ImplementMeasure> {
    // Use a transaction to update implementMeasure and replace all sections
    const implementMeasure = await this.prisma.$transaction(async tx => {
      // Delete existing sections if we're updating them
      if (data.sections) {
        await tx.implementMeasureSection.deleteMany({
          where: { implementMeasureId: id },
        });
      }

      // Update implementMeasure with new sections
      return await tx.implementMeasure.update({
        where: { id },
        data: {
          ...(data.height !== undefined && { height: data.height }),
          ...(data.photoId !== undefined &&
            data.photoId && { photo: { connect: { id: data.photoId } } }),
          ...(data.photoId === null && { photo: { disconnect: true } }),
          ...(data.sections && {
            sections: {
              create: data.sections.map((section, index) => ({
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
          sections: {
            orderBy: { position: 'asc' },
          },
        },
      });
    });

    return implementMeasure;
  }

  async delete(id: string, userId?: string): Promise<void> {
    await this.prisma.implementMeasure.delete({
      where: { id },
    });
  }
}
