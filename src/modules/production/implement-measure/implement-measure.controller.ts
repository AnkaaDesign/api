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
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { ImplementMeasureService } from './implement-measure.service';
import {
  implementMeasureCreateSchema,
  implementMeasureUpdateSchema,
  type ImplementMeasureCreateFormData,
  type ImplementMeasureUpdateFormData,
} from '../../../schemas';
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
        message: 'ImplementMeasure não encontrado',
        data: null,
      };
    }

    return {
      success: true,
      message: 'ImplementMeasure encontrado com sucesso',
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
    const usage = await this.implementMeasureService.getTrucksUsingImplementMeasure(id);

    return {
      success: true,
      message: 'Detalhes de uso do implementMeasure obtidos com sucesso',
      data: usage,
    };
  }

  @Get('truck/:truckId')
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
  async findByTruckId(
    @Param('truckId') truckId: string,
    @Query('includePhoto') includePhoto: string,
    @UserId() userId: string,
  ) {
    const implementMeasures = await this.implementMeasureService.findByTruckId(truckId, {
      includePhoto: includePhoto === 'true',
    });

    return {
      success: true,
      message: 'ImplementMeasures do caminhão encontrados com sucesso',
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
      message: 'ImplementMeasure criado com sucesso',
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
      message: 'ImplementMeasure atualizado com sucesso',
      data: implementMeasure,
    };
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.DESIGNER, SECTOR_PRIVILEGES.ADMIN)
  async delete(@Param('id') id: string, @UserId() userId: string) {
    await this.implementMeasureService.delete(id, userId);

    return {
      success: true,
      message: 'ImplementMeasure excluído com sucesso',
    };
  }

  // NEW: Assign existing implementMeasure to truck
  @Post(':id/assign-to-truck')
  @Roles(
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async assignImplementMeasureToTruck(
    @Param('id') implementMeasureId: string,
    @Body() data: { truckId: string; side: 'left' | 'right' | 'back' },
    @UserId() userId: string,
  ) {
    await this.implementMeasureService.assignImplementMeasureToTruck(data.truckId, data.side, implementMeasureId, userId);

    return {
      success: true,
      message: `ImplementMeasure atribuído ao lado ${data.side === 'left' ? 'Motorista' : data.side === 'right' ? 'Sapo' : 'Traseira'} do caminhão com sucesso`,
    };
  }

  // NEW: Batch-update multiple truck implementMeasure sides with a SINGLE consolidated notification
  @Post('truck/:truckId/batch')
  @Roles(
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async updateTruckImplementMeasureBatch(
    @Param('truckId') truckId: string,
    @Body()
    data: {
      left?: ImplementMeasureCreateFormData;
      right?: ImplementMeasureCreateFormData;
      back?: ImplementMeasureCreateFormData;
    },
    @UserId() userId: string,
  ) {
    const implementMeasures = await this.implementMeasureService.updateTruckImplementMeasureBatch(
      truckId,
      {
        left: data.left ? implementMeasureCreateSchema.parse(data.left) : undefined,
        right: data.right ? implementMeasureCreateSchema.parse(data.right) : undefined,
        back: data.back ? implementMeasureCreateSchema.parse(data.back) : undefined,
      },
      userId,
    );

    return {
      success: true,
      message: 'ImplementMeasure do caminhão salvo com sucesso',
      data: implementMeasures,
    };
  }

  @Post('truck/:truckId/:side')
  @Roles(
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  @UseInterceptors(FileFieldsInterceptor([{ name: 'photo', maxCount: 1 }], multerConfig))
  async createOrUpdateTruckImplementMeasure(
    @Param('truckId') truckId: string,
    @Param('side') side: 'left' | 'right' | 'back',
    @Body(new ZodValidationPipe(implementMeasureCreateSchema)) data: ImplementMeasureCreateFormData,
    @Query('existingImplementMeasureId') existingImplementMeasureId: string | undefined, // NEW: Optional existing implementMeasure ID
    @UserId() userId: string,
    @UploadedFiles() files?: Record<string, Express.Multer.File[]>,
  ) {
    // Extract photo file if uploaded
    const photoFile = files?.photo?.[0];

    const implementMeasure = await this.implementMeasureService.createOrUpdateTruckImplementMeasure(
      truckId,
      side,
      data,
      userId,
      photoFile,
      existingImplementMeasureId, // NEW: Pass existing implementMeasure ID
    );

    return {
      success: true,
      message: `ImplementMeasure ${side === 'left' ? 'Motorista' : side === 'right' ? 'Sapo' : 'Traseira'} do caminhão salvo com sucesso`,
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
        message: 'ImplementMeasure não encontrado',
      });
    }
  }
}
