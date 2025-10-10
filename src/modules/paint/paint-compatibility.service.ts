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
   * Component must exist in BOTH paint type AND paint brand to be valid
   */
  async validateComponentCompatibility(
    componentId: string,
    paintBrandId: string,
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
        return {
          isValid: false,
          reason: `Componente não é compatível com o tipo de tinta '${paintType.name}'`,
        };
      }

      // Get paint brand with its allowed components using ID (unique identifier)
      const paintBrand = await this.prisma.paintBrand.findUnique({
        where: { id: paintBrandId },
        include: {
          componentItems: {
            where: { id: componentId },
          },
        },
      });

      if (!paintBrand) {
        return {
          isValid: false,
          reason: 'Marca de tinta não encontrada',
        };
      }

      // Check if component is in the paint brand's allowed components
      const isComponentInPaintBrand = paintBrand.componentItems.length > 0;

      if (!isComponentInPaintBrand) {
        return {
          isValid: false,
          reason: `Componente não é compatível com a marca de tinta '${paintBrand.name}'`,
        };
      }

      // Component exists in BOTH paint type AND paint brand - it's valid
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
   * Components must exist in BOTH paint type AND paint brand to be valid
   */
  async validateFormulaComponents(
    formulaPaintId: string,
    componentIds: string[],
  ): Promise<{
    validComponents: string[];
    invalidComponents: Array<{ componentId: string; reason: string }>;
  }> {
    try {
      // Get formula with paint information including both paint type and paint brand
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
              paintBrand: {
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

      if (!formula.paint.paintType || !formula.paint.paintBrand) {
        throw new BadRequestException('Tipo ou marca de tinta não encontrada');
      }

      // Get intersection of paint type and paint brand components
      const paintTypeComponentIds = new Set(
        formula.paint.paintType.componentItems.map(item => item.id),
      );
      const allowedComponentIds = formula.paint.paintBrand.componentItems
        .filter(item => paintTypeComponentIds.has(item.id))
        .map(item => item.id);

      const validComponents: string[] = [];
      const invalidComponents: Array<{ componentId: string; reason: string }> = [];

      for (const componentId of componentIds) {
        if (allowedComponentIds.includes(componentId)) {
          validComponents.push(componentId);
        } else {
          // Determine which constraint failed
          const inPaintType = paintTypeComponentIds.has(componentId);
          const inPaintBrand = formula.paint.paintBrand.componentItems.some(
            item => item.id === componentId,
          );

          let reason: string;
          if (!inPaintType && !inPaintBrand) {
            reason = `Componente não compatível com tipo '${formula.paint.paintType.name}' nem marca '${formula.paint.paintBrand.name}'`;
          } else if (!inPaintType) {
            reason = `Componente não compatível com tipo de tinta '${formula.paint.paintType.name}'`;
          } else {
            reason = `Componente não compatível com marca de tinta '${formula.paint.paintBrand.name}'`;
          }

          invalidComponents.push({
            componentId,
            reason,
          });
        }
      }

      this.logger.log(
        `Validated ${componentIds.length} components: ${validComponents.length} valid, ${invalidComponents.length} invalid`,
      );

      return { validComponents, invalidComponents };
    } catch (error: any) {
      this.logger.error('Erro ao validar componentes da fórmula:', error);
      throw error;
    }
  }

  /**
   * Get suggested components for a paint brand and type combination
   * Returns intersection of paint type and paint brand components
   */
  async getSuggestedComponents(
    paintBrandId: string,
    paintTypeId: string,
    limit: number = 20,
  ): Promise<any[]> {
    try {
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
        this.logger.warn(`Paint type ${paintTypeId} not found`);
        return [];
      }

      // Get paint brand with component items using ID (unique identifier)
      const paintBrand = await this.prisma.paintBrand.findUnique({
        where: { id: paintBrandId },
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

      if (!paintBrand) {
        this.logger.warn(`Paint brand with ID ${paintBrandId} not found`);
        return [];
      }

      // Get intersection of components (items that exist in both)
      const paintTypeComponentIds = new Set(paintType.componentItems.map(item => item.id));
      const availableComponents = paintBrand.componentItems
        .filter(item => paintTypeComponentIds.has(item.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, limit);

      this.logger.log(
        `Found ${availableComponents.length} common components between paint type "${paintType.name}" and paint brand "${paintBrand.name}"`,
      );

      return availableComponents;
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
