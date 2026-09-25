/**
 * ALIAS `/trucks` → `/implements` (janela bilíngue, PLANO §5.1, P11a). EXPIRA na
 * R-D (P32), quando o contador zerar por 14 dias.
 *
 * Fino de propósito: cada rota traduz o nome velho (query `truckLength`,
 * `excludeTruckId`; corpo `truckId`, `implementType`), chama o MESMO serviço, e
 * devolve a resposta no formato que o web em produção e o app 1.4.1 leem
 * (`truckId`, `truckLength`, `currentTrucks`, `implementType`). Toda resposta
 * leva `Deprecation: true` e cada uso conta por rota × versão do app.
 *
 * O Flutter instalado usa `POST /trucks/batch-update-spots`
 * (`garage_edit_controller.dart:233`); o web, `garages-availability`,
 * `batch-update-spots` e `request-movement` (`web/src/api-client/truck.ts`).
 */
import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  Query,
  Req,
  Res,
  ParseUUIDPipe,
  ParseFloatPipe,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ImplementService, type GarageAvailability, type LaneAvailability } from './implement.service';
import {
  implementBulkSpotUpdateSchema,
  implementQuerySchema,
  implementRequestMovementSchema,
  implementUpdateSchema,
} from '../../../schemas/implement';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { enforceQueryShape } from '@modules/common/query/query-shape.guard';
import { translateLegacyImplementQuery } from '@modules/common/legacy-implement/legacy-implement-keys';
import { recordLegacyImplementUse } from '@modules/common/legacy-implement/implement-legacy-mirror.interceptor';
import {
  IMPLEMENT_READ_ROLES,
  IMPLEMENT_SPOT_ROLES,
  IMPLEMENT_UPDATE_ROLES,
  assertGarageId,
  sectorGarageMapping,
} from './implement.controller';

const SUCCESSOR = '</implements>; rel="successor-version"';

function deprecate(req: Request, res: Response): void {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', SUCCESSOR);
  const version = req.appVersion?.raw
    ? `app ${req.appVersion.raw}`
    : String(req.headers['x-client'] ?? req.headers['user-agent'] ?? 'sem-versão').slice(0, 32);
  const route = (req as Request & { route?: { path?: string } }).route?.path ?? req.path;
  recordLegacyImplementUse(`${req.method} /trucks${String(route).replace(/^\/trucks/, '')}`, 'rota /trucks', version);
}

/** A resposta de disponibilidade com as chaves que os clientes instalados leem. */
function legacyLane(l: LaneAvailability) {
  const { currentImplements, spotOccupants, ...rest } = l;
  return {
    ...rest,
    currentTrucks: currentImplements,
    spotOccupants: spotOccupants.map(({ implementId, implementLength, ...o }) => ({
      ...o,
      truckId: implementId,
      truckLength: implementLength,
    })),
  };
}

function legacyGarage(g: GarageAvailability) {
  return { ...g, lanes: g.lanes.map(legacyLane) };
}

/** O implemento com o campo pelo nome velho (`implementType`). */
function legacyImplement<T>(implement: T): T {
  if (!implement || typeof implement !== 'object') return implement;
  const i = implement as Record<string, unknown>;
  return { ...i, implementType: i.type } as T;
}

/** O corpo velho de `PUT /trucks/:id` → o do implemento (sem as chaves que nunca gravaram). */
function legacyUpdateBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { implementType, taskId, leftSideMeasureId, rightSideMeasureId, backSideMeasureId, ...rest } =
    body as Record<string, unknown>;
  void taskId;
  void leftSideMeasureId;
  void rightSideMeasureId;
  void backSideMeasureId;
  if (implementType !== undefined && 'type' in rest) {
    throw new BadRequestException('Envie só "type" (o nome antigo e o novo vieram juntos).');
  }
  return implementType !== undefined ? { ...rest, type: implementType } : rest;
}

@Controller('trucks')
export class TruckAliasController {
  constructor(private readonly implementService: ImplementService) {}

