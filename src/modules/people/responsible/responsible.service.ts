import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ResponsibleRepository } from './repositories/responsible.repository';
import { HashService } from '@/modules/common/hash/hash.service';
import { ChangeLogService } from '@/modules/common/changelog/changelog.service';
import {
  Responsible,
  ResponsibleInclude,
  ResponsibleOrderBy,
  ResponsibleWhere,
  ResponsibleResponse,
} from '@/types/responsible';
import {
  ResponsibleCreateFormData,
  ResponsibleUpdateFormData,
  ResponsibleLoginFormData,
  ResponsibleRegisterFormData,
} from '@/schemas/responsible';
import {
  ENTITY_TYPE,
  CHANGE_ACTION,
  RESPONSIBLE_ROLE,
  RESPONSIBLE_ROLE_LABELS,
  formatResponsibleRoles,
} from '@/constants/enums';
import { ResponsibleRole } from '@prisma/client';
import { PrismaService } from '@/modules/common/prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { JwtService } from '@nestjs/jwt';

// Re-exported for backwards compatibility. The values and labels live in
// @/constants/enums; this file used to keep a second copy that shadowed the
// Prisma `ResponsibleRole` type of the same name.
export { RESPONSIBLE_ROLE, RESPONSIBLE_ROLE_LABELS, formatResponsibleRoles };

