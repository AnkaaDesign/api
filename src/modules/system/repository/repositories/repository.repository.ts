import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { Prisma, Repository } from '@prisma/client';

export type PrismaTransaction = Omit<
  PrismaService,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'
>;

@Injectable()
export class RepositoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.RepositoryCreateInput,
    options?: { tx?: PrismaTransaction; include?: Prisma.RepositoryInclude },
  ): Promise<Repository> {
    const prisma = options?.tx || this.prisma;
    return prisma.repository.create({
      data,
      include: options?.include,
    });
  }

  async findById(
    id: string,
    options?: { include?: Prisma.RepositoryInclude },
  ): Promise<Repository | null> {
    return this.prisma.repository.findUnique({
      where: { id },
      include: options?.include,
    });
  }

  async findByName(
    name: string,
    options?: { include?: Prisma.RepositoryInclude },
  ): Promise<Repository | null> {
    return this.prisma.repository.findUnique({
      where: { name },
      include: options?.include,
    });
  }

  async findMany(options: {
    where?: Prisma.RepositoryWhereInput;
    include?: Prisma.RepositoryInclude;
    orderBy?: Prisma.RepositoryOrderByWithRelationInput;
    skip?: number;
    take?: number;
  }): Promise<{ data: Repository[]; total: number }> {
    const [data, total] = await Promise.all([
      this.prisma.repository.findMany(options),
      this.prisma.repository.count({ where: options.where }),
    ]);

    return { data, total };
  }

  async update(
    id: string,
    data: Prisma.RepositoryUpdateInput,
    options?: { tx?: PrismaTransaction; include?: Prisma.RepositoryInclude },
  ): Promise<Repository> {
    const prisma = options?.tx || this.prisma;
    return prisma.repository.update({
      where: { id },
      data,
      include: options?.include,
    });
  }

  async delete(
    id: string,
    options?: { tx?: PrismaTransaction },
  ): Promise<Repository> {
    const prisma = options?.tx || this.prisma;
    return prisma.repository.delete({
      where: { id },
    });
  }
}
