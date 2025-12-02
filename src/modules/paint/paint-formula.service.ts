// paint-formula.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  Inject,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import type {
  PaintFormulaBatchCreateResponse,
  PaintFormulaBatchDeleteResponse,
  PaintFormulaBatchUpdateResponse,
  PaintFormulaCreateResponse,
  PaintFormulaDeleteResponse,
  PaintFormulaGetManyResponse,
  PaintFormulaGetUniqueResponse,
  PaintFormulaUpdateResponse,
  PaintFormula,
} from '../../types';
import { UpdateData } from '../../types';
import type {
  PaintFormulaCreateFormData,
  PaintFormulaUpdateFormData,
  PaintFormulaGetManyFormData,
  PaintFormulaBatchCreateFormData,
  PaintFormulaBatchUpdateFormData,
  PaintFormulaBatchDeleteFormData,
  PaintFormulaInclude,
} from '../../schemas/paint';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../constants/enums';
import { PaintFormulaRepository } from './repositories/paint-formula/paint-formula.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
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
  validateFormulaDensity,
  validateComponentForFormula,
  calculatePaintDensity,
  calculateFormulaCost,
} from '../../utils/paint';

@Injectable()
export class PaintFormulaService implements OnModuleInit {
  private readonly logger = new Logger(PaintFormulaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paintFormulaRepository: PaintFormulaRepository,
    private readonly changeLogService: ChangeLogService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  /**
   * Set up event listeners when the module initializes
   */
  onModuleInit() {
    this.eventEmitter.on('item.updated', this.handleItemUpdated.bind(this));
    this.logger.log('Paint Formula Service event listeners initialized');
  }

  /**
   * Handle item updated event
   */
  private async handleItemUpdated(event: {
    itemId: string;
    userId: string;
    changes: {
      price: boolean;
      icms: boolean;
      ipi: boolean;
      measures: boolean;
    };
  }): Promise<void> {
    try {
      this.logger.log(
        `Handling item.updated event for item ${event.itemId}. Changes: ${JSON.stringify(event.changes)}`,
      );

      // Only recalculate if price, taxes, or measures changed
      const shouldRecalculate =
        event.changes.price || event.changes.icms || event.changes.ipi || event.changes.measures;

      if (!shouldRecalculate) {
        this.logger.log(
          `No relevant changes for item ${event.itemId}, skipping formula recalculation`,
        );
        return;
      }

      // Get item details for better changelog messages
      const item = await this.prisma.item.findUnique({
        where: { id: event.itemId },
        select: {
          id: true,
          name: true,
          uniCode: true,
        },
      });

      if (!item) {
        this.logger.warn(`Item ${event.itemId} not found, cannot recalculate formulas`);
        return;
      }

      // Build change description
      const changeDescriptions: string[] = [];
      if (event.changes.price) changeDescriptions.push('preço');
      if (event.changes.icms) changeDescriptions.push('ICMS');
      if (event.changes.ipi) changeDescriptions.push('IPI');
      if (event.changes.measures) changeDescriptions.push('medidas (peso/volume)');

      const itemDescription = item.uniCode ? `${item.uniCode} - ${item.name}` : item.name;
      const changeDescription = changeDescriptions.join(', ');

      // Find all formulas that use this item
      const affectedFormulas = await this.findFormulasAffectedByItem(event.itemId);

      if (affectedFormulas.length === 0) {
        this.logger.log(`No formulas found using item ${event.itemId}`);
        return;
      }

      this.logger.log(
        `Found ${affectedFormulas.length} formulas affected by item ${event.itemId} changes`,
      );

      // Recalculate all affected formulas with context
      await this.recalculateFormulasForItem(
        event.itemId,
        affectedFormulas,
        event.userId,
        itemDescription,
        changeDescription,
        event.changes, // Pass the changes object to determine what to recalculate
      );

      this.logger.log(
        `Successfully recalculated ${affectedFormulas.length} formulas for item ${event.itemId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Error handling item.updated event for item ${event.itemId}: ${error.message}`,
        error.stack,
      );
      // Don't throw - event handler should not crash the application
    }
  }

  /**
   * Find all formulas that use a specific item
   */
  private async findFormulasAffectedByItem(itemId: string): Promise<string[]> {
    const components = await this.prisma.paintFormulaComponent.findMany({
      where: { itemId },
      select: {
        formulaPaintId: true,
      },
      distinct: ['formulaPaintId'],
    });

    return components.map(c => c.formulaPaintId);
  }

  /**
   * Recalculate all formulas that use a specific item
   */
  private async recalculateFormulasForItem(
    itemId: string,
    formulaIds: string[],
    userId?: string,
    itemDescription?: string,
    changeDescription?: string,
    changes?: {
      price: boolean;
      icms: boolean;
      ipi: boolean;
      measures: boolean;
    },
  ): Promise<void> {
    // Process each formula in its own transaction for isolation
    // If one fails, others can still succeed
    for (const formulaId of formulaIds) {
      try {
        // Each formula gets its own transaction by not passing a transaction parameter
        // The recalculateFormulaDensityAndCost method will use this.prisma (non-transactional)
        // but creates its own transaction internally via the update operations
        await this.prisma.$transaction(
          async (tx: PrismaTransaction) => {
            await this.recalculateFormulaDensityAndCost(
              formulaId,
              tx,
              userId,
              CHANGE_TRIGGERED_BY.ITEM_UPDATE, // Triggered by item update
              itemId, // triggeredById = itemId that caused the change
              itemDescription,
              changeDescription,
              changes, // Pass changes to determine what to recalculate
            );
          },
          {
            maxWait: 5000, // 5 seconds per formula
            timeout: 15000, // 15 seconds per formula
          },
        );
      } catch (error: any) {
        this.logger.error(
          `Error recalculating formula ${formulaId} for item ${itemId}: ${error.message}`,
        );
        // Continue with other formulas even if one fails
      }
    }
  }

  /**
   * Create a summary object for a paint formula for changelog tracking
   */
  private buildFormulaSummary(formula: any): any {
    return {
      id: formula.id,
      description: formula.description,
      density: formula.density,
      pricePerLiter: formula.pricePerLiter,
    };
  }

  /**
   * Get existing formula summaries for a paint
   */
  private async getExistingFormulaSummaries(
    paintId: string,
    transaction: PrismaTransaction,
  ): Promise<any[]> {
    const formulas = await transaction.paintFormula.findMany({
      where: { paintId },
      select: {
        id: true,
        description: true,
        density: true,
        pricePerLiter: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return formulas.map(f => this.buildFormulaSummary(f));
  }

  /**
   * Buscar muitas fórmulas de tinta com filtros
   */
  async findMany(query: PaintFormulaGetManyFormData): Promise<PaintFormulaGetManyResponse> {
    try {
      const result = await this.paintFormulaRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Fórmulas de tinta carregadas com sucesso',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar fórmulas de tinta:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar fórmulas de tinta. Por favor, tente novamente',
      );
    }
  }

  /**
   * Buscar uma fórmula de tinta por ID
   */
  async findById(
    id: string,
    include?: PaintFormulaInclude,
  ): Promise<PaintFormulaGetUniqueResponse> {
    try {
      const paintFormula = await this.paintFormulaRepository.findById(id, { include });

      if (!paintFormula) {
        throw new NotFoundException(
          'Fórmula de tinta não encontrada. Verifique se o ID está correto.',
        );
      }

      return {
        success: true,
        data: paintFormula,
        message: 'Fórmula de tinta carregada com sucesso',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar fórmula de tinta por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar fórmula de tinta. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar nova fórmula de tinta
   */
  async create(
    data: PaintFormulaCreateFormData,
    include?: PaintFormulaInclude,
    userId?: string,
  ): Promise<PaintFormulaCreateResponse> {
    try {
      this.logger.log('Creating paint formula with data:', JSON.stringify(data, null, 2));

      const paintFormula = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Verificar se a tinta existe
        if (data.paintId) {
          const paint = await tx.paint.findUnique({ where: { id: data.paintId } });
          if (!paint) {
            throw new NotFoundException(
              'Tinta não encontrada. Verifique se o ID da tinta está correto.',
            );
          }
        }

        // Calculate ratios, density and price if components are provided
        let calculatedDensity = 1.0;
        let calculatedPricePerLiter = 0;
        let totalWeight = 0;

        if (data.components && data.components.length > 0) {
          // Get items for component validation and calculation
          const itemIds = data.components.map(c => c.itemId);
          const items = await tx.item.findMany({
            where: { id: { in: itemIds } },
            include: {
              measures: true,
              prices: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
          });

          // Calculate total weight for ratio calculation
          totalWeight = data.components.reduce((sum, comp) => sum + comp.weightInGrams, 0);

          if (totalWeight === 0) {
            throw new BadRequestException('O peso total dos componentes deve ser maior que zero');
          }

          // First: Convert weights to ratios
          const componentsWithRatio = data.components.map(comp => ({
            itemId: comp.itemId,
            weightInGrams: comp.weightInGrams,
            ratio: totalWeight > 0 ? (comp.weightInGrams / totalWeight) * 100 : 0,
          }));

          // Validate ratio sum (should be ~100%)
          const totalRatio = componentsWithRatio.reduce((sum, comp) => sum + comp.ratio, 0);
          if (Math.abs(totalRatio - 100) > 0.1) {
            this.logger.warn(`Ratio sum is ${totalRatio.toFixed(2)}% (expected 100%)`);
          }

          // Calculate density and price FROM RATIOS (same logic as recalculation)
          let totalWeightFor1L = 0;
          let totalCost = 0;

          for (const componentData of componentsWithRatio) {
            const item = items.find(i => i.id === componentData.itemId);
            if (!item) {
              throw new BadRequestException(
                `Item não encontrado para componente: ${componentData.itemId}`,
              );
            }

            // Get weight and volume measures
            const weightMeasure = item.measures?.find(
              m => (m.unit === 'GRAM' || m.unit === 'KILOGRAM') && m.measureType === 'WEIGHT',
            );
            const volumeMeasure = item.measures?.find(
              m => (m.unit === 'MILLILITER' || m.unit === 'LITER') && m.measureType === 'VOLUME',
            );

            if (!weightMeasure || !volumeMeasure) {
              throw new BadRequestException(
                `Item ${item.name} precisa ter medidas de peso (gramas) e volume (mililitros) configuradas`,
              );
            }

            // Validate measure values are positive (handle nullable values)
            const weightValue = weightMeasure.value ?? 0;
            const volumeValue = volumeMeasure.value ?? 0;

            if (weightValue <= 0 || volumeValue <= 0) {
              const weightUnit = weightMeasure.unit === 'KILOGRAM' ? 'kg' : 'g';
              const volumeUnit = volumeMeasure.unit === 'LITER' ? 'L' : 'ml';
              throw new BadRequestException(
                `Item ${item.name} precisa ter valores positivos para peso e volume. ` +
                  `Peso atual: ${weightValue}${weightUnit}, Volume atual: ${volumeValue}${volumeUnit}`,
              );
            }

            // Convert to base units (grams and milliliters)
            let weightPerUnitInGrams = weightValue;
            if (weightMeasure.unit === 'KILOGRAM') {
              weightPerUnitInGrams = weightValue * 1000;
            }

            let volumePerUnitInMl = volumeValue;
            if (volumeMeasure.unit === 'LITER') {
              volumePerUnitInMl = volumeValue * 1000;
            }

            // Calculate item density (g/ml)
            const itemDensity =
              volumePerUnitInMl > 0 ? weightPerUnitInGrams / volumePerUnitInMl : 1.0;

            // Calculate component volume in 1L of paint (ratio-based)
            const componentVolumeInMl = 1000 * (componentData.ratio / 100);

            // Calculate weight for this volume
            const componentWeightInGrams = componentVolumeInMl * itemDensity;
            totalWeightFor1L += componentWeightInGrams;

            // Calculate cost based on VOLUME, not weight (same as recalculation)
            const itemPrice = item.prices?.[0]?.value || 0;
            const pricePerMl = volumePerUnitInMl > 0 ? itemPrice / volumePerUnitInMl : 0;
            const componentCost = pricePerMl * componentVolumeInMl;
            totalCost += componentCost;
          }

          // Calculate formula density (for 1 liter)
          calculatedDensity = totalWeightFor1L / 1000; // g/ml

          // Price per liter (already calculated for 1L)
          calculatedPricePerLiter = totalCost;
        }

        // Log component details
        this.logger.log(`Creating formula with ${data.components?.length || 0} components`);
        this.logger.log(`Total weight: ${totalWeight}g`);

        if (data.components) {
          data.components.forEach(comp => {
            const ratio = totalWeight > 0 ? (comp.weightInGrams / totalWeight) * 100 : 0;
            this.logger.log(
              `Component ${comp.itemId}: ${comp.weightInGrams}g = ${ratio.toFixed(2)}%`,
            );
          });
        }

        // Convert components from weightInGrams to ratio for database storage
        const componentsWithRatio = data.components?.map(comp => ({
          itemId: comp.itemId,
          formulaPaintId: comp.formulaPaintId,
          ratio: totalWeight > 0 ? (comp.weightInGrams / totalWeight) * 100 : 0,
        }));

        // Create formula with calculated values
        const formulaData = {
          ...data,
          components: componentsWithRatio,
          density: new Prisma.Decimal(calculatedDensity),
          pricePerLiter: new Prisma.Decimal(calculatedPricePerLiter),
        };

        // Criar a fórmula de tinta
        const newPaintFormula = await this.paintFormulaRepository.createWithTransaction(
          tx,
          formulaData as any,
          { include },
        );

        // If formula was created with components, validate density consistency
        if (data.components && data.components.length > 0 && include?.components) {
          // Get the created formula with full component data for validation
          const formulaWithComponents = await tx.paintFormula.findUnique({
            where: { id: newPaintFormula.id },
            include: {
              components: {
                include: {
                  item: true,
                },
              },
            },
          });

          if (formulaWithComponents) {
            const densityValidation = validateFormulaDensity(formulaWithComponents as any, 10); // 10% tolerance

            if (!densityValidation.isValid) {
              this.logger.warn(
                `Densidade da fórmula ${newPaintFormula.id} pode estar inconsistente: ${densityValidation.errors.join(', ')}`,
              );
              // Note: We log a warning but don't throw an error to allow some flexibility
              // In a stricter implementation, you might want to throw an error here
            } else {
              this.logger.log(
                `Densidade da fórmula ${newPaintFormula.id} validada com sucesso. ` +
                  `Densidade calculada: ${densityValidation.calculatedDensity?.toFixed(3)} g/ml`,
              );
            }
          }
        }

        // Registrar no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT_FORMULA,
          entityId: newPaintFormula.id,
          action: CHANGE_ACTION.CREATE,
          entity: extractEssentialFields(
            newPaintFormula,
            getEssentialFields(ENTITY_TYPE.PAINT_FORMULA) as (keyof PaintFormula)[],
          ),
          reason: `Nova fórmula de tinta criada: ${data.description}`,
          userId: userId || 'system',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_CREATE,
          transaction: tx,
        });

        // Log calculated fields if they were set
        if (calculatedDensity !== 1.0) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA,
            entityId: newPaintFormula.id,
            action: CHANGE_ACTION.CREATE,
            field: 'density',
            oldValue: null,
            newValue: calculatedDensity,
            reason: `Densidade calculada automaticamente baseada em ${data.components?.length || 0} componentes`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_CREATE,
            triggeredById: newPaintFormula.id,
            userId: userId || 'system',
            transaction: tx,
          });
        }

        if (calculatedPricePerLiter > 0) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA,
            entityId: newPaintFormula.id,
            action: CHANGE_ACTION.CREATE,
            field: 'pricePerLiter',
            oldValue: null,
            newValue: calculatedPricePerLiter,
            reason: `Preço por litro calculado automaticamente: R$ ${calculatedPricePerLiter.toFixed(2)}`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_CREATE,
            triggeredById: newPaintFormula.id,
            userId: userId || 'system',
            transaction: tx,
          });
        }

        // Log impact on paint entity with formula summaries
        const existingFormulas = await this.getExistingFormulaSummaries(data.paintId, tx);
        const newFormulaSummary = this.buildFormulaSummary(newPaintFormula);
        const formulasAfterCreation = [
          newFormulaSummary,
          ...existingFormulas.filter(f => f.id !== newPaintFormula.id),
        ];

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PAINT,
          entityId: data.paintId,
          action: CHANGE_ACTION.UPDATE,
          field: 'formulas',
          oldValue: existingFormulas,
          newValue: formulasAfterCreation,
          reason: `Nova fórmula criada: ${data.description}`,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_CREATE,
          triggeredById: newPaintFormula.id,
          userId: userId || 'system',
          transaction: tx,
        });

        return newPaintFormula;
      });

      return {
        success: true,
        message: 'Fórmula de tinta criada com sucesso',
        data: paintFormula,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar fórmula de tinta:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar fórmula de tinta. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar fórmula de tinta
   */
  async update(
    id: string,
    data: PaintFormulaUpdateFormData,
    include?: PaintFormulaInclude,
    userId?: string,
  ): Promise<PaintFormulaUpdateResponse> {
    try {
      const updatedPaintFormula = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar fórmula de tinta existente com relações
        const existingPaintFormula = await this.paintFormulaRepository.findByIdWithTransaction(
          tx,
          id,
          {
            include: { paint: true },
          },
        );

        if (!existingPaintFormula) {
          throw new NotFoundException(
            'Fórmula de tinta não encontrada. Verifique se o ID está correto.',
          );
        }

        // Verificar se a nova tinta existe (se fornecida)
        let newPaint: any = null;
        if (data.paintId !== undefined && data.paintId !== existingPaintFormula.paintId) {
          newPaint = await tx.paint.findUnique({ where: { id: data.paintId } });
          if (!newPaint) {
            throw new NotFoundException(
              'Tinta não encontrada. Verifique se o ID da tinta está correto.',
            );
          }
        }

        // Atualizar a fórmula de tinta
        const updatedPaintFormula = await this.paintFormulaRepository.updateWithTransaction(
          tx,
          id,
          data,
          { include },
        );

        // Registrar mudanças no changelog - incluir todos os campos da fórmula
        const fieldsToTrack = [
          'description',
          'paintId',
          'density',
          'pricePerLiter',
          'viscosity',
          'isActive',
          'code',
          'type',
        ];
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT_FORMULA,
          entityId: id,
          oldEntity: existingPaintFormula,
          newEntity: updatedPaintFormula,
          fieldsToTrack,
          userId: userId || 'system',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_UPDATE,
          transaction: tx,
        });

        // Track paint relationship changes
        if (data.paintId !== undefined && data.paintId !== existingPaintFormula.paintId) {
          // Get formulas for both paints
          const oldPaintFormulas = await this.getExistingFormulaSummaries(
            existingPaintFormula.paintId,
            tx,
          );
          const newPaintFormulas = await this.getExistingFormulaSummaries(data.paintId, tx);

          const formulaSummary = this.buildFormulaSummary(existingPaintFormula);
          const updatedFormulaSummary = this.buildFormulaSummary(updatedPaintFormula);

          // Log removal from old paint
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT,
            entityId: existingPaintFormula.paintId,
            action: CHANGE_ACTION.UPDATE,
            field: 'formulas',
            oldValue: oldPaintFormulas,
            newValue: oldPaintFormulas.filter(f => f.id !== id),
            reason: `Fórmula "${existingPaintFormula.description}" removida desta tinta`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_UPDATE,
            triggeredById: id,
            userId: userId || 'system',
            transaction: tx,
          });

          // Log addition to new paint
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT,
            entityId: data.paintId,
            action: CHANGE_ACTION.UPDATE,
            field: 'formulas',
            oldValue: newPaintFormulas,
            newValue: [updatedFormulaSummary, ...newPaintFormulas.filter(f => f.id !== id)],
            reason: `Fórmula "${updatedPaintFormula.description}" adicionada a esta tinta`,
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_UPDATE,
            triggeredById: id,
            userId: userId || 'system',
            transaction: tx,
          });
        }

        return updatedPaintFormula;
      });

      return {
        success: true,
        message: 'Fórmula de tinta atualizada com sucesso',
        data: updatedPaintFormula,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar fórmula de tinta:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar fórmula de tinta. Por favor, tente novamente',
      );
    }
  }

  /**
   * Excluir fórmula de tinta
   */
  async delete(id: string, userId?: string): Promise<PaintFormulaDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const paintFormula = await this.paintFormulaRepository.findByIdWithTransaction(tx, id, {
          include: { paint: true },
        });

        if (!paintFormula) {
          throw new NotFoundException(
            'Fórmula de tinta não encontrada. Verifique se o ID está correto.',
          );
        }

        // Registrar exclusão
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PAINT_FORMULA,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: extractEssentialFields(
            paintFormula,
            getEssentialFields(ENTITY_TYPE.PAINT_FORMULA) as (keyof PaintFormula)[],
          ),
          reason: `Fórmula de tinta excluída: ${paintFormula.description}`,
          userId: userId || 'system',
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_DELETE,
          transaction: tx,
        });

        // Log impact on paint entity with formula summaries
        const existingFormulas = await this.getExistingFormulaSummaries(paintFormula.paintId, tx);
        const formulaSummary = this.buildFormulaSummary(paintFormula);

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.PAINT,
          entityId: paintFormula.paintId,
          action: CHANGE_ACTION.UPDATE,
          field: 'formulas',
          oldValue: existingFormulas,
          newValue: existingFormulas.filter(f => f.id !== id),
          reason: `Fórmula "${paintFormula.description}" excluída`,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_DELETE,
          triggeredById: id,
          userId: userId || 'system',
          transaction: tx,
        });

        await this.paintFormulaRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Fórmula de tinta excluída com sucesso',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir fórmula de tinta:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir fórmula de tinta. Por favor, tente novamente',
      );
    }
  }

  /**
   * Criar múltiplas fórmulas de tinta
   */

  async batchCreate(
    data: PaintFormulaBatchCreateFormData,
    include?: PaintFormulaInclude,
    userId?: string,
  ): Promise<PaintFormulaBatchCreateResponse<PaintFormulaCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const result = await this.paintFormulaRepository.createManyWithTransaction(
          tx,
          data.paintFormulas,
          { include },
        );

        // Registrar criações bem-sucedidas
        for (const paintFormula of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.PAINT_FORMULA,
            entityId: paintFormula.id,
            action: CHANGE_ACTION.CREATE,
            entity: extractEssentialFields(
              paintFormula,
              getEssentialFields(ENTITY_TYPE.PAINT_FORMULA) as (keyof PaintFormula)[],
            ),
            reason: 'Fórmula de tinta criada em lote',
            userId: userId || 'system',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_BATCH_CREATE,
            transaction: tx,
          });
        }

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 fórmula de tinta criada com sucesso'
          : `${result.totalCreated} fórmulas de tinta criadas com sucesso`;
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
        'Erro ao criar fórmulas de tinta em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Atualizar múltiplas fórmulas de tinta
   */
  async batchUpdate(
    data: PaintFormulaBatchUpdateFormData,
    include?: PaintFormulaInclude,
    userId?: string,
  ): Promise<PaintFormulaBatchUpdateResponse<PaintFormulaUpdateFormData>> {
    try {
      const updates: UpdateData<PaintFormulaUpdateFormData>[] = data.paintFormulas.map(formula => ({
        id: formula.id,
        data: formula.data,
      }));

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const result = await this.paintFormulaRepository.updateManyWithTransaction(tx, updates, {
          include,
        });

        // Registrar atualizações bem-sucedidas
        const fieldsToTrack = [
          'description',
          'paintId',
          'density',
          'pricePerLiter',
          'viscosity',
          'isActive',
          'code',
          'type',
        ];

        // Get existing formulas for comparison
        const formulaIds = updates.map(u => u.id);
        const existingFormulas = await tx.paintFormula.findMany({
          where: { id: { in: formulaIds } },
          include: { paint: true },
        });
        const existingFormulasMap = new Map(existingFormulas.map(f => [f.id, f]));

        for (const paintFormula of result.success) {
          const existingFormula = existingFormulasMap.get(paintFormula.id);
          const updateData = updates.find(u => u.id === paintFormula.id)?.data;

          if (existingFormula && updateData) {
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.PAINT_FORMULA,
              entityId: paintFormula.id,
              oldEntity: existingFormula,
              newEntity: paintFormula,
              fieldsToTrack,
              userId: userId || 'system',
              triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_BATCH_UPDATE,
              transaction: tx,
            });

            // Track paint relationship changes in batch
            if (
              updateData?.paintId !== undefined &&
              updateData.paintId !== existingFormula.paintId
            ) {
              // Get formulas for both paints
              const oldPaintFormulas = await this.getExistingFormulaSummaries(
                existingFormula.paintId,
                tx,
              );
              const newPaintFormulas = await this.getExistingFormulaSummaries(
                updateData.paintId,
                tx,
              );

              const formulaSummary = this.buildFormulaSummary(existingFormula);
              const updatedFormulaSummary = this.buildFormulaSummary(paintFormula);

              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.PAINT,
                entityId: existingFormula.paintId,
                action: CHANGE_ACTION.UPDATE,
                field: 'formulas',
                oldValue: oldPaintFormulas,
                newValue: oldPaintFormulas.filter(f => f.id !== paintFormula.id),
                reason: `Fórmula removida em lote: ${existingFormula.description}`,
                triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_BATCH_UPDATE,
                triggeredById: paintFormula.id,
                userId: userId || 'system',
                transaction: tx,
              });

              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.PAINT,
                entityId: updateData.paintId,
                action: CHANGE_ACTION.UPDATE,
                field: 'formulas',
                oldValue: newPaintFormulas,
                newValue: [
                  updatedFormulaSummary,
                  ...newPaintFormulas.filter(f => f.id !== paintFormula.id),
                ],
                reason: `Fórmula adicionada em lote: ${paintFormula.description}`,
                triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_BATCH_UPDATE,
                triggeredById: paintFormula.id,
                userId: userId || 'system',
                transaction: tx,
              });
            }
          }
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 fórmula de tinta atualizada com sucesso'
          : `${result.totalUpdated} fórmulas de tinta atualizadas com sucesso`;
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
        'Erro ao atualizar fórmulas de tinta em lote. Por favor, tente novamente',
      );
    }
  }

  /**
   * Recalculate formula density and cost based on components
   * Used internally by paint-formula-component.service.ts
   */
  async recalculateFormulaDensityAndCost(
    formulaId: string,
    transaction?: PrismaTransaction,
    userId?: string,
    triggeredBy?: CHANGE_TRIGGERED_BY,
    triggeredById?: string,
    itemDescription?: string,
    changeDescription?: string,
    changes?: {
      price?: boolean;
      icms?: boolean;
      ipi?: boolean;
      measures?: boolean;
    },
  ): Promise<void> {
    const tx = transaction || this.prisma;

    // Get formula with all components
    const formula = await tx.paintFormula.findUnique({
      where: { id: formulaId },
      include: {
        components: {
          include: {
            item: {
              include: {
                measures: true,
                prices: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!formula || !formula.components || formula.components.length === 0) {
      return;
    }

    try {
      // Store original values for changelog
      const originalDensity = formula.density;
      const originalPricePerLiter = formula.pricePerLiter;

      // Calculate total cost and density based on component ratios
      let totalCost = 0;
      let totalWeightFor1L = 0; // Total weight in grams for 1 liter of paint

      for (const component of formula.components) {
        // Calculate actual cost based on item price and weight needed
        const itemPrice = component.item.prices?.[0]?.value || 0;

        // Get weight and volume measures
        const weightMeasure =
          component.item.measures?.find(m => m.unit === 'GRAM' && m.measureType === 'WEIGHT') ||
          component.item.measures?.find(m => m.unit === 'KILOGRAM' && m.measureType === 'WEIGHT');

        const volumeMeasure =
          component.item.measures?.find(
            m => m.unit === 'MILLILITER' && m.measureType === 'VOLUME',
          ) || component.item.measures?.find(m => m.unit === 'LITER' && m.measureType === 'VOLUME');

        if (!weightMeasure) {
          this.logger.warn(`No weight measure found for component ${component.item.name}`);
          continue;
        }

        if (!volumeMeasure) {
          this.logger.warn(`No volume measure found for component ${component.item.name}`);
          continue;
        }

        // Convert to grams if needed
        const weightValue = weightMeasure.value || 0;
        let weightPerUnitInGrams = weightValue;
        if (weightMeasure.unit === 'KILOGRAM') {
          weightPerUnitInGrams = weightValue * 1000; // Convert kg to grams
        }

        // Convert to milliliters if needed
        const volumeValue = volumeMeasure.value || 0;
        let volumePerUnitInMl = volumeValue;
        if (volumeMeasure.unit === 'LITER') {
          volumePerUnitInMl = volumeValue * 1000; // Convert L to ml
        }

        // Calculate item density (g/ml)
        const itemDensity = volumePerUnitInMl > 0 ? weightPerUnitInGrams / volumePerUnitInMl : 1.0;

        // Calculate how much volume this component occupies in 1L of paint
        // ratio% of 1000ml = component volume in ml
        const componentVolumeInMl = 1000 * (component.ratio / 100);

        // Calculate weight for this component volume (for density calculation)
        const componentWeightInGrams = componentVolumeInMl * itemDensity;

        // Add to total weight
        totalWeightFor1L += componentWeightInGrams;

        // Calculate cost based on VOLUME, not weight
        // Cost = (volume_used / item_volume) × item_price
        const pricePerMl = volumePerUnitInMl > 0 ? itemPrice / volumePerUnitInMl : 0;
        const componentCost = pricePerMl * componentVolumeInMl;

        totalCost += componentCost;
      }

      // Calculate density: total weight (g) / total volume (ml) = g/ml
      // For 1 liter of paint: density = totalWeightFor1L / 1000
      const calculatedDensity = totalWeightFor1L / 1000;
      const pricePerLiter = totalCost; // Total cost is price per liter

      // Determine what should be recalculated based on changes
      // Density should only be recalculated if measures changed
      // Price should be recalculated if price, icms, ipi, or measures changed
      const shouldRecalculateDensity = !changes || changes.measures === true;
      const shouldRecalculatePrice =
        !changes || changes.price || changes.icms || changes.ipi || changes.measures;

      // Only check for changes if we should recalculate
      const densityChanged =
        shouldRecalculateDensity && hasValueChanged(originalDensity, calculatedDensity);
      const priceChanged =
        shouldRecalculatePrice && hasValueChanged(originalPricePerLiter, pricePerLiter);

      if (densityChanged || priceChanged) {
        // Build update data - only update fields that changed
        const updateData: any = {};
        if (densityChanged) {
          updateData.density = new Prisma.Decimal(calculatedDensity);
        }
        if (priceChanged) {
          updateData.pricePerLiter = new Prisma.Decimal(pricePerLiter);
        }

        // Update formula with only the changed fields
        await tx.paintFormula.update({
          where: { id: formulaId },
          data: updateData,
        });

        // Build reason messages with item context if available
        let densityReasonBase = `Densidade recalculada automaticamente (${calculatedDensity.toFixed(3)} g/ml)`;
        let priceReasonBase = `Preço por litro recalculado automaticamente (R$ ${pricePerLiter.toFixed(2)})`;

        if (itemDescription && changeDescription) {
          densityReasonBase += ` devido à alteração de ${changeDescription} do item ${itemDescription}`;
          priceReasonBase += ` devido à alteração de ${changeDescription} do item ${itemDescription}`;
        }

        // Log density change
        if (densityChanged) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA,
            entityId: formulaId,
            action: CHANGE_ACTION.UPDATE,
            field: 'density',
            oldValue: originalDensity,
            newValue: calculatedDensity,
            reason: densityReasonBase,
            triggeredBy: triggeredBy || CHANGE_TRIGGERED_BY.SYSTEM,
            triggeredById: triggeredById || formulaId,
            userId: userId || 'system',
            transaction: tx,
          });
        }

        // Log price change
        if (priceChanged) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.PAINT_FORMULA,
            entityId: formulaId,
            action: CHANGE_ACTION.UPDATE,
            field: 'pricePerLiter',
            oldValue: originalPricePerLiter,
            newValue: pricePerLiter,
            reason: priceReasonBase,
            triggeredBy: triggeredBy || CHANGE_TRIGGERED_BY.SYSTEM,
            triggeredById: triggeredById || formulaId,
            userId: userId || 'system',
            transaction: tx,
          });
        }

        this.logger.log(
          `Formula ${formulaId} recalculated: density=${calculatedDensity.toFixed(3)} g/ml (was ${originalDensity.toFixed(3)}), ` +
            `cost=${pricePerLiter.toFixed(2)} R$/L (was ${originalPricePerLiter.toFixed(2)})`,
        );
      }
    } catch (error) {
      this.logger.error(`Error recalculating formula density and cost: ${error.message}`);
      // Don't throw - allow the component operation to succeed
    }
  }

  /**
   * Excluir múltiplas fórmulas de tinta
   */
  async batchDelete(
    data: PaintFormulaBatchDeleteFormData,
    userId?: string,
  ): Promise<PaintFormulaBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar fórmulas antes de excluir para o changelog
        const paintFormulas = await this.paintFormulaRepository.findByIdsWithTransaction(
          tx,
          data.paintFormulaIds,
        );

        // Registrar exclusões
        for (const paintFormula of paintFormulas) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.PAINT_FORMULA,
            entityId: paintFormula.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: extractEssentialFields(
              paintFormula,
              getEssentialFields(ENTITY_TYPE.PAINT_FORMULA) as (keyof PaintFormula)[],
            ),
            reason: 'Fórmula de tinta excluída em lote',
            userId: userId || 'system',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_BATCH_DELETE,
            transaction: tx,
          });
        }

        return this.paintFormulaRepository.deleteManyWithTransaction(tx, data.paintFormulaIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 fórmula de tinta excluída com sucesso'
          : `${result.totalDeleted} fórmulas de tinta excluídas com sucesso`;
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
    } catch (error: any) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir fórmulas de tinta em lote. Por favor, tente novamente',
      );
    }
  }
}
