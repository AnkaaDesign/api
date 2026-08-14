// packages/interfaces/src/airbrushing.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type {
  AIRBRUSHING_STATUS,
  AIRBRUSHING_PAYMENT_STATUS,
  AIRBRUSHING_DUE_DATE_RULE,
  PAYMENT_METHOD,
  ORDER_BY_DIRECTION,
  NFSE_STATUS,
} from '@constants';
import type { Task, TaskIncludes, TaskOrderBy } from './task';
import type { File, FileIncludes } from './file';
import type { Layout, LayoutIncludes } from './layout';
import type { User, UserIncludes, UserOrderBy } from './user';

// =====================
// Main Entity Interface
// =====================

export interface Airbrushing extends BaseEntity {
  /** Expected (planned) start date */
  startDate: Date | null;
  /** Expected (planned) finish date */
  finishDate: Date | null;
  /** Actual start timestamp */
  startedAt?: Date | null;
  /** Actual finish timestamp */
  finishedAt?: Date | null;
  price: number | null;
  /** Free-text job spec / notes for the airbrushing. */
  description?: string | null;
  status: AIRBRUSHING_STATUS; // "Pendente", "Em Produção", "Finalizado", "Cancelado"
  statusOrder: number; // 1=Pendente, 2=Em Produção, 3=Finalizado, 4=Cancelado
  paymentStatus?: AIRBRUSHING_PAYMENT_STATUS;
  /** Stamped when paymentStatus becomes PAID — windows "paid this month" on Contas a Pagar. */
  paidAt?: Date | null;
  /** Como o pintor é pago — alimenta a coluna "Forma" de Contas a Pagar. */
  paymentMethod?: PAYMENT_METHOD | null;
  /** Regra que deriva `dueDate` do término. Ver resolveAirbrushingDueDate(). */
  dueDateRule?: AIRBRUSHING_DUE_DATE_RULE;
  /** Prazo em dias da regra DAYS_AFTER_FINISH; null usa o padrão histórico de 7. */
  paymentTermDays?: number | null;
  /** Dia fixo (1-31) da regra DAY_OF_MONTH, truncado ao último dia do mês. */
  dueDayOfMonth?: number | null;
  /** Vencimento efetivo, materializado a cada escrita. É o que Contas a Pagar exibe. */
  dueDate?: Date | null;
  taskId: string;
  painterId?: string | null;
  invoiceIds?: string[];
  receiptIds?: string[];
  layoutIds?: string[];

  // Relations (optional, populated based on query)
  task?: Task;
  painter?: User | null;
  invoices?: File[];
  receipts?: File[];
  layouts?: Layout[];
  /**
   * NFS-e que o aerografista (prestador MEI) emite contra a Ankaa (tomadora)
   * quando esta aerografia é concluída. Não confundir com `invoices`, que são
   * arquivos de nota anexados à mão.
   */
  nfse?: AirbrushingNfse | null;
}

/**
 * NFS-e emitida pelo aerografista pelo Sistema Nacional (SEFIN), assinada com o
 * certificado A1 do próprio pintor. Uma por aerografia, no máximo.
 */
export interface AirbrushingNfse {
  id: string;
  airbrushingId: string;
  profileId: string | null;
  painterId: string | null;
  certificateId: string | null;
  status: NFSE_STATUS;
  /** 1 = Produção, 2 = Produção Restrita (homologação). */
  environment: number;
  serie: string | null;
  /** BigInt no banco; trafega como string para sobreviver ao JSON. */
  nDps: string | null;
  dpsId: string | null;
  /** Chave de acesso da NFS-e — 50 dígitos. */
  accessKey: string | null;
  nfseNumber: string | null;
  issuedAt: Date | null;
  competence: Date | null;
  serviceAmount: number | null;
  errorMessage: string | null;
  errorCode: string | null;
  errorCount: number;
  retryAfter: Date | null;
  lastAttemptAt: Date | null;
  cancelledAt: Date | null;
  cancelReasonCode: number | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// =====================
// Include Types
// =====================

export interface AirbrushingIncludes {
  task?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  painter?:
    | boolean
    | {
        include?: UserIncludes;
      };
  invoices?:
    | boolean
    | {
        include?: FileIncludes;
      };
  receipts?:
    | boolean
    | {
        include?: FileIncludes;
      };
  layouts?:
    | boolean
    | {
        include?: LayoutIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface AirbrushingOrderBy {
  id?: ORDER_BY_DIRECTION;
  startDate?: ORDER_BY_DIRECTION;
  finishDate?: ORDER_BY_DIRECTION;
  startedAt?: ORDER_BY_DIRECTION;
  finishedAt?: ORDER_BY_DIRECTION;
  price?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  paymentStatus?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  task?: TaskOrderBy;
  painterId?: ORDER_BY_DIRECTION;
  painter?: UserOrderBy;
}

// =====================
// Response Interfaces
// =====================

export interface AirbrushingGetUniqueResponse extends BaseGetUniqueResponse<Airbrushing> {}
export interface AirbrushingGetManyResponse extends BaseGetManyResponse<Airbrushing> {}
export interface AirbrushingCreateResponse extends BaseCreateResponse<Airbrushing> {}
export interface AirbrushingUpdateResponse extends BaseUpdateResponse<Airbrushing> {}
export interface AirbrushingDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface AirbrushingBatchCreateResponse<T> extends BaseBatchResponse<Airbrushing, T> {}
export interface AirbrushingBatchUpdateResponse<T> extends BaseBatchResponse<
  Airbrushing,
  T & { id: string }
> {}
export interface AirbrushingBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
