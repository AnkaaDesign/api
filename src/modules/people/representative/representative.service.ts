import { Injectable, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { RepresentativeRepository } from './repositories/representative.repository';
import { HashService } from '@/modules/common/hash/hash.service';
import { ChangeLogService } from '@/modules/common/changelog/changelog.service';
import {
  Representative,
  RepresentativeCreateFormData,
  RepresentativeUpdateFormData,
  RepresentativeLoginFormData,
  RepresentativeRegisterFormData,
  RepresentativeInclude,
  RepresentativeOrderBy,
  RepresentativeWhere,
  RepresentativeResponse,
} from '@/types/representative';
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

    // Check if representative already exists for this customer and role
    const existingRole = await this.repository.findByCustomerIdAndRole(
      data.customerId,
      data.role,
    );
    if (existingRole) {
      throw new BadRequestException(
        `Já existe um representante ${this.getRoleLabel(data.role)} para este cliente`,
      );
    }

    // Hash password if provided (only required for system access)
    let hashedPassword: string | undefined;
    if (data.password) {
      hashedPassword = await this.hashService.hash(data.password);
    }

    // Create representative
    const representative = await this.repository.create({
      ...data,
      password: hashedPassword,
    } as any, {
      include: { customer: true },
    });

    // Log creation
    await this.changelogService.create({
      entityId: representative.id,
      entityType: ENTITY_TYPE.REPRESENTATIVE,
      action: CHANGE_ACTION.CREATE,
      newValue: JSON.stringify(representative),
      userId: 'system', // Or get from context
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
    where?: RepresentativeWhere;
    orderBy?: RepresentativeOrderBy;
    include?: RepresentativeInclude;
  }): Promise<{
    data: RepresentativeResponse[];
    total: number;
  }> {
    const [data, total] = await Promise.all([
      this.repository.findMany(options),
      this.repository.count(options?.where),
    ]);

    return { data, total };
  }

  async update(
    id: string,
    data: RepresentativeUpdateFormData,
  ): Promise<RepresentativeResponse> {
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

    // If updating role, check if another representative exists for that role
    if (data.role && data.role !== existing.role && existing.customerId) {
      const roleExists = await this.repository.findByCustomerIdAndRole(
        existing.customerId,
        data.role,
      );
      if (roleExists && roleExists.id !== id) {
        throw new BadRequestException(
          `Já existe um representante ${this.getRoleLabel(data.role)} para este cliente`,
        );
      }
    }

    // Update representative
    const updated = await this.repository.update(id, data, {
      include: { customer: true },
    });

    // Log changes
    const changes = this.getChangedFields(existing, updated);
    for (const change of changes) {
      await this.changelogService.create({
        entityId: id,
        entityType: ENTITY_TYPE.REPRESENTATIVE,
        action: CHANGE_ACTION.UPDATE,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        userId: 'system', // Or get from context
      });
    }

    return updated;
  }

  async delete(id: string): Promise<void> {
    const representative = await this.findById(id);

    await this.repository.delete(id);

    // Log deletion
    await this.changelogService.create({
      entityId: id,
      entityType: ENTITY_TYPE.REPRESENTATIVE,
      action: CHANGE_ACTION.DELETE,
      oldValue: JSON.stringify(representative),
      userId: 'system', // Or get from context
    });
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
    const isPasswordValid = await this.hashService.compare(
      data.password,
      representative.password,
    );

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
        include: { customer: true },
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

    if (
      representative.verificationExpiresAt &&
      representative.verificationExpiresAt < new Date()
    ) {
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
    const isOldPasswordValid = await this.hashService.compare(
      oldPassword,
      representative.password,
    );

    if (!isOldPasswordValid) {
      throw new BadRequestException('Senha atual incorreta');
    }

    // Hash new password
    const hashedPassword = await this.hashService.hash(newPassword);

    await this.repository.update(representativeId, {
      password: hashedPassword,
    } as any);
  }

  async setPassword(
    representativeId: string,
    password: string,
  ): Promise<void> {
    const representative = await this.findById(representativeId);

    if (representative.password) {
      throw new BadRequestException('Este representante já possui senha. Use a opção de alterar senha.');
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

  async confirmResetPassword(
    resetToken: string,
    newPassword: string,
  ): Promise<void> {
    const representative = await this.prisma.representative.findUnique({
      where: { resetToken },
    });

    if (!representative) {
      throw new BadRequestException('Token inválido');
    }

    if (
      representative.resetTokenExpiry &&
      representative.resetTokenExpiry < new Date()
    ) {
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