// packages/schemas/src/paint.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, hexColorSchema } from "./common";
import type { Paint, PaintType, PaintFormula, PaintFormulaComponent, PaintProduction, PaintGround, PaintBrand } from '@types';
import { PAINT_FINISH, COLOR_PALETTE, PAINT_BRAND, TRUCK_MANUFACTURER } from '@constants';
import { taskWhereSchema } from "./task";
import { customerWhereSchema } from "./customer";

// =====================
// Include Schemas (Second Level Only)
// =====================

export const paintTypeIncludeSchema = z
  .object({
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              paints: z.boolean().optional(),
              componentItems: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    paints: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              paintType: z.boolean().optional(),
              formulas: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        _count: z
                          .union([
                            z.boolean(),
                            z.object({
                              select: z
                                .object({
                                  components: z.boolean().optional(),
                                })
                                .optional(),
                            }),
                          ])
                          .optional(),
                        components: z.boolean().optional(),
                        paint: z.boolean().optional(),
                      })
                      .optional(),
                    where: z.any().optional(),
                    orderBy: z.any().optional(),
                    take: z.coerce.number().optional(),
                    skip: z.coerce.number().optional(),
                  }),
                ])
                .optional(),
              generalPaintings: z.boolean().optional(),
              logoTasks: z.boolean().optional(),
              relatedPaints: z.boolean().optional(),
              relatedTo: z.boolean().optional(),
              paintGrounds: z.boolean().optional(),
              groundPaintFor: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    componentItems: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              brand: z.boolean().optional(),
              category: z.boolean().optional(),
              supplier: z.boolean().optional(),
              price: z.boolean().optional(),
              activities: z.boolean().optional(),
              borrows: z.boolean().optional(),
              orderItems: z.boolean().optional(),
              ppeDeliveries: z.boolean().optional(),
              measures: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
  })
  .partial();

export const paintBrandIncludeSchema = z
  .object({
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              paints: z.boolean().optional(),
              componentItems: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    paints: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              paintType: z.boolean().optional(),
              paintBrand: z.boolean().optional(),
              formulas: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        _count: z
                          .union([
                            z.boolean(),
                            z.object({
                              select: z
                                .object({
                                  components: z.boolean().optional(),
                                })
                                .optional(),
                            }),
                          ])
                          .optional(),
                        components: z.boolean().optional(),
                        paint: z.boolean().optional(),
                      })
                      .optional(),
                    where: z.any().optional(),
                    orderBy: z.any().optional(),
                    take: z.coerce.number().optional(),
                    skip: z.coerce.number().optional(),
                  }),
                ])
                .optional(),
              generalPaintings: z.boolean().optional(),
              logoTasks: z.boolean().optional(),
              relatedPaints: z.boolean().optional(),
              relatedTo: z.boolean().optional(),
              paintGrounds: z.boolean().optional(),
              groundPaintFor: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    componentItems: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              brand: z.boolean().optional(),
              category: z.boolean().optional(),
              supplier: z.boolean().optional(),
              price: z.boolean().optional(),
              activities: z.boolean().optional(),
              borrows: z.boolean().optional(),
              orderItems: z.boolean().optional(),
              ppeDeliveries: z.boolean().optional(),
              measures: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// PaintBrand Where Schema
// =====================

export const paintBrandWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      AND: z.union([paintBrandWhereSchema, z.array(paintBrandWhereSchema)]).optional(),
      OR: z.array(paintBrandWhereSchema).optional(),
      NOT: z.union([paintBrandWhereSchema, z.array(paintBrandWhereSchema)]).optional(),
      id: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      name: z
        .union([
          z.string(),
          z.object({ contains: z.string().optional(), startsWith: z.string().optional(), endsWith: z.string().optional(), mode: z.enum(["default", "insensitive"]).optional() }),
        ])
        .optional(),
      createdAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      updatedAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      // Relations
      paints: z
        .object({
          some: z.lazy(() => paintWhereSchema).optional(),
          every: z.lazy(() => paintWhereSchema).optional(),
          none: z.lazy(() => paintWhereSchema).optional(),
        })
        .optional(),
      componentItems: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
    })
    .strict(),
);

export const paintIncludeSchema = z
  .object({
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              formulas: z.boolean().optional(),
              generalPaintings: z.boolean().optional(),
              logoTasks: z.boolean().optional(),
              paintGrounds: z.boolean().optional(),
              groundPaintFor: z.boolean().optional(),
              relatedPaints: z.boolean().optional(),
              relatedTo: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    paintType: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              paints: z.boolean().optional(),
              componentItems: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    paintBrand: z
      .union([
        z.boolean(),
        z.object({
          include: paintBrandIncludeSchema.optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    formulas: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              components: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        item: z.boolean().optional(),
                        formula: z.boolean().optional(),
                      })
                      .optional(),
                    where: z.any().optional(),
                    orderBy: z.any().optional(),
                    take: z.coerce.number().optional(),
                    skip: z.coerce.number().optional(),
                  }),
                ])
                .optional(),
              paint: z.boolean().optional(),
              paintProduction: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    generalPaintings: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              sector: z.boolean().optional(),
              customer: z.boolean().optional(),
              budget: z.boolean().optional(),
              nfe: z.boolean().optional(),
              observation: z.boolean().optional(),
              generalPainting: z.boolean().optional(),
              createdBy: z.boolean().optional(),
              files: z.boolean().optional(),
              logoPaints: z.boolean().optional(),
              commissions: z.boolean().optional(),
              services: z.boolean().optional(),
              truck: z.boolean().optional(),
              airbrushing: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    logoTasks: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              sector: z.boolean().optional(),
              customer: z.boolean().optional(),
              budget: z.boolean().optional(),
              nfe: z.boolean().optional(),
              observation: z.boolean().optional(),
              generalPainting: z.boolean().optional(),
              createdBy: z.boolean().optional(),
              files: z.boolean().optional(),
              logoPaints: z.boolean().optional(),
              commissions: z.boolean().optional(),
              services: z.boolean().optional(),
              truck: z.boolean().optional(),
              airbrushing: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    relatedPaints: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              paintType: z.boolean().optional(),
              formulas: z.boolean().optional(),
              generalPaintings: z.boolean().optional(),
              logoTasks: z.boolean().optional(),
              relatedPaints: z.boolean().optional(),
              relatedTo: z.boolean().optional(),
              paintGrounds: z.boolean().optional(),
              groundPaintFor: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
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
              paintType: z.boolean().optional(),
              formulas: z.boolean().optional(),
              generalPaintings: z.boolean().optional(),
              logoTasks: z.boolean().optional(),
              relatedPaints: z.boolean().optional(),
              relatedTo: z.boolean().optional(),
              paintGrounds: z.boolean().optional(),
              groundPaintFor: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    paintGrounds: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              paint: z.boolean().optional(),
              groundPaint: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    groundPaintFor: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              paint: z.boolean().optional(),
              groundPaint: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
  })
  .partial();

