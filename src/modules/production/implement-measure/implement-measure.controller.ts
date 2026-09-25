// apps/api/src/modules/production/implement-measure/implement-measure.controller.ts

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UsePipes,
  Res,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ZodParamValidationPipe, ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { ImplementMeasureService } from './implement-measure.service';
import {
  implementFaceSchema,
  implementMeasureAssignSchema,
  implementMeasureBatchSchema,
  implementMeasureCreateSchema,
  implementMeasureUpdateSchema,
  type ImplementMeasureAssignFormData,
  type ImplementMeasureBatchFormData,
  type ImplementMeasureCreateFormData,
  type ImplementMeasureUpdateFormData,
} from '../../../schemas';
import { IMPLEMENT_FACE_LABELS, type ImplementFace } from '../../../constants/implement-faces';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';

@Controller('implement-measure')
export class ImplementMeasureController {
  constructor(private readonly implementMeasureService: ImplementMeasureService) {}

  // NEW: List all implementMeasures (implementMeasure library)
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findAll(
    @Query('includeUsage') includeUsage?: string,
    @Query('includeSections') includeSections?: string,
    @UserId() userId?: string,
  ) {
    const implementMeasures = await this.implementMeasureService.findAll({
      includeUsage: includeUsage === 'true',
      includeSections: includeSections === 'true',
    });

    return {
      success: true,
      message: 'ImplementMeasures encontrados com sucesso',
      data: implementMeasures,
    };
  }

  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findById(@Param('id') id: string, @Query() query: any, @UserId() userId: string) {
    const implementMeasure = await this.implementMeasureService.findById(id, query.include);

    if (!implementMeasure) {
      return {
        success: false,
        message: 'Medida não encontrada',
        data: null,
      };
    }

    return {
      success: true,
      message: 'Medida encontrada com sucesso',
      data: implementMeasure,
    };
  }

  // NEW: Get implementMeasure usage details
  @Get(':id/usage')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async getImplementMeasureUsage(@Param('id') id: string, @UserId() userId: string) {
    const usage = await this.implementMeasureService.getImplementsUsingImplementMeasure(id);

    return {
      success: true,
      message: 'Uso da medida obtido com sucesso',
      data: usage,
    };
  }

  @Get('implement/:implementId')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findByImplementId(
    @Param('implementId') implementId: string,
    @Query('includePhoto') includePhoto: string,
    @UserId() userId: string,
  ) {
    const implementMeasures = await this.implementMeasureService.findByImplementId(implementId, {
      includePhoto: includePhoto === 'true',
    });

    return {
      success: true,
      message: 'Medidas do implemento encontradas com sucesso',
      data: implementMeasures,
    };
  }

  @Post()
  @Roles(
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  @UsePipes(new ZodValidationPipe(implementMeasureCreateSchema))
  async create(@Body() data: ImplementMeasureCreateFormData, @UserId() userId: string) {
    const implementMeasure = await this.implementMeasureService.create(data, userId);

    return {
      success: true,
      message: 'Medida criada com sucesso',
      data: implementMeasure,
    };
  }

  @Put(':id')
  @Roles(
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  @UsePipes(new ZodValidationPipe(implementMeasureUpdateSchema))
  async update(
    @Param('id') id: string,
    @Body() data: ImplementMeasureUpdateFormData,
    @UserId() userId: string,
  ) {
    const implementMeasure = await this.implementMeasureService.update(id, data, userId);

    return {
      success: true,
      message: 'Medida atualizada com sucesso',
      data: implementMeasure,
    };
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.DESIGNER, SECTOR_PRIVILEGES.ADMIN)
  async delete(@Param('id') id: string, @UserId() userId: string) {
    await this.implementMeasureService.delete(id, userId);

    return {
      success: true,
      message: 'Medida excluída com sucesso',
    };
  }

  // NEW: Assign existing implementMeasure to implement
  @Post(':id/assign-to-implement')
  @Roles(
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async assignImplementMeasureToImplement(
    @Param('id', ParseUUIDPipe) implementMeasureId: string,
    @Body(new ZodValidationPipe(implementMeasureAssignSchema)) data: ImplementMeasureAssignFormData,
    @UserId() userId: string,
  ) {
    await this.implementMeasureService.assignImplementMeasureToImplement(
      data.implementId,
      data.side,
      implementMeasureId,
      userId,
    );

    return {
      success: true,
      message: `Medida atribuída ao lado ${IMPLEMENT_FACE_LABELS[data.side]} do implemento com sucesso`,
    };
  }

  // Várias faces do implemento de uma vez, com UMA notificação consolidada.
  @Post('implement/:implementId/batch')
  @Roles(
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async updateImplementMeasureBatch(
    @Param('implementId', ParseUUIDPipe) implementId: string,
    @Body(new ZodValidationPipe(implementMeasureBatchSchema)) data: ImplementMeasureBatchFormData,
    @UserId() userId: string,
  ) {
    const implementMeasures = await this.implementMeasureService.updateImplementMeasureBatch(
      implementId,
      data,
      userId,
    );

    return {
      success: true,
      message: 'Medidas do implemento salvas com sucesso',
      data: implementMeasures,
    };
  }

  @Post('implement/:implementId/:side')
  @Roles(
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  @UseInterceptors(FileFieldsInterceptor([{ name: 'photo', maxCount: 1 }], multerConfig))
  async createOrUpdateImplementMeasure(
    @Param('implementId', ParseUUIDPipe) implementId: string,
    @Param('side', new ZodParamValidationPipe(implementFaceSchema)) side: ImplementFace,
    @Body(new ZodValidationPipe(implementMeasureCreateSchema)) data: ImplementMeasureCreateFormData,
    @Query('existingImplementMeasureId') existingImplementMeasureId: string | undefined, // NEW: Optional existing implementMeasure ID
    @UserId() userId: string,
    @UploadedFiles() files?: Record<string, Express.Multer.File[]>,
  ) {
    // Extract photo file if uploaded
    const photoFile = files?.photo?.[0];

    const implementMeasure = await this.implementMeasureService.createOrUpdateImplementMeasure(
      implementId,
      side,
      data,
      userId,
      photoFile,
      existingImplementMeasureId, // NEW: Pass existing implementMeasure ID
    );

    return {
      success: true,
      message: `Medida ${IMPLEMENT_FACE_LABELS[side]} do implemento salva com sucesso`,
      data: implementMeasure,
    };
  }

  @Get(':id/svg')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async generateSVG(@Param('id') id: string, @Res() res: Response) {
    try {
      const svgContent = await this.implementMeasureService.generateSVG(id);

      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', `attachment; filename="implementMeasure-${id}.svg"`);
      res.status(HttpStatus.OK).send(svgContent);
    } catch (error) {
      res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: 'Medida não encontrada',
      });
    }
  }
}
