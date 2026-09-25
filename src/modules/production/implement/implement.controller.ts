import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  BadRequestException,
  NotFoundException,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { User, UserId, type UserPayload } from '@modules/common/auth/decorators/user.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { ImplementService } from './implement.service';
import { ImplementLayoutService } from './implement-layout.service';
import {
  implementLayoutApproveOnBehalfSchema,
  implementLayoutBulkSchema,
  implementLayoutReproveSchema,
  type ImplementLayoutApproveOnBehalfFormData,
  type ImplementLayoutBulkFormData,
  type ImplementLayoutReproveFormData,
} from '../../../schemas/implement-layout';
import {
  implementAvailabilityQuerySchema,
  implementBulkSpotUpdateSchema,
  implementGetManySchema,
  implementProjectFilesSchema,
  implementQuerySchema,
  implementRequestMovementSchema,
  implementUpdateSchema,
  type ImplementAvailabilityQueryFormData,
  type ImplementBulkSpotUpdateFormData,
  type ImplementGetManyFormData,
  type ImplementProjectFilesFormData,
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

/**
 * Quem mexe no PROJETO DO IMPLEMENTO (o PDF da Furgões): o domínio
 * `implementProjectFiles` do plano (§5.3 item 5).
 */
export const IMPLEMENT_PROJECT_ROLES = [
  SECTOR_PRIVILEGES.COMMERCIAL,
  SECTOR_PRIVILEGES.LOGISTIC,
  SECTOR_PRIVILEGES.DESIGNER,
  SECTOR_PRIVILEGES.ADMIN,
] as const;

/**
 * A ARTE DO IMPLEMENTO (§5.1, §7.1). Subir, enviar ao cliente, versão nova, lote e
 * apagar rascunho: quem faz a arte (designer) e quem fala com o cliente (comercial).
 * Aprovar em nome do cliente e reprovar: comercial e administrador (nota obrigatória).
 */
export const IMPLEMENT_ART_EDIT_ROLES = [
  SECTOR_PRIVILEGES.DESIGNER,
  SECTOR_PRIVILEGES.COMMERCIAL,
  SECTOR_PRIVILEGES.ADMIN,
] as const;
export const IMPLEMENT_ART_DECIDE_ROLES = [
  SECTOR_PRIVILEGES.COMMERCIAL,
  SECTOR_PRIVILEGES.ADMIN,
] as const;
/** Quem LÊ a arte: os papéis do implemento e o designer. */
export const IMPLEMENT_ART_READ_ROLES = [
  ...IMPLEMENT_READ_ROLES,
  SECTOR_PRIVILEGES.DESIGNER,
] as const;
/** Quem vê a arte em todos os estados; os demais só a APROVADA (o filtro por papel, risco 25). */
const SEES_ALL_ART = new Set<string>([
  SECTOR_PRIVILEGES.COMMERCIAL,
  SECTOR_PRIVILEGES.DESIGNER,
  SECTOR_PRIVILEGES.LOGISTIC,
  SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  SECTOR_PRIVILEGES.ADMIN,
]);

/** O filtro por papel da arte (risco 25) também quando ela vem pelo include do implemento. */
function onlyApprovedArtUnlessAllowed(implement: any, role?: string): void {
  if (!Array.isArray(implement?.layouts) || (role && SEES_ALL_ART.has(role))) return;
  implement.layouts = implement.layouts.filter((l: { status?: string }) => l.status === 'APPROVED');
}

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

/** IMPLEMENTO. Toda entrada validada em runtime (G12). */
@Controller('implements')
export class ImplementController {
  constructor(
    private readonly implementService: ImplementService,
    private readonly implementLayoutService: ImplementLayoutService,
  ) {}

  // ─── A ARTE: rota estática ANTES das rotas com `:id` ─────────────────────

  /** A mesma arte (arquivo já no sistema) para N implementos, numa transação. */
  @Post('layouts/bulk')
  @Roles(...IMPLEMENT_ART_EDIT_ROLES)
  @HttpCode(HttpStatus.OK)
  async bulkLayouts(
    @Body(new ZodValidationPipe(implementLayoutBulkSchema)) data: ImplementLayoutBulkFormData,
    @UserId() userId: string,
  ) {
    return {
      success: true,
      message: 'Arte adicionada aos implementos (rascunho)',
      data: await this.implementLayoutService.bulk(data.implementIds, data.fileId, userId),
    };
  }

  @Get()
  @Roles(...IMPLEMENT_READ_ROLES)
  async findAll(
    @Query(new ZodQueryValidationPipe(implementGetManySchema, IMPLEMENT_QUERY_SHAPE))
    query: ImplementGetManyFormData,
    @User() user: UserPayload,
  ) {
    const { data, total } = await this.implementService.findAll(query);
    for (const row of data as any[]) onlyApprovedArtUnlessAllowed(row, user?.role);
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
    @User() user: UserPayload,
  ) {
    const implement = await this.implementService.findById(id, query.include);
    if (!implement) throw new NotFoundException('Implemento não encontrado');
    onlyApprovedArtUnlessAllowed(implement, user?.role);
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

  /** O projeto do implemento: `fileIds` (a lista que fica) + multipart `implementProjectFiles`. */
  @Put(':id/project-files')
  @Roles(...IMPLEMENT_PROJECT_ROLES)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'implementProjectFiles', maxCount: 30 }], multerConfig),
  )
  async setProjectFiles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(implementProjectFilesSchema))
    data: ImplementProjectFilesFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: { implementProjectFiles?: Express.Multer.File[] },
  ) {
    return {
      success: true,
      message: 'Projeto do implemento atualizado com sucesso',
      data: await this.implementService.setProjectFiles(
        id,
        data.fileIds,
        files?.implementProjectFiles ?? [],
        userId,
      ),
    };
  }

  // ─── A ARTE DO IMPLEMENTO ───────────────────────────────────────────────

  @Get(':id/layouts')
  @Roles(...IMPLEMENT_ART_READ_ROLES)
  async listLayouts(@Param('id', ParseUUIDPipe) id: string, @User() user: UserPayload) {
    return {
      success: true,
      message: 'Arte do implemento carregada',
      data: await this.implementLayoutService.list(id, SEES_ALL_ART.has(user?.role)),
    };
  }

  /** Sobe arte nova (multipart `files`, só imagem): nasce rascunho. */
  @Post(':id/layouts')
  @Roles(...IMPLEMENT_ART_EDIT_ROLES)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'files', maxCount: 10 }], multerConfig))
  async uploadLayouts(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
    @UploadedFiles() files?: { files?: Express.Multer.File[] },
  ) {
    return {
      success: true,
      message: 'Arte enviada (rascunho)',
      data: await this.implementLayoutService.upload(id, files?.files ?? [], userId),
    };
  }

  @Post(':id/layouts/:layoutId/send')
  @Roles(...IMPLEMENT_ART_EDIT_ROLES)
  @HttpCode(HttpStatus.OK)
  async sendLayout(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('layoutId', ParseUUIDPipe) layoutId: string,
    @UserId() userId: string,
  ) {
    return {
      success: true,
      message: 'Arte enviada ao cliente para aprovação',
      data: await this.implementLayoutService.send(id, layoutId, userId),
    };
  }

  @Post(':id/layouts/:layoutId/approve-on-behalf')
  @Roles(...IMPLEMENT_ART_DECIDE_ROLES)
  @HttpCode(HttpStatus.OK)
  async approveLayoutOnBehalf(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('layoutId', ParseUUIDPipe) layoutId: string,
    @Body(new ZodValidationPipe(implementLayoutApproveOnBehalfSchema))
    data: ImplementLayoutApproveOnBehalfFormData,
    @UserId() userId: string,
  ) {
    return {
      success: true,
      message: 'Arte aprovada em nome do cliente',
      data: await this.implementLayoutService.approveOnBehalf(id, layoutId, data.note, userId),
    };
  }

  @Post(':id/layouts/:layoutId/reprove')
  @Roles(...IMPLEMENT_ART_DECIDE_ROLES)
  @HttpCode(HttpStatus.OK)
  async reproveLayout(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('layoutId', ParseUUIDPipe) layoutId: string,
    @Body(new ZodValidationPipe(implementLayoutReproveSchema)) data: ImplementLayoutReproveFormData,
    @UserId() userId: string,
  ) {
    return {
      success: true,
      message: 'Arte reprovada',
      data: await this.implementLayoutService.reprove(id, layoutId, data.note, userId),
    };
  }

  /** Versão nova de uma arte (multipart `files`, uma imagem): rascunho com `supersedesId`. */
  @Post(':id/layouts/:layoutId/new-version')
  @Roles(...IMPLEMENT_ART_EDIT_ROLES)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'files', maxCount: 1 }], multerConfig))
  async newLayoutVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('layoutId', ParseUUIDPipe) layoutId: string,
    @UserId() userId: string,
    @UploadedFiles() files?: { files?: Express.Multer.File[] },
  ) {
    return {
      success: true,
      message: 'Versão nova da arte enviada (rascunho)',
      data: await this.implementLayoutService.newVersion(id, layoutId, files?.files ?? [], userId),
    };
  }

  /** Só rascunho. */
  @Delete(':id/layouts/:layoutId')
  @Roles(...IMPLEMENT_ART_EDIT_ROLES)
  async deleteLayout(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('layoutId', ParseUUIDPipe) layoutId: string,
    @UserId() userId: string,
  ) {
    return {
      success: true,
      message: 'Arte em rascunho apagada',
      data: await this.implementLayoutService.remove(id, layoutId, userId),
    };
  }
}