export const paintFormulaIncludeSchema = z
  .object({
    components: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              item: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        prices: z.boolean().optional(),
                        measures: z.boolean().optional(),
                        brand: z.boolean().optional(),
                        category: z.boolean().optional(),
                        supplier: z.boolean().optional(),
                      })
                      .optional(),
                  }),
                ])
                .optional(),
              formula: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    paint: z
      .union([
        z.boolean(),
        z.object({
          include: paintIncludeSchema.optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    paintProduction: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              formula: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
  })
  .partial();

export const paintFormulaComponentIncludeSchema = z
  .object({
    item: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              brand: z.boolean().optional(),
              category: z.boolean().optional(),
              supplier: z.boolean().optional(),
              prices: z.boolean().optional(),
              measures: z.boolean().optional(),
              activities: z.boolean().optional(),
              borrows: z.boolean().optional(),
              orderItems: z.boolean().optional(),
              orderRules: z.boolean().optional(),
              maintenances: z.boolean().optional(),
              maintenanceItems: z.boolean().optional(),
              externalWithdrawalItems: z.boolean().optional(),
            })
            .optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    formula: z
      .union([
        z.boolean(),
        z.object({
          include: paintFormulaIncludeSchema.optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
  })
  .partial();

export const paintProductionIncludeSchema = z
  .object({
    formula: z
      .union([
        z.boolean(),
        z.object({
          include: paintFormulaIncludeSchema.optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
  })
  .partial();

export const paintGroundIncludeSchema = z
  .object({
    paint: z
      .union([
        z.boolean(),
        z.object({
          include: paintIncludeSchema.optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
    groundPaint: z
      .union([
        z.boolean(),
        z.object({
          include: paintIncludeSchema.optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.coerce.number().optional(),
          skip: z.coerce.number().optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// OrderBy Schemas
// =====================

export const paintTypeOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      name: orderByDirectionSchema.optional(),
      needGround: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        needGround: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      }),
    ),
  ])
  .optional();

export const paintBrandOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      name: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      }),
    ),
  ])
  .optional();

export const paintOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      name: orderByDirectionSchema.optional(),
      hex: orderByDirectionSchema.optional(),
      finish: orderByDirectionSchema.optional(),
      manufacturer: orderByDirectionSchema.optional(),
      palette: orderByDirectionSchema.optional(),
      paletteOrder: orderByDirectionSchema.optional(),
      paintTypeId: orderByDirectionSchema.optional(),
      paintBrandId: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
      paintType: paintTypeOrderBySchema.optional(),
      paintBrand: paintBrandOrderBySchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        hex: orderByDirectionSchema.optional(),
        finish: orderByDirectionSchema.optional(),
        manufacturer: orderByDirectionSchema.optional(),
        palette: orderByDirectionSchema.optional(),
        paletteOrder: orderByDirectionSchema.optional(),
        paintTypeId: orderByDirectionSchema.optional(),
        paintBrandId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        paintType: paintTypeOrderBySchema.optional(),
        paintBrand: paintBrandOrderBySchema.optional(),
      }),
    ),
  ])
  .optional();

export const paintFormulaOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      description: orderByDirectionSchema.optional(),
      density: orderByDirectionSchema.optional(),
      pricePerLiter: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        description: orderByDirectionSchema.optional(),
        density: orderByDirectionSchema.optional(),
        pricePerLiter: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      }),
    ),
  ])
  .optional();

export const paintFormulaComponentOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      ratio: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        ratio: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      }),
    ),
  ])
  .optional();

export const paintProductionOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      volumeLiters: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
      formula: z
        .object({
          description: orderByDirectionSchema.optional(),
          paint: z
            .object({
              name: orderByDirectionSchema.optional(),
            })
            .optional(),
        })
        .optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        volumeLiters: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        formula: z
          .object({
            description: orderByDirectionSchema.optional(),
            paint: z
              .object({
                name: orderByDirectionSchema.optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    ),
  ])
  .optional();

export const paintGroundOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      paintId: orderByDirectionSchema.optional(),
      groundPaintId: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
      paint: paintOrderBySchema.optional(),
      groundPaint: paintOrderBySchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        paintId: orderByDirectionSchema.optional(),
        groundPaintId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        paint: paintOrderBySchema.optional(),
        groundPaint: paintOrderBySchema.optional(),
      }),
    ),
  ])
  .optional();

// =====================
// Where Schemas
// =====================

export const paintWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      AND: z.union([paintWhereSchema, z.array(paintWhereSchema)]).optional(),
      OR: z.array(paintWhereSchema).optional(),
      NOT: z.union([paintWhereSchema, z.array(paintWhereSchema)]).optional(),
      id: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      name: z.union([z.string(), z.object({ contains: z.string().optional(), startsWith: z.string().optional(), endsWith: z.string().optional() })]).optional(),
      hex: z.union([z.string(), z.object({ contains: z.string().optional(), startsWith: z.string().optional(), endsWith: z.string().optional() })]).optional(),
      finish: z.union([z.nativeEnum(PAINT_FINISH), z.object({ in: z.array(z.nativeEnum(PAINT_FINISH)).optional() })]).optional(),
      manufacturer: z.union([z.nativeEnum(TRUCK_MANUFACTURER), z.object({ in: z.array(z.nativeEnum(TRUCK_MANUFACTURER)).optional() })]).optional(),
      palette: z.union([z.nativeEnum(COLOR_PALETTE), z.object({ in: z.array(z.nativeEnum(COLOR_PALETTE)).optional() })]).optional(),
      paletteOrder: z.union([z.number(), z.object({ gte: z.number().optional(), lte: z.number().optional() })]).optional(),
      tags: z.object({ has: z.string().optional(), hasEvery: z.array(z.string()).optional(), hasSome: z.array(z.string()).optional() }).optional(),
      paintTypeId: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      paintBrandId: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      createdAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      updatedAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      // Relations
      paintType: z.lazy(() => paintTypeWhereSchema).optional(),
      paintBrand: z.lazy(() => paintBrandWhereSchema).optional(),
      formulas: z
        .object({
          some: z.lazy(() => paintFormulaWhereSchema).optional(),
          every: z.lazy(() => paintFormulaWhereSchema).optional(),
          none: z.lazy(() => paintFormulaWhereSchema).optional(),
        })
        .optional(),
      generalPaintings: z
        .object({
          some: z.lazy(() => taskWhereSchema).optional(),
          every: z.lazy(() => taskWhereSchema).optional(),
          none: z.lazy(() => taskWhereSchema).optional(),
        })
        .optional(),
      logoTasks: z
        .object({
          some: z.lazy(() => taskWhereSchema).optional(),
          every: z.lazy(() => taskWhereSchema).optional(),
          none: z.lazy(() => taskWhereSchema).optional(),
        })
        .optional(),
      relatedPaints: z
        .object({
          some: paintWhereSchema.optional(),
          every: paintWhereSchema.optional(),
          none: paintWhereSchema.optional(),
        })
        .optional(),
      relatedTo: z
        .object({
          some: paintWhereSchema.optional(),
          every: paintWhereSchema.optional(),
          none: paintWhereSchema.optional(),
        })
        .optional(),
      paintGrounds: z
        .object({
          some: z.lazy(() => paintGroundWhereSchema).optional(),
          every: z.lazy(() => paintGroundWhereSchema).optional(),
          none: z.lazy(() => paintGroundWhereSchema).optional(),
        })
        .optional(),
      groundPaintFor: z
        .object({
          some: z.lazy(() => paintGroundWhereSchema).optional(),
          every: z.lazy(() => paintGroundWhereSchema).optional(),
          none: z.lazy(() => paintGroundWhereSchema).optional(),
        })
        .optional(),
    })
    .strict(),
);

export const paintFormulaWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      AND: z.union([paintFormulaWhereSchema, z.array(paintFormulaWhereSchema)]).optional(),
      OR: z.array(paintFormulaWhereSchema).optional(),
      NOT: z.union([paintFormulaWhereSchema, z.array(paintFormulaWhereSchema)]).optional(),
      id: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      description: z.union([z.string(), z.object({ contains: z.string().optional(), startsWith: z.string().optional(), endsWith: z.string().optional() })]).optional(),
      paintId: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      paint: paintWhereSchema.optional(),
      components: z
        .object({
          some: paintFormulaComponentWhereSchema.optional(),
          every: paintFormulaComponentWhereSchema.optional(),
          none: paintFormulaComponentWhereSchema.optional(),
        })
        .optional(),
      createdAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      updatedAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
    })
    .strict(),
);

