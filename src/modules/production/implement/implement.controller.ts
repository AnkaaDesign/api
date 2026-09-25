import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { ImplementService } from './implement.service';
import {
  implementAvailabilityQuerySchema,
  implementBulkSpotUpdateSchema,
  implementGetManySchema,
  implementQuerySchema,
  implementRequestMovementSchema,
  implementUpdateSchema,
  type ImplementAvailabilityQueryFormData,
  type ImplementBulkSpotUpdateFormData,
  type ImplementGetManyFormData,
  type ImplementQueryFormData,
  type ImplementRequestMovementFormData,
  type ImplementUpdateFormData,
} from '../../../schemas/implement';
import {
  ZodQueryValidationPipe,
  ZodValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import type { GarageId } from '../../../constants/garage';
import { getSectorNameForGarage } from '../../../constants/garage';

/** G1: a consulta do implemento passa pelo validador do DMMF depois do zod. */
export const IMPLEMENT_QUERY_SHAPE = { queryModel: 'Implement' } as const;

export const IMPLEMENT_READ_ROLES = [
  SECTOR_PRIVILEGES.PRODUCTION,
  SECTOR_PRIVILEGES.WAREHOUSE,
  SECTOR_PRIVILEGES.FINANCIAL,
  SECTOR_PRIVILEGES.LOGISTIC,
  SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  SECTOR_PRIVILEGES.COMMERCIAL,
  SECTOR_PRIVILEGES.ADMIN,
] as const;

export const IMPLEMENT_SPOT_ROLES = [
  SECTOR_PRIVILEGES.WAREHOUSE,
  SECTOR_PRIVILEGES.FINANCIAL,
  SECTOR_PRIVILEGES.LOGISTIC,
  SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  SECTOR_PRIVILEGES.ADMIN,
] as const;

export const IMPLEMENT_UPDATE_ROLES = [
  SECTOR_PRIVILEGES.WAREHOUSE,
  SECTOR_PRIVILEGES.FINANCIAL,
  SECTOR_PRIVILEGES.LOGISTIC,
  SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  SECTOR_PRIVILEGES.COMMERCIAL,
  SECTOR_PRIVILEGES.ADMIN,
] as const;

export function assertGarageId(garageId: string): GarageId {
  if (!['B1', 'B2', 'B3'].includes(garageId)) {
    throw new BadRequestException(`Barracão inválido: ${garageId}. Use B1, B2 ou B3.`);
  }
  return garageId as GarageId;
}

export function sectorGarageMapping() {
  return (['B1', 'B2', 'B3'] as GarageId[]).map(garageId => ({
    garageId,
    sectorName: getSectorNameForGarage(garageId),
  }));
}

/**
 * IMPLEMENTO (era `/implements`, que continua como alias fino até a R-D:
 * `implement-alias.controller.ts`). Toda entrada validada em runtime (G12).
 */
@Controller('implements')
export class ImplementController {
  constructor(private readonly implementService: ImplementService) {}

  @Get()
  @Roles(...IMPLEMENT_READ_ROLES)
  async findAll(
    @Query(new ZodQueryValidationPipe(implementGetManySchema, IMPLEMENT_QUERY_SHAPE))
    query: ImplementGetManyFormData,
  ) {
    const { data, total } = await this.implementService.findAll(query);
    return {
      success: true,
      message: 'Implementos encontrados com sucesso',
      data,
      ...(total !== undefined && query.limit
        ? {
            meta: {
              totalRecords: total,
              page: query.page ?? 1,
              take: query.limit,
              totalPages: Math.ceil(total / query.limit),
            },
          }
        : {}),
    };
  }

  /** Mapeamento fixo setor ↔ barracão (validação no cliente). */
  @Get('sector-garage-mapping')
  @Roles(...IMPLEMENT_READ_ROLES)
  async getSectorGarageMapping() {
    return {
      success: true,
      message: 'Mapeamento setor-barracão retornado com sucesso',
      data: sectorGarageMapping(),
    };
  }

  /** Disponibilidade de todos os barracões para um implemento de dado comprimento. */
  @Get('garages-availability')
  @Roles(...IMPLEMENT_READ_ROLES)
  async getAllGaragesAvailability(
    @Query(new ZodValidationPipe(implementAvailabilityQuerySchema))
    query: ImplementAvailabilityQueryFormData,
  ) {
    return {
      success: true,
      message: 'Disponibilidade de garagens calculada com sucesso',
      data: await this.implementService.getAllGaragesAvailability(
        query.implementLength,
        query.excludeImplementId,
      ),
    };
  }

  /** Disponibilidade das faixas de um barracão. */
  @Get('lane-availability/:garageId')
  @Roles(...IMPLEMENT_READ_ROLES)
  async getLaneAvailability(
    @Param('garageId') garageId: string,
    @Query(new ZodValidationPipe(implementAvailabilityQuerySchema))
    query: ImplementAvailabilityQueryFormData,
  ) {
    return {
      success: true,
      message: 'Disponibilidade de faixas calculada com sucesso',
      data: await this.implementService.getLaneAvailability(
        assertGarageId(garageId),
        query.implementLength,
        query.excludeImplementId,
      ),
    };
  }

  /** Vagas de vários implementos numa transação (o "Salvar" do barracão). */
  @Post('batch-update-spots')
  @Roles(...IMPLEMENT_SPOT_ROLES)
  async batchUpdateSpots(
    @Body(new ZodValidationPipe(implementBulkSpotUpdateSchema))
    body: ImplementBulkSpotUpdateFormData,
    @UserId() userId: string,
  ) {
    const result = await this.implementService.batchUpdateSpots(
      body.updates as Array<{ implementId: string; spot: string | null }>,
      userId,
    );
    return {
      success: true,
      message: `${result.updated} implementos atualizados com sucesso`,
      data: result,
    };
  }

  /** Pedido de movimentação (notifica a logística). */
  @Post('request-movement')
  @Roles(...IMPLEMENT_READ_ROLES)
  async requestMovement(
    @Body(new ZodValidationPipe(implementRequestMovementSchema))
    body: ImplementRequestMovementFormData,
    @UserId() userId: string,
  ) {
    const result = await this.implementService.requestMovement(
      body as ImplementRequestMovementFormData & { taskId: string; implementId: string },
      userId,
    );
    return {
      success: true,
      message: 'Solicitação de movimentação enviada com sucesso',
      data: result,
    };
  }

  @Get(':id')
  @Roles(...IMPLEMENT_READ_ROLES)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(implementQuerySchema, IMPLEMENT_QUERY_SHAPE))
    query: ImplementQueryFormData,
  ) {
    const implement = await this.implementService.findById(id, query.include);
    if (!implement) throw new NotFoundException('Implemento não encontrado');
    return {
      success: true,
      message: 'Implemento encontrado com sucesso',
      data: implement,
    };
  }

  @Put(':id')
  @Roles(...IMPLEMENT_UPDATE_ROLES)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(implementUpdateSchema)) data: ImplementUpdateFormData,
    @Query(new ZodQueryValidationPipe(implementQuerySchema, IMPLEMENT_QUERY_SHAPE))
    query: ImplementQueryFormData,
    @UserId() userId: string,
  ) {
    return {
      success: true,
      message: 'Implemento atualizado com sucesso',
      data: await this.implementService.update(id, data, query.include, userId),
    };
  }
}
