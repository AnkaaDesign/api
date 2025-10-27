// packages/schemas/src/user.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, orderByWithNullsSchema, normalizeOrderBy, emailSchema, phoneSchema, cpfSchema, pisSchema, createNameSchema, nullableDate } from "./common";
import type { User } from '@types';
import { USER_STATUS, VERIFICATION_TYPE } from '@constants';

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const userIncludeSchema = z
  .object({
    // Direct User relations
    avatar: z.boolean().optional(),
    ppeSize: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              user: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    preference: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              notifications: z.boolean().optional(),
              user: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    position: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              users: z.boolean().optional(),
              remunerations: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    sector: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              users: z.boolean().optional(),
              tasks: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    managedSector: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              users: z.boolean().optional(),
              tasks: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    activities: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              item: z.boolean().optional(),
              user: z.boolean().optional(),
              order: z.boolean().optional(),
              orderItem: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    borrows: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              item: z.boolean().optional(),
              user: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    notifications: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              user: z.boolean().optional(),
              seenBy: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    tasks: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              sector: z.boolean().optional(),
              customer: z.boolean().optional(),
              budget: z.boolean().optional(),
              nfe: z.boolean().optional(),
              receipt: z.boolean().optional(),
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
        }),
      ])
      .optional(),
    vacations: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              user: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    commissions: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              user: z.boolean().optional(),
              task: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    warningsCollaborator: z.boolean().optional(),
    warningsSupervisor: z.boolean().optional(),
    warningsWitness: z.boolean().optional(),
    ppeDeliveries: z.boolean().optional(),
    ppeDeliveriesApproved: z.boolean().optional(),
    ppeSchedules: z.boolean().optional(),
    changeLogs: z.boolean().optional(),
    seenNotification: z.boolean().optional(),
    _count: z.union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })]).optional(),
  })
  .partial();

// =====================
// OrderBy Schema Based on Prisma Schema Fields
// =====================

export const userOrderBySchema = z.union([
  // Single ordering object
  z
    .object({
      // User direct fields
      id: orderByDirectionSchema.optional(),
      email: orderByDirectionSchema.optional(),
      name: orderByDirectionSchema.optional(),
      avatarId: orderByDirectionSchema.optional(),
      status: orderByDirectionSchema.optional(),
      statusOrder: orderByDirectionSchema.optional(),
      phone: orderByDirectionSchema.optional(),
      positionId: orderByDirectionSchema.optional(),
      pis: orderByDirectionSchema.optional(),
      cpf: orderByDirectionSchema.optional(),
      verified: orderByDirectionSchema.optional(),
      payrollNumber: orderByDirectionSchema.optional(),
      birth: orderByDirectionSchema.optional(),
      contractedAt: orderByDirectionSchema.optional(),
      exp1StartAt: orderByDirectionSchema.optional(),
      exp1EndAt: orderByDirectionSchema.optional(),
      exp2StartAt: orderByDirectionSchema.optional(),
      exp2EndAt: orderByDirectionSchema.optional(),
      dismissedAt: orderByDirectionSchema.optional(),
      performanceLevel: orderByDirectionSchema.optional(),
      sectorId: orderByDirectionSchema.optional(),
      managedSectorId: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),

      // Nested relation ordering
      position: z
        .object({
          id: orderByWithNullsSchema.optional(),
          name: orderByWithNullsSchema.optional(),
          hierarchy: orderByWithNullsSchema.optional(),
          createdAt: orderByWithNullsSchema.optional(),
          updatedAt: orderByWithNullsSchema.optional(),
        })
        .optional(),

      sector: z
        .object({
          id: orderByWithNullsSchema.optional(),
          name: orderByWithNullsSchema.optional(),
          createdAt: orderByWithNullsSchema.optional(),
          updatedAt: orderByWithNullsSchema.optional(),
        })
        .optional(),

      managedSector: z
        .object({
          id: orderByWithNullsSchema.optional(),
          name: orderByWithNullsSchema.optional(),
          createdAt: orderByWithNullsSchema.optional(),
          updatedAt: orderByWithNullsSchema.optional(),
        })
        .optional(),
    })
    .partial(),

  // Array of ordering objects for multiple field ordering
  z.array(
    z
      .object({
        id: orderByDirectionSchema.optional(),
        email: orderByDirectionSchema.optional(),
        name: orderByDirectionSchema.optional(),
        avatarId: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        phone: orderByDirectionSchema.optional(),
        positionId: orderByDirectionSchema.optional(),
        pis: orderByDirectionSchema.optional(),
        cpf: orderByDirectionSchema.optional(),
        verified: orderByDirectionSchema.optional(),
        payrollNumber: orderByDirectionSchema.optional(),
        birth: orderByDirectionSchema.optional(),
        contractedAt: orderByDirectionSchema.optional(),
        exp1StartAt: orderByDirectionSchema.optional(),
        exp1EndAt: orderByDirectionSchema.optional(),
        exp2StartAt: orderByDirectionSchema.optional(),
        exp2EndAt: orderByDirectionSchema.optional(),
        dismissedAt: orderByDirectionSchema.optional(),
        performanceLevel: orderByDirectionSchema.optional(),
        sectorId: orderByDirectionSchema.optional(),
        managedSectorId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),

        // Nested relation ordering
        position: z
          .object({
            id: orderByWithNullsSchema.optional(),
            name: orderByWithNullsSchema.optional(),
            hierarchy: orderByWithNullsSchema.optional(),
            createdAt: orderByWithNullsSchema.optional(),
            updatedAt: orderByWithNullsSchema.optional(),
          })
          .optional(),

        sector: z
          .object({
            id: orderByWithNullsSchema.optional(),
            name: orderByWithNullsSchema.optional(),
            createdAt: orderByWithNullsSchema.optional(),
            updatedAt: orderByWithNullsSchema.optional(),
          })
          .optional(),

        managedSector: z
          .object({
            id: orderByWithNullsSchema.optional(),
            name: orderByWithNullsSchema.optional(),
            createdAt: orderByWithNullsSchema.optional(),
            updatedAt: orderByWithNullsSchema.optional(),
          })
          .optional(),
      })
      .partial(),
  ),
]);

