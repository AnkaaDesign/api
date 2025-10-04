import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  ACTIVITY_REASON,
  CHANGE_TRIGGERED_BY,
  ACTIVITY_OPERATION,
  MEASURE_UNIT,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../constants/enums';
import {
  scaleFormulaForProduction,
  calculateVolumeFromWeight,
  calculateWeightFromVolume,
  validateComponentForFormula,
  calculateFormulaCost,
} from '../../utils/paint';
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
  PaintProductionCreateFormData,
  PaintProductionUpdateFormData,
  PaintProductionBatchCreateFormData,
  PaintProductionBatchUpdateFormData,
  PaintProductionBatchDeleteFormData,
  PaintProductionGetManyFormData,
  PaintProductionInclude,
} from '../../schemas/paint';
import {
  PaintProduction,
  PaintProductionGetUniqueResponse,
  PaintProductionGetManyResponse,
  PaintProductionCreateResponse,
  PaintProductionUpdateResponse,
  PaintProductionDeleteResponse,
  PaintProductionBatchCreateResponse,
  PaintProductionBatchUpdateResponse,
  PaintProductionBatchDeleteResponse,
} from '../../types';
import { PaintProductionRepository } from './repositories/paint-production/paint-production.repository';
import { ActivityService } from '@modules/inventory/activity/activity.service';

@Injectable()
export class PaintProductionService {
  private readonly logger = new Logger(PaintProductionService.name);

  constructor(
    private paintProductionRepository: PaintProductionRepository,
    private changeLogService: ChangeLogService,
    private prisma: PrismaService,
    @Inject(forwardRef(() => ActivityService))
    private activityService: ActivityService,
  ) {}

  /**
   * Volume-based validation for paint production
   * Works directly with volume ratios without weight conversion
   */
  private async paintProductionVolumeValidation(
    paintId: string,
    formulaId: string,
    requestedVolumeLiters: number,
    transaction: any,
  ): Promise<{
    totalCost: number;
    componentDetails: Array<{
      itemId: string;
      itemName: string;
      requiredVolume: number;
      availableQuantity: number;
      measureUnit: string;
    }>;
  }> {
    // Validate requested volume
    if (requestedVolumeLiters <= 0) {
      throw new BadRequestException('Volume solicitado deve ser positivo.');
    }

    // Get formula with components and validate it belongs to the paint
    const formula = await transaction.paintFormula.findUnique({
      where: { id: formulaId },
      include: {
        paint: true,
        components: {
          include: {
            item: {
              include: {
                prices: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
                measures: true,
              },
            },
          },
        },
      },
    });

    if (!formula) {
      throw new NotFoundException('Fórmula não encontrada.');
    }

    if (formula.paintId !== paintId) {
      throw new BadRequestException('A fórmula não pertence à tinta especificada.');
    }

    if (!formula.components || formula.components.length === 0) {
      throw new BadRequestException('Fórmula não possui componentes cadastrados.');
    }

    // Validate stock availability and prepare component details
    const componentDetails: Array<{
      itemId: string;
      itemName: string;
      requiredVolume: number;
      availableQuantity: number;
      measureUnit: string;
    }> = [];
    const stockErrors: string[] = [];
    let totalCost = 0;

    for (const component of formula.components) {
      if (!component?.item) continue;

      const item = component.item;
      const componentVolumeNeeded = requestedVolumeLiters * (component.ratio / 100);

      // Convert component volume to item units
      let unitsNeeded = componentVolumeNeeded; // Default: 1 unit = 1 liter
      let measureUnit = 'LITER';

      // Check if item has weight measures (for powder/solid components)
      const weightMeasure = item.measures?.find(m => m.measureType === 'WEIGHT');
      const volumeMeasure = item.measures?.find(m => m.measureType === 'VOLUME');

      if (weightMeasure && weightMeasure.value) {
        // For weight-based items, convert volume to weight using formula density
        const formulaDensity = Number(formula.density) || 1.0; // g/ml
        const componentWeightNeeded = componentVolumeNeeded * 1000 * formulaDensity; // Convert L to ml, then to g

        // Convert weight to units based on item's weight measure
        if (weightMeasure.unit === 'KILOGRAM') {
          const weightPerUnitGrams = weightMeasure.value * 1000; // Convert kg to g
          unitsNeeded = componentWeightNeeded / weightPerUnitGrams;
          measureUnit = 'KILOGRAM';
        } else if (weightMeasure.unit === 'GRAM') {
          unitsNeeded = componentWeightNeeded / weightMeasure.value;
          measureUnit = 'GRAM';
        }
      } else if (volumeMeasure && volumeMeasure.value) {
        if (volumeMeasure.unit === 'MILLILITER') {
          unitsNeeded = (componentVolumeNeeded * 1000) / volumeMeasure.value;
          measureUnit = 'MILLILITER';
        } else if (volumeMeasure.unit === 'LITER') {
          unitsNeeded = componentVolumeNeeded / volumeMeasure.value;
          measureUnit = 'LITER';
        }
      }

      // Check stock availability
      if (item.quantity < unitsNeeded) {
        const shortage = unitsNeeded - item.quantity;
        stockErrors.push(
          `Estoque insuficiente para "${item.name}". ` +
            `Necessário: ${unitsNeeded.toFixed(2)} unidades (${componentVolumeNeeded.toFixed(3)}L), ` +
            `Disponível: ${item.quantity.toFixed(0)} unidades, ` +
            `Faltam: ${shortage.toFixed(2)} unidades`,
        );
      }

      // Calculate cost
      const latestPrice = item.price?.[0]?.value || 0;
      const componentCost = unitsNeeded * latestPrice;
      totalCost += componentCost;

      componentDetails.push({
        itemId: item.id,
        itemName: item.name,
        requiredVolume: componentVolumeNeeded,
        availableQuantity: item.quantity,
        measureUnit,
      });
    }

    if (stockErrors.length > 0) {
      throw new BadRequestException(`Validação de estoque falhou:\n${stockErrors.join('\n')}`);
    }

    // Log the validation details for audit
    this.logger.log(
      `Validação aprovada para produção de ${requestedVolumeLiters}L ` +
        `da fórmula ${formulaId}. Custo total: R$ ${totalCost.toFixed(2)}`,
    );

    return {
      totalCost,
      componentDetails,
    };
  }

