// packages/types/src/activity.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { ACTIVITY_OPERATION, ACTIVITY_REASON, ORDER_BY_DIRECTION } from '@constants';
import type { Item, ItemIncludes, ItemOrderBy } from './item';
import type { User, UserIncludes, UserOrderBy } from './user';
import type {
  Order,
  OrderIncludes,
  OrderOrderBy,
  OrderItem,
  OrderItemIncludes,
  OrderItemOrderBy,
} from './order';

// =====================
// Main Entity Interface
// =====================

export interface Activity extends BaseEntity {
  quantity: number;
  operation: ACTIVITY_OPERATION;
  userId: string | null;
  itemId: string;
  orderId: string | null;
  orderItemId: string | null;
  reason: ACTIVITY_REASON;
  reasonOrder: number | null; // 1=Pedido Recebido, 2=Uso em Produção, 3=Entrega de PPE, 4=Empréstimo, 5=Devolução, 6=Retirada Externa, 7=Retorno de Retirada Externa, 8=Contagem de Inventário, 9=Ajuste Manual, 10=Manutenção, 11=Dano, 12=Perda, 13=Produção de Tinta, 14=Outro

  // Relations
  item?: Item;
  user?: User;
  order?: Order;
  orderItem?: OrderItem;
}

// =====================
// Select Types
// =====================

export interface ActivitySelect {
  // Activity direct fields
  id?: boolean;
  quantity?: boolean;
  operation?: boolean;
  userId?: boolean;
  itemId?: boolean;
  orderId?: boolean;
  orderItemId?: boolean;
  reason?: boolean;
  reasonOrder?: boolean;
  createdAt?: boolean;
  updatedAt?: boolean;

  // Relations with nested select/include
  item?:
    | boolean
    | {
        select?: {
          id?: boolean;
          name?: boolean;
          uniCode?: boolean;
          currentStock?: boolean;
          minStock?: boolean;
          maxStock?: boolean;
          supplierId?: boolean;
          categoryId?: boolean;
          brandId?: boolean;
          brand?: boolean | { select?: Record<string, boolean> };
          category?: boolean | { select?: Record<string, boolean> };
          supplier?: boolean | { select?: Record<string, boolean> };
        };
        include?: ItemIncludes;
      };
  user?:
    | boolean
    | {
        select?: {
          id?: boolean;
          name?: boolean;
          email?: boolean;
          phone?: boolean;
          status?: boolean;
          positionId?: boolean;
          sectorId?: boolean;
          position?: boolean | { select?: Record<string, boolean> };
          sector?: boolean | { select?: Record<string, boolean> };
        };
        include?: UserIncludes;
      };
  order?:
    | boolean
    | {
        select?: {
          id?: boolean;
          description?: boolean;
          status?: boolean;
          forecast?: boolean;
          supplierId?: boolean;
          supplier?: boolean | { select?: Record<string, boolean> };
        };
        include?: OrderIncludes;
      };
  orderItem?:
    | boolean
    | {
        select?: {
          id?: boolean;
          orderedQuantity?: boolean;
          receivedQuantity?: boolean;
          unitPrice?: boolean;
          itemId?: boolean;
          orderId?: boolean;
          item?: boolean | { select?: Record<string, boolean> };
          order?: boolean | { select?: Record<string, boolean> };
        };
        include?: OrderItemIncludes;
      };
  _count?:
    | boolean
    | {
        select?: {
          [key: string]: boolean;
        };
      };
}

// =====================
// Include Types
// =====================

