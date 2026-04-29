import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { InvoiceRepository } from './invoice.repository';
import type { Invoice, InvoiceInclude, InvoiceOrderBy, InvoiceWhere } from '@types';
import { Prisma } from '@prisma/client';

/**
 * Prisma implementation of InvoiceRepository.
 * Handles all database operations for the Invoice entity via Prisma.
 */
@Injectable()
export class InvoicePrismaRepository implements InvoiceRepository {
  private readonly logger = new Logger(InvoicePrismaRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Default includes for invoice queries.
   * Provides installments with bankSlip, nfseDocuments, customer, and task.
   */
  private getDefaultInclude(): Prisma.InvoiceInclude {
    return {
      installments: {
        include: {
          bankSlip: { include: { pdfFile: true } },
          receiptFile: true,
        },
        orderBy: { number: 'asc' },
      },
      nfseDocuments: true,
      customer: {
        select: {
          id: true,
          fantasyName: true,
          cnpj: true,
        },
      },
      task: {
        select: {
          id: true,
          name: true,
          serialNumber: true,
        },
      },
    };
  }

  /**
   * Build Prisma include from domain InvoiceInclude.
   * Falls back to default includes when none specified.
   */
  private buildInclude(include?: InvoiceInclude): Prisma.InvoiceInclude {
    if (!include) return this.getDefaultInclude();

    const prismaInclude: Prisma.InvoiceInclude = {};

    if (include.installments) {
      if (typeof include.installments === 'boolean') {
        prismaInclude.installments = {
          include: { bankSlip: true },
          orderBy: { number: 'asc' as const },
        };
      } else {
        prismaInclude.installments = {
          include: {
            bankSlip: include.installments.include?.bankSlip ?? true,
          },
          orderBy: { number: 'asc' as const },
        };
      }
    }

    if (include.nfseDocuments) {
      prismaInclude.nfseDocuments = true;
    }

    if (include.customer) {
      prismaInclude.customer = {
        select: { id: true, fantasyName: true, cnpj: true },
      };
    }

    if (include.task) {
      prismaInclude.task = {
        select: { id: true, name: true, serialNumber: true },
      };
    }

    if (include.createdBy) {
      prismaInclude.createdBy = {
        select: { id: true, name: true },
      };
    }

    if (include.customerConfig) {
      prismaInclude.customerConfig = true;
    }

    return Object.keys(prismaInclude).length > 0 ? prismaInclude : this.getDefaultInclude();
  }

  /**
   * Build Prisma where clause from domain InvoiceWhere.
   */
  private buildWhere(where?: InvoiceWhere): Prisma.InvoiceWhereInput {
    if (!where) return {};

    const prismaWhere: Prisma.InvoiceWhereInput = {};

    if (where.taskId) prismaWhere.taskId = where.taskId;
    if (where.customerId) prismaWhere.customerId = where.customerId;
    if (where.createdById) prismaWhere.createdById = where.createdById;
    if (where.status) {
      if (Array.isArray(where.status)) {
        prismaWhere.status = { in: where.status as any[] };
      } else {
        prismaWhere.status = where.status as any;
      }
    }

    return prismaWhere;
  }

  /**
   * Build Prisma orderBy from domain InvoiceOrderBy.
   */
  private buildOrderBy(orderBy?: InvoiceOrderBy): Prisma.InvoiceOrderByWithRelationInput {
    if (!orderBy) return { createdAt: 'desc' };

    const prismaOrderBy: Prisma.InvoiceOrderByWithRelationInput = {};

    if (orderBy.createdAt) prismaOrderBy.createdAt = orderBy.createdAt;
    if (orderBy.totalAmount) prismaOrderBy.totalAmount = orderBy.totalAmount;
    if (orderBy.status) prismaOrderBy.status = orderBy.status;
    if (orderBy.paidAmount) prismaOrderBy.paidAmount = orderBy.paidAmount;

    return Object.keys(prismaOrderBy).length > 0 ? prismaOrderBy : { createdAt: 'desc' };
  }

  /**
   * Map a Prisma Invoice entity to the domain Invoice type.
   * Converts Decimal fields to numbers.
   */
  private mapToEntity(entity: any): Invoice {
    return {
      ...entity,
      totalAmount: entity.totalAmount ? Number(entity.totalAmount) : 0,
      paidAmount: entity.paidAmount ? Number(entity.paidAmount) : 0,
      installments: entity.installments?.map((inst: any) => ({
        ...inst,
        amount: inst.amount ? Number(inst.amount) : 0,
        paidAmount: inst.paidAmount ? Number(inst.paidAmount) : 0,
        bankSlip: inst.bankSlip
          ? {
              ...inst.bankSlip,
              amount: inst.bankSlip.amount ? Number(inst.bankSlip.amount) : 0,
              paidAmount: inst.bankSlip.paidAmount ? Number(inst.bankSlip.paidAmount) : null,
            }
          : null,
      })),
      nfseDocuments: entity.nfseDocuments ?? undefined,
    } as Invoice;
  }

  async findMany(params: {
    page?: number;
    limit?: number;
    orderBy?: InvoiceOrderBy;
    where?: InvoiceWhere;
    include?: InvoiceInclude;
  }): Promise<{
    data: Invoice[];
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  }> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const prismaWhere = this.buildWhere(params.where);
    const prismaOrderBy = this.buildOrderBy(params.orderBy);
    const prismaInclude = this.buildInclude(params.include);

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where: prismaWhere,
        orderBy: prismaOrderBy,
        include: prismaInclude,
        skip,
        take: limit,
      }),
      this.prisma.invoice.count({ where: prismaWhere }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map(entity => this.mapToEntity(entity)),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async findById(id: string, include?: InvoiceInclude): Promise<Invoice | null> {
    const entity = await this.prisma.invoice.findUnique({
      where: { id },
      include: this.buildInclude(include),
    });

    return entity ? this.mapToEntity(entity) : null;
  }

  async findByTaskId(taskId: string, include?: InvoiceInclude): Promise<Invoice[]> {
    const entities = await this.prisma.invoice.findMany({
      where: { taskId },
      include: this.buildInclude(include),
      orderBy: { createdAt: 'desc' },
    });

    return entities.map(entity => this.mapToEntity(entity));
  }

  async findByCustomerId(customerId: string, include?: InvoiceInclude): Promise<Invoice[]> {
    const entities = await this.prisma.invoice.findMany({
      where: { customerId },
      include: this.buildInclude(include),
      orderBy: { createdAt: 'desc' },
    });

    return entities.map(entity => this.mapToEntity(entity));
  }

  async create(data: any): Promise<Invoice> {
    const entity = await this.prisma.invoice.create({
      data,
      include: this.getDefaultInclude(),
    });

    return this.mapToEntity(entity);
  }

  async update(id: string, data: any): Promise<Invoice> {
    const entity = await this.prisma.invoice.update({
      where: { id },
      data,
      include: this.getDefaultInclude(),
    });

    return this.mapToEntity(entity);
  }

  async delete(id: string): Promise<Invoice> {
    const entity = await this.prisma.invoice.delete({
      where: { id },
      include: this.getDefaultInclude(),
    });

    return this.mapToEntity(entity);
  }
}
