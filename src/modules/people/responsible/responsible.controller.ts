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
  BadRequestException,
} from '@nestjs/common';
import { ResponsibleService } from './responsible.service';
import { AuthGuard } from '@/modules/common/auth/auth.guard';
import { Roles } from '@/modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '@/constants/enums';
import { ZodValidationPipe } from '@/modules/common/pipes/zod-validation.pipe';
import {
  responsibleCreateSchema,
  responsibleUpdateSchema,
  responsibleGetManySchema,
  responsibleRoleSchema,
  responsibleBatchCreateSchema,
  responsibleBatchUpdateSchema,
  ResponsibleCreateFormData,
  ResponsibleUpdateFormData,
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

  // Returns a LIST: a contact can hold several roles, so several contacts of
  // the same company may hold the requested one. Path params bypass the Zod
  // pipe entirely, hence the explicit enum check.
  @Get('company/:companyId/role/:role')
  @UseGuards(AuthGuard)
  async findByCompanyIdAndRole(@Param('companyId') companyId: string, @Param('role') role: string) {
    const parsed = responsibleRoleSchema.safeParse(role);
    if (!parsed.success) {
      throw new BadRequestException(`Função inválida: ${role}`);
    }
    return await this.service.findByCompanyIdAndRole(companyId, parsed.data);
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
  async batchCreate(
    @Body(new ZodValidationPipe(responsibleBatchCreateSchema))
    data: { responsibles: ResponsibleCreateFormData[] },
  ) {
    return await this.service.batchCreate(data.responsibles);
  }

  @Put('batch')
  @UseGuards(AuthGuard)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async batchUpdate(
    @Body(new ZodValidationPipe(responsibleBatchUpdateSchema))
    data: { updates: Array<{ id: string; data: ResponsibleUpdateFormData }> },
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

  // As rotas de senha (login/register/verify-email/reset-password/
  // confirm-reset-password/change-password/set-password) foram REMOVIDAS.
  //
  // Elas nunca funcionaram: o JWT era assinado sem claim `sub`, e o AuthGuard
  // resolve o sujeito por `payload.sub` — nenhum token emitido ali passou em
  // guarda nenhuma. Os dois `TODO: Send verification email` garantiam que
  // nenhum codigo saisse, e `login` exigia `verified`. A producao confirmou:
  // 183 responsaveis, ZERO com senha, sessao, reset, verificacao ou login.
  //
  // O que sobrava era superficie de ataque: `register` era @Public() e aceitava
  // `companyId` e `roles` do CORPO — qualquer um se anexava ao cliente que
  // quisesse, com o papel que quisesse. Nada disso tinha throttle.
  //
  // A autenticacao de responsavel agora vive em ResponsibleAuthController
  // (`/cliente/auth/*`): sessao por OTP, sem credencial em repouso.
}
