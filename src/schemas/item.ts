// packages/schemas/src/item.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  nullableString,
  createNameSchema,
  optionalNonNegativeNumber,
  optionalPositiveNumber,
} from './common';
import type { Item, ItemBrand, ItemCategory } from '@types';
import {
  MEASURE_UNIT,
  MEASURE_TYPE,
  ABC_CATEGORY,
  XYZ_CATEGORY,
  PPE_TYPE,
  PPE_SIZE,
  PPE_DELIVERY_MODE,
  STOCK_LEVEL,
  ITEM_CATEGORY_TYPE,
} from '@constants';
import { activityIncludeSchema, activityWhereSchema, activityOrderBySchema } from './activity';
import { borrowIncludeSchema, borrowWhereSchema, borrowOrderBySchema } from './borrow';
import { ppeDeliveryIncludeSchema, ppeDeliveryWhereSchema, ppeDeliveryOrderBySchema } from './epi';
import {
  monetaryValueIncludeSchema,
  monetaryValueWhereSchema,
  monetaryValueOrderBySchema,
} from './position';

// =====================
// Import Measure Schemas
// =====================
import { measureIncludeSchema, measureWhereSchema, measureOrderBySchema } from './measure';

// =====================
// Select Schemas for Partial Field Selection
// =====================

// ItemBrand Select Schema - for optimized queries
export const itemBrandSelectSchema = z
  .object({
    id: z.boolean().optional(),
    name: z.boolean().optional(),
    createdAt: z.boolean().optional(),
    updatedAt: z.boolean().optional(),
    items: z.boolean().optional(),
    _count: z.boolean().optional(),
  })
  .partial();

// ItemCategory Select Schema - for optimized queries
export const itemCategorySelectSchema = z
  .object({
    id: z.boolean().optional(),
    name: z.boolean().optional(),
    type: z.boolean().optional(),
    typeOrder: z.boolean().optional(),
    createdAt: z.boolean().optional(),
    updatedAt: z.boolean().optional(),
    items: z.boolean().optional(),
    orderSchedule: z.boolean().optional(),
    ppeSchedules: z.boolean().optional(),
    _count: z.boolean().optional(),
  })
  .partial();

// Item Select Schema - for optimized queries
export const itemSelectSchema = z
  .object({
    id: z.boolean().optional(),
    name: z.boolean().optional(),
    uniCode: z.boolean().optional(),
    quantity: z.boolean().optional(),
    maxQuantity: z.boolean().optional(),
    reorderPoint: z.boolean().optional(),
    reorderQuantity: z.boolean().optional(),
    boxQuantity: z.boolean().optional(),
    isManualMaxQuantity: z.boolean().optional(),
    isManualReorderPoint: z.boolean().optional(),
    lastAutoOrderDate: z.boolean().optional(),
    icms: z.boolean().optional(),
    ipi: z.boolean().optional(),
    totalPrice: z.boolean().optional(),
    monthlyConsumption: z.boolean().optional(),
    monthlyConsumptionTrendPercent: z.boolean().optional(),
    barcodes: z.boolean().optional(),
    shouldAssignToUser: z.boolean().optional(),
    abcCategory: z.boolean().optional(),
    abcCategoryOrder: z.boolean().optional(),
    xyzCategory: z.boolean().optional(),
    xyzCategoryOrder: z.boolean().optional(),
    brandId: z.boolean().optional(),
    categoryId: z.boolean().optional(),
    supplierId: z.boolean().optional(),
    estimatedLeadTime: z.boolean().optional(),
    isActive: z.boolean().optional(),
    ppeType: z.boolean().optional(),
    ppeSize: z.boolean().optional(),
    ppeCA: z.boolean().optional(),
    ppeDeliveryMode: z.boolean().optional(),
    ppeStandardQuantity: z.boolean().optional(),
    createdAt: z.boolean().optional(),
    updatedAt: z.boolean().optional(),
    // Relations
    brand: z.boolean().optional(),
    category: z.boolean().optional(),
    supplier: z.boolean().optional(),
    prices: z.boolean().optional(),
    measures: z.boolean().optional(),
    activities: z.boolean().optional(),
    borrows: z.boolean().optional(),
    orderItems: z.boolean().optional(),
    ppeDeliveries: z.boolean().optional(),
    orderRules: z.boolean().optional(),
    externalWithdrawalItems: z.boolean().optional(),
    relatedItems: z.boolean().optional(),
    relatedTo: z.boolean().optional(),
    maintenance: z.boolean().optional(),
    maintenanceItemsNeeded: z.boolean().optional(),
    formulaComponents: z.boolean().optional(),
    ppeSchedules: z.boolean().optional(),
    _count: z.boolean().optional(),
  })
  .partial();

// =====================
// Minimal Select Schemas for Comboboxes
// =====================

// Minimal item selection for comboboxes - only essential fields
export const itemComboboxSelectSchema = z.object({
  select: z
    .object({
      id: z.literal(true),
      name: z.literal(true),
      uniCode: z.literal(true).optional(),
      quantity: z.literal(true).optional(),
      isActive: z.literal(true).optional(),
      brand: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              name: z.literal(true),
            })
            .optional(),
        })
        .optional(),
      category: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              name: z.literal(true),
              type: z.literal(true).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

// Minimal brand selection for comboboxes
export const itemBrandComboboxSelectSchema = z.object({
  select: z
    .object({
      id: z.literal(true),
      name: z.literal(true),
    })
    .optional(),
});

// Minimal category selection for comboboxes
export const itemCategoryComboboxSelectSchema = z.object({
  select: z
    .object({
      id: z.literal(true),
      name: z.literal(true),
      type: z.literal(true).optional(),
    })
    .optional(),
});

// =====================
// Optimized Select Schemas for Forms
// =====================

