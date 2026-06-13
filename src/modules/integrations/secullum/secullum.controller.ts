import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
  HttpException,
  StreamableFile,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { SecullumService } from './secullum.service';
import {
  UserSecullumSyncService,
  SecullumBackfillResult,
} from './user-secullum-sync.service';
import { UserService } from '@modules/people/user/user.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  SecullumTimeEntriesResponse,
  SecullumUpdateTimeEntryRequest,
  SecullumCalculationsResponse,
  SecullumPendenciasResponse,
  SecullumHolidaysResponse,
  SecullumCreateHolidayRequest,
  SecullumCreateHolidayResponse,
  SecullumDeleteHolidayResponse,
  SecullumSyncUserRequest,
  SecullumSyncUserResponse,
  SecullumHealthResponse,
  SecullumAuthStatusResponse,
  SecullumRequestsResponse,
  SecullumRequestActionResponse,
  SecullumApproveRequestPayload,
  SecullumRejectRequestPayload,
  SecullumHorariosResponse,
  SecullumJustificationsResponse,
  SecullumAbsencesResponse,
  SecullumCreateAbsenceRequest,
  SecullumCreateAbsenceResponse,
  SecullumDeleteAbsenceResponse,
  SecullumAggregatedAbsencesResponse,
  SecullumCreateAbsenceForUsersRequest,
  SecullumCreateAbsenceForUsersResponse,
  SecullumAssinaturaListResponse,
  SecullumAssinaturaDetailResponse,
  SecullumCreateAssinaturaForUsersRequest,
  SecullumCreateAssinaturaForUsersResponse,
  SecullumDeleteAssinaturaResponse,
  SecullumAbsenceDaysResponse,
} from './dto';

@Controller('integrations/secullum')
@UseGuards(AuthGuard)
export class SecullumController {
  private readonly logger = new Logger(SecullumController.name);

