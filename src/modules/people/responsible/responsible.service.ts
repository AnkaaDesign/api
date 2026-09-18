import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ResponsibleRepository } from './repositories/responsible.repository';
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

// Re-exported for backwards compatibility. The values and labels live in
// @/constants/enums; this file used to keep a second copy that shadowed the
// Prisma `ResponsibleRole` type of the same name.
export { RESPONSIBLE_ROLE, RESPONSIBLE_ROLE_LABELS, formatResponsibleRoles };

@Injectable()
export class ResponsibleService {
  constructor(
    private readonly repository: ResponsibleRepository,
    private readonly changelogService: ChangeLogService,
    private readonly prisma: PrismaService,
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

    // `password` saiu do cadastro. O acesso do responsavel ao portal e' por OTP
    // (ResponsibleAuthService); nao ha credencial a definir no momento em que o
    // comercial cadastra o contato — e nao havia mesmo: das 183 fichas em
    // producao, nenhuma tinha senha.
    const { password: _ignoredLegacyPassword, ...payload } = data as typeof data & {
      password?: string;
    };

    // Create responsible
    const responsible = await this.repository.create(
      {
        ...payload,
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

  // Os metodos de senha (login/logout/register/verifyEmail/changePassword/
  // setPassword/resetPassword/confirmResetPassword) foram REMOVIDOS junto
  // com suas rotas. Nunca funcionaram e nunca foram usados: a producao
  // tinha 183 responsaveis e ZERO com senha, sessao, reset ou login.
  //
  // A autenticacao de responsavel vive agora em ResponsibleAuthService:
  // sessao por OTP, sem credencial em repouso.

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