// Item form selection - includes all fields needed for editing
export const itemFormSelectSchema = z.object({
  select: z
    .object({
      id: z.literal(true),
      name: z.literal(true),
      uniCode: z.literal(true),
      quantity: z.literal(true),
      maxQuantity: z.literal(true),
      reorderPoint: z.literal(true),
      reorderQuantity: z.literal(true),
      boxQuantity: z.literal(true),
      isManualMaxQuantity: z.literal(true),
      isManualReorderPoint: z.literal(true),
      lastAutoOrderDate: z.literal(true),
      icms: z.literal(true),
      ipi: z.literal(true),
      totalPrice: z.literal(true),
      monthlyConsumption: z.literal(true),
      monthlyConsumptionTrendPercent: z.literal(true),
      barcodes: z.literal(true),
      shouldAssignToUser: z.literal(true),
      abcCategory: z.literal(true),
      abcCategoryOrder: z.literal(true),
      xyzCategory: z.literal(true),
      xyzCategoryOrder: z.literal(true),
      brandId: z.literal(true),
      categoryId: z.literal(true),
      supplierId: z.literal(true),
      estimatedLeadTime: z.literal(true),
      isActive: z.literal(true),
      ppeType: z.literal(true),
      ppeSize: z.literal(true),
      ppeCA: z.literal(true),
      ppeDeliveryMode: z.literal(true),
      ppeStandardQuantity: z.literal(true),
      createdAt: z.literal(true),
      updatedAt: z.literal(true),
      brand: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              name: z.literal(true),
            })
            .optional(),
        })
        .optional(),
      category: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              name: z.literal(true),
              type: z.literal(true),
            })
            .optional(),
        })
        .optional(),
      supplier: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              name: z.literal(true),
              fantasyName: z.literal(true),
            })
            .optional(),
        })
        .optional(),
      measures: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              value: z.literal(true),
              unit: z.literal(true),
              measureType: z.literal(true),
            })
            .optional(),
        })
        .optional(),
      prices: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              value: z.literal(true),
              createdAt: z.literal(true),
            })
            .optional(),
          orderBy: z.object({ createdAt: z.enum(['asc', 'desc']) }).optional(),
          take: z.number().optional(),
        })
        .optional(),
      _count: z
        .object({
          select: z
            .object({
              activities: z.literal(true).optional(),
              borrows: z.literal(true).optional(),
              orderItems: z.literal(true).optional(),
              ppeDeliveries: z.literal(true).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

// =====================
// Optimized Select Schemas for Detail Pages
// =====================

// Item detail selection - includes comprehensive data for viewing
export const itemDetailSelectSchema = z.object({
  select: z
    .object({
      id: z.literal(true),
      name: z.literal(true),
      uniCode: z.literal(true),
      quantity: z.literal(true),
      maxQuantity: z.literal(true),
      reorderPoint: z.literal(true),
      reorderQuantity: z.literal(true),
      boxQuantity: z.literal(true),
      isManualMaxQuantity: z.literal(true),
      isManualReorderPoint: z.literal(true),
      lastAutoOrderDate: z.literal(true),
      icms: z.literal(true),
      ipi: z.literal(true),
      totalPrice: z.literal(true),
      monthlyConsumption: z.literal(true),
      monthlyConsumptionTrendPercent: z.literal(true),
      barcodes: z.literal(true),
      shouldAssignToUser: z.literal(true),
      abcCategory: z.literal(true),
      abcCategoryOrder: z.literal(true),
      xyzCategory: z.literal(true),
      xyzCategoryOrder: z.literal(true),
      brandId: z.literal(true),
      categoryId: z.literal(true),
      supplierId: z.literal(true),
      estimatedLeadTime: z.literal(true),
      isActive: z.literal(true),
      ppeType: z.literal(true),
      ppeSize: z.literal(true),
      ppeCA: z.literal(true),
      ppeDeliveryMode: z.literal(true),
      ppeStandardQuantity: z.literal(true),
      createdAt: z.literal(true),
      updatedAt: z.literal(true),
      brand: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              name: z.literal(true),
              createdAt: z.literal(true),
            })
            .optional(),
        })
        .optional(),
      category: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              name: z.literal(true),
              type: z.literal(true),
              typeOrder: z.literal(true),
            })
            .optional(),
        })
        .optional(),
      supplier: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              name: z.literal(true),
              fantasyName: z.literal(true),
              cnpj: z.literal(true),
              phone: z.literal(true),
              email: z.literal(true),
            })
            .optional(),
        })
        .optional(),
      measures: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              value: z.literal(true),
              unit: z.literal(true),
              measureType: z.literal(true),
              createdAt: z.literal(true),
            })
            .optional(),
        })
        .optional(),
      prices: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              value: z.literal(true),
              createdAt: z.literal(true),
            })
            .optional(),
          orderBy: z.object({ createdAt: z.enum(['asc', 'desc']) }).optional(),
          take: z.number().optional(),
        })
        .optional(),
      relatedItems: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              name: z.literal(true),
              uniCode: z.literal(true),
              quantity: z.literal(true),
              isActive: z.literal(true),
            })
            .optional(),
          take: z.number().optional(),
        })
        .optional(),
      relatedTo: z
        .object({
          select: z
            .object({
              id: z.literal(true),
              name: z.literal(true),
              uniCode: z.literal(true),
              quantity: z.literal(true),
              isActive: z.literal(true),
            })
            .optional(),
          take: z.number().optional(),
        })
        .optional(),
      _count: z
        .object({
          select: z
            .object({
              activities: z.literal(true).optional(),
              borrows: z.literal(true).optional(),
              orderItems: z.literal(true).optional(),
              ppeDeliveries: z.literal(true).optional(),
              orderRules: z.literal(true).optional(),
              externalWithdrawalItems: z.literal(true).optional(),
              relatedItems: z.literal(true).optional(),
              relatedTo: z.literal(true).optional(),
              maintenanceItemsNeeded: z.literal(true).optional(),
              formulaComponents: z.literal(true).optional(),
              ppeSchedules: z.literal(true).optional(),
              prices: z.literal(true).optional(),
              measures: z.literal(true).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

// =====================
// ItemBrand Schemas
// =====================

export const itemBrandIncludeSchema = z
  .object({
    items: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              brand: z.boolean().optional(),
              category: z.boolean().optional(),
              supplier: z.boolean().optional(),
              prices: z
                .union([
                  z.boolean(),
                  z.object({
                    include: monetaryValueIncludeSchema.optional(),
                    where: monetaryValueWhereSchema.optional(),
                    orderBy: monetaryValueOrderBySchema.optional(),
                    take: z.coerce.number().optional(),
                    skip: z.coerce.number().optional(),
                  }),
                ])
                .optional(),
              activities: z
                .union([
                  z.boolean(),
                  z.object({
                    include: activityIncludeSchema.optional(),
                    where: activityWhereSchema.optional(),
                    orderBy: activityOrderBySchema.optional(),
                    take: z.coerce.number().optional(),
                    skip: z.coerce.number().optional(),
                  }),
                ])
                .optional(),
            })
            .optional(),
          where: z.lazy(() => itemWhereSchema).optional(),
          orderBy: z.lazy(() => itemOrderBySchema).optional(),
          select: itemSelectSchema.optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              items: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .optional();

export const itemBrandOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        // Aggregated fields for sorting by items count
        items: z
          .object({
            _count: orderByDirectionSchema.optional(),
          })
          .optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
          // Aggregated fields for sorting by items count
          items: z
            .object({
              _count: orderByDirectionSchema.optional(),
            })
            .optional(),
        })
        .partial(),
    ),
  ])
  .optional();

export const itemBrandWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.union([itemBrandWhereSchema, z.array(itemBrandWhereSchema)]).optional(),
      OR: z.array(itemBrandWhereSchema).optional(),
      NOT: z.union([itemBrandWhereSchema, z.array(itemBrandWhereSchema)]).optional(),

      // Fields
      id: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      name: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            mode: z.enum(['default', 'insensitive']).optional(),
          }),
        ])
        .optional(),

      createdAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      updatedAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Relations
      items: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// ItemCategory Schemas
// =====================

export const itemCategoryIncludeSchema = z
  .object({
    items: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              brand: z.boolean().optional(),
              category: z.boolean().optional(),
              supplier: z.boolean().optional(),
              prices: z
                .union([
                  z.boolean(),
                  z.object({
                    include: monetaryValueIncludeSchema.optional(),
                    where: monetaryValueWhereSchema.optional(),
                    orderBy: monetaryValueOrderBySchema.optional(),
                    take: z.coerce.number().optional(),
                    skip: z.coerce.number().optional(),
                  }),
                ])
                .optional(),
              activities: z
                .union([
                  z.boolean(),
                  z.object({
                    include: activityIncludeSchema.optional(),
                    where: activityWhereSchema.optional(),
                    orderBy: activityOrderBySchema.optional(),
                    take: z.coerce.number().optional(),
                    skip: z.coerce.number().optional(),
                  }),
                ])
                .optional(),
            })
            .optional(),
          where: z.lazy(() => itemWhereSchema).optional(),
          orderBy: z.lazy(() => itemOrderBySchema).optional(),
          select: itemSelectSchema.optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    orderSchedule: z.boolean().optional(),
    ppeSchedules: z.boolean().optional(),
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              items: z.boolean().optional(),
              orderSchedule: z.boolean().optional(),
              ppeSchedules: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .optional();

export const itemCategoryOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        type: orderByDirectionSchema.optional(),
        typeOrder: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        // Aggregated fields for sorting by items count
        items: z
          .object({
            _count: orderByDirectionSchema.optional(),
          })
          .optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          type: orderByDirectionSchema.optional(),
          typeOrder: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
          // Aggregated fields for sorting by items count
          items: z
            .object({
              _count: orderByDirectionSchema.optional(),
            })
            .optional(),
        })
        .partial(),
    ),
  ])
  .optional();

export const itemCategoryWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.union([itemCategoryWhereSchema, z.array(itemCategoryWhereSchema)]).optional(),
      OR: z.array(itemCategoryWhereSchema).optional(),
      NOT: z.union([itemCategoryWhereSchema, z.array(itemCategoryWhereSchema)]).optional(),

      // Fields
      id: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      name: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            mode: z.enum(['default', 'insensitive']).optional(),
          }),
        ])
        .optional(),

      type: z
        .union([
          z.nativeEnum(ITEM_CATEGORY_TYPE),
          z.object({
            equals: z.nativeEnum(ITEM_CATEGORY_TYPE).optional(),
            not: z.nativeEnum(ITEM_CATEGORY_TYPE).optional(),
            in: z.array(z.nativeEnum(ITEM_CATEGORY_TYPE)).optional(),
            notIn: z.array(z.nativeEnum(ITEM_CATEGORY_TYPE)).optional(),
          }),
        ])
        .optional(),

      typeOrder: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      createdAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      updatedAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Relations
      items: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Item Schemas
// =====================

