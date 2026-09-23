// packages/interfaces/src/budget.ts

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
import type { BudgetItem } from './budget-item';
import type { BudgetPayer } from './budget-payer';
import type { File } from './file';

// =====================
// Budget Status Enum (mirrored from constants)
// =====================

// ⚠️ ESPELHO ESCRITO À MÃO do enum em `@constants`. O compilador não confere um
// contra o outro: estado que exista lá e falte aqui vira `never` numa comparação
// e some da tela sem erro nenhum. Mexeu num, mexa no outro.
export type TASK_QUOTE_STATUS =
  | 'EXPIRED'
  | 'SIGNED'
  | 'PENDING'
  | 'APPROVED'
  | 'CANCELLED';

/** O ciclo do FATURAMENTO — espelho de `BILLING_STATUS`, mesmo aviso acima. */
export type BILLING_STATUS =
  | 'OVERDUE'
  | 'PENDING'
  | 'APPROVED'
  | 'PARTIAL'
  | 'SETTLED'
  | 'CANCELLED';
export type DISCOUNT_TYPE = 'NONE' | 'PERCENTAGE' | 'FIXED_VALUE';

/**
 * JUNTO, SEPARADO OU EM LOTES (`QuoteBillingSplit` no schema).
 *
 * `JOINT`: uma fatura, um plano de parcelas e uma NFS-e para os N veículos —
 * o padrão, e byte a byte o comportamento anterior ao orçamento multitarefa.
 * `PER_TASK`: um faturamento POR VEÍCULO, aprovado veículo a veículo, porque os
 * sessenta caminhões não terminam no mesmo dia.
 * `CUSTOM`: lotes livres — a cobertura vem das linhas de `BillingTask`, não
 * do modo.
 */
export type QUOTE_BILLING_SPLIT = 'JOINT' | 'PER_TASK' | 'CUSTOM';

// =====================
// Budget Interface
// =====================

export interface Budget extends BaseEntity {
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

  // Layout Files — no máximo 2 em `SHARED`; em `PER_VEHICLE`, até 2 por veículo
  // e 20 distintas. Cada arte traz a sua cobertura em `quoteLayoutTasks`.
  layoutFiles?: Array<File & { quoteLayoutTasks?: Array<{ taskId: string }> }>;

  /**
   * De quem é cada arte: `SHARED` (todas valem para todos os veículos) ou
   * `PER_VEHICLE` (as linhas `quoteLayoutTasks` de cada arte são a verdade). Ver
   * `utils/quote-layout-coverage.ts`.
   */
  layoutScope?: 'SHARED' | 'PER_VEHICLE';

  simultaneousTasks: number | null;

  /**
   * COMO os N veículos são cobrados. É a INTENÇÃO declarada, não a cobertura:
   * quem diz de quais veículos cada fatura é são as linhas de
   * `Billing.tasks`. O modo serve para refatiar sozinho
   * quando um veículo entra ou sai do orçamento.
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
  services?: BudgetItem[];
  customerConfigs?: BudgetPayer[];
}

// =====================
// Include Types
// =====================

export interface BudgetIncludes {
  /** @deprecated Ver `Budget.task`. O servidor ainda ACEITA e traduz. */
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
  layoutFiles?: boolean | Record<string, unknown>;
  customerConfigs?:
    | boolean
    | {
        include?: {
          customer?: boolean | { select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean } };
          customerSignature?: boolean;
          // ⛔ NÃO devolva `responsible` aqui. A relação saiu de `BudgetPayer`
          // na migration `20260918120000`. Enquanto o TIPO a anunciava, o `tsc`
          // APROVAVA quem a escrevesse de novo — e foi exatamente assim que
          // duas telas do web nasceram em 500 (`task-detail-page.tsx` e
          // `billing/details/[id].tsx`). Quem responde pelo orçamento é
          // `Task.responsibles`. O lado web já tinha limpado o gêmeo dele.
          installments?: boolean | { orderBy?: { number?: 'asc' | 'desc' } };
          /**
           * O FATURAMENTO do pagador — dele vêm a COBERTURA e o estado.
           *
           * O zod (`budgetIncludeSchema`) já aceitava esta chave; faltava
           * aqui, e o tipo é o contrato que o servidor compila contra. Quem
           * precisa saber quais veículos uma fatia cobre (a detecção de
           * recomposição de lotes) não conseguia sequer pedir.
           *
           * Forma livre, como no zod: é a do Prisma (select/include aninhados), e
           * reescrevê-la criaria um segundo contrato para divergir do primeiro.
           */
          billing?: boolean | Record<string, unknown>;
        };
        /** Mesma razão, para quem monta o nó com `select` em vez de `include`. */
        select?: Record<string, unknown>;
      };
  /**
   * OS FATURAMENTOS do orçamento.
   *
   * ⚠️ Necessário para a trava do dinheiro (`isQuoteMoneyLocked`): sem ele a
   * função responde `false` e a gravação passa por cima de fatura, boleto e nota
   * já emitidos — em silêncio, porque `false` é uma resposta válida.
   */
  billings?:
    | boolean
    | {
        select?: Record<string, unknown>;
        include?: Record<string, unknown>;
        orderBy?: Record<string, unknown> | Array<Record<string, unknown>>;
      };
}

// Alias for backward compatibility
export type BudgetInclude = BudgetIncludes;

// =====================
// OrderBy Types
// =====================

export interface BudgetOrderBy {
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

export interface BudgetWhere {
  id?: string | { in: string[] };
  taskId?: string;
  status?: TASK_QUOTE_STATUS | { in: TASK_QUOTE_STATUS[] };
  expiresAt?: Date | { gte?: Date; lte?: Date };
  simultaneousTasks?: number | { gte?: number; lte?: number; equals?: number };
  createdAt?: Date | { gte?: Date; lte?: Date };
}

// =====================
// Response Interfaces - Budget
// =====================

export interface BudgetGetUniqueResponse extends BaseGetUniqueResponse<Budget> {}
export interface BudgetGetManyResponse extends BaseGetManyResponse<Budget> {}
export interface BudgetCreateResponse extends BaseCreateResponse<Budget> {}
export interface BudgetUpdateResponse extends BaseUpdateResponse<Budget> {}
export interface BudgetDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses - Budget
// =====================

export interface BudgetBatchCreateResponse<T> extends BaseBatchResponse<Budget, T> {}
export interface BudgetBatchUpdateResponse<T> extends BaseBatchResponse<
  Budget,
  T & { id: string }
> {}
export interface BudgetBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