  /**
   * Enhanced validation for paint production using weight/volume calculations
   * Returns required weight and calculated volume with improved accuracy
   * @deprecated Use paintProductionVolumeValidation instead
   */
  private async paintProductionValidation(
    paintId: string,
    formulaId: string,
    requestedWeight: number,
    transaction: any,
  ): Promise<{
    totalCost: number;
    calculatedVolume: number;
    componentDetails: Array<{
      itemId: string;
      itemName: string;
      requiredWeight: number;
      availableQuantity: number;
      measureUnit: string;
    }>;
  }> {
    // Validate requested weight
    if (requestedWeight <= 0) {
      throw new BadRequestException('Peso solicitado deve ser positivo.');
    }

    // Get formula with components and validate it belongs to the paint
    const formula = await transaction.paintFormula.findUnique({
      where: { id: formulaId },
      include: {
        paint: true,
        components: {
          include: {
            item: {
              include: {
                prices: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
                measures: true,
              },
            },
          },
        },
      },
    });

    if (!formula) {
      throw new NotFoundException('Fórmula não encontrada.');
    }

    if (formula.paintId !== paintId) {
      throw new BadRequestException('A fórmula não pertence à tinta especificada.');
    }

    if (!formula.components || formula.components.length === 0) {
      throw new BadRequestException('Fórmula não possui componentes cadastrados.');
    }

    if (!formula.density || formula.density <= 0) {
      throw new BadRequestException('Fórmula não possui densidade cadastrada.');
    }

    // Validate all components can be used in formulas
    const componentValidationErrors: string[] = [];
    for (const component of formula.components) {
      const validation = validateComponentForFormula(component as any);
      if (!validation.isValid) {
        componentValidationErrors.push(...validation.errors);
      }
    }

    if (componentValidationErrors.length > 0) {
      throw new BadRequestException(
        `Componentes da fórmula têm problemas de configuração:\n${componentValidationErrors.join('\n')}`,
      );
    }

    // Use enhanced scaling calculation
    const scaledComponents = scaleFormulaForProduction(formula.components as any, requestedWeight);

    // Calculate volume from weight using density (g/ml to ml)
    const calculatedVolume = calculateVolumeFromWeight(requestedWeight, formula.density);

    // Calculate cost using enhanced cost calculation
    const costAnalysis = calculateFormulaCost(formula.components as any, requestedWeight);

    // Validate stock availability and prepare component details
    const componentDetails: Array<{
      itemId: string;
      itemName: string;
      requiredWeight: number;
      availableQuantity: number;
      measureUnit: string;
    }> = [];
    const stockErrors: string[] = [];

    for (const scaledComp of scaledComponents) {
      const component = formula.components.find(c => c.id === scaledComp.componentId);
      if (!component?.item) continue;

      const item = component.item;

      // Get weight per unit from item measures
      let weightPerUnit = 0;
      const weightMeasure = item.measures?.find(m => m.measureType === 'WEIGHT');
      if (weightMeasure) {
        // Convert to grams if needed
        if (weightMeasure.unit === 'KILOGRAM') {
          weightPerUnit = weightMeasure.value * 1000;
        } else if (weightMeasure.unit === 'GRAM') {
          weightPerUnit = weightMeasure.value;
        }
      }

      const availableWeightGrams = item.quantity * weightPerUnit;
      const requiredWeightGrams = scaledComp.scaledWeight;

      // Check stock availability by comparing weights (more reliable than unit conversion)
      if (availableWeightGrams < requiredWeightGrams) {
        const shortageGrams = requiredWeightGrams - availableWeightGrams;
        const shortageUnits = weightPerUnit > 0 ? shortageGrams / weightPerUnit : 0;

        // Calculate required units for display
        const requiredUnits =
          weightPerUnit > 0 ? requiredWeightGrams / weightPerUnit : scaledComp.requiredQuantity;

        stockErrors.push(
          `Estoque insuficiente para "${item.name}". ` +
            `Necessário: ${requiredWeightGrams.toFixed(2)}g (${requiredUnits.toFixed(2)} unidades), ` +
            `Disponível: ${availableWeightGrams.toFixed(2)}g (${item.quantity.toFixed(0)} unidades), ` +
            `Faltam: ${shortageGrams.toFixed(2)}g (${shortageUnits.toFixed(2)} unidades)`,
        );
      }

      componentDetails.push({
        itemId: item.id,
        itemName: item.name,
        requiredWeight: scaledComp.scaledWeight,
        availableQuantity: item.quantity,
        measureUnit: item.measureUnit || 'GRAM',
      });
    }

    if (stockErrors.length > 0) {
      throw new BadRequestException(`Validação de estoque falhou:\n${stockErrors.join('\n')}`);
    }

    // Log the validation details for audit
    this.logger.log(
      `Validação aprovada para produção de ${requestedWeight}g (${calculatedVolume.toFixed(2)}ml) ` +
        `da fórmula ${formulaId}. Custo total: R$ ${costAnalysis.totalCost.toFixed(2)}`,
    );

    return {
      totalCost: costAnalysis.totalCost,
      calculatedVolume,
      componentDetails,
    };
  }

