import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  ConflictException,
} from '@nestjs/common';
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
} from '../../../constants/enums';
import { PPE_SIZE_ORDER } from '../../../constants/sortOrders';
import {
  calculateBatchStockHealth,
  filterItemsByStockHealth,
  batchCalculateReorderPoints,
  type ReorderPointUpdateResult,
  determineStockLevel,
} from '../../../utils';
import { hasValueChanged } from '@modules/common/changelog/utils/serialize-changelog-value';
import { logEntityChange } from '@modules/common/changelog/utils/changelog-helpers';
import {
  convertToBatchOperationResult,
  generateBatchMessage,
} from '@modules/common/utils/batch-operation.utils';
@Injectable()
export class ItemService {
  private readonly logger = new Logger(ItemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly itemRepository: ItemRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

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

    // Check name uniqueness within same brand/category
    if (data.name || data.brandId !== undefined || data.categoryId !== undefined) {
      // Get current item data if updating
      let currentItem: { name: string; brandId: string | null; categoryId: string | null } | null =
        null;
      if (excludeId) {
        currentItem = await prismaClient.item.findUnique({
          where: { id: excludeId },
          select: { name: true, brandId: true, categoryId: true },
        });
      }

      const nameToCheck = data.name || currentItem?.name;
      // Handle explicit null values from the update data
      const brandIdToCheck = data.brandId !== undefined ? data.brandId : currentItem?.brandId;
      const categoryIdToCheck =
        data.categoryId !== undefined ? data.categoryId : currentItem?.categoryId;

      if (nameToCheck) {
        // Build where clause handling null values correctly
        const whereClause: any = {
          name: nameToCheck,
          ...(excludeId && { NOT: { id: excludeId } }),
        };

        // Handle brandId - use null explicitly if not provided
        if (brandIdToCheck) {
          whereClause.brandId = brandIdToCheck;
        } else {
          whereClause.brandId = null;
        }

        // Handle categoryId - use null explicitly if not provided
        if (categoryIdToCheck) {
          whereClause.categoryId = categoryIdToCheck;
        } else {
          whereClause.categoryId = null;
        }

        const existingItem = await prismaClient.item.findFirst({
          where: whereClause,
        });

        if (existingItem) {
          const brandInfo = brandIdToCheck ? ' para esta marca' : '';
          const categoryInfo = categoryIdToCheck ? ' e categoria' : '';
          errors.push(`Já existe um item com o nome "${nameToCheck}"${brandInfo}${categoryInfo}`);
        }
      }
    }

    // Validate itemBrandId exists
    if (data.brandId) {
      const brand = await prismaClient.itemBrand.findUnique({
        where: { id: data.brandId },
      });
      if (!brand) {
        errors.push('Marca não encontrada');
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
    if (data.ppeType !== undefined && data.ppeType !== null) {
      // Validate PPE type is valid enum value
      const validPpeTypes = Object.values(PPE_TYPE);
      if (!validPpeTypes.includes(data.ppeType as any)) {
        errors.push(`Tipo de PPE inválido. Valores válidos: ${validPpeTypes.join(', ')}`);
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

      // Validate PPE auto order months
      if (data.ppeAutoOrderMonths !== undefined && data.ppeAutoOrderMonths !== null) {
        if (
          !Number.isInteger(data.ppeAutoOrderMonths) ||
          data.ppeAutoOrderMonths < 0 ||
          data.ppeAutoOrderMonths > 12
        ) {
          errors.push(
            'Meses para pedido automático de PPE deve ser um número inteiro entre 0 e 12',
          );
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

      if (!hasPpeSize && !data.ppeSize) {
        errors.push('Tamanho é obrigatório para EPIs');
      }
      if (!data.ppeDeliveryMode) {
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
      if (data.ppeAutoOrderMonths !== undefined && data.ppeAutoOrderMonths !== null) {
        errors.push(
          'Não é possível definir meses para pedido automático sem definir o tipo de PPE',
        );
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
        unit: unit ?? null,
        measureType,
        itemId,
      },
    });
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
      const updatedItem = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar item existente
        const existingItem = await this.itemRepository.findByIdWithTransaction(tx, id);

        if (!existingItem) {
          throw new NotFoundException('Item não encontrado');
        }

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
            description: `Ajuste de inventário: quantidade ${quantityDifference > 0 ? 'aumentada' : 'reduzida'} em ${absoluteDifference} unidades`,
            notes: `Atualização manual do item. Quantidade anterior: ${existingItem.quantity}, Nova quantidade: ${itemData.quantity}`,
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
            triggeredBy: CHANGE_TRIGGERED_BY.INVENTORY_COUNT,
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
        // Delete prices first
        if (existing.prices && existing.prices.length > 0) {
          await tx.price.deleteMany({ where: { itemId: id } });
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
    // Remove stock level filters from query for database query
    const dbQuery = { ...query };
    delete (dbQuery as any).stockLevels;
    delete (dbQuery as any).criticalStock;
    delete (dbQuery as any).lowStock;
    delete (dbQuery as any).normalStock;
    delete (dbQuery as any).outOfStock;
    delete (dbQuery as any).overStock;
    delete (dbQuery as any).negativeStock;

    // Build a rough database filter to reduce the dataset
    // This will over-select items but dramatically reduce the in-memory processing
    const roughStockConditions = this.buildRoughStockConditions(stockHealthLevels);

    // Get active orders to check if items have active orders
    const activeOrderStatuses = [
      ORDER_STATUS.PARTIALLY_FULFILLED,
      ORDER_STATUS.FULFILLED,
      ORDER_STATUS.PARTIALLY_RECEIVED,
    ];

    // First pass: Get items with rough filtering
    const roughQuery = {
      ...dbQuery,
      where: {
        ...dbQuery.where,
        isActive: true,
        ...(roughStockConditions.length > 0 ? { OR: roughStockConditions } : {}),
      },
      // Fetch more items than needed to account for post-filtering
      // We'll fetch 3x the requested limit to ensure we have enough after filtering
      take: (query.limit || 20) * 3,
      skip: 0, // We'll handle pagination after filtering
    };

    const roughItems = await this.itemRepository.findMany(roughQuery);

    if (!roughItems.data || roughItems.data.length === 0) {
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

    // Get active orders for these items
    const itemIds = roughItems.data.map(item => item.id);
    const orderItems = await this.prisma.orderItem.findMany({
      where: {
        itemId: { in: itemIds },
        order: {
          status: { in: activeOrderStatuses },
        },
      },
      select: {
        itemId: true,
      },
    });

    // Create set of items with active orders
    const itemsWithActiveOrders = new Set<string>(orderItems.map(oi => oi.itemId));

    // Apply precise stock level filtering
    const preciselyFilteredItems = roughItems.data.filter(item => {
      const hasActiveOrder = itemsWithActiveOrders.has(item.id);
      const stockLevel = determineStockLevel(
        item.quantity,
        item.reorderPoint,
        item.maxQuantity,
        hasActiveOrder,
      );
      return stockHealthLevels.includes(stockLevel);
    });

    // If we don't have enough items after filtering, we need to fetch more
    const page = query.page || 1;
    const limit = query.limit || 20;
    const startIndex = (page - 1) * limit;

    let finalItems = preciselyFilteredItems;
    let totalFilteredCount = preciselyFilteredItems.length;

    // If we need more items (for pagination), fetch additional batches
    if (preciselyFilteredItems.length < startIndex + limit) {
      // We need to fetch more items to satisfy pagination
      let offset = roughItems.data.length;
      const batchSize = limit * 5; // Fetch in larger batches
      let attempts = 0;
      const maxAttempts = 5; // Prevent infinite loops

      while (finalItems.length < startIndex + limit && attempts < maxAttempts) {
        const additionalQuery = {
          ...roughQuery,
          skip: offset,
          take: batchSize,
        };

        const additionalItems = await this.itemRepository.findMany(additionalQuery);

        if (!additionalItems.data || additionalItems.data.length === 0) {
          break; // No more items to fetch
        }

        // Get active orders for additional items
        const additionalItemIds = additionalItems.data.map(item => item.id);
        const additionalOrderItems = await this.prisma.orderItem.findMany({
          where: {
            itemId: { in: additionalItemIds },
            order: {
              status: { in: activeOrderStatuses },
            },
          },
          select: {
            itemId: true,
          },
        });

        // Update the set of items with active orders
        additionalOrderItems.forEach(oi => itemsWithActiveOrders.add(oi.itemId));

        // Filter additional items
        const additionalFiltered = additionalItems.data.filter(item => {
          const hasActiveOrder = itemsWithActiveOrders.has(item.id);
          const stockLevel = determineStockLevel(
            item.quantity,
            item.reorderPoint,
            item.maxQuantity,
            hasActiveOrder,
          );
          return stockHealthLevels.includes(stockLevel);
        });

        finalItems = [...finalItems, ...additionalFiltered];
        offset += additionalItems.data.length;
        attempts++;
      }

      totalFilteredCount = finalItems.length;
    }

    // Apply pagination to the filtered results
    const paginatedItems = finalItems.slice(startIndex, startIndex + limit);
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
        AND: [
          { maxQuantity: { not: null } },
          { maxQuantity: { gt: 0 } },
        ],
      });
    }

    // Simplify conditions if needed
    if (includeAllPositive) {
      conditions.push({ quantity: { gt: 0 } });
    }

    if (includeAllWithReorderPoint) {
      conditions.push({
        AND: [
          { reorderPoint: { not: null } },
          { reorderPoint: { gt: 0 } },
        ],
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
          select: { reorderPoint: true, maxQuantity: true },
        });

        // Check if item has active orders
        const activeOrderStatuses = [
          ORDER_STATUS.PARTIALLY_FULFILLED,
          ORDER_STATUS.FULFILLED,
          ORDER_STATUS.PARTIALLY_RECEIVED,
        ];

        const hasActiveOrder =
          (await prismaClient.orderItem.findFirst({
            where: {
              itemId: currentItem.id,
              order: {
                status: { in: activeOrderStatuses },
              },
            },
          })) !== null;

        const stockLevel = determineStockLevel(
          newQuantity,
          fullItem?.reorderPoint || null,
          fullItem?.maxQuantity || null,
          hasActiveOrder,
        );

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
          brand: { select: { name: true } },
          category: { select: { name: true } },
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

      // Group order items by item ID
      const itemsWithActiveOrders = new Set<string>();
      for (const orderItem of orderItems) {
        itemsWithActiveOrders.add(orderItem.itemId);
      }

      // Filter items that are below minimum stock (LOW or CRITICAL)
      const itemsBelowMinimum = items.filter(item => {
        const hasActiveOrder = itemsWithActiveOrders.has(item.id);
        const stockLevel = determineStockLevel(
          item.quantity,
          item.reorderPoint,
          item.maxQuantity,
          hasActiveOrder,
        );

        return stockLevel === STOCK_LEVEL.CRITICAL || stockLevel === STOCK_LEVEL.LOW;
      });

      // Sort by stock level priority (CRITICAL first) then by quantity
      itemsBelowMinimum.sort((a, b) => {
        const hasActiveOrderA = itemsWithActiveOrders.has(a.id);
        const hasActiveOrderB = itemsWithActiveOrders.has(b.id);

        const levelA = determineStockLevel(
          a.quantity,
          a.reorderPoint,
          a.maxQuantity,
          hasActiveOrderA,
        );
        const levelB = determineStockLevel(
          b.quantity,
          b.reorderPoint,
          b.maxQuantity,
          hasActiveOrderB,
        );

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
        brandName: item.brand?.name || null,
        categoryName: item.category?.name || null,
        supplierName: item.supplier?.fantasyName || null,
        stockLevel: determineStockLevel(
          item.quantity,
          item.reorderPoint,
          item.maxQuantity,
          itemsWithActiveOrders.has(item.id),
        ),
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
        },
      });

      if (!item) {
        throw new NotFoundException('Item não encontrado');
      }

      // Check if item has active orders
      const activeOrderStatuses = [
        ORDER_STATUS.PARTIALLY_FULFILLED,
        ORDER_STATUS.FULFILLED,
        ORDER_STATUS.PARTIALLY_RECEIVED,
      ];

      const hasActiveOrder =
        (await this.prisma.orderItem.findFirst({
          where: {
            itemId: itemId,
            order: {
              status: { in: activeOrderStatuses },
            },
          },
        })) !== null;

      const stockLevel = determineStockLevel(
        item.quantity,
        item.reorderPoint,
        item.maxQuantity,
        hasActiveOrder,
      );

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

            // Excluir preços primeiro
            await tx.price.deleteMany({ where: { itemId } });

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
   * Calculate weighted average monthly consumption for an item based on recent activities
   * Uses exponential decay: weight = 0.5^((currentMonth - activityMonth) / 3)
   * This means the weight halves every 3 months
   */
  async calculateItemMonthlyConsumption(itemId: string, tx?: PrismaTransaction): Promise<number> {
    const prismaClient = tx || this.prisma;

    try {
      // Get activities from the last 12 months
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

      // Verify item exists
      const item = await prismaClient.item.findUnique({
        where: { id: itemId },
      });

      if (!item) {
        throw new NotFoundException('Item não encontrado');
      }

      // Get all OUTBOUND activities from the last 12 months
      const activities = await prismaClient.activity.findMany({
        where: {
          itemId,
          operation: ACTIVITY_OPERATION.OUTBOUND,
          createdAt: {
            gte: twelveMonthsAgo,
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (activities.length === 0) {
        return 0;
      }

      // Group activities by month
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth();

      const monthlyConsumption = new Map<string, number>();

      activities.forEach(activity => {
        const activityDate = new Date(activity.createdAt);
        const year = activityDate.getFullYear();
        const month = activityDate.getMonth();
        const monthKey = `${year}-${month}`;

        // Calculate quantity consumed for this activity
        const consumedQuantity = activity.quantity;

        // Accumulate by month
        const currentMonthConsumption = monthlyConsumption.get(monthKey) || 0;
        monthlyConsumption.set(monthKey, currentMonthConsumption + consumedQuantity);
      });

      // Calculate weighted average
      let weightedSum = 0;
      let totalWeight = 0;

      monthlyConsumption.forEach((consumption, monthKey) => {
        const [year, month] = monthKey.split('-').map(Number);

        // Calculate months difference
        const monthsDiff = (currentYear - year) * 12 + (currentMonth - month);

        // Calculate weight: 0.5^(monthsDiff / 3)
        const weight = Math.pow(0.5, monthsDiff / 3);

        weightedSum += consumption * weight;
        totalWeight += weight;
      });

      // Return weighted average monthly consumption
      return totalWeight > 0 ? weightedSum / totalWeight : 0;
    } catch (error) {
      this.logger.error(`Erro ao calcular consumo mensal do item ${itemId}:`, error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao calcular consumo mensal do item');
    }
  }

  /**
   * Update monthlyConsumption field for a specific item
   * Called after new OUTBOUND activities are created
   */
  async updateItemMonthlyConsumption(
    itemId: string,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const prismaClient = tx || this.prisma;

    try {
      // Calculate new monthly consumption value
      const newMonthlyConsumption = await this.calculateItemMonthlyConsumption(
        itemId,
        prismaClient,
      );

      // Get current item data
      const item = await prismaClient.item.findUnique({
        where: { id: itemId },
        select: {
          monthlyConsumption: true,
          monthlyConsumptionTrendPercent: true,
        },
      });

      if (!item) {
        throw new NotFoundException('Item não encontrado');
      }

      const oldMonthlyConsumption = parseFloat(item.monthlyConsumption.toString());

      // Calculate trend percentage change compared to previous value
      let trendPercent: number | null = null;
      if (oldMonthlyConsumption > 0) {
        trendPercent =
          Math.round(
            ((newMonthlyConsumption - oldMonthlyConsumption) / oldMonthlyConsumption) * 100 * 100,
          ) / 100; // Round to 2 decimal places
      }

      // Only update if the value changed significantly (more than 1%)
      const percentChange = Math.abs(
        (newMonthlyConsumption - oldMonthlyConsumption) / (oldMonthlyConsumption || 1),
      );
      if (percentChange > 0.01) {
        // Update the item with both consumption and trend
        await prismaClient.item.update({
          where: { id: itemId },
          data: {
            monthlyConsumption: newMonthlyConsumption,
            monthlyConsumptionTrendPercent: trendPercent,
          },
        });

        // Log the changes
        if (userId) {
          // Log monthly consumption change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.ITEM,
            entityId: itemId,
            action: CHANGE_ACTION.UPDATE,
            field: 'monthlyConsumption',
            oldValue: oldMonthlyConsumption,
            newValue: newMonthlyConsumption,
            reason: `Consumo médio mensal atualizado baseado em consumo ponderado dos últimos 12 meses`,
            triggeredBy: CHANGE_TRIGGERED_BY.ITEM_MONTHLY_CONSUMPTION_UPDATE,
            triggeredById: itemId,
            userId,
            transaction: prismaClient as PrismaTransaction,
          });

          // Log trend percentage change if it exists
          if (trendPercent !== null) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.ITEM,
              entityId: itemId,
              action: CHANGE_ACTION.UPDATE,
              field: 'monthlyConsumptionTrendPercent',
              oldValue: item.monthlyConsumptionTrendPercent
                ? parseFloat(item.monthlyConsumptionTrendPercent.toString())
                : null,
              newValue: trendPercent,
              reason: `Tendência de consumo calculada: ${trendPercent > 0 ? '+' : ''}${trendPercent.toFixed(2)}%`,
              triggeredBy: CHANGE_TRIGGERED_BY.ITEM_MONTHLY_CONSUMPTION_UPDATE,
              triggeredById: itemId,
              userId: userId || null,
              transaction: prismaClient as PrismaTransaction,
            });
          }
        }

        const trendText =
          trendPercent !== null
            ? ` (tendência: ${trendPercent > 0 ? '+' : ''}${trendPercent.toFixed(2)}%)`
            : '';
        this.logger.log(
          `Updated monthly consumption for item ${itemId}: ${oldMonthlyConsumption.toFixed(2)} -> ${newMonthlyConsumption.toFixed(2)}${trendText}`,
        );
      }
    } catch (error) {
      this.logger.error(`Erro ao atualizar consumo mensal do item ${itemId}:`, error);
      // Don't throw error to not affect the main operation
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
          reorderPoint: true,
          estimatedLeadTime: true,
          quantity: true,
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

      // Get activities for all items in the lookback period
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

      // Calculate reorder points for all items
      const reorderPointUpdates = batchCalculateReorderPoints(
        items as any,
        activitiesByItem,
        lookbackDays,
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
          reorderPoint: true,
          estimatedLeadTime: true,
          quantity: true,
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

      // Calculate reorder points for specified items
      const reorderPointAnalysis = batchCalculateReorderPoints(
        items as any,
        activitiesByItem,
        lookbackDays,
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
          monetaryValues: {
            orderBy: [
              { current: 'desc' as const },
              { createdAt: 'desc' as const }
            ],
            take: 1,
          },
          // Also include deprecated prices for backwards compatibility
          prices: {
            orderBy: { createdAt: 'desc' },
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
            // Get current price from monetaryValues or fallback to deprecated prices
            let currentPrice = 0;
            if (item.monetaryValues && item.monetaryValues.length > 0) {
              currentPrice = item.monetaryValues[0].value;
            } else if (item.prices && item.prices.length > 0) {
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
          brand: true,
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
          externalWithdrawalItems: true,
          brand: true,
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
          barcodes: 0,
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

      // 4. Merge price history - move all price records to target
      for (const sourceItem of sourceItems) {
        if (sourceItem.prices.length > 0) {
          await tx.price.updateMany({
            where: { itemId: sourceItem.id },
            data: { itemId: data.targetItemId },
          });
          mergeDetails.mergedRelations.prices += sourceItem.prices.length;
        }
      }

      // 5. Merge measures - avoid duplicates based on type
      for (const sourceItem of sourceItems) {
        if (sourceItem.measures.length > 0) {
          for (const measure of sourceItem.measures) {
            // Check if target already has a measure of this type
            const existingMeasure = await tx.measure.findFirst({
              where: {
                itemId: data.targetItemId,
                measureType: measure.measureType,
              },
            });

            if (!existingMeasure) {
              await tx.measure.create({
                data: {
                  itemId: data.targetItemId,
                  value: measure.value,
                  unit: measure.unit,
                  measureType: measure.measureType,
                },
              });
              mergeDetails.mergedRelations.measures++;
            }
          }
          // Delete old measures
          await tx.measure.deleteMany({
            where: { itemId: sourceItem.id },
          });
        }
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

      // 10. Update maintenance items references
      for (const sourceItem of sourceItems) {
        if (sourceItem.maintenanceItemsNeeded.length > 0) {
          await tx.maintenanceItem.updateMany({
            where: { itemId: sourceItem.id },
            data: { itemId: data.targetItemId },
          });
        }
      }

      // 11. Update formula components references
      for (const sourceItem of sourceItems) {
        if (sourceItem.formulaComponents.length > 0) {
          await tx.paintFormulaComponent.updateMany({
            where: { itemId: sourceItem.id },
            data: { itemId: data.targetItemId },
          });
        }
      }

      // 12. Update external withdrawal items references
      for (const sourceItem of sourceItems) {
        if (sourceItem.externalWithdrawalItems.length > 0) {
          await tx.externalWithdrawalItem.updateMany({
            where: { itemId: sourceItem.id },
            data: { itemId: data.targetItemId },
          });
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

      // 14. Apply conflict resolutions if provided
      if (data.conflictResolutions && Object.keys(data.conflictResolutions).length > 0) {
        const updateData: any = {};
        for (const [field, value] of Object.entries(data.conflictResolutions)) {
          if (value !== undefined) {
            updateData[field] = value;
          }
        }

        if (Object.keys(updateData).length > 0) {
          await tx.item.update({
            where: { id: data.targetItemId },
            data: updateData,
          });
        }
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
        reason: `Mesclagem de ${sourceItems.length} item(ns)`,
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.ITEM_UPDATE,
        transaction: tx,
      });

      // 17. Fetch the updated item with includes
      const updatedItem = await tx.item.findUnique({
        where: { id: data.targetItemId },
        include: include || {
          category: true,
          brand: true,
          supplier: true,
          measures: true,
          prices: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      return {
        success: true,
        message: `${sourceItems.length} item(ns) mesclado(s) com sucesso`,
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
      'brandId',
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
