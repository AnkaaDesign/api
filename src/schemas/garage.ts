// packages/schemas/src/garage.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy } from "./common";
import type { Garage, GarageLane, ParkingSpot } from '@types';

// =====================
// Include Schemas
// =====================

export const garageIncludeSchema = z
  .object({
    lanes: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              parkingSpots: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    trucks: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              task: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .optional();

export const garageLaneIncludeSchema = z
  .object({
    garage: z
      .union([
        z.boolean(),
        z.object({
          include: garageIncludeSchema.optional(),
        }),
      ])
      .optional(),
    parkingSpots: z.boolean().optional(),
  })
  .optional();

export const parkingSpotIncludeSchema = z
  .object({
    garageLane: z
      .union([
        z.boolean(),
        z.object({
          include: garageLaneIncludeSchema.optional(),
        }),
      ])
      .optional(),
  })
  .optional();

// =====================
// Order By Schemas
// =====================

export const garageOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        width: orderByDirectionSchema.optional(),
        length: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          width: orderByDirectionSchema.optional(),
          length: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

export const garageLaneOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        width: orderByDirectionSchema.optional(),
        length: orderByDirectionSchema.optional(),
        xPosition: orderByDirectionSchema.optional(),
        yPosition: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          width: orderByDirectionSchema.optional(),
          length: orderByDirectionSchema.optional(),
          xPosition: orderByDirectionSchema.optional(),
          yPosition: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

export const parkingSpotOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        length: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          length: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// Where Schemas
// =====================

export const garageWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.array(garageWhereSchema).optional(),
      OR: z.array(garageWhereSchema).optional(),
      NOT: garageWhereSchema.optional(),

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
          }),
        ])
        .optional(),

      description: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
          }),
        ])
        .optional(),

      location: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
          }),
        ])
        .optional(),

      // Numeric fields
      width: z
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

      length: z
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
      lanes: z
        .object({
          some: garageLaneWhereSchema.optional(),
          every: garageLaneWhereSchema.optional(),
          none: garageLaneWhereSchema.optional(),
        })
        .optional(),

      trucks: z
        .object({
          some: z.any().optional(), // TruckWhereSchema would be imported
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
    })
    .strict()
    .optional(),
);

export const garageLaneWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.array(garageLaneWhereSchema).optional(),
      OR: z.array(garageLaneWhereSchema).optional(),
      NOT: garageLaneWhereSchema.optional(),

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

      garageId: z
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
          }),
        ])
        .optional(),

      // Numeric fields
      width: z
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

      length: z
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

      xPosition: z
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

      yPosition: z
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

      // Relations
      garage: garageWhereSchema.optional(),
      parkingSpots: z
        .object({
          some: parkingSpotWhereSchema.optional(),
          every: parkingSpotWhereSchema.optional(),
          none: parkingSpotWhereSchema.optional(),
        })
        .optional(),
    })
    .strict()
    .optional(),
);

export const parkingSpotWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.array(parkingSpotWhereSchema).optional(),
      OR: z.array(parkingSpotWhereSchema).optional(),
      NOT: parkingSpotWhereSchema.optional(),

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

      garageLaneId: z
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
          }),
        ])
        .optional(),

      // Numeric fields
      length: z
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

      // Relations
      garageLane: garageLaneWhereSchema.optional(),
    })
    .strict()
    .optional(),
);

// =====================
// Convenience Filters
// =====================

const garageFilters = {
  // Search filter
  searchingFor: z.string().optional(),

  // Boolean filters
  hasLanes: z.boolean().optional(),
  hasTrucks: z.boolean().optional(),

  // Array filters
  garageIds: z.array(z.string()).optional(),
  names: z.array(z.string()).optional(),
  locations: z.array(z.string()).optional(),

  // Range filters
  widthRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),

  lengthRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),

  areaRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),

  capacityRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
};

const garageLaneFilters = {
  // Search filter
  searchingFor: z.string().optional(),

  // Boolean filters
  hasSpots: z.boolean().optional(),

  // Array filters
  laneIds: z.array(z.string()).optional(),
  garageIds: z.array(z.string()).optional(),
  names: z.array(z.string()).optional(),

  // Range filters
  widthRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),

  lengthRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),

  xPositionRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),

  yPositionRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
};

const parkingSpotFilters = {
  // Search filter
  searchingFor: z.string().optional(),

  // Array filters
  spotIds: z.array(z.string()).optional(),
  laneIds: z.array(z.string()).optional(),
  names: z.array(z.string()).optional(),

  // Range filters
  lengthRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
};

// =====================
// Transform Functions
// =====================