// =====================
// Where Schema Based on Prisma Schema Fields
// =====================

export const userWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([userWhereSchema, z.array(userWhereSchema)]).optional(),
      OR: z.array(userWhereSchema).optional(),
      NOT: z.union([userWhereSchema, z.array(userWhereSchema)]).optional(),

      // User fields
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

      email: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            endsWith: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
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
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      avatarId: z
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

      status: z
        .union([
          z.nativeEnum(USER_STATUS),
          z.object({
            equals: z.nativeEnum(USER_STATUS).optional(),
            not: z.nativeEnum(USER_STATUS).optional(),
            in: z.array(z.nativeEnum(USER_STATUS)).optional(),
            notIn: z.array(z.nativeEnum(USER_STATUS)).optional(),
          }),
        ])
        .optional(),

      statusOrder: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            in: z.array(z.number()).optional(),
            notIn: z.array(z.number()).optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),

      phone: z
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

      cpf: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            contains: z.string().optional(),
          }),
        ])
        .optional(),

      pis: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            contains: z.string().optional(),
          }),
        ])
        .optional(),

      payrollNumber: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            in: z.array(z.number()).optional(),
            notIn: z.array(z.number()).optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),

      verified: z
        .union([
          z.boolean(),
          z.object({
            equals: z.boolean().optional(),
            not: z.boolean().optional(),
          }),
        ])
        .optional(),

      birth: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      contractedAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      exp1StartAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      exp1EndAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      exp2StartAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      exp2EndAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      dismissedAt: z
        .union([
          z.date(),
          z.null(),
          z.object({
            equals: z.union([z.date(), z.null()]).optional(),
            not: z.union([z.date(), z.null()]).optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      performanceLevel: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            gte: z.number().optional(),
            gt: z.number().optional(),
            lte: z.number().optional(),
            lt: z.number().optional(),
          }),
        ])
        .optional(),

      positionId: z
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

      sectorId: z
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

      managedSectorId: z
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

      createdAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      updatedAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Relation filters
      position: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
        })
        .optional(),

      sector: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
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

      tasks: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      vacations: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),

      commissions: z
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