@Injectable()
export class ResponsibleService {
  constructor(
    private readonly repository: ResponsibleRepository,
    private readonly hashService: HashService,
    private readonly changelogService: ChangeLogService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async create(data: ResponsibleCreateFormData): Promise<ResponsibleResponse> {
    // Check if email is provided and already exists
    if (data.email) {
      const existingEmail = await this.repository.findByEmail(data.email);
      if (existingEmail) {
        throw new BadRequestException('Email já cadastrado');
      }
    }

    // Check if phone already exists
    const existingPhone = await this.repository.findByPhone(data.phone);
    if (existingPhone) {
      throw new BadRequestException('Telefone já cadastrado');
    }

    // Hash password if provided (only required for system access)
    let hashedPassword: string | undefined;
    if (data.password) {
      hashedPassword = await this.hashService.hash(data.password);
    }

    // Create responsible
    const responsible = await this.repository.create(
      {
        ...data,
        password: hashedPassword,
      } as any,
      {
        include: { company: { include: { logo: true } } },
      },
    );

    // Log creation
    await this.changelogService.logChange({
      entityId: responsible.id,
      entityType: ENTITY_TYPE.RESPONSIBLE,
      action: CHANGE_ACTION.CREATE,
      newValue: responsible,
      reason: 'Responsável criado',
      triggeredBy: null,
      triggeredById: null,
      userId: null,
    });

    return responsible;
  }

  async findById(
    id: string,
    options?: { include?: ResponsibleInclude },
  ): Promise<ResponsibleResponse> {
    const responsible = await this.repository.findById(id, options);
    if (!responsible) {
      throw new NotFoundException('Responsável não encontrado');
    }
    return responsible;
  }

  async findByEmail(email: string): Promise<ResponsibleResponse | null> {
    return await this.repository.findByEmail(email);
  }

  async findByPhone(phone: string): Promise<ResponsibleResponse | null> {
    return await this.repository.findByPhone(phone);
  }

  /** Every contact of `companyId` holding `role` -- no longer at most one. */
  async findByCompanyIdAndRole(
    companyId: string,
    role: ResponsibleRole,
  ): Promise<ResponsibleResponse[]> {
    return await this.repository.findByCompanyIdAndRole(companyId, role);
  }

  async findByCompanyId(
    companyId: string,
    options?: {
      include?: ResponsibleInclude;
      orderBy?: ResponsibleOrderBy;
    },
  ): Promise<ResponsibleResponse[]> {
    return await this.repository.findByCompanyId(companyId, options);
  }

  async findMany(options?: {
    skip?: number;
    take?: number;
    page?: number;
    pageSize?: number;
    search?: string;
    companyId?: string;
    roles?: ResponsibleRole[];
    isActive?: boolean;
    where?: ResponsibleWhere;
    orderBy?: ResponsibleOrderBy;
    include?: ResponsibleInclude;
  }): Promise<{
    data: ResponsibleResponse[];
    meta: {
      total: number;
      page: number;
      pageSize: number;
      pageCount: number;
    };
  }> {
    // Convert page/pageSize to skip/take
    const page = options?.page || 1;
    const pageSize = options?.pageSize || options?.take || 40;
    const skip = options?.skip ?? (page - 1) * pageSize;
    const take = pageSize;

    // Build where clause from direct filters and search
    let where: ResponsibleWhere = { ...options?.where };

    // Apply direct filters
    if (options?.companyId) {
      where.companyId = options.companyId;
    }
    // Any-of: selecting FINANCIAL + FLEET_MANAGER lists every contact that
    // holds either. Backed by the GIN index on "Representative"."roles".
    if (options?.roles?.length) {
      where.roles = { hasSome: options.roles };
    }
    if (options?.isActive !== undefined) {
      where.isActive = options.isActive;
    }

    // Apply search
    if (options?.search) {
      where = {
        ...where,
        OR: [
          { name: { contains: options.search, mode: 'insensitive' } },
          { phone: { contains: options.search } },
          { email: { contains: options.search, mode: 'insensitive' } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      this.repository.findMany({
        skip,
        take,
        where,
        orderBy: options?.orderBy || { createdAt: 'desc' },
        include: options?.include || { company: { include: { logo: true } } },
      }),
      this.repository.count(where),
    ]);

    const pageCount = Math.ceil(total / pageSize);

    return {
      data: data as ResponsibleResponse[],
      meta: {
        total,
        page,
        pageSize,
        pageCount,
      },
    };
  }

  async update(id: string, data: ResponsibleUpdateFormData): Promise<ResponsibleResponse> {
    const existing = await this.findById(id);

    // Validate unique constraints
    if (data.email && data.email !== existing.email) {
      const emailExists = await this.repository.findByEmail(data.email);
      if (emailExists) {
        throw new BadRequestException('Email já cadastrado');
      }
    }

    if (data.phone && data.phone !== existing.phone) {
      const phoneExists = await this.repository.findByPhone(data.phone);
      if (phoneExists) {
        throw new BadRequestException('Telefone já cadastrado');
      }
    }

    // Update responsible
    const updated = await this.repository.update(id, data, {
      include: { company: { include: { logo: true } } },
    });

    // Log changes
    const changes = this.getChangedFields(existing, updated);
    for (const change of changes) {
      await this.changelogService.logChange({
        entityId: id,
        entityType: ENTITY_TYPE.RESPONSIBLE,
        action: CHANGE_ACTION.UPDATE,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        reason: `Campo ${change.field} alterado`,
        triggeredBy: null,
        triggeredById: null,
        userId: null,
      });
    }

    return updated;
  }

  async delete(id: string): Promise<void> {
    const responsible = await this.findById(id);

    await this.repository.delete(id);

    // Log deletion
    await this.changelogService.logChange({
      entityId: id,
      entityType: ENTITY_TYPE.RESPONSIBLE,
      action: CHANGE_ACTION.DELETE,
      oldValue: responsible,
      reason: 'Responsável removido',
      triggeredBy: null,
      triggeredById: null,
      userId: null,
    });
  }

  async toggleActive(id: string): Promise<ResponsibleResponse> {
    const responsible = await this.findById(id);
    const newStatus = !responsible.isActive;

    const updated = await this.repository.update(
      id,
      {
        isActive: newStatus,
      } as any,
      {
        include: { company: { include: { logo: true } } },
      },
    );

    // Log status change
    await this.changelogService.logChange({
      entityId: id,
      entityType: ENTITY_TYPE.RESPONSIBLE,
      action: newStatus ? CHANGE_ACTION.ACTIVATE : CHANGE_ACTION.DEACTIVATE,
      field: 'isActive',
      oldValue: String(!newStatus),
      newValue: String(newStatus),
      reason: newStatus ? 'Responsável ativado' : 'Responsável desativado',
      triggeredBy: null,
      triggeredById: null,
      userId: null,
    });

    return updated;
  }

  async checkPhoneAvailability(phone: string, excludeId?: string): Promise<{ available: boolean }> {
    const existing = await this.repository.findByPhone(phone);
    const available = !existing || (excludeId !== undefined && existing.id === excludeId);
    return { available };
  }

  async checkEmailAvailability(email: string, excludeId?: string): Promise<{ available: boolean }> {
    const existing = await this.repository.findByEmail(email);
    const available = !existing || (excludeId !== undefined && existing.id === excludeId);
    return { available };
  }

  async batchCreate(responsibles: ResponsibleCreateFormData[]): Promise<ResponsibleResponse[]> {
    const results: ResponsibleResponse[] = [];

    for (const data of responsibles) {
      try {
        const created = await this.create(data);
        results.push(created);
      } catch (error) {
        // Log error but continue with other items
        console.error(`Failed to create responsible: ${data.name}`, error);
      }
    }

    return results;
  }

  async batchUpdate(
    updates: Array<{ id: string; data: ResponsibleUpdateFormData }>,
  ): Promise<ResponsibleResponse[]> {
    const results: ResponsibleResponse[] = [];

    for (const { id, data } of updates) {
      try {
        const updated = await this.update(id, data);
        results.push(updated);
      } catch (error) {
        console.error(`Failed to update responsible: ${id}`, error);
      }
    }

    return results;
  }

  async batchDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      try {
        await this.delete(id);
      } catch (error) {
        console.error(`Failed to delete responsible: ${id}`, error);
      }
    }
  }

  async login(data: ResponsibleLoginFormData): Promise<{
    responsible: ResponsibleResponse;
    token: string;
  }> {
    // Find responsible by email or phone
    let responsible: Responsible | null = null;

    if (data.contact.includes('@')) {
      responsible = await this.repository.findByEmail(data.contact);
    } else {
      responsible = await this.repository.findByPhone(data.contact);
    }

    if (!responsible) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // Check if responsible has password (required for login)
    if (!responsible.password) {
      throw new UnauthorizedException(
        'Este responsável não possui acesso ao sistema. Entre em contato com o administrador.',
      );
    }

    // Check password
    const isPasswordValid = await this.hashService.compare(data.password, responsible.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // Check if active
    if (!responsible.isActive) {
      throw new UnauthorizedException('Conta desativada');
    }

    // Check if email is verified (only if email exists)
    if (responsible.email && !responsible.verified) {
      throw new UnauthorizedException('Conta não verificada');
    }

    // Generate session token
    const sessionToken = uuidv4();
    await this.repository.updateSessionToken(responsible.id, sessionToken);

    // Generate JWT
    // Deliberately claimed as `roles`, not `role`: AuthGuard reads a `role`
    // claim as a User SECTOR_PRIVILEGES value, and ResponsibleRole shares the
    // literal COMMERCIAL/FINANCIAL with that enum.
    const token = this.jwtService.sign({
      id: responsible.id,
      email: responsible.email,
      roles: responsible.roles,
      companyId: responsible.companyId,
      type: 'responsible',
    });

    return {
      responsible: await this.findById(responsible.id, {
        include: { company: { include: { logo: true } } },
      }),
      token,
    };
  }

  async logout(responsibleId: string): Promise<void> {
    await this.repository.updateSessionToken(responsibleId, null);
  }

  async register(data: ResponsibleRegisterFormData): Promise<ResponsibleResponse> {
    const { passwordConfirmation, ...createData } = data;

    // Email is required for registration (system access)
    if (!createData.email) {
      throw new BadRequestException('Email é obrigatório para registro no sistema');
    }

    // Password is required for registration
    if (!createData.password) {
      throw new BadRequestException('Senha é obrigatória para registro no sistema');
    }

    // Create responsible with system access
    const responsible = await this.create(createData);

    // Generate verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpiresAt = new Date();
    verificationExpiresAt.setHours(verificationExpiresAt.getHours() + 1);

    await this.repository.update(responsible.id, {
      verificationCode,
      verificationExpiresAt,
    } as any);

    // TODO: Send verification email

    return responsible;
  }

  async verifyEmail(responsibleId: string, verificationCode: string): Promise<ResponsibleResponse> {
    const responsible = await this.findById(responsibleId);

    if (responsible.verified) {
      throw new BadRequestException('Conta já verificada');
    }

    if (responsible.verificationCode !== verificationCode) {
      throw new BadRequestException('Código de verificação inválido');
    }

    if (responsible.verificationExpiresAt && responsible.verificationExpiresAt < new Date()) {
      throw new BadRequestException('Código de verificação expirado');
    }

    return await this.repository.update(responsibleId, {
      verified: true,
      verificationCode: null,
      verificationExpiresAt: null,
    } as any);
  }

  async changePassword(
    responsibleId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const responsible = await this.findById(responsibleId);

    if (!responsible.password) {
      throw new BadRequestException('Este responsável não possui senha definida');
    }

    // Verify old password
    const isOldPasswordValid = await this.hashService.compare(oldPassword, responsible.password);

    if (!isOldPasswordValid) {
      throw new BadRequestException('Senha atual incorreta');
    }

    // Hash new password
    const hashedPassword = await this.hashService.hash(newPassword);

    await this.repository.update(responsibleId, {
      password: hashedPassword,
    } as any);
  }

  async setPassword(responsibleId: string, password: string): Promise<void> {
    const responsible = await this.findById(responsibleId);

    if (responsible.password) {
      throw new BadRequestException(
        'Este responsável já possui senha. Use a opção de alterar senha.',
      );
    }

    // Hash password
    const hashedPassword = await this.hashService.hash(password);

    await this.repository.update(responsibleId, {
      password: hashedPassword,
    } as any);
  }

  async resetPassword(email: string): Promise<void> {
    const responsible = await this.repository.findByEmail(email);
    if (!responsible) {
      // Don't reveal if email exists
      return;
    }

    // Generate reset token
    const resetToken = uuidv4();
    const resetTokenExpiry = new Date();
    resetTokenExpiry.setHours(resetTokenExpiry.getHours() + 1);

    await this.repository.update(responsible.id, {
      resetToken,
      resetTokenExpiry,
    } as any);

    // TODO: Send reset email
  }

  async confirmResetPassword(resetToken: string, newPassword: string): Promise<void> {
    const responsible = await this.prisma.responsible.findUnique({
      where: { resetToken },
    });

    if (!responsible) {
      throw new BadRequestException('Token inválido');
    }

    if (responsible.resetTokenExpiry && responsible.resetTokenExpiry < new Date()) {
      throw new BadRequestException('Token expirado');
    }

    // Hash new password
    const hashedPassword = await this.hashService.hash(newPassword);

    await this.repository.update(responsible.id, {
      password: hashedPassword,
      resetToken: null,
      resetTokenExpiry: null,
    } as any);
  }

  private getRoleLabel(role: string): string {
    return RESPONSIBLE_ROLE_LABELS[role as RESPONSIBLE_ROLE] || role;
  }

  /**
   * `roles` is an array, so `!==` would compare references and report a change
   * on every single update. Values are canonically ordered by the Zod layer, so
   * an element-wise comparison is enough, and both sides are rendered through
   * the pt-BR labels rather than a raw `String(array)`.
   */
  private getChangedFields(
    oldData: any,
    newData: any,
  ): Array<{ field: string; oldValue: string; newValue: string }> {
    const changes: Array<{ field: string; oldValue: string; newValue: string }> = [];
    const fields = ['name', 'email', 'phone', 'roles', 'isActive', 'companyId'];

    const serialize = (field: string, value: unknown): string =>
      field === 'roles' ? formatResponsibleRoles(value as string[]) : String(value ?? '');

    const isEqual = (a: unknown, b: unknown): boolean => {
      if (Array.isArray(a) || Array.isArray(b)) {
        const left = Array.isArray(a) ? a : [];
        const right = Array.isArray(b) ? b : [];
        return left.length === right.length && left.every((item, i) => item === right[i]);
      }
      return a === b;
    };

    for (const field of fields) {
      // `undefined` on a partial update means "not touched", not "cleared".
      if (newData[field] === undefined) continue;
      if (isEqual(oldData[field], newData[field])) continue;

      changes.push({
        field,
        oldValue: serialize(field, oldData[field]),
        newValue: serialize(field, newData[field]),
      });
    }

    return changes;
  }
}
