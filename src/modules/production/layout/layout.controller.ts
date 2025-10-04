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
} from '@nestjs/common';
import { Response } from 'express';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { LayoutService } from './layout.service';
import {
  layoutCreateSchema,
  layoutUpdateSchema,
  type LayoutCreateFormData,
  type LayoutUpdateFormData,
} from '../../../schemas';

@Controller('layout')
export class LayoutController {
  constructor(private readonly layoutService: LayoutService) {}

  @Get(':id')
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

  @Get('truck/:truckId')
  async findByTruckId(@Param('truckId') truckId: string, @UserId() userId: string) {
    const layouts = await this.layoutService.findByTruckId(truckId);

    return {
      success: true,
      message: 'Layouts do caminhão encontrados com sucesso',
      data: layouts,
    };
  }

  @Post()
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
  async delete(@Param('id') id: string, @UserId() userId: string) {
    await this.layoutService.delete(id, userId);

    return {
      success: true,
      message: 'Layout excluído com sucesso',
    };
  }

  @Post('truck/:truckId/:side')
  async createOrUpdateTruckLayout(
    @Param('truckId') truckId: string,
    @Param('side') side: 'left' | 'right' | 'back',
    @Body(new ZodValidationPipe(layoutCreateSchema)) data: LayoutCreateFormData,
    @UserId() userId: string,
  ) {
    const layout = await this.layoutService.createOrUpdateTruckLayout(truckId, side, data, userId);

    return {
      success: true,
      message: `Layout ${side === 'left' ? 'esquerdo' : side === 'right' ? 'direito' : 'traseiro'} do caminhão salvo com sucesso`,
      data: layout,
    };
  }

  @Get(':id/svg')
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