export const paintFormulaComponentWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      AND: z.union([paintFormulaComponentWhereSchema, z.array(paintFormulaComponentWhereSchema)]).optional(),
      OR: z.array(paintFormulaComponentWhereSchema).optional(),
      NOT: z.union([paintFormulaComponentWhereSchema, z.array(paintFormulaComponentWhereSchema)]).optional(),
      id: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      ratio: z.union([z.number(), z.object({ gte: z.number().optional(), lte: z.number().optional() })]).optional(),
      itemId: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      formulaPaintId: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      createdAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      updatedAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
    })
    .strict(),
);

export const paintProductionWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      AND: z.union([paintProductionWhereSchema, z.array(paintProductionWhereSchema)]).optional(),
      OR: z.array(paintProductionWhereSchema).optional(),
      NOT: z.union([paintProductionWhereSchema, z.array(paintProductionWhereSchema)]).optional(),
      id: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      volumeLiters: z.union([z.number(), z.object({ gte: z.number().optional(), lte: z.number().optional() })]).optional(),
      formulaId: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      createdAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      updatedAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      // Add nested relations support
      formula: z.lazy(() => paintFormulaWhereSchema).optional(),
    })
    .strict(),
);

// =====================
// Paint Query Filters and Transform
// =====================

const paintFilters = {
  searchingFor: z.string().optional(),
  code: z.string().optional(),
  finishes: z.array(z.nativeEnum(PAINT_FINISH)).optional(),
  brands: z.array(z.nativeEnum(PAINT_BRAND)).optional(),
  manufacturers: z.array(z.nativeEnum(TRUCK_MANUFACTURER)).optional(),
  palettes: z.array(z.nativeEnum(COLOR_PALETTE)).optional(),
  tags: z.array(z.string()).optional(),
  hasFormulas: z.boolean().optional(),
  minpaletteOrder: z.number().optional(),
  maxpaletteOrder: z.number().optional(),
  paintTypeIds: z.array(z.string()).optional(),
  paintBrandIds: z.array(z.string()).optional(),
  // Color similarity filtering
  similarColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color').optional(),
  similarColorThreshold: z.coerce.number().min(0).max(100).default(15).optional(),
};

const paintTransform = (data: any) => {
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

  // searchingFor is handled entirely by the service layer for comprehensive search including:
  // - Paint direct fields: name, code, hex
  // - Tags (array field search)
  // - Task fields: name, serialNumber, plate (through generalPaintings and logoTasks relations)
  // - Customer fields: fantasyName, corporateName, cnpj, cpf (through task relations)
  // Pass it through to the service without processing here
  // Note: We keep searchingFor in the data object so it gets passed to the service

  // Handle code filtering
  if (data.code) {
    andConditions.push({ code: { contains: data.code, mode: "insensitive" } });
    delete data.code;
  }

  if (data.finishes) {
    andConditions.push({ finish: { in: data.finishes } });
    delete data.finishes;
  }

  if (data.brands) {
    andConditions.push({ paintBrand: { name: { in: data.brands } } });
    delete data.brands;
  }

  if (data.manufacturers) {
    andConditions.push({ manufacturer: { in: data.manufacturers } });
    delete data.manufacturers;
  }

  if (data.palettes) {
    andConditions.push({ palette: { in: data.palettes } });
    delete data.palettes;
  }

  if (data.tags) {
    andConditions.push({ tags: { hasSome: data.tags } });
    delete data.tags;
  }

  if (data.paintTypeIds) {
    andConditions.push({ paintTypeId: { in: data.paintTypeIds } });
    delete data.paintTypeIds;
  }

  if (data.paintBrandIds) {
    andConditions.push({ paintBrandId: { in: data.paintBrandIds } });
    delete data.paintBrandIds;
  }

  if (data.hasFormulas !== undefined) {
    andConditions.push({
      formulas: data.hasFormulas ? { some: {} } : { none: {} },
    });
    delete data.hasFormulas;
  }

  if (data.minpaletteOrder !== undefined || data.maxpaletteOrder !== undefined) {
    const paletteCondition: any = {};
    if (data.minpaletteOrder !== undefined) {
      paletteCondition.gte = data.minpaletteOrder;
      delete data.minpaletteOrder;
    }
    if (data.maxpaletteOrder !== undefined) {
      paletteCondition.lte = data.maxpaletteOrder;
      delete data.maxpaletteOrder;
    }
    andConditions.push({ paletteOrder: paletteCondition });
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
      // Preserve existing where conditions and merge with new conditions
      if (data.where.AND) {
        // If AND already exists, append to it
        data.where = { ...data.where, AND: [...(Array.isArray(data.where.AND) ? data.where.AND : [data.where.AND]), ...andConditions] };
      } else {
        // Create AND with existing where conditions and new conditions
        const existingConditions = { ...data.where };
        data.where = { AND: [existingConditions, ...andConditions] };
      }
    } else {
      // No existing where, create new one
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  // Convert limit to take for repository compatibility
  if (data.limit !== undefined) {
    data.take = data.limit;
    delete data.limit;
  }

  // Ensure orderBy is in the correct format (array of objects with single fields)
  if (data.orderBy) {
    if (!Array.isArray(data.orderBy)) {
      // If it's an object, split it into an array of single-field objects
      const orderByArray: any[] = [];
      for (const [field, direction] of Object.entries(data.orderBy)) {
        if (direction) {
          orderByArray.push({ [field]: direction });
        }
      }
      data.orderBy = orderByArray;
    }
  }

  return data;
};

// =====================
// Get By ID Schemas
// =====================

export const paintGetByIdSchema = z.object({
  include: paintIncludeSchema.optional(),
});

export const paintFormulaGetByIdSchema = z.object({
  include: paintFormulaIncludeSchema.optional(),
});

export const paintFormulaComponentGetByIdSchema = z.object({
  include: paintFormulaComponentIncludeSchema.optional(),
});

export const paintProductionGetByIdSchema = z.object({
  include: paintProductionIncludeSchema.optional(),
});

// =====================
// Query Schemas
// =====================

export const paintGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).default(20).optional(),

    // Direct Prisma clauses
    where: paintWhereSchema.optional(),
    orderBy: paintOrderBySchema.optional(),
    include: paintIncludeSchema.optional(),

    // Convenience filters
    ...paintFilters,

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
  .transform(paintTransform);

// PaintType Query Schemas
export const paintTypeWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      AND: z.union([paintTypeWhereSchema, z.array(paintTypeWhereSchema)]).optional(),
      OR: z.array(paintTypeWhereSchema).optional(),
      NOT: z.union([paintTypeWhereSchema, z.array(paintTypeWhereSchema)]).optional(),
      id: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      name: z.union([z.string(), z.object({ contains: z.string().optional(), startsWith: z.string().optional(), endsWith: z.string().optional() })]).optional(),
      needGround: z.boolean().optional(),
      createdAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      updatedAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      // Relations
      paints: z
        .object({
          some: paintWhereSchema.optional(),
          every: paintWhereSchema.optional(),
          none: paintWhereSchema.optional(),
        })
        .optional(),
      componentItems: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
    })
    .strict(),
);

const paintTypeFilters = {
  searchingFor: z.string().optional(),
  needGround: z.boolean().optional(),
};