export const itemIncludeSchema = z
  .object({
    brand: z
      .union([
        z.boolean(),
        z.object({
          include: itemBrandIncludeSchema.optional(),
          select: itemBrandSelectSchema.optional(),
        }),
      ])
      .optional(),
    category: z
      .union([
        z.boolean(),
        z.object({
          include: itemCategoryIncludeSchema.optional(),
          select: itemCategorySelectSchema.optional(),
        }),
      ])
      .optional(),
    supplier: z.boolean().optional(),
    prices: z
      .union([
        z.boolean(),
        z.object({
          include: monetaryValueIncludeSchema.optional(),
          where: monetaryValueWhereSchema.optional(),
          orderBy: monetaryValueOrderBySchema.optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    measures: z
      .union([
        z.boolean(),
        z.object({
          include: measureIncludeSchema.optional(),
          where: measureWhereSchema.optional(),
          orderBy: measureOrderBySchema.optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    activities: z
      .union([
        z.boolean(),
        z.object({
          include: activityIncludeSchema.optional(),
          where: activityWhereSchema.optional(),
          orderBy: activityOrderBySchema.optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    borrows: z
      .union([
        z.boolean(),
        z.object({
          include: borrowIncludeSchema.optional(),
          where: borrowWhereSchema.optional(),
          orderBy: borrowOrderBySchema.optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    orderItems: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              order: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        supplier: z.boolean().optional(),
                        items: z.boolean().optional(),
                      })
                      .optional(),
                  }),
                ])
                .optional(),
              item: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(), // Allow any where clause for order items
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    ppeDeliveries: z
      .union([
        z.boolean(),
        z.object({
          include: ppeDeliveryIncludeSchema.optional(),
          where: ppeDeliveryWhereSchema.optional(),
          orderBy: ppeDeliveryOrderBySchema.optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    orderRules: z.boolean().optional(),
    externalWithdrawalItems: z.boolean().optional(),
    relatedItems: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              brand: z.boolean().optional(),
              category: z.boolean().optional(),
              supplier: z.boolean().optional(),
              prices: z
                .union([
                  z.boolean(),
                  z.object({
                    orderBy: z
                      .object({
                        createdAt: z.enum(['asc', 'desc']).optional(),
                        value: z.enum(['asc', 'desc']).optional(),
                      })
                      .optional(),
                    take: z.coerce.number().optional(),
                    skip: z.coerce.number().optional(),
                  }),
                ])
                .optional(),
            })
            .optional(),
          where: z.lazy(() => itemWhereSchema).optional(),
          orderBy: z.lazy(() => itemOrderBySchema).optional(),
          select: itemSelectSchema.optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    relatedTo: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              brand: z.boolean().optional(),
              category: z.boolean().optional(),
              supplier: z.boolean().optional(),
              prices: z
                .union([
                  z.boolean(),
                  z.object({
                    orderBy: z
                      .object({
                        createdAt: z.enum(['asc', 'desc']).optional(),
                        value: z.enum(['asc', 'desc']).optional(),
                      })
                      .optional(),
                    take: z.coerce.number().optional(),
                    skip: z.coerce.number().optional(),
                  }),
                ])
                .optional(),
            })
            .optional(),
          where: z.lazy(() => itemWhereSchema).optional(),
          orderBy: z.lazy(() => itemOrderBySchema).optional(),
          select: itemSelectSchema.optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    maintenance: z.boolean().optional(),
    maintenanceItemsNeeded: z.boolean().optional(),
    formulaComponents: z.boolean().optional(),
    ppeSchedules: z.boolean().optional(),
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              activities: z.boolean().optional(),
              borrows: z.boolean().optional(),
              orderItems: z.boolean().optional(),
              ppeDeliveries: z.boolean().optional(),
              orderRules: z.boolean().optional(),
              externalWithdrawalItems: z.boolean().optional(),
              relatedItems: z.boolean().optional(),
              relatedTo: z.boolean().optional(),
              maintenanceItemsNeeded: z.boolean().optional(),
              formulaComponents: z.boolean().optional(),
              ppeSchedules: z.boolean().optional(),
              prices: z.boolean().optional(),
              measures: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .optional();

export const itemOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        uniCode: orderByDirectionSchema.optional(),
        quantity: orderByDirectionSchema.optional(),
        maxQuantity: orderByDirectionSchema.optional(),
        reorderPoint: orderByDirectionSchema.optional(),
        reorderQuantity: orderByDirectionSchema.optional(),
        boxQuantity: orderByDirectionSchema.optional(),
        isManualMaxQuantity: orderByDirectionSchema.optional(),
        isManualReorderPoint: orderByDirectionSchema.optional(),
        lastAutoOrderDate: orderByDirectionSchema.optional(),
        icms: orderByDirectionSchema.optional(),
        ipi: orderByDirectionSchema.optional(),
        totalPrice: orderByDirectionSchema.optional(),
        price: orderByDirectionSchema.optional(), // Virtual field for sorting by current price (prices[0].value)
        monthlyConsumption: orderByDirectionSchema.optional(),
        monthlyConsumptionTrendPercent: orderByDirectionSchema.optional(),
        shouldAssignToUser: orderByDirectionSchema.optional(),
        brandId: orderByDirectionSchema.optional(),
        categoryId: orderByDirectionSchema.optional(),
        supplierId: orderByDirectionSchema.optional(),
        estimatedLeadTime: orderByDirectionSchema.optional(),
        isActive: orderByDirectionSchema.optional(),
        abcCategory: orderByDirectionSchema.optional(),
        xyzCategory: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        // Nested ordering for related entities
        brand: z
          .object({
            id: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
            updatedAt: orderByDirectionSchema.optional(),
          })
          .optional(),
        category: z
          .object({
            id: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
            type: orderByDirectionSchema.optional(),
            typeOrder: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
            updatedAt: orderByDirectionSchema.optional(),
          })
          .optional(),
        supplier: z
          .object({
            id: orderByDirectionSchema.optional(),
            name: orderByDirectionSchema.optional(),
            fantasyName: orderByDirectionSchema.optional(),
            cnpj: orderByDirectionSchema.optional(),
            createdAt: orderByDirectionSchema.optional(),
            updatedAt: orderByDirectionSchema.optional(),
          })
          .optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          uniCode: orderByDirectionSchema.optional(),
          quantity: orderByDirectionSchema.optional(),
          maxQuantity: orderByDirectionSchema.optional(),
          reorderPoint: orderByDirectionSchema.optional(),
          reorderQuantity: orderByDirectionSchema.optional(),
          boxQuantity: orderByDirectionSchema.optional(),
          isManualMaxQuantity: orderByDirectionSchema.optional(),
          isManualReorderPoint: orderByDirectionSchema.optional(),
          lastAutoOrderDate: orderByDirectionSchema.optional(),
          icms: orderByDirectionSchema.optional(),
          ipi: orderByDirectionSchema.optional(),
          totalPrice: orderByDirectionSchema.optional(),
          price: orderByDirectionSchema.optional(), // Virtual field for sorting by current price (prices[0].value)
          monthlyConsumption: orderByDirectionSchema.optional(),
          monthlyConsumptionTrendPercent: orderByDirectionSchema.optional(),
          shouldAssignToUser: orderByDirectionSchema.optional(),
          estimatedLeadTime: orderByDirectionSchema.optional(),
          isActive: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
          // Nested ordering for related entities
          brand: z
            .object({
              id: orderByDirectionSchema.optional(),
              name: orderByDirectionSchema.optional(),
              createdAt: orderByDirectionSchema.optional(),
              updatedAt: orderByDirectionSchema.optional(),
            })
            .optional(),
          category: z
            .object({
              id: orderByDirectionSchema.optional(),
              name: orderByDirectionSchema.optional(),
              type: orderByDirectionSchema.optional(),
              typeOrder: orderByDirectionSchema.optional(),
              createdAt: orderByDirectionSchema.optional(),
              updatedAt: orderByDirectionSchema.optional(),
            })
            .optional(),
          supplier: z
            .object({
              id: orderByDirectionSchema.optional(),
              name: orderByDirectionSchema.optional(),
              fantasyName: orderByDirectionSchema.optional(),
              cnpj: orderByDirectionSchema.optional(),
              createdAt: orderByDirectionSchema.optional(),
              updatedAt: orderByDirectionSchema.optional(),
            })
            .optional(),
        })
        .partial(),
    ),
  ])
  .optional();

export const itemWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.union([itemWhereSchema, z.array(itemWhereSchema)]).optional(),
      OR: z.array(itemWhereSchema).optional(),
      NOT: z.union([itemWhereSchema, z.array(itemWhereSchema)]).optional(),

      // UUID fields
      id: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      brandId: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      categoryId: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      supplierId: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      // String fields
      name: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            mode: z.enum(['default', 'insensitive']).optional(),
          }),
        ])
        .optional(),

      uniCode: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
          }),
        ])
        .optional(),

      // Numeric fields
      quantity: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      maxQuantity: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      reorderPoint: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      reorderQuantity: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      isManualMaxQuantity: z
        .union([
          z.boolean(),
          z.object({
            equals: z.boolean().optional(),
            not: z.boolean().optional(),
          }),
        ])
        .optional(),

      isManualReorderPoint: z
        .union([
          z.boolean(),
          z.object({
            equals: z.boolean().optional(),
            not: z.boolean().optional(),
          }),
        ])
        .optional(),

      lastAutoOrderDate: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      icms: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      ipi: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      monthlyConsumption: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      monthlyConsumptionTrendPercent: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      totalPrice: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      // Boolean fields
      shouldAssignToUser: z
        .union([
          z.boolean(),
          z.object({
            equals: z.boolean().optional(),
            not: z.boolean().optional(),
          }),
        ])
        .optional(),

      isActive: z
        .union([
          z.boolean(),
          z.object({
            equals: z.boolean().optional(),
            not: z.boolean().optional(),
          }),
        ])
        .optional(),

      // PPE Type field
      ppeType: z
        .union([
          z.nativeEnum(PPE_TYPE),
          z.null(),
          z.object({
            equals: z.union([z.nativeEnum(PPE_TYPE), z.null()]).optional(),
            not: z.union([z.nativeEnum(PPE_TYPE), z.null()]).optional(),
            in: z.array(z.nativeEnum(PPE_TYPE)).optional(),
            notIn: z.array(z.nativeEnum(PPE_TYPE)).optional(),
          }),
        ])
        .optional(),

      // ABC/XYZ Category fields
      abcCategory: z
        .union([
          z.nativeEnum(ABC_CATEGORY),
          z.object({
            equals: z.nativeEnum(ABC_CATEGORY).optional(),
            not: z.nativeEnum(ABC_CATEGORY).optional(),
            in: z.array(z.nativeEnum(ABC_CATEGORY)).optional(),
            notIn: z.array(z.nativeEnum(ABC_CATEGORY)).optional(),
          }),
        ])
        .optional(),

      abcCategoryOrder: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      xyzCategoryOrder: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
          }),
        ])
        .optional(),

      // Array fields - Fixed to use proper union structure
      barcodes: z
        .union([
          z.array(z.string()),
          z.object({
            has: z.string().optional(),
            hasEvery: z.array(z.string()).optional(),
            hasSome: z.array(z.string()).optional(),
            isEmpty: z.boolean().optional(),
          }),
        ])
        .optional(),

      // Date fields
      createdAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      updatedAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gt: z.coerce.date().optional(),
            gte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Relations
      brand: z.lazy(() => itemBrandWhereSchema).optional(),
      category: z.lazy(() => itemCategoryWhereSchema).optional(),
      supplier: z.any().optional(),
      prices: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      activities: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      borrows: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      orderItems: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      ppeDeliveries: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      measures: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      orderRules: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      externalWithdrawalItems: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      relatedItems: z
        .object({
          some: itemWhereSchema.optional(),
          every: itemWhereSchema.optional(),
          none: itemWhereSchema.optional(),
        })
        .optional(),
      relatedTo: z
        .object({
          some: itemWhereSchema.optional(),
          every: itemWhereSchema.optional(),
          none: itemWhereSchema.optional(),
        })
        .optional(),
      maintenance: z.any().optional(),
      maintenanceItemsNeeded: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      formulaComponents: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
      ppeSchedules: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const itemFilters = {
  // Search filter
  searchingFor: z.string().optional(),

  // Boolean filters
  isActive: z.boolean().optional(),
  isPpe: z.boolean().optional(), // Backwards compatibility
  shouldAssignToUser: z.boolean().optional(),

  // PPE type filter
  ppeType: z.nativeEnum(PPE_TYPE).optional(),
  hasBarcode: z.boolean().optional(),
  hasSupplier: z.boolean().optional(),
  hasActivities: z.boolean().optional(),
  hasBorrows: z.boolean().optional(),
  // Stock level filters
  normalStock: z.boolean().optional(),
  lowStock: z.boolean().optional(),
  criticalStock: z.boolean().optional(),
  outOfStock: z.boolean().optional(),
  overStock: z.boolean().optional(),
  nearReorderPoint: z.boolean().optional(),
  noReorderPoint: z.boolean().optional(),
  hasMaxQuantity: z.boolean().optional(),
  negativeStock: z.boolean().optional(),

  // Array filters
  itemIds: z.array(z.string()).optional(),
  brandIds: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
  supplierIds: z.array(z.string()).optional(),
  barcodes: z.array(z.string()).optional(),
  names: z.array(z.string()).optional(),
  abcCategories: z.array(z.nativeEnum(ABC_CATEGORY)).optional(),
  xyzCategories: z.array(z.nativeEnum(XYZ_CATEGORY)).optional(),
  stockLevels: z.array(z.nativeEnum(STOCK_LEVEL)).optional(),

  // Range filters
  quantityRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),

  icmsRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),

  ipiRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),

  monthlyConsumptionRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),

  totalPriceRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),

  // Measure filters (handled through measures relation)
  hasMeasures: z.boolean().optional(),
};