  /** Só o `include` era lido pela rota velha (`query: any`): o resto é ignorado como antes. */
  private parseInclude(query: Record<string, unknown>): Record<string, unknown> | undefined {
    const translated = translateLegacyImplementQuery({ include: query?.include });
    let include = translated.include;
    if (typeof include === 'string') {
      try {
        include = JSON.parse(include);
      } catch {
        throw new BadRequestException('include inválido');
      }
    }
    const parsed = implementQuerySchema.safeParse({ include });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map(i => i.message).join('; '));
    }
    return enforceQueryShape('Implement', parsed.data).include as Record<string, unknown> | undefined;
  }

  @Get()
  @Roles(...IMPLEMENT_READ_ROLES)
  async findAll(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    deprecate(req, res);
    const { data } = await this.implementService.findAll({ include: this.parseInclude(query) as any });
    return { success: true, message: 'Caminhoes encontrados com sucesso', data: data.map(legacyImplement) };
  }

  @Get('sector-garage-mapping')
  @Roles(...IMPLEMENT_READ_ROLES)
  async getSectorGarageMapping(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    deprecate(req, res);
    return {
      success: true,
      message: 'Mapeamento setor-barracão retornado com sucesso',
      data: sectorGarageMapping(),
    };
  }

  @Get('garages-availability')
  @Roles(...IMPLEMENT_READ_ROLES)
  async getAllGaragesAvailability(
    @Query('truckLength', ParseFloatPipe) length: number,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('excludeTruckId') excludeId?: string,
  ) {
    deprecate(req, res);
    const data = await this.implementService.getAllGaragesAvailability(length, excludeId || undefined);
    return {
      success: true,
      message: 'Disponibilidade de garagens calculada com sucesso',
      data: data.map(legacyGarage),
    };
  }

  @Get('lane-availability/:garageId')
  @Roles(...IMPLEMENT_READ_ROLES)
  async getLaneAvailability(
    @Param('garageId') garageId: string,
    @Query('truckLength', ParseFloatPipe) length: number,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('excludeTruckId') excludeId?: string,
  ) {
    deprecate(req, res);
    const data = await this.implementService.getLaneAvailability(
      assertGarageId(garageId),
      length,
      excludeId || undefined,
    );
    return {
      success: true,
      message: 'Disponibilidade de faixas calculada com sucesso',
      data: data.map(legacyLane),
    };
  }

  @Post('batch-update-spots')
  @Roles(...IMPLEMENT_SPOT_ROLES)
  async batchUpdateSpots(
    @Body() body: { updates?: Array<{ truckId?: string; implementId?: string; spot: string | null }> },
    @UserId() userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    deprecate(req, res);
    if (!body || !Array.isArray(body.updates)) {
      throw new BadRequestException('updates deve ser um array');
    }
    const translated = {
      updates: body.updates.map(u => {
        const { truckId, ...rest } = u ?? ({} as any);
        if (truckId !== undefined && rest.implementId !== undefined) {
          throw new BadRequestException('Envie só "implementId" (o nome antigo e o novo vieram juntos).');
        }
        return truckId !== undefined ? { ...rest, implementId: truckId } : rest;
      }),
    };
    const parsed = new ZodValidationPipe(implementBulkSpotUpdateSchema).transform(translated, {
      type: 'body',
      metatype: Object,
      data: undefined,
    }) as { updates: Array<{ implementId: string; spot: string | null }> };
    const result = await this.implementService.batchUpdateSpots(parsed.updates, userId);
    return {
      success: true,
      message: `${result.updated} caminhoes atualizados com sucesso`,
      data: result,
    };
  }

  @Post('request-movement')
  @Roles(...IMPLEMENT_READ_ROLES)
  async requestMovement(
    @Body() body: Record<string, unknown>,
    @UserId() userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    deprecate(req, res);
    const { truckId, ...rest } = body ?? {};
    if (truckId !== undefined && rest.implementId !== undefined) {
      throw new BadRequestException('Envie só "implementId" (o nome antigo e o novo vieram juntos).');
    }
    const parsed = new ZodValidationPipe(implementRequestMovementSchema).transform(
      truckId !== undefined ? { ...rest, implementId: truckId } : rest,
      { type: 'body', metatype: Object, data: undefined },
    ) as any;
    const result = await this.implementService.requestMovement(parsed, userId);
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
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    deprecate(req, res);
    const implement = await this.implementService.findById(id, this.parseInclude(query));
    if (!implement) {
      return { success: false, message: 'Caminhao nao encontrado', data: null };
    }
    return { success: true, message: 'Caminhao encontrado com sucesso', data: legacyImplement(implement) };
  }

  @Put(':id')
  @Roles(...IMPLEMENT_UPDATE_ROLES)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @UserId() userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    deprecate(req, res);
    const data = new ZodValidationPipe(implementUpdateSchema).transform(legacyUpdateBody(body), {
      type: 'body',
      metatype: Object,
      data: undefined,
    }) as any;
    const updated = await this.implementService.update(id, data, this.parseInclude(query), userId);
    return { success: true, message: 'Caminhao atualizado com sucesso', data: legacyImplement(updated) };
  }
}
