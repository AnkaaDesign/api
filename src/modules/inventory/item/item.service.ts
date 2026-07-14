import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ItemRepository, PrismaTransaction } from './repositories/item/item.repository';
import type {
  Item,
  ItemBatchCreateResponse,
  ItemBatchDeleteResponse,
  ItemBatchUpdateResponse,
  ItemCreateResponse,
  ItemDeleteResponse,
  ItemGetManyResponse,
  ItemGetUniqueResponse,
  ItemUpdateResponse,
} from '../../../types';
import { UpdateData, BaseSummaryResponse } from '../../../types';
import type {
  ItemCreateFormData,
  ItemUpdateFormData,
  ItemGetManyFormData,
  ItemBatchDeleteFormData,
  ItemInclude,
} from '../../../schemas/item';
import {
  MeasureData,
  ItemDataWithMeasures,
  StockLevelQuery,
} from '../../../common/types/database.types';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  CHANGE_TRIGGERED_BY,
  MEASURE_UNIT,
  MEASURE_TYPE,
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
  ENTITY_TYPE,
  CHANGE_ACTION,
  STOCK_LEVEL,
  ORDER_STATUS,
  PPE_TYPE,
  PPE_SIZE,
  PPE_DELIVERY_MODE,
  ITEM_CATEGORY_TYPE,
  STOCK_MODEL,
} from '../../../constants/enums';
import {
  REGULAR_CONSUMPTION_REASONS,
} from '../../../constants/inventory-config';
import { PPE_SIZE_ORDER } from '../../../constants/sortOrders';
import {
  determineStockLevel,
  calculateMonthlyConsumption,
  calculateReorderPoint,
  calculateMaxQuantity,
  calculateConsumptionTrend,
  resolveSafetyTargetCell,
} from '../../../utils';
import { ItemRecomputeService } from '../services/item-recompute.service';
import { hasValueChanged } from '@modules/common/changelog/utils/serialize-changelog-value';
import { logEntityChange } from '@modules/common/changelog/utils/changelog-helpers';
import {
  convertToBatchOperationResult,
  generateBatchMessage,
} from '@modules/common/utils/batch-operation.utils';
import { StockNotificationService } from '../services/stock-notification.service';
import { StockCalculationResult } from '../services/atomic-stock-calculator.service';

interface ReorderPointUpdateResult {
  itemId: string;
  itemName: string;
  previousReorderPoint: number;
  newReorderPoint: number;
  avgDailyConsumption: number;
  safetyFactor: number;
  isVariable: boolean;
  percentageChange: number;
}

interface MaxQuantityUpdateResult {
  itemId: string;
  itemName: string;
  previousMaxQuantity: number;
  newMaxQuantity: number;
  monthlyConsumption: number;
  consumptionTrend: string;
  percentageChange: number;
}

@Injectable()
export class ItemService {
  private readonly logger = new Logger(ItemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly itemRepository: ItemRepository,
    private readonly changeLogService: ChangeLogService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly itemRecomputeService: ItemRecomputeService,
    private readonly stockNotificationService: StockNotificationService,
  ) {}

  /**
   * Check stock thresholds for a direct item edit.
   *
   * Routes through StockNotificationService.processStockNotifications — the SAME
   * threshold-bucket engine the activity-driven pipeline uses (audit F7) — so:
   * - direct edits and activity-driven changes share one source of truth;
   * - item.replenished fires on direct edits too (needs previousQuantity);
   * - item.reorder_required fires on activity-driven crossings as well;
   * - supplier-grouped aggregation + the 24h DB cooldown prevent storms.
   *
   * @param previousQuantity - Quantity BEFORE the edit (enables replenished /
   *   out-of-stock transition detection). Defaults to the current quantity when
   *   unknown (e.g., creation), which disables transition-based events.
   */
  private checkStockThresholds(item: Item, previousQuantity?: number): void {
    try {
      const prevQty = previousQuantity ?? item.quantity;

      const stockLevel = determineStockLevel({
        quantity: item.quantity,
        reorderPoint: item.reorderPoint ?? null,
        maxQuantity: item.maxQuantity ?? null,
        hasActiveOrder: false,
        stockModel: (item as any).stockModel ?? null,
        fixedTargetQuantity: (item as any).fixedTargetQuantity ?? null,
      });

      const calculation: StockCalculationResult = {
        itemId: item.id,
        itemName: item.name,
        currentQuantity: prevQty,
        finalQuantity: item.quantity,
        quantityChange: item.quantity - prevQty,
        isValid: true,
        errors: [],
        warnings: [],
        stockLevel,
        hasActiveOrders: false,
        reorderPoint: item.reorderPoint ?? null,
        maxQuantity: item.maxQuantity ?? null,
        operations: [],
      };

      void this.stockNotificationService
        .processStockNotifications([calculation], this.prisma)
        .catch(error =>
          this.logger.error(
            `Error dispatching stock notifications for item ${item.id}:`,
            error,
          ),
        );
    } catch (error) {
      this.logger.error(`Error checking stock thresholds for item ${item.id}:`, error);
    }
  }

