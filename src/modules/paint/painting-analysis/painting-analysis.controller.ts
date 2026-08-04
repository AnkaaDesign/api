import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '@constants';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { PaintingAnalysisService } from './painting-analysis.service';
import { PaintingComputeService } from './painting-compute.service';
import { PaintingConfigService } from './painting-config.service';
import {
  paintingAnalysisCreateSchema,
  paintingAnalysisGetManySchema,
  paintingAnalysisUpdateSchema,
  paintingBoundaryUpdateSchema,
  paintingComputeSchema,
  paintingFaceCreateSchema,
  paintingFaceUpdateSchema,
  paintingIndirectUpdateSchema,
  paintingProcessParamUpdateSchema,
  paintingProcessSchema,
  paintingRateUpdateSchema,
  paintingRegionUpdateSchema,
  paintingRuleUpdateSchema,
  paintingStepUpdateSchema,
  paintingStepTaskUpdateSchema,
  paintingStepMaterialUpdateSchema,
  paintingPaintSystemUpdateSchema,
} from '../../../schemas/painting-analysis';

const ALLOWED = [
  SECTOR_PRIVILEGES.ADMIN,
  SECTOR_PRIVILEGES.COMMERCIAL,
  SECTOR_PRIVILEGES.FINANCIAL,
  SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  SECTOR_PRIVILEGES.ACCOUNTING,
] as const;

@Controller('painting-analyses')
export class PaintingAnalysisController {
  constructor(
    private readonly analysisService: PaintingAnalysisService,
    private readonly computeService: PaintingComputeService,
    private readonly configService: PaintingConfigService,
  ) {}

  // =====================================================================
  // Config (must come before :id routes)
  // =====================================================================

  @Get('config')
  @Roles(...ALLOWED)
  async getConfig() {
    return this.configService.getAll();
  }

  @Patch('config/rates/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async updateRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(paintingRateUpdateSchema)) data: any,
  ) {
    return this.configService.updateRate(id, data);
  }

  @Patch('config/indirects/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async updateIndirect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(paintingIndirectUpdateSchema)) data: any,
  ) {
    return this.configService.updateIndirect(id, data);
  }

  @Patch('config/rules/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(paintingRuleUpdateSchema)) data: any,
  ) {
    return this.configService.updateRule(id, data);
  }

  @Patch('config/process-params/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async updateProcessParam(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(paintingProcessParamUpdateSchema)) data: any,
  ) {
    return this.configService.updateProcessParam(id, data);
  }

  @Patch('config/paint-systems/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async updatePaintSystem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(paintingPaintSystemUpdateSchema)) data: any,
  ) {
    return this.configService.updatePaintSystem(id, data);
  }

  // =====================================================================
  // Analyses CRUD
  // =====================================================================

  @Get()
  @Roles(...ALLOWED)
  async findMany(@Query(new ZodQueryValidationPipe(paintingAnalysisGetManySchema)) query: any) {
    return this.analysisService.findMany(query);
  }

  @Get(':id')
  @Roles(...ALLOWED)
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.analysisService.findById(id);
  }

  @Post()
  @Roles(...ALLOWED)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(new ZodValidationPipe(paintingAnalysisCreateSchema)) data: any) {
    return this.analysisService.create(data);
  }

  @Patch(':id')
  @Roles(...ALLOWED)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(paintingAnalysisUpdateSchema)) data: any,
  ) {
    return this.analysisService.update(id, data);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.analysisService.delete(id);
  }

  // =====================================================================
  // Faces
  // =====================================================================

  @Post(':id/faces')
  @Roles(...ALLOWED)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async addFace(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(paintingFaceCreateSchema)) data: any,
    @UserId() userId?: string,
  ) {
    return this.analysisService.addFace(id, data, file, userId);
  }

  @Patch('faces/:faceId')
  @Roles(...ALLOWED)
  async updateFace(
    @Param('faceId', ParseUUIDPipe) faceId: string,
    @Body(new ZodValidationPipe(paintingFaceUpdateSchema)) data: any,
  ) {
    return this.analysisService.updateFace(faceId, data);
  }

  @Delete('faces/:faceId')
  @Roles(...ALLOWED)
  async deleteFace(@Param('faceId', ParseUUIDPipe) faceId: string) {
    return this.analysisService.deleteFace(faceId);
  }

  // =====================================================================
  // Processing + compute (independently invocable stages)
  // =====================================================================

  @Post(':id/process')
  @Roles(...ALLOWED)
  @HttpCode(HttpStatus.ACCEPTED)
  async process(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(paintingProcessSchema)) data: any,
  ) {
    return this.analysisService.process(id, data);
  }

  @Post(':id/compute')
  @Roles(...ALLOWED)
  async compute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(paintingComputeSchema)) data: any,
  ) {
    return this.computeService.compute(id, data);
  }

  // =====================================================================
  // Manual overrides
  // =====================================================================

  @Patch('regions/:regionId')
  @Roles(...ALLOWED)
  async updateRegion(
    @Param('regionId', ParseUUIDPipe) regionId: string,
    @Body(new ZodValidationPipe(paintingRegionUpdateSchema)) data: any,
  ) {
    return this.analysisService.updateRegion(regionId, data);
  }

  @Patch('boundaries/:boundaryId')
  @Roles(...ALLOWED)
  async updateBoundary(
    @Param('boundaryId', ParseUUIDPipe) boundaryId: string,
    @Body(new ZodValidationPipe(paintingBoundaryUpdateSchema)) data: any,
  ) {
    return this.analysisService.updateBoundary(boundaryId, data);
  }

  @Patch('steps/:stepId')
  @Roles(...ALLOWED)
  async updateStep(
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body(new ZodValidationPipe(paintingStepUpdateSchema)) data: any,
  ) {
    return this.analysisService.updateStep(stepId, data);
  }

  @Patch('step-tasks/:taskId')
  @Roles(...ALLOWED)
  async updateStepTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body(new ZodValidationPipe(paintingStepTaskUpdateSchema)) data: any,
  ) {
    return this.analysisService.updateStepTask(taskId, data);
  }

  @Patch('step-materials/:materialId')
  @Roles(...ALLOWED)
  async updateStepMaterial(
    @Param('materialId', ParseUUIDPipe) materialId: string,
    @Body(new ZodValidationPipe(paintingStepMaterialUpdateSchema)) data: any,
  ) {
    return this.analysisService.updateStepMaterial(materialId, data);
  }

  @Patch('alerts/:alertId/resolve')
  @Roles(...ALLOWED)
  async resolveAlert(@Param('alertId', ParseUUIDPipe) alertId: string) {
    return this.analysisService.resolveAlert(alertId);
  }
}
