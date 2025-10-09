import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { ItemService } from './item.service';
import { ItemBrandService } from './item-brand.service';
import { ItemCategoryService } from './item-category.service';
import {
  // Item schemas
  itemGetManySchema,
  itemGetByIdSchema,
  itemCreateSchema,
  itemUpdateSchema,
  itemBatchCreateSchema,
  itemBatchUpdateSchema,
  itemBatchDeleteSchema,
  itemQuerySchema,
  itemMergeSchema,

  // Item Brand schemas
  itemBrandGetManySchema,
  itemBrandGetByIdSchema,
  itemBrandCreateSchema,
  itemBrandUpdateSchema,
  itemBrandBatchCreateSchema,
  itemBrandBatchUpdateSchema,
  itemBrandBatchDeleteSchema,
  itemBrandQuerySchema,

  // Item Category schemas
  itemCategoryGetManySchema,
  itemCategoryGetByIdSchema,
  itemCategoryCreateSchema,
  itemCategoryUpdateSchema,
  itemCategoryBatchCreateSchema,
  itemCategoryBatchUpdateSchema,
  itemCategoryBatchDeleteSchema,
  itemCategoryQuerySchema,
} from '../../../schemas/item';
import type {
  // Item types
  ItemGetManyFormData,
  ItemGetByIdFormData,
  ItemCreateFormData,
  ItemUpdateFormData,
  ItemBatchCreateFormData,
  ItemBatchUpdateFormData,
  ItemBatchDeleteFormData,
  ItemQueryFormData,
  ItemMergeFormData,

  // Item Brand types
  ItemBrandGetManyFormData,
  ItemBrandGetByIdFormData,
  ItemBrandCreateFormData,
  ItemBrandUpdateFormData,
  ItemBrandBatchCreateFormData,
  ItemBrandBatchUpdateFormData,
  ItemBrandBatchDeleteFormData,
  ItemBrandQueryFormData,

  // Item Category types
  ItemCategoryGetManyFormData,
  ItemCategoryGetByIdFormData,
  ItemCategoryCreateFormData,
  ItemCategoryUpdateFormData,
  ItemCategoryBatchCreateFormData,
  ItemCategoryBatchUpdateFormData,
  ItemCategoryBatchDeleteFormData,
  ItemCategoryQueryFormData,
} from '../../../schemas/item';
import type {
  ItemGetManyResponse,
  ItemGetUniqueResponse,
  ItemCreateResponse,
  ItemUpdateResponse,
  ItemDeleteResponse,
  ItemBatchCreateResponse,
  ItemBatchUpdateResponse,
  ItemBatchDeleteResponse,
  ItemMergeResponse,
  ItemBrandGetManyResponse,
  ItemBrandGetUniqueResponse,
  ItemBrandCreateResponse,
  ItemBrandUpdateResponse,
  ItemBrandDeleteResponse,
  ItemBrandBatchCreateResponse,
  ItemBrandBatchUpdateResponse,
  ItemBrandBatchDeleteResponse,
  ItemCategoryGetManyResponse,
  ItemCategoryGetUniqueResponse,
  ItemCategoryCreateResponse,
  ItemCategoryUpdateResponse,
  ItemCategoryDeleteResponse,
  ItemCategoryBatchCreateResponse,
  ItemCategoryBatchUpdateResponse,
  ItemCategoryBatchDeleteResponse,
} from '../../../types';

@Controller('items')
export class ItemUnifiedController {
  constructor(
    private readonly itemService: ItemService,
    private readonly itemBrandService: ItemBrandService,
    private readonly itemCategoryService: ItemCategoryService,
  ) {}

  // =====================
  // ITEM OPERATIONS
  // =====================