const userFilters = {
  searchingFor: z.string().optional(),
  payrollNumber: z.coerce.number().int().optional(),
  sectorIds: z.array(z.string()).optional(),
  managedSectorIds: z.array(z.string()).optional(),
  positionIds: z.array(z.string()).optional(),
  statuses: z.array(z.nativeEnum(USER_STATUS)).optional(),
  isActive: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  hasPosition: z.boolean().optional(),
  hasSector: z.boolean().optional(),
  hasManagedSector: z.boolean().optional(),
  hasPpeSize: z.boolean().optional(),
  hasActivities: z.boolean().optional(),
  hasTasks: z.boolean().optional(),
  hasVacations: z.boolean().optional(),
  showDismissed: z.boolean().optional(),
  performanceLevelRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
};

// =====================
// Transform Function
// =====================

const userTransform = (data: any) => {
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

  // Handle searchingFor
  if (data.searchingFor && typeof data.searchingFor === "string" && data.searchingFor.trim()) {
    const searchTerm = data.searchingFor.trim();
    const searchNumber = parseInt(searchTerm, 10);
    console.log("[UserTransform] Processing searchingFor:", searchTerm);
    console.log("[UserTransform] Parsed number:", searchNumber, "isNaN:", isNaN(searchNumber), "toString match:", searchNumber.toString() === searchTerm);

    // If the search term is purely numeric, search ONLY in payrollNumber for exact match
    if (!isNaN(searchNumber) && searchNumber.toString() === searchTerm) {
      console.log("[UserTransform] Searching ONLY by payrollNumber:", searchNumber);
      andConditions.push({ payrollNumber: searchNumber });
    } else {
      console.log("[UserTransform] Searching text fields");

      // Otherwise, search across text fields
      const orConditions: any[] = [
        { name: { contains: searchTerm, mode: "insensitive" } },
        { email: { contains: searchTerm, mode: "insensitive" } },
        { phone: { contains: searchTerm } },
        { cpf: { contains: searchTerm } },
        { pis: { contains: searchTerm } },
        { position: { is: { name: { contains: searchTerm, mode: "insensitive" } } } },
        { sector: { is: { name: { contains: searchTerm, mode: "insensitive" } } } },
        { managedSector: { is: { name: { contains: searchTerm, mode: "insensitive" } } } },
      ];

      andConditions.push({ OR: orConditions });
    }

    delete data.searchingFor;
  }

  // Handle sectorIds filter
  if (data.sectorIds && Array.isArray(data.sectorIds) && data.sectorIds.length > 0) {
    andConditions.push({ sectorId: { in: data.sectorIds } });
    delete data.sectorIds;
  }

  // Handle managedSectorIds filter
  if (data.managedSectorIds && Array.isArray(data.managedSectorIds) && data.managedSectorIds.length > 0) {
    andConditions.push({ managedSectorId: { in: data.managedSectorIds } });
    delete data.managedSectorIds;
  }

  // Handle positionIds filter
  if (data.positionIds && Array.isArray(data.positionIds) && data.positionIds.length > 0) {
    andConditions.push({ positionId: { in: data.positionIds } });
    delete data.positionIds;
  }

  // Handle statuses filter
  if (data.statuses && Array.isArray(data.statuses) && data.statuses.length > 0) {
    andConditions.push({ status: { in: data.statuses } });
    delete data.statuses;
  }

  // Handle isActive filter
  // isActive now means "not dismissed" since we no longer have ACTIVE/INACTIVE statuses
  if (typeof data.isActive === "boolean") {
    andConditions.push({
      status: data.isActive
        ? { not: USER_STATUS.DISMISSED }  // Active = not dismissed (any employment status)
        : USER_STATUS.DISMISSED            // Inactive = dismissed
    });
    delete data.isActive;
  }

  // Handle isVerified filter
  if (typeof data.isVerified === "boolean") {
    andConditions.push({ verified: data.isVerified });
    delete data.isVerified;
  }

  // Handle hasPosition filter
  if (typeof data.hasPosition === "boolean") {
    if (data.hasPosition) {
      andConditions.push({ positionId: { not: null } });
    } else {
      andConditions.push({ positionId: null });
    }
    delete data.hasPosition;
  }

  // Handle hasSector filter
  if (typeof data.hasSector === "boolean") {
    if (data.hasSector) {
      andConditions.push({ sectorId: { not: null } });
    } else {
      andConditions.push({ sectorId: null });
    }
    delete data.hasSector;
  }

  // Handle hasManagedSector filter
  if (typeof data.hasManagedSector === "boolean") {
    if (data.hasManagedSector) {
      andConditions.push({ managedSectorId: { not: null } });
    } else {
      andConditions.push({ managedSectorId: null });
    }
    delete data.hasManagedSector;
  }

  // Handle hasPpeSize filter
  if (typeof data.hasPpeSize === "boolean") {
    if (data.hasPpeSize) {
      andConditions.push({ ppeSize: { is: { id: { not: undefined } } } });
    } else {
      andConditions.push({ ppeSize: { is: null } });
    }
    delete data.hasPpeSize;
  }

  // Handle hasActivities filter
  if (typeof data.hasActivities === "boolean") {
    if (data.hasActivities) {
      andConditions.push({ activities: { some: {} } });
    } else {
      andConditions.push({ activities: { none: {} } });
    }
    delete data.hasActivities;
  }

  // Handle hasTasks filter
  if (typeof data.hasTasks === "boolean") {
    if (data.hasTasks) {
      andConditions.push({ createdTasks: { some: {} } });
    } else {
      andConditions.push({ createdTasks: { none: {} } });
    }
    delete data.hasTasks;
  }

  // Handle hasVacations filter
  if (typeof data.hasVacations === "boolean") {
    if (data.hasVacations) {
      andConditions.push({ vacations: { some: {} } });
    } else {
      andConditions.push({ vacations: { none: {} } });
    }
    delete data.hasVacations;
  }

  // Handle performanceLevelRange filter
  if (data.performanceLevelRange && typeof data.performanceLevelRange === "object") {
    const levelCondition: any = {};
    if (typeof data.performanceLevelRange.min === "number") levelCondition.gte = data.performanceLevelRange.min;
    if (typeof data.performanceLevelRange.max === "number") levelCondition.lte = data.performanceLevelRange.max;
    if (Object.keys(levelCondition).length > 0) {
      andConditions.push({ performanceLevel: levelCondition });
    }
    delete data.performanceLevelRange;
  }

  // Handle date filters
  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  // Merge with existing where conditions
  console.log("[UserTransform] andConditions count:", andConditions.length);
  console.log("[UserTransform] Existing data.where:", JSON.stringify(data.where || {}).substring(0, 200));
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

  console.log("[UserTransform] Final data.where:", JSON.stringify(data.where || {}).substring(0, 300));
  return data;
};