const itemBrandFilters = {
  searchingFor: z.string().optional(),
  brandIds: z.array(z.string()).optional(),
  names: z.array(z.string()).optional(),
  hasItems: z.boolean().optional(),
};

const itemCategoryFilters = {
  searchingFor: z.string().optional(),
  categoryIds: z.array(z.string()).optional(),
  names: z.array(z.string()).optional(),
  isPpe: z.boolean().optional(), // Backwards compatibility
  type: z.nativeEnum(ITEM_CATEGORY_TYPE).optional(),
  hasItems: z.boolean().optional(),
};

// =====================
// Transform Functions
// =====================

const itemTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const andConditions: any[] = [];

  // Search filter
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    andConditions.push({
      OR: [
        { name: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
        { uniCode: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
        { barcodes: { has: data.searchingFor.trim() } },
        { brand: { name: { contains: data.searchingFor.trim(), mode: 'insensitive' } } },
        { category: { name: { contains: data.searchingFor.trim(), mode: 'insensitive' } } },
        { supplier: { fantasyName: { contains: data.searchingFor.trim(), mode: 'insensitive' } } },
      ],
    });
    delete data.searchingFor;
  }

  // Boolean filters - check both root level and where clause
  // isActive can be at root or in where
  if (typeof data.isActive === 'boolean') {
    andConditions.push({ isActive: data.isActive });
    delete data.isActive;
  } else if (data.where && typeof data.where.isActive === 'boolean') {
    andConditions.push({ isActive: data.where.isActive });
    delete data.where.isActive;
  }

  // isPpe filter (backwards compatibility - converts to type filter)
  if (data.isPpe === true) {
    andConditions.push({ category: { type: ITEM_CATEGORY_TYPE.PPE } });
    delete data.isPpe;
  } else if (data.isPpe === false) {
    andConditions.push({ category: { type: { not: ITEM_CATEGORY_TYPE.PPE } } });
    delete data.isPpe;
  } else if (data.where && data.where.isPpe === true) {
    andConditions.push({ category: { type: ITEM_CATEGORY_TYPE.PPE } });
    delete data.where.isPpe;
  } else if (data.where && data.where.isPpe === false) {
    andConditions.push({ category: { type: { not: ITEM_CATEGORY_TYPE.PPE } } });
    delete data.where.isPpe;
  }

  // ppeType filter - filter items by PPE type (e.g., OTHERS, SHIRT, PANTS, etc.)
  if (data.ppeType) {
    andConditions.push({ ppeType: data.ppeType });
    delete data.ppeType;
  } else if (data.where && data.where.ppeType) {
    andConditions.push({ ppeType: data.where.ppeType });
    delete data.where.ppeType;
  }

  // shouldAssignToUser filter
  if (typeof data.shouldAssignToUser === 'boolean') {
    andConditions.push({ shouldAssignToUser: data.shouldAssignToUser });
    delete data.shouldAssignToUser;
  } else if (data.where && typeof data.where.shouldAssignToUser === 'boolean') {
    andConditions.push({ shouldAssignToUser: data.where.shouldAssignToUser });
    delete data.where.shouldAssignToUser;
  }

  // hasBarcode filter
  if (data.hasBarcode === true) {
    // Items that have barcodes (not null and not empty)
    andConditions.push({
      NOT: {
        OR: [{ barcodes: null }, { barcodes: { isEmpty: true } }],
      },
    });
    delete data.hasBarcode;
  } else if (data.hasBarcode === false) {
    // Items that have no barcodes (null OR empty)
    andConditions.push({
      OR: [{ barcodes: null }, { barcodes: { isEmpty: true } }],
    });
    delete data.hasBarcode;
  } else if (data.where && data.where.hasBarcode === true) {
    andConditions.push({
      NOT: {
        OR: [{ barcodes: null }, { barcodes: { isEmpty: true } }],
      },
    });
    delete data.where.hasBarcode;
  } else if (data.where && data.where.hasBarcode === false) {
    andConditions.push({
      OR: [{ barcodes: null }, { barcodes: { isEmpty: true } }],
    });
    delete data.where.hasBarcode;
  }

  // hasSupplier filter
  if (data.hasSupplier === true) {
    andConditions.push({ supplierId: { not: null } });
    delete data.hasSupplier;
  } else if (data.hasSupplier === false) {
    andConditions.push({ supplierId: null });
    delete data.hasSupplier;
  } else if (data.where && data.where.hasSupplier === true) {
    andConditions.push({ supplierId: { not: null } });
    delete data.where.hasSupplier;
  } else if (data.where && data.where.hasSupplier === false) {
    andConditions.push({ supplierId: null });
    delete data.where.hasSupplier;
  }

  // hasActivities filter
  if (data.hasActivities === true) {
    andConditions.push({ activities: { some: {} } });
    delete data.hasActivities;
  } else if (data.hasActivities === false) {
    andConditions.push({ activities: { none: {} } });
    delete data.hasActivities;
  } else if (data.where && data.where.hasActivities === true) {
    andConditions.push({ activities: { some: {} } });
    delete data.where.hasActivities;
  } else if (data.where && data.where.hasActivities === false) {
    andConditions.push({ activities: { none: {} } });
    delete data.where.hasActivities;
  }

  // hasBorrows filter
  if (data.hasBorrows === true) {
    andConditions.push({ borrows: { some: {} } });
    delete data.hasBorrows;
  } else if (data.hasBorrows === false) {
    andConditions.push({ borrows: { none: {} } });
    delete data.hasBorrows;
  } else if (data.where && data.where.hasBorrows === true) {
    andConditions.push({ borrows: { some: {} } });
    delete data.where.hasBorrows;
  } else if (data.where && data.where.hasBorrows === false) {
    andConditions.push({ borrows: { none: {} } });
    delete data.where.hasBorrows;
  }

  // Stock level filters
  // normalStock - handled in service layer (needs reorderPoint calculation)
  if (data.normalStock === true) {
    delete data.normalStock;
  }

  // lowStock - handled in service layer (needs reorderPoint calculation)
  if (data.lowStock === true) {
    delete data.lowStock;
  }

  // criticalStock - handled in service layer (needs reorderPoint calculation)
  if (data.criticalStock === true) {
    delete data.criticalStock;
  }

  // outOfStock - quantity = 0
  if (data.outOfStock === true) {
    andConditions.push({ quantity: 0 });
    delete data.outOfStock;
  }

  // negativeStock - quantity < 0
  if (data.negativeStock === true) {
    andConditions.push({ quantity: { lt: 0 } });
    delete data.negativeStock;
  }

  // overStock - quantity > maxQuantity (handled in service layer as it needs maxQuantity comparison)
  if (data.overStock === true) {
    delete data.overStock;
  }

  if (data.noReorderPoint === true) {
    andConditions.push({ reorderPoint: null });
    delete data.noReorderPoint;
  } else if (data.noReorderPoint === false) {
    andConditions.push({ reorderPoint: { not: null } });
    delete data.noReorderPoint;
  }

  if (data.hasMaxQuantity === true) {
    andConditions.push({ maxQuantity: { not: null } });
    delete data.hasMaxQuantity;
  } else if (data.hasMaxQuantity === false) {
    andConditions.push({ maxQuantity: null });
    delete data.hasMaxQuantity;
  }

  // nearReorderPoint handled in service layer
  if (data.nearReorderPoint === true) {
    delete data.nearReorderPoint;
  }

  // stockLevels array filter handled in service layer (needs reorderPoint calculation)
  // Keep stockLevels in data so it can be processed by the service

  // Array filters
  if (data.itemIds && Array.isArray(data.itemIds) && data.itemIds.length > 0) {
    andConditions.push({ id: { in: data.itemIds } });
    delete data.itemIds;
  }

  if (data.brandIds && Array.isArray(data.brandIds) && data.brandIds.length > 0) {
    // Check if the special "null" value is included
    const hasNullBrand = data.brandIds.includes('null');
    const actualBrandIds = data.brandIds.filter((id: string) => id !== 'null');

    if (hasNullBrand && actualBrandIds.length > 0) {
      // Include both null and specific brands
      andConditions.push({
        OR: [{ brandId: null }, { brandId: { in: actualBrandIds } }],
      });
    } else if (hasNullBrand) {
      // Only null brands
      andConditions.push({ brandId: null });
    } else {
      // Only specific brands
      andConditions.push({ brandId: { in: actualBrandIds } });
    }
    delete data.brandIds;
  }

  if (data.categoryIds && Array.isArray(data.categoryIds) && data.categoryIds.length > 0) {
    // Check if the special "null" value is included
    const hasNullCategory = data.categoryIds.includes('null');
    const actualCategoryIds = data.categoryIds.filter((id: string) => id !== 'null');

    if (hasNullCategory && actualCategoryIds.length > 0) {
      // Include both null and specific categories
      andConditions.push({
        OR: [{ categoryId: null }, { categoryId: { in: actualCategoryIds } }],
      });
    } else if (hasNullCategory) {
      // Only null categories
      andConditions.push({ categoryId: null });
    } else {
      // Only specific categories
      andConditions.push({ categoryId: { in: actualCategoryIds } });
    }
    delete data.categoryIds;
  }

  if (data.supplierIds && Array.isArray(data.supplierIds) && data.supplierIds.length > 0) {
    // Check if the special "null" value is included
    const hasNullSupplier = data.supplierIds.includes('null');
    const actualSupplierIds = data.supplierIds.filter((id: string) => id !== 'null');

    if (hasNullSupplier && actualSupplierIds.length > 0) {
      // Include both null and specific suppliers
      andConditions.push({
        OR: [{ supplierId: null }, { supplierId: { in: actualSupplierIds } }],
      });
    } else if (hasNullSupplier) {
      // Only null suppliers
      andConditions.push({ supplierId: null });
    } else {
      // Only specific suppliers
      andConditions.push({ supplierId: { in: actualSupplierIds } });
    }
    delete data.supplierIds;
  }

  if (data.barcodes && Array.isArray(data.barcodes) && data.barcodes.length > 0) {
    andConditions.push({ barcodes: { hasSome: data.barcodes } });
    delete data.barcodes;
  }

  if (data.names && Array.isArray(data.names) && data.names.length > 0) {
    andConditions.push({ name: { in: data.names } });
    delete data.names;
  }

  if (data.abcCategories && Array.isArray(data.abcCategories) && data.abcCategories.length > 0) {
    andConditions.push({ abcCategory: { in: data.abcCategories } });
    delete data.abcCategories;
  }

  if (data.xyzCategories && Array.isArray(data.xyzCategories) && data.xyzCategories.length > 0) {
    andConditions.push({ xyzCategory: { in: data.xyzCategories } });
    delete data.xyzCategories;
  }

  // Range filters
  if (data.quantityRange && typeof data.quantityRange === 'object') {
    const condition: any = {};
    if (typeof data.quantityRange.min === 'number') condition.gte = data.quantityRange.min;
    if (typeof data.quantityRange.max === 'number') condition.lte = data.quantityRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ quantity: condition });
    }
    delete data.quantityRange;
  }

  if (data.icmsRange && typeof data.icmsRange === 'object') {
    const condition: any = {};
    if (typeof data.icmsRange.min === 'number') condition.gte = data.icmsRange.min;
    if (typeof data.icmsRange.max === 'number') condition.lte = data.icmsRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ icms: condition });
    }
    delete data.icmsRange;
  }

  if (data.ipiRange && typeof data.ipiRange === 'object') {
    const condition: any = {};
    if (typeof data.ipiRange.min === 'number') condition.gte = data.ipiRange.min;
    if (typeof data.ipiRange.max === 'number') condition.lte = data.ipiRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ ipi: condition });
    }
    delete data.ipiRange;
  }

  if (data.monthlyConsumptionRange && typeof data.monthlyConsumptionRange === 'object') {
    const condition: any = {};
    if (typeof data.monthlyConsumptionRange.min === 'number')
      condition.gte = data.monthlyConsumptionRange.min;
    if (typeof data.monthlyConsumptionRange.max === 'number')
      condition.lte = data.monthlyConsumptionRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ monthlyConsumption: condition });
    }
    delete data.monthlyConsumptionRange;
  }

  if (data.totalPriceRange && typeof data.totalPriceRange === 'object') {
    const condition: any = {};
    if (typeof data.totalPriceRange.min === 'number') condition.gte = data.totalPriceRange.min;
    if (typeof data.totalPriceRange.max === 'number') condition.lte = data.totalPriceRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ totalPrice: condition });
    }
    delete data.totalPriceRange;
  }

  // hasMeasures filter
  if (data.hasMeasures === true) {
    andConditions.push({ measures: { some: {} } });
    delete data.hasMeasures;
  } else if (data.hasMeasures === false) {
    andConditions.push({ measures: { none: {} } });
    delete data.hasMeasures;
  } else if (data.where && data.where.hasMeasures === true) {
    andConditions.push({ measures: { some: {} } });
    delete data.where.hasMeasures;
  } else if (data.where && data.where.hasMeasures === false) {
    andConditions.push({ measures: { none: {} } });
    delete data.where.hasMeasures;
  }

  // Date filters
  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  // Merge with existing where conditions
  if (andConditions.length > 0) {
    if (data.where) {
      if (data.where.AND && Array.isArray(data.where.AND)) {
        data.where.AND = [...data.where.AND, ...andConditions];
      } else {
        data.where = { AND: [data.where, ...andConditions] };
      }
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

const itemBrandTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  const andConditions: any[] = [];

  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    andConditions.push({
      name: { contains: data.searchingFor.trim(), mode: 'insensitive' },
    });
    delete data.searchingFor;
  }

  if (data.brandIds && Array.isArray(data.brandIds) && data.brandIds.length > 0) {
    andConditions.push({ id: { in: data.brandIds } });
    delete data.brandIds;
  }

  if (data.names && Array.isArray(data.names) && data.names.length > 0) {
    andConditions.push({ name: { in: data.names } });
    delete data.names;
  }

  if (data.hasItems === true) {
    andConditions.push({ items: { some: {} } });
    delete data.hasItems;
  } else if (data.hasItems === false) {
    andConditions.push({ items: { none: {} } });
    delete data.hasItems;
  }

  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  if (andConditions.length > 0) {
    if (data.where) {
      if (data.where.AND && Array.isArray(data.where.AND)) {
        data.where.AND = [...data.where.AND, ...andConditions];
      } else {
        data.where = { AND: [data.where, ...andConditions] };
      }
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

const itemCategoryTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  const andConditions: any[] = [];

  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    andConditions.push({
      name: { contains: data.searchingFor.trim(), mode: 'insensitive' },
    });
    delete data.searchingFor;
  }

  if (data.categoryIds && Array.isArray(data.categoryIds) && data.categoryIds.length > 0) {
    andConditions.push({ id: { in: data.categoryIds } });
    delete data.categoryIds;
  }

  if (data.names && Array.isArray(data.names) && data.names.length > 0) {
    andConditions.push({ name: { in: data.names } });
    delete data.names;
  }

  if (typeof data.isPpe === 'boolean') {
    // Backwards compatibility - convert isPpe boolean to type enum
    if (data.isPpe === true) {
      andConditions.push({ type: ITEM_CATEGORY_TYPE.PPE });
    } else {
      andConditions.push({ type: { not: ITEM_CATEGORY_TYPE.PPE } });
    }
    delete data.isPpe;
  }

  if (data.type && typeof data.type === 'string') {
    andConditions.push({ type: data.type });
    delete data.type;
  }

  if (data.hasItems === true) {
    andConditions.push({ items: { some: {} } });
    delete data.hasItems;
  } else if (data.hasItems === false) {
    andConditions.push({ items: { none: {} } });
    delete data.hasItems;
  }

  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  if (andConditions.length > 0) {
    if (data.where) {
      if (data.where.AND && Array.isArray(data.where.AND)) {
        data.where.AND = [...data.where.AND, ...andConditions];
      } else {
        data.where = { AND: [data.where, ...andConditions] };
      }
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

// =====================
// Query Schemas
// =====================

export const itemGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(500).default(20).optional(),
    take: z.coerce.number().int().positive().max(500).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: itemWhereSchema.optional(),
    orderBy: itemOrderBySchema.optional(),
    include: itemIncludeSchema.optional(),
    select: itemSelectSchema.optional(),

    // Convenience filters
    ...itemFilters,

    // Date filters
    createdAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
    updatedAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
  })
  .transform(itemTransform);

export const itemBrandGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),

    // Direct Prisma clauses
    where: itemBrandWhereSchema.optional(),
    orderBy: itemBrandOrderBySchema.optional(),
    include: itemBrandIncludeSchema.optional(),
    select: itemBrandSelectSchema.optional(),

    // Convenience filters
    ...itemBrandFilters,

    // Date filters
    createdAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
    updatedAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
  })
  .transform(itemBrandTransform);

