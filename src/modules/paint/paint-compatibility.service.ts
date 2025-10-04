import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PAINT_BRAND } from '../../constants/enums';

export interface ComponentCompatibilityRule {
  paintBrand: PAINT_BRAND;
  paintTypeId: string;
  allowedComponentIds: string[];
  restrictedComponentIds?: string[];
}

export interface PaintCompatibilityValidation {
  isValid: boolean;
  reason?: string;
  suggestions?: string[];
}

@Injectable()
export class PaintCompatibilityService {
  private readonly logger = new Logger(PaintCompatibilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate if a component is compatible with a specific paint brand and type
   */
  async validateComponentCompatibility(
    componentId: string,
    paintBrand: PAINT_BRAND,
    paintTypeId: string,
  ): Promise<PaintCompatibilityValidation> {
    try {
      // Get paint type with its allowed components
      const paintType = await this.prisma.paintType.findUnique({
        where: { id: paintTypeId },
        include: {
          componentItems: {
            where: { id: componentId },
          },
        },
      });

      if (!paintType) {
        return {
          isValid: false,
          reason: 'Tipo de tinta não encontrado',
        };
      }

      // Check if component is in the paint type's allowed components
      const isComponentInPaintType = paintType.componentItems.length > 0;

      if (!isComponentInPaintType) {
        // Get alternative paint types that support this component
        const alternativePaintTypes = await this.prisma.paintType.findMany({
          where: {
            componentItems: {
              some: { id: componentId },
            },
          },
          select: {
            id: true,
            name: true,
          },
        });

        return {
          isValid: false,
          reason: `Componente não é compatível com o tipo de tinta '${paintType.name}'`,
          suggestions:
            alternativePaintTypes.length > 0
              ? [
                  `Tipos de tinta compatíveis: ${alternativePaintTypes.map(pt => pt.name).join(', ')}`,
                ]
              : ['Nenhum tipo de tinta compatível encontrado para este componente'],
        };
      }

      // Additional brand-specific validation can be implemented here
      // For now, we consider all components in the paint type as compatible with any brand
      return {
        isValid: true,
      };
    } catch (error: any) {
      this.logger.error(`Erro ao validar compatibilidade do componente ${componentId}:`, error);
      return {
        isValid: false,
        reason: 'Erro interno ao validar compatibilidade',
      };
    }
  }

  /**
   * Validate paint formula components as a batch
   */
  async validateFormulaComponents(
    formulaPaintId: string,
    componentIds: string[],
  ): Promise<{
    validComponents: string[];
    invalidComponents: Array<{ componentId: string; reason: string }>;
  }> {
    try {
      // Get formula with paint information
      const formula = await this.prisma.paintFormula.findUnique({
        where: { id: formulaPaintId },
        include: {
          paint: {
            include: {
              paintType: {
                include: {
                  componentItems: true,
                },
              },
            },
          },
        },
      });

      if (!formula || !formula.paint) {
        throw new BadRequestException('Fórmula ou tinta não encontrada');
      }

      const allowedComponentIds =
        formula.paint.paintType?.componentItems.map(item => item.id) || [];
      const validComponents: string[] = [];
      const invalidComponents: Array<{ componentId: string; reason: string }> = [];

      for (const componentId of componentIds) {
        if (allowedComponentIds.includes(componentId)) {
          validComponents.push(componentId);
        } else {
          invalidComponents.push({
            componentId,
            reason: `Componente não compatível com tipo de tinta '${formula.paint.paintType?.name}'`,
          });
        }
      }

      return { validComponents, invalidComponents };
    } catch (error: any) {
      this.logger.error('Erro ao validar componentes da fórmula:', error);
      throw error;
    }
  }

  /**
   * Get suggested components for a paint brand and type combination
   */
  async getSuggestedComponents(
    paintBrand: PAINT_BRAND,
    paintTypeId: string,
    limit: number = 20,
  ): Promise<any[]> {
    try {
      const paintType = await this.prisma.paintType.findUnique({
        where: { id: paintTypeId },
        include: {
          componentItems: {
            include: {
              brand: true,
              category: true,
              measures: true,
            },
            take: limit,
            orderBy: {
              name: 'asc',
            },
          },
        },
      });

      if (!paintType) {
        return [];
      }

      // Apply brand-specific filtering here if needed
      // For now, return all components from the paint type
      return paintType.componentItems;
    } catch (error: any) {
      this.logger.error('Erro ao buscar componentes sugeridos:', error);
      return [];
    }
  }

  /**
   * Validate paint creation/update with business rules
   */
  async validatePaintBusinessRules(paintData: {
    brand: PAINT_BRAND;
    paintTypeId: string;
    groundIds?: string[];
  }): Promise<PaintCompatibilityValidation> {
    try {
      // Validate paint type exists
      const paintType = await this.prisma.paintType.findUnique({
        where: { id: paintData.paintTypeId },
      });

      if (!paintType) {
        return {
          isValid: false,
          reason: 'Tipo de tinta não encontrado',
        };
      }

      // Validate ground paints if provided
      if (paintData.groundIds && paintData.groundIds.length > 0) {
        const groundPaints = await this.prisma.paint.findMany({
          where: {
            id: { in: paintData.groundIds },
          },
          include: {
            paintType: true,
          },
        });

        if (groundPaints.length !== paintData.groundIds.length) {
          return {
            isValid: false,
            reason: 'Uma ou mais tintas de fundo não foram encontradas',
          };
        }

        // Validate that ground paints are compatible
        const incompatibleGrounds = groundPaints.filter(ground => {
          // Add ground compatibility logic here
          // For now, we allow any paint type as ground
          return false;
        });

        if (incompatibleGrounds.length > 0) {
          return {
            isValid: false,
            reason: `Tintas de fundo incompatíveis: ${incompatibleGrounds.map(g => g.name).join(', ')}`,
          };
        }
      }

      // Additional brand-specific business rules can be added here
      return {
        isValid: true,
      };
    } catch (error: any) {
      this.logger.error('Erro ao validar regras de negócio da tinta:', error);
      return {
        isValid: false,
        reason: 'Erro interno ao validar regras de negócio',
      };
    }
  }

  /**
   * Get compatibility matrix for debugging and administrative purposes
   */
  async getCompatibilityMatrix(): Promise<{
    paintTypes: Array<{
      id: string;
      name: string;
      componentCount: number;
      brands: PAINT_BRAND[];
    }>;
    totalComponents: number;
  }> {
    try {
      const paintTypes = await this.prisma.paintType.findMany({
        include: {
          componentItems: true,
          paints: {
            select: {
              paintBrand: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
      });

      const totalComponents = await this.prisma.item.count({
        where: {
          paintTypes: {
            some: {},
          },
        },
      });

      const matrix = paintTypes.map(paintType => ({
        id: paintType.id,
        name: paintType.name,
        componentCount: paintType.componentItems.length,
        brands: [
          ...new Set(paintType.paints.filter(p => p.paintBrand?.name).map(p => p.paintBrand!.name)),
        ] as any,
      }));

      return {
        paintTypes: matrix,
        totalComponents,
      };
    } catch (error: any) {
      this.logger.error('Erro ao gerar matriz de compatibilidade:', error);
      throw error;
    }
  }
}
