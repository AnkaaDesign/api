// src/auth/auth.controller.ts
// Simplified auth controller with unified 6-digit verification

import {
  Body,
  Controller,
  Post,
  Put,
  UseGuards,
  Get,
  Request,
  UsePipes,
  Logger,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { UserId } from './decorators/user.decorator';
import {
  AuthRateLimit,
  ReadRateLimit,
  VerificationRateLimit,
  VerificationSendRateLimit,
} from '../throttler/throttler.decorators';
import { VerificationThrottle } from '../throttler/verification-throttler.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { SECTOR_PRIVILEGES, USER_STATUS } from '../../../constants';
import type {
  SignInFormData,
  SignUpFormData,
  PasswordResetRequestFormData,
  PasswordResetFormData,
  ChangePasswordFormData,
  VerifyCodeFormData,
  SendVerificationFormData,
  AdminToggleUserStatusFormData,
  AdminResetUserPasswordFormData,
  AdminLogoutUserFormData,
} from '../../../schemas';
import {
  signInSchema,
  signUpSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  changePasswordSchema,
  verifyCodeSchema,
  sendVerificationSchema,
  adminToggleUserStatusSchema,
  adminResetUserPasswordSchema,
  adminLogoutUserSchema,
} from '../../../schemas';

@Controller('auth')
@UseGuards(AuthGuard)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  private getClientIp(req: ExpressRequest): string {
    const xForwardedFor = req.headers['x-forwarded-for'];
    const forwarded = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
    return (
      req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || forwarded || 'unknown'
    );
  }

  // =====================
  // Core Authentication
  // =====================

  @Public()
  @AuthRateLimit()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(signInSchema))
  async login(@Body() data: SignInFormData, @Request() req: ExpressRequest) {
    const clientIp = this.getClientIp(req);
    return this.authService.signIn(data);
  }

  @Public()
  @AuthRateLimit()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(signUpSchema))
  async register(@Body() data: SignUpFormData, @Request() req: ExpressRequest) {
    const clientIp = this.getClientIp(req);
    return this.authService.signUp(data, clientIp);
  }

  @Post('logout')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  async logout(@UserId() userId: string) {
    return this.authService.logout(userId);
  }

  @Get('me')
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getCurrentUser(@UserId() userId: string) {
    if (!userId) {
      throw new UnauthorizedException('User ID not found in token');
    }

    const userData = await this.authService.getCurrentUser(userId);
    return {
      success: true,
      message: 'Dados do usuário obtidos com sucesso',
      data: userData,
    };
  }

  @Post('refresh')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  async refreshToken(@UserId() userId: string) {
    if (!userId) {
      throw new UnauthorizedException('User ID not found in token');
    }

    return this.authService.refreshToken(userId);
  }

  @Put('change-password')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(changePasswordSchema))
  async changePassword(@UserId() userId: string, @Body() data: ChangePasswordFormData) {
    const result = await this.authService.changePassword(userId, data);
    return {
      success: true,
      message: result.message,
      data: null,
    };
  }

  // =====================
  // Unified 6-Digit Verification
  // =====================

  @Public()
  @VerificationSendRateLimit()
  @VerificationThrottle()
  @Post('send-verification')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(sendVerificationSchema))
  async sendVerification(@Body() data: SendVerificationFormData, @Request() req: ExpressRequest) {
    const clientIp = this.getClientIp(req);
    return this.authService.sendVerificationCode(data.contact, clientIp);
  }

  @Public()
  @VerificationRateLimit()
  @VerificationThrottle()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(verifyCodeSchema))
  async verify(@Body() data: VerifyCodeFormData, @Request() req: ExpressRequest) {
    const clientIp = this.getClientIp(req);
    return this.authService.verifyCode(data.contact, data.code, clientIp);
  }

  @Public()
  @VerificationSendRateLimit()
  @VerificationThrottle()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(sendVerificationSchema))
  async resendVerification(@Body() data: SendVerificationFormData, @Request() req: ExpressRequest) {
    const clientIp = this.getClientIp(req);
    return this.authService.resendVerification(data.contact, clientIp);
  }

  // =====================
  // Password Reset (6-digit codes)
  // =====================

  @Public()
  @AuthRateLimit()
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(passwordResetRequestSchema))
  async requestPasswordReset(@Body() data: PasswordResetRequestFormData) {
    return this.authService.requestPasswordReset(data.contact);
  }

  @Public()
  @AuthRateLimit()
  @Post('password-reset')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(passwordResetSchema))
  async resetPassword(@Body() data: PasswordResetFormData) {
    return this.authService.resetPasswordWithCode(data.contact, data.code, data.password);
  }

  // =====================
  // Admin Operations
  // =====================

  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  @Post('admin/toggle-user-status')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(adminToggleUserStatusSchema))
  async toggleUserStatus(
    @UserId() adminUserId: string,
    @Body() data: AdminToggleUserStatusFormData,
  ) {
    const result = await this.authService.toggleUserStatus(
      data.userId,
      data.status as USER_STATUS,
      data.reason,
      adminUserId,
    );
    return {
      success: true,
      message: result.message,
      data: null,
    };
  }

  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @Post('admin/reset-user-password')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(adminResetUserPasswordSchema))
  async adminResetUserPassword(
    @UserId() adminUserId: string,
    @Body() data: AdminResetUserPasswordFormData,
  ) {
    const result = await this.authService.adminResetUserPassword(
      data.userId,
      data.temporaryPassword,
      data.requirePasswordChange,
      adminUserId,
    );
    return {
      success: true,
      message: result.message,
      data: null,
    };
  }

  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  @Post('admin/logout-user')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(adminLogoutUserSchema))
  async adminLogoutUser(@UserId() adminUserId: string, @Body() data: AdminLogoutUserFormData) {
    const result = await this.authService.adminLogoutUser(data.userId, data.reason, adminUserId);
    return {
      success: true,
      message: result.message,
      data: null,
    };
  }
}
