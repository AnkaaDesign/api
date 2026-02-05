import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/modules/common/prisma/prisma.service';
import { RepresentativeRepository } from './representative.repository';
import {
  Representative,
  RepresentativeCreateFormData,
  RepresentativeUpdateFormData,
  RepresentativeInclude,
  RepresentativeOrderBy,
  RepresentativeWhere,
} from '@/types/representative';
import { PrismaTransaction } from '@/modules/common/base/base.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class RepresentativePrismaRepository extends RepresentativeRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(
    data: RepresentativeCreateFormData,
    options?: { include?: RepresentativeInclude },
    tx?: PrismaTransaction,
  ): Promise<Representative> {
    const client = tx || this.prisma;
    const { customerId, ...restData } = data;

    // Map customerId to customer relation or use customerId directly for unchecked input
    const createData: Prisma.RepresentativeUncheckedCreateInput = {
      ...restData,
      customerId: customerId ?? null,
    };

    return await client.representative.create({
      data: createData,
      include: options?.include,
    });
  }

  async findById(
    id: string,
    options?: { include?: RepresentativeInclude },
    tx?: PrismaTransaction,
  ): Promise<Representative | null> {
    const client = tx || this.prisma;
    return await client.representative.findUnique({
      where: { id },
      include: options?.include,
    });
  }

  async findByEmail(email: string, tx?: PrismaTransaction): Promise<Representative | null> {
    const client = tx || this.prisma;
    return await client.representative.findUnique({
      where: { email },
    });
  }

  async findByPhone(phone: string, tx?: PrismaTransaction): Promise<Representative | null> {
    const client = tx || this.prisma;
    return await client.representative.findUnique({
      where: { phone },
    });
  }

  async findByCustomerIdAndRole(
    customerId: string,
    role: string,
    tx?: PrismaTransaction,
  ): Promise<Representative | null> {
    const client = tx || this.prisma;
    return await client.representative.findUnique({
      where: {
        customerId_role: {
          customerId,
          role: role as any,
        },
      },
    });
  }

  async findByCustomerId(
    customerId: string,
    options?: {
      include?: RepresentativeInclude;
      orderBy?: RepresentativeOrderBy;
    },
    tx?: PrismaTransaction,
  ): Promise<Representative[]> {
    const client = tx || this.prisma;
    return await client.representative.findMany({
      where: { customerId },
      include: options?.include,
      orderBy: options?.orderBy || { role: 'asc' },
    });
  }

  async findMany(
    options?: {
      skip?: number;
      take?: number;
      where?: RepresentativeWhere;
      orderBy?: RepresentativeOrderBy;
      include?: RepresentativeInclude;
    },
    tx?: PrismaTransaction,
  ): Promise<Representative[]> {
    const client = tx || this.prisma;

    const where: Prisma.RepresentativeWhereInput = {};
    if (options?.where) {
      const { name, customer, OR, ...rest } = options.where as any;
      Object.assign(where, rest);

      if (name?.contains) {
        where.name = { contains: name.contains, mode: 'insensitive' };
      }

      if (customer?.fantasyName?.contains) {
        where.customer = {
          fantasyName: {
            contains: customer.fantasyName.contains,
            mode: 'insensitive',
          },
        };
      }

      // Handle OR conditions for search
      if (OR) {
        where.OR = OR;
      }
    }

    return await client.representative.findMany({
      skip: options?.skip,
      take: options?.take,
      where,
      orderBy: options?.orderBy,
      include: options?.include,
    });
  }

  async update(
    id: string,
    data: RepresentativeUpdateFormData,
    options?: { include?: RepresentativeInclude },
    tx?: PrismaTransaction,
  ): Promise<Representative> {
    const client = tx || this.prisma;
    return await client.representative.update({
      where: { id },
      data,
      include: options?.include,
    });
  }

  async delete(id: string, tx?: PrismaTransaction): Promise<Representative> {
    const client = tx || this.prisma;
    return await client.representative.delete({
      where: { id },
    });
  }

  async count(where?: RepresentativeWhere, tx?: PrismaTransaction): Promise<number> {
    const client = tx || this.prisma;

    const prismaWhere: Prisma.RepresentativeWhereInput = {};
    if (where) {
      const { name, customer, OR, ...rest } = where as any;
      Object.assign(prismaWhere, rest);

      if (name?.contains) {
        prismaWhere.name = { contains: name.contains, mode: 'insensitive' };
      }

      if (customer?.fantasyName?.contains) {
        prismaWhere.customer = {
          fantasyName: {
            contains: customer.fantasyName.contains,
            mode: 'insensitive',
          },
        };
      }

      if (OR) {
        prismaWhere.OR = OR;
      }
    }

    return await client.representative.count({ where: prismaWhere });
  }

  async findBySessionToken(
    sessionToken: string,
    tx?: PrismaTransaction,
  ): Promise<Representative | null> {
    const client = tx || this.prisma;
    return await client.representative.findUnique({
      where: { sessionToken },
      include: { customer: true },
    });
  }

  async updateSessionToken(
    id: string,
    sessionToken: string | null,
    tx?: PrismaTransaction,
  ): Promise<Representative> {
    const client = tx || this.prisma;
    return await client.representative.update({
      where: { id },
      data: {
        sessionToken,
        lastLoginAt: sessionToken ? new Date() : undefined,
      },
    });
  }
}