const garageTransform = (data: any): any => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  // Transform convenience filters to Prisma where conditions
  const andConditions: any[] = [];

  // Search filter
  if (data.searchingFor) {
    andConditions.push({
      OR: [
        { name: { contains: data.searchingFor, mode: "insensitive" } },
        { description: { contains: data.searchingFor, mode: "insensitive" } },
        { location: { contains: data.searchingFor, mode: "insensitive" } },
      ],
    });
    delete data.searchingFor;
  }

  // Boolean filters
  if (data.hasLanes !== undefined) {
    if (data.hasLanes) {
      andConditions.push({ lanes: { some: {} } });
    } else {
      andConditions.push({ lanes: { none: {} } });
    }
    delete data.hasLanes;
  }

  if (data.hasTrucks !== undefined) {
    if (data.hasTrucks) {
      andConditions.push({ trucks: { some: {} } });
    } else {
      andConditions.push({ trucks: { none: {} } });
    }
    delete data.hasTrucks;
  }

  // Array filters
  if (data.garageIds) {
    andConditions.push({ id: { in: data.garageIds } });
    delete data.garageIds;
  }

  if (data.names) {
    andConditions.push({ name: { in: data.names } });
    delete data.names;
  }

  if (data.locations) {
    andConditions.push({ location: { in: data.locations } });
    delete data.locations;
  }

  // Range filters
  if (data.widthRange) {
    const condition: any = {};
    if (data.widthRange.min !== undefined) condition.gte = data.widthRange.min;
    if (data.widthRange.max !== undefined) condition.lte = data.widthRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ width: condition });
    }
    delete data.widthRange;
  }

  if (data.lengthRange) {
    const condition: any = {};
    if (data.lengthRange.min !== undefined) condition.gte = data.lengthRange.min;
    if (data.lengthRange.max !== undefined) condition.lte = data.lengthRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ length: condition });
    }
    delete data.lengthRange;
  }

  if (data.areaRange) {
    // Area is calculated as width * length, so we need to handle this specially
    // This would typically be handled in the service layer
    delete data.areaRange;
  }

  if (data.capacityRange) {
    // Capacity would be calculated from lanes and spots, handled in service layer
    delete data.capacityRange;
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
      data.where = data.where.AND ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] } : andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

const garageLaneTransform = (data: any): any => {
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
  if (data.searchingFor) {
    andConditions.push({
      OR: [{ name: { contains: data.searchingFor, mode: "insensitive" } }],
    });
    delete data.searchingFor;
  }

  // Boolean filters
  if (data.hasSpots !== undefined) {
    if (data.hasSpots) {
      andConditions.push({ parkingSpots: { some: {} } });
    } else {
      andConditions.push({ parkingSpots: { none: {} } });
    }
    delete data.hasSpots;
  }

  // Array filters
  if (data.laneIds) {
    andConditions.push({ id: { in: data.laneIds } });
    delete data.laneIds;
  }

  if (data.garageIds) {
    andConditions.push({ garageId: { in: data.garageIds } });
    delete data.garageIds;
  }

  if (data.names) {
    andConditions.push({ name: { in: data.names } });
    delete data.names;
  }

  // Range filters
  if (data.widthRange) {
    const condition: any = {};
    if (data.widthRange.min !== undefined) condition.gte = data.widthRange.min;
    if (data.widthRange.max !== undefined) condition.lte = data.widthRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ width: condition });
    }
    delete data.widthRange;
  }

  if (data.lengthRange) {
    const condition: any = {};
    if (data.lengthRange.min !== undefined) condition.gte = data.lengthRange.min;
    if (data.lengthRange.max !== undefined) condition.lte = data.lengthRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ length: condition });
    }
    delete data.lengthRange;
  }

  if (data.xPositionRange) {
    const condition: any = {};
    if (data.xPositionRange.min !== undefined) condition.gte = data.xPositionRange.min;
    if (data.xPositionRange.max !== undefined) condition.lte = data.xPositionRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ xPosition: condition });
    }
    delete data.xPositionRange;
  }

  if (data.yPositionRange) {
    const condition: any = {};
    if (data.yPositionRange.min !== undefined) condition.gte = data.yPositionRange.min;
    if (data.yPositionRange.max !== undefined) condition.lte = data.yPositionRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ yPosition: condition });
    }
    delete data.yPositionRange;
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
      data.where = data.where.AND ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] } : andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

const parkingSpotTransform = (data: any): any => {
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
  if (data.searchingFor) {
    andConditions.push({
      OR: [{ name: { contains: data.searchingFor, mode: "insensitive" } }],
    });
    delete data.searchingFor;
  }

  // Array filters
  if (data.spotIds) {
    andConditions.push({ id: { in: data.spotIds } });
    delete data.spotIds;
  }

  if (data.laneIds) {
    andConditions.push({ garageLaneId: { in: data.laneIds } });
    delete data.laneIds;
  }

  if (data.names) {
    andConditions.push({ name: { in: data.names } });
    delete data.names;
  }

  // Range filters
  if (data.lengthRange) {
    const condition: any = {};
    if (data.lengthRange.min !== undefined) condition.gte = data.lengthRange.min;
    if (data.lengthRange.max !== undefined) condition.lte = data.lengthRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ length: condition });
    }
    delete data.lengthRange;
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
      data.where = data.where.AND ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] } : andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