const paintTypeTransform = (data: any) => {
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

  if (data.searchingFor) {
    andConditions.push({
      OR: [{ name: { contains: data.searchingFor, mode: "insensitive" } }],
    });
    delete data.searchingFor;
  }

  if (data.needGround !== undefined) {
    andConditions.push({ needGround: data.needGround });
    delete data.needGround;
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
      data.where = data.where.AND ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] } : andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  // Convert limit to take for repository compatibility
  if (data.limit !== undefined) {
    data.take = data.limit;
    delete data.limit;
  }

  // Ensure orderBy is in the correct format (array of objects with single fields)
  if (data.orderBy) {
    if (!Array.isArray(data.orderBy)) {
      // If it's an object, split it into an array of single-field objects
      const orderByArray: any[] = [];
      for (const [field, direction] of Object.entries(data.orderBy)) {
        if (direction) {
          orderByArray.push({ [field]: direction });
        }
      }
      data.orderBy = orderByArray;
    }
  }

  return data;
};

export const paintTypeGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).default(20).optional(),
    where: paintTypeWhereSchema.optional(),
    orderBy: paintTypeOrderBySchema.optional(),
    include: paintTypeIncludeSchema.optional(),
    ...paintTypeFilters,
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
  .transform(paintTypeTransform);

export const paintTypeGetByIdSchema = z.object({
  include: paintTypeIncludeSchema.optional(),
});

export const paintTypeQuerySchema = z.object({
  include: paintTypeIncludeSchema.optional(),
});

// =====================
// CRUD Schemas
// =====================

// PaintType schemas
export const paintTypeCreateSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(100, "Nome deve ter no máximo 100 caracteres"),
  needGround: z.boolean().default(false),
  componentItemIds: z.array(z.string().uuid("Item inválido")).optional(),
});

export const paintTypeUpdateSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(100, "Nome deve ter no máximo 100 caracteres").optional(),
  needGround: z.boolean().optional(),
  componentItemIds: z.array(z.string().uuid("Item inválido")).optional(),
});

export const paintTypeBatchCreateSchema = z.object({
  paintTypes: z.array(paintTypeCreateSchema).min(1, "Pelo menos um tipo de tinta deve ser fornecido"),
});

