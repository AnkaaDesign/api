import { Injectable } from '@nestjs/common';
import type { Invoice, InvoiceInclude, InvoiceOrderBy, InvoiceWhere } from '@types';

/**
 * Abstract repository for Invoice entity.
 * Defines the contract for data access operations on invoices.
 */
@Injectable()
export abstract class InvoiceRepository {
  abstract findMany(params: {
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
  }>;

  abstract findById(id: string, include?: InvoiceInclude): Promise<Invoice | null>;

  abstract findByTaskId(taskId: string, include?: InvoiceInclude): Promise<Invoice[]>;

  abstract findByCustomerId(customerId: string, include?: InvoiceInclude): Promise<Invoice[]>;

  abstract create(data: any): Promise<Invoice>;

  abstract update(id: string, data: any): Promise<Invoice>;

  abstract delete(id: string): Promise<Invoice>;
}