// =====================
// Query Schemas
// =====================

export const garageGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: garageWhereSchema.optional(),
    orderBy: garageOrderBySchema.optional(),
    include: garageIncludeSchema.optional(),

    // Convenience filters
    ...garageFilters,

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
  .transform(garageTransform);

export const garageLaneGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: garageLaneWhereSchema.optional(),
    orderBy: garageLaneOrderBySchema.optional(),
    include: garageLaneIncludeSchema.optional(),

    // Convenience filters
    ...garageLaneFilters,

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
  .transform(garageLaneTransform);

export const parkingSpotGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: parkingSpotWhereSchema.optional(),
    orderBy: parkingSpotOrderBySchema.optional(),
    include: parkingSpotIncludeSchema.optional(),

    // Convenience filters
    ...parkingSpotFilters,

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
  .transform(parkingSpotTransform);

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

// Garage CRUD
export const garageCreateSchema = z
  .object({
    name: z.string().min(1, "Nome é obrigatório").max(255),
    width: z.number().positive("Largura deve ser positiva"),
    length: z.number().positive("Comprimento deve ser positivo"),
    description: z.string().optional(),
    location: z.string().optional(),
    metadata: z.any().optional(),
  })
  .transform(toFormData);

export const garageUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    width: z.number().positive().optional(),
    length: z.number().positive().optional(),
    description: z.string().optional(),
    location: z.string().optional(),
    metadata: z.any().optional(),
  })
  .transform(toFormData);

// GarageLane CRUD
export const garageLaneCreateSchema = z
  .object({
    garageId: z.string().uuid("Garagem inválida"),
    name: z.string().optional(),
    width: z.number().positive("Largura deve ser positiva"),
    length: z.number().positive("Comprimento deve ser positivo"),
    xPosition: z.number().min(0, "Posição X deve ser não-negativa"),
    yPosition: z.number().min(0, "Posição Y deve ser não-negativa"),
    metadata: z.any().optional(),
  })
  .transform(toFormData);

export const garageLaneUpdateSchema = z
  .object({
    garageId: z.string().uuid("Garagem inválida"),
    name: z.string().optional(),
    width: z.number().positive().optional(),
    length: z.number().positive().optional(),
    xPosition: z.number().min(0).optional(),
    yPosition: z.number().min(0).optional(),
    metadata: z.any().optional(),
  })
  .transform(toFormData);

// ParkingSpot CRUD
export const parkingSpotCreateSchema = z
  .object({
    garageLaneId: z.string().uuid("Faixa da garagem inválida"),
    name: z.string().min(1, "Nome é obrigatório"),
    length: z.number().positive("Comprimento deve ser positivo"),
  })
  .transform(toFormData);

export const parkingSpotUpdateSchema = z
  .object({
    garageLaneId: z.string().uuid("Faixa da garagem inválida"),
    name: z.string().min(1).optional(),
    length: z.number().positive().optional(),
  })
  .transform(toFormData);

// =====================
// GetById Schemas
// =====================

export const garageGetByIdSchema = z.object({
  include: garageIncludeSchema.optional(),
  id: z.string().uuid("Garagem inválida"),
});

export const garageLaneGetByIdSchema = z.object({
  include: garageLaneIncludeSchema.optional(),
  id: z.string().uuid("Faixa inválida"),
});

export const parkingSpotGetByIdSchema = z.object({
  include: parkingSpotIncludeSchema.optional(),
  id: z.string().uuid("Vaga inválida"),
});

// =====================
// Batch Operations Schemas
// =====================

// Garage batch operations
export const garageBatchCreateSchema = z.object({
  garages: z.array(garageCreateSchema),
});