  constructor(
    private readonly secullumService: SecullumService,
    private readonly userService: UserService,
    private readonly userSecullumSyncService: UserSecullumSyncService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Resolve an Ankaa userId to its persisted `User.secullumEmployeeId`.
   * Returns the FK as a string (Secullum URLs accept numeric IDs as strings),
   * `null` if the user exists but isn't linked, or `found:false` if the user
   * doesn't exist. Linking-flow endpoints (`checkUserMapping` /
   * `backfillEmployeeIds`) use CPF/PIS/payroll instead.
   */
  private async resolveSecullumEmployeeId(
    targetUserId: string,
  ): Promise<{ found: boolean; employeeId: string | null; userName?: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, secullumEmployeeId: true },
    });
    if (!user) return { found: false, employeeId: null };
    return {
      found: true,
      employeeId: user.secullumEmployeeId
        ? user.secullumEmployeeId.toString()
        : null,
      userName: user.name,
    };
  }

  /**
   * Get time entries from Secullum
   * GET /integrations/secullum/time-entries
   */
  @Get('time-entries')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getTimeEntries(
    @UserId() userId: string,
    @Query('userId') targetUserId?: string, // Changed from employeeId to userId for clarity
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<SecullumTimeEntriesResponse> {
    this.logger.log(`User ${userId} fetching time entries from Secullum`);

    if (targetUserId) {
      const resolved = await this.resolveSecullumEmployeeId(targetUserId);

      if (!resolved.found) {
        this.logger.error(`User not found in Ankaa system: ${targetUserId}`);
        return {
          success: false,
          message: `User not found: ${targetUserId}`,
          data: [],
        };
      }

      if (!resolved.employeeId) {
        this.logger.warn(
          `User ${targetUserId} (${resolved.userName}) has no secullumEmployeeId — needs linking via /backfill-employee-ids`,
        );
        return {
          success: false,
          message: 'usuário ainda não foi vinculado ao Secullum',
          data: [],
        };
      }

      return await this.secullumService.getTimeEntries({
        employeeId: resolved.employeeId,
        startDate,
        endDate,
      });
    }

    // If no specific user, return all entries (for HR overview)
    const params = {
      startDate,
      endDate,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    };

    // Remove undefined values
    const cleanParams = Object.fromEntries(
      Object.entries(params).filter(([_, value]) => value !== undefined),
    );

    return await this.secullumService.getTimeEntries(cleanParams);
  }

  /**
   * Get time entries for a single day across all active employees.
   * Used by the "Visualização Dia" mode of Controle de Ponto.
   * Server-side fan-out reuses the per-employee/per-day Redis cache populated
   * by /time-entries.
   * GET /integrations/secullum/time-entries/by-day?date=YYYY-MM-DD
   */
  @Get('time-entries/by-day')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  @HttpCode(HttpStatus.OK)
  async getTimeEntriesByDay(
    @UserId() userId: string,
    @Query('date') date?: string,
  ): Promise<{ success: boolean; message: string; data: any[] }> {
    this.logger.log(`User ${userId} fetching by-day time entries date=${date}`);
    if (!date) {
      return { success: false, message: 'date query parameter is required', data: [] };
    }

    // findMany defaults to a paginated page; the day view needs every active
    // user. Pass take=1000 (effectively the active workforce ceiling). Sector
    // is a direct relation on User — Position has no `sector` include in this
    // schema, so include it at the User level.
    //
    // Filter to users with `secullumEmployeeId` set: dropping unlinked users
    // here means the per-employee fan-out in `getTimeEntriesByDay` skips
    // pointless lookups for users that don't exist in Secullum at all.
    // The companion backfill endpoint (`POST /backfill-employee-ids`) keeps
    // this set populated.
    const usersResponse = await this.userService.findMany({
      where: {
        status: { in: ['EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2', 'EFFECTED'] },
        secullumEmployeeId: { not: null },
      },
      include: { sector: true },
      orderBy: { name: 'asc' },
      take: 1000,
    } as any);
    const activeUsers: any[] = ((usersResponse as any)?.data as any[]) || [];

    return this.secullumService.getTimeEntriesByDay(date, activeUsers);
  }

  /**
   * Today's attendance summary (resumoDiario) — powers the "Ponto do Dia"
   * dashboard widget on web + mobile. Returns counts grouped by category
   * (Presentes / Atrasos / Faltas / Em Horário, etc.).
   *
   * The widget consumes `response.data.resumoDiario.Dados[]`, so the
   * service-layer payload must always contain `resumoDiario.Dados[]` even
   * when the upstream Secullum endpoint is unavailable (the service returns
   * an empty payload in that case rather than 404'ing the widget).
   *
   * GET /integrations/secullum/attendance/daily-summary
   */
  @Get('attendance/daily-summary')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  @HttpCode(HttpStatus.OK)
  async getDailySummary(@UserId() userId: string): Promise<{
    success: boolean;
    message?: string;
    data: {
      resumoDiario: {
        Funcionarios: Array<{
          Id: number;
          Nome: string;
          NumeroFolha?: string;
          Celular?: string;
        }>;
        Dados: Array<{
          Titulo: string;
          FuncionariosIds: number[];
          Atual: number;
          Total: number;
          ExibirProgressBar: boolean;
          Tipo?: number;
        }>;
      };
    };
  }> {
    this.logger.log(`User ${userId} fetching Secullum daily attendance summary`);
    return await this.secullumService.getDailySummary();
  }

  /**
   * Update a time entry in Secullum
   * PUT /integrations/secullum/time-entries/:id
   */
  @Put('time-entries/:id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async updateTimeEntry(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() data: SecullumUpdateTimeEntryRequest,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`User ${userId} updating time entry ${id} in Secullum`);

    return await this.secullumService.updateTimeEntry(id, data);
  }

  /**
   * Fetch the list of justification codes for the time-card cell dropdown.
   * GET /integrations/secullum/justifications
   */
  @Get('justifications')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getJustifications(@UserId() userId: string): Promise<SecullumJustificationsResponse> {
    this.logger.log(`User ${userId} fetching Secullum justifications`);
    return await this.secullumService.getJustifications();
  }

  /**
   * Fetch the photo of a specific time-entry punch.
   * GET /integrations/secullum/batidas/foto/:employeeId/:fonteDadosId
   *
   * employeeId is the Secullum FuncionarioId (numeric).
   * fonteDadosId is the per-time-slot ID from FonteDados<Field>.Geolocalizacao.FonteDadosId.
   */
  @Get('batidas/foto/:employeeId/:fonteDadosId')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getTimeEntryPhoto(
    @UserId() userId: string,
    @Param('employeeId') employeeId: string,
    @Param('fonteDadosId') fonteDadosId: string,
  ): Promise<{ success: boolean; message: string; data?: { FotoBatida: string }; error?: string }> {
    this.logger.log(
      `User ${userId} fetching time-entry photo employee=${employeeId} fonteDadosId=${fonteDadosId}`,
    );
    return await this.secullumService.getTimeEntryPhoto(
      parseInt(employeeId, 10),
      parseInt(fonteDadosId, 10),
    );
  }

  /**
   * Fetch the photo attached to an Employee Center Request (e.g. medical
   * certificate uploaded with a Justify Absence request).
   * GET /integrations/secullum/solicitacoes/foto/:solicitacaoId
   */
  @Get('solicitacoes/foto/:solicitacaoId')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getRequestAttachmentPhoto(
    @UserId() userId: string,
    @Param('solicitacaoId') solicitacaoId: string,
  ): Promise<{ success: boolean; message: string; data?: { Foto: string }; error?: string }> {
    this.logger.log(
      `User ${userId} fetching request attachment photo solicitacao=${solicitacaoId}`,
    );
    return await this.secullumService.getRequestAttachmentPhoto(parseInt(solicitacaoId, 10));
  }

  /**
   * Batch update time entries in Secullum
   * POST /integrations/secullum/time-entries/batch-update
   */
  @Post('time-entries/batch-update')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async batchUpdateTimeEntries(
    @UserId() userId: string,
    @Body() data: { entries: any[] },
  ): Promise<{ success: boolean; message: string; updated: number }> {
    this.logger.log(
      `User ${userId} batch updating ${data.entries?.length || 0} time entries in Secullum`,
    );

    return await this.secullumService.batchUpdateTimeEntries(data.entries);
  }

  /**
   * Get payroll calculations from Secullum
   * GET /integrations/secullum/calculations
   */
  @Get('calculations')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  @HttpCode(HttpStatus.OK)
  async getCalculations(
    @UserId() userId: string,
    @Query('userId') targetUserId?: string, // Changed to be consistent with time-entries
    @Query('period') period?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<SecullumCalculationsResponse> {
    this.logger.log(`User ${userId} fetching calculations from Secullum`);

    if (targetUserId) {
      const resolved = await this.resolveSecullumEmployeeId(targetUserId);

      if (!resolved.found) {
        this.logger.error(`User not found in Ankaa system: ${targetUserId}`);
        return {
          success: false,
          message: `User not found: ${targetUserId}`,
        };
      }

      if (!resolved.employeeId) {
        this.logger.warn(
          `User ${targetUserId} (${resolved.userName}) has no secullumEmployeeId — needs linking via /backfill-employee-ids`,
        );
        return {
          success: false,
          message: 'usuário ainda não foi vinculado ao Secullum',
        };
      }

      return await this.secullumService.getCalculations({
        employeeId: resolved.employeeId,
        period,
        startDate,
        endDate,
      });
    }

    // If no specific user is requested, calculations endpoint requires an employeeId
    // So we cannot fetch all calculations at once
    return {
      success: false,
      message: 'User ID is required to fetch calculations. Please specify a userId parameter.',
    };
  }

  /**
   * Get pendências (pending issues) from Secullum.
   * GET /integrations/secullum/pendencias
   *
   * Query params (`userCpf`, `employeeId`, `type`, `status`, `priority`) are
   * accepted but NOT forwarded — Secullum has no filter support; filtering is
   * done client-side. A user-scoped variant should resolve via
   * `resolveSecullumEmployeeId`, not CPF.
   */
  @Get('pendencias')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getPendencias(
    @UserId() userId: string,
    @Query('userCpf') userCpf?: string,
    @Query('employeeId') employeeId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
  ): Promise<SecullumPendenciasResponse> {
    this.logger.log(`User ${userId} fetching pendências from Secullum with CPF filter: ${userCpf}`);

    // The Secullum API doesn't support filters, so we just fetch all
    // and let the frontend filter if needed
    return await this.secullumService.getPendencias();
  }

  /**
   * Get holidays from Secullum
   * GET /integrations/secullum/holidays
   */
  @Get('holidays')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.BASIC,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  ) // All authenticated users can see holidays
  @HttpCode(HttpStatus.OK)
  async getHolidays(
    @UserId() userId: string,
    @Query('year') year?: string,
    @Query('type') type?: string,
    @Query('isActive') isActive?: string,
  ): Promise<SecullumHolidaysResponse> {
    this.logger.log(`User ${userId} fetching holidays from Secullum`);

    const params = {
      year: year ? parseInt(year, 10) : undefined,
      type,
      isActive: isActive ? isActive === 'true' : undefined,
    };

    // Remove undefined values
    const cleanParams = Object.fromEntries(
      Object.entries(params).filter(([_, value]) => value !== undefined),
    );

    return await this.secullumService.getHolidays(cleanParams);
  }

  /**
   * Create a new holiday in Secullum
   * POST /integrations/secullum/holidays
   */
  @Post('holidays')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.CREATED)
  async createHoliday(
    @UserId() userId: string,
    @Body() holidayData: SecullumCreateHolidayRequest,
  ): Promise<SecullumCreateHolidayResponse> {
    this.logger.log(`User ${userId} creating holiday in Secullum`);

    return await this.secullumService.createHoliday(holidayData);
  }

  /**
   * Delete a holiday in Secullum
   * DELETE /integrations/secullum/holidays/:id
   */
  @Delete('holidays/:id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async deleteHoliday(
    @UserId() userId: string,
    @Param('id') holidayId: string,
  ): Promise<SecullumDeleteHolidayResponse> {
    this.logger.log(`User ${userId} deleting holiday ${holidayId} in Secullum`);

    return await this.secullumService.deleteHoliday(holidayId);
  }

  /**
   * Per-day absence rows derived from /Calculos + /FuncionariosAfastamentos.
   * Returns one row per calendar day per user: days with Faltas > 0 (including
   * partial days where the employee clocked some time) cross-referenced with
   * afastamento records for the justificativa. Days covered by an afastamento
   * but with Faltas=0 (e.g. Férias with Abono) are also included.
   * GET /integrations/secullum/absence-days?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
   *
   * NOTE: must be declared before any dynamic-param absence routes.
   */
  @Get('absence-days')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  @HttpCode(HttpStatus.OK)
  async getAbsenceDays(
    @UserId() userId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('sectorId') sectorId?: string,
  ): Promise<SecullumAbsenceDaysResponse> {
    this.logger.log(
      `User ${userId} fetching absence days ${startDate}..${endDate} sector=${sectorId ?? 'ALL'}`,
    );
    return await this.secullumService.getAbsenceDays({ startDate, endDate, sectorId });
  }

  /**
   * Unjustified absences derived from /Calculos (Cálculos de Ponto) —
   * scheduled workdays where Faltas > 00:00 with no Abono/Ajuste applied.
   * Returned in the same shape as /absences so the frontend can merge both
   * lists.
   * GET /integrations/secullum/absences/unjustified
   *
   * NOTE: this route MUST be declared before `absences/:funcionarioId` —
   * NestJS matches in declaration order, so the dynamic `:funcionarioId`
   * route would otherwise swallow the literal "unjustified" segment.
   */
  @Get('absences/unjustified')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  @HttpCode(HttpStatus.OK)
  async getUnjustifiedAbsences(
    @UserId() userId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('sectorId') sectorId?: string,
  ): Promise<SecullumAggregatedAbsencesResponse> {
    this.logger.log(
      `User ${userId} fetching unjustified absences ${startDate}..${endDate} sector=${sectorId ?? 'ALL'}`,
    );
    return await this.secullumService.getUnjustifiedAbsences({ startDate, endDate, sectorId });
  }

  /**
   * List absences (afastamentos) for a single employee.
   * GET /integrations/secullum/absences/:funcionarioId
   */
  @Get('absences/:funcionarioId')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  @HttpCode(HttpStatus.OK)
  async getAbsencesByEmployee(
    @UserId() userId: string,
    @Param('funcionarioId') funcionarioIdParam: string,
  ): Promise<SecullumAbsencesResponse> {
    const funcionarioId = parseInt(funcionarioIdParam, 10);
    this.logger.log(
      `User ${userId} fetching absences for funcionarioId=${funcionarioId}`,
    );
    return await this.secullumService.getAbsencesByEmployee(funcionarioId);
  }

  /**
   * Aggregated absences across all linked employees within a date window.
   * Used by the HR calendar.
   * GET /integrations/secullum/absences?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&sectorId=
   */
  @Get('absences')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  @HttpCode(HttpStatus.OK)
  async getAggregatedAbsences(
    @UserId() userId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('sectorId') sectorId?: string,
  ): Promise<SecullumAggregatedAbsencesResponse> {
    this.logger.log(
      `User ${userId} aggregating absences ${startDate}..${endDate} sector=${sectorId ?? 'ALL'}`,
    );
    return await this.secullumService.getAggregatedAbsences({
      startDate,
      endDate,
      sectorId,
    });
  }

  /**
   * Create an absence in Secullum. Used by single-employee + collective-vacation flows.
   * POST /integrations/secullum/absences
   */
  @Post('absences')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.CREATED)
  async createAbsence(
    @UserId() userId: string,
    @Body() body: SecullumCreateAbsenceRequest,
  ): Promise<SecullumCreateAbsenceResponse> {
    this.logger.log(
      `User ${userId} creating absence funcionarioId=${body.FuncionarioId}`,
    );
    return await this.secullumService.createAbsence(body);
  }

  /**
   * Create absences for a list of internal userIds (or all active linked users
   * when applyToAll=true). Server resolves userId → secullumEmployeeId so the
   * frontend never needs to know the Secullum ID.
   * POST /integrations/secullum/absences/by-users
   */
  @Post('absences/by-users')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.CREATED)
  async createAbsenceForUsers(
    @UserId() userId: string,
    @Body() body: SecullumCreateAbsenceForUsersRequest,
  ): Promise<SecullumCreateAbsenceForUsersResponse> {
    this.logger.log(
      `User ${userId} creating absence for ${body.applyToAll ? 'ALL' : (body.userIds?.length ?? 0)} user(s)`,
    );
    return await this.secullumService.createAbsenceForUsers(body);
  }

  /**
   * Delete an absence in Secullum.
   * DELETE /integrations/secullum/absences/:id
   */
  @Delete('absences/:id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async deleteAbsence(
    @UserId() userId: string,
    @Param('id') absenceId: string,
  ): Promise<SecullumDeleteAbsenceResponse> {
    this.logger.log(`User ${userId} deleting absence ${absenceId}`);
    return await this.secullumService.deleteAbsence(absenceId);
  }

  /**
   * Update an absence by deleting + recreating (Secullum has no PUT).
   * Body must include the original payload for rollback purposes.
   * PUT /integrations/secullum/absences/:id
   */
  @Put('absences/:id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async updateAbsence(
    @UserId() userId: string,
    @Param('id') absenceId: string,
    @Body()
    body: {
      original: {
        Inicio: string;
        Fim: string;
        JustificativaId: number;
        Motivo?: string;
        FuncionarioId: number;
      };
      next: SecullumCreateAbsenceRequest;
    },
  ): Promise<SecullumCreateAbsenceResponse> {
    this.logger.log(`User ${userId} updating absence ${absenceId}`);
    return await this.secullumService.updateAbsence(
      absenceId,
      {
        Id: parseInt(absenceId, 10),
        Inicio: body.original.Inicio,
        Fim: body.original.Fim,
        JustificativaId: body.original.JustificativaId,
        Motivo: body.original.Motivo,
        FuncionarioId: body.original.FuncionarioId,
      },
      body.next,
    );
  }

  /**
   * Get schedules (horarios) from Secullum
   * GET /integrations/secullum/horarios
   */
  @Get('horarios')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  @HttpCode(HttpStatus.OK)
  async getHorarios(
    @UserId() userId: string,
    @Query('incluirDesativados') incluirDesativados?: string,
  ): Promise<SecullumHorariosResponse> {
    this.logger.log(`User ${userId} fetching schedules from Secullum`);

    return await this.secullumService.getHorarios({
      incluirDesativados: incluirDesativados !== 'false',
    });
  }

  /**
   * Get a single schedule (horario) by ID from Secullum
   * GET /integrations/secullum/horarios/:id
   */
  @Get('horarios/:id')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  @HttpCode(HttpStatus.OK)
  async getHorarioById(
    @UserId() userId: string,
    @Param('id') id: string,
  ): Promise<{ success: boolean; message: string; data?: any }> {
    this.logger.log(`User ${userId} fetching schedule ${id} from Secullum`);

    const horarioId = parseInt(id, 10);
    if (isNaN(horarioId)) {
      return {
        success: false,
        message: 'Invalid schedule ID',
        data: undefined,
      };
    }

    return await this.secullumService.getHorarioById(horarioId);
  }

  /**
   * Sync user data with Secullum
   * POST /integrations/secullum/sync-user
   */
  @Post('sync-user')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async syncUser(
    @UserId() userId: string,
    @Body() userData: SecullumSyncUserRequest,
  ): Promise<SecullumSyncUserResponse> {
    this.logger.log(`User ${userId} syncing user data with Secullum`);

    return await this.secullumService.syncUser(userData);
  }

  /**
   * Get authentication status with Secullum
   * GET /integrations/secullum/auth/status
   */
  @Get('auth/status')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getAuthStatus(@UserId() userId: string): Promise<SecullumAuthStatusResponse> {
    this.logger.log(`User ${userId} checking Secullum auth status`);

    return await this.secullumService.getAuthStatus();
  }

  /**
   * Get health status of Secullum API
   * GET /integrations/secullum/health
   */
  @Get('health')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getHealth(@UserId() userId: string): Promise<SecullumHealthResponse> {
    this.logger.log(`User ${userId} checking Secullum health`);

    return await this.secullumService.getHealth();
  }

  /**
   * Force refresh authentication token (useful for testing)
   * POST /integrations/secullum/auth/refresh
   */
  @Post('auth/refresh')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async refreshToken(@UserId() userId: string): Promise<{ success: boolean; message: string }> {
    this.logger.log(`User ${userId} forcing Secullum token refresh`);

    await this.secullumService.refreshToken();

    return {
      success: true,
      message: 'Token refreshed successfully',
    };
  }

  /**
   * Get Secullum configuration (date ranges, etc)
   * GET /integrations/secullum/configuration
   */
  @Get('configuration')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getConfiguration(@UserId() userId: string): Promise<any> {
    this.logger.log(`User ${userId} fetching Secullum configuration`);
    return await this.secullumService.getConfiguration();
  }

  /**
   * Get all Secullum employees
   * GET /integrations/secullum/employees
   */
  @Get('employees')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getEmployees(@UserId() userId: string): Promise<any> {
    this.logger.log(`User ${userId} fetching Secullum employees`);
    return await this.secullumService.getEmployees();
  }

  /**
   * LINKING ENDPOINT — diagnostic dry-run for the Ankaa↔Secullum link.
   * Matches by CPF / PIS / NumeroFolha to discover what FK *would* be set.
   * No persistence — `backfillEmployeeIds` is the writing counterpart.
   * Runtime endpoints use the persisted FK instead.
   */
  @Get('check-user-mapping')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async checkUserMapping(@UserId() userId: string): Promise<any> {
    this.logger.log(`User ${userId} checking user mappings with Secullum`);

    try {
      // Get all Secullum employees
      const secullumEmployees = await this.secullumService.getEmployees();

      if (!secullumEmployees.success || !Array.isArray(secullumEmployees.data)) {
        return {
          success: false,
          message: 'Failed to fetch Secullum employees',
        };
      }

      // Get all our users
      const ourUsersResponse = await this.userService.findMany({});

      if (!ourUsersResponse.success || !ourUsersResponse.data) {
        return {
          success: false,
          message: 'Failed to fetch users from our system',
        };
      }

      const ourUsers = ourUsersResponse.data;

      const mappingResults = {
        matched: [] as any[],
        unmatched: [] as any[],
      };

      // Normalize CPF for comparison
      const normalizeCpf = (cpf: string): string => {
        return cpf ? cpf.replace(/[.-]/g, '') : '';
      };

      for (const user of ourUsers) {
        const userCpf = user.cpf ? normalizeCpf(user.cpf) : '';
        const userPis = user.pis || '';
        const userPayrollNumber = user.payrollNumber?.toString() || '';

        // Find matching Secullum employee
        const matchingEmployee = secullumEmployees.data.find((emp: any) => {
          const empCpf = normalizeCpf(emp.Cpf || '');
          const empPis = emp.NumeroPis || '';
          const empPayrollNumber = emp.NumeroFolha || '';

          return (
            (userCpf && empCpf === userCpf) ||
            (userPis && empPis === userPis) ||
            (userPayrollNumber && empPayrollNumber === userPayrollNumber)
          );
        });

        if (matchingEmployee) {
          mappingResults.matched.push({
            userId: user.id,
            userName: user.name,
            secullumId: matchingEmployee.Id,
            secullumName: matchingEmployee.Nome,
            matchedBy: userCpf ? 'CPF' : userPis ? 'PIS' : 'PayrollNumber',
          });
        } else {
          mappingResults.unmatched.push({
            userId: user.id,
            userName: user.name,
            cpf: user.cpf,
            pis: user.pis,
            payrollNumber: user.payrollNumber,
          });
        }
      }

      return {
        success: true,
        summary: {
          totalUsers: ourUsers.length,
          totalSecullumEmployees: secullumEmployees.data.length,
          matched: mappingResults.matched.length,
          unmatched: mappingResults.unmatched.length,
        },
        details: mappingResults,
      };
    } catch (error) {
      this.logger.error('Error checking user mapping', error);
      return {
        success: false,
        message: 'Failed to check user mapping',
        error: error.message,
      };
    }
  }

  /**
   * LINKING ENDPOINT — persists `user.secullumEmployeeId` for every Ankaa user
   * that matches a Secullum employee by CPF / PIS / payrollNumber. Idempotent;
   * conflicts are logged not overwritten. Includes dismissed users.
   * POST /integrations/secullum/backfill-employee-ids
   */
  @Post('backfill-employee-ids')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async backfillEmployeeIds(
    @UserId() userId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: SecullumBackfillResult;
  }> {
    this.logger.log(
      `User ${userId} triggering Secullum employee-id backfill`,
    );

    const summary = await this.userSecullumSyncService.backfillSecullumEmployeeIds();

    const message =
      `Backfill done: ${summary.newlyLinked} newly linked, ` +
      `${summary.alreadyLinked} already linked, ${summary.conflicts} conflicts, ` +
      `${summary.unmatched} unmatched (of ${summary.totalAnkaaUsers} Ankaa users vs ${summary.totalSecullumEmployees} Secullum employees).`;

    return {
      success: true,
      message,
      data: summary,
    };
  }

  /**
   * Get time adjustment requests from Secullum
   * GET /integrations/secullum/requests
   */
  @Get('requests')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getRequests(
    @UserId() userId: string,
    @Query('pending') pending?: string,
  ): Promise<SecullumRequestsResponse> {
    this.logger.log(
      `User ${userId} fetching Secullum time adjustment requests (pending: ${pending})`,
    );

    const pendingOnly = pending === 'true';
    return await this.secullumService.getRequests(pendingOnly);
  }

  /**
   * Approve a time adjustment request in Secullum
   * POST /integrations/secullum/requests/:id/approve
   */
  @Post('requests/:id/approve')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async approveRequest(
    @UserId() userId: string,
    @Param('id') requestId: string,
    @Body() requestData: SecullumApproveRequestPayload,
  ): Promise<SecullumRequestActionResponse> {
    this.logger.log(`User ${userId} approving Secullum request ID: ${requestId}`);

    // TipoSolicitacao on the wire mirrors the request's `Tipo` field.
    // Accept either alias from clients for forward-compat.
    const approvalData = {
      SolicitacaoId: parseInt(requestId, 10),
      Versao: requestData.Versao,
      AlteracoesFonteDados: requestData.AlteracoesFonteDados || [],
      TipoSolicitacao: requestData.TipoSolicitacao ?? requestData.Tipo ?? 0,
    };

    return await this.secullumService.approveRequest(approvalData);
  }

  /**
   * Reject a time adjustment request in Secullum
   * POST /integrations/secullum/requests/:id/reject
   */
  @Post('requests/:id/reject')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async rejectRequest(
    @UserId() userId: string,
    @Param('id') requestId: string,
    @Body() requestData: SecullumRejectRequestPayload,
  ): Promise<SecullumRequestActionResponse> {
    this.logger.log(`User ${userId} rejecting Secullum request ID: ${requestId}`);

    // Secullum's Descartar body uses "Motivo" (verified via HAR). We accept legacy
    // aliases (MotivoDescarte / observacoes) for backward compatibility.
    const rejectionData = {
      SolicitacaoId: parseInt(requestId, 10),
      Versao: requestData.Versao,
      Motivo:
        requestData.Motivo ||
        requestData.MotivoDescarte ||
        requestData.observacoes ||
        'Rejeitado via sistema Ankaa',
      TipoSolicitacao: requestData.TipoSolicitacao ?? requestData.Tipo ?? 0,
    };

    return await this.secullumService.rejectRequest(rejectionData);
  }

  /**
   * Electronic Signature of Time Card — start generating apurações for a list
   * of internal userIds (or every active linked user when applyToAll=true).
   * Generation drives Secullum's report WebSocket and can be slow, so this
   * returns a jobId immediately; poll progress via GET .../progress/:jobId.
   * POST /integrations/secullum/assinatura-digital
   */
  @Post('assinatura-digital')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  async createAssinaturaForUsers(
    @UserId() userId: string,
    @Body() body: SecullumCreateAssinaturaForUsersRequest,
  ): Promise<{ success: boolean; jobId: string }> {
    if (!body.applyToAll && !body.onlyRejected && (!body.userIds || body.userIds.length === 0)) {
      throw new HttpException(
        { success: false, message: 'Informe userIds, applyToAll=true ou onlyRejected=true.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    this.logger.log(
      `User ${userId} starting Secullum assinatura job for ${body.onlyRejected ? 'REJEITADOS' : body.applyToAll ? 'ALL' : (body.userIds?.length ?? 0)} user(s) ${body.DataInicio}..${body.DataFim}`,
    );
    const { jobId } = this.secullumService.startAssinaturaForUsers(body);
    return { success: true, jobId };
  }

  /**
   * Electronic Signature of Time Card — progress of a generation job.
   * GET /integrations/secullum/assinatura-digital/progress/:jobId
   */
  @Get('assinatura-digital/progress/:jobId')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getAssinaturaProgress(@Param('jobId') jobId: string) {
    const job = this.secullumService.getAssinaturaJob(jobId);
    if (!job) {
      throw new HttpException(
        { success: false, message: 'Job não encontrado ou expirado.' },
        HttpStatus.NOT_FOUND,
      );
    }
    return { success: true, data: job };
  }

  /**
   * Electronic Signature of Time Card — list of apurações (batches).
   * GET /integrations/secullum/assinatura-digital
   */
  @Get('assinatura-digital')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getAssinaturaList(
    @UserId() userId: string,
  ): Promise<SecullumAssinaturaListResponse> {
    this.logger.log(`User ${userId} fetching Secullum AssinaturaDigitalCartaoPonto list`);
    return this.secullumService.getAssinaturaList();
  }

  /**
   * Linked users eligible for signature: secullumEmployeeId set AND not dismissed
   * in Secullum (excludes /FuncionariosDemitidos — our DB may not have the
   * dismissal synced). Powers the "Nova Apuração" collaborator picker.
   * NOTE: declared BEFORE `assinatura-digital/:id` so it isn't captured by :id.
   * GET /integrations/secullum/assinatura-digital/eligible-users
   */
  @Get('assinatura-digital/eligible-users')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getAssinaturaEligibleUsers(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('take') take?: string,
  ) {
    return this.secullumService.getAssinaturaEligibleUsers({
      search,
      page: page ? Number(page) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  /**
   * Electronic Signature of Time Card — detail (signed items per employee).
   * GET /integrations/secullum/assinatura-digital/:id
   */
  @Get('assinatura-digital/:id')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getAssinaturaDetail(
    @UserId() userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SecullumAssinaturaDetailResponse> {
    this.logger.log(
      `User ${userId} fetching Secullum AssinaturaDigitalCartaoPonto detail id=${id}`,
    );
    return this.secullumService.getAssinaturaDetail(id);
  }

  /**
   * Electronic Signature of Time Card — per-employee signed PDF.
   * GET /integrations/secullum/assinatura-digital/:apuracaoId/funcionarios/:funcionarioId/pdf
   * Returns application/pdf as an attachment.
   *
   * NOTE: the URL segment is the Funcionario id (the column on the item row),
   * not the item row's own Id. Secullum keys the PDF by funcionarioId.
   */
  @Get('assinatura-digital/:apuracaoId/funcionarios/:funcionarioId/pdf')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.OK)
  async getAssinaturaItemPdf(
    @UserId() userId: string,
    @Param('apuracaoId', ParseIntPipe) apuracaoId: number,
    @Param('funcionarioId', ParseIntPipe) funcionarioId: number,
  ): Promise<StreamableFile> {
    this.logger.log(
      `User ${userId} downloading Secullum assinatura PDF apuracao=${apuracaoId} funcionario=${funcionarioId}`,
    );
    const { buffer, filename } = await this.secullumService.getAssinaturaItemPdf(
      apuracaoId,
      funcionarioId,
    );
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  /**
   * Electronic Signature of Time Card — bundle every employee's signed PDF,
   * across one or many apurações, into a single ZIP.
   * POST /integrations/secullum/assinatura-digital/download-zip
   * Body: { apuracaoIds: number[] }
   */
  @Post('assinatura-digital/download-zip')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async downloadAssinaturasZip(
    @UserId() userId: string,
    @Body() body: { apuracaoIds: number[]; status?: 'approved' | 'rejected' | 'both' },
  ): Promise<StreamableFile> {
    const ids = Array.isArray(body?.apuracaoIds)
      ? body.apuracaoIds.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [];
    const status: 'approved' | 'rejected' | 'both' =
      body?.status === 'rejected' || body?.status === 'both' ? body.status : 'approved';
    this.logger.log(
      `User ${userId} downloading Secullum assinatura ZIP (${status}) for apuracoes=[${ids.join(',')}]`,
    );
    const { buffer, filename } = await this.secullumService.downloadAssinaturasZip(ids, status);
    return new StreamableFile(buffer, {
      type: 'application/zip',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  /**
   * Electronic Signature of Time Card — delete an apuração (batch) entirely.
   * DELETE /integrations/secullum/assinatura-digital/:id
   */
  @Delete('assinatura-digital/:id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async deleteAssinatura(
    @UserId() userId: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SecullumDeleteAssinaturaResponse> {
    this.logger.log(`User ${userId} deleting Secullum assinatura apuracao=${id}`);
    return this.secullumService.deleteAssinatura(id);
  }
}
