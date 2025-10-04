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
  UsePipes,
} from '@nestjs/common';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../constants/enums';
import { PaintService } from './paint.service';
import { PaintTypeService } from './paint-type.service';
import { PaintGroundService } from './paint-ground.service';
import { PaintFormulaService } from './paint-formula.service';
import { PaintFormulaComponentService } from './paint-formula-component.service';
import { PaintProductionService } from './paint-production.service';
import { PaintBrandService } from './paint-brand.service';
import { PaintCompatibilityService } from './paint-compatibility.service';
import {
  // Paint schemas
  paintGetManySchema,
  paintGetByIdSchema,
  paintCreateSchema,
  paintUpdateSchema,
  paintBatchCreateSchema,
  paintBatchUpdateSchema,
  paintBatchDeleteSchema,
  paintQuerySchema,
  paintMergeSchema,

  // Paint Type schemas
  paintTypeGetManySchema,
  paintTypeGetByIdSchema,
  paintTypeCreateSchema,
  paintTypeUpdateSchema,
  paintTypeBatchCreateSchema,
  paintTypeBatchUpdateSchema,
  paintTypeBatchDeleteSchema,
  paintTypeQuerySchema,

  // Paint Ground schemas
  paintGroundGetManySchema,
  paintGroundGetByIdSchema,
  paintGroundCreateSchema,
  paintGroundUpdateSchema,
  paintGroundBatchCreateSchema,
  paintGroundBatchUpdateSchema,
  paintGroundBatchDeleteSchema,
  paintGroundQuerySchema,

  // Paint Formula schemas
  paintFormulaGetManySchema,
  paintFormulaGetByIdSchema,
  paintFormulaCreateSchema,
  paintFormulaUpdateSchema,
  paintFormulaBatchCreateSchema,
  paintFormulaBatchUpdateSchema,
  paintFormulaBatchDeleteSchema,
  paintFormulaQuerySchema,

  // Paint Formula Component schemas
  paintFormulaComponentGetManySchema,
  paintFormulaComponentGetByIdSchema,
  paintFormulaComponentCreateSchema,
  paintFormulaComponentUpdateSchema,
  paintFormulaComponentBatchCreateSchema,
  paintFormulaComponentBatchUpdateSchema,
  paintFormulaComponentBatchDeleteSchema,
  paintFormulaComponentQuerySchema,

  // Paint Production schemas
  paintProductionGetManySchema,
  paintProductionGetByIdSchema,
  paintProductionCreateSchema,
  paintProductionUpdateSchema,
  paintProductionBatchCreateSchema,
  paintProductionBatchUpdateSchema,
  paintProductionBatchDeleteSchema,
  paintProductionQuerySchema,
} from '../../schemas/paint';
import type {
  // Paint types
  PaintGetManyFormData,
  PaintGetByIdFormData,
  PaintCreateFormData,
  PaintUpdateFormData,
  PaintBatchCreateFormData,
  PaintBatchUpdateFormData,
  PaintBatchDeleteFormData,
  PaintQueryFormData,
  PaintMergeFormData,

  // Paint Type types
  PaintTypeGetManyFormData,
  PaintTypeGetByIdFormData,
  PaintTypeCreateFormData,
  PaintTypeUpdateFormData,
  PaintTypeBatchCreateFormData,
  PaintTypeBatchUpdateFormData,
  PaintTypeBatchDeleteFormData,
  PaintTypeQueryFormData,

  // Paint Ground types
  PaintGroundGetManyFormData,
  PaintGroundGetByIdFormData,
  PaintGroundCreateFormData,
  PaintGroundUpdateFormData,
  PaintGroundBatchCreateFormData,
  PaintGroundBatchUpdateFormData,
  PaintGroundBatchDeleteFormData,
  PaintGroundQueryFormData,

  // Paint Formula types
  PaintFormulaGetManyFormData,
  PaintFormulaGetByIdFormData,
  PaintFormulaCreateFormData,
  PaintFormulaUpdateFormData,
  PaintFormulaBatchCreateFormData,
  PaintFormulaBatchUpdateFormData,
  PaintFormulaBatchDeleteFormData,
  PaintFormulaQueryFormData,

  // Paint Formula Component types
  PaintFormulaComponentGetManyFormData,
  PaintFormulaComponentGetByIdFormData,
  PaintFormulaComponentCreateFormData,
  PaintFormulaComponentUpdateFormData,
  PaintFormulaComponentBatchCreateFormData,
  PaintFormulaComponentBatchUpdateFormData,
  PaintFormulaComponentBatchDeleteFormData,
  PaintFormulaComponentQueryFormData,

  // Paint Production types
  PaintProductionGetManyFormData,
  PaintProductionGetByIdFormData,
  PaintProductionCreateFormData,
  PaintProductionUpdateFormData,
  PaintProductionBatchCreateFormData,
  PaintProductionBatchUpdateFormData,
  PaintProductionBatchDeleteFormData,
  PaintProductionQueryFormData,
} from '../../schemas/paint';
import type {
  PaintGetManyResponse,
  PaintGetUniqueResponse,
  PaintCreateResponse,
  PaintUpdateResponse,
  PaintDeleteResponse,
  PaintBatchCreateResponse,
  PaintBatchUpdateResponse,
  PaintBatchDeleteResponse,
  PaintMergeResponse,
  PaintTypeGetManyResponse,
  PaintTypeGetUniqueResponse,
  PaintTypeCreateResponse,
  PaintTypeUpdateResponse,
  PaintTypeDeleteResponse,
  PaintTypeBatchCreateResponse,
  PaintTypeBatchUpdateResponse,
  PaintTypeBatchDeleteResponse,
  PaintGroundGetManyResponse,
  PaintGroundGetUniqueResponse,
  PaintGroundCreateResponse,
  PaintGroundUpdateResponse,
  PaintGroundDeleteResponse,
  PaintGroundBatchCreateResponse,
  PaintGroundBatchUpdateResponse,
  PaintGroundBatchDeleteResponse,
  PaintFormulaGetManyResponse,
  PaintFormulaGetUniqueResponse,
  PaintFormulaCreateResponse,
  PaintFormulaUpdateResponse,
  PaintFormulaDeleteResponse,
  PaintFormulaBatchCreateResponse,
  PaintFormulaBatchUpdateResponse,
  PaintFormulaBatchDeleteResponse,
  PaintFormulaComponentGetManyResponse,
  PaintFormulaComponentGetUniqueResponse,
  PaintFormulaComponentCreateResponse,
  PaintFormulaComponentUpdateResponse,
  PaintFormulaComponentDeleteResponse,
  PaintFormulaComponentBatchCreateResponse,
  PaintFormulaComponentBatchUpdateResponse,
  PaintFormulaComponentBatchDeleteResponse,
  PaintProductionGetManyResponse,
  PaintProductionGetUniqueResponse,
  PaintProductionCreateResponse,
  PaintProductionUpdateResponse,
  PaintProductionDeleteResponse,
  PaintProductionBatchCreateResponse,
  PaintProductionBatchUpdateResponse,
  PaintProductionBatchDeleteResponse,
} from '../../types';