export const paintTypeBatchUpdateSchema = z.object({
  paintTypes: z
    .array(
      z.object({
        id: z.string().uuid("ID inválido"),
        data: paintTypeUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização deve ser fornecida"),
});

export const paintTypeBatchDeleteSchema = z.object({
  paintTypeIds: z.array(z.string().uuid("Tipo de tinta inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Paint schemas
export const paintCreateSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  code: z.string().min(1).max(20).nullable().optional(),
  hex: hexColorSchema,
  finish: z.enum(Object.values(PAINT_FINISH) as [string, ...string[]], {
    errorMap: () => ({ message: "acabamento inválido" }),
  }),
  paintTypeId: z.string().uuid("Tipo de tinta inválido"),
  paintBrandId: z.string().uuid("Marca de tinta inválida").nullable().optional(),
  manufacturer: z
    .enum(Object.values(TRUCK_MANUFACTURER) as [string, ...string[]], {
      errorMap: () => ({ message: "MONTADORA inválida" }),
    })
    .nullable()
    .optional(),
  tags: z.array(z.string()).default([]),
  palette: z
    .enum(Object.values(COLOR_PALETTE) as [string, ...string[]], {
      errorMap: () => ({ message: "paleta inválida" }),
    })
    .optional(),
  paletteOrder: z.number().int().min(1).max(14).optional(),
  colorOrder: z.number().int().nullable().optional(),
  groundIds: z.array(z.string().uuid()).optional(),
});

export const paintUpdateSchema = z.object({
  name: z.string().min(1, "Nome deve conter ao menos um caracter").optional(),
  code: z.string().min(1).max(20).nullable().optional(),
  hex: hexColorSchema.optional(),
  finish: z
    .enum(Object.values(PAINT_FINISH) as [string, ...string[]], {
      errorMap: () => ({ message: "acabamento inválido" }),
    })
    .optional(),
  paintTypeId: z.string().uuid("Tipo de tinta inválido").optional(),
  paintBrandId: z.string().uuid("Marca de tinta inválida").nullable().optional(),
  manufacturer: z
    .enum(Object.values(TRUCK_MANUFACTURER) as [string, ...string[]], {
      errorMap: () => ({ message: "MONTADOR inválido" }),
    })
    .nullable()
    .optional(),
  tags: z.array(z.string()).default([]).optional(),
  palette: z
    .enum(Object.values(COLOR_PALETTE) as [string, ...string[]], {
      errorMap: () => ({ message: "paleta inválida" }),
    })
    .optional(),
  paletteOrder: z.number().int().min(1).max(14).optional(),
  colorOrder: z.number().int().nullable().optional(),
  groundIds: z.array(z.string().uuid()).optional(),
});

// =====================
// Batch Operations Schemas
// =====================

export const paintBatchCreateSchema = z.object({
  paints: z.array(paintCreateSchema).min(1, "Pelo menos uma tinta deve ser fornecida"),
});

export const paintBatchUpdateSchema = z.object({
  paints: z
    .array(
      z.object({
        id: z.string().uuid("Tinta inválida"),
        data: paintUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const paintBatchDeleteSchema = z.object({
  paintIds: z.array(z.string().uuid("Tinta inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

export const paintBatchUpdateColorOrderSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string().uuid("Tinta inválida"),
        colorOrder: z.number().int(),
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

// Query schema for include parameter
export const paintQuerySchema = z.object({
  include: paintIncludeSchema.optional(),
});

// =====================
// Paint Formula Schemas
// =====================

const paintFormulaFilters = {
  searchingFor: z.string().optional(),
  paintIds: z.array(z.string()).optional(),
  hasComponents: z.boolean().optional(),
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
};

const paintFormulaTransform = (data: any) => {
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

  if (data.searchingFor) {
    andConditions.push({
      OR: [{ description: { contains: data.searchingFor, mode: "insensitive" } }, { paint: { name: { contains: data.searchingFor, mode: "insensitive" } } }],
    });
    delete data.searchingFor;
  }

  if (data.paintIds) {
    andConditions.push({ paintId: { in: data.paintIds } });
    delete data.paintIds;
  }

  if (data.hasComponents !== undefined) {
    andConditions.push({
      components: data.hasComponents ? { some: {} } : { none: {} },
    });
    delete data.hasComponents;
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
      data.where = data.where.AND ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] } : andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  // Convert limit to take for repository compatibility
  if (data.limit !== undefined) {
    data.take = data.limit;
    delete data.limit;
  }

  // Ensure orderBy is in the correct format (array of objects with single fields)
  if (data.orderBy) {
    if (!Array.isArray(data.orderBy)) {
      // If it's an object, split it into an array of single-field objects
      const orderByArray: any[] = [];
      for (const [field, direction] of Object.entries(data.orderBy)) {
        if (direction) {
          orderByArray.push({ [field]: direction });
        }
      }
      data.orderBy = orderByArray;
    }
  }

  return data;
};

export const paintFormulaGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).default(20).optional(),
    where: paintFormulaWhereSchema.optional(),
    orderBy: paintFormulaOrderBySchema.optional(),
    include: paintFormulaIncludeSchema.optional(),
    ...paintFormulaFilters,
  })
  .transform(paintFormulaTransform);

export const paintFormulaCreateSchema = z
  .object({
    description: z.string().min(1, "Descrição é obrigatória"),
    paintId: z.string().uuid("Tinta inválida"),
    components: z
      .array(
        z.object({
          ratio: z.number().positive("Proporção deve ser positiva").min(0.1, "Proporção mínima é 0.1%").max(100, "Proporção máxima é 100%").optional(),
          weightInGrams: z.number().positive("Peso deve ser positivo").min(0.1, "Peso mínimo é 0.1g").optional(),
          itemId: z.string().uuid("Item inválido"),
          formulaPaintId: z.string().uuid("Fórmula inválida").optional(),
        }).refine(
          (data) => data.ratio !== undefined || data.weightInGrams !== undefined,
          {
            message: "ratio ou weightInGrams deve ser fornecido para cada componente",
          }
        ),
      )
      .min(1, "Fórmula deve ter pelo menos um componente"),
  })
  .refine(
    (data) => {
      // Ensure total ratio equals 100% if ratios are provided
      const ratioComponents = data.components.filter(comp => comp.ratio !== undefined);
      if (ratioComponents.length > 0) {
        const totalRatio = ratioComponents.reduce((sum, comp) => sum + (comp.ratio || 0), 0);
        return Math.abs(totalRatio - 100) < 0.01; // Allow small floating point error
      }
      return true;
    },
    {
      message: "A soma das proporções deve ser igual a 100%",
    },
  );

export const paintFormulaUpdateSchema = z
  .object({
    description: z.string().min(1, "Descrição é obrigatória").optional(),
    paintId: z.string().uuid("Tinta inválida").optional(),
  })
  .refine(
    (data) => {
      // Ensure at least one field is being updated
      return data.description !== undefined || data.paintId !== undefined;
    },
    {
      message: "Pelo menos um campo deve ser fornecido para atualização",
    },
  );

export const paintFormulaBatchCreateSchema = z.object({
  paintFormulas: z.array(paintFormulaCreateSchema).min(1, "Pelo menos uma fórmula de tinta deve ser fornecida"),
});

export const paintFormulaBatchUpdateSchema = z.object({
  paintFormulas: z
    .array(
      z.object({
        id: z.string().uuid("Fórmula inválida"),
        data: paintFormulaUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const paintFormulaBatchDeleteSchema = z.object({
  paintFormulaIds: z.array(z.string().uuid("Fórmula inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const paintFormulaQuerySchema = z.object({
  include: paintFormulaIncludeSchema.optional(),
});

// =====================
// Paint Formula Component Schemas
// =====================

const paintFormulaComponentTransform = (data: any) => {
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

  // Build formula condition object to combine all formula-related filters
  const formulaCondition: any = {};

  // Handle search - this creates an OR condition for item name or formula description
  if (data.searchingFor) {
    formulaCondition.OR = [{ description: { contains: data.searchingFor, mode: "insensitive" } }, { paint: { name: { contains: data.searchingFor, mode: "insensitive" } } }];
    delete data.searchingFor;
  }

  // Handle paint-related filters - combine them into a single paint object
  const paintCondition: any = {};

  if (data.paintTypeIds && data.paintTypeIds.length > 0) {
    paintCondition.paintTypeId = { in: data.paintTypeIds };
    delete data.paintTypeIds;
  }

  if (data.paintBrands && data.paintBrands.length > 0) {
    paintCondition.brand = { in: data.paintBrands };
    delete data.paintBrands;
  }

  if (data.paintBrandIds && data.paintBrandIds.length > 0) {
    paintCondition.paintBrandId = { in: data.paintBrandIds };
    delete data.paintBrandIds;
  }

  // If we have paint conditions, add them to the formula condition
  if (Object.keys(paintCondition).length > 0) {
    // If we already have an OR condition for search, we need to handle this carefully
    if (formulaCondition.OR) {
      // We need to combine search OR with paint filters using AND
      formulaCondition.AND = [{ OR: formulaCondition.OR }, { paint: paintCondition }];
      delete formulaCondition.OR;
    } else {
      // No search, just add paint condition
      formulaCondition.paint = paintCondition;
    }
  }

  // Add formula condition if we have any formula-related filters
  if (Object.keys(formulaCondition).length > 0) {
    andConditions.push({ formula: formulaCondition });
  }

  if (data.formulaIds) {
    andConditions.push({ formulaPaintId: { in: data.formulaIds } });
    delete data.formulaIds;
  }

  if (data.itemIds) {
    andConditions.push({ itemId: { in: data.itemIds } });
    delete data.itemIds;
  }

  if (data.ratioRange) {
    const ratioCondition: any = {};
    if (data.ratioRange.min !== undefined) ratioCondition.gte = data.ratioRange.min;
    if (data.ratioRange.max !== undefined) ratioCondition.lte = data.ratioRange.max;
    if (Object.keys(ratioCondition).length > 0) {
      andConditions.push({ ratio: ratioCondition });
    }
    delete data.ratioRange;
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
      data.where = data.where.AND ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] } : andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  // Convert limit to take for repository compatibility
  if (data.limit !== undefined) {
    data.take = data.limit;
    delete data.limit;
  }

  // Ensure orderBy is in the correct format (array of objects with single fields)
  if (data.orderBy) {
    if (!Array.isArray(data.orderBy)) {
      // If it's an object, split it into an array of single-field objects
      const orderByArray: any[] = [];
      for (const [field, direction] of Object.entries(data.orderBy)) {
        if (direction) {
          orderByArray.push({ [field]: direction });
        }
      }
      data.orderBy = orderByArray;
    }
  }

  return data;
};

// Add new filters for component filtering based on paint properties
const paintFormulaComponentFilters = {
  searchingFor: z.string().optional(),
  formulaIds: z.array(z.string()).optional(),
  itemIds: z.array(z.string()).optional(),
  paintTypeIds: z.array(z.string()).optional(), // Filter components by paint type
  paintBrands: z.array(z.nativeEnum(PAINT_BRAND)).optional(), // Filter components by paint brand (legacy enum)
  paintBrandIds: z.array(z.string()).optional(), // Filter components by paint brand entity
  ratioRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
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
};

export const paintFormulaComponentGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).default(20).optional(),
    where: paintFormulaComponentWhereSchema.optional(),
    orderBy: paintFormulaComponentOrderBySchema.optional(),
    include: paintFormulaComponentIncludeSchema.optional(),
    ...paintFormulaComponentFilters,
  })
  .transform(paintFormulaComponentTransform);

export const paintFormulaComponentCreateSchema = z.object({
  weight: z.number().positive("Peso deve ser positivo"),  // Weight in grams
  itemId: z.string().uuid("Item inválido"),
  formulaPaintId: z.string().uuid("Fórmula inválida"),
});

export const paintFormulaComponentUpdateSchema = z
  .object({
    weight: z.number().positive("Peso deve ser positivo").optional(),  // Weight in grams
    itemId: z.string().uuid("Item inválido").optional(),
    formulaPaintId: z.string().uuid("Fórmula inválida").optional(),
  })
  .refine(
    (data) => {
      // Ensure at least one field is being updated
      return data.weight !== undefined || data.itemId !== undefined || data.formulaPaintId !== undefined;
    },
    {
      message: "Pelo menos um campo deve ser fornecido para atualização",
    },
  );

export const paintFormulaComponentBatchCreateSchema = z.object({
  paintFormulaComponents: z.array(paintFormulaComponentCreateSchema).min(1, "Pelo menos um componente de fórmula de tinta deve ser fornecido"),
});

export const paintFormulaComponentBatchUpdateSchema = z.object({
  paintFormulaComponents: z
    .array(
      z.object({
        id: z.string().uuid("Componente inválido"),
        data: paintFormulaComponentUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const paintFormulaComponentBatchDeleteSchema = z.object({
  paintFormulaComponentIds: z.array(z.string().uuid("Componente inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const paintFormulaComponentQuerySchema = z.object({
  include: paintFormulaComponentIncludeSchema.optional(),
});

// =====================
// Paint Production Schemas
// =====================

const paintProductionFilters = {
  searchingFor: z.string().optional(),
  formulaIds: z.array(z.string()).optional(),
  paintTypeIds: z.array(z.string()).optional(), // Direct paint type filtering
  paintFinishes: z.array(z.nativeEnum(PAINT_FINISH)).optional(), // Direct finish filtering
  paintBrands: z.array(z.nativeEnum(PAINT_BRAND)).optional(), // Direct brand filtering (legacy enum)
  paintBrandIds: z.array(z.string()).optional(), // Direct paint brand entity filtering
  volumeRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
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
};

const paintProductionTransform = (data: any) => {
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

  // Build formula condition object to combine all formula-related filters
  const formulaCondition: any = {};

  // Handle search - this creates an OR condition for formula description or paint name
  if (data.searchingFor) {
    formulaCondition.OR = [{ description: { contains: data.searchingFor, mode: "insensitive" } }, { paint: { name: { contains: data.searchingFor, mode: "insensitive" } } }];
    delete data.searchingFor;
  }

  // Handle paint-related filters - combine them into a single paint object
  const paintCondition: any = {};

  if (data.paintTypeIds && data.paintTypeIds.length > 0) {
    paintCondition.paintTypeId = { in: data.paintTypeIds };
    delete data.paintTypeIds;
  }

  if (data.paintFinishes && data.paintFinishes.length > 0) {
    paintCondition.finish = { in: data.paintFinishes };
    delete data.paintFinishes;
  }

  if (data.paintBrands && data.paintBrands.length > 0) {
    paintCondition.brand = { in: data.paintBrands };
    delete data.paintBrands;
  }

  if (data.paintBrandIds && data.paintBrandIds.length > 0) {
    paintCondition.paintBrandId = { in: data.paintBrandIds };
    delete data.paintBrandIds;
  }

  // If we have paint conditions, add them to the formula condition
  if (Object.keys(paintCondition).length > 0) {
    // If we already have an OR condition for search, we need to handle this carefully
    if (formulaCondition.OR) {
      // We need to combine search OR with paint filters using AND
      formulaCondition.AND = [{ OR: formulaCondition.OR }, { paint: paintCondition }];
      delete formulaCondition.OR;
    } else {
      // No search, just add paint condition
      formulaCondition.paint = paintCondition;
    }
  }

  // Add formula condition if we have any formula-related filters
  if (Object.keys(formulaCondition).length > 0) {
    andConditions.push({ formula: formulaCondition });
  }

  // Handle direct production fields
  if (data.formulaIds) {
    andConditions.push({ formulaId: { in: data.formulaIds } });
    delete data.formulaIds;
  }

  if (data.volumeRange) {
    const volumeCondition: any = {};
    if (data.volumeRange.min !== undefined) volumeCondition.gte = data.volumeRange.min;
    if (data.volumeRange.max !== undefined) volumeCondition.lte = data.volumeRange.max;
    if (Object.keys(volumeCondition).length > 0) {
      andConditions.push({ volumeLiters: volumeCondition });
    }
    delete data.volumeRange;
  }

  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  // Apply the final where condition
  if (andConditions.length > 0) {
    if (data.where) {
      data.where = data.where.AND ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] } : andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  // Convert limit to take for repository compatibility
  if (data.limit !== undefined) {
    data.take = data.limit;
    delete data.limit;
  }

  // Ensure orderBy is in the correct format (array of objects with single fields)
  if (data.orderBy) {
    if (!Array.isArray(data.orderBy)) {
      // If it's an object, split it into an array of single-field objects
      const orderByArray: any[] = [];
      for (const [field, direction] of Object.entries(data.orderBy)) {
        if (direction) {
          orderByArray.push({ [field]: direction });
        }
      }
      data.orderBy = orderByArray;
    }
  }

  return data;
};

export const paintProductionGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).default(20).optional(),
    where: paintProductionWhereSchema.optional(),
    orderBy: paintProductionOrderBySchema.optional(),
    include: paintProductionIncludeSchema.optional(),
    ...paintProductionFilters,
  })
  .transform(paintProductionTransform);

export const paintProductionCreateSchema = z
  .object({
    volumeLiters: z.number().positive("Volume deve ser positivo").min(0.001, "Volume mínimo é 0.001 litros (1ml)").max(100, "Volume máximo é 100 litros por produção"),
    formulaId: z.string().uuid("Fórmula inválida"),
  })
  .refine(
    (data) => {
      // Volume should be reasonable for paint production
      return data.volumeLiters >= 0.001 && data.volumeLiters <= 100; // 1ml to 100L
    },
    {
      message: "Volume deve estar entre 0.001L (1ml) e 100L para produção de tinta",
    },
  );

export const paintProductionUpdateSchema = z.object({
  volumeLiters: z.number().positive("Volume deve ser positivo").min(0.001, "Volume mínimo é 0.001 litros (1ml)").max(100, "Volume máximo é 100 litros por produção").optional(),
  formulaId: z.string().uuid("Fórmula inválida").optional(),
});

export const paintProductionBatchCreateSchema = z.object({
  paintProductions: z.array(paintProductionCreateSchema).min(1, "Pelo menos uma produção de tinta deve ser fornecida"),
});

export const paintProductionBatchUpdateSchema = z.object({
  paintProductions: z
    .array(
      z.object({
        id: z.string().uuid("Produção inválida"),
        data: paintProductionUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const paintProductionBatchDeleteSchema = z.object({
  paintProductionIds: z.array(z.string().uuid("Produção inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const paintProductionQuerySchema = z.object({
  include: paintProductionIncludeSchema.optional(),
});

// Batch query schema for include parameter
export const paintProductionBatchQuerySchema = z.object({
  include: paintProductionIncludeSchema.optional(),
});

// =====================
// Paint Base Schemas
// =====================

export const paintGroundWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      AND: z.union([paintGroundWhereSchema, z.array(paintGroundWhereSchema)]).optional(),
      OR: z.array(paintGroundWhereSchema).optional(),
      NOT: z.union([paintGroundWhereSchema, z.array(paintGroundWhereSchema)]).optional(),
      id: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      paintId: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      groundPaintId: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      paint: paintWhereSchema.optional(),
      groundPaint: paintWhereSchema.optional(),
      createdAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
      updatedAt: z.object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() }).optional(),
    })
    .strict(),
);

const paintGroundFilters = {
  searchingFor: z.string().optional(),
  paintIds: z.array(z.string()).optional(),
  groundPaintIds: z.array(z.string()).optional(),
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
};

const paintGroundTransform = (data: any) => {
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

  if (data.searchingFor) {
    andConditions.push({
      paint: { name: { contains: data.searchingFor, mode: "insensitive" } },
    });
    delete data.searchingFor;
  }

  if (data.paintIds) {
    andConditions.push({ paintId: { in: data.paintIds } });
    delete data.paintIds;
  }

  if (data.groundPaintIds) {
    andConditions.push({ groundPaintId: { in: data.groundPaintIds } });
    delete data.groundPaintIds;
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
      data.where = data.where.AND ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] } : andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  // Convert limit to take for repository compatibility
  if (data.limit !== undefined) {
    data.take = data.limit;
    delete data.limit;
  }

  // Ensure orderBy is in the correct format (array of objects with single fields)
  if (data.orderBy) {
    if (!Array.isArray(data.orderBy)) {
      // If it's an object, split it into an array of single-field objects
      const orderByArray: any[] = [];
      for (const [field, direction] of Object.entries(data.orderBy)) {
        if (direction) {
          orderByArray.push({ [field]: direction });
        }
      }
      data.orderBy = orderByArray;
    }
  }

  return data;
};

export const paintGroundGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).default(20).optional(),
    where: paintGroundWhereSchema.optional(),
    orderBy: paintGroundOrderBySchema.optional(),
    include: paintGroundIncludeSchema.optional(),
    ...paintGroundFilters,
  })
  .transform(paintGroundTransform);

export const paintGroundGetByIdSchema = z.object({
  include: paintGroundIncludeSchema.optional(),
});

export const paintGroundCreateSchema = z.object({
  paintId: z.string().uuid("Tinta inválida"),
  groundPaintId: z.string().uuid("Tinta base inválida"),
});

export const paintGroundUpdateSchema = z.object({
  paintId: z.string().uuid("Tinta inválida").optional(),
  groundPaintId: z.string().uuid("Tinta base inválida").optional(),
});

export const paintGroundBatchCreateSchema = z.object({
  paintGrounds: z.array(paintGroundCreateSchema).min(1, "Pelo menos uma base de tinta deve ser fornecida"),
});

export const paintGroundBatchUpdateSchema = z.object({
  paintGrounds: z
    .array(
      z.object({
        id: z.string().uuid("Base inválida"),
        data: paintGroundUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const paintGroundBatchDeleteSchema = z.object({
  paintGroundIds: z.array(z.string().uuid("Base inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const paintGroundQuerySchema = z.object({
  include: paintGroundIncludeSchema.optional(),
});

// =====================
// PaintBrand Schemas
// =====================

const paintBrandFilters = {
  searchingFor: z.string().optional(),
  names: z.array(z.string()).optional(),
  hasPaints: z.boolean().optional(),
  hasComponentItems: z.boolean().optional(),
};

const paintBrandTransform = (data: any) => {
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

  if (data.searchingFor && typeof data.searchingFor === "string" && data.searchingFor.trim()) {
    andConditions.push({
      name: { contains: data.searchingFor.trim(), mode: "insensitive" },
    });
    delete data.searchingFor;
  }

  if (data.names && data.names.length > 0) {
    andConditions.push({ name: { in: data.names } });
    delete data.names;
  }

  if (data.hasPaints !== undefined) {
    andConditions.push({
      paints: data.hasPaints ? { some: {} } : { none: {} },
    });
    delete data.hasPaints;
  }

  if (data.hasComponentItems !== undefined) {
    andConditions.push({
      componentItems: data.hasComponentItems ? { some: {} } : { none: {} },
    });
    delete data.hasComponentItems;
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
      // Preserve existing where conditions and merge with new conditions
      if (data.where.AND) {
        // If AND already exists, append to it
        data.where = { ...data.where, AND: [...(Array.isArray(data.where.AND) ? data.where.AND : [data.where.AND]), ...andConditions] };
      } else {
        // Create AND with existing where conditions and new conditions
        const existingConditions = { ...data.where };
        data.where = { AND: [existingConditions, ...andConditions] };
      }
    } else {
      // No existing where, create new one
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  // Convert limit to take for repository compatibility
  if (data.limit !== undefined) {
    data.take = data.limit;
    delete data.limit;
  }

  // Ensure orderBy is in the correct format (array of objects with single fields)
  if (data.orderBy) {
    if (!Array.isArray(data.orderBy)) {
      // If it's an object, split it into an array of single-field objects
      const orderByArray: any[] = [];
      for (const [field, direction] of Object.entries(data.orderBy)) {
        if (direction) {
          orderByArray.push({ [field]: direction });
        }
      }
      data.orderBy = orderByArray;
    }
  }

  return data;
};

export const paintBrandGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).default(20).optional(),

    // Direct Prisma clauses
    where: paintBrandWhereSchema.optional(),
    orderBy: paintBrandOrderBySchema.optional(),
    include: paintBrandIncludeSchema.optional(),

    // Convenience filters
    ...paintBrandFilters,

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
  .transform(paintBrandTransform);

export const paintBrandGetByIdSchema = z.object({
  include: paintBrandIncludeSchema.optional(),
});

export const paintBrandQuerySchema = z.object({
  include: paintBrandIncludeSchema.optional(),
});

// =====================
// PaintBrand CRUD Schemas
// =====================

export const paintBrandCreateSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(100, "Nome deve ter no máximo 100 caracteres"),
  componentItemIds: z.array(z.string().uuid("Item inválido")).optional(),
});

export const paintBrandUpdateSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(100, "Nome deve ter no máximo 100 caracteres").optional(),
  componentItemIds: z.array(z.string().uuid("Item inválido")).optional(),
});

export const paintBrandBatchCreateSchema = z.object({
  paintBrands: z.array(paintBrandCreateSchema).min(1, "Pelo menos uma marca de tinta deve ser fornecida"),
});

export const paintBrandBatchUpdateSchema = z.object({
  paintBrands: z
    .array(
      z.object({
        id: z.string().uuid("ID inválido"),
        data: paintBrandUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização deve ser fornecida"),
});

export const paintBrandBatchDeleteSchema = z.object({
  paintBrandIds: z.array(z.string().uuid("Marca inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// =====================
// Inferred Types
// =====================

// PaintType types
export type PaintTypeGetManyFormData = z.infer<typeof paintTypeGetManySchema>;
export type PaintTypeGetByIdFormData = z.infer<typeof paintTypeGetByIdSchema>;
export type PaintTypeQueryFormData = z.infer<typeof paintTypeQuerySchema>;

export type PaintTypeCreateFormData = z.infer<typeof paintTypeCreateSchema>;
export type PaintTypeUpdateFormData = z.infer<typeof paintTypeUpdateSchema>;

export type PaintTypeBatchCreateFormData = z.infer<typeof paintTypeBatchCreateSchema>;
export type PaintTypeBatchUpdateFormData = z.infer<typeof paintTypeBatchUpdateSchema>;
export type PaintTypeBatchDeleteFormData = z.infer<typeof paintTypeBatchDeleteSchema>;

export type PaintTypeInclude = z.infer<typeof paintTypeIncludeSchema>;
export type PaintTypeOrderBy = z.infer<typeof paintTypeOrderBySchema>;
export type PaintTypeWhere = z.infer<typeof paintTypeWhereSchema>;

// Paint types
export type PaintGetManyFormData = z.infer<typeof paintGetManySchema>;
export type PaintGetByIdFormData = z.infer<typeof paintGetByIdSchema>;
export type PaintQueryFormData = z.infer<typeof paintQuerySchema>;

export type PaintCreateFormData = z.infer<typeof paintCreateSchema>;
export type PaintUpdateFormData = z.infer<typeof paintUpdateSchema>;

export type PaintBatchCreateFormData = z.infer<typeof paintBatchCreateSchema>;
export type PaintBatchUpdateFormData = z.infer<typeof paintBatchUpdateSchema>;
export type PaintBatchDeleteFormData = z.infer<typeof paintBatchDeleteSchema>;
export type PaintBatchUpdateColorOrderFormData = z.infer<typeof paintBatchUpdateColorOrderSchema>;

export type PaintInclude = z.infer<typeof paintIncludeSchema>;
export type PaintOrderBy = z.infer<typeof paintOrderBySchema>;
export type PaintWhere = z.infer<typeof paintWhereSchema>;

// Paint Formula types
export type PaintFormulaGetManyFormData = z.infer<typeof paintFormulaGetManySchema>;
export type PaintFormulaGetByIdFormData = z.infer<typeof paintFormulaGetByIdSchema>;
export type PaintFormulaQueryFormData = z.infer<typeof paintFormulaQuerySchema>;

export type PaintFormulaCreateFormData = z.infer<typeof paintFormulaCreateSchema>;
export type PaintFormulaUpdateFormData = z.infer<typeof paintFormulaUpdateSchema>;

export type PaintFormulaBatchCreateFormData = z.infer<typeof paintFormulaBatchCreateSchema>;
export type PaintFormulaBatchUpdateFormData = z.infer<typeof paintFormulaBatchUpdateSchema>;
export type PaintFormulaBatchDeleteFormData = z.infer<typeof paintFormulaBatchDeleteSchema>;

export type PaintFormulaInclude = z.infer<typeof paintFormulaIncludeSchema>;
export type PaintFormulaOrderBy = z.infer<typeof paintFormulaOrderBySchema>;
export type PaintFormulaWhere = z.infer<typeof paintFormulaWhereSchema>;

// Paint Formula Component types
export type PaintFormulaComponentGetManyFormData = z.infer<typeof paintFormulaComponentGetManySchema>;
export type PaintFormulaComponentGetByIdFormData = z.infer<typeof paintFormulaComponentGetByIdSchema>;
export type PaintFormulaComponentQueryFormData = z.infer<typeof paintFormulaComponentQuerySchema>;

export type PaintFormulaComponentCreateFormData = z.infer<typeof paintFormulaComponentCreateSchema>;
export type PaintFormulaComponentUpdateFormData = z.infer<typeof paintFormulaComponentUpdateSchema>;

export type PaintFormulaComponentBatchCreateFormData = z.infer<typeof paintFormulaComponentBatchCreateSchema>;
export type PaintFormulaComponentBatchUpdateFormData = z.infer<typeof paintFormulaComponentBatchUpdateSchema>;
export type PaintFormulaComponentBatchDeleteFormData = z.infer<typeof paintFormulaComponentBatchDeleteSchema>;

export type PaintFormulaComponentInclude = z.infer<typeof paintFormulaComponentIncludeSchema>;
export type PaintFormulaComponentOrderBy = z.infer<typeof paintFormulaComponentOrderBySchema>;
export type PaintFormulaComponentWhere = z.infer<typeof paintFormulaComponentWhereSchema>;

// Paint Production types
export type PaintProductionGetManyFormData = z.infer<typeof paintProductionGetManySchema>;
export type PaintProductionGetByIdFormData = z.infer<typeof paintProductionGetByIdSchema>;
export type PaintProductionQueryFormData = z.infer<typeof paintProductionQuerySchema>;
export type PaintProductionBatchQueryFormData = z.infer<typeof paintProductionBatchQuerySchema>;

export type PaintProductionCreateFormData = z.infer<typeof paintProductionCreateSchema>;
export type PaintProductionUpdateFormData = z.infer<typeof paintProductionUpdateSchema>;

export type PaintProductionBatchCreateFormData = z.infer<typeof paintProductionBatchCreateSchema>;
export type PaintProductionBatchUpdateFormData = z.infer<typeof paintProductionBatchUpdateSchema>;
export type PaintProductionBatchDeleteFormData = z.infer<typeof paintProductionBatchDeleteSchema>;

export type PaintProductionInclude = z.infer<typeof paintProductionIncludeSchema>;
export type PaintProductionOrderBy = z.infer<typeof paintProductionOrderBySchema>;
export type PaintProductionWhere = z.infer<typeof paintProductionWhereSchema>;

// Paint Base types
export type PaintGroundGetManyFormData = z.infer<typeof paintGroundGetManySchema>;
export type PaintGroundGetByIdFormData = z.infer<typeof paintGroundGetByIdSchema>;
export type PaintGroundQueryFormData = z.infer<typeof paintGroundQuerySchema>;

export type PaintGroundCreateFormData = z.infer<typeof paintGroundCreateSchema>;
export type PaintGroundUpdateFormData = z.infer<typeof paintGroundUpdateSchema>;

export type PaintGroundBatchCreateFormData = z.infer<typeof paintGroundBatchCreateSchema>;
export type PaintGroundBatchUpdateFormData = z.infer<typeof paintGroundBatchUpdateSchema>;
export type PaintGroundBatchDeleteFormData = z.infer<typeof paintGroundBatchDeleteSchema>;

export type PaintGroundInclude = z.infer<typeof paintGroundIncludeSchema>;
export type PaintGroundOrderBy = z.infer<typeof paintGroundOrderBySchema>;
export type PaintGroundWhere = z.infer<typeof paintGroundWhereSchema>;

// PaintBrand types
export type PaintBrandGetManyFormData = z.infer<typeof paintBrandGetManySchema>;
export type PaintBrandGetByIdFormData = z.infer<typeof paintBrandGetByIdSchema>;
export type PaintBrandQueryFormData = z.infer<typeof paintBrandQuerySchema>;

export type PaintBrandCreateFormData = z.infer<typeof paintBrandCreateSchema>;
export type PaintBrandUpdateFormData = z.infer<typeof paintBrandUpdateSchema>;

export type PaintBrandBatchCreateFormData = z.infer<typeof paintBrandBatchCreateSchema>;
export type PaintBrandBatchUpdateFormData = z.infer<typeof paintBrandBatchUpdateSchema>;
export type PaintBrandBatchDeleteFormData = z.infer<typeof paintBrandBatchDeleteSchema>;

export type PaintBrandInclude = z.infer<typeof paintBrandIncludeSchema>;
export type PaintBrandOrderBy = z.infer<typeof paintBrandOrderBySchema>;
export type PaintBrandWhere = z.infer<typeof paintBrandWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapPaintToFormData = createMapToFormDataHelper<Paint, PaintUpdateFormData>((paint) => ({
  name: paint.name,
  hex: paint.hex,
  finish: paint.finish,
  paintBrandId: paint.paintBrandId,
  manufacturer: paint.manufacturer,
  tags: paint.tags,
  palette: paint.palette,
  paletteOrder: paint.paletteOrder,
  paintTypeId: paint.paintTypeId,
  groundIds: paint.paintGrounds?.map((pg) => pg.groundPaintId) || [],
}));

export const mapPaintFormulaToFormData = createMapToFormDataHelper<PaintFormula, PaintFormulaUpdateFormData>((formula) => ({
  description: formula.description,
  paintId: formula.paintId,
  density: formula.density,
  pricePerLiter: formula.pricePerLiter,
}));

export const mapPaintFormulaComponentToFormData = createMapToFormDataHelper<PaintFormulaComponent, PaintFormulaComponentUpdateFormData>((component) => ({
  ratio: component.ratio,
  itemId: component.itemId,
  formulaPaintId: component.formulaPaintId,
}));

export const mapPaintProductionToFormData = createMapToFormDataHelper<PaintProduction, PaintProductionUpdateFormData>((production) => ({
  volumeLiters: production.volumeLiters,
  formulaId: production.formulaId,
}));

export const mapPaintGroundToFormData = createMapToFormDataHelper<PaintGround, PaintGroundUpdateFormData>((base) => ({
  paintId: base.paintId,
  groundPaintId: base.groundPaintId,
}));

export const mapPaintTypeToFormData = createMapToFormDataHelper<PaintType, PaintTypeUpdateFormData>((paintType) => ({
  name: paintType.name,
  needGround: paintType.needGround,
  componentItemIds: paintType.componentItems?.map((item) => item.id),
}));

export const mapPaintBrandToFormData = createMapToFormDataHelper<PaintBrand, PaintBrandUpdateFormData>((paintBrand) => ({
  name: paintBrand.name,
  componentItemIds: (paintBrand as any).componentItems?.map((item: any) => item.id),
}));

// =====================
// Paint Merge Schema
// =====================

export const paintMergeConflictsSchema = z
  .object({
    keepPrimaryHex: z.boolean().optional(),
    keepPrimaryFinish: z.boolean().optional(),
    combineTags: z.boolean().optional(),
    combineFormulas: z.boolean().optional(),
  })
  .optional();

export const paintMergeSchema = z.object({
  targetPaintId: z.string().uuid({ message: "ID da tinta principal inválido" }),
  sourcePaintIds: z
    .array(z.string().uuid({ message: "ID de tinta inválido" }))
    .min(1, { message: "É necessário selecionar pelo menos 1 tinta para mesclar" })
    .max(10, { message: "Máximo de 10 tintas podem ser mescladas por vez" }),
  conflictResolutions: paintMergeConflictsSchema,
});

export type PaintMergeConflicts = z.infer<typeof paintMergeConflictsSchema>;
export type PaintMergeFormData = z.infer<typeof paintMergeSchema>;
