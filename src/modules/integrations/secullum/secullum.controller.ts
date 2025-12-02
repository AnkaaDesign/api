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
        `User details - CPF: ${user.cpf}, PIS: ${user.pis}, PayrollNumber: ${user.payrollNumber}, SecullumId: ${user.secullumId}`,
      );

      // First check if user already has secullumId
      if (user.secullumId) {
        this.logger.log(
          `User already has Secullum mapping: ${user.secullumId}, using existing mapping`,
        );
        // Use existing mapping
        return await this.secullumService.getTimeEntries({
          employeeId: user.secullumId,
          startDate,
          endDate,
        });
      }

      // If no secullumId, try to find and map automatically
      this.logger.log(
        `No existing Secullum mapping found, attempting to match user by CPF, PIS, and Payroll Number`,
      );

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

      // Save the mapping for future use
      this.logger.log(
        `Saving Ankaa-Secullum mapping: User ${targetUserId} -> Secullum ${secullumEmployee.data.secullumId}`,
      );
      await this.userService.update(targetUserId, {
        secullumId: secullumEmployee.data.secullumId.toString(),
      });

      this.logger.log(
        `Successfully mapped and saved: User ${targetUserId} (${user.name}) -> Secullum employee ${secullumEmployee.data.secullumId}`,
      );

      // Now fetch the time entries using the mapped Secullum ID
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
    SECTOR_PRIVILEGES.LEADER,
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
        `User details - CPF: ${user.cpf}, PIS: ${user.pis}, PayrollNumber: ${user.payrollNumber}, SecullumId: ${user.secullumId}`,
      );

      // First check if user already has secullumId
      let secullumEmployeeId = user.secullumId;

      if (!secullumEmployeeId) {
        this.logger.log(
          `No existing Secullum mapping found, attempting to match user by CPF, PIS, and Payroll Number`,
        );

        // If no secullumId, try to find and map automatically
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

        // Save the mapping for future use
        secullumEmployeeId = secullumEmployee.data.secullumId.toString();
        this.logger.log(
          `Saving Ankaa-Secullum mapping: User ${targetUserId} -> Secullum ${secullumEmployeeId}`,
        );
        await this.userService.update(targetUserId, {
          secullumId: secullumEmployeeId,
        });

        this.logger.log(
          `Successfully mapped and saved: User ${targetUserId} (${user.name}) -> Secullum employee ${secullumEmployeeId}`,
        );
      } else {
        this.logger.log(
          `User already has Secullum mapping: ${secullumEmployeeId}, using existing mapping`,
        );
      }

      // Fetch calculations using the Secullum ID
      return await this.secullumService.getCalculations({
        employeeId: secullumEmployeeId!,
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
  @Roles(SECTOR_PRIVILEGES.BASIC) // All users can see holidays
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
   * Sync user mapping between our system and Secullum
   * POST /integrations/secullum/sync-user-mapping
   */
  @Post('sync-user-mapping')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async syncUserMapping(
    @UserId() userId: string,
    @Body() body?: { dryRun?: boolean },
  ): Promise<any> {
    this.logger.log(`User ${userId} syncing user mappings with Secullum`);

    const dryRun = body?.dryRun ?? false;

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
        updated: [] as any[],
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

          // Update secullumId if not already set and not in dry run
          if (!dryRun && user.secullumId !== matchingEmployee.Id.toString()) {
            await this.userService.update(user.id, {
              secullumId: matchingEmployee.Id.toString(),
            });
            mappingResults.updated.push({
              userId: user.id,
              userName: user.name,
              secullumId: matchingEmployee.Id,
            });
          }
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
        dryRun,
        summary: {
          totalUsers: ourUsers.length,
          totalSecullumEmployees: secullumEmployees.data.length,
          matched: mappingResults.matched.length,
          unmatched: mappingResults.unmatched.length,
          updated: dryRun ? 0 : mappingResults.updated.length,
        },
        details: mappingResults,
      };
    } catch (error) {
      this.logger.error('Error syncing user mapping', error);
      return {
        success: false,
        message: 'Failed to sync user mapping',
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
    @Body() requestData: any,
  ): Promise<SecullumRequestActionResponse> {
    this.logger.log(`User ${userId} approving Secullum request ID: ${requestId}`);

    // Set the SolicitacaoId from the URL parameter
    const approvalData = {
      SolicitacaoId: parseInt(requestId),
      Versao: requestData.Versao,
      AlteracoesFonteDados: requestData.AlteracoesFonteDados || [],
      TipoSolicitacao: requestData.TipoSolicitacao || 0,
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
    @Body() requestData: any,
  ): Promise<SecullumRequestActionResponse> {
    this.logger.log(`User ${userId} rejecting Secullum request ID: ${requestId}`);

    // Set the SolicitacaoId from the URL parameter
    const rejectionData = {
      SolicitacaoId: parseInt(requestId),
      Versao: requestData.Versao,
      MotivoDescarte:
        requestData.MotivoDescarte || requestData.observacoes || 'Rejeitado via sistema Ankaa',
      TipoSolicitacao: requestData.TipoSolicitacao || 0,
    };

    return await this.secullumService.rejectRequest(rejectionData);
  }
}