@Controller('paints')
export class PaintUnifiedController {
  constructor(
    private readonly paintService: PaintService,
    private readonly paintTypeService: PaintTypeService,
    private readonly paintGroundService: PaintGroundService,
    private readonly paintFormulaService: PaintFormulaService,
    private readonly paintFormulaComponentService: PaintFormulaComponentService,
    private readonly paintProductionService: PaintProductionService,
    private readonly paintBrandService: PaintBrandService,
    private readonly paintCompatibilityService: PaintCompatibilityService,
  ) {}

  // =====================
  // PAINT OPERATIONS
  // =====================

  @Get()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintGetManySchema))
  async getPaints(@Query() query: PaintGetManyFormData): Promise<PaintGetManyResponse> {
    return this.paintService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createPaint(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(paintCreateSchema)) data: PaintCreateFormData,
    @Query(new ZodQueryValidationPipe(paintQuerySchema)) query: PaintQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintCreateResponse> {
    return this.paintService.create(data, query.include, userId);
  }

  // Batch operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreatePaints(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(paintBatchCreateSchema))
    data: PaintBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(paintQuerySchema)) query: PaintQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintBatchCreateResponse<PaintCreateFormData>> {
    return this.paintService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdatePaints(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(paintBatchUpdateSchema))
    data: PaintBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintQuerySchema)) query: PaintQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintBatchUpdateResponse<PaintUpdateFormData>> {
    return this.paintService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintBatchDeleteSchema))
  async batchDeletePaints(
    @Body() data: PaintBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<PaintBatchDeleteResponse> {
    return this.paintService.batchDelete(data, userId);
  }

  @Post('merge')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async mergePaints(
    @Body(new ZodValidationPipe(paintMergeSchema)) data: PaintMergeFormData,
    @Query(new ZodQueryValidationPipe(paintQuerySchema)) query: PaintQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintMergeResponse> {
    return this.paintService.merge(data as any, query.include, userId) as any;
  }

  // Dynamic routes (must come after static routes)
  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async updatePaint(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(paintUpdateSchema)) data: PaintUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintQuerySchema)) query: PaintQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintUpdateResponse> {
    return this.paintService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deletePaint(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PaintDeleteResponse> {
    return this.paintService.delete(id, userId);
  }

  // =====================
  // PAINT TYPE OPERATIONS
  // =====================

  @Get('types')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintTypeGetManySchema))
  async getPaintTypes(@Query() query: PaintTypeGetManyFormData): Promise<PaintTypeGetManyResponse> {
    return this.paintTypeService.findMany(query);
  }

  @Post('types')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createPaintType(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(paintTypeCreateSchema))
    data: PaintTypeCreateFormData,
    @Query(new ZodQueryValidationPipe(paintTypeQuerySchema)) query: PaintTypeQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintTypeCreateResponse> {
    return this.paintTypeService.create(data, query.include, userId);
  }

  @Post('types/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(paintTypeBatchCreateSchema))
  async batchCreatePaintTypes(
    @Body() data: PaintTypeBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(paintTypeQuerySchema)) query: PaintTypeQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintTypeBatchCreateResponse<PaintTypeCreateFormData>> {
    return this.paintTypeService.batchCreate(data, query.include, userId);
  }

  @Put('types/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintTypeBatchUpdateSchema))
  async batchUpdatePaintTypes(
    @Body() data: PaintTypeBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintTypeQuerySchema)) query: PaintTypeQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintTypeBatchUpdateResponse<PaintTypeUpdateFormData>> {
    return this.paintTypeService.batchUpdate(data, query.include, userId);
  }

  @Delete('types/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintTypeBatchDeleteSchema))
  async batchDeletePaintTypes(
    @Body() data: PaintTypeBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<PaintTypeBatchDeleteResponse> {
    return this.paintTypeService.batchDelete(data, userId);
  }

  @Get('types/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintTypeGetByIdSchema))
  async getPaintTypeById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaintTypeGetByIdFormData,
  ): Promise<PaintTypeGetUniqueResponse> {
    return this.paintTypeService.findById(id, query.include);
  }

  @Put('types/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async updatePaintType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(paintTypeUpdateSchema))
    data: PaintTypeUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintTypeQuerySchema)) query: PaintTypeQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintTypeUpdateResponse> {
    return this.paintTypeService.update(id, data, query.include, userId);
  }

  @Delete('types/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deletePaintType(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PaintTypeDeleteResponse> {
    return this.paintTypeService.delete(id, userId);
  }

  // =====================
  // PAINT GROUND OPERATIONS
  // =====================

  @Get('grounds')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintGroundGetManySchema))
  async getPaintGrounds(
    @Query() query: PaintGroundGetManyFormData,
  ): Promise<PaintGroundGetManyResponse> {
    return this.paintGroundService.findMany(query);
  }

  @Post('grounds')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(paintGroundCreateSchema))
  async createPaintGround(
    @Body() data: PaintGroundCreateFormData,
    @Query(new ZodQueryValidationPipe(paintGroundQuerySchema)) query: PaintGroundQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintGroundCreateResponse> {
    return this.paintGroundService.create(data, query.include, userId);
  }

  @Post('grounds/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(paintGroundBatchCreateSchema))
  async batchCreatePaintGrounds(
    @Body() data: PaintGroundBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(paintGroundQuerySchema)) query: PaintGroundQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintGroundBatchCreateResponse<PaintGroundCreateFormData>> {
    return this.paintGroundService.batchCreate(data, query.include, userId);
  }

  @Put('grounds/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintGroundBatchUpdateSchema))
  async batchUpdatePaintGrounds(
    @Body() data: PaintGroundBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintGroundQuerySchema)) query: PaintGroundQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintGroundBatchUpdateResponse<PaintGroundUpdateFormData>> {
    return this.paintGroundService.batchUpdate(data, query.include, userId);
  }

  @Delete('grounds/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintGroundBatchDeleteSchema))
  async batchDeletePaintGrounds(
    @Body() data: PaintGroundBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<PaintGroundBatchDeleteResponse> {
    return this.paintGroundService.batchDelete(data, userId);
  }

  @Get('grounds/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintGroundGetByIdSchema))
  async getPaintGroundById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaintGroundGetByIdFormData,
  ): Promise<PaintGroundGetUniqueResponse> {
    return this.paintGroundService.findById(id, query.include);
  }

  @Put('grounds/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintGroundUpdateSchema))
  async updatePaintGround(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: PaintGroundUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintGroundQuerySchema)) query: PaintGroundQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintGroundUpdateResponse> {
    return this.paintGroundService.update(id, data, query.include, userId);
  }

  @Delete('grounds/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deletePaintGround(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PaintGroundDeleteResponse> {
    return this.paintGroundService.delete(id, userId);
  }

  // =====================
  // PAINT FORMULA OPERATIONS
  // =====================

  @Get('formulas')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintFormulaGetManySchema))
  async getPaintFormulas(
    @Query() query: PaintFormulaGetManyFormData,
  ): Promise<PaintFormulaGetManyResponse> {
    return this.paintFormulaService.findMany(query);
  }

  @Post('formulas')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createPaintFormula(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(paintFormulaCreateSchema))
    data: PaintFormulaCreateFormData,
    @Query(new ZodQueryValidationPipe(paintFormulaQuerySchema)) query: PaintFormulaQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintFormulaCreateResponse> {
    return this.paintFormulaService.create(data, query.include, userId);
  }

  @Post('formulas/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(paintFormulaBatchCreateSchema))
  async batchCreatePaintFormulas(
    @Body() data: PaintFormulaBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(paintFormulaQuerySchema)) query: PaintFormulaQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintFormulaBatchCreateResponse<PaintFormulaCreateFormData>> {
    return this.paintFormulaService.batchCreate(data, query.include, userId);
  }

  @Put('formulas/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintFormulaBatchUpdateSchema))
  async batchUpdatePaintFormulas(
    @Body() data: PaintFormulaBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintFormulaQuerySchema)) query: PaintFormulaQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintFormulaBatchUpdateResponse<PaintFormulaUpdateFormData>> {
    return this.paintFormulaService.batchUpdate(data, query.include, userId);
  }

  @Delete('formulas/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintFormulaBatchDeleteSchema))
  async batchDeletePaintFormulas(
    @Body() data: PaintFormulaBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<PaintFormulaBatchDeleteResponse> {
    return this.paintFormulaService.batchDelete(data, userId);
  }

  @Get('formulas/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintFormulaGetByIdSchema))
  async getPaintFormulaById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaintFormulaGetByIdFormData,
  ): Promise<PaintFormulaGetUniqueResponse> {
    return this.paintFormulaService.findById(id, query.include);
  }

  @Put('formulas/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintFormulaUpdateSchema))
  async updatePaintFormula(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: PaintFormulaUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintFormulaQuerySchema)) query: PaintFormulaQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintFormulaUpdateResponse> {
    return this.paintFormulaService.update(id, data, query.include, userId);
  }

  @Delete('formulas/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deletePaintFormula(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PaintFormulaDeleteResponse> {
    return this.paintFormulaService.delete(id, userId);
  }

  // =====================
  // PAINT FORMULA COMPONENT OPERATIONS
  // =====================

  @Get('formula-components')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintFormulaComponentGetManySchema))
  async getPaintFormulaComponents(
    @Query() query: PaintFormulaComponentGetManyFormData,
  ): Promise<PaintFormulaComponentGetManyResponse> {
    return this.paintFormulaComponentService.findMany(query);
  }

  @Post('formula-components')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(paintFormulaComponentCreateSchema))
  async createPaintFormulaComponent(
    @Body() data: PaintFormulaComponentCreateFormData,
    @Query(new ZodQueryValidationPipe(paintFormulaComponentQuerySchema))
    query: PaintFormulaComponentQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintFormulaComponentCreateResponse> {
    return this.paintFormulaComponentService.create(data, query.include, userId);
  }

  @Post('formula-components/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(paintFormulaComponentBatchCreateSchema))
  async batchCreatePaintFormulaComponents(
    @Body() data: PaintFormulaComponentBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(paintFormulaComponentQuerySchema))
    query: PaintFormulaComponentQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintFormulaComponentBatchCreateResponse<PaintFormulaComponentCreateFormData>> {
    return this.paintFormulaComponentService.batchCreate(data, query.include, userId);
  }

  @Put('formula-components/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintFormulaComponentBatchUpdateSchema))
  async batchUpdatePaintFormulaComponents(
    @Body() data: PaintFormulaComponentBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintFormulaComponentQuerySchema))
    query: PaintFormulaComponentQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintFormulaComponentBatchUpdateResponse<PaintFormulaComponentUpdateFormData>> {
    return this.paintFormulaComponentService.batchUpdate(data, query.include, userId);
  }

  @Delete('formula-components/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintFormulaComponentBatchDeleteSchema))
  async batchDeletePaintFormulaComponents(
    @Body() data: PaintFormulaComponentBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<PaintFormulaComponentBatchDeleteResponse> {
    return this.paintFormulaComponentService.batchDelete(data, userId);
  }

  @Get('formula-components/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintFormulaComponentGetByIdSchema))
  async getPaintFormulaComponentById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaintFormulaComponentGetByIdFormData,
  ): Promise<PaintFormulaComponentGetUniqueResponse> {
    return this.paintFormulaComponentService.findById(id, query.include);
  }

  @Put('formula-components/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintFormulaComponentUpdateSchema))
  async updatePaintFormulaComponent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: PaintFormulaComponentUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintFormulaComponentQuerySchema))
    query: PaintFormulaComponentQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintFormulaComponentUpdateResponse> {
    return this.paintFormulaComponentService.update(id, data, query.include, userId);
  }

  @Delete('formula-components/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deletePaintFormulaComponent(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PaintFormulaComponentDeleteResponse> {
    return this.paintFormulaComponentService.delete(id, userId);
  }

  // =====================
  // PAINT PRODUCTION OPERATIONS
  // =====================

  @Get('productions')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintProductionGetManySchema))
  async getPaintProductions(
    @Query() query: PaintProductionGetManyFormData,
  ): Promise<PaintProductionGetManyResponse> {
    return this.paintProductionService.findMany(query);
  }

  @Get('productions/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintProductionGetByIdSchema))
  async getPaintProductionById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaintProductionGetByIdFormData,
  ): Promise<PaintProductionGetUniqueResponse> {
    return this.paintProductionService.findById(id, query.include);
  }

  @Post('productions')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createPaintProduction(
    @Body(new ZodValidationPipe(paintProductionCreateSchema)) data: PaintProductionCreateFormData,
    @Query(new ZodQueryValidationPipe(paintProductionQuerySchema))
    query: PaintProductionQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintProductionCreateResponse> {
    return this.paintProductionService.create(data, query.include, userId);
  }

  @Put('productions/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async updatePaintProduction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(paintProductionUpdateSchema)) data: PaintProductionUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintProductionQuerySchema))
    query: PaintProductionQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintProductionUpdateResponse> {
    return this.paintProductionService.update(id, data, query.include, userId);
  }

  @Delete('productions/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deletePaintProduction(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<PaintProductionDeleteResponse> {
    return this.paintProductionService.delete(id, userId);
  }

  @Post('productions/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreatePaintProductions(
    @Body(new ZodValidationPipe(paintProductionBatchCreateSchema))
    data: PaintProductionBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(paintProductionQuerySchema))
    query: PaintProductionQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintProductionBatchCreateResponse<PaintProductionCreateFormData>> {
    return this.paintProductionService.batchCreate(data, query.include, userId);
  }

  @Put('productions/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdatePaintProductions(
    @Body(new ZodValidationPipe(paintProductionBatchUpdateSchema))
    data: PaintProductionBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintProductionQuerySchema))
    query: PaintProductionQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintProductionBatchUpdateResponse<PaintProductionUpdateFormData>> {
    return this.paintProductionService.batchUpdate(data, query.include, userId);
  }

  @Delete('productions/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchDeletePaintProductions(
    @Body(new ZodValidationPipe(paintProductionBatchDeleteSchema))
    data: PaintProductionBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<PaintProductionBatchDeleteResponse> {
    return this.paintProductionService.batchDelete(data, userId);
  }

  // =====================
  // PAINT BRAND OPERATIONS
  // =====================

  @Get('brands')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getPaintBrands(
    @Query('includeStats') includeStats?: boolean,
    @Query('take') take?: number,
    @Query('skip') skip?: number,
  ) {
    return this.paintBrandService.findMany({
      includeStats: includeStats ?? true,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get('brands/available')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getAvailablePaintBrands() {
    return this.paintBrandService.findMany({});
  }

  @Get('brands/:brand')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getPaintsByBrandName(
    @Param('brand') brand: string,
    @Query('includePaints') includePaints?: boolean,
    @Query('paintTypeId') paintTypeId?: string,
  ) {
    // Find paints by brand name
    return this.paintService.findMany({
      where: {
        paintBrand: {
          name: { contains: brand, mode: 'insensitive' },
        },
        ...(paintTypeId && { paintTypeId }),
      },
      include: {
        paintBrand: true,
        paintType: true,
        ...(includePaints && { formulas: true }),
      },
    });
  }

  @Get('brands/:brand/paints')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getPaintsByBrand(
    @Param('brand') brand: string,
    @Query('paintTypeId') paintTypeId?: string,
    @Query('take') take?: number,
    @Query('skip') skip?: number,
  ) {
    return (this.paintService as any).getPaintsByBrand(brand as any, {
      paintTypeId,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
      include: {
        paintType: true,
        formulas: {
          include: {
            _count: {
              select: { components: true },
            },
          },
        },
      },
    });
  }

  @Get('components/filtered')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getComponentsByPaintFilters(
    @Query('paintTypeIds') paintTypeIds?: string,
    @Query('paintBrands') paintBrands?: string,
    @Query('take') take?: number,
    @Query('skip') skip?: number,
  ) {
    return (this.paintService as any).getComponentsByPaintFilters({
      paintTypeIds: paintTypeIds ? paintTypeIds.split(',') : undefined,
      paintBrands: paintBrands ? (paintBrands.split(',') as any) : undefined,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get('components/available/:paintBrand/:paintTypeId')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getAvailableComponents(
    @Param('paintBrand') paintBrand: string,
    @Param('paintTypeId') paintTypeId: string,
  ) {
    return this.paintService.getAvailableComponents(paintBrand, paintTypeId);
  }

  @Get('components/validate/:componentId/:paintBrand/:paintTypeId')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async validateComponentCompatibility(
    @Param('componentId') componentId: string,
    @Param('paintBrand') paintBrand: string,
    @Param('paintTypeId') paintTypeId: string,
  ) {
    const validation = await this.paintCompatibilityService.validateComponentCompatibility(
      componentId,
      paintBrand as any,
      paintTypeId,
    );
    return {
      success: true,
      message: validation.isValid
        ? 'Componente é compatível'
        : validation.reason || 'Componente não é compatível',
      data: validation,
    };
  }

  @Get('compatibility/matrix')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getCompatibilityMatrix() {
    const matrix = await this.paintCompatibilityService.getCompatibilityMatrix();
    return {
      success: true,
      message: 'Matriz de compatibilidade carregada com sucesso',
      data: matrix,
    };
  }

  @Get('components/suggested/:paintBrand/:paintTypeId')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getSuggestedComponents(
    @Param('paintBrand') paintBrand: string,
    @Param('paintTypeId') paintTypeId: string,
    @Query('limit') limit?: string,
  ) {
    const components = await this.paintCompatibilityService.getSuggestedComponents(
      paintBrand as any,
      paintTypeId,
      limit ? parseInt(limit) : 20,
    );
    return {
      success: true,
      message: 'Componentes sugeridos carregados com sucesso',
      data: components,
    };
  }

  // Dynamic route for paint by id - must come after all static routes
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintGetByIdSchema))
  async getPaintById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaintGetByIdFormData,
  ): Promise<PaintGetUniqueResponse> {
    return this.paintService.findById(id, query.include);
  }
}
