import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PaintFormulaComponentRepository } from './repositories/paint-formula-component/paint-formula-component.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
  MEASURE_TYPE,
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
} from '../../constants/enums';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
  extractEssentialFields,
  getEssentialFields,
  translateFieldName,
} from '@modules/common/changelog/utils/changelog-helpers';
import { hasValueChanged } from '@modules/common/changelog/utils/serialize-changelog-value';
import {
  PaintFormulaComponentCreateFormData,
  PaintFormulaComponentUpdateFormData,
  PaintFormulaComponentBatchCreateFormData,
  PaintFormulaComponentBatchUpdateFormData,
  PaintFormulaComponentBatchDeleteFormData,
  PaintFormulaComponentGetManyFormData,
  PaintFormulaComponentInclude,
} from '../../schemas/paint';
import {
  PaintFormulaComponentGetUniqueResponse,
  PaintFormulaComponentGetManyResponse,
  PaintFormulaComponentCreateResponse,
  PaintFormulaComponentUpdateResponse,
  PaintFormulaComponentDeleteResponse,
  PaintFormulaComponentBatchCreateResponse,
  PaintFormulaComponentBatchUpdateResponse,
  PaintFormulaComponentBatchDeleteResponse,
  PaintFormulaComponent,
  Item,
} from '../../types';
// Paint utilities are now handled differently with the new weight-to-ratio conversion
import { PaintFormulaService } from './paint-formula.service';

@Injectable()
export class PaintFormulaComponentService {
  private readonly logger = new Logger(PaintFormulaComponentService.name);

  constructor(
    private paintFormulaComponentRepository: PaintFormulaComponentRepository,
    private changeLogService: ChangeLogService,
    private prisma: PrismaService,
    @Inject(forwardRef(() => PaintFormulaService))
    private paintFormulaService: PaintFormulaService,
  ) {}

  /**
   * Validate item has required measures for formula usage
   */
  private async validateItemExists(itemId: string, transaction?: any): Promise<Item> {
    const item = await (transaction || this.prisma).item.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundException('Item não encontrado');
    }

