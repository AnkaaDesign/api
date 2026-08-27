import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { SectorRepository } from '@modules/people/sector/repositories/sector.repository';
import { SectorService } from '@modules/people/sector/sector.service';
import { HashService } from './../hash/hash.service';
import { VerificationService } from '../verification/verification.service';
import { SmsService } from '../sms/sms.service';
import { EmailService } from '../mailer/services/email.service';
import {
  CONTRACT_TYPE,
  CONTRACT_STATUS,
  CONTRACT_STATUS_LABELS,
  CHANGE_ACTION,
  ENTITY_TYPE,
  CHANGE_TRIGGERED_BY,
  VERIFICATION_TYPE,
  SECTOR_PRIVILEGES,
} from '../../../constants';
import { isUserEmployed } from '../../../utils/contract';
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

  // Access-token lifetime. The refresh token (below) renews it silently, so in
  // theory this could be short. In practice it is the app's last line of
  // defence: whenever a client cannot refresh — offline, a storage fault, a bug
  // in the client — this TTL is exactly how long the user stays logged in before
  // being sent back to the login screen.
  //
  // The default used to be '1h'. Production never set JWT_ACCESS_EXPIRATION, so
  // it silently ran on that default, and a mobile client that could not produce
  // its refresh token forced ~40 re-logins a day on the shop floor. A generous
  // default means the same class of failure costs one login a month instead of
  // one an hour. Revocation does not depend on this: the guard re-reads the user
  // on every request, so a terminated or deactivated account is cut off at once.
  private readonly accessTokenTtl = process.env.JWT_ACCESS_EXPIRATION || '30d';
  // Long-lived refresh token TTL, in days.
  private readonly refreshTokenTtlDays = Number(process.env.JWT_REFRESH_EXPIRATION_DAYS) || 365;

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
    private readonly prisma: PrismaService,
  ) {}

  // =====================
  // Token helpers
  // =====================

  private hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Sign a short-lived access JWT for the given user. */
  private async signAccessToken(user: {
    id: string;
    email: string | null;
    phone: string | null;
    sector?: { privileges?: string } | null;
  }): Promise<string> {
    const payload = {
      sub: user.id,
      email: user.email,
      phone: user.phone,
      role: user.sector?.privileges,
    };
    return this.jwtService.signAsync(payload, { expiresIn: this.accessTokenTtl });
  }

  /**
   * Create a new refresh-token row for a user's device/session and return the
   * RAW opaque token (only its hash is persisted). The caller returns the raw
   * token to the client, which stores it and later presents it to /auth/refresh.
   */
  private async issueRefreshToken(userId: string, userAgent?: string): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshTokenTtlDays);

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashRefreshToken(raw),
        userId,
        expiresAt,
        userAgent: userAgent?.slice(0, 255) ?? null,
      },
    });

    return raw;
  }

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

  async signIn(signInDTO: SignInFormData, userAgent?: string): Promise<any> {
    const { contact, password } = signInDTO;

    if (!contact || !password) {
      throw new BadRequestException('Email/telefone e senha são obrigatórios.');
    }

    const foundUser = await this.findUserBycontact(contact);

    if (!foundUser) {
      throw new NotFoundException('Email ou número não cadastrado.');
    }

    const user = await this.usersRepository.findByIdWithCredentials(foundUser.id, {
      sector: true,
      ledSector: true,
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
    if (!isUserEmployed(user)) {
      throw new ForbiddenException('Sua conta está inativa. Entre em contato com o administrador.');
    }

    return this.establishSession(user, userAgent, {
      message: 'Login realizado com sucesso',
      reason: 'Login do usuário',
    });
  }

  /**
   * Mint a session for a user who has just proven who they are, and return the
   * payload every client expects from a login.
   *
   * Shared by /auth/login and by first access — the latter must end with the
   * employee already inside the app, and a second silent login round-trip would
   * only add a way for the activation to half-succeed.
   */
  private async establishSession(
    user: any,
    userAgent: string | undefined,
    copy: { message: string; reason: string },
  ): Promise<any> {
    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id, userAgent);

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
      reason: copy.reason,
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
      message: copy.message,
      data: {
        token: accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          currentContractType: user.currentContractType,
          currentContractStatus: user.currentContractStatus,
          currentEmployeeType: user.currentEmployeeType,
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
          ledSector: user.ledSector
            ? {
                id: user.ledSector.id,
                name: user.ledSector.name,
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
      // Guest (Convidado) self-signup: no real vínculo yet — seed the current
      // contract cache so the experiência modalidade is reflected until HR
      // formalises an EmploymentContract.
      currentContractType: CONTRACT_TYPE.EXPERIENCE_PERIOD_1,
      currentContractStatus: CONTRACT_STATUS.ACTIVE,
      verified: false, // Requires verification
      performanceLevel: 0,
      sectorId: guestSector.id, // Assign to Convidado sector
    } as any);

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
          currentContractType: user.currentContractType,
          currentContractStatus: user.currentContractStatus,
          currentEmployeeType: user.currentEmployeeType,
          requirePasswordChange: false,
          verified: user.verified,
        },
      },
    };
  }

  async logout(userId: string, rawRefreshToken?: string): Promise<any> {
    if (!userId) {
      throw new BadRequestException('ID do usuário é obrigatório.');
    }

    const user = await this.usersRepository.findByIdWithCredentials(userId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const oldSessionToken = user.sessionToken;

    // Revoke refresh token(s). If the client sends the refresh token it holds,
    // revoke only that device's session; otherwise revoke all of the user's
    // sessions as a safe fallback.
    if (rawRefreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, tokenHash: this.hashRefreshToken(rawRefreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

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

    const { emailSent, smsSent } = await this.dispatchCode(user, contact, resetCode, {
      purpose: 'password reset',
      sendEmail: (email, userName, code) => this.sendPasswordResetEmail(email, userName, code),
      sendSms: (phone, userName, code) => this.sendPasswordResetSms(phone, userName, code),
    });

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

  // =====================
  // First Access (activation of an HR-created account)
  // =====================
  //
  // HR registers the employee with no Ankaa password and verified=false — the
  // Secullum side is already provisioned at that moment, but the person still
  // has no way in. First access is that way in, and it is deliberately NOT the
  // password-reset flow: only this one may flip `verified`, and it must refuse
  // an account that already has a password (that one belongs to "esqueci minha
  // senha", where knowing the e-mail is not enough to take over a live account).
  //
  // Three steps, each its own endpoint:
  //   1. request  — issue the code
  //   2. verify   — spend the code, hand back a short-lived setup token
  //   3. complete — set the password against that token, verify, and log in
  //
  // Splitting 2 and 3 is what lets the UI reject a wrong code immediately
  // instead of after the person has already chosen a password.

  private readonly FIRST_ACCESS_CODE_TTL_MINUTES = 10;
  private readonly FIRST_ACCESS_SETUP_TOKEN_TTL = '15m';

  /**
   * The setup token is signed with a DIFFERENT secret from access tokens on
   * purpose. AuthGuard verifies any JWT minted with JWT_SECRET and trusts its
   * `sub`, so a setup token signed with that secret would double as a bearer
   * token for every endpoint without an explicit @Roles. Deriving a separate
   * secret makes it fail verification there, which is exactly what we want: it
   * is good for one thing only.
   */
  private get firstAccessSetupSecret(): string {
    return process.env.JWT_FIRST_ACCESS_SECRET || `${process.env.JWT_SECRET}::first-access`;
  }

  /**
   * Resolves a contact to a user row that actually carries `password`.
   *
   * The Prisma client omits credential fields globally, so the by-contact
   * lookup comes back with `password: undefined` — which silently reads as
   * "never set one" and would let a fully active account run the activation
   * again. Every first-access check therefore goes through here, exactly like
   * signIn does.
   */
  private async findUserWithCredentialsByContact(contact: string): Promise<any | null> {
    const found = await this.findUserBycontact(contact);
    if (!found) return null;
    return this.usersRepository.findByIdWithCredentials(found.id);
  }

  /**
   * Who may activate an account: someone who never finished doing so.
   *
   * `password === null` is the durable signal (an abandoned ceremony leaves the
   * account exactly as it was). `!verified` also qualifies, so an account
   * created with a password but never confirmed can still be claimed by whoever
   * holds the contact — which is the same proof a reset would demand anyway.
   */
  private assertEligibleForFirstAccess(user: {
    password?: string | null;
    verified?: boolean;
    currentContractStatus?: any;
  }): void {
    if (!isUserEmployed(user)) {
      throw new ForbiddenException(
        'Sua conta está inativa. Entre em contato com o administrador.',
      );
    }
    if (user.password && user.verified) {
      // Deliberately explicit instead of a vague "we sent something": this
      // account is already usable, and telling the person so is what stops the
      // support call. /auth/login already reveals whether a contact exists, so
      // this leaks nothing new.
      throw new BadRequestException(
        'Esta conta já está ativa. Use "Esqueceu sua senha?" para redefinir sua senha.',
      );
    }
  }

  /**
   * Step 1 — send the activation code.
   *
   * Answers the same way whether or not the contact exists, so this endpoint
   * cannot be used to harvest who works here. The one thing it does say out
   * loud is "this account is already active" (see assertEligibleForFirstAccess).
   */
  async requestFirstAccess(contact: string): Promise<any> {
    if (!contact) {
      throw new BadRequestException('Email ou telefone é obrigatório.');
    }

    const user = await this.findUserWithCredentialsByContact(contact);
    if (!user) {
      return {
        success: true,
        message:
          'Se o email ou telefone estiver cadastrado, você receberá um código de primeiro acesso.',
      };
    }

    this.assertEligibleForFirstAccess(user);

    const accessCode = this.generateSixDigitCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + this.FIRST_ACCESS_CODE_TTL_MINUTES);

    const oldVerificationCode = user.verificationCode;
    const oldVerificationType = user.verificationType;

    await this.usersRepository.update(user.id, {
      verificationCode: accessCode,
      verificationExpiresAt: expiresAt,
      verificationType: VERIFICATION_TYPE.FIRST_ACCESS,
    });

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'verificationCode',
      oldValue: oldVerificationCode ? '[REDACTED]' : null,
      newValue: '[REDACTED]',
      reason: 'Código de primeiro acesso gerado',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'verificationType',
      oldValue: oldVerificationType,
      newValue: VERIFICATION_TYPE.FIRST_ACCESS,
      reason: 'Tipo de verificação definido para primeiro acesso',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    const { emailSent, smsSent } = await this.dispatchCode(user, contact, accessCode, {
      purpose: 'first access',
      sendEmail: (email, userName, code) => this.sendFirstAccessEmail(email, userName, code),
      sendSms: (phone, userName, code) => this.sendFirstAccessSms(phone, userName, code),
    });

    if (emailSent && smsSent) {
      return { success: true, message: 'Código de primeiro acesso enviado por email e SMS.' };
    }
    if (smsSent) {
      return { success: true, message: 'Código de primeiro acesso enviado por SMS.' };
    }
    if (emailSent) {
      return { success: true, message: 'Código de primeiro acesso enviado por email.' };
    }
    // Falha de entrega é erro de verdade, não um 200 com aviso: quem pediu o
    // código ficaria parado na tela seguinte esperando um e-mail que não vem.
    throw new ServiceUnavailableException(
      'Não foi possível enviar o código. Verifique seus dados de contato com o administrador.',
    );
  }

  /**
   * Step 2 — spend the code, hand back the setup token.
   *
   * The code is cleared here, but nothing else about the account changes yet:
   * an abandoned ceremony leaves the person exactly as they were, free to start
   * over. Password and `verified` only move in step 3, together.
   */
  async verifyFirstAccessCode(contact: string, code: string): Promise<any> {
    if (!contact || !code) {
      throw new BadRequestException('Email/telefone e código são obrigatórios.');
    }

    const user = await this.findUserWithCredentialsByContact(contact);
    if (!user) {
      throw new BadRequestException('Código de verificação inválido.');
    }

    this.assertEligibleForFirstAccess(user);

    if (!user.verificationCode || user.verificationType !== VERIFICATION_TYPE.FIRST_ACCESS) {
      throw new BadRequestException(
        'Nenhum código de primeiro acesso foi enviado. Solicite um novo código.',
      );
    }

    if (user.verificationExpiresAt && new Date() > user.verificationExpiresAt) {
      throw new BadRequestException('Código expirado. Solicite um novo código.');
    }

    if (code !== user.verificationCode) {
      throw new BadRequestException('Código de verificação inválido.');
    }

    await this.usersRepository.update(user.id, {
      verificationCode: null,
      verificationExpiresAt: null,
      verificationType: undefined,
    });

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'verificationCode',
      oldValue: '[REDACTED]',
      newValue: null,
      reason: 'Código de primeiro acesso validado',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    const setupToken = await this.jwtService.signAsync(
      { sub: user.id, purpose: 'FIRST_ACCESS' },
      { secret: this.firstAccessSetupSecret, expiresIn: this.FIRST_ACCESS_SETUP_TOKEN_TTL },
    );

    return {
      success: true,
      message: 'Código verificado. Defina sua senha para ativar a conta.',
      data: { setupToken, name: user.name },
    };
  }

  /**
   * Step 3 — set the password, activate, and log in.
   *
   * Single-use without any extra bookkeeping: once the password exists the
   * eligibility check rejects the same token, so a replay within the token's
   * 15 minutes cannot overwrite the password the employee just chose.
   */
  async completeFirstAccess(
    setupToken: string,
    password: string,
    userAgent?: string,
  ): Promise<any> {
    if (!setupToken || !password) {
      throw new BadRequestException('Sessão de primeiro acesso e senha são obrigatórias.');
    }

    let payload: { sub?: string; purpose?: string };
    try {
      payload = await this.jwtService.verifyAsync(setupToken, {
        secret: this.firstAccessSetupSecret,
      });
    } catch {
      throw new UnauthorizedException(
        'Sessão de primeiro acesso expirada. Solicite um novo código.',
      );
    }

    if (payload?.purpose !== 'FIRST_ACCESS' || !payload.sub) {
      throw new UnauthorizedException('Sessão de primeiro acesso inválida.');
    }

    const user = await this.usersRepository.findByIdWithCredentials(payload.sub, {
      sector: true,
      ledSector: true,
    });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    this.assertEligibleForFirstAccess(user);

    const hashedPassword = await this.hashService.hash(password);
    const wasVerified = user.verified;

    await this.usersRepository.update(user.id, {
      password: hashedPassword,
      verified: true,
      requirePasswordChange: false,
      verificationCode: null,
      verificationExpiresAt: null,
      verificationType: undefined,
    });

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'password',
      oldValue: '[REDACTED]',
      newValue: '[REDACTED]',
      reason: 'Senha definida no primeiro acesso',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: user.id,
      userId: user.id,
    });

    if (!wasVerified) {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.USER,
        entityId: user.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'verified',
        oldValue: false,
        newValue: true,
        reason: 'Conta ativada no primeiro acesso',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: user.id,
        userId: user.id,
      });
    }

    this.logger.log(`First access completed for user ${user.id}`);

    // The session payload must describe the account as it is NOW, not as it was
    // read: the client stores this user object and would otherwise cache an
    // unverified, must-change-password copy of someone who is neither.
    return this.establishSession(
      { ...user, verified: true, requirePasswordChange: false },
      userAgent,
      { message: 'Conta ativada com sucesso!', reason: 'Primeiro acesso concluído' },
    );
  }

  async sendFirstAccessSms(phone: string, userName: string, code: string): Promise<void> {
    const normalizedPhone = normalizeBrazilianPhone(phone) || phone;
    const message = `Olá ${userName}! Seu código de primeiro acesso no Ankaa é: ${code}`;
    await this.smsService.sendSms(normalizedPhone, message);
  }

  async sendFirstAccessEmail(email: string, userName: string, code: string): Promise<void> {
    const baseData = this.emailService.createBaseEmailData(userName);
    const result = await this.emailService.sendFirstAccessCode(email, {
      ...baseData,
      accessCode: code,
      expiryMinutes: this.FIRST_ACCESS_CODE_TTL_MINUTES,
    });

    if (!result.success) {
      this.logger.error(`Failed to send first access email to ${email}: ${result.error}`);
      throw new Error(`Email delivery failed: ${result.error}`);
    }

    this.logger.log(
      `First access email sent successfully to ${email} (MessageId: ${result.messageId})`,
    );
  }

  async changePassword(userId: string, dto: ChangePasswordFormData): Promise<{ message: string }> {
    if (!userId || !dto.currentPassword || !dto.newPassword) {
      throw new BadRequestException('ID do usuário, senha atual e nova senha são obrigatórios.');
    }

    const user = await this.usersRepository.findByIdWithCredentials(userId);
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
    status: CONTRACT_STATUS,
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

    const oldStatus = user.currentContractStatus;

    // Prevent changing status to the same value
    if (oldStatus === status) {
      throw new BadRequestException(`Usuário já está com status ${CONTRACT_STATUS_LABELS[status]}.`);
    }

    // Flip the current contract's status (the user-update path writes the contract
    // row and re-syncs the User cache). Login eligibility now derives from
    // currentContractStatus (see isUserEmployed) — no separate isActive flag.
    await this.usersRepository.update(targetUserId, {
      contractStatus: status,
    });

    // Track status change
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: targetUserId,
      action: CHANGE_ACTION.UPDATE,
      field: 'currentContractStatus',
      oldValue: oldStatus,
      newValue: status,
      reason: reason || `Status alterado para ${CONTRACT_STATUS_LABELS[status]}`,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: adminUserId,
      userId: adminUserId,
    });

    // If dismissing, clear the logged in token
    if (status === CONTRACT_STATUS.TERMINATED) {
      await this.usersRepository.update(targetUserId, {
        sessionToken: null,
      });
    }

    return {
      message: `Status do usuário alterado para ${CONTRACT_STATUS_LABELS[status]}.`,
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

    const user = await this.usersRepository.findByIdWithCredentials(targetUserId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // Check if user is already logged out
    if (!user.sessionToken) {
      throw new BadRequestException('Usuário já está desconectado.');
    }

    // Revoke every refresh token so the user cannot silently renew their access
    // token after being forced out.
    await this.prisma.refreshToken.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

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

  /**
   * Delivers a 6-digit code over whichever channel the user actually typed,
   * falling back to the other one. Sending is best-effort by design: a dead SMS
   * gateway must not abort a ceremony the e-mail can still complete.
   */
  private async dispatchCode(
    user: { name: string; email: string | null; phone: string | null },
    contact: string,
    code: string,
    senders: {
      purpose: string;
      sendEmail: (email: string, userName: string, code: string) => Promise<void>;
      sendSms: (phone: string, userName: string, code: string) => Promise<void>;
    },
  ): Promise<{ emailSent: boolean; smsSent: boolean }> {
    // What the user INPUT decides the priority — not what the record happens to
    // have. Someone who typed their phone expects the code on that phone.
    const inputContactType = detectContactMethod(contact);
    this.logger.log(`${senders.purpose} requested via ${inputContactType} for contact: ${contact}`);

    let emailSent = false;
    let smsSent = false;

    const trySms = async (phone: string | null, label: string) => {
      if (smsSent || !phone || !isValidPhone(phone)) return;
      try {
        await senders.sendSms(phone, user.name, code);
        smsSent = true;
      } catch (error) {
        this.logger.error(`Failed to send ${senders.purpose} SMS${label}: ${error.message}`);
      }
    };

    const tryEmail = async (email: string | null, label: string) => {
      if (emailSent || !email || !isValidEmail(email)) return;
      try {
        await senders.sendEmail(email, user.name, code);
        emailSent = true;
      } catch (error) {
        this.logger.error(`Failed to send ${senders.purpose} email${label}: ${error.message}`);
      }
    };

    if (inputContactType === 'phone') {
      // Normalize what was typed so the code goes to the number the user knows,
      // even when the record stores it in another format.
      await trySms(normalizeBrazilianPhone(contact) || user.phone, '');
      await tryEmail(user.email, ' (fallback)');
    } else if (inputContactType === 'email') {
      await tryEmail(user.email, '');
      await trySms(user.phone, ' (fallback)');
    } else {
      // Unrecognizable input: try both, e-mail first.
      await tryEmail(user.email, '');
      await trySms(user.phone, '');
    }

    return { emailSent, smsSent };
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
        ledSector: true,
        avatar: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // Check if user is active
    if (!isUserEmployed(user)) {
      throw new ForbiddenException('Sua conta está inativa. Entre em contato com o administrador.');
    }

    // Remove sensitive data
    const { password, sessionToken, ...userData } = user;

    return {
      ...userData,
    };
  }

  /**
   * Exchange a valid opaque refresh token for a fresh short-lived access token.
   * This is a PUBLIC endpoint — it does NOT require a valid access token, so it
   * can renew a session whose access token has already expired (the whole point
   * of a refresh token). Non-rotating: the same refresh token stays valid until
   * it expires or is revoked (logout), which keeps concurrent refreshes from
   * multiple in-flight requests on mobile from racing each other into a logout.
   *
   * IMPORTANT: this path intentionally writes NO changelog and does NO extra DB
   * writes beyond the lookup — it runs roughly once per access-token TTL per
   * device, so it must stay cheap.
   */
  async refreshToken(rawRefreshToken: string): Promise<any> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Refresh token ausente.');
    }

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashRefreshToken(rawRefreshToken) },
    });

    // Unknown, already revoked, or expired → force a full re-login.
    if (!record || record.revokedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }

    const user = await this.usersRepository.findById(record.userId, {
      include: {
        sector: true,
        ledSector: true,
      },
    });

    if (!user) {
      // Orphaned token — clean it up and reject.
      await this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }

    // Inactive/terminated account: kill the session.
    if (!isUserEmployed(user)) {
      await this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });
      throw new ForbiddenException('Sua conta está inativa. Entre em contato com o administrador.');
    }

    const newAccessToken = await this.signAccessToken(user);

    return {
      success: true,
      message: 'Token renovado com sucesso',
      data: {
        token: newAccessToken,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          currentContractType: user.currentContractType,
          currentContractStatus: user.currentContractStatus,
          currentEmployeeType: user.currentEmployeeType,
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
          ledSector: user.ledSector
            ? {
                id: user.ledSector.id,
                name: user.ledSector.name,
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
