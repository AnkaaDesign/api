import { Controller, Get, Query, UsePipes } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { ZodQueryValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import {
  InventoryDashboardResponse,
  HRDashboardResponse,
  AdministrationDashboardResponse,
  PaintDashboardResponse,
  ProductionDashboardResponse,
  UnifiedDashboardResponse,
} from '../../../types';
import {
  inventoryDashboardQuerySchema,
  hrDashboardQuerySchema,
  administrationDashboardQuerySchema,
  paintDashboardQuerySchema,
  productionDashboardQuerySchema,
  unifiedDashboardQuerySchema,
  InventoryDashboardQueryFormData,
  HRDashboardQueryFormData,
  AdministrationDashboardQueryFormData,
  PaintDashboardQueryFormData,
  ProductionDashboardQueryFormData,
  UnifiedDashboardQueryFormData,
} from '../../../schemas/dashboard';

@Controller('dashboards')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('inventory')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(inventoryDashboardQuerySchema))
  async getInventoryDashboard(
    @Query() query: InventoryDashboardQueryFormData,
    @UserId() userId: string,
  ): Promise<InventoryDashboardResponse> {
    return this.dashboardService.getInventoryDashboard(query, userId);
  }

  @Get('hr')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(hrDashboardQuerySchema))
  async getHRDashboard(
    @Query() query: HRDashboardQueryFormData,
    @UserId() userId: string,
  ): Promise<HRDashboardResponse> {
    return this.dashboardService.getHRDashboard(query, userId);
  }

  @Get('administration')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(administrationDashboardQuerySchema))
  async getAdministrationDashboard(
    @Query() query: AdministrationDashboardQueryFormData,
    @UserId() userId: string,
  ): Promise<AdministrationDashboardResponse> {
    return this.dashboardService.getAdministrationDashboard(query, userId);
  }

  @Get('paint')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintDashboardQuerySchema))
  async getPaintDashboard(
    @Query() query: PaintDashboardQueryFormData,
    @UserId() userId: string,
  ): Promise<PaintDashboardResponse> {
    return this.dashboardService.getPaintDashboard(query, userId);
  }

  @Get('production')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.LEADER)
  @UsePipes(new ZodQueryValidationPipe(productionDashboardQuerySchema))
  async getProductionDashboard(
    @Query() query: ProductionDashboardQueryFormData,
    @UserId() userId: string,
  ): Promise<ProductionDashboardResponse> {
    return this.dashboardService.getProductionDashboard(query, userId);
  }

  @Get('unified')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(unifiedDashboardQuerySchema))
  async getUnifiedDashboard(
    @Query() query: UnifiedDashboardQueryFormData,
    @UserId() userId: string,
  ): Promise<UnifiedDashboardResponse> {
    return this.dashboardService.getUnifiedDashboard(query, userId);
  }
}