export interface ActivityIncludes {
  item?:
    | boolean
    | {
        include?: ItemIncludes;
      };
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
  order?:
    | boolean
    | {
        include?: OrderIncludes;
      };
  orderItem?:
    | boolean
    | {
        include?: OrderItemIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface ActivityOrderBy {
  id?: ORDER_BY_DIRECTION;
  quantity?: ORDER_BY_DIRECTION;
  operation?: ORDER_BY_DIRECTION;
  reason?: ORDER_BY_DIRECTION;
  reasonOrder?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  item?: ItemOrderBy;
  user?: UserOrderBy;
  order?: OrderOrderBy;
  orderItem?: OrderItemOrderBy;
}

// =====================
// Response Interfaces
// =====================

export interface ActivityGetUniqueResponse extends BaseGetUniqueResponse<Activity> {}
export interface ActivityGetManyResponse extends BaseGetManyResponse<Activity> {}
export interface ActivityCreateResponse extends BaseCreateResponse<Activity> {}
export interface ActivityUpdateResponse extends BaseUpdateResponse<Activity> {}
export interface ActivityDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface ActivityBatchCreateResponse<T> extends BaseBatchResponse<Activity, T> {}
export interface ActivityBatchUpdateResponse<T> extends BaseBatchResponse<
  Activity,
  T & { id: string }
> {}
export interface ActivityBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// =====================
// Optimized Select Types for Different Views
// =====================

// Table view - minimal fields for list display
export type ActivitySelectTable = {
  select: {
    id: true;
    quantity: true;
    operation: true;
    reason: true;
    reasonOrder: true;
    createdAt: true;
    userId: true;
    itemId: true;
    orderId: true;
    item?: {
      select: {
        id: true;
        name: true;
        uniCode: true;
        brand?: {
          select: {
            id: true;
            name: true;
          };
        };
        category?: {
          select: {
            id: true;
            name: true;
          };
        };
      };
    };
    user?: {
      select: {
        id: true;
        name: true;
        email: true;
      };
    };
  };
};

// Form view - fields needed for form editing
export type ActivitySelectForm = {
  select: {
    id: true;
    quantity: true;
    operation: true;
    userId: true;
    itemId: true;
    orderId: true;
    orderItemId: true;
    reason: true;
    reasonOrder: true;
    createdAt: true;
    updatedAt: true;
    item?: {
      select: {
        id: true;
        name: true;
        uniCode: true;
        currentStock: true;
      };
    };
    user?: {
      select: {
        id: true;
        name: true;
        email: true;
      };
    };
  };
};

// Detail view - comprehensive fields for detailed display
export type ActivitySelectDetail = {
  select: {
    id: true;
    quantity: true;
    operation: true;
    userId: true;
    itemId: true;
    orderId: true;
    orderItemId: true;
    reason: true;
    reasonOrder: true;
    createdAt: true;
    updatedAt: true;
    item?: {
      select: {
        id: true;
        name: true;
        uniCode: true;
        currentStock: true;
        minStock: true;
        maxStock: true;
        brand?: {
          select: {
            id: true;
            name: true;
          };
        };
        category?: {
          select: {
            id: true;
            name: true;
          };
        };
        supplier?: {
          select: {
            id: true;
            fantasyName: true;
            corporateName: true;
          };
        };
      };
    };
    user?: {
      select: {
        id: true;
        name: true;
        email: true;
        phone: true;
        position?: {
          select: {
            id: true;
            name: true;
          };
        };
        sector?: {
          select: {
            id: true;
            name: true;
          };
        };
      };
    };
    order?: {
      select: {
        id: true;
        description: true;
        status: true;
        forecast: true;
        supplier?: {
          select: {
            id: true;
            fantasyName: true;
          };
        };
      };
    };
    orderItem?: {
      select: {
        id: true;
        orderedQuantity: true;
        receivedQuantity: true;
        unitPrice: true;
        item?: {
          select: {
            id: true;
            name: true;
            uniCode: true;
          };
        };
      };
    };
  };
};

// Minimal view - only essential fields (for performance-critical queries)
export type ActivitySelectMinimal = {
  select: {
    id: true;
    quantity: true;
    operation: true;
    reason: true;
    createdAt: true;
    itemId: true;
    userId: true;
  };
};

// Export view - fields needed for export functionality
export type ActivitySelectExport = {
  select: {
    id: true;
    quantity: true;
    operation: true;
    reason: true;
    reasonOrder: true;
    createdAt: true;
    updatedAt: true;
    item: {
      select: {
        id: true;
        name: true;
        uniCode: true;
        brand?: {
          select: {
            name: true;
          };
        };
        category?: {
          select: {
            name: true;
          };
        };
        supplier?: {
          select: {
            fantasyName: true;
          };
        };
      };
    };
    user?: {
      select: {
        id: true;
        name: true;
        email: true;
      };
    };
    order?: {
      select: {
        id: true;
        description: true;
      };
    };
  };
};

// =====================
// Helper Type Utilities
// =====================

// Utility type to extract the return type based on select
export type ActivityWithSelect<S extends ActivitySelect> = {
  [K in keyof S]: S[K] extends true
    ? K extends keyof Activity
      ? Activity[K]
      : never
    : S[K] extends { select: any }
    ? any // Relations with nested select
    : never;
};

// Utility type for partial activity with selected fields
export type PartialActivity<T extends Partial<ActivitySelect>> = Pick<
  Activity,
  {
    [K in keyof T]: T[K] extends true ? (K extends keyof Activity ? K : never) : never;
  }[keyof T]
>;

// =====================
// View-specific Activity Types
// =====================

// Activity type optimized for table display
export type ActivityTable = Pick<
  Activity,
  'id' | 'quantity' | 'operation' | 'reason' | 'reasonOrder' | 'createdAt' | 'userId' | 'itemId' | 'orderId'
> & {
  item?: Pick<Item, 'id' | 'name' | 'uniCode'> & {
    brand?: Pick<Item['brand'], 'id' | 'name'>;
    category?: Pick<Item['category'], 'id' | 'name'>;
  };
  user?: Pick<User, 'id' | 'name' | 'email'>;
};

// Activity type optimized for form editing
export type ActivityForm = Pick<
  Activity,
  | 'id'
  | 'quantity'
  | 'operation'
  | 'userId'
  | 'itemId'
  | 'orderId'
  | 'orderItemId'
  | 'reason'
  | 'reasonOrder'
  | 'createdAt'
  | 'updatedAt'
> & {
  item?: Pick<Item, 'id' | 'name' | 'uniCode'> & { currentStock?: number };
  user?: Pick<User, 'id' | 'name' | 'email'>;
};

// Activity type optimized for detailed view
export type ActivityDetail = Activity & {
  item?: Item & {
    brand?: { id: string; name: string };
    category?: { id: string; name: string };
    supplier?: { id: string; fantasyName: string; corporateName: string };
  };
  user?: User & {
    position?: { id: string; name: string };
    sector?: { id: string; name: string };
  };
  order?: Order & {
    supplier?: { id: string; fantasyName: string };
  };
  orderItem?: OrderItem & {
    item?: { id: string; name: string; uniCode: string };
  };
};

// Activity type optimized for minimal queries
export type ActivityMinimal = Pick<
  Activity,
  'id' | 'quantity' | 'operation' | 'reason' | 'createdAt' | 'itemId' | 'userId'
>;

// =====================
// Constants for Select Queries
// =====================

// Pre-defined select objects for common use cases
export const ACTIVITY_SELECT_TABLE: ActivitySelectTable = {
  select: {
    id: true,
    quantity: true,
    operation: true,
    reason: true,
    reasonOrder: true,
    createdAt: true,
    userId: true,
    itemId: true,
    orderId: true,
    item: {
      select: {
        id: true,
        name: true,
        uniCode: true,
        brand: {
          select: {
            id: true,
            name: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    },
    user: {
      select: {
        id: true,
        name: true,
        email: true,
      },
    },
  },
};

export const ACTIVITY_SELECT_FORM: ActivitySelectForm = {
  select: {
    id: true,
    quantity: true,
    operation: true,
    userId: true,
    itemId: true,
    orderId: true,
    orderItemId: true,
    reason: true,
    reasonOrder: true,
    createdAt: true,
    updatedAt: true,
    item: {
      select: {
        id: true,
        name: true,
        uniCode: true,
        currentStock: true,
      },
    },
    user: {
      select: {
        id: true,
        name: true,
        email: true,
      },
    },
  },
};

export const ACTIVITY_SELECT_MINIMAL: ActivitySelectMinimal = {
  select: {
    id: true,
    quantity: true,
    operation: true,
    reason: true,
    createdAt: true,
    itemId: true,
    userId: true,
  },
};
