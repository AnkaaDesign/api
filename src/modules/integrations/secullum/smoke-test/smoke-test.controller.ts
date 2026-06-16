import { Controller, Get, Post, Query, Param, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { SecullumSmokeTestService } from './smoke-test.service';
import { SecullumSmokeTestScheduler } from './smoke-test.scheduler';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ReadRateLimit } from '@modules/common/throttler/throttler.decorators';
import { SECTOR_PRIVILEGES } from '../../../../constants/enums';

/**
 * Secullum integration health-check ("Diagnóstico"). ADMIN-only.
 *   POST /integrations/secullum/smoke-test/run        — trigger a run now
 *   GET  /integrations/secullum/smoke-test/runs        — recent runs + checks
 *   GET  /integrations/secullum/smoke-test/runs/latest — most recent run
 */
@Controller('integrations/secullum/smoke-test')
export class SecullumSmokeTestController {
  private readonly logger = new Logger(SecullumSmokeTestController.name);

  constructor(
    private readonly service: SecullumSmokeTestService,
    private readonly scheduler: SecullumSmokeTestScheduler,
    private readonly prisma: PrismaService,
  ) {}

  @Post('run')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async runNow(@UserId() userId: string, @Query('apuracao') apuracao?: string) {
    // The fechamento/apuração checks create signed/rejected apurações that cannot
    // be deleted, so they are OFF by default even for manual runs — opt in with
    // ?apuracao=true to validate the full close-of-month flow.
    const includeApuracao = apuracao === 'true' || apuracao === '1';
    this.logger.log(`User ${userId} triggered a manual Secullum smoke test (apuracao=${includeApuracao})`);
    const { runId } = await this.scheduler.triggerManualRun(userId ?? null, includeApuracao);
    const run = await this.prisma.secullumSmokeTestRun.findUnique({
      where: { id: runId },
      include: { checks: { orderBy: { order: 'asc' } } },
    });
    return { success: true, data: run };
  }

  @Get('runs')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getRuns(@Query('take') take?: string) {
    const takeN = Math.min(Math.max(parseInt(take ?? '10', 10) || 10, 1), 50);
    const data = await this.prisma.secullumSmokeTestRun.findMany({
      orderBy: { ranAt: 'desc' },
      take: takeN,
      include: { checks: { orderBy: { order: 'asc' } } },
    });
    return { success: true, data };
  }

  @Get('runs/latest')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getLatest() {
    const data = await this.prisma.secullumSmokeTestRun.findFirst({
      orderBy: { ranAt: 'desc' },
      include: { checks: { orderBy: { order: 'asc' } } },
    });
    return { success: true, data };
  }

  @Get('runs/:id')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getRun(@Param('id') id: string) {
    const data = await this.prisma.secullumSmokeTestRun.findUnique({
      where: { id },
      include: { checks: { orderBy: { order: 'asc' } } },
    });
    return { success: true, data };
  }
}
