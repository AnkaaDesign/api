import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  ParseFloatPipe,
  BadRequestException,
} from '@nestjs/common';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId, User } from '@modules/common/auth/decorators/user.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { TruckService } from './truck.service';
import type { TruckUpdateFormData } from '../../../schemas/truck';
import type { GarageId } from '../../../constants/garage';
import type { UserPayload } from '@modules/common/auth/decorators/user.decorator';

@Controller('trucks')
export class TruckController {
  constructor(private readonly truckService: TruckService) {}

  @Get()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findAll(@Query() query: any) {
    const trucks = await this.truckService.findAll(query);
    return {
      success: true,
      message: 'Caminhoes encontrados com sucesso',
      data: trucks,
    };
  }

  /**
   * Get availability for all garages
   * Used by the spot selector to show which garages can fit a truck
   * NOTE: Must be defined BEFORE :id route to avoid route collision
   */
  @Get('garages-availability')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async getAllGaragesAvailability(
    @Query('truckLength', ParseFloatPipe) truckLength: number,
    @Query('excludeTruckId') excludeTruckId?: string,
  ) {
    const availability = await this.truckService.getAllGaragesAvailability(
      truckLength,
      excludeTruckId,
    );

    return {
      success: true,
      message: 'Disponibilidade de garagens calculada com sucesso',
      data: availability,
    };
  }

  /**
   * Get lane availability for a specific garage
   * Used by the spot selector to show which lanes can fit a truck
   * NOTE: Must be defined BEFORE :id route to avoid route collision
   */
  @Get('lane-availability/:garageId')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async getLaneAvailability(
    @Param('garageId') garageId: string,
    @Query('truckLength', ParseFloatPipe) truckLength: number,
    @Query('excludeTruckId') excludeTruckId?: string,
  ) {
    // Validate garageId
    if (!['B1', 'B2', 'B3'].includes(garageId)) {
      throw new BadRequestException(`Garage ID invalido: ${garageId}. Use B1, B2 ou B3.`);
    }

    const availability = await this.truckService.getLaneAvailability(
      garageId as GarageId,
      truckLength,
      excludeTruckId,
    );

    return {
      success: true,
      message: 'Disponibilidade de faixas calculada com sucesso',
      data: availability,
    };
  }

  /**
   * Batch update multiple trucks' spots in a single transaction
   * Used by the garage view to save all pending changes at once
   */
  @Post('batch-update-spots')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async batchUpdateSpots(
    @Body() body: { updates: Array<{ truckId: string; spot: string | null }> },
    @UserId() userId: string,
  ) {
    if (!body.updates || !Array.isArray(body.updates)) {
      throw new BadRequestException('updates deve ser um array');
    }

    const result = await this.truckService.batchUpdateSpots(body.updates, userId);
    return {
      success: true,
      message: `${result.updated} caminhoes atualizados com sucesso`,
      data: result,
    };
  }

  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async findById(@Param('id', ParseUUIDPipe) id: string, @Query() query: any) {
    const truck = await this.truckService.findById(id, query);
    if (!truck) {
      return {
        success: false,
        message: 'Caminhao nao encontrado',
        data: null,
      };
    }
    return {
      success: true,
      message: 'Caminhao encontrado com sucesso',
      data: truck,
    };
  }

  @Put(':id')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: TruckUpdateFormData,
    @Query() query: any,
    @UserId() userId: string,
    @User() user: UserPayload,
  ) {
    const truck = await this.truckService.update(
      id,
      data,
      query,
      userId,
      user?.role as SECTOR_PRIVILEGES,
    );
    return {
      success: true,
      message: 'Caminhao atualizado com sucesso',
      data: truck,
    };
  }
}