export const itemCategoryGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),

    // Direct Prisma clauses
    where: itemCategoryWhereSchema.optional(),
    orderBy: itemCategoryOrderBySchema.optional(),
    include: itemCategoryIncludeSchema.optional(),
    select: itemCategorySelectSchema.optional(),

    // Convenience filters
    ...itemCategoryFilters,

    // Date filters
    createdAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
    updatedAt: z
      .object({
        gte: z.coerce.date().optional(),
        lte: z.coerce.date().optional(),
      })
      .optional(),
  })
  .transform(itemCategoryTransform);

// =====================
// CRUD Schemas
// =====================

// Item CRUD - Base schemas without transform
export const itemCreateSchemaBase = z.object({
  name: createNameSchema(1, 255, 'Nome do item'),
  uniCode: nullableString.optional(),
  quantity: z.number().min(0, 'Quantidade deve ser não-negativa').default(0),
  maxQuantity: optionalNonNegativeNumber.refine(
    val => val === null || val === undefined || val >= 0,
    'Quantidade máxima deve ser não-negativa',
  ),
  reorderPoint: optionalNonNegativeNumber.refine(
    val => val === null || val === undefined || val >= 0,
    'Ponto de reposição deve ser não-negativo',
  ),
  reorderQuantity: optionalPositiveNumber.refine(
    val => val === null || val === undefined || val > 0,
    'Quantidade de reposição deve ser positiva',
  ),
  boxQuantity: z.number().int().nullable().optional(),
  isManualMaxQuantity: z.boolean().default(false).optional(),
  isManualReorderPoint: z.boolean().default(false).optional(),
  lastAutoOrderDate: z.coerce.date().nullable().optional(),
  icms: z
    .number()
    .min(0, 'ICMS deve ser não-negativo')
    .max(100, 'ICMS não pode exceder 100%')
    .default(0)
    .optional(),
  ipi: z
    .number()
    .min(0, 'IPI deve ser não-negativo')
    .max(100, 'IPI não pode exceder 100%')
    .default(0)
    .optional(),
  monthlyConsumption: z
    .number()
    .min(0, 'Consumo mensal deve ser não-negativo')
    .default(0)
    .optional(),
  monthlyConsumptionTrendPercent: z
    .number()
    .min(-100, 'Tendência não pode ser menor que -100%')
    .max(1000, 'Tendência não pode ser maior que 1000%')
    .nullable()
    .optional()
    .default(null),
  barcodes: z.array(z.string().min(1, 'Código de barras não pode ser vazio')).default([]),

  shouldAssignToUser: z.boolean().default(true),
  abcCategory: z.nativeEnum(ABC_CATEGORY).nullable().optional(),
  xyzCategory: z.nativeEnum(XYZ_CATEGORY).nullable().optional(),
  brandId: z.string().uuid({ message: 'Marca inválida' }).nullable().optional(),
  categoryId: z.string().uuid({ message: 'Categoria inválida' }).nullable().optional(),
  supplierId: z.string().uuid({ message: 'Fornecedor inválido' }).nullable().optional(),
  estimatedLeadTime: z.number().int().nullable().default(30).optional(),
  isActive: z.boolean().default(true),
  price: optionalNonNegativeNumber,

  // Measures array (new multiple measures support)
  measures: z
    .array(
      z
        .object({
          value: z.number().positive('Valor da medida deve ser positivo').nullish(),
          unit: z
            .enum(Object.values(MEASURE_UNIT) as [string, ...string[]], {
              errorMap: () => ({ message: 'Unidade de medida inválida' }),
            })
            .nullish(),
          measureType: z.enum(Object.values(MEASURE_TYPE) as [string, ...string[]], {
            errorMap: () => ({ message: 'Tipo de medida inválido' }),
          }),
        })
        .refine(
          data => {
            // For SIZE type measures (PPE sizes), validate value and unit requirements
            if (data.measureType === MEASURE_TYPE.SIZE) {
              // At least one of value or unit must be provided
              if (!data.value && !data.unit) {
                return false;
              }
              return true;
            }

            // For other measure types, both value and unit are required
            return (
              data.value !== undefined &&
              data.value !== null &&
              data.unit !== undefined &&
              data.unit !== null
            );
          },
          {
            message:
              'Para medidas de tamanho (PPE), pelo menos valor OU unidade deve ser fornecido. Para outros tipos, ambos valor e unidade são obrigatórios.',
          },
        ),
    )
    .optional(),

  // PPE fields (when item is a PPE)
  ppeType: z.nativeEnum(PPE_TYPE).nullable().optional(),
  ppeSize: z
    .enum(Object.values(PPE_SIZE) as [string, ...string[]])
    .nullable()
    .optional(),
  ppeCA: z.string().nullable().optional(),
  ppeDeliveryMode: z.nativeEnum(PPE_DELIVERY_MODE).nullable().optional(),
  ppeStandardQuantity: z.number().int().positive().nullable().optional(),
});

