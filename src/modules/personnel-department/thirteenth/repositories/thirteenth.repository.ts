// repositories/thirteenth.repository.ts
// Acesso a dados do 13º salário (Prisma). Mantém o serviço focado em
// orquestração/regra de negócio. Segue o estilo direct-prisma dos módulos
// irmãos (salary-adjustment / leave / medical-exam) — `where`/`include`/`data`
// permanecem permissivos (`any`) como no restante do HR, em vez do contrato
// abstrato pesado do BaseStringRepository, que não se encaixa aqui.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export const THIRTEENTH_DEFAULT_INCLUDE = {
  user: { include: { position: true, sector: true } },
  contract: true,
} as const;

@Injectable()
export class ThirteenthRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: PrismaTransaction) {
    return tx ?? this.prisma;
  }

  async findMany(args: {
    where?: any;
    orderBy?: any;
    include?: any;
    skip?: number;
    take?: number;
  }) {
    return this.prisma.thirteenth.findMany(args as any);
  }

  async count(where: any) {
    return this.prisma.thirteenth.count({ where });
  }

  async findById(id: string, include?: any, tx?: PrismaTransaction) {
    return this.client(tx).thirteenth.findUnique({
      where: { id },
      include: include ?? THIRTEENTH_DEFAULT_INCLUDE,
    });
  }

  async findByUserYearContract(
    userId: string,
    year: number,
    contractId: string | null,
    tx?: PrismaTransaction,
  ) {
    // contractId is nullable and Postgres treats NULL as distinct in unique
    // constraints, so findFirst (not findUnique on the compound key) is the
    // reliable lookup for both the null and non-null cases.
    return this.client(tx).thirteenth.findFirst({
      where: { userId, year, contractId },
    });
  }

  async create(data: any, include?: any, tx?: PrismaTransaction) {
    return this.client(tx).thirteenth.create({
      data,
      include: include ?? THIRTEENTH_DEFAULT_INCLUDE,
    });
  }

  async update(id: string, data: any, include?: any, tx?: PrismaTransaction) {
    return this.client(tx).thirteenth.update({
      where: { id },
      data,
      include: include ?? THIRTEENTH_DEFAULT_INCLUDE,
    });
  }

  async delete(id: string, tx?: PrismaTransaction) {
    return this.client(tx).thirteenth.delete({ where: { id } });
  }
}
