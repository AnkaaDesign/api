import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { Prisma, GitCommit } from '@prisma/client';

export type PrismaTransaction = Omit<
  PrismaService,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'
>;

@Injectable()
export class GitCommitRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.GitCommitCreateInput,
    options?: { tx?: PrismaTransaction; include?: Prisma.GitCommitInclude },
  ): Promise<GitCommit> {
    const prisma = options?.tx || this.prisma;
    return prisma.gitCommit.create({
      data,
      include: options?.include,
    });
  }

  async findById(
    id: string,
    options?: { include?: Prisma.GitCommitInclude },
  ): Promise<GitCommit | null> {
    return this.prisma.gitCommit.findUnique({
      where: { id },
      include: options?.include,
    });
  }

  async findByHash(
    repositoryId: string,
    hash: string,
    options?: { include?: Prisma.GitCommitInclude },
  ): Promise<GitCommit | null> {
    return this.prisma.gitCommit.findUnique({
      where: { repositoryId_hash: { repositoryId, hash } },
      include: options?.include,
    });
  }

  async findMany(options: {
    where?: Prisma.GitCommitWhereInput;
    include?: Prisma.GitCommitInclude;
    orderBy?: Prisma.GitCommitOrderByWithRelationInput;
    skip?: number;
    take?: number;
  }): Promise<{ data: GitCommit[]; total: number }> {
    const [data, total] = await Promise.all([
      this.prisma.gitCommit.findMany(options),
      this.prisma.gitCommit.count({ where: options.where }),
    ]);

    return { data, total };
  }

  async update(
    id: string,
    data: Prisma.GitCommitUpdateInput,
    options?: { tx?: PrismaTransaction; include?: Prisma.GitCommitInclude },
  ): Promise<GitCommit> {
    const prisma = options?.tx || this.prisma;
    return prisma.gitCommit.update({
      where: { id },
      data,
      include: options?.include,
    });
  }

  async delete(
    id: string,
    options?: { tx?: PrismaTransaction },
  ): Promise<GitCommit> {
    const prisma = options?.tx || this.prisma;
    return prisma.gitCommit.delete({
      where: { id },
    });
  }
}