  /**
   * Comprehensive item validation
   */
  private async validateItem(
    data: Partial<ItemCreateFormData | ItemUpdateFormData>,
    excludeId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const prismaClient = tx || this.prisma;
    const errors: string[] = [];

    // Check barcode uniqueness if provided
    if (data.barcodes && data.barcodes.length > 0) {
      for (const barcode of data.barcodes) {
        const existing = await (tx
          ? this.itemRepository.findByBarcodeWithTransaction(tx, barcode)
          : this.itemRepository.findByBarcode(barcode));
        if (existing && existing.id !== excludeId) {
          errors.push(`Código de barras "${barcode}" já está em uso por outro item`);
        }
      }
    }

    // Check name uniqueness within same category
    if (data.name || data.categoryId !== undefined) {
      // Get current item data if updating
      let currentItem: { name: string; categoryId: string | null } | null = null;
      if (excludeId) {
        currentItem = await prismaClient.item.findUnique({
          where: { id: excludeId },
          select: { name: true, categoryId: true },
        });
      }

      const nameToCheck = data.name || currentItem?.name;
      // Handle explicit null values from the update data
      const categoryIdToCheck =
        data.categoryId !== undefined ? data.categoryId : currentItem?.categoryId;

      if (nameToCheck) {
        // Build where clause handling null values correctly
        const whereClause: any = {
          name: nameToCheck,
          ...(excludeId && { NOT: { id: excludeId } }),
        };

        // Handle categoryId - use null explicitly if not provided
        if (categoryIdToCheck) {
          whereClause.categoryId = categoryIdToCheck;
        } else {
          whereClause.categoryId = null;
        }

        const existingItem = await prismaClient.item.findFirst({
          where: whereClause,
          include: {
            measures: true,
          },
        });

        if (existingItem) {
          // Check if items differ in uniCode, measures or PPE attributes
          const itemData = data as ItemDataWithMeasures;
          let hasDifferentAttributes = false;

          // Compare uniCode
          const newUniCode = (data as any).uniCode || null;
          const existingUniCode = existingItem.uniCode || null;

          if (newUniCode !== existingUniCode) {
            hasDifferentAttributes = true;
          }

          // Compare PPE type if present
          if (!hasDifferentAttributes) {
            const newPpeType = itemData.ppeType || null;
            const existingPpeType = existingItem.ppeType || null;

            if (newPpeType !== existingPpeType) {
              hasDifferentAttributes = true;
            }
          }

          // Compare measures if present
          if (!hasDifferentAttributes && itemData.measures && Array.isArray(itemData.measures)) {
            const newMeasures = itemData.measures as MeasureData[];
            const existingMeasures = existingItem.measures || [];

            // If the number of measures is different, they're different items
            if (newMeasures.length !== existingMeasures.length) {
              hasDifferentAttributes = true;
            } else {
              // Compare each measure
              // Sort by measureType for consistent comparison
              const sortedNew = [...newMeasures].sort((a, b) =>
                a.measureType.localeCompare(b.measureType),
              );
              const sortedExisting = [...existingMeasures].sort((a, b) =>
                a.measureType.localeCompare(b.measureType),
              );

              for (let i = 0; i < sortedNew.length; i++) {
                const newM = sortedNew[i];
                const existM = sortedExisting[i];

                if (
                  newM.measureType !== existM.measureType ||
                  newM.value !== existM.value ||
                  newM.unit !== existM.unit
                ) {
                  hasDifferentAttributes = true;
                  break;
                }
              }
            }
          } else if (
            !hasDifferentAttributes &&
            existingItem.measures &&
            existingItem.measures.length > 0
          ) {
            // Existing item has measures but new item doesn't (or vice versa)
            hasDifferentAttributes = true;
          }

          // Only throw error if items are truly identical
          if (!hasDifferentAttributes) {
            const categoryInfo = categoryIdToCheck ? ' para esta categoria' : '';
            errors.push(`Já existe um item com o nome "${nameToCheck}"${categoryInfo}`);
          }
        }
      }
    }

    // Validate every brandId in brandIds exists
    if (data.brandIds && data.brandIds.length > 0) {
      const uniqueBrandIds = [...new Set(data.brandIds)];
      const foundBrands = await prismaClient.itemBrand.findMany({
        where: { id: { in: uniqueBrandIds } },
        select: { id: true },
      });
      if (foundBrands.length !== uniqueBrandIds.length) {
        errors.push('Uma ou mais marcas não foram encontradas');
      }
    }

    // Validate itemCategoryId exists
    if (data.categoryId) {
      const category = await prismaClient.itemCategory.findUnique({
        where: { id: data.categoryId },
      });
      if (!category) {
        errors.push('Categoria não encontrada');
      }
    }

    // Validate supplierId exists if provided
    if (data.supplierId) {
      const supplier = await prismaClient.supplier.findUnique({
        where: { id: data.supplierId },
      });
      if (!supplier) {
        errors.push('Fornecedor não encontrado');
      }
    }

    // Ensure quantity is not negative
    if (data.quantity !== undefined && data.quantity < 0) {
      errors.push('Quantidade não pode ser negativa');
    }

    // Ensure maximumStock is not negative
    if (data.maxQuantity !== undefined && data.maxQuantity !== null && data.maxQuantity < 0) {
      errors.push('Estoque máximo não pode ser negativo');
    }

    // Validate capability fields (defense in depth — zod also validates):
    // fixedTargetQuantity only makes sense when the effective stockModel is FIXED_TARGET
    const capabilityData = data as {
      stockModel?: STOCK_MODEL | null;
      fixedTargetQuantity?: number | null;
    };
    if (
      capabilityData.fixedTargetQuantity !== undefined &&
      capabilityData.fixedTargetQuantity !== null
    ) {
      if (capabilityData.fixedTargetQuantity <= 0) {
        errors.push('Quantidade alvo deve ser maior que zero');
      }

      let effectiveStockModel: STOCK_MODEL | null | undefined = capabilityData.stockModel;
      if (effectiveStockModel === undefined && excludeId) {
        const existingItem = await prismaClient.item.findUnique({
          where: { id: excludeId },
          select: { stockModel: true },
        });
        effectiveStockModel = existingItem?.stockModel as STOCK_MODEL | undefined;
      }

      if ((effectiveStockModel ?? STOCK_MODEL.CONSUMPTION) !== STOCK_MODEL.FIXED_TARGET) {
        errors.push(
          'Quantidade alvo só pode ser definida quando o modelo de estoque é alvo fixo',
        );
      }
    }

    // Validate measures array if provided
    if ('measures' in data && data.measures && Array.isArray(data.measures)) {
      const measures = data.measures as MeasureData[];

      // Check for duplicate measure types
      const measureTypes = measures.map(m => m.measureType);
      const uniqueTypes = new Set(measureTypes);
      if (measureTypes.length !== uniqueTypes.size) {
        errors.push('Não é possível ter múltiplas medidas do mesmo tipo');
      }

      // Validate individual measures
      measures.forEach((measure, index: number) => {
        // For PPE sizes, either value OR unit should be provided, not both required
        // Numeric sizes (boots/pants): use value only
        // Letter sizes (shirts): use unit only
        const hasValue = measure.value !== undefined && measure.value !== null;
        const hasUnit = measure.unit !== undefined && measure.unit !== null;

        if (!hasValue && !hasUnit) {
          errors.push(`Medida ${index + 1}: Deve ter valor ou unidade definida`);
        }

        if (hasValue && measure.value! <= 0) {
          errors.push(`Medida ${index + 1}: Valor deve ser positivo`);
        }

        if (hasUnit && !Object.values(MEASURE_UNIT).includes(measure.unit as MEASURE_UNIT)) {
          errors.push(`Medida ${index + 1}: Unidade de medida inválida`);
        }

        if (
          !measure.measureType ||
          !Object.values(MEASURE_TYPE).includes(measure.measureType as MEASURE_TYPE)
        ) {
          errors.push(`Medida ${index + 1}: Tipo de medida inválido`);
        }
      });

      // Business rule: Paint items should have both weight and volume measures
      await this.validatePaintItemMeasures(data, measures, errors, tx);
    }

    // Validate PPE fields if item is configured as PPE
    // For updates, we need to consider the existing item's ppeType if not in update data
    let effectivePpeType = data.ppeType;
    if ((effectivePpeType === undefined || effectivePpeType === null) && excludeId) {
      // This is an update - check if existing item has ppeType
      const existingItem = await prismaClient.item.findUnique({
        where: { id: excludeId },
        select: { ppeType: true },
      });
      if (existingItem?.ppeType) {
        effectivePpeType = existingItem.ppeType as PPE_TYPE;
      }
    }

    if (effectivePpeType !== undefined && effectivePpeType !== null) {
      // Validate PPE type is valid enum value (only if it's being set/changed)
      if (data.ppeType !== undefined && data.ppeType !== null) {
        const validPpeTypes = Object.values(PPE_TYPE);
        if (!validPpeTypes.includes(data.ppeType as any)) {
          errors.push(`Tipo de PPE inválido. Valores válidos: ${validPpeTypes.join(', ')}`);
        }
      }

      // Validate PPE size is valid enum value
      if (data.ppeSize !== undefined && data.ppeSize !== null) {
        const validPpeSizes = Object.values(PPE_SIZE);
        if (!validPpeSizes.includes(data.ppeSize as any)) {
          errors.push(`Tamanho de PPE inválido. Valores válidos: ${validPpeSizes.join(', ')}`);
        }

        // Set ppeSizeOrder based on the size
        if ((data as any).ppeSizeOrder === undefined) {
          (data as any).ppeSizeOrder = PPE_SIZE_ORDER[data.ppeSize as PPE_SIZE];
        }
      }

      // Validate PPE delivery mode is valid enum value
      if (data.ppeDeliveryMode !== undefined && data.ppeDeliveryMode !== null) {
        const validDeliveryModes = Object.values(PPE_DELIVERY_MODE);
        if (!validDeliveryModes.includes(data.ppeDeliveryMode as any)) {
          errors.push(
            `Modo de entrega de PPE inválido. Valores válidos: ${validDeliveryModes.join(', ')}`,
          );
        }
      }

      // Validate PPE standard quantity
      if (data.ppeStandardQuantity !== undefined && data.ppeStandardQuantity !== null) {
        if (!Number.isInteger(data.ppeStandardQuantity) || data.ppeStandardQuantity <= 0) {
          errors.push('Quantidade padrão de PPE deve ser um número inteiro positivo');
        }
      }

      // If PPE type is set, ensure size and delivery mode are also set
      // Check for PPE size in measures array (SIZE type measure)
      let hasPpeSize = false;

      // Check if measures is an array or object and convert if needed
      if (data.measures) {
        let measuresArray = data.measures;

        // Convert object with numeric keys to array if needed
        if (!Array.isArray(data.measures) && typeof data.measures === 'object') {
          measuresArray = Object.values(data.measures);
        }

        if (Array.isArray(measuresArray)) {
          hasPpeSize = measuresArray.some(
            (m: any) => m.measureType === 'SIZE' && (m.value || m.unit),
          );
        }
      }

      // Size is not required for OTHERS type
      // For updates, check if existing item has the required field
      let existingHasPpeSize = false;
      let existingHasPpeDeliveryMode = false;
      if (excludeId) {
        const existingItem = await prismaClient.item.findUnique({
          where: { id: excludeId },
          select: { ppeDeliveryMode: true, measures: true },
        });
        if (existingItem) {
          // PPE size for items is stored in measures array with measureType: 'SIZE'
          existingHasPpeSize = (existingItem.measures as any[])?.some(
            (m: any) => m.measureType === 'SIZE' && (m.value || m.unit),
          );
          existingHasPpeDeliveryMode = !!existingItem.ppeDeliveryMode;
        }
      }

      // Only validate on create (when data.ppeType is set and no existing data)
      // Note: data.ppeSize is for legacy compatibility but size is stored in measures array
      if (data.ppeType && effectivePpeType !== 'OTHERS' && !hasPpeSize && !existingHasPpeSize) {
        errors.push('Tamanho é obrigatório para EPIs');
      }
      // Delivery mode is not required for OTHERS type
      if (
        data.ppeType &&
        effectivePpeType !== 'OTHERS' &&
        !data.ppeDeliveryMode &&
        !existingHasPpeDeliveryMode
      ) {
        errors.push('Modo de entrega é obrigatório para EPIs');
      }
    } else {
      // If ppeType is not set, ensure other PPE fields are not set
      if (data.ppeSize !== undefined && data.ppeSize !== null) {
        errors.push('Não é possível definir tamanho de PPE sem definir o tipo de PPE');
      }
      if (data.ppeCA !== undefined && data.ppeCA !== null) {
        errors.push('Não é possível definir certificado de aprovação sem definir o tipo de PPE');
      }
      if (data.ppeDeliveryMode !== undefined && data.ppeDeliveryMode !== null) {
        errors.push('Não é possível definir modo de entrega sem definir o tipo de PPE');
      }
      if (data.ppeStandardQuantity !== undefined && data.ppeStandardQuantity !== null) {
        errors.push('Não é possível definir quantidade padrão sem definir o tipo de PPE');
      }
    }

    // Throw all errors at once
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '));
    }
  }

  /**
   * Validate paint item measures - paint items should have both weight and volume
   */
  private async validatePaintItemMeasures(
    data: Partial<ItemCreateFormData | ItemUpdateFormData>,
    measures: any[],
    errors: string[],
    tx?: PrismaTransaction,
  ): Promise<void> {
    const prismaClient = tx || this.prisma;

    // Check if this is a paint item by checking category
    let categoryId = data.categoryId;

    // If updating, get current category if not provided
    if (!categoryId && data && 'id' in data && (data as any).id) {
      const currentItem = await prismaClient.item.findUnique({
        where: { id: (data as any).id },
        select: { categoryId: true },
      });
      categoryId = currentItem?.categoryId;
    }

    if (categoryId) {
      const category = await prismaClient.itemCategory.findUnique({
        where: { id: categoryId },
        select: { name: true },
      });

      // Check if category name contains "tinta" (paint in Portuguese)
      if (category?.name && category.name.toLowerCase().includes('tinta')) {
        const measureTypes = measures.map(m => m.measureType);
        const hasWeight = measureTypes.includes(MEASURE_TYPE.WEIGHT);
        const hasVolume = measureTypes.includes(MEASURE_TYPE.VOLUME);

        if (!hasWeight || !hasVolume) {
          errors.push('Itens de tinta devem ter medidas de peso e volume');
        }
      }
    }
  }

  /**
   * Create measures for an item
   */
  private async createItemMeasures(
    tx: PrismaTransaction,
    itemId: string,
    measures: any[],
    userId: string,
  ): Promise<void> {
    for (const measure of measures) {
      await tx.measure.create({
        data: {
          value: measure.value ?? null,
          unit: measure.unit ?? null,
          measureType: measure.measureType,
          itemId: itemId,
        },
      });
    }

    // Log the creation of the measures array as a whole
    if (measures.length > 0) {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.ITEM,
        entityId: itemId,
        action: CHANGE_ACTION.CREATE,
        field: 'measures',
        oldValue: null,
        newValue: measures,
        reason: 'Medidas adicionadas',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: itemId,
        userId: userId || null,
        transaction: tx,
      });
    }
  }

  /**
   * Update measures for an item
   */
  private async updateItemMeasures(
    tx: PrismaTransaction,
    itemId: string,
    measures: any[],
    userId: string,
  ): Promise<void> {
    // Get existing measures
    const existingMeasures = await tx.measure.findMany({
      where: { itemId },
    });

    // Delete all existing measures
    await tx.measure.deleteMany({
      where: { itemId },
    });

    // Create new measures
    for (const measure of measures) {
      await tx.measure.create({
        data: {
          value: measure.value ?? null,
          unit: measure.unit ?? null,
          measureType: measure.measureType,
          itemId: itemId,
        },
      });
    }

    // Format existing measures for changelog
    const oldMeasuresFormatted = existingMeasures.map(m => ({
      value: m.value,
      unit: m.unit,
      measureType: m.measureType,
    }));

    // Check if measures actually changed
    const measuresChanged = !this.areMeasuresEqual(oldMeasuresFormatted, measures);

    if (measuresChanged) {
      // Log the entire measures array change
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.ITEM,
        entityId: itemId,
        action: CHANGE_ACTION.UPDATE,
        field: 'measures',
        oldValue: oldMeasuresFormatted.length > 0 ? oldMeasuresFormatted : null,
        newValue: measures.length > 0 ? measures : null,
        reason: 'Medidas atualizadas',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: itemId,
        userId: userId || null,
        transaction: tx,
      });
    }
  }

  /**
   * Helper method to compare measures arrays
   */
  private areMeasuresEqual(measures1: any[], measures2: any[]): boolean {
    if (measures1.length !== measures2.length) {
      return false;
    }

    // Sort both arrays by measureType for comparison
    const sorted1 = [...measures1].sort((a, b) => a.measureType.localeCompare(b.measureType));
    const sorted2 = [...measures2].sort((a, b) => a.measureType.localeCompare(b.measureType));

    for (let i = 0; i < sorted1.length; i++) {
      const m1 = sorted1[i];
      const m2 = sorted2[i];
      if (m1.measureType !== m2.measureType || m1.value !== m2.value || m1.unit !== m2.unit) {
        return false;
      }
    }

    return true;
  }

  /**
   * An item's PPE size is stored as a SIZE **measure** — Item has no `ppeSize`
   * column (that exists only on User). Clients still send the size as a legacy
   * top-level `ppeSize` enum; this converts it into the SIZE measure the rest of
   * the pipeline (validation, storage, read-back) expects: letter sizes
   * (P/M/G/GG/XG) go in `unit`, numeric sizes (`SIZE_38` → 38) go in `value`.
   * Returns null when there is no usable size.
   */
  private ppeSizeToSizeMeasure(
    ppeSize: unknown,
  ): { measureType: MEASURE_TYPE; value: number | null; unit: string | null } | null {
    if (ppeSize === undefined || ppeSize === null || ppeSize === '') return null;
    const raw = String(ppeSize);
    const numeric = /^SIZE_(\d+(?:\.\d+)?)$/.exec(raw);
    if (numeric) {
      return { measureType: MEASURE_TYPE.SIZE, value: Number(numeric[1]), unit: null };
    }
    // Letter size (P, M, G, GG, XG) — stored in `unit`.
    return { measureType: MEASURE_TYPE.SIZE, value: null, unit: raw };
  }

  /**
   * Fold the legacy top-level `ppeSize` into the measures array as a SIZE measure
   * (see {@link ppeSizeToSizeMeasure}). Only applies to PPE items (`ppeType` set);
   * a fresh SIZE measure replaces any existing one. Returns the possibly-updated
   * measures array (or the original when there is nothing to add).
   */
  private foldPpeSizeIntoMeasures(itemData: any, measuresArray: any[] | null): any[] | null {
    const sizeMeasure = this.ppeSizeToSizeMeasure(itemData?.ppeSize);
    if (!itemData?.ppeType || !sizeMeasure) return measuresArray;
    const withoutSize = (measuresArray ?? []).filter((m: any) => m.measureType !== 'SIZE');
    return [...withoutSize, sizeMeasure];
  }

  /**
   * Create default measure from legacy measureValue/measureUnit fields
   */
  private async createDefaultMeasureFromLegacyFields(
    tx: PrismaTransaction,
    itemId: string,
    value: number,
    unit: MEASURE_UNIT,
    userId: string,
  ): Promise<void> {
    // Determine measure type based on unit
    let measureType: MEASURE_TYPE;

    const weightUnits = [MEASURE_UNIT.GRAM, MEASURE_UNIT.KILOGRAM];
    const volumeUnits = [MEASURE_UNIT.MILLILITER, MEASURE_UNIT.LITER];
    const lengthUnits = [
      MEASURE_UNIT.MILLIMETER,
      MEASURE_UNIT.CENTIMETER,
      MEASURE_UNIT.METER,
      MEASURE_UNIT.INCHES,
    ];

    if (weightUnits.includes(unit)) {
      measureType = MEASURE_TYPE.WEIGHT;
    } else if (volumeUnits.includes(unit)) {
      measureType = MEASURE_TYPE.VOLUME;
    } else if (lengthUnits.includes(unit)) {
      measureType = MEASURE_TYPE.LENGTH;
    } else {
      measureType = MEASURE_TYPE.COUNT;
    }

    await tx.measure.create({
      data: {
        value: value ?? null,
        unit: (unit as any) ?? null,
        measureType,
        itemId,
      },
    });
  }

  /**
   * Aplicar defaults de capacidade a partir da categoria na CRIAÇÃO.
   * Quando o cliente NÃO envia os campos explicitamente, a categoria escolhida
   * fornece os defaults: TOOL → isBorrowable=true, stockModel=FIXED_TARGET,
   * fixedTargetQuantity=1. Valores explícitos do cliente sempre vencem.
   * Em UPDATE a troca de categoria NUNCA altera os flags silenciosamente
   * (este método não é chamado no update).
   */
  private async applyCategoryCapabilityDefaults(
    itemData: any,
    tx: PrismaTransaction,
  ): Promise<void> {
    if (!itemData.categoryId) return;

    const allExplicit =
      itemData.isBorrowable !== undefined &&
      itemData.stockModel !== undefined &&
      itemData.fixedTargetQuantity !== undefined;
    if (allExplicit) return;

    const category = await tx.itemCategory.findUnique({
      where: { id: itemData.categoryId },
      select: { type: true },
    });

    if (category?.type !== ITEM_CATEGORY_TYPE.TOOL) return;

    if (itemData.isBorrowable === undefined) {
      itemData.isBorrowable = true;
    }
    if (itemData.stockModel === undefined) {
      itemData.stockModel = STOCK_MODEL.FIXED_TARGET;
    }
    if (
      itemData.fixedTargetQuantity === undefined &&
      itemData.stockModel === STOCK_MODEL.FIXED_TARGET
    ) {
      itemData.fixedTargetQuantity = 1;
    }
  }

  /**
   * Criar novo item
   */
  async create(
    data: ItemCreateFormData,
    include: ItemInclude | undefined,
    userId: string,
  ): Promise<ItemCreateResponse> {
    try {
      const item = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Extract measures from data before creating item
        const { measures, ...itemData } = data as any;

        // Convert measures object to array if needed
        let measuresArray: any[] | null = null;
        if (measures) {
          if (Array.isArray(measures)) {
            measuresArray = measures;
          } else if (typeof measures === 'object') {
            // Convert object with numeric keys to array
            measuresArray = Object.values(measures);
          }
        }

        // Defaults de capacidade a partir da categoria (somente na criação;
        // valores explícitos do cliente sempre vencem)
        await this.applyCategoryCapabilityDefaults(itemData, tx);

        // An item's PPE size lives as a SIZE measure (there is no ppeSize column);
        // fold the legacy top-level ppeSize in before validation + persistence.
        measuresArray = this.foldPpeSizeIntoMeasures(itemData, measuresArray);

        // Pass measures for validation
        const dataForValidation = {
          ...itemData,
          measures: measuresArray,
        };

        // Comprehensive validation
        await this.validateItem(dataForValidation, undefined, tx);

        // Criar o item
        const newItem = await this.itemRepository.createWithTransaction(tx, itemData, { include });

        // Create measures if provided
        if (measuresArray && Array.isArray(measuresArray)) {
          await this.createItemMeasures(tx, newItem.id, measuresArray, userId);
        }

        // Registrar no changelog
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ITEM,
          entityId: newItem.id,
          action: CHANGE_ACTION.CREATE,
          field: null,
          oldValue: null,
          newValue: newItem,
          reason: 'Item criado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: newItem.id,
          userId: userId || null,
          transaction: tx,
        });

        return newItem;
      });

      return {
        success: true,
        message: 'Item criado com sucesso',
        data: item,
      };
    } catch (error) {
      this.logger.error('Erro ao criar item:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar item. Por favor, tente novamente');
    }
  }

  /**
   * Atualizar item
   */
  async update(
    id: string,
    data: ItemUpdateFormData,
    include: ItemInclude | undefined,
    userId: string,
  ): Promise<ItemUpdateResponse> {
    try {
      // Captured inside the transaction for the post-commit threshold check
      // (replenished/out-of-stock detection needs the BEFORE quantity).
      let previousQuantity: number | undefined;

      const updatedItem = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar item existente
        const existingItem = await this.itemRepository.findByIdWithTransaction(tx, id);

        if (!existingItem) {
          throw new NotFoundException('Item não encontrado');
        }

        previousQuantity = existingItem.quantity;

        // Extract measures from data before updating item
        const { measures, ...itemData } = data as any;

        // Convert measures object to array if needed
        let measuresArray: any[] | null = null;
        if (measures) {
          if (Array.isArray(measures)) {
            measuresArray = measures;
          } else if (typeof measures === 'object') {
            // Convert object with numeric keys to array
            measuresArray = Object.values(measures);
          }
        }

        // An item's PPE size lives as a SIZE measure (there is no ppeSize column);
        // fold the legacy top-level ppeSize in before validation + persistence.
        measuresArray = this.foldPpeSizeIntoMeasures(itemData, measuresArray);

        // Pass measures for validation
        const dataForValidation = {
          ...itemData,
          measures: measuresArray,
        };

        // Comprehensive validation
        await this.validateItem(dataForValidation, id, tx);

        // Check if quantity is being updated
        const isQuantityChanging =
          itemData.quantity !== undefined && itemData.quantity !== existingItem.quantity;
        const quantityDifference = isQuantityChanging
          ? itemData.quantity - existingItem.quantity
          : 0;

        // Manual override flags were removed — the nightly engine always recomputes.

        // Atualizar o item
        const updatedItem = await this.itemRepository.updateWithTransaction(tx, id, itemData, {
          include,
        });

        // Update measures if provided
        if (measuresArray && Array.isArray(measuresArray)) {
          await this.updateItemMeasures(tx, id, measuresArray, userId);
        }

        // Create activity for inventory count if quantity changed
        if (isQuantityChanging && quantityDifference !== 0) {
          // Determine if it's an inbound or outbound operation
          const operation =
            quantityDifference > 0 ? ACTIVITY_OPERATION.INBOUND : ACTIVITY_OPERATION.OUTBOUND;
          const absoluteDifference = Math.abs(quantityDifference);

          // Create the activity record directly (without updating item quantity again)
          const activityData = {
            itemId: id,
            quantity: absoluteDifference,
            operation: operation,
            reason: ACTIVITY_REASON.INVENTORY_COUNT,
            userId: null, // No user for inventory count
          };

          // Create activity record directly in the database
          const newActivity = await tx.activity.create({
            data: activityData,
          });

          // Log the activity creation in changelog
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.ACTIVITY,
            entityId: newActivity.id,
            action: CHANGE_ACTION.CREATE,
            field: null,
            oldValue: null,
            newValue: newActivity,
            reason: `Atividade de contagem de inventário criada automaticamente devido a ajuste manual de quantidade`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });

          this.logger.log(
            `Created inventory count activity for item ${id}: ${operation} ${absoluteDifference} units`,
          );
        }

        // Registrar mudanças no changelog - track individual field changes
        const fieldsToTrack = Object.keys(itemData) as Array<keyof ItemUpdateFormData>;

        for (const field of fieldsToTrack) {
          const oldValue = existingItem[field as keyof typeof existingItem];
          const newValue = updatedItem[field as keyof typeof updatedItem];

          // Only log if the value actually changed
          if (hasValueChanged(oldValue, newValue)) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.ITEM,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: field,
              oldValue: oldValue,
              newValue: newValue,
              reason: `Campo ${field} atualizado`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        return updatedItem;
      });

      // Emit event if price, taxes, or measures were updated
      const shouldEmitEvent =
        data.price !== undefined ||
        data.icms !== undefined ||
        data.ipi !== undefined ||
        data.measures !== undefined;

      if (shouldEmitEvent) {
        // Emit event asynchronously (don't wait for formula recalculations)
        setImmediate(() => {
          this.eventEmitter.emit('item.updated', {
            itemId: id,
            userId: userId,
            changes: {
              price: data.price !== undefined,
              icms: data.icms !== undefined,
              ipi: data.ipi !== undefined,
              measures: data.measures !== undefined,
            },
          });
          this.logger.log(`Emitted item.updated event for item ${id}`);
        });
      }

      // Check stock thresholds if quantity was updated
      if (data.quantity !== undefined) {
        // Use setImmediate to emit events asynchronously
        setImmediate(() => {
          this.checkStockThresholds(updatedItem, previousQuantity);
        });
      }

      return {
        success: true,
        message: 'Item atualizado com sucesso',
        data: updatedItem,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar item:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao atualizar item. Por favor, tente novamente');
    }
  }

  async delete(id: string, userId: string): Promise<ItemDeleteResponse> {
    try {
      // Check if item exists
      const existing = await this.itemRepository.findById(id, {
        include: {
          activities: true,
          borrows: true,
          orderItems: true,
          prices: true,
        },
      });

      if (!existing) {
        throw new NotFoundException('Item não encontrado. Verifique se o ID está correto.');
      }

      // Check if item has dependencies
      const hasDependencies =
        (existing.activities && existing.activities.length > 0) ||
        (existing.borrows && existing.borrows.length > 0) ||
        (existing.orderItems && existing.orderItems.length > 0);

      if (hasDependencies) {
        throw new ConflictException(
          'Não é possível excluir item que possui histórico de movimentações.',
        );
      }

      await this.prisma.$transaction(async tx => {
        // Delete monetary values (prices) first
        if (existing.prices && existing.prices.length > 0) {
          await tx.monetaryValue.deleteMany({ where: { itemId: id } });
        }

        await this.itemRepository.deleteWithTransaction(tx, id);

        // Log deletion
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ITEM,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          field: null,
          oldValue: existing,
          newValue: null,
          reason: 'Item excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });
      });

      return {
        success: true,
        message: 'Item excluído com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao excluir item: ${errorMessage}`);
    }
  }

  /**
   * Buscar um item por ID
   */
  async findById(id: string, include?: ItemInclude): Promise<ItemGetUniqueResponse> {
    try {
      const item = await this.itemRepository.findById(id, { include });

      if (!item) {
        throw new NotFoundException('Item não encontrado');
      }

      return { success: true, data: item, message: 'Item carregado com sucesso' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar item por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar item. Por favor, tente novamente');
    }
  }

  /**
   * Buscar muitos itens com filtros
   */
  async findMany(query: ItemGetManyFormData): Promise<ItemGetManyResponse> {
    try {
      // Check if stock levels array filter is requested
      const stockLevelsArray = (query as any).stockLevels as STOCK_LEVEL[] | undefined;

      // Check for individual stock level filters and convert to stockLevels array
      const stockLevels: STOCK_LEVEL[] = [];
      if ((query as any).criticalStock === true) {
        stockLevels.push(STOCK_LEVEL.CRITICAL);
      }
      if ((query as any).lowStock === true) {
        stockLevels.push(STOCK_LEVEL.LOW);
      }
      if ((query as any).normalStock === true) {
        stockLevels.push(STOCK_LEVEL.OPTIMAL);
      }
      if ((query as any).outOfStock === true) {
        stockLevels.push(STOCK_LEVEL.OUT_OF_STOCK);
      }
      if ((query as any).overStock === true) {
        stockLevels.push(STOCK_LEVEL.OVERSTOCKED);
      }
      if ((query as any).negativeStock === true) {
        stockLevels.push(STOCK_LEVEL.NEGATIVE_STOCK);
      }

      // Use stockLevels array if provided, otherwise use individual filters
      const levelsToFilter =
        stockLevelsArray && stockLevelsArray.length > 0
          ? stockLevelsArray
          : stockLevels.length > 0
            ? stockLevels
            : undefined;

      if (levelsToFilter) {
        // Handle stock health filtering separately
        return await this.findManyWithStockHealth(query, levelsToFilter);
      }

      // Normal query without stock health filtering
      const result = await this.itemRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Itens carregados com sucesso',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar itens:', error);
      throw new InternalServerErrorException('Erro ao buscar itens. Por favor, tente novamente');
    }
  }

  /**
   * Find items filtered by stock health levels
   * Optimized version that uses a hybrid approach:
   * 1. Basic filtering at database level
   * 2. Precise stock level calculation for final results
   */
  private async findManyWithStockHealth(
    query: ItemGetManyFormData,
    stockHealthLevels: STOCK_LEVEL[],
  ): Promise<ItemGetManyResponse> {
    // Remove stock level filters and pagination from query for database query.
    // We handle pagination ourselves after in-memory filtering.
    // IMPORTANT: `limit` must be deleted because the repository prioritizes
    // `limit` over `take` (see: `take: options.limit || options.take`),
    // which would override our batch `take` value.
    const dbQuery = { ...query };
    delete (dbQuery as any).stockLevels;
    delete (dbQuery as any).criticalStock;
    delete (dbQuery as any).lowStock;
    delete (dbQuery as any).normalStock;
    delete (dbQuery as any).outOfStock;
    delete (dbQuery as any).overStock;
    delete (dbQuery as any).negativeStock;
    delete (dbQuery as any).limit;
    delete (dbQuery as any).page;
    delete (dbQuery as any).take;
    delete (dbQuery as any).skip;

    // Build a rough database filter to reduce the dataset
    // This will over-select items but dramatically reduce the in-memory processing
    const roughStockConditions = this.buildRoughStockConditions(stockHealthLevels);

    // Get active orders to check if items have active orders
    const activeOrderStatuses = [
      ORDER_STATUS.PARTIALLY_FULFILLED,
      ORDER_STATUS.FULFILLED,
      ORDER_STATUS.PARTIALLY_RECEIVED,
    ];

    const roughWhere = {
      ...dbQuery.where,
      isActive: true,
      ...(roughStockConditions.length > 0 ? { OR: roughStockConditions } : {}),
    };

    // Fetch ALL items matching rough conditions in page-based batches,
    // then apply precise in-memory filtering.
    // The repository ignores `skip` and calculates it from `page` and `take`,
    // so we must use page-based pagination to advance through results.
    const batchSize = 200;
    let currentPage = 1;
    let allFilteredItems: any[] = [];
    const incomingByItem = new Map<string, number>();
    const maxPages = 50; // Safety limit

    while (currentPage <= maxPages) {
      const batchQuery = {
        ...dbQuery,
        where: roughWhere,
        orderBy: dbQuery.orderBy || { id: 'asc' as const },
        page: currentPage,
        take: batchSize,
      };

      const batchResult = await this.itemRepository.findMany(batchQuery);

      if (!batchResult.data || batchResult.data.length === 0) {
        break;
      }

      // Get incoming-order quantities for this batch (open orders not yet received).
      const batchItemIds = batchResult.data.map(item => item.id);
      const batchOrderItems = await this.prisma.orderItem.findMany({
        where: {
          itemId: { in: batchItemIds },
          receivedAt: null,
          order: { status: { in: activeOrderStatuses } },
        },
        select: { itemId: true, orderedQuantity: true, receivedQuantity: true },
      });

      for (const oi of batchOrderItems) {
        const pending = Math.max(0, (oi.orderedQuantity ?? 0) - (oi.receivedQuantity ?? 0));
        incomingByItem.set(oi.itemId, (incomingByItem.get(oi.itemId) ?? 0) + pending);
      }

      // Apply precise stock level filtering on this batch
      const filtered = batchResult.data.filter(item => {
        const incoming = incomingByItem.get(item.id) ?? 0;
        const stockLevel = determineStockLevel({
          quantity: item.quantity,
          reorderPoint: item.reorderPoint,
          maxQuantity: item.maxQuantity,
          hasActiveOrder: incoming > 0,
          incomingOrderedQuantity: incoming,
          stockModel: item.stockModel ?? null,
          fixedTargetQuantity: item.fixedTargetQuantity ?? null,
        });
        return stockHealthLevels.includes(stockLevel);
      });

      allFilteredItems.push(...filtered);

      // If this batch returned fewer items than requested, we've reached the end
      if (batchResult.data.length < batchSize) {
        break;
      }

      currentPage++;
    }

    if (allFilteredItems.length === 0) {
      return {
        success: true,
        data: [],
        meta: {
          totalRecords: 0,
          page: query.page || 1,
          hasNextPage: false,
          take: query.limit || 20,
          totalPages: 0,
          hasPreviousPage: false,
        },
        message: 'Nenhum item encontrado',
      };
    }

    // Deduplicate items by ID (in case any duplicates slipped through)
    const seenIds = new Set<string>();
    allFilteredItems = allFilteredItems.filter(item => {
      if (seenIds.has(item.id)) {
        return false;
      }
      seenIds.add(item.id);
      return true;
    });

    // Apply pagination to the filtered results
    const page = query.page || 1;
    const limit = query.limit || 20;
    const startIndex = (page - 1) * limit;
    const totalFilteredCount = allFilteredItems.length;
    const paginatedItems = allFilteredItems.slice(startIndex, startIndex + limit);
    const hasNextPage = startIndex + limit < totalFilteredCount;
    const totalPages = Math.ceil(totalFilteredCount / limit);

    return {
      success: true,
      data: paginatedItems,
      meta: {
        totalRecords: totalFilteredCount,
        page,
        hasNextPage,
        take: limit,
        totalPages,
        hasPreviousPage: page > 1,
      },
      message: 'Itens filtrados por nível de estoque carregados com sucesso',
    };
  }

  /**
   * Build rough Prisma WHERE conditions for initial filtering
   * These conditions over-select to ensure we don't miss any items
   */
  private buildRoughStockConditions(stockLevels: STOCK_LEVEL[]): any[] {
    const conditions: any[] = [];
    let includeAllPositive = false;
    let includeAllWithReorderPoint = false;

    // Analyze which stock levels are requested
    const hasNegative = stockLevels.includes(STOCK_LEVEL.NEGATIVE_STOCK);
    const hasOutOfStock = stockLevels.includes(STOCK_LEVEL.OUT_OF_STOCK);
    const hasCritical = stockLevels.includes(STOCK_LEVEL.CRITICAL);
    const hasLow = stockLevels.includes(STOCK_LEVEL.LOW);
    const hasOptimal = stockLevels.includes(STOCK_LEVEL.OPTIMAL);
    const hasOverstocked = stockLevels.includes(STOCK_LEVEL.OVERSTOCKED);

    // Build conditions that will over-select
    if (hasNegative) {
      conditions.push({ quantity: { lt: 0 } });
    }

    if (hasOutOfStock) {
      conditions.push({ quantity: 0 });
    }

    if (hasCritical || hasLow) {
      // Include all items with reorderPoint set
      // Since Prisma doesn't support field-to-field comparison,
      // we'll be more permissive and filter precisely in memory
      includeAllWithReorderPoint = true;
    }

    if (hasOptimal) {
      // Include items without reorderPoint or with positive stock
      conditions.push({ reorderPoint: null });
      includeAllPositive = true;
    }

    if (hasOverstocked) {
      // Include all items with maxQuantity set
      conditions.push({
        AND: [{ maxQuantity: { not: null } }, { maxQuantity: { gt: 0 } }],
      });
    }

    // Simplify conditions if needed
    if (includeAllPositive) {
      conditions.push({ quantity: { gt: 0 } });
    }

    if (includeAllWithReorderPoint) {
      conditions.push({
        AND: [{ reorderPoint: { not: null } }, { reorderPoint: { gt: 0 } }],
      });
    }

    // If no specific conditions, return empty array to fetch all items
    // This ensures we don't miss anything during precise filtering
    if (conditions.length === 0 && stockLevels.length > 0) {
      // Return a condition that matches all items
      return [{ isActive: true }];
    }

    return conditions;
  }

  // =====================
  // INVENTORY MANAGEMENT
  // =====================

  /**
   * Validate stock availability for multiple items
   */
  async validateStockAvailability(
    items: { itemId: string; quantity: number }[],
    tx?: PrismaTransaction,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const prismaClient = tx || this.prisma;
    const errors: string[] = [];

    try {
      // Fetch all items at once
      const itemIds = items.map(item => item.itemId);
      const existingItems = await prismaClient.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, name: true, quantity: true, isActive: true },
      });

      const itemsMap = new Map(existingItems.map(item => [item.id, item]));

      // Validate each item
      for (const requestedItem of items) {
        const item = itemsMap.get(requestedItem.itemId);

        if (!item) {
          errors.push(`Item com ID ${requestedItem.itemId} não encontrado`);
          continue;
        }

        if (!item.isActive) {
          errors.push(`Item "${item.name}" está inativo e não pode ser movimentado`);
          continue;
        }

        if (item.quantity < requestedItem.quantity) {
          errors.push(
            `Estoque insuficiente para "${item.name}". Disponível: ${item.quantity}, Solicitado: ${requestedItem.quantity}`,
          );
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    } catch (error) {
      this.logger.error('Erro ao validar disponibilidade de estoque:', error);
      throw new InternalServerErrorException('Erro ao validar disponibilidade de estoque');
    }
  }

  /**
   * Update stock levels for multiple items
   */
  async updateStockLevels(
    items: { itemId: string; quantity: number; operation: 'ADD' | 'SUBTRACT' }[],
    reason: string,
    userId: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const prismaClient = tx || this.prisma;

    try {
      for (const item of items) {
        const currentItem = await prismaClient.item.findUnique({
          where: { id: item.itemId },
          select: { id: true, quantity: true, name: true },
        });

        if (!currentItem) {
          throw new NotFoundException(`Item com ID ${item.itemId} não encontrado`);
        }

        const newQuantity =
          item.operation === 'ADD'
            ? currentItem.quantity + item.quantity
            : currentItem.quantity - item.quantity;

        if (newQuantity < 0) {
          throw new BadRequestException(
            `Quantidade resultante negativa para item "${currentItem.name}"`,
          );
        }

        // Update the item quantity
        await prismaClient.item.update({
          where: { id: item.itemId },
          data: { quantity: newQuantity },
        });

        // Create activity record for tracking
        await prismaClient.activity.create({
          data: {
            itemId: item.itemId,
            quantity: item.quantity,
            operation:
              item.operation === 'ADD' ? ACTIVITY_OPERATION.INBOUND : ACTIVITY_OPERATION.OUTBOUND,
            reason: ACTIVITY_REASON.MANUAL_ADJUSTMENT,
            userId: userId,
          },
        });

        // Check stock level and create notification if needed
        const fullItem = await prismaClient.item.findUnique({
          where: { id: currentItem.id },
          select: {
            reorderPoint: true,
            maxQuantity: true,
            stockModel: true,
            fixedTargetQuantity: true,
          },
        });

        // Check incoming-order quantity (open OrderItems not yet received).
        const activeOrderStatuses = [
          ORDER_STATUS.PARTIALLY_FULFILLED,
          ORDER_STATUS.FULFILLED,
          ORDER_STATUS.PARTIALLY_RECEIVED,
        ];

        const openOrderItems = await prismaClient.orderItem.findMany({
          where: {
            itemId: currentItem.id,
            receivedAt: null,
            order: { status: { in: activeOrderStatuses } },
          },
          select: { orderedQuantity: true, receivedQuantity: true },
        });
        const incomingOrderedQuantity = openOrderItems.reduce(
          (sum, oi) => sum + Math.max(0, (oi.orderedQuantity ?? 0) - (oi.receivedQuantity ?? 0)),
          0,
        );
        const hasActiveOrder = incomingOrderedQuantity > 0;

        const stockLevel = determineStockLevel({
          quantity: newQuantity,
          reorderPoint: fullItem?.reorderPoint || null,
          maxQuantity: fullItem?.maxQuantity || null,
          hasActiveOrder,
          incomingOrderedQuantity,
          stockModel: fullItem?.stockModel ?? null,
          fixedTargetQuantity: fullItem?.fixedTargetQuantity ?? null,
        });

        if (stockLevel === STOCK_LEVEL.CRITICAL || stockLevel === STOCK_LEVEL.LOW) {
          await this.createLowStockNotification(
            currentItem.id,
            currentItem.name,
            newQuantity,
            fullItem?.reorderPoint || null,
            stockLevel,
          );
        }
      }
    } catch (error) {
      this.logger.error('Erro ao atualizar níveis de estoque:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao atualizar níveis de estoque');
    }
  }

  /**
   * Create low stock notification
   */
  private async createLowStockNotification(
    itemId: string,
    itemName: string,
    currentQuantity: number,
    reorderPoint: number | null,
    stockLevel: STOCK_LEVEL,
  ): Promise<void> {
    try {
      // TODO: Implement notification creation logic once notification service is available
      const levelMessage = stockLevel === STOCK_LEVEL.CRITICAL ? 'crítico' : 'baixo';
      const reorderInfo = reorderPoint !== null ? `, Ponto de reposição: ${reorderPoint}` : '';

      this.logger.warn(
        `Estoque ${levelMessage} detectado para item "${itemName}". ` +
          `Quantidade atual: ${currentQuantity}${reorderInfo}`,
      );
    } catch (error) {
      this.logger.error('Erro ao criar notificação de estoque baixo:', error);
    }
  }

  /**
   * Check items below minimum stock (LOW or CRITICAL levels)
   */
  async getItemsBelowMinimumStock(): Promise<BaseSummaryResponse<any[]>> {
    try {
      // Get all active items with their details
      const items = await this.prisma.item.findMany({
        where: {
          isActive: true,
          reorderPoint: { not: null },
        },
        include: {
          brands: { select: { name: true }, orderBy: { name: 'asc' } },
          category: { select: { name: true, type: true } },
          supplier: { select: { fantasyName: true } },
        },
      });

      // Get active orders to check if items have active orders
      const activeOrderStatuses = [
        ORDER_STATUS.PARTIALLY_FULFILLED,
        ORDER_STATUS.FULFILLED,
        ORDER_STATUS.PARTIALLY_RECEIVED,
      ];

      const itemIds = items.map(item => item.id);
      const orderItems = await this.prisma.orderItem.findMany({
        where: {
          itemId: { in: itemIds },
          order: {
            status: { in: activeOrderStatuses },
          },
        },
        include: {
          order: {
            select: { id: true, status: true },
          },
        },
      });

      // Aggregate incoming-order quantity per item.
      const incomingByItem = new Map<string, number>();
      for (const orderItem of orderItems) {
        if (orderItem.receivedAt != null) continue;
        const pending = Math.max(
          0,
          ((orderItem as any).orderedQuantity ?? 0) -
            ((orderItem as any).receivedQuantity ?? 0),
        );
        incomingByItem.set(
          orderItem.itemId,
          (incomingByItem.get(orderItem.itemId) ?? 0) + pending,
        );
      }

      const classify = (item: any) => {
        const incoming = incomingByItem.get(item.id) ?? 0;
        return determineStockLevel({
          quantity: item.quantity,
          reorderPoint: item.reorderPoint,
          maxQuantity: item.maxQuantity,
          hasActiveOrder: incoming > 0,
          incomingOrderedQuantity: incoming,
          stockModel: item.stockModel ?? null,
          fixedTargetQuantity: item.fixedTargetQuantity ?? null,
        });
      };

      // Filter items that are below minimum stock (LOW or CRITICAL)
      const itemsBelowMinimum = items.filter(item => {
        const stockLevel = classify(item);
        return stockLevel === STOCK_LEVEL.CRITICAL || stockLevel === STOCK_LEVEL.LOW;
      });

      // Sort by stock level priority (CRITICAL first) then by quantity
      itemsBelowMinimum.sort((a, b) => {
        const levelA = classify(a);
        const levelB = classify(b);

        // Sort by criticality first
        if (levelA !== levelB) {
          return levelA === STOCK_LEVEL.CRITICAL ? -1 : 1;
        }

        // Then by quantity
        return a.quantity - b.quantity;
      });

      // Format the response
      const formattedItems = itemsBelowMinimum.map(item => ({
        ...item,
        brandName: item.brands?.map(b => b.name).join(', ') || null,
        categoryName: item.category?.name || null,
        supplierName: item.supplier?.fantasyName || null,
        stockLevel: classify(item),
      }));

      return {
        success: true,
        message: `${formattedItems.length} itens abaixo do estoque mínimo`,
        data: formattedItems,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar itens abaixo do estoque mínimo:', error);
      throw new InternalServerErrorException('Erro ao buscar itens abaixo do estoque mínimo');
    }
  }

  /**
   * Get the current stock level for an item
   */
  async getItemStockLevel(
    itemId: string,
  ): Promise<{ stockLevel: STOCK_LEVEL; hasActiveOrder: boolean }> {
    try {
      const item = await this.prisma.item.findUnique({
        where: { id: itemId },
        select: {
          quantity: true,
          reorderPoint: true,
          maxQuantity: true,
          stockModel: true,
          fixedTargetQuantity: true,
        },
      });

      if (!item) {
        throw new NotFoundException('Item não encontrado');
      }

      // Aggregate incoming-order quantity (open OrderItems not yet received).
      const activeOrderStatuses = [
        ORDER_STATUS.PARTIALLY_FULFILLED,
        ORDER_STATUS.FULFILLED,
        ORDER_STATUS.PARTIALLY_RECEIVED,
      ];

      const openOrderItems = await this.prisma.orderItem.findMany({
        where: {
          itemId: itemId,
          receivedAt: null,
          order: { status: { in: activeOrderStatuses } },
        },
        select: { orderedQuantity: true, receivedQuantity: true },
      });
      const incomingOrderedQuantity = openOrderItems.reduce(
        (sum, oi) => sum + Math.max(0, (oi.orderedQuantity ?? 0) - (oi.receivedQuantity ?? 0)),
        0,
      );
      const hasActiveOrder = incomingOrderedQuantity > 0;

      const stockLevel = determineStockLevel({
        quantity: item.quantity,
        reorderPoint: item.reorderPoint,
        maxQuantity: item.maxQuantity,
        hasActiveOrder,
        incomingOrderedQuantity,
        stockModel: item.stockModel ?? null,
        fixedTargetQuantity: item.fixedTargetQuantity ?? null,
      });

      return { stockLevel, hasActiveOrder };
    } catch (error) {
      this.logger.error('Erro ao buscar nível de estoque do item:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar nível de estoque do item');
    }
  }

  /**
   * Get stock movement history for an item
   */
  async getStockMovementHistory(
    itemId: string,
    days: number = 30,
  ): Promise<BaseSummaryResponse<any[]>> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const activities = await this.prisma.activity.findMany({
        where: {
          itemId,
          createdAt: { gte: startDate },
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          order: { select: { id: true, description: true, status: true } },
          orderItem: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        message: `Histórico de movimentação dos últimos ${days} dias`,
        data: activities,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar histórico de movimentação:', error);
      throw new InternalServerErrorException('Erro ao buscar histórico de movimentação');
    }
  }

  // Batch operations
  async batchCreate(
    items: ItemCreateFormData[],
    include?: ItemInclude,
    userId?: string,
  ): Promise<ItemBatchCreateResponse<ItemCreateFormData>> {
    try {
      // Check for duplicate barcodes in the batch
      const allBarcodes: string[] = [];
      items.forEach(item => {
        if (item.barcodes) {
          allBarcodes.push(...item.barcodes);
        }
      });

      const uniqueBarcodes = new Set(allBarcodes);
      if (allBarcodes.length !== uniqueBarcodes.size) {
        throw new BadRequestException('Existem códigos de barras duplicados no lote de criação.');
      }

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successItems: any[] = [];
        const failedItems: any[] = [];

        // Processar cada item individualmente para capturar erros específicos
        for (let index = 0; index < items.length; index++) {
          const item = items[index];
          try {
            // Defaults de capacidade a partir da categoria (valores explícitos vencem)
            await this.applyCategoryCapabilityDefaults(item, tx);

            // Use comprehensive validation for each item
            await this.validateItem(item, undefined, tx);

            const createdItem = await this.itemRepository.createWithTransaction(tx, item, {
              include,
            });
            successItems.push(createdItem);

            // Registrar no changelog
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.ITEM,
              entityId: createdItem.id,
              action: CHANGE_ACTION.CREATE,
              field: null,
              oldValue: null,
              newValue: createdItem,
              reason: 'Item criado em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              triggeredById: createdItem.id,
              userId: userId || null,
              transaction: tx,
            });
          } catch (error: any) {
            failedItems.push({
              index,
              data: item,
              error: error.message || 'Erro desconhecido ao criar item',
              errorCode: error.name || 'UNKNOWN_ERROR',
            });
          }
        }

        return {
          success: successItems,
          failed: failedItems,
          totalCreated: successItems.length,
          totalFailed: failedItems.length,
        };
      });

      // Check stock thresholds AFTER commit for each created item, mirroring the
      // single-item create/update path (which fires checkStockThresholds on a
      // quantity write). Wrapped per item so a failure never breaks the flow.
      setImmediate(() => {
        for (const createdItem of result.success) {
          try {
            // Newly created items have no previous quantity (treated as the
            // current quantity — transition-based events don't apply).
            this.checkStockThresholds(createdItem as Item);
          } catch (error) {
            this.logger.error(
              `Error checking stock thresholds for created item ${createdItem?.id}:`,
              error,
            );
          }
        }
      });

      const batchOperationResult = convertToBatchOperationResult<Item, ItemCreateFormData>(result);
      const message = generateBatchMessage(
        'criado',
        batchOperationResult.totalSuccess,
        batchOperationResult.totalFailed,
        'item',
      );

      return {
        success: true,
        message,
        data: batchOperationResult,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao criar itens em lote: ${errorMessage}`);
    }
  }

  async batchUpdate(
    updates: { id: string; data: ItemUpdateFormData }[],
    include?: ItemInclude,
    userId?: string,
  ): Promise<ItemBatchUpdateResponse<ItemUpdateFormData>> {
    try {
      // Validate IDs exist
      const ids = updates.map(item => item.id);
      const existingItems = await this.itemRepository.findByIds(ids);
      const existingIds = new Set(existingItems.map(i => i.id));

      const missingIds = ids.filter(id => !existingIds.has(id));
      if (missingIds.length > 0) {
        throw new NotFoundException(
          `Os seguintes itens não foram encontrados: ${missingIds.join(', ')}`,
        );
      }

      const updateData: UpdateData<ItemUpdateFormData>[] = updates.map(item => ({
        id: item.id,
        data: item.data,
      }));

      // Items whose stock-relevant fields changed (id → previous quantity);
      // thresholds are checked for these AFTER commit, mirroring the
      // single-item update path.
      const itemsToCheckThresholds = new Map<string, number>();

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successItems: any[] = [];
        const failedItems: any[] = [];

        // Processar cada atualização individualmente para capturar erros específicos
        for (let index = 0; index < updateData.length; index++) {
          const update = updateData[index];
          try {
            // Buscar item existente antes de atualizar
            const existingItem = await this.itemRepository.findByIdWithTransaction(tx, update.id);
            if (!existingItem) {
              throw new NotFoundException('Item não encontrado');
            }

            // Use comprehensive validation for each item
            await this.validateItem(update.data, update.id, tx);

            const updatedItem = await this.itemRepository.updateWithTransaction(
              tx,
              update.id,
              update.data,
              { include },
            );
            successItems.push(updatedItem);

            // Flag for post-commit threshold check if a stock-relevant field
            // (quantity / reorderPoint / maxQuantity) actually changed.
            const stockFields: Array<keyof ItemUpdateFormData> = [
              'quantity',
              'reorderPoint',
              'maxQuantity',
            ];
            const stockFieldChanged = stockFields.some(
              field =>
                update.data[field] !== undefined &&
                hasValueChanged(
                  existingItem[field as keyof typeof existingItem],
                  updatedItem[field as keyof typeof updatedItem],
                ),
            );
            if (stockFieldChanged) {
              itemsToCheckThresholds.set(updatedItem.id, existingItem.quantity);
            }

            // Registrar no changelog - track individual field changes
            const fieldsToTrack = Object.keys(update.data) as Array<keyof ItemUpdateFormData>;

            for (const field of fieldsToTrack) {
              const oldValue = existingItem[field as keyof typeof existingItem];
              const newValue = updatedItem[field as keyof typeof updatedItem];

              // Only log if the value actually changed
              if (hasValueChanged(oldValue, newValue)) {
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.ITEM,
                  entityId: updatedItem.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: field,
                  oldValue: oldValue,
                  newValue: newValue,
                  reason: `Campo ${field} atualizado em lote`,
                  triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                  triggeredById: updatedItem.id,
                  userId: userId || null,
                  transaction: tx,
                });
              }
            }
          } catch (error: any) {
            failedItems.push({
              index,
              id: update.id,
              data: update.data,
              error: error.message || 'Erro desconhecido ao atualizar item',
              errorCode: error.name || 'UNKNOWN_ERROR',
            });
          }
        }

        return {
          success: successItems,
          failed: failedItems,
          totalUpdated: successItems.length,
          totalFailed: failedItems.length,
        };
      });

      // Check stock thresholds AFTER commit for items whose stock-relevant
      // fields changed, mirroring the single-item update path. Wrapped per item.
      if (itemsToCheckThresholds.size > 0) {
        setImmediate(() => {
          for (const updatedItem of result.success) {
            if (!itemsToCheckThresholds.has(updatedItem.id)) continue;
            try {
              this.checkStockThresholds(
                updatedItem as Item,
                itemsToCheckThresholds.get(updatedItem.id),
              );
            } catch (error) {
              this.logger.error(
                `Error checking stock thresholds for updated item ${updatedItem?.id}:`,
                error,
              );
            }
          }
        });
      }

      const batchOperationResult = convertToBatchOperationResult<
        Item,
        ItemUpdateFormData & { id: string }
      >(result);
      const message = generateBatchMessage(
        'atualizado',
        batchOperationResult.totalSuccess,
        batchOperationResult.totalFailed,
        'item',
      );

      return {
        success: true,
        message,
        data: batchOperationResult,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao atualizar itens em lote: ${errorMessage}`);
    }
  }

  async batchDelete(
    data: ItemBatchDeleteFormData,
    userId: string,
  ): Promise<ItemBatchDeleteResponse> {
    try {
      // Check if all items exist
      const existingItems = await this.itemRepository.findByIds(data.itemIds, {
        include: {
          activities: true,
          borrows: true,
          orderItems: true,
        },
      });
      const existingIds = new Set(existingItems.map(i => i.id));

      const missingIds = data.itemIds.filter(id => !existingIds.has(id));
      if (missingIds.length > 0) {
        throw new NotFoundException(
          `Os seguintes itens não foram encontrados: ${missingIds.join(', ')}`,
        );
      }

      // Check if any items have dependencies
      const itemsWithDependencies = existingItems.filter(
        item =>
          (item.activities && item.activities.length > 0) ||
          (item.borrows && item.borrows.length > 0) ||
          (item.orderItems && item.orderItems.length > 0),
      );

      if (itemsWithDependencies.length > 0) {
        const names = itemsWithDependencies.map(i => i.name);
        throw new ConflictException(
          `Os seguintes itens possuem histórico de movimentações e não podem ser excluídos: ${names.join(', ')}`,
        );
      }

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successItems: any[] = [];
        const failedItems: any[] = [];

        // Processar cada exclusão individualmente para capturar erros específicos
        for (let index = 0; index < data.itemIds.length; index++) {
          const itemId = data.itemIds[index];
          try {
            const item = existingItems.find(i => i.id === itemId);
            if (!item) {
              throw new NotFoundException('Item não encontrado');
            }

            // Verificar dependências
            const hasDependencies =
              (item.activities && item.activities.length > 0) ||
              (item.borrows && item.borrows.length > 0) ||
              (item.orderItems && item.orderItems.length > 0);

            if (hasDependencies) {
              throw new ConflictException(
                'Item possui histórico de movimentações e não pode ser excluído',
              );
            }

            // Excluir valores monetários (preços) primeiro
            await tx.monetaryValue.deleteMany({ where: { itemId } });

            // Excluir o item
            await this.itemRepository.deleteWithTransaction(tx, itemId);
            successItems.push({ id: itemId, deleted: true });

            // Registrar no changelog
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.ITEM,
              entityId: itemId,
              action: CHANGE_ACTION.DELETE,
              field: null,
              oldValue: item,
              newValue: null,
              reason: 'Item excluído em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              triggeredById: itemId,
              userId: userId || null,
              transaction: tx,
            });
          } catch (error: any) {
            failedItems.push({
              index,
              id: itemId,
              error: error.message || 'Erro desconhecido ao excluir item',
              errorCode: error.name || 'UNKNOWN_ERROR',
            });
          }
        }

        return {
          success: successItems,
          failed: failedItems,
          totalDeleted: successItems.length,
          totalFailed: failedItems.length,
        };
      });

      const batchOperationResult = convertToBatchOperationResult<
        { id: string; deleted: boolean },
        { id: string }
      >(result);
      const message = generateBatchMessage(
        'excluído',
        batchOperationResult.totalSuccess,
        batchOperationResult.totalFailed,
        'item',
      );

      return {
        success: true,
        message,
        data: batchOperationResult,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Erro ao excluir itens em lote: ${errorMessage}`);
    }
  }

  /**
   * Recompute monthlyConsumption (and rp/max/reorderQty/leadTime) for a single
   * item via the canonical stock-health engine. Thin wrapper kept for backward
   * compatibility with controllers; new code should call
   * `ItemRecomputeService.recomputeItemMetrics` directly.
   */
  async updateItemMonthlyConsumption(
    itemId: string,
    _userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    try {
      await this.itemRecomputeService.recomputeItemMetrics(itemId, tx);
    } catch (error) {
      this.logger.error(`Erro ao atualizar consumo mensal do item ${itemId}:`, error);
      // Don't throw — keep parity with the legacy non-throwing behavior so the
      // caller's primary operation isn't disrupted by a recompute failure.
    }
  }

  /**
   * Update monthlyConsumption field for all items in the system
   * Used for batch recalculation
   */
  async updateAllItemsMonthlyConsumption(
    userId?: string,
  ): Promise<{ success: number; failed: number; total: number }> {
    try {
      // Get all active items
      const items = await this.prisma.item.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      const total = items.length;
      let success = 0;
      let failed = 0;

      this.logger.log(`Starting batch monthly consumption update for ${total} items`);

      // Process items in batches of 10 to avoid overloading
      const batchSize = 10;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);

        // Process batch in parallel
        const promises = batch.map(async item => {
          try {
            await this.updateItemMonthlyConsumption(item.id, userId);
            success++;
          } catch (error) {
            failed++;
            this.logger.error(`Failed to update monthly consumption for item ${item.id}:`, error);
          }
        });

        await Promise.all(promises);

        // Log progress
        const processed = Math.min(i + batchSize, total);
        this.logger.log(
          `Processed ${processed}/${total} items (${success} success, ${failed} failed)`,
        );
      }

      this.logger.log(
        `Batch monthly consumption update completed: ${success} success, ${failed} failed out of ${total} items`,
      );

      return { success, failed, total };
    } catch (error) {
      this.logger.error('Erro ao atualizar consumo mensal de todos os itens:', error);
      throw new InternalServerErrorException('Erro ao atualizar consumo mensal de todos os itens');
    }
  }

  /**
   * Automatically update reorder points based on consumption patterns
   * This method can be called periodically via a cron job
   */
  async updateReorderPointsBasedOnConsumption(
    userId: string,
    lookbackDays: number = 90,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      totalAnalyzed: number;
      totalUpdated: number;
      updates: ReorderPointUpdateResult[];
    };
  }> {
    try {
      // Get all active items
      const items = await this.prisma.item.findMany({
        where: {
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          createdAt: true,
          reorderPoint: true,
          maxQuantity: true,
          estimatedLeadTime: true,
          boxQuantity: true,
          quantity: true,
          monthlyConsumption: true,
          abcCategory: true,
          xyzCategory: true,
          ppeType: true,
          ppeDeliveryMode: true,
          ppeStandardQuantity: true,
          stockModel: true,
          fixedTargetQuantity: true,
          category: { select: { type: true } },
        },
      });

      if (items.length === 0) {
        return {
          success: true,
          message: 'Nenhum item ativo encontrado para análise',
          data: {
            totalAnalyzed: 0,
            totalUpdated: 0,
            updates: [],
          },
        };
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

      const activities = (await this.prisma.activity.findMany({
        where: {
          itemId: { in: items.map(item => item.id) },
          createdAt: { gte: cutoffDate },
        },
        orderBy: { createdAt: 'desc' },
      })) as any as import('@types').Activity[];

      // Group activities by item
      const activitiesByItem = new Map<string, typeof activities>();
      for (const activity of activities) {
        const itemActivities = activitiesByItem.get(activity.itemId) || [];
        itemActivities.push(activity);
        activitiesByItem.set(activity.itemId, itemActivities);
      }

      const now = new Date();
      const reorderPointUpdates = items.map(item =>
        this.computeReorderPointUpdate(item as any, activitiesByItem.get(item.id) ?? [], now),
      );

      // Apply updates in a transaction
      const updatedItems = await this.prisma.$transaction(async tx => {
        const successfulUpdates: ReorderPointUpdateResult[] = [];

        for (const update of reorderPointUpdates) {
          try {
            // Update the item's reorder point
            await tx.item.update({
              where: { id: update.itemId },
              data: { reorderPoint: update.newReorderPoint },
            });

            // Log the change
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.ITEM,
              entityId: update.itemId,
              action: CHANGE_ACTION.UPDATE,
              field: 'reorderPoint',
              oldValue: update.previousReorderPoint,
              newValue: update.newReorderPoint,
              reason: `Ponto de reposição atualizado automaticamente. Consumo médio diário: ${update.avgDailyConsumption.toFixed(2)}, Fator de segurança: ${(update.safetyFactor * 100).toFixed(0)}% (${update.isVariable ? 'consumo variável' : 'consumo estável'})`,
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              triggeredById: update.itemId,
              userId: userId || null,
              transaction: tx,
            });

            successfulUpdates.push(update);
          } catch (error) {
            this.logger.error(
              `Erro ao atualizar ponto de reposição para item ${update.itemId}:`,
              error,
            );
          }
        }

        return successfulUpdates;
      });

      return {
        success: true,
        message: `Análise de ponto de reposição concluída. ${updatedItems.length} de ${items.length} itens atualizados.`,
        data: {
          totalAnalyzed: items.length,
          totalUpdated: updatedItems.length,
          updates: updatedItems,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar pontos de reposição:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar pontos de reposição baseados em consumo',
      );
    }
  }

  private computeReorderPointUpdate(
    item: any,
    activities: any[],
    now: Date,
  ): ReorderPointUpdateResult {
    const { monthlyConsumption } = calculateMonthlyConsumption({
      item,
      activities,
      now,
    });
    const cell = resolveSafetyTargetCell(
      item.abcCategory ?? null,
      item.xyzCategory ?? null,
      (item as any).ordersLast12Months ?? null,
    );
    const leadTimeDays = item.estimatedLeadTime ?? 25;
    const newReorderPoint = calculateReorderPoint({
      item,
      monthlyConsumption,
      leadTimeDays,
      safetyFactor: cell.safetyFactor,
      now,
    });
    const previousReorderPoint = item.reorderPoint ?? 0;
    const percentageChange =
      previousReorderPoint > 0
        ? ((newReorderPoint - previousReorderPoint) / previousReorderPoint) * 100
        : newReorderPoint > 0
          ? 100
          : 0;
    return {
      itemId: item.id,
      itemName: item.name,
      previousReorderPoint,
      newReorderPoint,
      avgDailyConsumption: monthlyConsumption / 30,
      safetyFactor: cell.safetyFactor,
      isVariable: (item.xyzCategory ?? null) === 'Z',
      percentageChange,
    };
  }

  /**
   * Get reorder point analysis for specific items
   * Returns analysis without updating the database
   */
  async analyzeReorderPoints(
    itemIds: string[],
    lookbackDays: number = 90,
  ): Promise<{
    success: boolean;
    message: string;
    data: ReorderPointUpdateResult[];
  }> {
    try {
      // Get specified items
      const items = await this.prisma.item.findMany({
        where: {
          id: { in: itemIds },
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          createdAt: true,
          reorderPoint: true,
          maxQuantity: true,
          estimatedLeadTime: true,
          boxQuantity: true,
          quantity: true,
          monthlyConsumption: true,
          abcCategory: true,
          xyzCategory: true,
          ppeType: true,
          ppeDeliveryMode: true,
          ppeStandardQuantity: true,
          stockModel: true,
          fixedTargetQuantity: true,
          category: { select: { type: true } },
        },
      });

      if (items.length === 0) {
        return {
          success: true,
          message: 'Nenhum item ativo encontrado para análise',
          data: [],
        };
      }

      // Get activities for specified items
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

      const activities = (await this.prisma.activity.findMany({
        where: {
          itemId: { in: items.map(item => item.id) },
          createdAt: { gte: cutoffDate },
        },
        orderBy: { createdAt: 'desc' },
      })) as any as import('@types').Activity[];

      // Group activities by item
      const activitiesByItem = new Map<string, typeof activities>();
      for (const activity of activities) {
        const itemActivities = activitiesByItem.get(activity.itemId) || [];
        itemActivities.push(activity);
        activitiesByItem.set(activity.itemId, itemActivities);
      }

      const now = new Date();
      const reorderPointAnalysis = items.map(item =>
        this.computeReorderPointUpdate(item as any, activitiesByItem.get(item.id) ?? [], now),
      );

      return {
        success: true,
        message: `Análise de ponto de reposição concluída para ${reorderPointAnalysis.length} itens`,
        data: reorderPointAnalysis,
      };
    } catch (error) {
      this.logger.error('Erro ao analisar pontos de reposição:', error);
      throw new InternalServerErrorException('Erro ao analisar pontos de reposição');
    }
  }

  /**
   * Automatically update maxQuantity based on consumption patterns
   * This method can be called periodically via a cron job
   */
  async updateMaxQuantitiesBasedOnConsumption(
    userId: string,
    lookbackDays: number = 90,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      totalAnalyzed: number;
      totalUpdated: number;
      updates: MaxQuantityUpdateResult[];
    };
  }> {
    try {
      // Get all active items
      const items = await this.prisma.item.findMany({
        where: {
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          createdAt: true,
          maxQuantity: true,
          reorderPoint: true,
          estimatedLeadTime: true,
          boxQuantity: true,
          quantity: true,
          monthlyConsumption: true,
          abcCategory: true,
          xyzCategory: true,
          ppeType: true,
          ppeDeliveryMode: true,
          ppeStandardQuantity: true,
          stockModel: true,
          fixedTargetQuantity: true,
          category: { select: { type: true } },
        },
      });

      if (items.length === 0) {
        return {
          success: true,
          message: 'Nenhum item ativo encontrado para análise',
          data: {
            totalAnalyzed: 0,
            totalUpdated: 0,
            updates: [],
          },
        };
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

      const activities = (await this.prisma.activity.findMany({
        where: {
          itemId: { in: items.map(item => item.id) },
          createdAt: { gte: cutoffDate },
        },
        orderBy: { createdAt: 'desc' },
      })) as any as import('@types').Activity[];

      // Group activities by item
      const activitiesByItem = new Map<string, typeof activities>();
      for (const activity of activities) {
        const itemActivities = activitiesByItem.get(activity.itemId) || [];
        itemActivities.push(activity);
        activitiesByItem.set(activity.itemId, itemActivities);
      }

      const now = new Date();
      const maxQuantityUpdates = items.map(item =>
        this.computeMaxQuantityUpdate(item as any, activitiesByItem.get(item.id) ?? [], now),
      );

      // Apply updates in a transaction
      const updatedItems = await this.prisma.$transaction(async tx => {
        const successfulUpdates: MaxQuantityUpdateResult[] = [];

        for (const update of maxQuantityUpdates) {
          try {
            // Update the item's maxQuantity
            await tx.item.update({
              where: { id: update.itemId },
              data: { maxQuantity: update.newMaxQuantity },
            });

            // Log the change
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.ITEM,
              entityId: update.itemId,
              action: CHANGE_ACTION.UPDATE,
              field: 'maxQuantity',
              oldValue: update.previousMaxQuantity,
              newValue: update.newMaxQuantity,
              reason: `Quantidade máxima atualizada automaticamente. Consumo mensal: ${update.monthlyConsumption.toFixed(2)}, Tendência: ${update.consumptionTrend}`,
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              triggeredById: update.itemId,
              userId: userId || null,
              transaction: tx,
            });

            successfulUpdates.push(update);
          } catch (error) {
            this.logger.error(
              `Erro ao atualizar quantidade máxima para item ${update.itemId}:`,
              error,
            );
          }
        }

        return successfulUpdates;
      });

      return {
        success: true,
        message: `Análise de quantidade máxima concluída. ${updatedItems.length} de ${items.length} itens atualizados.`,
        data: {
          totalAnalyzed: items.length,
          totalUpdated: updatedItems.length,
          updates: updatedItems,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar quantidades máximas:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar quantidades máximas baseadas em consumo',
      );
    }
  }

  private computeMaxQuantityUpdate(
    item: any,
    activities: any[],
    now: Date,
  ): MaxQuantityUpdateResult {
    const { monthlyConsumption } = calculateMonthlyConsumption({
      item,
      activities,
      now,
    });
    const cell = resolveSafetyTargetCell(
      item.abcCategory ?? null,
      item.xyzCategory ?? null,
      (item as any).ordersLast12Months ?? null,
    );
    const leadTimeDays = item.estimatedLeadTime ?? 25;
    const reorderPoint = calculateReorderPoint({
      item,
      monthlyConsumption,
      leadTimeDays,
      safetyFactor: cell.safetyFactor,
      now,
    });
    const newMaxQuantity = calculateMaxQuantity({
      item,
      monthlyConsumption,
      leadTimeDays,
      reorderPoint,
      targetStockDays: cell.targetStockDays,
      now,
    });
    const previousMaxQuantity = item.maxQuantity ?? 0;
    const percentageChange =
      previousMaxQuantity > 0
        ? ((newMaxQuantity - previousMaxQuantity) / previousMaxQuantity) * 100
        : newMaxQuantity > 0
          ? 100
          : 0;
    const trendPercent = calculateConsumptionTrend([]);
    const trendLabel = trendPercent > 20 ? 'alta' : trendPercent < -20 ? 'queda' : 'estável';
    return {
      itemId: item.id,
      itemName: item.name,
      previousMaxQuantity,
      newMaxQuantity,
      monthlyConsumption,
      consumptionTrend: trendLabel,
      percentageChange,
    };
  }

  /**
   * Get maxQuantity analysis for specific items
   * Returns analysis without updating the database
   */
  async analyzeMaxQuantities(
    itemIds: string[],
    lookbackDays: number = 90,
  ): Promise<{
    success: boolean;
    message: string;
    data: MaxQuantityUpdateResult[];
  }> {
    try {
      // Get specified items
      const items = await this.prisma.item.findMany({
        where: {
          id: { in: itemIds },
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          createdAt: true,
          maxQuantity: true,
          reorderPoint: true,
          estimatedLeadTime: true,
          boxQuantity: true,
          quantity: true,
          monthlyConsumption: true,
          abcCategory: true,
          xyzCategory: true,
          ppeType: true,
          ppeDeliveryMode: true,
          ppeStandardQuantity: true,
          stockModel: true,
          fixedTargetQuantity: true,
          category: { select: { type: true } },
        },
      });

      if (items.length === 0) {
        return {
          success: true,
          message: 'Nenhum item ativo encontrado para análise',
          data: [],
        };
      }

      // Get activities for specified items
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

      const activities = (await this.prisma.activity.findMany({
        where: {
          itemId: { in: items.map(item => item.id) },
          createdAt: { gte: cutoffDate },
        },
        orderBy: { createdAt: 'desc' },
      })) as any as import('@types').Activity[];

      // Group activities by item
      const activitiesByItem = new Map<string, typeof activities>();
      for (const activity of activities) {
        const itemActivities = activitiesByItem.get(activity.itemId) || [];
        itemActivities.push(activity);
        activitiesByItem.set(activity.itemId, itemActivities);
      }

      const now = new Date();
      const maxQuantityAnalysis = items.map(item =>
        this.computeMaxQuantityUpdate(item as any, activitiesByItem.get(item.id) ?? [], now),
      );

      return {
        success: true,
        message: `Análise de quantidade máxima concluída para ${maxQuantityAnalysis.length} itens`,
        data: maxQuantityAnalysis,
      };
    } catch (error) {
      this.logger.error('Erro ao analisar quantidades máximas:', error);
      throw new InternalServerErrorException('Erro ao analisar quantidades máximas');
    }
  }

  /**
   * Adjust prices for multiple items by a percentage
   */
  async adjustItemPrices(
    itemIds: string[],
    percentage: number,
    userId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      totalSuccess: number;
      totalFailed: number;
      results: any[];
    };
  }> {
    try {
      // Validate percentage
      if (percentage < -100 || percentage > 1000) {
        throw new BadRequestException('Percentual deve estar entre -100% e 1000%');
      }

      if (!itemIds || itemIds.length === 0) {
        return {
          success: false,
          message: 'Nenhum item foi selecionado',
          data: {
            totalSuccess: 0,
            totalFailed: 0,
            results: [],
          },
        };
      }

      // Get items with their current prices
      const items = await this.prisma.item.findMany({
        where: {
          id: { in: itemIds },
        },
        include: {
          prices: {
            orderBy: {
              createdAt: 'desc' as const,
            },
            take: 1,
          },
        },
      });

      if (items.length === 0) {
        return {
          success: false,
          message: 'Nenhum item encontrado para ajuste',
          data: {
            totalSuccess: 0,
            totalFailed: 0,
            results: [],
          },
        };
      }

      const results: any[] = [];
      let successCount = 0;
      let failCount = 0;

      // Process each item in a transaction - but don't fail the whole batch if one fails
      const processedResults = await this.prisma.$transaction(async tx => {
        const batchResults: any[] = [];

        for (const item of items) {
          const itemIdentifier = item.uniCode ? `${item.uniCode} - ${item.name}` : item.name;

          try {
            // Get current price from monetary values
            let currentPrice = 0;
            if (item.prices && item.prices.length > 0) {
              currentPrice = item.prices[0].value;
            }

            if (currentPrice === 0) {
              batchResults.push({
                itemId: item.id,
                itemName: itemIdentifier,
                success: false,
                error: 'Item não possui preço definido',
              });
              continue;
            }

            // Validate new price
            const adjustment = currentPrice * (percentage / 100);
            const newPrice = currentPrice + adjustment;

            if (newPrice < 0) {
              batchResults.push({
                itemId: item.id,
                itemName: itemIdentifier,
                success: false,
                error: 'Preço não pode ser negativo',
              });
              continue;
            }

            // Mark all existing monetary values as not current
            await tx.monetaryValue.updateMany({
              where: { itemId: item.id, current: true },
              data: { current: false },
            });

            // Create new monetary value record marked as current
            await tx.monetaryValue.create({
              data: {
                itemId: item.id,
                value: newPrice,
                current: true,
              },
            });

            // Log the change - wrap in try-catch to not fail the price update
            try {
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.ITEM,
                entityId: item.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'price',
                oldValue: currentPrice.toFixed(2),
                newValue: newPrice.toFixed(2),
                reason: `Ajuste de ${percentage}%`,
                triggeredBy: CHANGE_TRIGGERED_BY.USER,
                triggeredById: null,
                userId: userId || null,
                transaction: tx,
              });
            } catch (logError) {
              this.logger.error(`Erro ao logar mudança para item ${item.id}:`, logError);
              // Continue even if changelog fails
            }

            batchResults.push({
              itemId: item.id,
              itemName: itemIdentifier,
              success: true,
              oldPrice: currentPrice,
              newPrice: newPrice,
              adjustment: adjustment,
              percentageApplied: percentage,
            });
          } catch (error: any) {
            this.logger.error(`Erro ao ajustar preço do item ${item.id}:`, error);
            batchResults.push({
              itemId: item.id,
              itemName: itemIdentifier,
              success: false,
              error: error.message || 'Erro ao ajustar preço',
            });
          }
        }

        return batchResults;
      });

      // Count successes and failures
      processedResults.forEach(result => {
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
        results.push(result);
      });

      const allFailed = successCount === 0 && failCount > 0;
      const partialSuccess = successCount > 0 && failCount > 0;

      let message = '';
      if (allFailed) {
        message = `Falha ao ajustar preços. Nenhum item foi atualizado.`;
      } else if (partialSuccess) {
        message = `Ajuste parcial: ${successCount} ${successCount === 1 ? 'item atualizado' : 'itens atualizados'}, ${failCount} ${failCount === 1 ? 'falhou' : 'falharam'}.`;
      } else {
        message = `Ajuste concluído: ${successCount} ${successCount === 1 ? 'item atualizado' : 'itens atualizados'} com sucesso.`;
      }

      // Emit events for all successfully updated items
      if (successCount > 0) {
        setImmediate(() => {
          const successfulItemIds = results.filter(r => r.success).map(r => r.itemId);
          for (const itemId of successfulItemIds) {
            this.eventEmitter.emit('item.updated', {
              itemId: itemId,
              userId: userId,
              changes: {
                price: true,
                icms: false,
                ipi: false,
                measures: false,
              },
            });
          }
          this.logger.log(
            `Emitted item.updated events for ${successfulItemIds.length} items after batch price adjustment`,
          );
        });
      }

      return {
        success: !allFailed,
        message,
        data: {
          totalSuccess: successCount,
          totalFailed: failCount,
          results: results,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao ajustar preços dos itens:', error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Erro ao ajustar preços dos itens');
    }
  }

  /**
   * Merge multiple items into a target item
   */
  async merge(
    data: {
      sourceItemIds: string[];
      targetItemId: string;
      conflictResolutions?: Record<string, any>;
    },
    include?: ItemInclude,
    userId?: string,
  ) {
    // 0. Validate input: the target must not appear in the source list, and the
    // source list must be non-empty after de-duplication. Without this guard the
    // target item could be deleted in step 15, destroying the merge result.
    const sourceItemIds = [...new Set(data.sourceItemIds)].filter(
      id => id !== data.targetItemId,
    );
    if (sourceItemIds.length === 0) {
      throw new BadRequestException(
        'Selecione ao menos um item de origem diferente do item principal para mesclar',
      );
    }
    data = { ...data, sourceItemIds };

    return await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // 1. Fetch target item and source items
      const targetItem = await tx.item.findUnique({
        where: { id: data.targetItemId },
        include: {
          prices: { orderBy: { createdAt: 'desc' } },
          measures: true,
          activities: true,
          borrows: true,
          orderItems: true,
          relatedItems: true,
          relatedTo: true,
          ppeDelivery: true,
          brands: true,
          category: true,
          supplier: true,
        },
      });

      if (!targetItem) {
        throw new NotFoundException(`Item alvo com ID ${data.targetItemId} não encontrado`);
      }

      const sourceItems = await tx.item.findMany({
        where: { id: { in: data.sourceItemIds } },
        include: {
          prices: { orderBy: { createdAt: 'desc' } },
          measures: true,
          activities: true,
          borrows: true,
          orderItems: true,
          relatedItems: true,
          relatedTo: true,
          ppeDelivery: true,
          maintenanceItemsNeeded: true,
          formulaComponents: true,
          externalOperationItems: true,
          brands: true,
          paintBrands: true,
          paintTypes: true,
          requiredByFispqs: true,
          category: true,
          supplier: true,
        },
      });

      if (sourceItems.length !== data.sourceItemIds.length) {
        const foundIds = sourceItems.map(i => i.id);
        const missingIds = data.sourceItemIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Itens de origem não encontrados: ${missingIds.join(', ')}`);
      }

      // 2. Detect conflicts and track merge details
      const mergeDetails: any = {
        targetItemId: data.targetItemId,
        sourceItemIds: data.sourceItemIds,
        conflicts: [],
        mergedRelations: {
          prices: 0,
          activities: 0,
          borrows: 0,
          orderItems: 0,
          relatedItems: 0,
          measures: 0,
          measuresDropped: 0,
          consumptionSnapshots: 0,
          barcodes: 0,
          maintenanceItemsNeeded: 0,
          formulaComponents: 0,
          externalOperationItems: 0,
          ppeDeliveries: 0,
          ppeScheduleItems: 0,
          maintenance: 0,
          maintenanceSchedules: 0,
          orderRules: 0,
          fispq: 0,
          brands: 0,
          paintBrands: 0,
          paintTypes: 0,
          requiredByFispqs: 0,
        },
        quantityStrategy: 'sum',
        totalQuantityMerged: 0,
      };

      // Check for field conflicts
      const fieldConflicts = this.detectItemConflicts(targetItem, sourceItems);
      if (Object.keys(fieldConflicts).length > 0) {
        mergeDetails.conflicts = fieldConflicts;
      }

      // 3. Merge quantities (sum all source quantities into target)
      const totalSourceQuantity = sourceItems.reduce((sum, item) => sum + item.quantity, 0);
      await tx.item.update({
        where: { id: data.targetItemId },
        data: { quantity: targetItem.quantity + totalSourceQuantity },
      });
      mergeDetails.totalQuantityMerged = totalSourceQuantity;

      // 4. Merge price history - move all monetary value (price) records to target
      for (const sourceItem of sourceItems) {
        if (sourceItem.prices.length > 0) {
          await tx.monetaryValue.updateMany({
            where: { itemId: sourceItem.id },
            data: { itemId: data.targetItemId },
          });
          mergeDetails.mergedRelations.prices += sourceItem.prices.length;
        }
      }

      // 5. Merge measures. An item's identity is the full (measureType, value,
      // unit) tuple, NOT just the type — two items that share a measureType but
      // differ in value (e.g. DIAMETER 2,5mm vs 4,6mm) are genuinely different.
      // We only skip a source measure that is an exact duplicate; a same-type
      // but different-value measure is a CONFLICT: the target's value is kept
      // (the survivor keeps its identity) and the dropped value is recorded so
      // the loss is visible in the changelog instead of silently vanishing.
      const targetMeasures = await tx.measure.findMany({
        where: { itemId: data.targetItemId },
      });
      const droppedMeasures: Array<{
        itemId: string;
        itemName: string;
        measureType: string;
        value: number | null;
        unit: string | null;
        keptValue: number | null;
        keptUnit: string | null;
      }> = [];
      for (const sourceItem of sourceItems) {
        for (const measure of sourceItem.measures) {
          const sameType = targetMeasures.find(m => m.measureType === measure.measureType);
          const exactDuplicate =
            sameType && sameType.value === measure.value && sameType.unit === measure.unit;
          if (exactDuplicate) {
            continue; // identical measure already on target — nothing to do
          }
          if (sameType) {
            // Same type, different value/unit: keep target's, record the drop.
            droppedMeasures.push({
              itemId: sourceItem.id,
              itemName: sourceItem.name,
              measureType: measure.measureType,
              value: measure.value,
              unit: measure.unit,
              keptValue: sameType.value,
              keptUnit: sameType.unit,
            });
            mergeDetails.mergedRelations.measuresDropped++;
          } else {
            // Target has no measure of this type — adopt the source's.
            const created = await tx.measure.create({
              data: {
                itemId: data.targetItemId,
                value: measure.value,
                unit: measure.unit,
                measureType: measure.measureType,
              },
            });
            targetMeasures.push(created);
            mergeDetails.mergedRelations.measures++;
          }
        }
        // Remaining source measures are deleted with the source item (cascade),
        // but delete explicitly to be safe.
        await tx.measure.deleteMany({ where: { itemId: sourceItem.id } });
      }
      if (droppedMeasures.length > 0) {
        mergeDetails.conflicts = {
          ...(mergeDetails.conflicts && !Array.isArray(mergeDetails.conflicts)
            ? mergeDetails.conflicts
            : {}),
          measures: droppedMeasures,
        };
      }

      // 6. Merge barcodes (combine unique barcodes)
      const allBarcodes = new Set([
        ...targetItem.barcodes,
        ...sourceItems.flatMap(i => i.barcodes),
      ]);

      if (allBarcodes.size > targetItem.barcodes.length) {
        await tx.item.update({
          where: { id: data.targetItemId },
          data: { barcodes: Array.from(allBarcodes) },
        });
        mergeDetails.mergedRelations.barcodes = allBarcodes.size - targetItem.barcodes.length;
      }

      // 7. Merge activity records
      for (const sourceItem of sourceItems) {
        if (sourceItem.activities.length > 0) {
          await tx.activity.updateMany({
            where: { itemId: sourceItem.id },
            data: { itemId: data.targetItemId },
          });
          mergeDetails.mergedRelations.activities += sourceItem.activities.length;
        }
      }

      // 8. Merge borrow records
      for (const sourceItem of sourceItems) {
        if (sourceItem.borrows.length > 0) {
          await tx.borrow.updateMany({
            where: { itemId: sourceItem.id },
            data: { itemId: data.targetItemId },
          });
          mergeDetails.mergedRelations.borrows += sourceItem.borrows.length;
        }
      }

      // 9. Update order items references
      for (const sourceItem of sourceItems) {
        if (sourceItem.orderItems.length > 0) {
          await tx.orderItem.updateMany({
            where: { itemId: sourceItem.id },
            data: { itemId: data.targetItemId },
          });
          mergeDetails.mergedRelations.orderItems += sourceItem.orderItems.length;
        }
      }

      // 10. Update maintenance items references (items needed BY a maintenance)
      {
        const moved = await tx.maintenanceItem.updateMany({
          where: { itemId: { in: data.sourceItemIds } },
          data: { itemId: data.targetItemId },
        });
        mergeDetails.mergedRelations.maintenanceItemsNeeded += moved.count;
      }

      // 11. Update formula components references
      {
        const moved = await tx.paintFormulaComponent.updateMany({
          where: { itemId: { in: data.sourceItemIds } },
          data: { itemId: data.targetItemId },
        });
        mergeDetails.mergedRelations.formulaComponents += moved.count;
      }

      // 12. Update external operation items references
      {
        const moved = await tx.externalOperationItem.updateMany({
          where: { itemId: { in: data.sourceItemIds } },
          data: { itemId: data.targetItemId },
        });
        mergeDetails.mergedRelations.externalOperationItems += moved.count;
      }

      // 12a. Move PPE delivery history (EPI deliveries to employees). These are
      // cascade-deleted with the source item, so they MUST be reassigned first.
      {
        const moved = await tx.ppeDelivery.updateMany({
          where: { itemId: { in: data.sourceItemIds } },
          data: { itemId: data.targetItemId },
        });
        mergeDetails.mergedRelations.ppeDeliveries += moved.count;
      }

      // 12b. Move maintenance records (the item being maintained).
      {
        const moved = await tx.maintenance.updateMany({
          where: { itemId: { in: data.sourceItemIds } },
          data: { itemId: data.targetItemId },
        });
        mergeDetails.mergedRelations.maintenance += moved.count;
      }

      // 12c. Move maintenance schedules referencing the item.
      {
        const moved = await tx.maintenanceSchedule.updateMany({
          where: { itemId: { in: data.sourceItemIds } },
          data: { itemId: data.targetItemId },
        });
        mergeDetails.mergedRelations.maintenanceSchedules += moved.count;
      }

      // 12d. Move automatic order rules.
      {
        const moved = await tx.orderRule.updateMany({
          where: { itemId: { in: data.sourceItemIds } },
          data: { itemId: data.targetItemId },
        });
        mergeDetails.mergedRelations.orderRules += moved.count;
      }

      // 12e. Move PPE delivery schedule line items. The table has a unique
      // (scheduleId, ppeType, itemId) constraint, so reassign only when the
      // target does not already occupy that slot; otherwise drop the duplicate.
      {
        const scheduleItems = await tx.ppeScheduleItem.findMany({
          where: { itemId: { in: data.sourceItemIds } },
        });
        for (const si of scheduleItems) {
          const existing = await tx.ppeScheduleItem.findFirst({
            where: {
              scheduleId: si.scheduleId,
              ppeType: si.ppeType,
              itemId: data.targetItemId,
            },
          });
          if (existing) {
            await tx.ppeScheduleItem.delete({ where: { id: si.id } });
          } else {
            await tx.ppeScheduleItem.update({
              where: { id: si.id },
              data: { itemId: data.targetItemId },
            });
            mergeDetails.mergedRelations.ppeScheduleItems++;
          }
        }
      }

      // 12f. Move the FISPQ (safety data sheet). itemId is unique (1:1), so it
      // can only move if the target has none; if both have one the target's is
      // kept and the source's is cascade-deleted with its item.
      {
        const targetFispq = await tx.fispq.findUnique({
          where: { itemId: data.targetItemId },
        });
        if (!targetFispq) {
          const sourceFispq = await tx.fispq.findFirst({
            where: { itemId: { in: data.sourceItemIds } },
          });
          if (sourceFispq) {
            await tx.fispq.update({
              where: { id: sourceFispq.id },
              data: { itemId: data.targetItemId },
            });
            mergeDetails.mergedRelations.fispq = 1;
          }
        }
      }

      // 12g. Union many-to-many memberships onto the target before the source
      // items are deleted (deleting an item drops its join rows). Covers stock
      // brands, paint-brand/paint-type component links, and "required PPE" FISPQ
      // links. Connect is idempotent, so existing links are unaffected.
      {
        const collectIds = (key: 'brands' | 'paintBrands' | 'paintTypes' | 'requiredByFispqs') =>
          [...new Set(sourceItems.flatMap((s: any) => (s[key] ?? []).map((r: any) => r.id)))];

        // Brands are also resolvable via conflictResolutions.brands (which does a
        // `set` in step 14); only auto-union when no explicit resolution is given.
        if (!data.conflictResolutions?.brands) {
          const targetBrandIds = new Set(targetItem.brands.map((b: any) => b.id));
          const newBrandIds = collectIds('brands').filter(id => !targetBrandIds.has(id));
          if (newBrandIds.length > 0) {
            await tx.item.update({
              where: { id: data.targetItemId },
              data: { brands: { connect: newBrandIds.map(id => ({ id })) } },
            });
            mergeDetails.mergedRelations.brands += newBrandIds.length;
          }
        }

        const paintBrandIds = collectIds('paintBrands');
        if (paintBrandIds.length > 0) {
          await tx.item.update({
            where: { id: data.targetItemId },
            data: { paintBrands: { connect: paintBrandIds.map(id => ({ id })) } },
          });
          mergeDetails.mergedRelations.paintBrands += paintBrandIds.length;
        }

        const paintTypeIds = collectIds('paintTypes');
        if (paintTypeIds.length > 0) {
          await tx.item.update({
            where: { id: data.targetItemId },
            data: { paintTypes: { connect: paintTypeIds.map(id => ({ id })) } },
          });
          mergeDetails.mergedRelations.paintTypes += paintTypeIds.length;
        }

        const requiredByFispqIds = collectIds('requiredByFispqs');
        if (requiredByFispqIds.length > 0) {
          await tx.item.update({
            where: { id: data.targetItemId },
            data: { requiredByFispqs: { connect: requiredByFispqIds.map(id => ({ id })) } },
          });
          mergeDetails.mergedRelations.requiredByFispqs += requiredByFispqIds.length;
        }
      }

      // 13. Merge related items (self-referential relationship)
      for (const sourceItem of sourceItems) {
        // Get unique related item IDs that aren't already related to target
        const currentRelatedIds = targetItem.relatedItems.map(r => r.id);
        const newRelatedIds = sourceItem.relatedItems
          .map(r => r.id)
          .filter(id => !currentRelatedIds.includes(id) && id !== data.targetItemId);

        if (newRelatedIds.length > 0) {
          await tx.item.update({
            where: { id: data.targetItemId },
            data: {
              relatedItems: {
                connect: newRelatedIds.map(id => ({ id })),
              },
            },
          });
          mergeDetails.mergedRelations.relatedItems += newRelatedIds.length;
        }

        // Also update reverse relationships (where source is listed as related)
        const reverseRelatedIds = sourceItem.relatedTo.map(r => r.id);
        if (reverseRelatedIds.length > 0) {
          for (const relatedId of reverseRelatedIds) {
            await tx.item.update({
              where: { id: relatedId },
              data: {
                relatedItems: {
                  disconnect: { id: sourceItem.id },
                  connect: { id: data.targetItemId },
                },
              },
            });
          }
        }
      }

      // 14. Apply conflict resolutions if provided. Only an explicit allowlist of
      // user-owned scalar fields may be written here — derived fields (quantity,
      // totalPrice, monthlyConsumption, reorder thresholds, ABC/XYZ) are computed
      // below and must never be set from the payload, and writing an unknown key
      // would make Prisma throw and abort the whole merge.
      if (data.conflictResolutions && Object.keys(data.conflictResolutions).length > 0) {
        const ALLOWED_MERGE_FIELDS = new Set([
          'name',
          'uniCode',
          'categoryId',
          'supplierId',
          'boxQuantity',
          'estimatedLeadTime',
          'shouldAssignToUser',
          'isActive',
          'ppeType',
          'ppeCA',
          'ppeDeliveryMode',
          'ppeStandardQuantity',
          'icms',
          'ipi',
        ]);
        const updateData: any = {};
        for (const [field, value] of Object.entries(data.conflictResolutions)) {
          if (value === undefined) continue;
          if (field === 'brands') {
            // Many-to-many relation: translate the resolved brand list (objects
            // or ids) into a Prisma `set` so the chosen union is persisted.
            const brandIds = Array.isArray(value)
              ? value
                  .map((b: any) => (typeof b === 'string' ? b : b?.id))
                  .filter((id: unknown): id is string => typeof id === 'string')
              : [];
            updateData.brands = { set: brandIds.map((id) => ({ id })) };
          } else if (ALLOWED_MERGE_FIELDS.has(field)) {
            updateData[field] = value;
          }
          // Unknown / derived / forced fields are ignored on purpose.
        }

        if (Object.keys(updateData).length > 0) {
          await tx.item.update({
            where: { id: data.targetItemId },
            data: updateData,
          });
        }
      }

      // 14a. Merge consumption snapshots. ConsumptionSnapshot has a bare itemId
      // column with NO foreign key, so its rows are neither cascade-deleted with
      // the source nor auto-reassigned — they would orphan. Merge each source
      // month into the target (summing), respecting the (itemId, year, month)
      // unique constraint, then drop any leftovers.
      {
        const sourceSnapshots = await tx.consumptionSnapshot.findMany({
          where: { itemId: { in: data.sourceItemIds } },
        });
        for (const snap of sourceSnapshots) {
          const existing = await tx.consumptionSnapshot.findUnique({
            where: {
              itemId_year_month: {
                itemId: data.targetItemId,
                year: snap.year,
                month: snap.month,
              },
            },
          });
          if (existing) {
            await tx.consumptionSnapshot.update({
              where: { id: existing.id },
              data: {
                totalConsumption: existing.totalConsumption + snap.totalConsumption,
                consumptionCount: existing.consumptionCount + snap.consumptionCount,
                normalizedConsumption:
                  existing.normalizedConsumption + snap.normalizedConsumption,
              },
            });
            await tx.consumptionSnapshot.delete({ where: { id: snap.id } });
          } else {
            await tx.consumptionSnapshot.update({
              where: { id: snap.id },
              data: { itemId: data.targetItemId },
            });
          }
          mergeDetails.mergedRelations.consumptionSnapshots++;
        }
      }

      // 14b. Recompute the target's derived metrics now that quantity, prices,
      // activities, orders and snapshots have all moved to it. Step 3 updated
      // quantity with a raw write that bypassed the repository recompute, so
      // monthlyConsumption / reorderPoint / maxQuantity / reorderQuantity would
      // otherwise stay stale. recomputeItemMetrics is transaction-safe.
      await this.itemRecomputeService.recomputeItemMetrics(data.targetItemId, tx);

      // 14c. Recompute totalPrice (denormalized = latest price × final quantity),
      // which no recompute helper covers. Read the post-merge latest price and
      // quantity directly so it reflects the merged price history.
      {
        const latestPrice = await tx.monetaryValue.findFirst({
          where: { itemId: data.targetItemId },
          orderBy: { createdAt: 'desc' },
          select: { value: true },
        });
        const finalItem = await tx.item.findUnique({
          where: { id: data.targetItemId },
          select: { quantity: true },
        });
        await tx.item.update({
          where: { id: data.targetItemId },
          data: { totalPrice: (latestPrice?.value ?? 0) * (finalItem?.quantity ?? 0) },
        });
      }

      // 15. Delete source items
      await tx.item.deleteMany({
        where: { id: { in: data.sourceItemIds } },
      });

      // 16. Create changelog entry
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.ITEM,
        entityId: data.targetItemId,
        action: CHANGE_ACTION.UPDATE,
        entity: mergeDetails,
        reason:
          sourceItems.length === 1
            ? 'Mesclagem de 1 item'
            : `Mesclagem de ${sourceItems.length} itens`,
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.ITEM_UPDATE,
        transaction: tx,
      });

      // 17. Fetch the updated item with includes
      const updatedItem = await tx.item.findUnique({
        where: { id: data.targetItemId },
        include: include || {
          category: true,
          brands: true,
          supplier: true,
          measures: true,
          prices: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      return {
        success: true,
        message:
          sourceItems.length === 1
            ? '1 item mesclado com sucesso'
            : `${sourceItems.length} itens mesclados com sucesso`,
        data: updatedItem,
        targetItemId: data.targetItemId,
        mergedCount: sourceItems.length,
        details: mergeDetails,
      };
    });
  }

  /**
   * Detect conflicts between target item and source items
   */
  private detectItemConflicts(targetItem: any, sourceItems: any[]): Record<string, any> {
    const conflicts: Record<string, any> = {};

    const fieldsToCheck = [
      'name',
      'uniCode',
      'categoryId',
      'supplierId',
      'reorderPoint',
      'reorderQuantity',
      'maxQuantity',
      'shouldAssignToUser',
      'abcCategory',
      'xyzCategory',
      'isActive',
      'ppeType',
      'ppeCA',
      'ppeDeliveryMode',
    ];

    for (const field of fieldsToCheck) {
      const values = new Set(
        [targetItem[field], ...sourceItems.map(i => i[field])].filter(
          v => v !== null && v !== undefined,
        ),
      );

      if (values.size > 1) {
        conflicts[field] = {
          target: targetItem[field],
          sources: sourceItems.map((i, index) => ({
            itemId: i.id,
            itemName: i.name,
            value: i[field],
          })),
          resolution: 'kept_target',
        };
      }
    }

    return conflicts;
  }
}