export const itemUpdateSchemaBase = z.object({
  name: z.string().min(1).max(255).optional(),
  uniCode: nullableString.optional(),
  quantity: z.number().min(0).optional(),
  maxQuantity: optionalNonNegativeNumber.refine(
    val => val === null || val === undefined || val >= 0,
    'Quantidade máxima deve ser não-negativa',
  ),
  reorderPoint: optionalNonNegativeNumber.refine(
    val => val === null || val === undefined || val >= 0,
    'Ponto de reposição deve ser não-negativo',
  ),
  reorderQuantity: optionalPositiveNumber.refine(
    val => val === null || val === undefined || val > 0,
    'Quantidade de reposição deve ser positiva',
  ),
  boxQuantity: z.number().int().nullable().optional(),
  isManualMaxQuantity: z.boolean().optional(),
  isManualReorderPoint: z.boolean().optional(),
  lastAutoOrderDate: z.coerce.date().nullable().optional(),
  icms: z.number().min(0).max(100).optional(),
  ipi: z.number().min(0).max(100).optional(),
  monthlyConsumption: z.number().min(0, 'Consumo mensal deve ser não-negativo').optional(),
  monthlyConsumptionTrendPercent: z
    .number()
    .min(-100, 'Tendência não pode ser menor que -100%')
    .max(1000, 'Tendência não pode ser maior que 1000%')
    .nullable()
    .optional(),
  barcodes: z.array(z.string().min(1, 'Código de barras não pode ser vazio')).optional(),

  shouldAssignToUser: z.boolean().optional(),
  abcCategory: z.nativeEnum(ABC_CATEGORY).nullable().optional(),
  xyzCategory: z.nativeEnum(XYZ_CATEGORY).nullable().optional(),
  brandId: z.string().uuid({ message: 'Marca inválida' }).nullable().optional(),
  categoryId: z.string().uuid({ message: 'Categoria inválida' }).nullable().optional(),
  supplierId: z.string().uuid({ message: 'Fornecedor inválido' }).nullable().optional(),
  estimatedLeadTime: z.number().int().nullable().optional(),
  isActive: z.boolean().optional(),
  abcCategoryOrder: z.number().int().nullable().optional(),
  xyzCategoryOrder: z.number().int().nullable().optional(),
  price: optionalNonNegativeNumber,

  // Measures array (new multiple measures support)
  measures: z
    .array(
      z
        .object({
          value: z.number().positive('Valor da medida deve ser positivo').nullish(),
          unit: z
            .enum(Object.values(MEASURE_UNIT) as [string, ...string[]], {
              errorMap: () => ({ message: 'Unidade de medida inválida' }),
            })
            .nullish(),
          measureType: z.enum(Object.values(MEASURE_TYPE) as [string, ...string[]], {
            errorMap: () => ({ message: 'Tipo de medida inválido' }),
          }),
        })
        .refine(
          data => {
            // For SIZE type measures (PPE sizes), validate value and unit requirements
            if (data.measureType === MEASURE_TYPE.SIZE) {
              // At least one of value or unit must be provided
              if (!data.value && !data.unit) {
                return false;
              }
              return true;
            }

            // For other measure types, both value and unit are required
            return (
              data.value !== undefined &&
              data.value !== null &&
              data.unit !== undefined &&
              data.unit !== null
            );
          },
          {
            message:
              'Para medidas de tamanho (PPE), pelo menos valor OU unidade deve ser fornecido. Para outros tipos, ambos valor e unidade são obrigatórios.',
          },
        ),
    )
    .optional(),

  // PPE fields (when item is a PPE)
  ppeType: z.nativeEnum(PPE_TYPE).nullable().optional(),
  ppeSize: z
    .enum(Object.values(PPE_SIZE) as [string, ...string[]])
    .nullable()
    .optional(),
  ppeCA: z.string().nullable().optional(),
  ppeDeliveryMode: z.nativeEnum(PPE_DELIVERY_MODE).nullable().optional(),
  ppeStandardQuantity: z.number().int().positive().nullable().optional(),
});