// =====================
// Query Schema
// =====================

export const userGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(), // alias for limit
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: userWhereSchema.optional(),
    orderBy: userOrderBySchema.optional(),
    include: userIncludeSchema.optional(),

    // Convenience filters
    ...userFilters,

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
  .transform(userTransform);

// =====================
// Additional Schemas
// =====================

// =====================
// CRUD Schemas
// =====================

// PPE Size nested creation schema
const ppeSizeCreateNestedSchema = z.object({
  shirts: z.string().nullish(),
  boots: z.string().nullish(),
  pants: z.string().nullish(),
  sleeves: z.string().nullish(),
  mask: z.string().nullish(),
  gloves: z.string().nullish(),
  rainBoots: z.string().nullish(),
});

// Notification preferences nested creation schema
const notificationPreferenceCreateNestedSchema = z.object({
  notificationType: z.string(),
  enabled: z.boolean().default(true),
  channels: z.array(z.string()).default(["EMAIL"]),
  importance: z.string().default("MEDIUM"),
});

export const userCreateSchema = z
  .object({
    email: emailSchema.nullable().optional(),
    name: createNameSchema(2, 200, "Nome"),
    avatarId: z.string().uuid("ID de avatar inválido").nullable().optional(),
    status: z
      .enum(Object.values(USER_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: "status inválido" }),
      })
      .default(USER_STATUS.EXPERIENCE_PERIOD_1),
    phone: phoneSchema.nullable().optional(),
    positionId: z.string().uuid("Cargo inválido").nullable().optional(),
    pis: pisSchema.nullable().optional(),
    cpf: cpfSchema.nullable().optional(),
    verified: z.boolean().default(false),
    performanceLevel: z.number().int().min(0).max(5).default(0),
    sectorId: z.string().uuid("Setor inválido").nullable().optional(),
    managedSectorId: z.string().uuid("Setor gerenciado inválido").nullable().optional(),
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres").nullable().optional(),

    // Address fields
    address: z.string().nullable().optional(),
    addressNumber: z.string().nullable().optional(),
    addressComplement: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional().refine((val) => !val || val.length === 2, {
      message: "Estado deve ter 2 caracteres"
    }),
    zipCode: z.string().nullable().optional(),
    site: z.string().nullable().optional().refine((val) => !val || z.string().url().safeParse(val).success, {
      message: "URL inválida"
    }),

    // Additional dates - birth is required
    birth: z.coerce
      .date()
      .refine(
        (date) => {
          const eighteenYearsAgo = new Date();
          eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
          return date <= eighteenYearsAgo;
        },
        { message: "O colaborador deve ter pelo menos 18 anos" }
      ),

    // Status timestamp tracking
    contractedAt: nullableDate.optional(),
    exp1StartAt: nullableDate.optional(),
    exp1EndAt: nullableDate.optional(),
    exp2StartAt: nullableDate.optional(),
    exp2EndAt: nullableDate.optional(),
    dismissedAt: nullableDate.optional(),

    // Payroll info
    payrollNumber: z.number().int().positive("Número da folha deve ser positivo").nullable().optional(),

    // Nested PPE size creation for new users
    ppeSize: ppeSizeCreateNestedSchema.optional(),
    // Nested notification preferences creation
    notificationPreferences: z.array(notificationPreferenceCreateNestedSchema).optional(),
    // Required for changelog tracking
    userId: z.string().optional(),
  })
  .refine((data) => data.email || data.phone, {
    message: "Email ou telefone deve ser fornecido",
    path: ["email"], // Show error on email field
  });

