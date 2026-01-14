import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { SectorRepository } from '@modules/people/sector/repositories/sector.repository';
import { SectorService } from '@modules/people/sector/sector.service';
import { HashService } from './../hash/hash.service';
import { VerificationService } from '../verification/verification.service';
import { SmsService } from '../sms/sms.service';
import { EmailService } from '../mailer/services/email.service';
import {
  USER_STATUS,
  USER_STATUS_LABELS,
  USER_STATUS_ORDER,
  CHANGE_ACTION,
  ENTITY_TYPE,
  CHANGE_TRIGGERED_BY,
  VERIFICATION_TYPE,
  SECTOR_PRIVILEGES,
} from '../../../constants';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { trackFieldChanges } from '@modules/common/changelog/utils/changelog-helpers';
import type { SignInFormData, SignUpFormData, ChangePasswordFormData } from '../../../schemas';
import {
  isValidPhone,
  isValidEmail,
  getPhoneLookupVariants,
  normalizeBrazilianPhone,
  detectContactMethod,
} from '../../../utils';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersRepository: UserRepository,
    private readonly sectorRepository: SectorRepository,
    private readonly sectorService: SectorService,
    private readonly hashService: HashService,
    private readonly jwtService: JwtService,
    private readonly changeLogService: ChangeLogService,
    private readonly verificationService: VerificationService,
    private readonly smsService: SmsService,
    private readonly emailService: EmailService,
  ) {}

  private async findOrCreateGuestSector(userId?: string): Promise<any> {
    try {
      // First, try to find existing "Convidado" sector
      const existingSector = await this.sectorRepository.findByName('Convidado');

      if (existingSector) {
        return existingSector;
      }

      // If not found, create the "Convidado" sector
      const guestSectorData = {
        name: 'Convidado',
        privileges: SECTOR_PRIVILEGES.BASIC,
      };

      const result = await this.sectorService.create(guestSectorData, undefined, userId);

      if (result.success && result.data) {
        return result.data;
      }

      throw new Error('Failed to create Convidado sector');
    } catch (error) {
      this.logger.error(`Error finding or creating Convidado sector: ${error.message}`);
      throw new BadRequestException('Erro ao configurar setor básico.');
    }
  }

  async signIn(signInDTO: SignInFormData): Promise<any> {
    const { contact, password } = signInDTO;

    if (!contact || !password) {
      throw new BadRequestException('Email/telefone e senha são obrigatórios.');
    }

    const foundUser = await this.findUserBycontact(contact);

    if (!foundUser) {
      throw new NotFoundException('Email ou número não cadastrado.');
    }

    const user = await this.usersRepository.findById(foundUser.id, {
      include: { sector: true, managedSector: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    if (!user.verified) {
      if (user.phone && isValidPhone(user.phone)) {
        throw new UnauthorizedException(
          `Conta ainda não verificada. Use o código de verificação enviado por SMS.`,
        );
      } else {
        throw new UnauthorizedException(
          `Conta ainda não verificada. Entre em contato com o administrador.`,
        );
      }
    }

    if (!user.password) {
      throw new UnauthorizedException(`Sua senha ainda não foi definida.`);
    }

    const isPasswordValid = await this.hashService.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Senha incorreta.');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new ForbiddenException('Sua conta está inativa. Entre em contato com o administrador.');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      phone: user.phone,
      role: user.sector?.privileges,
    };
    const accessToken = await this.jwtService.signAsync(payload);

    const oldLastLoginAt = user.lastLoginAt;
    const oldSessionToken = user.sessionToken;
    const newLastLoginAt = new Date();

    // Update last login and save the token
    await this.usersRepository.update(user.id, {
      lastLoginAt: newLastLoginAt,
      sessionToken: accessToken,
    });

    // Track lastLoginAt change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'lastLoginAt',
      oldValue: oldLastLoginAt,
      newValue: newLastLoginAt,
      reason: 'Login do usuário',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    // Track sessionToken change (redacted for security)
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'sessionToken',
      oldValue: oldSessionToken ? '[REDACTED]' : null,
      newValue: '[REDACTED]',
      reason: 'Nova sessão iniciada',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    return {
      success: true,
      message: 'Login realizado com sucesso',
      data: {
        token: accessToken,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          status: user.status,
          requirePasswordChange: user.requirePasswordChange,
          verified: user.verified,
          sectorId: user.sectorId,
          sector: user.sector
            ? {
                id: user.sector.id,
                name: user.sector.name,
                privileges: user.sector.privileges,
              }
            : null,
          managedSector: user.managedSector
            ? {
                id: user.managedSector.id,
                name: user.managedSector.name,
              }
            : null,
        },
      },
    };
  }

  async signUp(signUpDTO: SignUpFormData, ip?: string): Promise<any> {
    const hashedPassword = await this.hashService.hash(signUpDTO.password);
    const { email, phone } = signUpDTO;

    // Validate that at least one contact method is provided
    this.validateContactMethod(email, phone);

    // Check if email or phone already exists
    const whereConditions: Array<{ email?: string; phone?: string }> = [];
    if (email) {
      whereConditions.push({ email });
    }
    if (phone) {
      whereConditions.push({ phone });
    }

    const existingUser = await this.usersRepository.findMany({
      where: {
        OR: whereConditions,
      },
      take: 1,
    });

    if (existingUser.data && existingUser.data.length > 0) {
      const existing = existingUser.data[0];
      if (email && existing.email === email) {
        throw new BadRequestException('Email já cadastrado.');
      }
      if (phone && existing.phone === phone) {
        throw new BadRequestException('Telefone já cadastrado.');
      }
    }

    // Remove confirmPassword from the data if present
    const { confirmPassword, ...baseUserData } = signUpDTO as SignUpFormData & {
      confirmPassword?: string;
    };

    // Find or create "Convidado" sector for basic users
    const guestSector = await this.findOrCreateGuestSector();

    const user = await this.usersRepository.create({
      ...baseUserData,
      email: email || null,
      phone: phone || null,
      password: hashedPassword,
      status: USER_STATUS.EXPERIENCE_PERIOD_1,
      verified: false, // Requires verification
      performanceLevel: 0,
      sectorId: guestSector.id, // Assign to Convidado sector
    });

    if (!user) {
      throw new BadRequestException(
        'Não foi possível se cadastrar, recarregue a página e tente novamente.',
      );
    }

    // Log user creation
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.CREATE,
      field: null,
      oldValue: null,
      newValue: user,
      reason: 'Auto-cadastro de usuário',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    // Send verification code using unified verification service
    let message = 'Cadastro realizado com sucesso';
    const contactMethod = phone || email;

    if (contactMethod) {
      try {
        await this.verificationService.sendVerificationCode(contactMethod, ip);
        // Determine message based on what the user actually provided
        const methodType = phone ? 'SMS' : 'email';
        message = `Cadastro realizado com sucesso. Código de verificação enviado por ${methodType}.`;
      } catch (error) {
        this.logger.error(`Failed to send verification code to ${contactMethod}: ${error.message}`);
        message =
          'Cadastro realizado com sucesso. Entre em contato com o administrador para ativar sua conta.';
      }
    }

    return {
      success: true,
      message,
      data: {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          status: user.status,
          requirePasswordChange: false,
          verified: user.verified,
        },
      },
    };
  }

  async logout(userId: string): Promise<any> {
    if (!userId) {
      throw new BadRequestException('ID do usuário é obrigatório.');
    }

    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const oldSessionToken = user.sessionToken;

    // Clear the logged in token
    await this.usersRepository.update(userId, {
      sessionToken: null,
    });

    // Track sessionToken removal
    if (oldSessionToken) {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.USER,
        entityId: userId,
        action: CHANGE_ACTION.UPDATE,
        field: 'sessionToken',
        oldValue: '[REDACTED]',
        newValue: null,
        reason: 'Logout do usuário',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: userId,
        userId: userId,
      });
    }

    return {
      success: true,
      message: 'Logout realizado com sucesso.',
    };
  }

  async requestPasswordReset(contact: string): Promise<any> {
    if (!contact) {
      throw new BadRequestException('Email ou telefone é obrigatório.');
    }

    const user = await this.findUserBycontact(contact);

    if (!user) {
      // Don't reveal if email/phone exists
      return {
        success: true,
        message:
          'Se o email ou telefone estiver cadastrado, você receberá um código de verificação.',
      };
    }

    // Generate password reset code (6-digit)
    const resetCode = this.generateSixDigitCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // Code expires in 10 minutes

    const oldVerificationCode = user.verificationCode;
    const oldVerificationExpiresAt = user.verificationExpiresAt;
    const oldVerificationType = user.verificationType;
    const oldRequirePasswordChange = user.requirePasswordChange;

    await this.usersRepository.update(user.id, {
      verificationCode: resetCode,
      verificationExpiresAt: expiresAt,
      verificationType: VERIFICATION_TYPE.PASSWORD_RESET,
      requirePasswordChange: true, // Mark that password change is required
    });

    // Track verification code changes
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'verificationCode',
      oldValue: oldVerificationCode ? '[REDACTED]' : null,
      newValue: '[REDACTED]',
      reason: 'Código de redefinição de senha gerado',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    // Track verification expiration change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'verificationExpiresAt',
      oldValue: oldVerificationExpiresAt,
      newValue: expiresAt,
      reason: 'Prazo de expiração do código definido',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    // Track verification type change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'verificationType',
      oldValue: oldVerificationType,
      newValue: VERIFICATION_TYPE.PASSWORD_RESET,
      reason: 'Tipo de verificação definido para redefinição de senha',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    // Track requirePasswordChange change
    if (oldRequirePasswordChange !== true) {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.USER,
        entityId: user.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'requirePasswordChange',
        oldValue: oldRequirePasswordChange,
        newValue: true,
        reason: 'Alteração de senha requerida após solicitação de redefinição',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: user.id,
        userId: user.id,
      });
    }

    // Determine what type of contact the user INPUT (not what's in the user record)
    const inputContactType = detectContactMethod(contact);
    this.logger.log(`Password reset requested via ${inputContactType} for contact: ${contact}`);

    let emailSent = false;
    let smsSent = false;

    // Prioritize the method based on what the user INPUT
    if (inputContactType === 'phone') {
      // User input a phone number - prioritize SMS
      // First, normalize the phone to find the best match
      const normalizedInputPhone = normalizeBrazilianPhone(contact);
      const phoneToUse = normalizedInputPhone || user.phone;

      if (phoneToUse && isValidPhone(phoneToUse)) {
        try {
          this.logger.log(`Sending password reset SMS to normalized phone: ${phoneToUse}`);
          await this.sendPasswordResetSms(phoneToUse, user.name, resetCode);
          smsSent = true;
        } catch (error) {
          this.logger.error(`Failed to send password reset SMS: ${error.message}`);
        }
      }

      // Fallback to email if SMS fails and email is available
      if (!smsSent && user.email && isValidEmail(user.email)) {
        try {
          await this.sendPasswordResetEmail(user.email, user.name, resetCode);
          emailSent = true;
        } catch (error) {
          this.logger.error(`Failed to send password reset email (fallback): ${error.message}`);
        }
      }
    } else if (inputContactType === 'email') {
      // User input an email - prioritize email
      if (user.email && isValidEmail(user.email)) {
        try {
          await this.sendPasswordResetEmail(user.email, user.name, resetCode);
          emailSent = true;
        } catch (error) {
          this.logger.error(`Failed to send password reset email: ${error.message}`);
        }
      }

      // Fallback to SMS if email fails and phone is available
      if (!emailSent && user.phone && isValidPhone(user.phone)) {
        try {
          await this.sendPasswordResetSms(user.phone, user.name, resetCode);
          smsSent = true;
        } catch (error) {
          this.logger.error(`Failed to send password reset SMS (fallback): ${error.message}`);
        }
      }
    } else {
      // Unknown input type - try both (email first, then SMS)
      if (user.email && isValidEmail(user.email)) {
        try {
          await this.sendPasswordResetEmail(user.email, user.name, resetCode);
          emailSent = true;
        } catch (error) {
          this.logger.error(`Failed to send password reset email: ${error.message}`);
        }
      }

      if (user.phone && isValidPhone(user.phone)) {
        try {
          await this.sendPasswordResetSms(user.phone, user.name, resetCode);
          smsSent = true;
        } catch (error) {
          this.logger.error(`Failed to send password reset SMS: ${error.message}`);
        }
      }
    }

    // Return appropriate message based on what was sent
    if (emailSent && smsSent) {
      return {
        success: true,
        message: 'Código de verificação enviado por email e SMS.',
      };
    } else if (smsSent) {
      return {
        success: true,
        message: 'Código de verificação enviado por SMS.',
      };
    } else if (emailSent) {
      return {
        success: true,
        message: 'Código de verificação enviado por email.',
      };
    } else {
      return {
        success: true,
        message: 'Erro ao enviar código. Entre em contato com o administrador.',
      };
    }
  }

  async resetPasswordWithCode(contact: string, code: string, newPassword: string): Promise<any> {
    if (!contact || !code || !newPassword) {
      throw new BadRequestException('Email/telefone, código e nova senha são obrigatórios.');
    }

    const user = await this.findUserBycontact(contact);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // Check if user has a verification code for password reset
    if (!user.verificationCode || user.verificationType !== VERIFICATION_TYPE.PASSWORD_RESET) {
      throw new BadRequestException(
        'Nenhum código de redefinição foi enviado. Solicite um novo código.',
      );
    }

    // Check if code is expired
    if (user.verificationExpiresAt && new Date() > user.verificationExpiresAt) {
      throw new BadRequestException('Código expirado. Solicite uma nova redefinição de senha.');
    }

    // Verify the code
    if (code !== user.verificationCode) {
      throw new BadRequestException('Código de verificação inválido.');
    }

    // Hash new password
    const hashedPassword = await this.hashService.hash(newPassword);

    // Store old values for tracking
    const oldVerificationCode = user.verificationCode;
    const oldVerificationExpiresAt = user.verificationExpiresAt;
    const oldVerificationType = user.verificationType;
    const oldRequirePasswordChange = user.requirePasswordChange;

    // Update password and clear verification code
    await this.usersRepository.update(user.id, {
      password: hashedPassword,
      verificationCode: null,
      verificationExpiresAt: null,
      verificationType: undefined,
      requirePasswordChange: false,
    });

    // Track password change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'password',
      oldValue: '[REDACTED]',
      newValue: '[REDACTED]',
      reason: 'Senha redefinida com código de verificação',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    // Track verification code removal
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'verificationCode',
      oldValue: '[REDACTED]',
      newValue: null,
      reason: 'Código de verificação removido após uso',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    // Track verification expiration removal
    if (oldVerificationExpiresAt) {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.USER,
        entityId: user.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'verificationExpiresAt',
        oldValue: oldVerificationExpiresAt,
        newValue: null,
        reason: 'Prazo de expiração removido após uso do código',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: user.id,
        userId: user.id,
      });
    }

    // Track verification type removal
    if (oldVerificationType) {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.USER,
        entityId: user.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'verificationType',
        oldValue: oldVerificationType,
        newValue: null,
        reason: 'Tipo de verificação removido após uso',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: user.id,
        userId: user.id,
      });
    }

    // Track requirePasswordChange change
    if (oldRequirePasswordChange !== false) {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.USER,
        entityId: user.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'requirePasswordChange',
        oldValue: oldRequirePasswordChange,
        newValue: false,
        reason: 'Requisito de mudança de senha removido',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: user.id,
        userId: user.id,
      });
    }

    return {
      success: true,
      message: 'Senha redefinida com sucesso!',
    };
  }

  async changePassword(userId: string, dto: ChangePasswordFormData): Promise<{ message: string }> {
    if (!userId || !dto.currentPassword || !dto.newPassword) {
      throw new BadRequestException('ID do usuário, senha atual e nova senha são obrigatórios.');
    }

    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    if (!user.password) {
      throw new BadRequestException('Usuário não possui senha definida.');
    }

    // Verify current password
    const isPasswordValid = await this.hashService.compare(dto.currentPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Senha atual incorreta.');
    }

    // Hash new password
    const hashedPassword = await this.hashService.hash(dto.newPassword);

    // Store old requirePasswordChange value
    const oldRequirePasswordChange = user.requirePasswordChange;

    // Update password
    await this.usersRepository.update(userId, {
      password: hashedPassword,
      requirePasswordChange: false,
    });

    // Track password change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: userId,
      action: CHANGE_ACTION.UPDATE,
      field: 'password',
      oldValue: '[REDACTED]',
      newValue: '[REDACTED]',
      reason: 'Senha alterada pelo usuário',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId,
      userId: userId,
    });

    // Track requirePasswordChange change if it was true
    if (oldRequirePasswordChange === true) {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.USER,
        entityId: userId,
        action: CHANGE_ACTION.UPDATE,
        field: 'requirePasswordChange',
        oldValue: true,
        newValue: false,
        reason: 'Requisito de mudança de senha removido após alteração',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: userId,
        userId: userId,
      });
    }

    return { message: 'Senha alterada com sucesso!' };
  }

  // Admin methods
  async toggleUserStatus(
    targetUserId: string,
    status: USER_STATUS,
    reason: string | undefined,
    adminUserId: string,
  ): Promise<{ message: string }> {
    if (!targetUserId || !status || !adminUserId) {
      throw new BadRequestException('ID do usuário, status e ID do admin são obrigatórios.');
    }

    const user = await this.usersRepository.findById(targetUserId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const oldStatus = user.status;
    const oldStatusOrder = user.statusOrder;

    // Prevent changing status to the same value
    if (oldStatus === status) {
      throw new BadRequestException(`Usuário já está com status ${USER_STATUS_LABELS[status]}.`);
    }

    const newStatusOrder = USER_STATUS_ORDER[status];

    // Update user status
    await this.usersRepository.update(targetUserId, {
      status,
      statusOrder: newStatusOrder,
    });

    // Track status change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: targetUserId,
      action: CHANGE_ACTION.UPDATE,
      field: 'status',
      oldValue: oldStatus,
      newValue: status,
      reason: reason || `Status alterado para ${USER_STATUS_LABELS[status]}`,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: adminUserId,
      userId: adminUserId,
    });

    // Track statusOrder change
    if (oldStatusOrder !== newStatusOrder) {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.USER,
        entityId: targetUserId,
        action: CHANGE_ACTION.UPDATE,
        field: 'statusOrder',
        oldValue: oldStatusOrder,
        newValue: newStatusOrder,
        reason: 'Ordem de status atualizada',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: adminUserId,
        userId: adminUserId,
      });
    }

    // If dismissing, clear the logged in token
    if (status === USER_STATUS.DISMISSED) {
      await this.usersRepository.update(targetUserId, {
        sessionToken: null,
      });
    }

    // Log status change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: targetUserId,
      action: CHANGE_ACTION.UPDATE,
      field: 'status',
      oldValue: oldStatus,
      newValue: status,
      reason: reason || `Status changed by admin`,
      triggeredBy: CHANGE_TRIGGERED_BY.USER,
      triggeredById: adminUserId,
      userId: adminUserId,
    });

    return {
      message: `Status do usuário alterado para ${USER_STATUS_LABELS[status]}.`,
    };
  }

  async adminResetUserPassword(
    targetUserId: string,
    temporaryPassword: string,
    requirePasswordChange: boolean,
    adminUserId: string,
  ): Promise<{ message: string }> {
    if (!targetUserId || !temporaryPassword || !adminUserId) {
      throw new BadRequestException('Todos os parâmetros são obrigatórios.');
    }

    const user = await this.usersRepository.findById(targetUserId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // Hash temporary password
    const hashedPassword = await this.hashService.hash(temporaryPassword);

    // Store old requirePasswordChange value
    const oldRequirePasswordChange = user.requirePasswordChange;

    // Update password
    await this.usersRepository.update(targetUserId, {
      password: hashedPassword,
      requirePasswordChange,
    });

    // Email functionality disabled - admin must provide password manually

    // Track password reset
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: targetUserId,
      action: CHANGE_ACTION.UPDATE,
      field: 'password',
      oldValue: '[REDACTED]',
      newValue: '[REDACTED]',
      reason: 'Senha redefinida pelo administrador',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: adminUserId,
      userId: adminUserId,
    });

    // Track requirePasswordChange change if it changed
    if (oldRequirePasswordChange !== requirePasswordChange) {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.USER,
        entityId: targetUserId,
        action: CHANGE_ACTION.UPDATE,
        field: 'requirePasswordChange',
        oldValue: oldRequirePasswordChange,
        newValue: requirePasswordChange,
        reason: requirePasswordChange
          ? 'Usuário deverá mudar a senha no próximo login'
          : 'Requisito de mudança de senha removido',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: adminUserId,
        userId: adminUserId,
      });
    }

    return {
      message:
        'Senha do usuário redefinida com sucesso. Informe pessoalmente a senha temporária ao usuário.',
    };
  }

  async adminLogoutUser(
    targetUserId: string,
    reason: string,
    adminUserId: string,
  ): Promise<{ message: string }> {
    if (!targetUserId || !reason || !adminUserId) {
      throw new BadRequestException('ID do usuário, motivo e ID do admin são obrigatórios.');
    }

    const user = await this.usersRepository.findById(targetUserId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // Check if user is already logged out
    if (!user.sessionToken) {
      throw new BadRequestException('Usuário já está desconectado.');
    }

    // Clear the logged in token
    await this.usersRepository.update(targetUserId, {
      sessionToken: null,
    });

    // Track forced logout
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: targetUserId,
      action: CHANGE_ACTION.UPDATE,
      field: 'sessionToken',
      oldValue: '[REDACTED]',
      newValue: null,
      reason: reason,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: adminUserId,
      userId: adminUserId,
    });

    return { message: 'Usuário desconectado com sucesso.' };
  }

  // Unified verification methods
  async sendVerificationCode(contact: string, ip?: string): Promise<any> {
    return await this.verificationService.sendVerificationCode(contact, ip);
  }

  async sendPasswordResetSms(phone: string, userName: string, resetCode?: string): Promise<void> {
    // Normalize the phone number before sending
    const normalizedPhone = normalizeBrazilianPhone(phone) || phone;
    this.logger.debug(`Sending password reset SMS to normalized phone: ${normalizedPhone}`);
    const code = resetCode || this.generateSixDigitCode();
    const message = `Olá ${userName}! Seu código para redefinir a senha do Ankaa é: ${code}`;
    await this.smsService.sendSms(normalizedPhone, message);
  }

  async sendPasswordResetEmail(email: string, userName: string, resetCode: string): Promise<void> {
    const baseData = this.emailService.createBaseEmailData(userName);
    const emailData = {
      ...baseData,
      resetCode,
      expiryMinutes: 10,
    };

    const result = await this.emailService.sendPasswordResetCode(email, emailData);

    if (!result.success) {
      this.logger.error(`Failed to send password reset email to ${email}: ${result.error}`);
      throw new Error(`Email delivery failed: ${result.error}`);
    }

    this.logger.log(
      `Password reset email sent successfully to ${email} (MessageId: ${result.messageId})`,
    );
  }

  private generateSixDigitCode(): string {
    // Generate a crypto-secure random 6-digit code for all environments
    const crypto = require('crypto');
    const randomNumber = crypto.randomInt(100000, 999999);
    return randomNumber.toString();
  }

  // Unified verification methods
  async verifyCode(contact: string, code: string, ip?: string): Promise<any> {
    return await this.verificationService.verifyCode(contact, code, ip);
  }

  async resendVerificationCode(contact: string, ip?: string): Promise<any> {
    return await this.verificationService.resendVerificationCode(contact, ip);
  }

  // Unified resend verification method
  async resendVerification(contact: string, ip?: string): Promise<any> {
    return await this.sendVerificationCode(contact, ip);
  }

  async getCurrentUser(userId: string): Promise<any> {
    if (!userId) {
      throw new BadRequestException('ID do usuário é obrigatório.');
    }

    const user = await this.usersRepository.findById(userId, {
      include: {
        position: true,
        sector: true,
        ppeSize: true,
        preference: true,
        managedSector: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new ForbiddenException('Sua conta está inativa. Entre em contato com o administrador.');
    }

    // Remove sensitive data
    const { password, sessionToken, ...userData } = user;

    return userData;
  }

  async refreshToken(userId: string): Promise<any> {
    if (!userId) {
      throw new BadRequestException('ID do usuário é obrigatório.');
    }

    const user = await this.usersRepository.findById(userId, {
      include: {
        sector: true,
        managedSector: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new ForbiddenException('Sua conta está inativa. Entre em contato com o administrador.');
    }

    // Generate new token with updated payload
    const payload = {
      sub: user.id,
      email: user.email,
      phone: user.phone,
      role: user.sector?.privileges,
    };

    const newToken = await this.jwtService.signAsync(payload);

    // Update session token in database
    await this.usersRepository.update(user.id, {
      sessionToken: newToken,
    });

    // Log the token refresh
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'sessionToken',
      oldValue: '[REDACTED]',
      newValue: '[REDACTED]',
      reason: 'Token renovado',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    return {
      success: true,
      message: 'Token renovado com sucesso',
      data: {
        token: newToken,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          status: user.status,
          requirePasswordChange: user.requirePasswordChange,
          verified: user.verified,
          sectorId: user.sectorId,
          sector: user.sector
            ? {
                id: user.sector.id,
                name: user.sector.name,
                privileges: user.sector.privileges,
              }
            : null,
          managedSector: user.managedSector
            ? {
                id: user.managedSector.id,
                name: user.managedSector.name,
              }
            : null,
        },
      },
    };
  }

  // Helper methods
  private validateContactMethod(email?: string | null, phone?: string | null): void {
    if (!email && !phone) {
      throw new BadRequestException('Email ou telefone deve ser fornecido.');
    }
  }

  private buildSearchConditions(contact: string): Array<{ email?: string; phone?: string }> {
    const whereConditions: Array<{ email?: string; phone?: string }> = [];

    // Check if input looks like email
    const contactType = detectContactMethod(contact);

    if (contactType === 'email') {
      // Search by email (exact match, lowercase)
      whereConditions.push({ email: contact.toLowerCase() });
      whereConditions.push({ email: contact });
    } else if (contactType === 'phone') {
      // Generate all possible phone format variants for lookup
      const phoneVariants = getPhoneLookupVariants(contact);
      this.logger.debug(`Phone lookup variants for "${contact}": ${JSON.stringify(phoneVariants)}`);

      for (const variant of phoneVariants) {
        whereConditions.push({ phone: variant });
      }
    } else {
      // Unknown format - try both as fallback
      whereConditions.push({ email: contact });
      whereConditions.push({ phone: contact });

      // Also try phone variants in case it's a phone in unusual format
      const phoneVariants = getPhoneLookupVariants(contact);
      for (const variant of phoneVariants) {
        whereConditions.push({ phone: variant });
      }
    }

    return whereConditions;
  }

  private async findUserBycontact(contact: string): Promise<any> {
    const whereConditions = this.buildSearchConditions(contact);

    const foundUsers = await this.usersRepository.findMany({
      where: {
        OR: whereConditions,
      },
      take: 1,
      page: 1,
    });

    if (!foundUsers.data || foundUsers.data.length === 0) {
      return null;
    }

    return foundUsers.data[0];
  }
}