// Apply transforms
const toFormData = <T>(data: T) => data;

export const itemCreateSchema = itemCreateSchemaBase.transform(toFormData);
export const itemUpdateSchema = itemUpdateSchemaBase.transform(toFormData);

// ItemBrand CRUD
export const itemBrandCreateSchema = z
  .object({
    name: createNameSchema(1, 255, 'Nome da marca'),
    itemIds: z
      .array(z.string().uuid({ message: 'Item inválido' }))
      .refine(arr => new Set(arr).size === arr.length, {
        message: 'Lista de IDs contém duplicatas',
      })
      .optional(),
  })
  .transform(toFormData);

export const itemBrandUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    itemIds: z
      .array(z.string().uuid({ message: 'Item inválido' }))
      .refine(arr => new Set(arr).size === arr.length, {
        message: 'Lista de IDs contém duplicatas',
      })
      .optional(),
  })
  .transform(toFormData);

// ItemCategory CRUD
export const itemCategoryCreateSchema = z
  .object({
    name: createNameSchema(1, 255, 'Nome da categoria'),
    type: z.nativeEnum(ITEM_CATEGORY_TYPE).default(ITEM_CATEGORY_TYPE.REGULAR),
    itemIds: z
      .array(z.string().uuid({ message: 'Item inválido' }))
      .refine(arr => new Set(arr).size === arr.length, {
        message: 'Lista de IDs contém duplicatas',
      })
      .optional(),
  })
  .transform(toFormData);

export const itemCategoryUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    type: z.nativeEnum(ITEM_CATEGORY_TYPE).optional(),
    itemIds: z
      .array(z.string().uuid({ message: 'Item inválido' }))
      .refine(arr => new Set(arr).size === arr.length, {
        message: 'Lista de IDs contém duplicatas',
      })
      .optional(),
  })
  .transform(toFormData);

// =====================
// GetById Schemas
// =====================

export const itemGetByIdSchema = z.object({
  include: itemIncludeSchema.optional(),
  select: itemSelectSchema.optional(),
});

export const itemBrandGetByIdSchema = z.object({
  include: itemBrandIncludeSchema.optional(),
  select: itemBrandSelectSchema.optional(),
});

export const itemCategoryGetByIdSchema = z.object({
  include: itemCategoryIncludeSchema.optional(),
  select: itemCategorySelectSchema.optional(),
});

// =====================
// Batch Operations Schemas
// =====================

// Item batch operations (new pattern with separated includes)
export const itemBatchCreateSchema = z.object({
  items: z.array(itemCreateSchema),
});

export const itemBatchUpdateSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Item inválido' }),
        data: itemUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma atualização é necessária'),
});

