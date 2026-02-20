import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ResponsibleService } from './responsible.service';
import { AuthGuard } from '@/modules/common/auth/auth.guard';
import { Roles } from '@/modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '@/constants/enums';
import { Public } from '@/modules/common/auth/decorators/public.decorator';
import { ZodValidationPipe } from '@/modules/common/pipes/zod-validation.pipe';
import {
  responsibleCreateSchema,
  responsibleUpdateSchema,
  responsibleLoginSchema,
  responsibleRegisterSchema,
  responsibleGetManySchema,
  ResponsibleCreateFormData,
  ResponsibleUpdateFormData,
  ResponsibleLoginFormData,
  ResponsibleRegisterFormData,
} from '@/schemas/responsible';

@Controller('responsibles')
export class ResponsibleController {
  constructor(private readonly service: ResponsibleService) {}

  @Post()
  @UseGuards(AuthGuard)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async create(
    @Body(new ZodValidationPipe(responsibleCreateSchema))
    data: ResponsibleCreateFormData,
  ) {
    return await this.service.create(data);
  }

  @Get()
  @UseGuards(AuthGuard)
  async findMany(
    @Query(new ZodValidationPipe(responsibleGetManySchema))
    query: any,
  ) {
    return await this.service.findMany(query);
  }

  @Get('check-phone')
  @UseGuards(AuthGuard)
  async checkPhoneAvailability(
    @Query('phone') phone: string,
    @Query('excludeId') excludeId?: string,
  ) {
    return await this.service.checkPhoneAvailability(phone, excludeId);
  }

  @Get('check-email')
  @UseGuards(AuthGuard)
  async checkEmailAvailability(
    @Query('email') email: string,
    @Query('excludeId') excludeId?: string,
  ) {
    return await this.service.checkEmailAvailability(email, excludeId);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async findById(@Param('id') id: string) {
    return await this.service.findById(id, {
      include: { company: { include: { logo: true } }, tasks: true },
    });
  }

  @Get('company/:companyId')
  @UseGuards(AuthGuard)
  async findByCompanyId(@Param('companyId') companyId: string) {
    return await this.service.findByCompanyId(companyId, {
      include: { tasks: true },
    });
  }

  @Get('company/:companyId/role/:role')
  @UseGuards(AuthGuard)
  async findByCompanyIdAndRole(
    @Param('companyId') companyId: string,
    @Param('role') role: string,
  ) {
    return await this.service.findByCompanyIdAndRole(companyId, role);
  }

  @Put(':id')
  @UseGuards(AuthGuard)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(responsibleUpdateSchema))
    data: ResponsibleUpdateFormData,
  ) {
    return await this.service.update(id, data);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string) {
    await this.service.delete(id);
  }

  @Patch(':id/toggle-active')
  @UseGuards(AuthGuard)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async toggleActive(@Param('id') id: string) {
    return await this.service.toggleActive(id);
  }

  @Post('batch')
  @UseGuards(AuthGuard)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async batchCreate(@Body() data: { responsibles: ResponsibleCreateFormData[] }) {
    return await this.service.batchCreate(data.responsibles);
  }

  @Put('batch')
  @UseGuards(AuthGuard)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async batchUpdate(
    @Body() data: { updates: Array<{ id: string; data: ResponsibleUpdateFormData }> },
  ) {
    return await this.service.batchUpdate(data.updates);
  }

  @Delete('batch')
  @UseGuards(AuthGuard)
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async batchDelete(@Body() data: { ids: string[] }) {
    await this.service.batchDelete(data.ids);
  }

  @Post('login')
  @Public()
  async login(
    @Body(new ZodValidationPipe(responsibleLoginSchema))
    data: ResponsibleLoginFormData,
  ) {
    return await this.service.login(data);
  }

  @Post('register')
  @Public()
  async register(
    @Body(new ZodValidationPipe(responsibleRegisterSchema))
    data: ResponsibleRegisterFormData,
  ) {
    return await this.service.register(data);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body('responsibleId') responsibleId: string) {
    await this.service.logout(responsibleId);
  }

  @Post('verify-email')
  @Public()
  async verifyEmail(@Body() data: { responsibleId: string; verificationCode: string }) {
    return await this.service.verifyEmail(data.responsibleId, data.verificationCode);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body('email') email: string) {
    await this.service.resetPassword(email);
  }

  @Post('confirm-reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmResetPassword(@Body() data: { resetToken: string; newPassword: string }) {
    await this.service.confirmResetPassword(data.resetToken, data.newPassword);
  }

  @Post(':id/change-password')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Param('id') id: string,
    @Body()
    data: {
      oldPassword: string;
      newPassword: string;
    },
  ) {
    await this.service.changePassword(id, data.oldPassword, data.newPassword);
  }

  @Post(':id/set-password')
  @UseGuards(AuthGuard)
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPassword(@Param('id') id: string, @Body('password') password: string) {
    await this.service.setPassword(id, password);
  }
}