  @Get()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getItems(
    @Query(new ZodQueryValidationPipe(itemGetManySchema)) query: ItemGetManyFormData,
  ): Promise<ItemGetManyResponse> {
    return this.itemService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createItem(
    @Body(new ZodValidationPipe(itemCreateSchema)) data: ItemCreateFormData,
    @Query(new ZodQueryValidationPipe(itemQuerySchema)) query: ItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemCreateResponse> {
    return this.itemService.create(data, query.include, userId);
  }

  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreateItems(
    @Body(new ZodValidationPipe(itemBatchCreateSchema)) data: ItemBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(itemQuerySchema)) query: ItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemBatchCreateResponse<ItemCreateFormData>> {
    return this.itemService.batchCreate(data.items, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdateItems(
    @Body(new ZodValidationPipe(itemBatchUpdateSchema)) data: ItemBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(itemQuerySchema)) query: ItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemBatchUpdateResponse<ItemUpdateFormData>> {
    // Ensure all items have required id and data fields
    const validatedItems = data.items.map(item => ({
      id: item.id!,
      data: item.data!,
    }));
    return this.itemService.batchUpdate(validatedItems, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchDeleteItems(
    @Body(new ZodValidationPipe(itemBatchDeleteSchema)) data: ItemBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<ItemBatchDeleteResponse> {
    return this.itemService.batchDelete(data, userId);
  }

  @Post('merge')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async mergeItems(
    @Body(new ZodValidationPipe(itemMergeSchema)) data: ItemMergeFormData,
    @Query(new ZodQueryValidationPipe(itemQuerySchema)) query: ItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemMergeResponse> {
    return this.itemService.merge(data as any, query.include, userId) as any;
  }

  // =====================
  // ITEM BRAND OPERATIONS
  // =====================

  @Get('brands')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getItemBrands(
    @Query(new ZodQueryValidationPipe(itemBrandGetManySchema)) query: ItemBrandGetManyFormData,
  ): Promise<ItemBrandGetManyResponse> {
    return this.itemBrandService.findMany(query);
  }

  @Get('brands/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getItemBrandById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(itemBrandQuerySchema)) query: ItemBrandQueryFormData,
  ): Promise<ItemBrandGetUniqueResponse> {
    return this.itemBrandService.findById(id, query.include);
  }

  @Post('brands')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createItemBrand(
    @Body(new ZodValidationPipe(itemBrandCreateSchema)) data: ItemBrandCreateFormData,
    @Query(new ZodQueryValidationPipe(itemBrandQuerySchema)) query: ItemBrandQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemBrandCreateResponse> {
    return this.itemBrandService.create(data, query.include, userId);
  }

  @Put('brands/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async updateItemBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(itemBrandUpdateSchema)) data: ItemBrandUpdateFormData,
    @Query(new ZodQueryValidationPipe(itemBrandQuerySchema)) query: ItemBrandQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemBrandUpdateResponse> {
    return this.itemBrandService.update(id, data, query.include, userId);
  }

  @Delete('brands/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deleteItemBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ItemBrandDeleteResponse> {
    return this.itemBrandService.delete(id, userId);
  }

  @Post('brands/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreateItemBrands(
    @Body(new ZodValidationPipe(itemBrandBatchCreateSchema)) data: ItemBrandBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(itemBrandQuerySchema)) query: ItemBrandQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemBrandBatchCreateResponse<ItemBrandCreateFormData>> {
    return this.itemBrandService.batchCreate(data, query.include, userId);
  }

  @Put('brands/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdateItemBrands(
    @Body(new ZodValidationPipe(itemBrandBatchUpdateSchema)) data: ItemBrandBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(itemBrandQuerySchema)) query: ItemBrandQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemBrandBatchUpdateResponse<ItemBrandUpdateFormData>> {
    return this.itemBrandService.batchUpdate(data, query.include, userId);
  }

  @Delete('brands/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchDeleteItemBrands(
    @Body(new ZodValidationPipe(itemBrandBatchDeleteSchema)) data: ItemBrandBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<ItemBrandBatchDeleteResponse> {
    return this.itemBrandService.batchDelete(data, userId);
  }

  // =====================
  // ITEM CATEGORY OPERATIONS
  // =====================

  @Get('categories')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getItemCategories(
    @Query(new ZodQueryValidationPipe(itemCategoryGetManySchema))
    query: ItemCategoryGetManyFormData,
  ): Promise<ItemCategoryGetManyResponse> {
    return this.itemCategoryService.findMany(query);
  }

  @Get('categories/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getItemCategoryById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(itemCategoryQuerySchema)) query: ItemCategoryQueryFormData,
  ): Promise<ItemCategoryGetUniqueResponse> {
    return this.itemCategoryService.findById(id, query.include);
  }

  @Post('categories')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createItemCategory(
    @Body(new ZodValidationPipe(itemCategoryCreateSchema)) data: ItemCategoryCreateFormData,
    @Query(new ZodQueryValidationPipe(itemCategoryQuerySchema)) query: ItemCategoryQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemCategoryCreateResponse> {
    return this.itemCategoryService.create(data, query.include, userId);
  }

  @Put('categories/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async updateItemCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(itemCategoryUpdateSchema)) data: ItemCategoryUpdateFormData,
    @Query(new ZodQueryValidationPipe(itemCategoryQuerySchema)) query: ItemCategoryQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemCategoryUpdateResponse> {
    return this.itemCategoryService.update(id, data, query.include, userId);
  }

  @Delete('categories/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deleteItemCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ItemCategoryDeleteResponse> {
    return this.itemCategoryService.delete(id, userId);
  }

  @Post('categories/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreateItemCategories(
    @Body(new ZodValidationPipe(itemCategoryBatchCreateSchema))
    data: ItemCategoryBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(itemCategoryQuerySchema)) query: ItemCategoryQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemCategoryBatchCreateResponse<ItemCategoryCreateFormData>> {
    return this.itemCategoryService.batchCreate(data, query.include, userId);
  }

  @Put('categories/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdateItemCategories(
    @Body(new ZodValidationPipe(itemCategoryBatchUpdateSchema))
    data: ItemCategoryBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(itemCategoryQuerySchema)) query: ItemCategoryQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemCategoryBatchUpdateResponse<ItemCategoryUpdateFormData>> {
    return this.itemCategoryService.batchUpdate(data, query.include, userId);
  }

  @Delete('categories/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchDeleteItemCategories(
    @Body(new ZodValidationPipe(itemCategoryBatchDeleteSchema))
    data: ItemCategoryBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<ItemCategoryBatchDeleteResponse> {
    return this.itemCategoryService.batchDelete(data, userId);
  }

  // =====================
  // DYNAMIC ITEM ROUTES (must come after all static routes)
  // =====================

  @Post('batch-adjust-prices')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async adjustItemPrices(
    @Body() data: { itemIds: string[]; percentage: number },
    @UserId() userId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      totalSuccess: number;
      totalFailed: number;
      results: any[];
    };
  }> {
    return this.itemService.adjustItemPrices(data.itemIds, data.percentage, userId);
  }

  @Post('reorder-points/update')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async updateReorderPoints(
    @UserId() userId: string,
    @Query('lookbackDays') lookbackDays?: number,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      totalAnalyzed: number;
      totalUpdated: number;
      updates: any[];
    };
  }> {
    return this.itemService.updateReorderPointsBasedOnConsumption(userId, lookbackDays);
  }

  @Post('reorder-points/analyze')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async analyzeReorderPoints(
    @Body() body: { itemIds: string[] },
    @Query('lookbackDays') lookbackDays?: number,
  ): Promise<{
    success: boolean;
    message: string;
    data: any[];
  }> {
    return this.itemService.analyzeReorderPoints(body.itemIds, lookbackDays);
  }

  @Post('recalculate-monthly-consumption')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async recalculateAllItemsMonthlyConsumption(
    @UserId() userId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: { success: number; failed: number; total: number };
  }> {
    const result = await this.itemService.updateAllItemsMonthlyConsumption(userId);
    return {
      success: true,
      message: `Recálculo concluído: ${result.success} itens atualizados, ${result.failed} falharam de ${result.total} total`,
      data: result,
    };
  }

  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getItemById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(itemQuerySchema)) query: ItemQueryFormData,
  ): Promise<ItemGetUniqueResponse> {
    return this.itemService.findById(id, query.include);
  }

  @Post(':id/recalculate-monthly-consumption')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async recalculateItemMonthlyConsumption(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.itemService.updateItemMonthlyConsumption(id, userId);
    return {
      success: true,
      message: `Consumo mensal do item recalculado com sucesso`,
    };
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(itemUpdateSchema)) data: ItemUpdateFormData,
    @Query(new ZodQueryValidationPipe(itemQuerySchema)) query: ItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ItemUpdateResponse> {
    return this.itemService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deleteItem(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ItemDeleteResponse> {
    return this.itemService.delete(id, userId);
  }
}
