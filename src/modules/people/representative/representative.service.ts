import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { RepresentativeRepository } from './repositories/representative.repository';
import { HashService } from '@/modules/common/hash/hash.service';
import { ChangeLogService } from '@/modules/common/changelog/changelog.service';
import {
  Representative,
  RepresentativeInclude,
  RepresentativeOrderBy,
  RepresentativeWhere,
  RepresentativeResponse,
} from '@/types/representative';
import {
  RepresentativeCreateFormData,
  RepresentativeUpdateFormData,
  RepresentativeLoginFormData,
  RepresentativeRegisterFormData,
} from '@/schemas/representative';
import { ENTITY_TYPE, CHANGE_ACTION } from '@/constants/enums';
import { PrismaService } from '@/modules/common/prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class RepresentativeService {
  constructor(
    private readonly repository: RepresentativeRepository,
    private readonly hashService: HashService,
    private readonly changelogService: ChangeLogService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async create(data: RepresentativeCreateFormData): Promise<RepresentativeResponse> {
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

    // Create representative
    const representative = await this.repository.create(
      {
        ...data,
        password: hashedPassword,
      } as any,
      {
        include: { customer: { include: { logo: true } } },
      },
    );

    // Log creation
    await this.changelogService.logChange({
      entityId: representative.id,
      entityType: ENTITY_TYPE.REPRESENTATIVE,
      action: CHANGE_ACTION.CREATE,
      newValue: representative,
      reason: 'Representante criado',
      triggeredBy: null,
      triggeredById: null,
      userId: null,
    });

    return representative;
  }

  async findById(
    id: string,
    options?: { include?: RepresentativeInclude },
  ): Promise<RepresentativeResponse> {
    const representative = await this.repository.findById(id, options);
    if (!representative) {
      throw new NotFoundException('Representante não encontrado');
    }
    return representative;
  }

  async findByEmail(email: string): Promise<RepresentativeResponse | null> {
    return await this.repository.findByEmail(email);
  }

  async findByPhone(phone: string): Promise<RepresentativeResponse | null> {
    return await this.repository.findByPhone(phone);
  }

  async findByCustomerIdAndRole(
    customerId: string,
    role: string,
  ): Promise<RepresentativeResponse | null> {
    return await this.repository.findByCustomerIdAndRole(customerId, role);
  }

  async findByCustomerId(
    customerId: string,
    options?: {
      include?: RepresentativeInclude;
      orderBy?: RepresentativeOrderBy;
    },
  ): Promise<RepresentativeResponse[]> {
    return await this.repository.findByCustomerId(customerId, options);
  }

  async findMany(options?: {
    skip?: number;
    take?: number;
    page?: number;
    pageSize?: number;
    search?: string;
    customerId?: string;
    role?: string;
    isActive?: boolean;
    where?: RepresentativeWhere;
    orderBy?: RepresentativeOrderBy;
    include?: RepresentativeInclude;
  }): Promise<{
    data: RepresentativeResponse[];
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
    let where: RepresentativeWhere = { ...options?.where };

    // Apply direct filters
    if (options?.customerId) {
      where.customerId = options.customerId;
    }
    if (options?.role) {
      where.role = options.role as any;
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
        include: options?.include || { customer: { include: { logo: true } } },
      }),
      this.repository.count(where),
    ]);

    const pageCount = Math.ceil(total / pageSize);

    return {
      data: data as RepresentativeResponse[],
      meta: {
        total,
        page,
        pageSize,
        pageCount,
      },
    };
  }

  async update(id: string, data: RepresentativeUpdateFormData): Promise<RepresentativeResponse> {
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

    // Update representative
    const updated = await this.repository.update(id, data, {
      include: { customer: { include: { logo: true } } },
    });

    // Log changes
    const changes = this.getChangedFields(existing, updated);
    for (const change of changes) {
      await this.changelogService.logChange({
        entityId: id,
        entityType: ENTITY_TYPE.REPRESENTATIVE,
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
    const representative = await this.findById(id);

    await this.repository.delete(id);

    // Log deletion
    await this.changelogService.logChange({
      entityId: id,
      entityType: ENTITY_TYPE.REPRESENTATIVE,
      action: CHANGE_ACTION.DELETE,
      oldValue: representative,
      reason: 'Representante removido',
      triggeredBy: null,
      triggeredById: null,
      userId: null,
    });
  }

  async toggleActive(id: string): Promise<RepresentativeResponse> {
    const representative = await this.findById(id);
    const newStatus = !representative.isActive;

    const updated = await this.repository.update(
      id,
      {
        isActive: newStatus,
      } as any,
      {
        include: { customer: { include: { logo: true } } },
      },
    );

    // Log status change
    await this.changelogService.logChange({
      entityId: id,
      entityType: ENTITY_TYPE.REPRESENTATIVE,
      action: newStatus ? CHANGE_ACTION.ACTIVATE : CHANGE_ACTION.DEACTIVATE,
      field: 'isActive',
      oldValue: String(!newStatus),
      newValue: String(newStatus),
      reason: newStatus ? 'Representante ativado' : 'Representante desativado',
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

  async batchCreate(
    representatives: RepresentativeCreateFormData[],
  ): Promise<RepresentativeResponse[]> {
    const results: RepresentativeResponse[] = [];

    for (const data of representatives) {
      try {
        const created = await this.create(data);
        results.push(created);
      } catch (error) {
        // Log error but continue with other items
        console.error(`Failed to create representative: ${data.name}`, error);
      }
    }

    return results;
  }

  async batchUpdate(
    updates: Array<{ id: string; data: RepresentativeUpdateFormData }>,
  ): Promise<RepresentativeResponse[]> {
    const results: RepresentativeResponse[] = [];

    for (const { id, data } of updates) {
      try {
        const updated = await this.update(id, data);
        results.push(updated);
      } catch (error) {
        console.error(`Failed to update representative: ${id}`, error);
      }
    }

    return results;
  }

  async batchDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      try {
        await this.delete(id);
      } catch (error) {
        console.error(`Failed to delete representative: ${id}`, error);
      }
    }
  }

  async login(data: RepresentativeLoginFormData): Promise<{
    representative: RepresentativeResponse;
    token: string;
  }> {
    // Find representative by email or phone
    let representative: Representative | null = null;

    if (data.contact.includes('@')) {
      representative = await this.repository.findByEmail(data.contact);
    } else {
      representative = await this.repository.findByPhone(data.contact);
    }

    if (!representative) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // Check if representative has password (required for login)
    if (!representative.password) {
      throw new UnauthorizedException(
        'Este representante não possui acesso ao sistema. Entre em contato com o administrador.',
      );
    }

    // Check password
    const isPasswordValid = await this.hashService.compare(data.password, representative.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // Check if active
    if (!representative.isActive) {
      throw new UnauthorizedException('Conta desativada');
    }

    // Check if email is verified (only if email exists)
    if (representative.email && !representative.verified) {
      throw new UnauthorizedException('Conta não verificada');
    }

    // Generate session token
    const sessionToken = uuidv4();
    await this.repository.updateSessionToken(representative.id, sessionToken);

    // Generate JWT
    const token = this.jwtService.sign({
      id: representative.id,
      email: representative.email,
      role: representative.role,
      customerId: representative.customerId,
      type: 'representative',
    });

    return {
      representative: await this.findById(representative.id, {
        include: { customer: { include: { logo: true } } },
      }),
      token,
    };
  }

  async logout(representativeId: string): Promise<void> {
    await this.repository.updateSessionToken(representativeId, null);
  }

  async register(data: RepresentativeRegisterFormData): Promise<RepresentativeResponse> {
    const { passwordConfirmation, ...createData } = data;

    // Email is required for registration (system access)
    if (!createData.email) {
      throw new BadRequestException('Email é obrigatório para registro no sistema');
    }

    // Password is required for registration
    if (!createData.password) {
      throw new BadRequestException('Senha é obrigatória para registro no sistema');
    }

    // Create representative with system access
    const representative = await this.create(createData);

    // Generate verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpiresAt = new Date();
    verificationExpiresAt.setHours(verificationExpiresAt.getHours() + 1);

    await this.repository.update(representative.id, {
      verificationCode,
      verificationExpiresAt,
    } as any);

    // TODO: Send verification email

    return representative;
  }

  async verifyEmail(
    representativeId: string,
    verificationCode: string,
  ): Promise<RepresentativeResponse> {
    const representative = await this.findById(representativeId);

    if (representative.verified) {
      throw new BadRequestException('Conta já verificada');
    }

    if (representative.verificationCode !== verificationCode) {
      throw new BadRequestException('Código de verificação inválido');
    }

    if (representative.verificationExpiresAt && representative.verificationExpiresAt < new Date()) {
      throw new BadRequestException('Código de verificação expirado');
    }

    return await this.repository.update(representativeId, {
      verified: true,
      verificationCode: null,
      verificationExpiresAt: null,
    } as any);
  }

  async changePassword(
    representativeId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const representative = await this.findById(representativeId);

    if (!representative.password) {
      throw new BadRequestException('Este representante não possui senha definida');
    }

    // Verify old password
    const isOldPasswordValid = await this.hashService.compare(oldPassword, representative.password);

    if (!isOldPasswordValid) {
      throw new BadRequestException('Senha atual incorreta');
    }

    // Hash new password
    const hashedPassword = await this.hashService.hash(newPassword);

    await this.repository.update(representativeId, {
      password: hashedPassword,
    } as any);
  }

  async setPassword(representativeId: string, password: string): Promise<void> {
    const representative = await this.findById(representativeId);

    if (representative.password) {
      throw new BadRequestException(
        'Este representante já possui senha. Use a opção de alterar senha.',
      );
    }

    // Hash password
    const hashedPassword = await this.hashService.hash(password);

    await this.repository.update(representativeId, {
      password: hashedPassword,
    } as any);
  }

  async resetPassword(email: string): Promise<void> {
    const representative = await this.repository.findByEmail(email);
    if (!representative) {
      // Don't reveal if email exists
      return;
    }

    // Generate reset token
    const resetToken = uuidv4();
    const resetTokenExpiry = new Date();
    resetTokenExpiry.setHours(resetTokenExpiry.getHours() + 1);

    await this.repository.update(representative.id, {
      resetToken,
      resetTokenExpiry,
    } as any);

    // TODO: Send reset email
  }

  async confirmResetPassword(resetToken: string, newPassword: string): Promise<void> {
    const representative = await this.prisma.representative.findUnique({
      where: { resetToken },
    });

    if (!representative) {
      throw new BadRequestException('Token inválido');
    }

    if (representative.resetTokenExpiry && representative.resetTokenExpiry < new Date()) {
      throw new BadRequestException('Token expirado');
    }

    // Hash new password
    const hashedPassword = await this.hashService.hash(newPassword);

    await this.repository.update(representative.id, {
      password: hashedPassword,
      resetToken: null,
      resetTokenExpiry: null,
    } as any);
  }

  private getRoleLabel(role: string): string {
    const labels = {
      COMMERCIAL: 'Comercial',
      MARKETING: 'Marketing',
      COORDINATOR: 'Coordenador',
      FINANCIAL: 'Financeiro',
      FLEET_MANAGER: 'Gestor de Frota',
    };
    return labels[role] || role;
  }

  private getChangedFields(
    oldData: any,
    newData: any,
  ): Array<{ field: string; oldValue: string; newValue: string }> {
    const changes: Array<{ field: string; oldValue: string; newValue: string }> = [];
    const fields = ['name', 'email', 'phone', 'role', 'isActive', 'customerId'];

    for (const field of fields) {
      if (oldData[field] !== newData[field]) {
        changes.push({
          field,
          oldValue: String(oldData[field] || ''),
          newValue: String(newData[field] || ''),
        });
      }
    }

    return changes;
  }
}
