import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';

import { Roles } from '@modules/common/auth/decorators/roles.decorator';

import { LayoutDimensionsService } from './layout-dimensions.service';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';

/**
 * O cotador do layout, servido pronto.
 *
 * Duas rotas porque são dois pesos e dois usos. `/:fileId` devolve o plano de
 * cotas — dezenas de KB, e é o que todo mundo abre. `/:fileId/snap` devolve as
 * retas do desenho para o ímã da régua — centenas de KB a alguns MB, e só quem
 * vai medir na mão precisa. Juntar as duas cobraria o pedaço grande de todo
 * mundo para servir a minoria que pega a régua.
 *
 * Quem vê o layout vê a cota: a autorização é a mesma de LAYOUT REFERÊNCIA na
 * tarefa. O cotador não revela nada que o desenho já não mostre — ele só põe
 * número no que está à vista.
 */
@Controller('layout-dimensions')
export class LayoutDimensionsController {
  constructor(private readonly service: LayoutDimensionsService) {}

  // `/:fileId/snap` vem ANTES de `/:fileId`: o Nest casa na ordem de registro,
  // e a rota genérica registrada primeiro já sombreou irmã de mesmo prefixo
  // neste projeto. Duas rotas, duas contagens de segmento — mas a ordem custa
  // nada e o defeito custa uma tarde.

  @Get(':fileId/snap')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.COMMERCIAL,
  )
  async snap(
    @Param('fileId') fileId: string,
    @Query('page') page?: string,
    @Query('rotation') rotation?: string,
  ) {
    const data = await this.service.snapSegments(fileId, {
      pageNumber: toInt(page, 1),
      rotation: toInt(rotation, 0),
    });
    return { success: true, message: 'Geometria da régua carregada com sucesso', data };
  }

  @Get(':fileId')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.COMMERCIAL,
  )
  async dimensions(
    @Param('fileId') fileId: string,
    @Query('truckId') truckId?: string,
    @Query('page') page?: string,
    @Query('rotation') rotation?: string,
  ) {
    if (!truckId) {
      throw new BadRequestException('Informe o caminhão: sem as medidas não há o que cotar.');
    }
    const data = await this.service.dimensions(fileId, {
      truckId,
      pageNumber: toInt(page, 1),
      rotation: toInt(rotation, 0),
    });
    return { success: true, message: 'Cotas do layout calculadas com sucesso', data };
  }
}

function toInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