// Query schema for include/select parameter
export const itemQuerySchema = z.object({
  include: itemIncludeSchema.optional(),
  select: itemSelectSchema.optional(),
});

export const itemBatchDeleteSchema = z.object({
  itemIds: z
    .array(z.string().uuid({ message: 'Item inválido' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// ItemBrand batch operations
export const itemBrandBatchCreateSchema = z.object({
  itemBrands: z.array(itemBrandCreateSchema),
});

export const itemBrandBatchUpdateSchema = z.object({
  itemBrands: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Marca inválida' }),
        data: itemBrandUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma atualização é necessária'),
});

export const itemBrandBatchDeleteSchema = z.object({
  itemBrandIds: z
    .array(z.string().uuid({ message: 'Marca inválida' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include/select parameter
export const itemBrandQuerySchema = z.object({
  include: itemBrandIncludeSchema.optional(),
  select: itemBrandSelectSchema.optional(),
});

// ItemCategory batch operations
export const itemCategoryBatchCreateSchema = z.object({
  itemCategories: z.array(itemCategoryCreateSchema),
});

export const itemCategoryBatchUpdateSchema = z.object({
  itemCategories: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Categoria inválida' }),
        data: itemCategoryUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma atualização é necessária'),
});

export const itemCategoryBatchDeleteSchema = z.object({
  itemCategoryIds: z
    .array(z.string().uuid({ message: 'Categoria inválida' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include/select parameter
export const itemCategoryQuerySchema = z.object({
  include: itemCategoryIncludeSchema.optional(),
  select: itemCategorySelectSchema.optional(),
});

// =====================
// Type Inference (FormData types)
// =====================

// Query types

// Item types
export type ItemGetManyFormData = z.infer<typeof itemGetManySchema>;
export type ItemGetByIdFormData = z.infer<typeof itemGetByIdSchema>;
export type ItemQueryFormData = z.infer<typeof itemQuerySchema>;

export type ItemCreateFormData = z.infer<typeof itemCreateSchema>;
export type ItemUpdateFormData = z.infer<typeof itemUpdateSchema>;

export type ItemBatchCreateFormData = z.infer<typeof itemBatchCreateSchema>;
export type ItemBatchUpdateFormData = z.infer<typeof itemBatchUpdateSchema>;
export type ItemBatchDeleteFormData = z.infer<typeof itemBatchDeleteSchema>;

export type ItemInclude = z.infer<typeof itemIncludeSchema>;
export type ItemOrderBy = z.infer<typeof itemOrderBySchema>;
export type ItemWhere = z.infer<typeof itemWhereSchema>;
export type ItemSelect = z.infer<typeof itemSelectSchema>;

// ItemBrand types
export type ItemBrandGetManyFormData = z.infer<typeof itemBrandGetManySchema>;
export type ItemBrandGetByIdFormData = z.infer<typeof itemBrandGetByIdSchema>;
export type ItemBrandQueryFormData = z.infer<typeof itemBrandQuerySchema>;

export type ItemBrandCreateFormData = z.infer<typeof itemBrandCreateSchema>;
export type ItemBrandUpdateFormData = z.infer<typeof itemBrandUpdateSchema>;

export type ItemBrandBatchCreateFormData = z.infer<typeof itemBrandBatchCreateSchema>;
export type ItemBrandBatchUpdateFormData = z.infer<typeof itemBrandBatchUpdateSchema>;
export type ItemBrandBatchDeleteFormData = z.infer<typeof itemBrandBatchDeleteSchema>;

export type ItemBrandInclude = z.infer<typeof itemBrandIncludeSchema>;
export type ItemBrandOrderBy = z.infer<typeof itemBrandOrderBySchema>;
export type ItemBrandWhere = z.infer<typeof itemBrandWhereSchema>;
export type ItemBrandSelect = z.infer<typeof itemBrandSelectSchema>;

// ItemCategory types
export type ItemCategoryGetManyFormData = z.infer<typeof itemCategoryGetManySchema>;
export type ItemCategoryGetByIdFormData = z.infer<typeof itemCategoryGetByIdSchema>;
export type ItemCategoryQueryFormData = z.infer<typeof itemCategoryQuerySchema>;

export type ItemCategoryCreateFormData = z.infer<typeof itemCategoryCreateSchema>;
export type ItemCategoryUpdateFormData = z.infer<typeof itemCategoryUpdateSchema>;

export type ItemCategoryBatchCreateFormData = z.infer<typeof itemCategoryBatchCreateSchema>;
export type ItemCategoryBatchUpdateFormData = z.infer<typeof itemCategoryBatchUpdateSchema>;
export type ItemCategoryBatchDeleteFormData = z.infer<typeof itemCategoryBatchDeleteSchema>;

export type ItemCategoryInclude = z.infer<typeof itemCategoryIncludeSchema>;
export type ItemCategoryOrderBy = z.infer<typeof itemCategoryOrderBySchema>;
export type ItemCategoryWhere = z.infer<typeof itemCategoryWhereSchema>;
export type ItemCategorySelect = z.infer<typeof itemCategorySelectSchema>;

// Specialized select types
export type ItemComboboxSelect = z.infer<typeof itemComboboxSelectSchema>;
export type ItemBrandComboboxSelect = z.infer<typeof itemBrandComboboxSelectSchema>;
export type ItemCategoryComboboxSelect = z.infer<typeof itemCategoryComboboxSelectSchema>;
export type ItemFormSelect = z.infer<typeof itemFormSelectSchema>;
export type ItemDetailSelect = z.infer<typeof itemDetailSelectSchema>;

// =====================
// Helper Functions
// =====================

export const mapItemToFormData = createMapToFormDataHelper<Item, ItemUpdateFormData>(item => ({
  name: item.name,
  uniCode: item.uniCode || undefined,
  quantity: item.quantity,
  maxQuantity: item.maxQuantity || undefined,
  reorderPoint: item.reorderPoint || undefined,
  reorderQuantity: item.reorderQuantity || undefined,
  boxQuantity: item.boxQuantity || undefined,
  isManualMaxQuantity: item.isManualMaxQuantity,
  isManualReorderPoint: item.isManualReorderPoint,
  lastAutoOrderDate: item.lastAutoOrderDate || undefined,
  icms: item.icms,
  ipi: item.ipi,
  monthlyConsumption: item.monthlyConsumption,
  monthlyConsumptionTrendPercent: item.monthlyConsumptionTrendPercent,
  barcodes: item.barcodes,
  shouldAssignToUser: item.shouldAssignToUser,
  brandId: item.brandId || undefined,
  categoryId: item.categoryId || undefined,
  supplierId: item.supplierId || undefined,
  estimatedLeadTime: item.estimatedLeadTime || undefined,
  isActive: item.isActive,
  abcCategory: item.abcCategory,
  abcCategoryOrder: item.abcCategoryOrder,
  xyzCategory: item.xyzCategory,
  xyzCategoryOrder: item.xyzCategoryOrder,
  // PPE fields
  ppeType: item.ppeType || undefined,
  ppeCA: item.ppeCA || undefined,
  ppeDeliveryMode: item.ppeDeliveryMode || undefined,
  ppeStandardQuantity: item.ppeStandardQuantity || undefined,
}));

export const mapItemBrandToFormData = createMapToFormDataHelper<ItemBrand, ItemBrandUpdateFormData>(
  brand => ({
    name: brand.name,
  }),
);

export const mapItemCategoryToFormData = createMapToFormDataHelper<
  ItemCategory,
  ItemCategoryUpdateFormData
>(category => ({
  name: category.name,
  type: category.type,
}));

// =====================
// Item Merge Schema
// =====================

export const itemMergeConflictsSchema = z
  .object({
    keepPrimaryPrice: z.boolean().optional(),
    keepPrimaryDescription: z.boolean().optional(),
    combineBarcodes: z.boolean().optional(),
    combineTags: z.boolean().optional(),
  })
  .optional();

export const itemMergeSchema = z
  .object({
    targetItemId: z.string().uuid({ message: 'ID do item principal inválido' }),
    sourceItemIds: z
      .array(z.string().uuid({ message: 'ID de item inválido' }))
      .min(1, { message: 'É necessário selecionar pelo menos 1 item para mesclar' })
      .max(10, { message: 'Máximo de 10 itens podem ser mesclados por vez' }),
    conflictResolutions: itemMergeConflictsSchema,
  })
  .strict();

export type ItemMergeConflicts = z.infer<typeof itemMergeConflictsSchema>;
export type ItemMergeFormData = z.infer<typeof itemMergeSchema>;
