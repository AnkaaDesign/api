import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/modules/common/prisma/prisma.service';
import { ResponsibleRepository } from './responsible.repository';
import {
  Responsible,
  ResponsibleCreateFormData,
  ResponsibleUpdateFormData,
  ResponsibleInclude,
  ResponsibleOrderBy,
  ResponsibleWhere,
} from '@/types/responsible';
import { PrismaTransaction } from '@/modules/common/base/base.repository';
import { Prisma, ResponsibleRole } from '@prisma/client';

@Injectable()
export class ResponsiblePrismaRepository extends ResponsibleRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(
    data: ResponsibleCreateFormData,
    options?: { include?: ResponsibleInclude },
    tx?: PrismaTransaction,
  ): Promise<Responsible> {
    const client = tx || this.prisma;
    const { companyId, ...restData } = data;

    // Map companyId to company relation or use companyId directly for unchecked input
    const createData: Prisma.ResponsibleUncheckedCreateInput = {
      ...restData,
      companyId: companyId ?? null,
    };

    return await client.responsible.create({
      data: createData,
      include: options?.include,
    });
  }

  async findById(
    id: string,
    options?: { include?: ResponsibleInclude },
    tx?: PrismaTransaction,
  ): Promise<Responsible | null> {
    const client = tx || this.prisma;
    return await client.responsible.findUnique({
      where: { id },
      include: options?.include,
    });
  }

  async findByEmail(email: string, tx?: PrismaTransaction): Promise<Responsible | null> {
    const client = tx || this.prisma;
    return await client.responsible.findUnique({
      where: { email },
    });
  }

  async findByPhone(phone: string, tx?: PrismaTransaction): Promise<Responsible | null> {
    const client = tx || this.prisma;
    return await client.responsible.findUnique({
      where: { phone },
    });
  }

  // Returns a LIST: now that a contact can hold several roles, "the COMMERCIAL
  // responsible of company X" is no longer unique.
  async findByCompanyIdAndRole(
    companyId: string,
    role: ResponsibleRole,
    tx?: PrismaTransaction,
  ): Promise<Responsible[]> {
    const client = tx || this.prisma;
    return await client.responsible.findMany({
      where: {
        companyId,
        roles: { has: role },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findByCompanyId(
    companyId: string,
    options?: {
      include?: ResponsibleInclude;
      orderBy?: ResponsibleOrderBy;
    },
    tx?: PrismaTransaction,
  ): Promise<Responsible[]> {
    const client = tx || this.prisma;
    return await client.responsible.findMany({
      where: { companyId },
      include: options?.include,
      // Was `{ role: 'asc' }`. Prisma cannot orderBy a scalar list, and this
      // default fires on every GET /responsibles/company/:id, so leaving it
      // would 500 the endpoint unconditionally.
      orderBy: options?.orderBy || { name: 'asc' },
    });
  }

  async findMany(
    options?: {
      skip?: number;
      take?: number;
      where?: ResponsibleWhere;
      orderBy?: ResponsibleOrderBy;
      include?: ResponsibleInclude;
    },
    tx?: PrismaTransaction,
  ): Promise<Responsible[]> {
    const client = tx || this.prisma;

    const where: Prisma.ResponsibleWhereInput = {};
    if (options?.where) {
      const { name, company, OR, ...rest } = options.where as any;
      Object.assign(where, rest);

      if (name?.contains) {
        where.name = { contains: name.contains, mode: 'insensitive' };
      }

      if (company?.fantasyName?.contains) {
        where.company = {
          fantasyName: {
            contains: company.fantasyName.contains,
            mode: 'insensitive',
          },
        };
      }

      // Handle OR conditions for search
      if (OR) {
        where.OR = OR;
      }
    }

    return await client.responsible.findMany({
      skip: options?.skip,
      take: options?.take,
      where,
      orderBy: options?.orderBy,
      include: options?.include,
    });
  }

  async update(
    id: string,
    data: ResponsibleUpdateFormData,
    options?: { include?: ResponsibleInclude },
    tx?: PrismaTransaction,
  ): Promise<Responsible> {
    const client = tx || this.prisma;
    return await client.responsible.update({
      where: { id },
      data,
      include: options?.include,
    });
  }

  async delete(id: string, tx?: PrismaTransaction): Promise<Responsible> {
    const client = tx || this.prisma;
    return await client.responsible.delete({
      where: { id },
    });
  }

  async count(where?: ResponsibleWhere, tx?: PrismaTransaction): Promise<number> {
    const client = tx || this.prisma;

    const prismaWhere: Prisma.ResponsibleWhereInput = {};
    if (where) {
      const { name, company, OR, ...rest } = where as any;
      Object.assign(prismaWhere, rest);

      if (name?.contains) {
        prismaWhere.name = { contains: name.contains, mode: 'insensitive' };
      }

      if (company?.fantasyName?.contains) {
        prismaWhere.company = {
          fantasyName: {
            contains: company.fantasyName.contains,
            mode: 'insensitive',
          },
        };
      }

      if (OR) {
        prismaWhere.OR = OR;
      }
    }

    return await client.responsible.count({ where: prismaWhere });
  }

}