export const garageBatchUpdateSchema = z.object({
  garages: z
    .array(
      z.object({
        id: z.string().uuid("Garagem inválida"),
        data: garageUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const garageBatchDeleteSchema = z.object({
  garageIds: z.array(z.string().uuid("Garagem inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const garageQuerySchema = z.object({
  include: garageIncludeSchema.optional(),
});

// GarageLane batch operations
export const garageLaneBatchCreateSchema = z.object({
  garageLanes: z.array(garageLaneCreateSchema),
});

export const garageLaneBatchUpdateSchema = z.object({
  garageLanes: z
    .array(
      z.object({
        id: z.string().uuid("Faixa de garagem inválida"),
        data: garageLaneUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma linha de garagem deve ser fornecida"),
});

export const garageLaneBatchDeleteSchema = z.object({
  garageLaneIds: z.array(z.string().uuid("Faixa inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const garageLaneQuerySchema = z.object({
  include: garageLaneIncludeSchema.optional(),
});

// ParkingSpot batch operations
export const parkingSpotBatchCreateSchema = z.object({
  parkingSpots: z.array(parkingSpotCreateSchema),
});

export const parkingSpotBatchUpdateSchema = z.object({
  parkingSpots: z
    .array(
      z.object({
        id: z.string().uuid("Vaga de estacionamento inválida"),
        data: parkingSpotUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma vaga de estacionamento deve ser fornecida"),
});

export const parkingSpotBatchDeleteSchema = z.object({
  parkingSpotIds: z.array(z.string().uuid("Vaga inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for single operations (create/update)
export const parkingSpotQuerySchema = z.object({
  include: parkingSpotIncludeSchema.optional(),
});

// =====================
// Type Inference (FormData types)
// =====================

// Query types

export type GarageGetManyFormData = z.infer<typeof garageGetManySchema>;
export type GarageGetByIdFormData = z.infer<typeof garageGetByIdSchema>;
export type GarageQueryFormData = z.infer<typeof garageQuerySchema>;

export type GarageCreateFormData = z.infer<typeof garageCreateSchema>;
export type GarageUpdateFormData = z.infer<typeof garageUpdateSchema>;

export type GarageBatchCreateFormData = z.infer<typeof garageBatchCreateSchema>;
export type GarageBatchUpdateFormData = z.infer<typeof garageBatchUpdateSchema>;
export type GarageBatchDeleteFormData = z.infer<typeof garageBatchDeleteSchema>;

export type GarageInclude = z.infer<typeof garageIncludeSchema>;
export type GarageOrderBy = z.infer<typeof garageOrderBySchema>;
export type GarageWhere = z.infer<typeof garageWhereSchema>;

// GarageLane types
export type GarageLaneGetManyFormData = z.infer<typeof garageLaneGetManySchema>;
export type GarageLaneGetByIdFormData = z.infer<typeof garageLaneGetByIdSchema>;
export type GarageLaneQueryFormData = z.infer<typeof garageLaneQuerySchema>;

export type GarageLaneCreateFormData = z.infer<typeof garageLaneCreateSchema>;
export type GarageLaneUpdateFormData = z.infer<typeof garageLaneUpdateSchema>;

export type GarageLaneBatchCreateFormData = z.infer<typeof garageLaneBatchCreateSchema>;
export type GarageLaneBatchUpdateFormData = z.infer<typeof garageLaneBatchUpdateSchema>;
export type GarageLaneBatchDeleteFormData = z.infer<typeof garageLaneBatchDeleteSchema>;

export type GarageLaneInclude = z.infer<typeof garageLaneIncludeSchema>;
export type GarageLaneOrderBy = z.infer<typeof garageLaneOrderBySchema>;
export type GarageLaneWhere = z.infer<typeof garageLaneWhereSchema>;

// ParkingSpot types
export type ParkingSpotGetManyFormData = z.infer<typeof parkingSpotGetManySchema>;
export type ParkingSpotGetByIdFormData = z.infer<typeof parkingSpotGetByIdSchema>;
export type ParkingSpotQueryFormData = z.infer<typeof parkingSpotQuerySchema>;

export type ParkingSpotCreateFormData = z.infer<typeof parkingSpotCreateSchema>;
export type ParkingSpotUpdateFormData = z.infer<typeof parkingSpotUpdateSchema>;

export type ParkingSpotBatchCreateFormData = z.infer<typeof parkingSpotBatchCreateSchema>;
export type ParkingSpotBatchUpdateFormData = z.infer<typeof parkingSpotBatchUpdateSchema>;
export type ParkingSpotBatchDeleteFormData = z.infer<typeof parkingSpotBatchDeleteSchema>;

export type ParkingSpotInclude = z.infer<typeof parkingSpotIncludeSchema>;
export type ParkingSpotOrderBy = z.infer<typeof parkingSpotOrderBySchema>;
export type ParkingSpotWhere = z.infer<typeof parkingSpotWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapGarageToFormData = createMapToFormDataHelper<Garage, GarageUpdateFormData>((garage) => ({
  name: garage.name,
  width: garage.width,
  length: garage.length,
}));

export const mapGarageLaneToFormData = createMapToFormDataHelper<GarageLane, GarageLaneUpdateFormData>((lane) => ({
  width: lane.width,
  length: lane.length,
  xPosition: lane.xPosition,
  yPosition: lane.yPosition,
  garageId: lane.garageId,
}));

export const mapParkingSpotToFormData = createMapToFormDataHelper<ParkingSpot, ParkingSpotUpdateFormData>((spot) => ({
  name: spot.name,
  length: spot.length,
  garageLaneId: spot.garageLaneId,
}));
