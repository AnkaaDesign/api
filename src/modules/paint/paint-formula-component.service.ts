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
   * Recalculate ratios for all components in a formula
   * This is now a simple normalization to ensure ratios sum to 100%
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

    // Calculate total ratio
    const totalRatio = components.reduce((sum, comp) => sum + comp.ratio, 0);

    // Normalize ratios to sum to 100%
    if (totalRatio > 0 && totalRatio !== 100) {
      for (const component of components) {
        const originalRatio = component.ratio;
        const normalizedRatio = (component.ratio / totalRatio) * 100;
        // Round to 2 decimal places
        const roundedRatio = Math.round(normalizedRatio * 100) / 100;

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
            reason: `Proporção recalculada automaticamente (${component.item?.name || 'componente'}: ${originalRatio.toFixed(2)}% → ${roundedRatio.toFixed(2)}%)`,
            triggeredBy: triggeredBy || CHANGE_TRIGGERED_BY.SYSTEM,
            triggeredById: triggeredById || formulaPaintId,
            userId: userId || 'system',
            transaction,
          });
        }
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

  async create(
    data: PaintFormulaComponentCreateFormData,
    include?: PaintFormulaComponentInclude,
    userId?: string,
  ): Promise<PaintFormulaComponentCreateResponse> {
    try {
      const component = await this.prisma.$transaction(async transaction => {
        // Validate item exists and has required measures
        const item = await this.validateItemExists(data.itemId, transaction);

        // Validate component compatibility with paint brand and type
        await this.validateComponentCompatibility(data.itemId, data.formulaPaintId, transaction);

        // Get all existing components to calculate total weight
        const existingComponents = await transaction.paintFormulaComponent.findMany({
          where: { formulaPaintId: data.formulaPaintId },
        });

        // Validate that total ratio won't exceed 100%
        const currentTotalRatio = existingComponents.reduce((sum, comp) => sum + comp.ratio, 0);
        const newTotalRatio = currentTotalRatio + data.ratio;

        if (newTotalRatio > 100.01) {
          // Allow small floating point error
          throw new BadRequestException(
            `Soma das proporções não pode exceder 100% (atual: ${currentTotalRatio.toFixed(2)}%, novo: ${data.ratio.toFixed(2)}%)`,
          );
        }

        // Create component with provided ratio
        const componentData = {
          itemId: data.itemId,
          formulaPaintId: data.formulaPaintId,
          ratio: data.ratio,
        };

        const created = await this.paintFormulaComponentRepository.createWithTransaction(
          transaction,
          componentData,
          { include },
        );

        // No need to recalculate ratios since they are provided directly

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
          reason: `Componente criado (${item.name}, ${data.ratio.toFixed(2)}%)`,
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
            ratio: data.ratio,
          },
          reason: `Componente adicionado: ${item.name} (${data.ratio.toFixed(2)}%)`,
          triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_CREATE,
          triggeredById: created.id,
          userId: userId || 'system',
          transaction,
        });

        // Log impact on item inventory
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ITEM,
          entityId: data.itemId,
          action: CHANGE_ACTION.UPDATE,
          field: 'formulaComponents',
          reason: 'Item adicionado como componente de fórmula de tinta',
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
        // If item changed, validate the new item
        if (data.itemId && data.itemId !== componentExists.itemId) {
          await this.validateItemExists(data.itemId, transaction);
          // Validate new component compatibility
          await this.validateComponentCompatibility(
            data.itemId,
            componentExists.formulaPaintId,
            transaction,
          );
        }

        // Update ratio if provided
        let updateData: any = {};
        if (data.ratio !== undefined) {
          // Validate that total ratio won't exceed 100%
          const allComponents = await transaction.paintFormulaComponent.findMany({
            where: { formulaPaintId: componentExists.formulaPaintId },
          });

          const currentTotalRatio = allComponents
            .filter(comp => comp.id !== id)
            .reduce((sum, comp) => sum + comp.ratio, 0);
          const newTotalRatio = currentTotalRatio + data.ratio;

          if (newTotalRatio > 100.01) {
            // Allow small floating point error
            throw new BadRequestException(
              `Soma das proporções não pode exceder 100% (atual: ${currentTotalRatio.toFixed(2)}%, novo: ${data.ratio.toFixed(2)}%)`,
            );
          }

          updateData.ratio = data.ratio;
        }

        // Add other update fields
        if (data.itemId !== undefined) {
          updateData.itemId = data.itemId;
        }

        const updated = await this.paintFormulaComponentRepository.updateWithTransaction(
          transaction,
          id,
          updateData,
          { include },
        );

        // Recalculate all component ratios
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
        const fieldsToTrack = ['itemId', 'ratio', 'formulaPaintId'];
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
        const changes: string[] = [];
        if (data.itemId && data.itemId !== componentExists.itemId) {
          changes.push(`item alterado para ${data.itemId}`);
        }
        if (updateData.ratio && updateData.ratio !== componentExists.ratio) {
          changes.push(`proporção alterada para ${updateData.ratio.toFixed(2)}%`);
        }

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

        // Log impact on items if item changed
        if (data.itemId && data.itemId !== componentExists.itemId) {
          // Log removal from old item
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.ITEM,
            entityId: componentExists.itemId,
            action: CHANGE_ACTION.UPDATE,
            field: 'formulaComponents',
            reason: 'Item removido como componente de fórmula de tinta',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_UPDATE,
            triggeredById: id,
            userId: userId || 'system',
            transaction,
          });

          // Log addition to new item
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.ITEM,
            entityId: data.itemId,
            action: CHANGE_ACTION.UPDATE,
            field: 'formulaComponents',
            reason: 'Item adicionado como componente de fórmula de tinta',
            triggeredBy: CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_UPDATE,
            triggeredById: id,
            userId: userId || 'system',
            transaction,
          });
        }

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
          reason: `Componente excluído (${componentExists.ratio.toFixed(2)}%)`,
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
            ratio: componentExists.ratio,
          },
          newValue: null,
          reason: `Componente removido (${componentExists.ratio.toFixed(2)}%)`,
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
        // Validate total ratios by formula
        const formulaRatios = new Map<string, number>();
        for (const comp of data.paintFormulaComponents) {
          const currentRatio = formulaRatios.get(comp.formulaPaintId) || 0;
          formulaRatios.set(comp.formulaPaintId, currentRatio + comp.ratio);
        }

        // Check that each formula's total doesn't exceed 100%
        for (const [formulaId, totalRatio] of Array.from(formulaRatios.entries())) {
          if (totalRatio > 100.01) {
            // Allow small floating point error
            throw new BadRequestException(
              `Fórmula ${formulaId}: soma das proporções (${totalRatio.toFixed(2)}%) excede 100%`,
            );
          }
        }

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

          if (updateData.data.ratio !== undefined) {
            // Get current formula total excluding this component
            const allComponents = await transaction.paintFormulaComponent.findMany({
              where: { formulaPaintId: (existing as any).formulaPaintId },
            });

            const currentTotalRatio = allComponents
              .filter(comp => comp.id !== updateData.id)
              .reduce((sum, comp) => sum + comp.ratio, 0);

            const newTotalRatio = currentTotalRatio + updateData.data.ratio;

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
