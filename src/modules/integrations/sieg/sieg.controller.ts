import { Body, Controller, Get, Post, UsePipes } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReconciliationRunTrigger } from '@prisma/client';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '@constants';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { SiegFetchDto, siegFetchSchema } from './dto/sieg-fetch.dto';
import { SiegService } from './sieg.service';
import { SiegScheduler } from './sieg.scheduler';

@Controller('integrations/sieg')
export class SiegController {
  constructor(
    private readonly config: ConfigService,
    private readonly siegService: SiegService,
    private readonly scheduler: SiegScheduler,
  ) {}

  @Get('status')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  getStatus() {
    return {
      enabled: this.siegService.isEnabled(),
      companyCnpj: !!this.config.get<string>('COMPANY_CNPJ'),
    };
  }

  @Post('fetch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(siegFetchSchema))
  async fetch(@Body() body: SiegFetchDto) {
    const companyCnpj =
      body.cnpjEmit || body.cnpjDest || this.config.get<string>('COMPANY_CNPJ') || '';
    return this.scheduler.fetchRange(
      new Date(body.dateStart),
      new Date(body.dateEnd),
      companyCnpj,
      ReconciliationRunTrigger.MANUAL,
      undefined,
      body.xmlType,
      body.cnpjEmit,
      body.cnpjDest,
    );
  }
}