  async create(
    data: PaintProductionCreateFormData,
    include?: PaintProductionInclude,
    userId?: string,
  ): Promise<PaintProductionCreateResponse> {
    const production = await this.prisma.$transaction(async transaction => {
      // First get the formula to find the paint ID and density
      const formula = await transaction.paintFormula.findUnique({
        where: { id: data.formulaId },
        select: {
          paintId: true,
          density: true,
          components: {
            include: {
              item: {
                include: {
                  measures: true,
                },
              },
            },
          },
        },
      });

      if (!formula) {
        throw new NotFoundException('Fórmula não encontrada.');
      }

      // Work directly with volume - no need to convert to weight
      // Validate that we have enough components for the requested volume
      const validation = await this.paintProductionVolumeValidation(
        formula.paintId,
        data.formulaId,
        data.volumeLiters, // Work directly with volume in liters
        transaction,
      );

      // Create the production record with the original volume input (preserve user input)
      const productionData = {
        ...data,
        // Keep the original volumeLiters from user input - don't recalculate
      };
      const created = await this.paintProductionRepository.createWithTransaction(
        transaction,
        productionData,
        { include },
      );

      // Deduct inventory based on volume ratios for each component
      this.logger.debug(
        `Production volume: ${data.volumeLiters}L, Formula density: ${Number(formula.density) || 1.0} g/ml`,
      );

      for (const component of formula.components) {
        if (!component?.item) continue;

        // Calculate component volume based on ratio (component.ratio is percentage)
        const componentVolumeNeeded = data.volumeLiters * (component.ratio / 100);

        // Convert component volume to item units based on item's measure type
        let unitsToDeduct = 0;

        // Check if item has weight measures (for powder/solid components)
        const weightMeasure = component.item.measures?.find(m => m.measureType === 'WEIGHT');
        const volumeMeasure = component.item.measures?.find(m => m.measureType === 'VOLUME');

        if (weightMeasure && weightMeasure.value) {
          // For weight-based items (powder/solid components), calculate the outbound quantity:
          // 1. Calculate component volume based on formula ratio
          // 2. Convert volume to weight using formula density
          // 3. Divide weight needed by weight per unit to get units to deduct
          //
          // Example: If a component has 3kg per unit and the production needs 3kg:
          //   - unitsToDeduct = 3000g / 3000g = 1 unit
          // Example: If the production needs 300g:
          //   - unitsToDeduct = 300g / 3000g = 0.1 unit

          const formulaDensity = Number(formula.density) || 1.0; // g/ml
          const componentWeightNeeded = componentVolumeNeeded * 1000 * formulaDensity; // Convert L to ml, then to g

          // Log calculation details for debugging
          this.logger.debug(
            `Component ${component.item.name}: Volume needed: ${componentVolumeNeeded}L, Weight needed: ${componentWeightNeeded}g`,
          );
          this.logger.debug(`Weight measure: ${weightMeasure.value} ${weightMeasure.unit}`);

          // Convert weight to units based on item's weight measure
          if (weightMeasure.unit === 'KILOGRAM') {
            const weightPerUnitGrams = weightMeasure.value * 1000; // Convert kg to g
            unitsToDeduct = componentWeightNeeded / weightPerUnitGrams;
            this.logger.debug(
              `Units to deduct: ${componentWeightNeeded}g / ${weightPerUnitGrams}g = ${unitsToDeduct} units`,
            );
          } else if (weightMeasure.unit === 'GRAM') {
            unitsToDeduct = componentWeightNeeded / weightMeasure.value;
            this.logger.debug(
              `Units to deduct: ${componentWeightNeeded}g / ${weightMeasure.value}g = ${unitsToDeduct} units`,
            );
          }
        } else if (volumeMeasure && volumeMeasure.value) {
          // For volume-based items, use volume directly
          if (volumeMeasure.unit === 'MILLILITER') {
            unitsToDeduct = (componentVolumeNeeded * 1000) / volumeMeasure.value; // Convert L to mL then to units
          } else if (volumeMeasure.unit === 'LITER') {
            unitsToDeduct = componentVolumeNeeded / volumeMeasure.value; // Convert L to units
          }
          this.logger.debug(
            `Component ${component.item.name}: Volume measure: ${volumeMeasure.value} ${volumeMeasure.unit}, Units to deduct: ${unitsToDeduct}`,
          );
        } else {
          // Default: assume 1 unit = 1 liter if no measures defined
          unitsToDeduct = componentVolumeNeeded;
          this.logger.warn(
            `Component ${component.item.name}: No weight or volume measures defined, using default 1 unit = 1L`,
          );
        }

        // Round to 4 decimal places for better precision and ensure it's positive
        unitsToDeduct = Math.max(0, Math.round(unitsToDeduct * 10000) / 10000);

        // For now, keep the original approach until we can properly integrate with activity service
        // The issue is that activity service create doesn't accept transaction parameter

        // Store original quantity for changelog
        const originalQuantity = component.item.quantity;
        const newQuantity = originalQuantity - unitsToDeduct;

        // Create activity record
        await transaction.activity.create({
          data: {
            itemId: component.itemId,
            quantity: unitsToDeduct,
            operation: ACTIVITY_OPERATION.OUTBOUND,
            reason: ACTIVITY_REASON.PAINT_PRODUCTION,
            reasonOrder: 12, // Paint production
            userId: userId || null,
          },
        });

        // Update item quantity
        await transaction.item.update({
          where: { id: component.itemId },
          data: {
            quantity: {
              decrement: unitsToDeduct,
            },
          },
        });

        // Manually trigger monthly consumption recalculation
        try {
          // Call the activity service method directly on the transaction
          await this.activityService['calculateAndUpdateItemMonthlyConsumption'](
            transaction,
            component.itemId,
            userId,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to update monthly consumption for item ${component.itemId}:`,
            error,
          );
        }

        // Log individual component inventory impact
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ITEM,
          entityId: component.itemId,
          action: CHANGE_ACTION.UPDATE,
          field: 'quantity',
          oldValue: originalQuantity,
          newValue: newQuantity,
          reason: `Inventário deduzido para produção de tinta: ${unitsToDeduct.toFixed(2)} unidades para ${componentVolumeNeeded.toFixed(3)}L (${component.ratio.toFixed(1)}% da fórmula)`,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_CREATE,
          triggeredById: created.id,
          userId: userId || 'system',
          transaction,
        });

        // Log impact on item's related entities
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PAINT_PRODUCTION,
          entityId: created.id,
          action: CHANGE_ACTION.CREATE,
          field: 'componentImpact',
          newValue: {
            itemId: component.itemId,
            itemName: component.item.name,
            unitsUsed: unitsToDeduct,
            volumeUsed: componentVolumeNeeded,
            ratio: component.ratio,
          },
          reason: `Componente ${component.item.name} utilizado: ${unitsToDeduct.toFixed(2)} unidades`,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_CREATE,
          triggeredById: created.id,
          userId: userId || 'system',
          transaction,
        });
      }

      // Log the creation
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PAINT_PRODUCTION,
        entityId: created.id,
        action: CHANGE_ACTION.CREATE,
        entity: extractEssentialFields(
          created,
          getEssentialFields(ENTITY_TYPE.PAINT_PRODUCTION) as (keyof typeof created)[],
        ),
        reason: `Nova produção de tinta criada - Volume: ${data.volumeLiters.toFixed(3)}L`,
        userId: userId || 'system',
        triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_CREATE,
        transaction,
      });

      // Log impact on formula
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PAINT_FORMULA,
        entityId: data.formulaId,
        action: CHANGE_ACTION.UPDATE,
        field: 'productions',
        reason: 'Nova produção registrada para a fórmula',
        triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_CREATE,
        triggeredById: created.id,
        userId: userId || null,
        transaction,
      });

      return created;
    });

    if (!production) {
      throw new BadRequestException('Não foi possível criar a produção de tinta, tente novamente.');
    }

    return {
      success: true,
      message: 'Produção de tinta criada com sucesso.',
      data: production,
    };
  }

  async update(
    id: string,
    data: PaintProductionUpdateFormData,
    include?: PaintProductionInclude,
    userId?: string,
  ): Promise<PaintProductionUpdateResponse> {
    const productionExists = await this.paintProductionRepository.findById(id, {
      include: {
        formula: {
          include: {
            paint: true,
            components: {
              include: {
                item: true,
              },
            },
          },
        },
      },
    });

    if (!productionExists) {
      throw new NotFoundException(
        'Produção de tinta não encontrada, recarregue a página e tente novamente.',
      );
    }

    const production = await this.prisma.$transaction(async transaction => {
      let updateData: PaintProductionUpdateFormData = { ...data };

      // If volume is being updated, we need to validate the difference
      if (data.volumeLiters !== undefined && data.volumeLiters !== productionExists.volumeLiters) {
        const volumeDifference = data.volumeLiters - productionExists.volumeLiters;
        const formulaDensity = Number(productionExists.formula?.density) || 1.0;
        const weightDifference = volumeDifference * 1000 * formulaDensity; // Convert volume difference to weight

        if (weightDifference > 0) {
          // Increasing production - need to validate and deduct more inventory
          if (!productionExists.formula) {
            throw new NotFoundException('Fórmula relacionada não encontrada.');
          }

          const validation = await this.paintProductionVolumeValidation(
            productionExists.formula.paintId,
            productionExists.formulaId,
            volumeDifference, // Only validate the additional volume
            transaction,
          );

          // Volume is already provided in the update data - preserve it
          // The validation already confirmed we have enough inventory

          // Deduct additional inventory based on volume difference
          for (const componentDetail of validation.componentDetails) {
            // Get the component to find its ratio
            const component = await transaction.paintFormulaComponent.findFirst({
              where: {
                formulaPaintId: productionExists.formulaId,
                itemId: componentDetail.itemId,
              },
            });

            if (!component) continue;

            // The validation already calculated the required quantities
            const item = await transaction.item.findUnique({
              where: { id: componentDetail.itemId },
              include: { measures: true },
            });

            if (!item) continue;

            // Store original quantity for changelog
            const originalQuantity = item.quantity;

            let quantityToDeduct = 0;

            // Check if item has weight measures (for powder/solid components)
            const weightMeasure = item.measures?.find(m => m.measureType === 'WEIGHT');
            const volumeMeasure = item.measures?.find(m => m.measureType === 'VOLUME');

            if (weightMeasure && weightMeasure.value) {
              // For weight-based items, convert volume to weight using formula density
              const formulaDensity = Number(productionExists.formula?.density) || 1.0; // g/ml
              const componentWeightNeeded = componentDetail.requiredVolume * 1000 * formulaDensity; // Convert L to ml, then to g

              // Log calculation details for debugging
              this.logger.debug(
                `Update - Component ${item.name}: Volume needed: ${componentDetail.requiredVolume}L, Weight needed: ${componentWeightNeeded}g`,
              );
              this.logger.debug(`Weight measure: ${weightMeasure.value} ${weightMeasure.unit}`);

              // Convert weight to units based on item's weight measure
              if (weightMeasure.unit === 'KILOGRAM') {
                const weightPerUnitGrams = weightMeasure.value * 1000; // Convert kg to g
                quantityToDeduct = componentWeightNeeded / weightPerUnitGrams;
                this.logger.debug(
                  `Units to deduct: ${componentWeightNeeded}g / ${weightPerUnitGrams}g = ${quantityToDeduct} units`,
                );
              } else if (weightMeasure.unit === 'GRAM') {
                quantityToDeduct = componentWeightNeeded / weightMeasure.value;
                this.logger.debug(
                  `Units to deduct: ${componentWeightNeeded}g / ${weightMeasure.value}g = ${quantityToDeduct} units`,
                );
              }
            } else if (volumeMeasure && volumeMeasure.value) {
              // For volume-based items, use volume directly
              if (volumeMeasure.unit === 'MILLILITER') {
                quantityToDeduct = (componentDetail.requiredVolume * 1000) / volumeMeasure.value;
              } else if (volumeMeasure.unit === 'LITER') {
                quantityToDeduct = componentDetail.requiredVolume / volumeMeasure.value;
              }
              this.logger.debug(
                `Update - Component ${item.name}: Volume measure: ${volumeMeasure.value} ${volumeMeasure.unit}, Units to deduct: ${quantityToDeduct}`,
              );
            } else {
              // Default: assume 1 unit = 1 liter if no measures defined
              quantityToDeduct = componentDetail.requiredVolume;
              this.logger.warn(
                `Update - Component ${item.name}: No weight or volume measures defined, using default 1 unit = 1L`,
              );
            }

            // Round to 4 decimal places for better precision
            quantityToDeduct = Math.max(0, Math.round(quantityToDeduct * 10000) / 10000);
            const newQuantity = originalQuantity - quantityToDeduct;

            await transaction.activity.create({
              data: {
                itemId: componentDetail.itemId,
                quantity: quantityToDeduct,
                operation: ACTIVITY_OPERATION.OUTBOUND,
                reason: ACTIVITY_REASON.PAINT_PRODUCTION,
                reasonOrder: 2,
                userId: userId || null,
              },
            });

            await transaction.item.update({
              where: { id: componentDetail.itemId },
              data: {
                quantity: {
                  decrement: quantityToDeduct,
                },
              },
            });

            // Log individual component inventory impact for volume increase
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.ITEM,
              entityId: componentDetail.itemId,
              action: CHANGE_ACTION.UPDATE,
              field: 'quantity',
              oldValue: originalQuantity,
              newValue: newQuantity,
              reason: `Inventário adicional deduzido para aumento de produção: ${quantityToDeduct.toFixed(2)} unidades para ${componentDetail.requiredVolume.toFixed(3)}L adicional`,
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_UPDATE,
              triggeredById: id,
              userId: userId || 'system',
              transaction,
            });

            // Log impact on production entity
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.PAINT_PRODUCTION,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'componentImpact',
              newValue: {
                itemId: componentDetail.itemId,
                itemName: componentDetail.itemName,
                additionalUnitsUsed: quantityToDeduct,
                additionalVolumeUsed: componentDetail.requiredVolume,
                operationType: 'INCREASE',
              },
              reason: `Componente ${componentDetail.itemName}: ${quantityToDeduct.toFixed(2)} unidades adicionais utilizadas`,
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_UPDATE,
              triggeredById: id,
              userId: userId || 'system',
              transaction,
            });
          }
        } else if (volumeDifference < 0) {
          // Decreasing production - return inventory based on volume reduction
          if (!productionExists.formula || !productionExists.formula.components) {
            throw new NotFoundException('Fórmula ou componentes não encontrados.');
          }

          // Volume is already provided in the update data - preserve it
          const volumeToReturn = Math.abs(volumeDifference);

          for (const component of productionExists.formula.components) {
            // Calculate how much volume to return based on component ratio
            const componentRatio = component.ratio / 100; // Convert percentage to decimal
            const returnVolume = volumeToReturn * componentRatio;

            // Get current item quantity for changelog
            const currentItem = await transaction.item.findUnique({
              where: { id: component.itemId },
              include: { measures: true },
            });

            if (!currentItem) continue;

            const originalQuantity = currentItem.quantity;

            // Calculate quantity to return based on item's volume unit
            let returnQuantity = returnVolume; // Default: 1 unit = 1 liter

            if (component.item) {
              // Try to get the appropriate volume measure for this item
              const volumeMeasure = component.item.measures?.find(m => m.measureType === 'VOLUME');
              if (volumeMeasure && volumeMeasure.value) {
                // Convert to item's volume unit
                if (volumeMeasure.unit === 'MILLILITER') {
                  returnQuantity = (returnVolume * 1000) / volumeMeasure.value;
                } else if (volumeMeasure.unit === 'LITER') {
                  returnQuantity = returnVolume / volumeMeasure.value;
                }
              }
            }

            // Round to 2 decimal places
            returnQuantity = Math.round(returnQuantity * 100) / 100;
            const newQuantity = originalQuantity + returnQuantity;

            await transaction.activity.create({
              data: {
                itemId: component.itemId,
                quantity: returnQuantity,
                operation: ACTIVITY_OPERATION.INBOUND,
                reason: ACTIVITY_REASON.RETURN,
                reasonOrder: 5, // RETURN
                userId: userId || null,
              },
            });

            await transaction.item.update({
              where: { id: component.itemId },
              data: {
                quantity: {
                  increment: returnQuantity,
                },
              },
            });

            // Log individual component inventory impact for volume decrease
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.ITEM,
              entityId: component.itemId,
              action: CHANGE_ACTION.UPDATE,
              field: 'quantity',
              oldValue: originalQuantity,
              newValue: newQuantity,
              reason: `Inventário retornado devido à redução de produção: ${returnQuantity.toFixed(2)} unidades retornadas de ${returnVolume.toFixed(3)}L reduzido (${component.ratio.toFixed(1)}% da fórmula)`,
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_UPDATE,
              triggeredById: id,
              userId: userId || 'system',
              transaction,
            });

            // Log impact on production entity
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.PAINT_PRODUCTION,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'componentImpact',
              newValue: {
                itemId: component.itemId,
                itemName: component.item?.name || 'Unknown',
                returnedUnits: returnQuantity,
                returnedVolume: returnVolume,
                ratio: component.ratio,
                operationType: 'DECREASE',
              },
              reason: `Componente ${component.item?.name || 'Unknown'}: ${returnQuantity.toFixed(2)} unidades retornadas`,
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_UPDATE,
              triggeredById: id,
              userId: userId || 'system',
              transaction,
            });
          }
        }
      }

      const updated = await this.paintProductionRepository.updateWithTransaction(
        transaction,
        id,
        updateData,
        include ? { include } : undefined,
      );

      // Log the update
      const fieldsToTrack = ['volumeLiters', 'formulaId'];
      await trackAndLogFieldChanges({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PAINT_PRODUCTION,
        entityId: id,
        oldEntity: productionExists,
        newEntity: updated,
        fieldsToTrack,
        userId: userId || 'system',
        triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_UPDATE,
        transaction,
      });

      // If formula changed, log impact on both old and new formulas
      if (data.formulaId && data.formulaId !== productionExists.formulaId) {
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PAINT_FORMULA,
          entityId: productionExists.formulaId,
          action: CHANGE_ACTION.UPDATE,
          field: 'productions',
          reason: 'Produção removida da fórmula',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_UPDATE,
          triggeredById: id,
          userId: userId || null,
          transaction,
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PAINT_FORMULA,
          entityId: data.formulaId,
          action: CHANGE_ACTION.UPDATE,
          field: 'productions',
          reason: 'Produção adicionada à fórmula',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_UPDATE,
          triggeredById: id,
          userId: userId || null,
          transaction,
        });
      }

      return updated;
    });

    return {
      success: true,
      message: 'Produção de tinta atualizada com sucesso.',
      data: production,
    };
  }

  async delete(id: string, userId?: string): Promise<PaintProductionDeleteResponse> {
    const productionExists = await this.paintProductionRepository.findById(id);

    if (!productionExists) {
      throw new NotFoundException(
        'Produção de tinta não encontrada, recarregue a página e tente novamente.',
      );
    }

    await this.prisma.$transaction(async transaction => {
      // Before deleting, return inventory for all components
      const formula = await transaction.paintFormula.findUnique({
        where: { id: productionExists.formulaId },
        include: {
          components: {
            include: {
              item: true,
            },
          },
        },
      });

      if (formula && formula.components) {
        // Calculate the production weight from volume using formula density
        const formulaDensity = Number(formula.density) || 1.0; // default density
        const totalWeight = productionExists.volumeLiters * 1000 * formulaDensity; // kg to grams

        for (const component of formula.components) {
          // Get current item quantity for changelog
          const currentItem = await transaction.item.findUnique({
            where: { id: component.itemId },
          });

          if (!currentItem) continue;

          const originalQuantity = currentItem.quantity;

          // Calculate how much to return based on component ratio
          const componentRatio = component.ratio / 100; // Convert percentage to decimal
          const returnWeight = totalWeight * componentRatio;

          // Calculate quantity to return (simplified - assuming base units)
          let returnQuantity = returnWeight / 1000; // Convert grams to kg

          // Round to 2 decimal places
          returnQuantity = Math.round(returnQuantity * 100) / 100;
          const newQuantity = originalQuantity + returnQuantity;

          await transaction.activity.create({
            data: {
              itemId: component.itemId,
              quantity: returnQuantity,
              operation: ACTIVITY_OPERATION.INBOUND,
              reason: ACTIVITY_REASON.RETURN,
              reasonOrder: 5,
              userId: userId || null,
            },
          });

          await transaction.item.update({
            where: { id: component.itemId },
            data: {
              quantity: {
                increment: returnQuantity,
              },
            },
          });

          // Log individual component inventory impact for production deletion
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.ITEM,
            entityId: component.itemId,
            action: CHANGE_ACTION.UPDATE,
            field: 'quantity',
            oldValue: originalQuantity,
            newValue: newQuantity,
            reason: `Inventário retornado devido à exclusão de produção: ${returnQuantity.toFixed(2)} unidades retornadas de ${returnWeight.toFixed(2)}g (${component.ratio.toFixed(1)}% da fórmula)`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_DELETE,
            triggeredById: id,
            userId: userId || 'system',
            transaction,
          });

          // Log impact on production entity (before deletion)
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_PRODUCTION,
            entityId: id,
            action: CHANGE_ACTION.DELETE,
            field: 'componentImpact',
            oldValue: {
              itemId: component.itemId,
              itemName: component.item?.name || 'Unknown',
              returnedUnits: returnQuantity,
              returnedWeight: returnWeight,
              ratio: component.ratio,
              operationType: 'DELETE_RETURN',
            },
            reason: `Componente ${component.item?.name || 'Unknown'}: ${returnQuantity.toFixed(2)} unidades retornadas por exclusão`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_DELETE,
            triggeredById: id,
            userId: userId || 'system',
            transaction,
          });
        }
      }

      await this.paintProductionRepository.deleteWithTransaction(transaction, id);

      // Log the deletion
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.PAINT_PRODUCTION,
        entityId: id,
        action: CHANGE_ACTION.DELETE,
        oldEntity: extractEssentialFields(
          productionExists,
          getEssentialFields(ENTITY_TYPE.PAINT_PRODUCTION) as (keyof typeof productionExists)[],
        ),
        reason: `Produção de tinta excluída - Volume: ${productionExists.volumeLiters.toFixed(3)}L`,
        userId: userId || 'system',
        triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_DELETE,
        transaction,
      });

      // Log impact on formula
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PAINT_FORMULA,
        entityId: productionExists.formulaId,
        action: CHANGE_ACTION.UPDATE,
        field: 'productions',
        reason: 'Produção removida da fórmula',
        triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_DELETE,
        triggeredById: id,
        userId: userId || null,
        transaction,
      });
    });

    return {
      success: true,
      message: 'Produção de tinta deletada com sucesso.',
    };
  }

  async findById(
    id: string,
    include?: PaintProductionInclude,
  ): Promise<PaintProductionGetUniqueResponse> {
    const production = await this.paintProductionRepository.findById(id, { include });

    if (!production) {
      throw new NotFoundException(
        'Produção de tinta não encontrada, recarregue a página e tente novamente.',
      );
    }

    return {
      success: true,
      message: 'Produção de tinta carregada com sucesso.',
      data: production,
    };
  }

  async findMany(query: PaintProductionGetManyFormData): Promise<PaintProductionGetManyResponse> {
    try {
      const result = await this.paintProductionRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Produção de tinta carregadas com sucesso',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar produção de tinta:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar produções de tintas de fórmulas de tinta. Por favor, tente novamente',
      );
    }
  }

  async batchCreate(
    data: PaintProductionBatchCreateFormData,
    include?: PaintProductionInclude,
    userId?: string,
  ): Promise<PaintProductionBatchCreateResponse<PaintProductionCreateFormData>> {
    try {
      // Pre-validate each production request
      const validationErrors: Array<{
        index: number;
        data: PaintProductionCreateFormData;
        error: string;
        errorCode?: string;
      }> = [];

      // Validate each production individually first
      for (let index = 0; index < data.paintProductions.length; index++) {
        const productionData = data.paintProductions[index];

        try {
          // Quick validation without transaction
          if (productionData.volumeLiters <= 0) {
            validationErrors.push({
              index,
              data: productionData,
              error: 'Volume solicitado deve ser positivo.',
              errorCode: 'INVALID_VOLUME',
            });
          }
        } catch (error: any) {
          validationErrors.push({
            index,
            data: productionData,
            error: error.message || 'Erro de validação',
            errorCode: 'VALIDATION_ERROR',
          });
        }
      }

      // If there are validation errors, handle them
      if (validationErrors.length > 0) {
        const validItems = data.paintProductions.filter(
          (_, index) => !validationErrors.some(e => e.index === index),
        );

        if (validItems.length === 0) {
          // All items failed validation
          return {
            success: true,
            message: `Nenhuma produção de tinta criado. ${validationErrors.length} falharam na validação.`,
            data: {
              success: [],
              failed: validationErrors,
              totalProcessed: data.paintProductions.length,
              totalSuccess: 0,
              totalFailed: validationErrors.length,
            },
          };
        }

        // Continue with valid items only
        data = { ...data, paintProductions: validItems };
      }

      const result = await this.prisma.$transaction(async transaction => {
        const successfulProductions: any[] = [];
        const failedProductions: any[] = [];

        // Process each production individually to handle validation and inventory updates
        for (let index = 0; index < data.paintProductions.length; index++) {
          const productionData = data.paintProductions[index];

          try {
            // Get formula to find paint ID
            const formula = await transaction.paintFormula.findUnique({
              where: { id: productionData.formulaId },
              select: { paintId: true },
            });

            if (!formula) {
              throw new NotFoundException('Fórmula não encontrada.');
            }

            // Validate production using volume directly
            const validation = await this.paintProductionVolumeValidation(
              formula.paintId,
              productionData.formulaId,
              productionData.volumeLiters,
              transaction,
            );

            // Create production with original volume input (preserve user input)
            const createData = {
              ...productionData,
              // Keep the original volumeLiters from user input - don't recalculate
            };
            const created = await this.paintProductionRepository.createWithTransaction(
              transaction,
              createData,
              { include },
            );

            // Deduct inventory for each component (volume-based)
            for (const componentDetail of validation.componentDetails) {
              // Get the component and formula details
              const component = await transaction.paintFormulaComponent.findFirst({
                where: {
                  formulaPaintId: productionData.formulaId,
                  itemId: componentDetail.itemId,
                },
              });

              if (!component) continue;

              // Calculate quantity to deduct based on required volume
              const componentVolumeNeeded = (productionData.volumeLiters * component.ratio) / 100;

              // Get the item to determine measure type
              const item = await transaction.item.findUnique({
                where: { id: componentDetail.itemId },
                include: { measures: true },
              });

              if (!item) continue;

              // Store original quantity for changelog
              const originalQuantity = item.quantity;

              let quantityToDeduct = 0;

              // Check if item has weight measures (for powder/solid components)
              const weightMeasure = item.measures?.find(m => m.measureType === 'WEIGHT');
              const volumeMeasure = item.measures?.find(m => m.measureType === 'VOLUME');

              // Get formula for density
              const formulaWithDensity = await transaction.paintFormula.findUnique({
                where: { id: productionData.formulaId },
                select: { density: true },
              });

              if (weightMeasure && weightMeasure.value) {
                // For weight-based items, convert volume to weight using formula density
                // Then calculate units based on weight per unit
                const formulaDensity = Number(formulaWithDensity?.density) || 1.0; // g/ml
                const componentWeightNeeded = componentVolumeNeeded * 1000 * formulaDensity; // Convert L to ml, then to g

                // Log calculation details for debugging
                this.logger.debug(
                  `Batch - Component ${item.name}: Volume needed: ${componentVolumeNeeded}L, Weight needed: ${componentWeightNeeded}g`,
                );
                this.logger.debug(`Weight measure: ${weightMeasure.value} ${weightMeasure.unit}`);

                // Convert weight to units based on item's weight measure
                if (weightMeasure.unit === 'KILOGRAM') {
                  const weightPerUnitGrams = weightMeasure.value * 1000; // Convert kg to g
                  quantityToDeduct = componentWeightNeeded / weightPerUnitGrams;
                  this.logger.debug(
                    `Units to deduct: ${componentWeightNeeded}g / ${weightPerUnitGrams}g = ${quantityToDeduct} units`,
                  );
                } else if (weightMeasure.unit === 'GRAM') {
                  quantityToDeduct = componentWeightNeeded / weightMeasure.value;
                  this.logger.debug(
                    `Units to deduct: ${componentWeightNeeded}g / ${weightMeasure.value}g = ${quantityToDeduct} units`,
                  );
                }
              } else if (volumeMeasure && volumeMeasure.value) {
                // For volume-based items, use volume directly
                if (volumeMeasure.unit === 'MILLILITER') {
                  quantityToDeduct = (componentVolumeNeeded * 1000) / volumeMeasure.value;
                } else if (volumeMeasure.unit === 'LITER') {
                  quantityToDeduct = componentVolumeNeeded / volumeMeasure.value;
                }
                this.logger.debug(
                  `Batch - Component ${item.name}: Volume measure: ${volumeMeasure.value} ${volumeMeasure.unit}, Units to deduct: ${quantityToDeduct}`,
                );
              } else {
                // Default: assume 1 unit = 1 liter if no measures defined
                quantityToDeduct = componentVolumeNeeded;
                this.logger.warn(
                  `Batch - Component ${item.name}: No weight or volume measures defined, using default 1 unit = 1L`,
                );
              }

              // Round to 4 decimal places for better precision
              quantityToDeduct = Math.max(0, Math.round(quantityToDeduct * 10000) / 10000);
              const newQuantity = originalQuantity - quantityToDeduct;

              await transaction.activity.create({
                data: {
                  itemId: componentDetail.itemId,
                  quantity: quantityToDeduct,
                  operation: ACTIVITY_OPERATION.OUTBOUND,
                  reason: ACTIVITY_REASON.PAINT_PRODUCTION,
                  reasonOrder: 2,
                  userId: userId || null,
                },
              });

              await transaction.item.update({
                where: { id: componentDetail.itemId },
                data: {
                  quantity: {
                    decrement: quantityToDeduct,
                  },
                },
              });

              // Log individual component inventory impact for batch creation
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.ITEM,
                entityId: componentDetail.itemId,
                action: CHANGE_ACTION.UPDATE,
                field: 'quantity',
                oldValue: originalQuantity,
                newValue: newQuantity,
                reason: `Inventário deduzido para produção em lote: ${quantityToDeduct.toFixed(2)} unidades para ${componentVolumeNeeded.toFixed(3)}L`,
                triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_BATCH_CREATE,
                triggeredById: created.id,
                userId: userId || 'system',
                transaction,
              });

              // Log impact on production entity
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.PAINT_PRODUCTION,
                entityId: created.id,
                action: CHANGE_ACTION.CREATE,
                field: 'componentImpact',
                newValue: {
                  itemId: componentDetail.itemId,
                  itemName: componentDetail.itemName,
                  unitsUsed: quantityToDeduct,
                  volumeUsed: componentVolumeNeeded,
                  batchOperation: true,
                },
                reason: `Componente ${componentDetail.itemName} utilizado em lote: ${quantityToDeduct.toFixed(2)} unidades`,
                triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_BATCH_CREATE,
                triggeredById: created.id,
                userId: userId || 'system',
                transaction,
              });
            }

            successfulProductions.push(created);
          } catch (error: any) {
            failedProductions.push({
              index: validationErrors.length + index,
              data: productionData,
              error: error.message || 'Erro ao criar produção',
              errorCode: error.name || 'CREATE_ERROR',
            });
          }
        }

        // Group by formula to log impact
        const formulaIds = new Set<string>();

        // Log creation for each successful production
        for (const production of successfulProductions) {
          formulaIds.add(production.formulaId);

          // Log the batch creation
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.PAINT_PRODUCTION,
            entityId: production.id,
            action: CHANGE_ACTION.CREATE,
            entity: extractEssentialFields(
              production,
              getEssentialFields(ENTITY_TYPE.PAINT_PRODUCTION),
            ),
            reason: `Produção de tinta criada em lote - Volume: ${production.volumeLiters.toFixed(3)}L`,
            userId: userId || 'system',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_BATCH_CREATE,
            transaction,
          });
        }

        // Log impact on formulas
        for (const formulaId of Array.from(formulaIds)) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA,
            entityId: formulaId,
            action: CHANGE_ACTION.UPDATE,
            field: 'productions',
            reason: 'Múltiplas produções de tinta criadas',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_BATCH_CREATE,
            triggeredById: formulaId,
            userId: userId || null,
            transaction,
          });
        }

        return {
          success: successfulProductions,
          failed: failedProductions,
          totalCreated: successfulProductions.length,
          totalFailed: failedProductions.length,
        };
      });

      const totalFailed = validationErrors.length + result.totalFailed;
      const successMessage =
        result.totalCreated === 1
          ? '1 produção de tinta da fórmula criado com sucesso'
          : `${result.totalCreated} produções de tintas da fórmula criados com sucesso`;
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
      this.logger.error('Erro ao criar produções de tintas da fórmula em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar produções de tintas da fórmula em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchUpdate(
    data: PaintProductionBatchUpdateFormData,
    include?: PaintProductionInclude,
    userId?: string,
  ): Promise<PaintProductionBatchUpdateResponse<PaintProductionUpdateFormData>> {
    try {
      // Validate unique constraints for each item
      const validationErrors: Array<{
        index: number;
        id: string;
        data: PaintProductionUpdateFormData & { id: string };
        error: string;
        errorCode?: string;
      }> = [];

      // Get existing productions with formula details for weight change validation
      const productionIds = data.paintProductions.map(p => p.id);
      const existingProductions = await this.paintProductionRepository.findByIds(productionIds, {
        include: {
          formula: {
            include: {
              paint: true,
              components: {
                include: {
                  item: true,
                },
              },
            },
          },
        },
      });

      // Create a map for easy lookup
      const existingProductionsMap = new Map(existingProductions.map(p => [p.id, p]));

      // Validate weight changes and inventory availability
      for (let i = 0; i < data.paintProductions.length; i++) {
        const updateData = data.paintProductions[i];
        const existing = existingProductionsMap.get(updateData.id);

        if (!existing) {
          validationErrors.push({
            index: i,
            id: updateData.id!,
            data: {
              ...updateData.data,
              id: updateData.id!,
            },
            error: 'Produção não encontrada',
            errorCode: 'NOT_FOUND',
          });
          continue;
        }

        // If volume is being updated and increased, validate inventory
        if (
          updateData.data.volumeLiters !== undefined &&
          updateData.data.volumeLiters > (existing as any).volumeLiters
        ) {
          const volumeDifference = updateData.data.volumeLiters - (existing as any).volumeLiters;
          const formulaDensity = Number((existing as any).formula?.density) || 1.0;
          const weightDifference = volumeDifference * 1000 * formulaDensity;

          try {
            await this.paintProductionVolumeValidation(
              existing.formula?.paintId || '',
              existing.formulaId,
              volumeDifference,
              this.prisma,
            );
          } catch (error) {
            validationErrors.push({
              index: i,
              id: updateData.id!,
              data: {
                ...updateData.data,
                id: updateData.id!,
              },
              error: error.message || 'Validação de estoque falhou',
              errorCode: 'VALIDATION_ERROR',
            });
          }
        }
      }

      // If there are validation errors, handle them
      if (validationErrors.length > 0) {
        const validItems = data.paintProductions.filter(
          (_, index) => !validationErrors.some(e => e.index === index),
        );

        if (validItems.length === 0) {
          // All items failed validation
          return {
            success: true,
            message: `Nenhuma produção de tinta atualizado. ${validationErrors.length} falharam na validação.`,
            data: {
              success: [],
              failed: validationErrors,
              totalProcessed: data.paintProductions.length,
              totalSuccess: 0,
              totalFailed: validationErrors.length,
            },
          };
        }

        // Continue with valid items only
        data = { ...data, paintProductions: validItems };
      }

      const result = await this.prisma.$transaction(async transaction => {
        // Process each update individually to handle inventory changes
        const successfulUpdates: PaintProduction[] = [];
        const failedUpdates: Array<{
          index: number;
          id: string;
          data: PaintProductionUpdateFormData & { id: string };
          error: string;
          errorCode?: string;
        }> = [];

        for (let i = 0; i < data.paintProductions.length; i++) {
          const updateItem = data.paintProductions[i];
          const existing = existingProductionsMap.get(updateItem.id);

          if (!existing) continue; // Already validated above

          try {
            let updateData: PaintProductionUpdateFormData = { ...updateItem.data };

            // Handle volume changes with inventory adjustment
            if (
              updateItem.data.volumeLiters !== undefined &&
              updateItem.data.volumeLiters !== existing.volumeLiters
            ) {
              const volumeDifference = updateItem.data.volumeLiters - existing.volumeLiters;
              const formulaDensity = Number((existing as any).formula?.density) || 1.0;
              const weightDifference = volumeDifference * 1000 * formulaDensity;

              if (weightDifference > 0) {
                // Increasing production - deduct more inventory
                const validation = await this.paintProductionVolumeValidation(
                  existing.formula?.paintId || '',
                  existing.formulaId,
                  volumeDifference,
                  transaction,
                );

                // Volume is already provided in the update data - preserve it

                // Deduct additional inventory based on volume
                for (const componentDetail of validation.componentDetails) {
                  const item = await transaction.item.findUnique({
                    where: { id: componentDetail.itemId },
                    include: { measures: true },
                  });

                  if (!item) continue;

                  let quantityToDeduct = 0;

                  // Check if item has weight measures (for powder/solid components)
                  const weightMeasure = item.measures?.find(m => m.measureType === 'WEIGHT');
                  const volumeMeasure = item.measures?.find(m => m.measureType === 'VOLUME');

                  if (weightMeasure && weightMeasure.value) {
                    // For weight-based items, convert volume to weight using formula density
                    const formulaDensity = Number((existing as any).formula?.density) || 1.0; // g/ml
                    const componentWeightNeeded =
                      componentDetail.requiredVolume * 1000 * formulaDensity; // Convert L to ml, then to g

                    // Log calculation details for debugging
                    this.logger.debug(
                      `Batch Update - Component ${item.name}: Volume needed: ${componentDetail.requiredVolume}L, Weight needed: ${componentWeightNeeded}g`,
                    );
                    this.logger.debug(
                      `Weight measure: ${weightMeasure.value} ${weightMeasure.unit}`,
                    );

                    // Convert weight to units based on item's weight measure
                    if (weightMeasure.unit === 'KILOGRAM') {
                      const weightPerUnitGrams = weightMeasure.value * 1000; // Convert kg to g
                      quantityToDeduct = componentWeightNeeded / weightPerUnitGrams;
                      this.logger.debug(
                        `Units to deduct: ${componentWeightNeeded}g / ${weightPerUnitGrams}g = ${quantityToDeduct} units`,
                      );
                    } else if (weightMeasure.unit === 'GRAM') {
                      quantityToDeduct = componentWeightNeeded / weightMeasure.value;
                      this.logger.debug(
                        `Units to deduct: ${componentWeightNeeded}g / ${weightMeasure.value}g = ${quantityToDeduct} units`,
                      );
                    }
                  } else if (volumeMeasure && volumeMeasure.value) {
                    // For volume-based items, use volume directly
                    if (volumeMeasure.unit === 'MILLILITER') {
                      quantityToDeduct =
                        (componentDetail.requiredVolume * 1000) / volumeMeasure.value;
                    } else if (volumeMeasure.unit === 'LITER') {
                      quantityToDeduct = componentDetail.requiredVolume / volumeMeasure.value;
                    }
                    this.logger.debug(
                      `Batch Update - Component ${item.name}: Volume measure: ${volumeMeasure.value} ${volumeMeasure.unit}, Units to deduct: ${quantityToDeduct}`,
                    );
                  } else {
                    // Default: assume 1 unit = 1 liter if no measures defined
                    quantityToDeduct = componentDetail.requiredVolume;
                    this.logger.warn(
                      `Batch Update - Component ${item.name}: No weight or volume measures defined, using default 1 unit = 1L`,
                    );
                  }

                  // Round to 4 decimal places for better precision
                  quantityToDeduct = Math.max(0, Math.round(quantityToDeduct * 10000) / 10000);

                  await transaction.activity.create({
                    data: {
                      itemId: componentDetail.itemId,
                      quantity: quantityToDeduct,
                      operation: ACTIVITY_OPERATION.OUTBOUND,
                      reason: ACTIVITY_REASON.PAINT_PRODUCTION,
                      reasonOrder: 2,
                      userId: userId || null,
                    },
                  });

                  await transaction.item.update({
                    where: { id: componentDetail.itemId },
                    data: {
                      quantity: {
                        decrement: quantityToDeduct,
                      },
                    },
                  });
                }
              } else if (weightDifference < 0) {
                // Decreasing production - return inventory
                if (!existing.formula || !existing.formula.components) {
                  throw new NotFoundException('Fórmula ou componentes não encontrados.');
                }

                // Volume is already provided in the update data - preserve it

                // Return inventory based on volume reduction
                const volumeToReturn = Math.abs(volumeDifference);

                for (const component of existing.formula.components) {
                  if (!component.item) continue;

                  // Calculate based on component ratio
                  const componentRatio = component.ratio / 100; // Convert percentage to decimal
                  const returnVolume = volumeToReturn * componentRatio;

                  let returnQuantity = returnVolume; // Default: 1 unit = 1 liter

                  // Convert to item's volume units
                  const volumeMeasure = component.item.measures?.find(
                    m => m.measureType === 'VOLUME',
                  );
                  if (volumeMeasure && volumeMeasure.value) {
                    if (volumeMeasure.unit === 'MILLILITER') {
                      returnQuantity = (returnVolume * 1000) / volumeMeasure.value;
                    } else if (volumeMeasure.unit === 'LITER') {
                      returnQuantity = returnVolume / volumeMeasure.value;
                    }
                  }

                  // Round to 2 decimal places
                  returnQuantity = Math.round(returnQuantity * 100) / 100;

                  await transaction.activity.create({
                    data: {
                      itemId: component.itemId,
                      quantity: returnQuantity,
                      operation: ACTIVITY_OPERATION.INBOUND,
                      reason: ACTIVITY_REASON.RETURN,
                      reasonOrder: 5,
                      userId: userId || null,
                    },
                  });

                  await transaction.item.update({
                    where: { id: component.itemId },
                    data: {
                      quantity: {
                        increment: returnQuantity,
                      },
                    },
                  });
                }
              }
            }

            // Update the production
            const updated = await this.paintProductionRepository.updateWithTransaction(
              transaction,
              updateItem.id,
              updateData,
              include ? { include } : undefined,
            );

            successfulUpdates.push(updated);

            // Log the update
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.PAINT_PRODUCTION,
              entityId: updateItem.id,
              oldEntity: existing,
              newEntity: updated,
              fieldsToTrack: ['volumeLiters', 'formulaId'],
              userId: userId || 'system',
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_BATCH_UPDATE,
              transaction,
            });
          } catch (error) {
            failedUpdates.push({
              index: i,
              id: updateItem.id!,
              data: {
                ...updateItem.data,
                id: updateItem.id!,
              },
              error: error.message || 'Erro ao atualizar produção',
              errorCode: 'UPDATE_ERROR',
            });
          }
        }

        const batchResult = {
          success: successfulUpdates,
          failed: failedUpdates,
          totalUpdated: successfulUpdates.length,
          totalFailed: failedUpdates.length,
        };

        // Group by formula to log impact
        const formulaIds = new Set(successfulUpdates.map(p => p.formulaId));

        // Log impact on formulas
        for (const formulaId of Array.from(formulaIds)) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA,
            entityId: formulaId,
            action: CHANGE_ACTION.UPDATE,
            field: 'productions',
            reason: 'Múltiplas produções de tinta atualizadas',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_BATCH_UPDATE,
            triggeredById: formulaId,
            userId: userId || null,
            transaction,
          });
        }

        return batchResult;
      });

      const totalFailed = validationErrors.length + result.totalFailed;
      const successMessage =
        result.totalUpdated === 1
          ? '1 produção de tinta da fórmula atualizado com sucesso'
          : `${result.totalUpdated} produções de tintas da fórmula atualizados com sucesso`;
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
      this.logger.error('Erro ao atualizar produções de tintas da fórmula em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar produções de tintas da fórmula em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: PaintProductionBatchDeleteFormData,
    userId: string,
  ): Promise<PaintProductionBatchDeleteResponse> {
    try {
      // First get the productions with formula details to know which formulas they belong to and return inventory
      const productionsToDelete = await this.paintProductionRepository.findByIds(
        data.paintProductionIds,
        {
          include: {
            formula: {
              include: {
                components: {
                  include: {
                    item: true,
                  },
                },
              },
            },
          },
        },
      );
      const formulaIds = new Set(productionsToDelete.map(p => p.formulaId));

      const result = await this.prisma.$transaction(async transaction => {
        // Return inventory for each production before deletion
        for (const production of productionsToDelete) {
          if (production.formula && production.formula.components) {
            // Calculate total based on ratios (assuming 1L = 1000g for simplicity)
            const baseWeight = production.volumeLiters * 1000; // Convert liters to grams

            for (const component of production.formula.components) {
              if (!component.item) continue;

              // Calculate component usage based on ratio
              const componentWeightInGrams = (component.ratio / 100) * baseWeight;

              // Calculate weight to return based on component ratio
              const returnWeight = componentWeightInGrams;

              // Calculate quantity to return (simplified - assuming base units)
              let returnQuantity = returnWeight / 1000; // Convert grams to kg

              // Round to 2 decimal places
              returnQuantity = Math.round(returnQuantity * 100) / 100;

              await transaction.activity.create({
                data: {
                  itemId: component.itemId,
                  quantity: returnQuantity,
                  operation: ACTIVITY_OPERATION.INBOUND,
                  reason: ACTIVITY_REASON.RETURN,
                  reasonOrder: 5,
                  userId: userId || null,
                },
              });

              await transaction.item.update({
                where: { id: component.itemId },
                data: {
                  quantity: {
                    increment: returnQuantity,
                  },
                },
              });
            }
          }
        }

        const batchResult = await this.paintProductionRepository.deleteManyWithTransaction(
          transaction,
          data.paintProductionIds,
        );

        // Log deletion for each successful component
        for (const deleted of batchResult.success) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_PRODUCTION,
            entityId: deleted.id,
            action: CHANGE_ACTION.DELETE,
            reason: 'Produção de tinta deletada em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_BATCH_DELETE,
            triggeredById: deleted.id,
            userId: userId || null,
            transaction,
          });
        }

        // Log impact on formulas
        for (const formulaId of Array.from(formulaIds)) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA,
            entityId: formulaId,
            action: CHANGE_ACTION.UPDATE,
            field: 'productions',
            reason: 'Múltiplas produções de tinta deletadas',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_BATCH_DELETE,
            triggeredById: formulaId,
            userId: userId || null,
            transaction,
          });
        }

        return batchResult;
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 produção de tinta da fórmula deletado com sucesso'
          : `${result.totalDeleted} produções de tintas da fórmula deletados com sucesso`;
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
      this.logger.error('Erro ao deletar produções de tintas da fórmula em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao deletar produções de tintas da fórmula em lote. Por favor, tente novamente.',
      );
    }
  }
}
