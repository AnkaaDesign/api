import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { Prisma, App } from '@prisma/client';

export type PrismaTransaction = Omit<
  PrismaService,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'
>;

@Injectable()
export class AppRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.AppCreateInput,
    options?: { tx?: PrismaTransaction; include?: Prisma.AppInclude },
  ): Promise<App> {
    const prisma = options?.tx || this.prisma;
    return prisma.app.create({
      data,
      include: options?.include,
    });
  }

  async findById(id: string, options?: { include?: Prisma.AppInclude }): Promise<App | null> {
    return this.prisma.app.findUnique({
      where: { id },
      include: options?.include,
    });
  }

  async findByName(name: string, options?: { include?: Prisma.AppInclude }): Promise<App | null> {
    return this.prisma.app.findUnique({
      where: { name },
      include: options?.include,
    });
  }

  async findMany(options: {
    where?: Prisma.AppWhereInput;
    include?: Prisma.AppInclude;
    orderBy?: Prisma.AppOrderByWithRelationInput;
    skip?: number;
    take?: number;
  }): Promise<{ data: App[]; total: number }> {
    const [data, total] = await Promise.all([
      this.prisma.app.findMany(options),
      this.prisma.app.count({ where: options.where }),
    ]);

    return { data, total };
  }

  async update(
    id: string,
    data: Prisma.AppUpdateInput,
    options?: { tx?: PrismaTransaction; include?: Prisma.AppInclude },
  ): Promise<App> {
    const prisma = options?.tx || this.prisma;
    return prisma.app.update({
      where: { id },
      data,
      include: options?.include,
    });
  }

  async delete(id: string, options?: { tx?: PrismaTransaction }): Promise<App> {
    const prisma = options?.tx || this.prisma;
    return prisma.app.delete({
      where: { id },
    });
  }
}
