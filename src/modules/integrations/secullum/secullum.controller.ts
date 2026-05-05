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
} from '@nestjs/common';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { SecullumService } from './secullum.service';
import { UserService } from '@modules/people/user/user.service';
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
} from './dto';

@Controller('integrations/secullum')
@UseGuards(AuthGuard)
export class SecullumController {
  private readonly logger = new Logger(SecullumController.name);

  constructor(
    private readonly secullumService: SecullumService,
    private readonly userService: UserService,
  ) {}

  /**
   * Get time entries from Secullum
   * GET /integrations/secullum/time-entries
   */
  @Get('time-entries')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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

    // If a specific user is requested, automatically map to Secullum
    if (targetUserId) {
      this.logger.log(`Starting user mapping process for targetUserId: ${targetUserId}`);

      const userResponse = await this.userService.findById(targetUserId, {});

      this.logger.log(`Raw user response: ${JSON.stringify(userResponse)}`);

      if (!userResponse?.data) {
        this.logger.error(`User not found in Ankaa system: ${targetUserId}`);
        return {
          success: false,
          message: `User not found: ${targetUserId}`,
          data: [],
        };
      }

      const user = userResponse.data;
      this.logger.log(`Found Ankaa user: ${user.name} (ID: ${user.id})`);
      this.logger.log(
        `User details - CPF: ${user.cpf}, PIS: ${user.pis}, PayrollNumber: ${user.payrollNumber}`,
      );

      // Find Secullum employee using CPF/PIS/PayrollNumber lookup
      this.logger.log(`Attempting to match user by CPF, PIS, and Payroll Number`);

      const secullumEmployee = await this.secullumService.findSecullumEmployee({
        cpf: user.cpf || undefined,
        pis: user.pis || undefined,
        payrollNumber: user.payrollNumber || undefined,
      });

      if (!secullumEmployee.success || !secullumEmployee.data) {
        this.logger.error(`Failed to find matching Secullum employee for user: ${user.name}`);
        this.logger.error(
          `Search criteria - CPF: ${user.cpf}, PIS: ${user.pis}, PayrollNumber: ${user.payrollNumber}`,
        );
        this.logger.error(`Secullum response: ${JSON.stringify(secullumEmployee)}`);
        return {
          success: false,
          message: `No Secullum employee found matching user: ${user.name} (CPF: ${user.cpf}, PIS: ${user.pis}, Folha: ${user.payrollNumber})`,
          data: [],
        };
      }

      this.logger.log(
        `Successfully found matching Secullum employee: ${JSON.stringify(secullumEmployee.data)}`,
      );

      // Fetch the time entries using the matched Secullum ID
      return await this.secullumService.getTimeEntries({
        employeeId: secullumEmployee.data.secullumId.toString(),
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
   * Update a time entry in Secullum
   * PUT /integrations/secullum/time-entries/:id
   */
  @Put('time-entries/:id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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

    // If a specific user is requested, automatically map to Secullum
    if (targetUserId) {
      this.logger.log(`Starting user mapping process for targetUserId: ${targetUserId}`);

      const userResponse = await this.userService.findById(targetUserId, {});

      this.logger.log(`Raw user response: ${JSON.stringify(userResponse)}`);

      if (!userResponse?.data) {
        this.logger.error(`User not found in Ankaa system: ${targetUserId}`);
        return {
          success: false,
          message: `User not found: ${targetUserId}`,
        };
      }

      const user = userResponse.data;
      this.logger.log(`Found Ankaa user: ${user.name} (ID: ${user.id})`);
      this.logger.log(
        `User details - CPF: ${user.cpf}, PIS: ${user.pis}, PayrollNumber: ${user.payrollNumber}`,
      );

      // Find Secullum employee using CPF/PIS/PayrollNumber lookup
      this.logger.log(`Attempting to match user by CPF, PIS, and Payroll Number`);

      const secullumEmployee = await this.secullumService.findSecullumEmployee({
        cpf: user.cpf || undefined,
        pis: user.pis || undefined,
        payrollNumber: user.payrollNumber || undefined,
      });

      if (!secullumEmployee.success || !secullumEmployee.data) {
        this.logger.error(`Failed to find matching Secullum employee for user: ${user.name}`);
        this.logger.error(
          `Search criteria - CPF: ${user.cpf}, PIS: ${user.pis}, PayrollNumber: ${user.payrollNumber}`,
        );
        return {
          success: false,
          message: `No Secullum employee found matching user: ${user.name} (CPF: ${user.cpf}, PIS: ${user.pis}, Folha: ${user.payrollNumber})`,
        };
      }

      this.logger.log(
        `Successfully found matching Secullum employee: ${JSON.stringify(secullumEmployee.data)}`,
      );

      const secullumEmployeeId = secullumEmployee.data.secullumId.toString();

      // Fetch calculations using the Secullum ID
      return await this.secullumService.getCalculations({
        employeeId: secullumEmployeeId,
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
   * Get pendências (pending issues) from Secullum
   * GET /integrations/secullum/pendencias
   */
  @Get('pendencias')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async deleteHoliday(
    @UserId() userId: string,
    @Param('id') holidayId: string,
  ): Promise<SecullumDeleteHolidayResponse> {
    this.logger.log(`User ${userId} deleting holiday ${holidayId} in Secullum`);

    return await this.secullumService.deleteHoliday(holidayId);
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getEmployees(@UserId() userId: string): Promise<any> {
    this.logger.log(`User ${userId} fetching Secullum employees`);
    return await this.secullumService.getEmployees();
  }

  /**
   * Check user mapping between our system and Secullum
   * GET /integrations/secullum/check-user-mapping
   * Returns mapping report showing which users can be matched to Secullum employees
   * No data is saved - this is purely a diagnostic/reporting endpoint
   */
  @Get('check-user-mapping')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
   * Get time adjustment requests from Secullum
   * GET /integrations/secullum/requests
   */
  @Get('requests')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
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
}
