// packages/interfaces/src/task-quote.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { ORDER_BY_DIRECTION } from '@constants';
import type { Task, TaskIncludes, TaskOrderBy } from './task';
import type { TaskQuoteService } from './task-quote-service';
import type { TaskQuoteCustomerConfig } from './task-quote-customer-config';
import type { File } from './file';

// =====================
// TaskQuote Status Enum (mirrored from constants)
// =====================

export type TASK_QUOTE_STATUS =
  | 'PENDING'
  | 'SIGNED'
  | 'EXPIRED'
  | 'BUDGET_APPROVED'
  | 'BILLING_APPROVED'
  | 'UPCOMING'
  | 'DUE'
  | 'PARTIAL'
  | 'SETTLED'
  | 'CANCELLED';
export type DISCOUNT_TYPE = 'NONE' | 'PERCENTAGE' | 'FIXED_VALUE';

/**
 * JUNTO OU SEPARADO (`QuoteBillingSplit` no schema).
 *
 * `JOINT`: uma fatura, um plano de parcelas e uma NFS-e para os N veículos —
 * o padrão, e byte a byte o comportamento anterior ao orçamento multitarefa.
 * `PER_TASK`: uma fatia de faturamento POR VEÍCULO, aprovada veículo a veículo,
 * porque os sessenta caminhões não terminam no mesmo dia.
 */
export type QUOTE_BILLING_SPLIT = 'JOINT' | 'PER_TASK';

// =====================
// TaskQuote Interface
// =====================

export interface TaskQuote extends BaseEntity {
  budgetNumber: number; // Auto-generated sequential number for display
  subtotal: number; // Aggregate: sum of config subtotals
  total: number; // Aggregate: sum of config totals
  expiresAt: Date;
  status: TASK_QUOTE_STATUS;
  statusOrder: number;

  // Guarantee Terms
  guaranteeYears: number | null;
  customGuaranteeText: string | null;

  // Custom Forecast - manual override for production days displayed in budget
  customForecastDays: number | null;

  // Layout Files (max 2)
  layoutFiles?: File[];

  simultaneousTasks: number | null;

  /**
   * JUNTO OU SEPARADO — uma fatura para os N veículos (`JOINT`, o padrão e o
   * comportamento de sempre) ou uma por veículo (`PER_TASK`).
   */
  billingSplit: QUOTE_BILLING_SPLIT;

  /**
   * QUANTOS VEÍCULOS o orçamento cobre — o "× N" do documento e o DIVISOR de
   * [total].
   *
   * Coluna desnormalizada (a API a mantém em `recalcQuoteTotals`) e não um
   * `_count`: um `select` existente ganha o campo com uma linha, e as listas —
   * que pedem escalares do orçamento e nunca a relação de veículos — não teriam
   * como dividir sem ela.
   */
  vehicleCount: number;

  /** Quando a ÚLTIMA fatia de faturamento fechou. */
  billingApprovedAt?: Date | null;

  // Relations
  /**
   * @deprecated Um orçamento cobre N veículos desde a migração
   * `20260903120000_multitask_quote`: use [tasks]. Mantido para o código que só
   * precisa de UMA tarefa de âncora (um link, um rótulo) — nunca para dinheiro,
   * documento ou decisão de faturamento, onde a resposta é a lista inteira.
   */
  task?: Task;
  /** OS VEÍCULOS deste orçamento, na ordem do documento (`createdAt`, `id`). */
  tasks?: Task[];
  services?: TaskQuoteService[];
  customerConfigs?: TaskQuoteCustomerConfig[];
}

// =====================
// Include Types
// =====================

export interface TaskQuoteIncludes {
  /** @deprecated Ver `TaskQuote.task`. O servidor ainda ACEITA e traduz. */
  task?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  /** OS VEÍCULOS. `select` além de `include` porque as listas pedem só o id. */
  tasks?:
    | boolean
    | {
        include?: TaskIncludes;
        select?: Record<string, unknown>;
        orderBy?: Record<string, unknown> | Array<Record<string, unknown>>;
      };
  services?:
    | boolean
    | {
        orderBy?: {
          position?: 'asc' | 'desc';
        };
        include?: {
          invoiceToCustomer?:
            | boolean
            | { select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean } };
        };
      };
  layoutFiles?: boolean;
  customerConfigs?:
    | boolean
    | {
        include?: {
          customer?: boolean | { select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean } };
          customerSignature?: boolean;
          responsible?: boolean;
          installments?: boolean | { orderBy?: { number?: 'asc' | 'desc' } };
        };
      };
}

// Alias for backward compatibility
export type TaskQuoteInclude = TaskQuoteIncludes;

// =====================
// OrderBy Types
// =====================

export interface TaskQuoteOrderBy {
  id?: ORDER_BY_DIRECTION;
  total?: ORDER_BY_DIRECTION;
  expiresAt?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  taskId?: ORDER_BY_DIRECTION;
  simultaneousTasks?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  task?: TaskOrderBy;
}

// =====================
// Where/Filter Types
// =====================

export interface TaskQuoteWhere {
  id?: string | { in: string[] };
  taskId?: string;
  status?: TASK_QUOTE_STATUS | { in: TASK_QUOTE_STATUS[] };
  expiresAt?: Date | { gte?: Date; lte?: Date };
  simultaneousTasks?: number | { gte?: number; lte?: number; equals?: number };
  createdAt?: Date | { gte?: Date; lte?: Date };
}

// =====================
// Response Interfaces - TaskQuote
// =====================

export interface TaskQuoteGetUniqueResponse extends BaseGetUniqueResponse<TaskQuote> {}
export interface TaskQuoteGetManyResponse extends BaseGetManyResponse<TaskQuote> {}
export interface TaskQuoteCreateResponse extends BaseCreateResponse<TaskQuote> {}
export interface TaskQuoteUpdateResponse extends BaseUpdateResponse<TaskQuote> {}
export interface TaskQuoteDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses - TaskQuote
// =====================

export interface TaskQuoteBatchCreateResponse<T> extends BaseBatchResponse<TaskQuote, T> {}
export interface TaskQuoteBatchUpdateResponse<T> extends BaseBatchResponse<
  TaskQuote,
  T & { id: string }
> {}
export interface TaskQuoteBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
