// apps/api/src/modules/production/layout/layout.controller.ts

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
import { LayoutService } from './layout.service';
import {
  layoutCreateSchema,
  layoutUpdateSchema,
  type LayoutCreateFormData,
  type LayoutUpdateFormData,
} from '../../../schemas';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';

@Controller('layout')
export class LayoutController {
  constructor(private readonly layoutService: LayoutService) {}

  // NEW: List all layouts (layout library)
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findAll(@Query('includeUsage') includeUsage?: string, @Query('includeSections') includeSections?: string, @UserId() userId?: string) {
    const layouts = await this.layoutService.findAll({
      includeUsage: includeUsage === 'true',
      includeSections: includeSections === 'true',
    });

    return {
      success: true,
      message: 'Layouts encontrados com sucesso',
      data: layouts,
    };
  }

  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findById(@Param('id') id: string, @Query() query: any, @UserId() userId: string) {
    const layout = await this.layoutService.findById(id, query.include);

    if (!layout) {
      return {
        success: false,
        message: 'Layout não encontrado',
        data: null,
      };
    }

    return {
      success: true,
      message: 'Layout encontrado com sucesso',
      data: layout,
    };
  }

  // NEW: Get layout usage details
  @Get(':id/usage')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async getLayoutUsage(@Param('id') id: string, @UserId() userId: string) {
    const usage = await this.layoutService.getTrucksUsingLayout(id);

    return {
      success: true,
      message: 'Detalhes de uso do layout obtidos com sucesso',
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
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findByTruckId(@Param('truckId') truckId: string, @UserId() userId: string) {
    const layouts = await this.layoutService.findByTruckId(truckId);

    return {
      success: true,
      message: 'Layouts do caminhão encontrados com sucesso',
      data: layouts,
    };
  }

  @Post()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  @UsePipes(new ZodValidationPipe(layoutCreateSchema))
  async create(@Body() data: LayoutCreateFormData, @UserId() userId: string) {
    const layout = await this.layoutService.create(data, userId);

    return {
      success: true,
      message: 'Layout criado com sucesso',
      data: layout,
    };
  }

  @Put(':id')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  @UsePipes(new ZodValidationPipe(layoutUpdateSchema))
  async update(
    @Param('id') id: string,
    @Body() data: LayoutUpdateFormData,
    @UserId() userId: string,
  ) {
    const layout = await this.layoutService.update(id, data, userId);

    return {
      success: true,
      message: 'Layout atualizado com sucesso',
      data: layout,
    };
  }

  @Delete(':id')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async delete(@Param('id') id: string, @UserId() userId: string) {
    await this.layoutService.delete(id, userId);

    return {
      success: true,
      message: 'Layout excluído com sucesso',
    };
  }

  // NEW: Assign existing layout to truck
  @Post(':id/assign-to-truck')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async assignLayoutToTruck(
    @Param('id') layoutId: string,
    @Body() data: { truckId: string; side: 'left' | 'right' | 'back' },
    @UserId() userId: string,
  ) {
    await this.layoutService.assignLayoutToTruck(
      data.truckId,
      data.side,
      layoutId,
      userId,
    );

    return {
      success: true,
      message: `Layout atribuído ao lado ${data.side === 'left' ? 'esquerdo' : data.side === 'right' ? 'direito' : 'traseiro'} do caminhão com sucesso`,
    };
  }

  @Post('truck/:truckId/:side')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.ADMIN,
  )
  @UseInterceptors(FileFieldsInterceptor([{ name: 'photo', maxCount: 1 }], multerConfig))
  async createOrUpdateTruckLayout(
    @Param('truckId') truckId: string,
    @Param('side') side: 'left' | 'right' | 'back',
    @Body(new ZodValidationPipe(layoutCreateSchema)) data: LayoutCreateFormData,
    @Query('existingLayoutId') existingLayoutId: string | undefined, // NEW: Optional existing layout ID
    @UserId() userId: string,
    @UploadedFiles() files?: Record<string, Express.Multer.File[]>,
  ) {
    // Extract photo file if uploaded
    const photoFile = files?.photo?.[0];

    const layout = await this.layoutService.createOrUpdateTruckLayout(
      truckId,
      side,
      data,
      userId,
      photoFile,
      existingLayoutId, // NEW: Pass existing layout ID
    );

    return {
      success: true,
      message: `Layout ${side === 'left' ? 'esquerdo' : side === 'right' ? 'direito' : 'traseiro'} do caminhão salvo com sucesso`,
      data: layout,
    };
  }

  @Get(':id/svg')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async generateSVG(@Param('id') id: string, @Res() res: Response) {
    try {
      const svgContent = await this.layoutService.generateSVG(id);

      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', `attachment; filename="layout-${id}.svg"`);
      res.status(HttpStatus.OK).send(svgContent);
    } catch (error) {
      res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: 'Layout não encontrado',
      });
    }
  }
}