export const userUpdateSchema = z
  .object({
    email: emailSchema.nullable().optional(),
    name: createNameSchema(2, 200, "Nome").optional(),
    avatarId: z.string().uuid("ID de avatar inválido").nullable().optional(),
    status: z
      .enum(Object.values(USER_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: "status inválido" }),
      })
      .optional(),
    phone: phoneSchema.nullable().optional(),
    positionId: z.string().uuid("Cargo inválido").nullable().optional(),
    pis: pisSchema.nullable().optional(),
    cpf: cpfSchema.nullable().optional(),
    verified: z.boolean().optional(),
    performanceLevel: z.number().int().min(0).max(5).optional(),
    sectorId: z.string().uuid("Setor inválido").nullable().optional(),
    managedSectorId: z.string().uuid("Setor gerenciado inválido").nullable().optional(),
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres").nullable().optional(),

    // Address fields
    address: z.string().nullable().optional(),
    addressNumber: z.string().nullable().optional(),
    addressComplement: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional().refine((val) => !val || val.length === 2, {
      message: "Estado deve ter 2 caracteres"
    }),
    zipCode: z.string().nullable().optional(),
    site: z.string().nullable().optional().refine((val) => !val || z.string().url().safeParse(val).success, {
      message: "URL inválida"
    }),

    // Additional dates
    birth: z.coerce
      .date()
      .refine(
        (date) => {
          const eighteenYearsAgo = new Date();
          eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
          return date <= eighteenYearsAgo;
        },
        { message: "O colaborador deve ter pelo menos 18 anos" }
      )
      .optional(),

    // Status timestamp tracking
    contractedAt: nullableDate.optional(),
    exp1StartAt: nullableDate.optional(),
    exp1EndAt: nullableDate.optional(),
    exp2StartAt: nullableDate.optional(),
    exp2EndAt: nullableDate.optional(),
    dismissedAt: nullableDate.optional(),

    // Payroll info
    payrollNumber: z.number().int().positive("Número da folha deve ser positivo").nullable().optional(),
    secullumId: z.string().nullable().optional(),

    verificationCode: z.string().nullable().optional(),
    verificationExpiresAt: z.date().nullable().optional(),
    verificationType: z
      .enum(Object.values(VERIFICATION_TYPE) as [string, ...string[]])
      .nullable()
      .optional(),
    requirePasswordChange: z.boolean().optional(),
    lastLoginAt: z.date().optional(),
    sessionToken: z.string().nullable().optional(),
    statusOrder: z.number().optional(),
    // Required for changelog tracking
    userId: z.string().optional(),
    preferences: z.record(z.any()).optional(),
    // PPE Size update
    ppeSize: ppeSizeCreateNestedSchema.optional(),
    // Store current status for validation (used by backend)
    currentStatus: z.nativeEnum(USER_STATUS).optional(),
  })
  .refine(
    (data) => {
      // If dismissedAt date is provided, status must be DISMISSED
      if (data.dismissedAt && data.status && data.status !== USER_STATUS.DISMISSED) {
        return false;
      }
      return true;
    },
    {
      message: "Quando a data de demissão é fornecida, o status deve ser DISMISSED",
      path: ["status"],
    }
  )
  .refine(
    (data) => {
      // If status is DISMISSED, dismissedAt date is required
      if (data.status === USER_STATUS.DISMISSED && !data.dismissedAt) {
        return false;
      }
      return true;
    },
    {
      message: "Data de demissão é obrigatória quando o status é DISMISSED",
      path: ["dismissedAt"],
    }
  )
  .refine(
    (data) => {
      // Prevent CONTRACTED users from being set to experience periods
      if (
        data.currentStatus === USER_STATUS.CONTRACTED &&
        data.status &&
        (data.status === USER_STATUS.EXPERIENCE_PERIOD_1 || data.status === USER_STATUS.EXPERIENCE_PERIOD_2)
      ) {
        return false;
      }
      return true;
    },
    {
      message: "Colaboradores CONTRATADOS não podem ser alterados para períodos de experiência",
      path: ["status"],
    }
  )
  .refine(
    (data) => {
      // DISMISSED status cannot be changed to any other status
      if (data.currentStatus === USER_STATUS.DISMISSED && data.status && data.status !== USER_STATUS.DISMISSED) {
        return false;
      }
      return true;
    },
    {
      message: "Colaboradores DEMITIDOS não podem ter o status alterado",
      path: ["status"],
    }
  )
  .refine(
    (data) => {
      // Validate status transition using helper function
      if (data.currentStatus && data.status && data.currentStatus !== data.status) {
        return isValidStatusTransition(data.currentStatus, data.status);
      }
      return true;
    },
    {
      message: "Transição de status inválida",
      path: ["status"],
    }
  );

