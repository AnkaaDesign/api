import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RepresentativeService } from './representative.service';
import { AuthGuard } from '@/modules/common/auth/auth.guard';
import { Roles } from '@/modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '@/constants/enums';
import { Public } from '@/modules/common/auth/decorators/public.decorator';
import { ZodValidationPipe } from '@/modules/common/pipes/zod-validation.pipe';
import {
  representativeCreateSchema,
  representativeUpdateSchema,
  representativeLoginSchema,
  representativeRegisterSchema,
  representativeGetManySchema,
  RepresentativeCreateFormData,
  RepresentativeUpdateFormData,
  RepresentativeLoginFormData,
  RepresentativeRegisterFormData,
} from '@/schemas/representative';

@Controller('representatives')
export class RepresentativeController {
  constructor(private readonly service: RepresentativeService) {}

  @Post()
  @UseGuards(AuthGuard)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async create(
    @Body(new ZodValidationPipe(representativeCreateSchema))
    data: RepresentativeCreateFormData,
  ) {
    return await this.service.create(data);
  }

  @Get()
  @UseGuards(AuthGuard)
  async findMany(
    @Query(new ZodValidationPipe(representativeGetManySchema))
    query: any,
  ) {
    return await this.service.findMany(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async findById(@Param('id') id: string) {
    return await this.service.findById(id, {
      include: { customer: true, tasks: true },
    });
  }

  @Get('customer/:customerId')
  @UseGuards(AuthGuard)
  async findByCustomerId(@Param('customerId') customerId: string) {
    return await this.service.findByCustomerId(customerId, {
      include: { tasks: true },
    });
  }

  @Get('customer/:customerId/role/:role')
  @UseGuards(AuthGuard)
  async findByCustomerIdAndRole(
    @Param('customerId') customerId: string,
    @Param('role') role: string,
  ) {
    return await this.service.findByCustomerIdAndRole(customerId, role);
  }

  @Put(':id')
  @UseGuards(AuthGuard)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(representativeUpdateSchema))
    data: RepresentativeUpdateFormData,
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

  @Post('login')
  @Public()
  async login(
    @Body(new ZodValidationPipe(representativeLoginSchema))
    data: RepresentativeLoginFormData,
  ) {
    return await this.service.login(data);
  }

  @Post('register')
  @Public()
  async register(
    @Body(new ZodValidationPipe(representativeRegisterSchema))
    data: RepresentativeRegisterFormData,
  ) {
    return await this.service.register(data);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body('representativeId') representativeId: string) {
    await this.service.logout(representativeId);
  }

  @Post('verify-email')
  @Public()
  async verifyEmail(
    @Body() data: { representativeId: string; verificationCode: string },
  ) {
    return await this.service.verifyEmail(
      data.representativeId,
      data.verificationCode,
    );
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
  async confirmResetPassword(
    @Body() data: { resetToken: string; newPassword: string },
  ) {
    await this.service.confirmResetPassword(
      data.resetToken,
      data.newPassword,
    );
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
    await this.service.changePassword(
      id,
      data.oldPassword,
      data.newPassword,
    );
  }

  @Post(':id/set-password')
  @UseGuards(AuthGuard)
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPassword(
    @Param('id') id: string,
    @Body('password') password: string,
  ) {
    await this.service.setPassword(id, password);
  }
}