    return item;
  }

  /**
   * Validate component compatibility with paint brand and type
   */
  private async validateComponentCompatibility(
    itemId: string,
    formulaPaintId: string,
    transaction?: any,
  ): Promise<void> {
    const tx = transaction || this.prisma;

    // Get the formula with paint information
    const formula = await tx.paintFormula.findUnique({
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

    if (!formula) {
      throw new NotFoundException('Fórmula de tinta não encontrada');
    }

    if (!formula.paint) {
      throw new BadRequestException('Tinta da fórmula não encontrada');
    }

    if (!formula.paint.paintType) {
      throw new BadRequestException('Tipo de tinta não encontrado');
    }

    // Check if the item is in the paint type's allowed components
    const allowedComponents = formula.paint.paintType.componentItems || [];
    const isComponentAllowed = allowedComponents.some(component => component.id === itemId);

    if (!isComponentAllowed) {
      throw new BadRequestException(
        `Este componente não é compatível com o tipo de tinta '${formula.paint.paintType.name}'. Consulte a lista de componentes permitidos para este tipo de tinta.`,
      );
    }

    // Additional brand-specific validation can be added here
    // For now, we validate based on paint type compatibility
    this.logger.log(
      `Component ${itemId} validated for paint type ${formula.paint.paintType.name} and brand ${formula.paint.brand}`,
    );
  }

  /**
   * Recalculate ratios for all components in a formula based on weights
   * Ratios are calculated as: (component.weight / totalWeight) * 100
   */
  private async recalculateFormulaComponentRatios(
    formulaPaintId: string,
    transaction: any,
    userId?: string,
    triggeredBy?: CHANGE_TRIGGERED_BY,
    triggeredById?: string,
  ): Promise<void> {
    // Get all components
    const components = await transaction.paintFormulaComponent.findMany({
      where: { formulaPaintId },
      include: {
        item: true,
      },
    });

    if (components.length === 0) {
      return;
    }

    // Calculate total weight
    const totalWeight = components.reduce((sum, comp) => sum + (comp.weight || 0), 0);

    // If no weights defined, keep current ratios (backward compatibility)
    if (totalWeight === 0) {
      return;
    }

    // Recalculate ratios based on weights
    for (const component of components) {
      const originalRatio = component.ratio;
      const calculatedRatio = ((component.weight || 0) / totalWeight) * 100;
      // Round to 2 decimal places
      const roundedRatio = Math.round(calculatedRatio * 100) / 100;

      if (hasValueChanged(originalRatio, roundedRatio)) {
        await transaction.paintFormulaComponent.update({
          where: { id: component.id },
          data: { ratio: roundedRatio },
        });

        // Log the ratio recalculation
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PAINT_FORMULA_COMPONENT,
          entityId: component.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'ratio',
          oldValue: originalRatio,
          newValue: roundedRatio,
          reason: `Proporção recalculada automaticamente com base no peso (${component.item?.name || 'componente'}: ${originalRatio.toFixed(2)}% → ${roundedRatio.toFixed(2)}%)`,
          triggeredBy: triggeredBy || CHANGE_TRIGGERED_BY.SYSTEM,
          triggeredById: triggeredById || formulaPaintId,
          userId: userId || 'system',
          transaction,
        });
      }
    }
  }

  /**
   * Update formula density and cost after component changes
   */
  private async updateFormulaDensityAndCost(
    formulaPaintId: string,
    transaction: any,
    userId?: string,
    triggeredBy?: CHANGE_TRIGGERED_BY,
    triggeredById?: string,
  ): Promise<void> {
    // Delegate to the paint formula service with proper attribution
    await this.paintFormulaService.recalculateFormulaDensityAndCost(
      formulaPaintId,
      transaction,
      userId,
      triggeredBy,
      triggeredById,
    );
  }

  /**
   * Deduct inventory during formulation testing (on blur event)
   * This creates OUTBOUND activities without creating a component
   */
  async deductForFormulationTest(
    data: {
      itemId: string;
      weight: number; // Weight in grams
      formulaPaintId?: string; // Optional: for tracking which formula is being tested
    },
    userId?: string,
  ): Promise<{ success: boolean; message: string; data: { unitsDeducted: number; remainingQuantity: number } }> {
    try {
      const result = await this.prisma.$transaction(async transaction => {
        // Get item with measures
        const item = await transaction.item.findUnique({
          where: { id: data.itemId },
          include: { measures: true },
        });

        if (!item) {
          throw new NotFoundException('Item não encontrado');
        }

        const originalQuantity = item.quantity;

        // Calculate units to deduct based on weight
        let unitsToDeduct = 0;
        const weightMeasure = item.measures?.find(m => m.measureType === 'WEIGHT');

        if (weightMeasure && weightMeasure.value) {
          if (weightMeasure.unit === 'KILOGRAM') {
            const weightPerUnitGrams = weightMeasure.value * 1000;
            unitsToDeduct = data.weight / weightPerUnitGrams;
          } else if (weightMeasure.unit === 'GRAM') {
            unitsToDeduct = data.weight / weightMeasure.value;
          }
        } else {
          // Default: 1 unit = 1kg = 1000g
          unitsToDeduct = data.weight / 1000;
          this.logger.warn(
            `Item ${item.name}: No weight measure defined, using default 1 unit = 1kg`,
          );
        }

        unitsToDeduct = Math.max(0, Math.round(unitsToDeduct * 10000) / 10000);

        // Check inventory availability
        if (item.quantity < unitsToDeduct) {
          throw new BadRequestException(
            `Estoque insuficiente para "${item.name}". ` +
            `Necessário: ${unitsToDeduct.toFixed(4)} unidades (${data.weight.toFixed(2)}g), ` +
            `Disponível: ${item.quantity.toFixed(4)} unidades`,
          );
        }

        // Create OUTBOUND activity
        await transaction.activity.create({
          data: {
            itemId: data.itemId,
            quantity: unitsToDeduct,
            operation: ACTIVITY_OPERATION.OUTBOUND,
            reason: ACTIVITY_REASON.PAINT_PRODUCTION,
            reasonOrder: 12,
            userId: userId || null,
          },
        });

        // Deduct inventory
        const newQuantity = originalQuantity - unitsToDeduct;
        await transaction.item.update({
          where: { id: data.itemId },
          data: {
            quantity: {
              decrement: unitsToDeduct,
            },
          },
        });

        // Log to changelog
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ITEM,
          entityId: data.itemId,
          action: CHANGE_ACTION.UPDATE,
          field: 'quantity',
          oldValue: originalQuantity,
          newValue: newQuantity,
          reason: `Inventário deduzido para teste de formulação: ${unitsToDeduct.toFixed(4)} unidades para ${data.weight.toFixed(2)}g${data.formulaPaintId ? ` (fórmula: ${data.formulaPaintId})` : ''}`,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_CREATE,
          triggeredById: data.formulaPaintId || data.itemId,
          userId: userId || 'system',
          transaction,
        });

        return {
          unitsDeducted: unitsToDeduct,
          remainingQuantity: newQuantity,
        };
      });

      return {
        success: true,
        message: `Inventário deduzido com sucesso: ${result.unitsDeducted.toFixed(4)} unidades`,
        data: result,
      };
    } catch (error) {
      this.logger.error('Erro ao deduzir inventário para teste de formulação:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao deduzir inventário. Por favor, tente novamente.',
      );
    }
  }

  async create(
    data: PaintFormulaComponentCreateFormData,
    include?: PaintFormulaComponentInclude,
    userId?: string,
  ): Promise<PaintFormulaComponentCreateResponse> {
    try {
      const component = await this.prisma.$transaction(async transaction => {
        // Validate item exists
        const item = await this.validateItemExists(data.itemId, transaction);

        // Validate component compatibility with paint brand and type
        await this.validateComponentCompatibility(data.itemId, data.formulaPaintId, transaction);

        // Get all existing components to calculate total weight and ratio
        const existingComponents = await transaction.paintFormulaComponent.findMany({
          where: { formulaPaintId: data.formulaPaintId },
        });

        // Calculate total weight (existing + new)
        const existingTotalWeight = existingComponents.reduce((sum, comp) => sum + ((comp as any).weight || 0), 0);
        const newTotalWeight = existingTotalWeight + data.weight;

        // Calculate ratio for the new component
        const calculatedRatio = (data.weight / newTotalWeight) * 100;

        // Create component with both weight and calculated ratio
        // Note: Inventory was already deducted during blur/test events
        const componentData = {
          itemId: data.itemId,
          formulaPaintId: data.formulaPaintId,
          weight: data.weight,
          ratio: calculatedRatio,
        };

        const created = await this.paintFormulaComponentRepository.createWithTransaction(
          transaction,
          componentData,
          { include },
        );

        // Recalculate ratios for all components (including the new one)
        // since adding a new component changes the total weight
        await this.recalculateFormulaComponentRatios(
          data.formulaPaintId,
          transaction,
          userId,
          CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_CREATE,
          created.id,
        );

        // Update formula density and cost
        await this.updateFormulaDensityAndCost(
          data.formulaPaintId,
          transaction,
          userId,
          CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_CREATE,
          created.id,
        );

        // Enhanced creation logging
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT_FORMULA_COMPONENT,
          entityId: created.id,
          action: CHANGE_ACTION.CREATE,
          entity: extractEssentialFields(
            created,
            getEssentialFields(
              ENTITY_TYPE.PAINT_FORMULA_COMPONENT,
            ) as (keyof PaintFormulaComponent)[],
          ),
          reason: `Componente criado (${item.name}, ${data.weight.toFixed(2)}g, ${calculatedRatio.toFixed(2)}%)`,
          userId: userId || 'system',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_CREATE,
          transaction,
        });

        // Log impact on formula with details
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PAINT_FORMULA,
          entityId: data.formulaPaintId,
          action: CHANGE_ACTION.UPDATE,
          field: 'components',
          newValue: {
            action: 'ADD_COMPONENT',
            componentId: created.id,
            itemId: data.itemId,
            itemName: item.name,
            weight: data.weight,
            ratio: calculatedRatio,
          },
          reason: `Componente adicionado: ${item.name} (${data.weight.toFixed(2)}g, ${calculatedRatio.toFixed(2)}%)`,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_CREATE,
          triggeredById: created.id,
          userId: userId || 'system',
          transaction,
        });

        // Fetch the updated component with correct ratio
        const updatedComponent = await transaction.paintFormulaComponent.findUnique({
          where: { id: created.id },
          include: include as any,
        });

        return updatedComponent || created;
      });

      if (!component) {
        throw new BadRequestException(
          'Não foi possível criar o componente da fórmula, tente novamente.',
        );
      }

      return {
        success: true,
        message: 'Componente da fórmula criado com sucesso.',
        data: component,
      };
    } catch (error) {
      this.logger.error('Erro ao criar componente da fórmula:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar componente da fórmula. Por favor, tente novamente.',
      );
    }
  }

  async update(
    id: string,
    data: PaintFormulaComponentUpdateFormData,
    include?: PaintFormulaComponentInclude,
    userId?: string,
  ): Promise<PaintFormulaComponentUpdateResponse> {
    try {
      const componentExists = await this.paintFormulaComponentRepository.findById(id, {
        include: { item: true },
      });

      if (!componentExists) {
        throw new NotFoundException(
          'Componente da fórmula não encontrado, recarregue a página e tente novamente.',
        );
      }

      const component = await this.prisma.$transaction(async transaction => {
        let updateData: any = {};
        const changes: string[] = [];

        // Update weight if provided
        // Note: Inventory was already deducted during blur/test events
        if (data.weight !== undefined && data.weight !== componentExists.weight) {
          updateData.weight = data.weight;
          changes.push(`peso alterado de ${(componentExists.weight || 0).toFixed(2)}g para ${data.weight.toFixed(2)}g`);
        }

        // Update item if provided
        if (data.itemId && data.itemId !== componentExists.itemId) {
          await this.validateItemExists(data.itemId, transaction);
          await this.validateComponentCompatibility(
            data.itemId,
            componentExists.formulaPaintId,
            transaction,
          );
          updateData.itemId = data.itemId;
          changes.push(`item alterado`);
        }

        // Update formula if provided
        if (data.formulaPaintId !== undefined) {
          updateData.formulaPaintId = data.formulaPaintId;
        }

        const updated = await this.paintFormulaComponentRepository.updateWithTransaction(
          transaction,
          id,
          updateData,
          { include },
        );

        // Recalculate all component ratios based on weights
        await this.recalculateFormulaComponentRatios(
          updated.formulaPaintId,
          transaction,
          userId,
          CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_UPDATE,
          id,
        );

        // Update formula density and cost
        await this.updateFormulaDensityAndCost(
          updated.formulaPaintId,
          transaction,
          userId,
          CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_UPDATE,
          id,
        );

        // Enhanced field tracking
        const fieldsToTrack = ['itemId', 'weight', 'ratio', 'formulaPaintId'];
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT_FORMULA_COMPONENT,
          entityId: id,
          oldEntity: componentExists,
          newEntity: updated,
          fieldsToTrack,
          userId: userId || 'system',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_UPDATE,
          transaction,
        });

        // Log detailed impact on formula
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PAINT_FORMULA,
          entityId: updated.formulaPaintId,
          action: CHANGE_ACTION.UPDATE,
          field: 'components',
          reason: `Componente atualizado${changes.length > 0 ? ': ' + changes.join(', ') : ''}`,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_UPDATE,
          triggeredById: id,
          userId: userId || 'system',
          transaction,
        });

        // Fetch the updated component with correct ratio
        const updatedComponent = await transaction.paintFormulaComponent.findUnique({
          where: { id: updated.id },
          include: include as any,
        });

        return updatedComponent || updated;
      });

      return {
        success: true,
        message: 'Componente da fórmula atualizado com sucesso.',
        data: component,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar componente da fórmula:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar componente da fórmula. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId?: string): Promise<PaintFormulaComponentDeleteResponse> {
    try {
      const componentExists = await this.paintFormulaComponentRepository.findById(id);

      if (!componentExists) {
        throw new NotFoundException(
          'Componente da fórmula não encontrado, recarregue a página e tente novamente.',
        );
      }

      await this.prisma.$transaction(async transaction => {
        const formulaPaintId = componentExists.formulaPaintId;

        // Delete component
        // Note: Inventory was already consumed during blur/test events and should not be returned
        await this.paintFormulaComponentRepository.deleteWithTransaction(transaction, id);

        // Recalculate remaining component ratios
        await this.recalculateFormulaComponentRatios(
          formulaPaintId,
          transaction,
          userId,
          CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_DELETE,
          id,
        );

        // Update formula density and cost
        await this.updateFormulaDensityAndCost(
          formulaPaintId,
          transaction,
          userId,
          CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_DELETE,
          id,
        );

        // Enhanced deletion logging
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT_FORMULA_COMPONENT,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: extractEssentialFields(
            componentExists,
            getEssentialFields(
              ENTITY_TYPE.PAINT_FORMULA_COMPONENT,
            ) as (keyof PaintFormulaComponent)[],
          ),
          reason: `Componente excluído (${(componentExists.weight || 0).toFixed(2)}g, ${componentExists.ratio.toFixed(2)}%)`,
          userId: userId || 'system',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_DELETE,
          transaction,
        });

        // Log impact on formula with details
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PAINT_FORMULA,
          entityId: formulaPaintId,
          action: CHANGE_ACTION.UPDATE,
          field: 'components',
          oldValue: {
            action: 'REMOVE_COMPONENT',
            componentId: id,
            itemId: componentExists.itemId,
            weight: componentExists.weight,
            ratio: componentExists.ratio,
          },
          newValue: null,
          reason: `Componente removido (${(componentExists.weight || 0).toFixed(2)}g, ${componentExists.ratio.toFixed(2)}%)`,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_DELETE,
          triggeredById: id,
          userId: userId || 'system',
          transaction,
        });

        // Log impact on item
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ITEM,
          entityId: componentExists.itemId,
          action: CHANGE_ACTION.UPDATE,
          field: 'formulaComponents',
          reason: 'Item removido como componente de fórmula de tinta',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_DELETE,
          triggeredById: id,
          userId: userId || 'system',
          transaction,
        });
      });

      return { success: true, message: 'Componente da fórmula deletado com sucesso.' };
    } catch (error) {
      this.logger.error('Erro ao deletar componente da fórmula:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao deletar componente da fórmula. Por favor, tente novamente.',
      );
    }
  }

  async findById(
    id: string,
    include?: PaintFormulaComponentInclude,
  ): Promise<PaintFormulaComponentGetUniqueResponse> {
    const component = await this.paintFormulaComponentRepository.findById(id, { include });

    if (!component) {
      throw new NotFoundException(
        'Componente da fórmula não encontrado, recarregue a página e tente novamente.',
      );
    }

    return {
      success: true,
      message: 'Componente da fórmula carregado com sucesso.',
      data: component,
    };
  }

  async findMany(
    query: PaintFormulaComponentGetManyFormData,
  ): Promise<PaintFormulaComponentGetManyResponse> {
    try {
      const result = await this.paintFormulaComponentRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Componentes de fórmulas de tinta carregadas com sucesso',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar componentes de fórmulas de tinta:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar componentes de fórmulas de tinta. Por favor, tente novamente',
      );
    }
  }

  async batchCreate(
    data: PaintFormulaComponentBatchCreateFormData,
    include?: PaintFormulaComponentInclude,
    userId?: string,
  ): Promise<PaintFormulaComponentBatchCreateResponse<PaintFormulaComponentCreateFormData>> {
    try {
      // Validate unique constraints for each item
      const validationErrors: Array<{
        index: number;
        data: PaintFormulaComponentCreateFormData;
        error: string;
        errorCode?: string;
      }> = [];

      // Pre-validate components
      const itemIds = Array.from(new Set(data.paintFormulaComponents.map(c => c.itemId)));
      const items = await this.prisma.item.findMany({
        where: { id: { in: itemIds } },
        include: { measures: true },
      });
      const itemMap = new Map(items.map(item => [item.id, item]));

      // Validate each component
      for (let index = 0; index < data.paintFormulaComponents.length; index++) {
        const componentData = data.paintFormulaComponents[index];
        const item = itemMap.get(componentData.itemId);
        if (!item) {
          validationErrors.push({
            index,
            data: componentData,
            error: `Item ${componentData.itemId} não encontrado`,
            errorCode: 'ITEM_NOT_FOUND',
          });
          continue;
        }

        // Validate component compatibility
        try {
          await this.validateComponentCompatibility(
            componentData.itemId,
            componentData.formulaPaintId,
            this.prisma,
          );
        } catch (error: any) {
          validationErrors.push({
            index,
            data: componentData,
            error: error.message || 'Componente não é compatível com a tinta',
            errorCode: 'COMPONENT_INCOMPATIBLE',
          });
          continue;
        }

        // Validate item has required measures
        const weightMeasure = item.measures?.find(
          (m: any) => m.measureType === 'WEIGHT' && m.unit === 'GRAM',
        );
        const volumeMeasure = item.measures?.find(
          (m: any) => m.measureType === 'VOLUME' && m.unit === 'MILLILITER',
        );

        if (!weightMeasure || !volumeMeasure) {
          validationErrors.push({
            index,
            data: componentData,
            error: `Item ${(item as any).name} precisa ter medidas de peso (GRAM) e volume (MILLILITER)`,
            errorCode: 'MISSING_MEASURES',
          });
        } else {
          // Handle nullable measure values
          const weightValue = (weightMeasure as any)?.value ?? 0;
          const volumeValue = (volumeMeasure as any)?.value ?? 0;

          if (weightValue <= 0 || volumeValue <= 0) {
            validationErrors.push({
              index,
              data: componentData,
              error:
                `Item ${(item as any).name} precisa ter valores positivos para peso e volume. ` +
                `Peso atual: ${weightValue}g, Volume atual: ${volumeValue}ml`,
              errorCode: 'INVALID_MEASURE_VALUES',
            });
          }
        }
      }

      // If there are validation errors, handle them
      if (validationErrors.length > 0) {
        const validItems = data.paintFormulaComponents.filter(
          (_, index) => !validationErrors.some(e => e.index === index),
        );

        if (validItems.length === 0) {
          // All items failed validation
          return {
            success: true,
            message: `Nenhum componente criado. ${validationErrors.length} falharam na validação.`,
            data: {
              success: [],
              failed: validationErrors,
              totalProcessed: data.paintFormulaComponents.length,
              totalSuccess: 0,
              totalFailed: validationErrors.length,
            },
          };
        }

        // Continue with valid items only
        data = { ...data, paintFormulaComponents: validItems };
      }

      const result = await this.prisma.$transaction(async transaction => {
        // Validate total weights by formula (ratios will be calculated)
        const formulaWeights = new Map<string, number>();
        for (const comp of data.paintFormulaComponents) {
          const currentWeight = formulaWeights.get(comp.formulaPaintId) || 0;
          formulaWeights.set(comp.formulaPaintId, currentWeight + comp.weight);
        }

        // Note: Weight validation removed since ratios are now calculated from weights

        const batchResult = await this.paintFormulaComponentRepository.createManyWithTransaction(
          transaction,
          data.paintFormulaComponents,
          { include },
        );

        // Group by formula to recalculate ratios and update formula
        const formulaIds = new Set<string>();

        // Log creation for each successful component
        for (const component of batchResult.success) {
          formulaIds.add(component.formulaPaintId);

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA_COMPONENT,
            entityId: component.id,
            action: CHANGE_ACTION.CREATE,
            reason: 'Componente da fórmula criado em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_CREATE,
            triggeredById: component.id,
            userId: userId || 'system',
            transaction,
          });
        }

        // Recalculate ratios and update formula for each affected formula
        for (const formulaId of Array.from(formulaIds)) {
          await this.recalculateFormulaComponentRatios(
            formulaId,
            transaction,
            userId,
            CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_CREATE,
            formulaId,
          );
          await this.updateFormulaDensityAndCost(
            formulaId,
            transaction,
            userId,
            CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_CREATE,
            formulaId,
          );

          const componentsCount = batchResult.success.filter(
            c => c.formulaPaintId === formulaId,
          ).length;
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA,
            entityId: formulaId,
            action: CHANGE_ACTION.UPDATE,
            field: 'components',
            reason: `${componentsCount} componente(s) adicionado(s) à fórmula em lote`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_CREATE,
            triggeredById: formulaId,
            userId: userId || 'system',
            transaction,
          });
        }

        return batchResult;
      });

      const totalFailed = validationErrors.length + result.totalFailed;
      const successMessage =
        result.totalCreated === 1
          ? '1 componente da fórmula criado com sucesso'
          : `${result.totalCreated} componentes da fórmula criados com sucesso`;
      const failureMessage = totalFailed > 0 ? `, ${totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult format and merge with validation errors
      const allFailed = [
        ...validationErrors,
        ...result.failed.map((error: any) => ({
          index:
            error.index ||
            validationErrors.length + result.success.findIndex((s: any) => s.id === error.id),
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
      ];

      const batchOperationResult = {
        success: result.success,
        failed: allFailed,
        totalProcessed: result.totalCreated + totalFailed,
        totalSuccess: result.totalCreated,
        totalFailed: totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro ao criar componentes da fórmula em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar componentes da fórmula em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchUpdate(
    data: PaintFormulaComponentBatchUpdateFormData,
    include?: PaintFormulaComponentInclude,
    userId?: string,
  ): Promise<PaintFormulaComponentBatchUpdateResponse<PaintFormulaComponentUpdateFormData>> {
    try {
      // Validate unique constraints for each item
      const validationErrors: Array<{
        index: number;
        id: string;
        data: PaintFormulaComponentUpdateFormData & { id: string };
        error: string;
        errorCode?: string;
      }> = [];

      // If there are validation errors, handle them
      if (validationErrors.length > 0) {
        const validItems = data.paintFormulaComponents.filter(
          (_, index) => !validationErrors.some(e => e.index === index),
        );

        if (validItems.length === 0) {
          // All items failed validation
          return {
            success: true,
            message: `Nenhum componente atualizado. ${validationErrors.length} falharam na validação.`,
            data: {
              success: [],
              failed: validationErrors,
              totalProcessed: data.paintFormulaComponents.length,
              totalSuccess: 0,
              totalFailed: validationErrors.length,
            },
          };
        }

        // Continue with valid items only
        data = { ...data, paintFormulaComponents: validItems };
      }

      const result = await this.prisma.$transaction(async transaction => {
        // Pre-fetch existing components to check for changes
        const componentIds = data.paintFormulaComponents.map(c => c.id);
        const existingComponents = await transaction.paintFormulaComponent.findMany({
          where: { id: { in: componentIds } },
          include: { item: true },
        });
        const existingMap = new Map(existingComponents.map(c => [c.id, c]));

        // Validate ratios for each component
        const formulaRatios = new Map<string, number>();

        for (const updateData of data.paintFormulaComponents) {
          const existing = existingMap.get(updateData.id);
          if (!existing) continue;

          if ((updateData.data as any).ratio !== undefined) {
            // Get current formula total excluding this component
            const allComponents = await transaction.paintFormulaComponent.findMany({
              where: { formulaPaintId: (existing as any).formulaPaintId },
            });

            const currentTotalRatio = allComponents
              .filter(comp => comp.id !== updateData.id)
              .reduce((sum, comp) => sum + comp.ratio, 0);

            const newTotalRatio = currentTotalRatio + (updateData.data as any).ratio;

            if (newTotalRatio > 100.01) {
              // Allow small floating point error
              throw new BadRequestException(
                `Componente ${updateData.id}: soma das proporções (${newTotalRatio.toFixed(2)}%) excede 100%`,
              );
            }
          }
        }

        // Ensure all items have required id and data fields
        const validatedItems = data.paintFormulaComponents.map(item => ({
          id: item.id!,
          data: item.data!,
        }));
        const batchResult = await this.paintFormulaComponentRepository.updateManyWithTransaction(
          transaction,
          validatedItems,
          { include },
        );

        // Group by formula to recalculate ratios and update formula
        const formulaIds = new Set<string>();

        // Log update for each successful component
        for (const component of batchResult.success) {
          formulaIds.add(component.formulaPaintId);

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA_COMPONENT,
            entityId: component.id,
            action: CHANGE_ACTION.UPDATE,
            reason: 'Componente da fórmula atualizado em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_UPDATE,
            triggeredById: component.id,
            userId: userId || 'system',
            transaction,
          });
        }

        // Recalculate ratios and update formula for each affected formula
        for (const formulaId of Array.from(formulaIds)) {
          await this.recalculateFormulaComponentRatios(
            formulaId,
            transaction,
            userId,
            CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_UPDATE,
            formulaId,
          );
          await this.updateFormulaDensityAndCost(
            formulaId,
            transaction,
            userId,
            CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_UPDATE,
            formulaId,
          );

          const componentsCount = batchResult.success.filter(
            c => c.formulaPaintId === formulaId,
          ).length;
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA,
            entityId: formulaId,
            action: CHANGE_ACTION.UPDATE,
            field: 'components',
            reason: `${componentsCount} componente(s) atualizado(s) na fórmula em lote`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_UPDATE,
            triggeredById: formulaId,
            userId: userId || 'system',
            transaction,
          });
        }

        return batchResult;
      });

      const totalFailed = validationErrors.length + result.totalFailed;
      const successMessage =
        result.totalUpdated === 1
          ? '1 componente da fórmula atualizado com sucesso'
          : `${result.totalUpdated} componentes da fórmula atualizados com sucesso`;
      const failureMessage = totalFailed > 0 ? `, ${totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format and merge with validation errors
      const allFailed = [
        ...validationErrors,
        ...result.failed.map((error: any) => ({
          index:
            error.index ||
            validationErrors.length + result.success.findIndex((s: any) => s.id === error.id),
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: {
            ...error.data,
            id: error.id || '',
          },
        })),
      ];

      const batchOperationResult = {
        success: result.success,
        failed: allFailed,
        totalProcessed: result.totalUpdated + totalFailed,
        totalSuccess: result.totalUpdated,
        totalFailed: totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar componentes da fórmula em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar componentes da fórmula em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: PaintFormulaComponentBatchDeleteFormData,
    userId?: string,
  ): Promise<PaintFormulaComponentBatchDeleteResponse> {
    try {
      // First get the components to know which formulas they belong to
      const componentsToDelete = await this.paintFormulaComponentRepository.findByIds(
        data.paintFormulaComponentIds,
      );
      const formulaIds = new Set(componentsToDelete.map(c => c.formulaPaintId));

      const result = await this.prisma.$transaction(async transaction => {
        const batchResult = await this.paintFormulaComponentRepository.deleteManyWithTransaction(
          transaction,
          data.paintFormulaComponentIds,
        );

        // Log deletion for each successful component
        for (const deleted of batchResult.success) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA_COMPONENT,
            entityId: deleted.id,
            action: CHANGE_ACTION.DELETE,
            reason: 'Componente da fórmula deletado em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_DELETE,
            triggeredById: deleted.id,
            userId: userId || 'system',
            transaction,
          });
        }

        // Recalculate ratios and update formula for each affected formula
        for (const formulaId of Array.from(formulaIds)) {
          await this.recalculateFormulaComponentRatios(
            formulaId,
            transaction,
            userId,
            CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_DELETE,
            formulaId,
          );
          await this.updateFormulaDensityAndCost(
            formulaId,
            transaction,
            userId,
            CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_DELETE,
            formulaId,
          );

          const deletedCount = batchResult.success.length;
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA,
            entityId: formulaId,
            action: CHANGE_ACTION.UPDATE,
            field: 'components',
            reason: `${deletedCount} componente(s) removido(s) da fórmula em lote`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_DELETE,
            triggeredById: formulaId,
            userId: userId || 'system',
            transaction,
          });
        }

        return batchResult;
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 componente da fórmula deletado com sucesso'
          : `${result.totalDeleted} componentes da fórmula deletados com sucesso`;
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
      this.logger.error('Erro ao deletar componentes da fórmula em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao deletar componentes da fórmula em lote. Por favor, tente novamente.',
      );
    }
  }
}