// =====================
// Batch Operations Schemas
// =====================

export const userBatchCreateSchema = z.object({
  users: z.array(userCreateSchema),
});

export const userBatchUpdateSchema = z.object({
  users: z
    .array(
      z.object({
        id: z.string().uuid("Usuário inválido"),
        data: userUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atualização é necessária"),
});

export const userBatchDeleteSchema = z.object({
  userIds: z.array(z.string().uuid("Usuário inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
});

export const userMergeSchema = z.object({
  targetUserId: z.string().uuid({ message: "ID do usuário principal inválido" }),
  sourceUserIds: z
    .array(z.string().uuid({ message: "ID de usuário inválido" }))
    .min(1, { message: "É necessário selecionar pelo menos 1 usuário para mesclar" })
    .max(10, { message: "Máximo de 10 usuários podem ser mesclados por vez" }),
  conflictResolutions: z.record(z.any()).optional(),
});

// Query schema for include parameter
export const userQuerySchema = z.object({
  include: userIncludeSchema.optional(),
});

// =====================
// Additional Query Schemas
// =====================

export const userGetByIdSchema = z.object({
  include: userIncludeSchema.optional(),
});

// =====================
// Type Inference (FormData types)
// =====================

export type UserGetManyFormData = z.infer<typeof userGetManySchema>;
export type UserGetByIdFormData = z.infer<typeof userGetByIdSchema>;
export type UserQueryFormData = z.infer<typeof userQuerySchema>;

export type UserCreateFormData = z.infer<typeof userCreateSchema>;
export type UserUpdateFormData = z.infer<typeof userUpdateSchema>;

export type UserBatchCreateFormData = z.infer<typeof userBatchCreateSchema>;
export type UserBatchUpdateFormData = z.infer<typeof userBatchUpdateSchema>;
export type UserBatchDeleteFormData = z.infer<typeof userBatchDeleteSchema>;
export type UserMergeFormData = z.infer<typeof userMergeSchema>;

export type UserInclude = z.infer<typeof userIncludeSchema>;
export type UserOrderBy = z.infer<typeof userOrderBySchema>;
export type UserWhere = z.infer<typeof userWhereSchema>;

// =====================
// Helper Functions
// =====================

/**
 * Status transition validation rules
 * Defines which status transitions are allowed
 */
export const USER_STATUS_TRANSITIONS: Record<USER_STATUS, USER_STATUS[]> = {
  [USER_STATUS.EXPERIENCE_PERIOD_1]: [USER_STATUS.EXPERIENCE_PERIOD_2, USER_STATUS.DISMISSED],
  [USER_STATUS.EXPERIENCE_PERIOD_2]: [USER_STATUS.CONTRACTED, USER_STATUS.DISMISSED],
  [USER_STATUS.CONTRACTED]: [USER_STATUS.DISMISSED],
  [USER_STATUS.DISMISSED]: [], // No transitions allowed from DISMISSED
};

/**
 * Validates if a status transition is allowed
 * @param currentStatus - The current status
 * @param newStatus - The desired new status
 * @returns true if the transition is allowed, false otherwise
 */
export function isValidStatusTransition(currentStatus: USER_STATUS | string, newStatus: USER_STATUS | string): boolean {
  // Same status is always allowed
  if (currentStatus === newStatus) {
    return true;
  }

  const allowedTransitions = USER_STATUS_TRANSITIONS[currentStatus as USER_STATUS];
  if (!allowedTransitions) {
    return false;
  }
  return allowedTransitions.includes(newStatus as USER_STATUS);
}

/**
 * Gets a human-readable error message for an invalid status transition
 * @param currentStatus - The current status
 * @param newStatus - The attempted new status
 * @returns Error message in Portuguese
 */
export function getStatusTransitionError(currentStatus: USER_STATUS | string, newStatus: USER_STATUS | string): string {
  const statusLabels: Record<string, string> = {
    [USER_STATUS.EXPERIENCE_PERIOD_1]: "Experiência 1",
    [USER_STATUS.EXPERIENCE_PERIOD_2]: "Experiência 2",
    [USER_STATUS.CONTRACTED]: "Contratado",
    [USER_STATUS.DISMISSED]: "Demitido",
  };

  if (currentStatus === USER_STATUS.DISMISSED) {
    return "Colaboradores demitidos não podem ter o status alterado";
  }

  if (currentStatus === USER_STATUS.CONTRACTED && (newStatus === USER_STATUS.EXPERIENCE_PERIOD_1 || newStatus === USER_STATUS.EXPERIENCE_PERIOD_2)) {
    return "Colaboradores contratados não podem retornar ao período de experiência";
  }

  const allowedTransitions = USER_STATUS_TRANSITIONS[currentStatus as USER_STATUS] || [];
  const allowedLabels = allowedTransitions.map((s: USER_STATUS) => statusLabels[s]).join(", ");

  return `Transição inválida de ${statusLabels[currentStatus] || currentStatus} para ${statusLabels[newStatus] || newStatus}. Transições permitidas: ${allowedLabels}`;
}

export const mapUserToFormData = createMapToFormDataHelper<User, UserUpdateFormData>((user) => ({
  email: user.email || undefined,
  name: user.name,
  avatarId: user.avatarId || undefined,
  status: user.status as USER_STATUS,
  phone: user.phone || undefined,
  positionId: user.positionId || undefined,
  pis: user.pis || undefined,
  cpf: user.cpf || undefined,
  verified: user.verified,
  performanceLevel: user.performanceLevel,
  sectorId: user.sectorId || undefined,
  managedSectorId: user.managedSectorId || undefined,
  password: undefined, // Never map password from existing user

  // Address fields
  address: user.address || undefined,
  addressNumber: user.addressNumber || undefined,
  addressComplement: user.addressComplement || undefined,
  neighborhood: user.neighborhood || undefined,
  city: user.city || undefined,
  state: user.state || undefined,
  zipCode: user.zipCode || undefined,
  // site: user.site || undefined,

  // Additional dates - use birth and dismissedAt
  birth: user.birth,
  dismissedAt: user.dismissedAt || undefined,

  // Payroll info
  payrollNumber: user.payrollNumber || undefined,

  // Store current status for validation
  currentStatus: user.status as USER_STATUS,
}));
