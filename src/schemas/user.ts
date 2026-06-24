// packages/schemas/src/user.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  orderByWithNullsSchema,
  normalizeOrderBy,
  emailSchema,
  phoneSchema,
  cpfSchema,
  pisSchema,
  createNameSchema,
  nullableDate,
  createDateSchema,
  normalizeSearchTerm,
} from './common';
import { cleanCPF } from '../utils/cleaners';
import { isValidCPF } from '../utils/validators';
import { validateEmployeeContractTypeIntegrity } from '../utils/contract';
import type { User } from '@types';
import {
  CONTRACT_TYPE,
  CONTRACT_STATUS,
  EMPLOYEE_TYPE,
  TERMINATION_TYPE,
  VERIFICATION_TYPE,
  SECTOR_PRIVILEGES,
  INSALUBRITY_DEGREE,
  STABILITY_TYPE,
} from '@constants';

// =====================
// Select Schema for Partial Field Selection
// =====================

// Base select schema - allows selecting individual User fields
export const userSelectSchema = z
  .object({
    // Scalar fields
    id: z.boolean().optional(),
    email: z.boolean().optional(),
    name: z.boolean().optional(),
    avatarId: z.boolean().optional(),
    currentContractId: z.boolean().optional(),
    currentContractType: z.boolean().optional(),
    currentContractStatus: z.boolean().optional(),
    currentEmployeeType: z.boolean().optional(),
    phone: z.boolean().optional(),
    positionId: z.boolean().optional(),
    pis: z.boolean().optional(),
    cpf: z.boolean().optional(),
    verified: z.boolean().optional(),
    isActive: z.boolean().optional(),
    payrollNumber: z.boolean().optional(),
    birth: z.boolean().optional(),
    unionMember: z.boolean().optional(),
    unionAuthorizationDate: z.boolean().optional(),
    dependentsCount: z.boolean().optional(),
    hasSimplifiedDeduction: z.boolean().optional(),
    performanceLevel: z.boolean().optional(),
    sectorId: z.boolean().optional(),
    secullumEmployeeId: z.boolean().optional(),
    secullumSyncEnabled: z.boolean().optional(),
    secullumHorarioId: z.boolean().optional(),
    createdAt: z.boolean().optional(),
    updatedAt: z.boolean().optional(),
    password: z.boolean().optional(),
    verificationCode: z.boolean().optional(),
    verificationExpiresAt: z.boolean().optional(),
    verificationType: z.boolean().optional(),
    requirePasswordChange: z.boolean().optional(),
    lastLoginAt: z.boolean().optional(),
    sessionToken: z.boolean().optional(),
    address: z.boolean().optional(),
    addressNumber: z.boolean().optional(),
    addressComplement: z.boolean().optional(),
    neighborhood: z.boolean().optional(),
    city: z.boolean().optional(),
    state: z.boolean().optional(),
    zipCode: z.boolean().optional(),

    // Relations - can be true or nested select/include
    avatar: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
        }),
      ])
      .optional(),
    ppeSize: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
        }),
      ])
      .optional(),
    preference: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
        }),
      ])
      .optional(),
    position: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
        }),
      ])
      .optional(),
    sector: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
        }),
      ])
      .optional(),
    ledSector: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
        }),
      ])
      .optional(),
    activities: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    borrows: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    notifications: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    tasks: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    bonifications: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    warningsCollaborator: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    warningsSupervisor: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    warningsWitness: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    ppeDeliveries: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    ppeDeliveriesApproved: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    ppeSchedules: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    changeLogs: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    seenNotification: z
      .union([
        z.boolean(),
        z.object({
          select: z.any().optional(),
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
          take: z.number().optional(),
          skip: z.number().optional(),
        }),
      ])
      .optional(),
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z.record(z.boolean()).optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// Predefined Select Patterns for Common Use Cases
// =====================

// Minimal select for comboboxes - just id and name
export const userSelectMinimal = {
  id: true,
  name: true,
} as const;

// Select for comboboxes with sector - id, name, sector
export const userSelectWithSector = {
  id: true,
  name: true,
  sector: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

// Select for comboboxes with position - id, name, position
export const userSelectWithPosition = {
  id: true,
  name: true,
  position: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

// Select for comboboxes with sector and position - id, name, sector, position
export const userSelectWithSectorAndPosition = {
  id: true,
  name: true,
  sector: {
    select: {
      id: true,
      name: true,
    },
  },
  position: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

// Select for user lists - includes basic info and status
export const userSelectForList = {
  id: true,
  name: true,
  email: true,
  phone: true,
  currentContractType: true,
  currentContractStatus: true,
  currentEmployeeType: true,
  isActive: true,
  avatarId: true,
  payrollNumber: true,
  sector: {
    select: {
      id: true,
      name: true,
    },
  },
  position: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

// Select for user profile - includes most fields except sensitive data
export const userSelectForProfile = {
  id: true,
  name: true,
  email: true,
  phone: true,
  currentContractId: true,
  currentContractType: true,
  currentContractStatus: true,
  currentEmployeeType: true,
  isActive: true,
  verified: true,
  avatarId: true,
  payrollNumber: true,
  cpf: true,
  pis: true,
  birth: true,
  performanceLevel: true,
  address: true,
  addressNumber: true,
  addressComplement: true,
  neighborhood: true,
  city: true,
  state: true,
  zipCode: true,
  createdAt: true,
  updatedAt: true,
  sector: {
    select: {
      id: true,
      name: true,
      privileges: true,
    },
  },
  position: {
    select: {
      id: true,
      name: true,
      hierarchy: true,
      remuneration: true,
    },
  },
  ppeSize: true,
  preference: true,
  currentContract: {
    select: {
      id: true,
      sequence: true,
      employeeType: true,
      contractType: true,
      status: true,
      admissionDate: true,
      exp1StartAt: true,
      exp1EndAt: true,
      exp2StartAt: true,
      exp2EndAt: true,
      effectedAt: true,
      terminationDate: true,
      terminationType: true,
    },
  },
  _count: {
    select: {
      tasks: true,
      activities: true,
      bonifications: true,
    },
  },
} as const;

// Select for authentication - includes only necessary auth fields
export const userSelectForAuth = {
  id: true,
  name: true,
  email: true,
  phone: true,
  password: true,
  currentContractType: true,
  currentContractStatus: true,
  verified: true,
  verificationCode: true,
  verificationExpiresAt: true,
  verificationType: true,
  requirePasswordChange: true,
  sessionToken: true,
  isActive: true,
  sectorId: true,
  positionId: true,
} as const;

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const userIncludeSchema = z
  .object({
    // Direct User relations
    avatar: z.boolean().optional(),
    // Employment contracts (vínculos)
    currentContract: z
      .union([
        z.boolean(),
        z.object({
          include: z.any().optional(),
          select: z.any().optional(),
        }),
      ])
      .optional(),
    contracts: z
      .union([
        z.boolean(),
        z.object({
          include: z.any().optional(),
          select: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
        }),
      ])
      .optional(),
    contractPhaseHistory: z
      .union([
        z.boolean(),
        z.object({
          include: z.any().optional(),
          select: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
        }),
      ])
      .optional(),
    admissions: z
      .union([
        z.boolean(),
        z.object({
          include: z.any().optional(),
          where: z.any().optional(),
          orderBy: z.any().optional(),
        }),
      ])
      .optional(),
    dependents: z
      .union([
        z.boolean(),
        z.object({
          where: z.any().optional(),
          orderBy: z.any().optional(),
        }),
      ])
      .optional(),
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
              remunerations: z
                .union([
                  z.boolean(),
                  z.object({
                    orderBy: z.object({ createdAt: z.enum(['asc', 'desc']) }).optional(),
                    take: z.number().optional(),
                  }),
                ])
                .optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    sector: z
      .union([
        z.boolean(),
        z.object({
          include: z.any().optional(),
          select: z.any().optional(),
        }),
      ])
      .optional(),
    ledSector: z
      .union([
        z.boolean(),
        z.object({
          include: z.any().optional(),
          select: z.any().optional(),
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
              bonifications: z.boolean().optional(),
              serviceOrders: z.boolean().optional(),
              truck: z.boolean().optional(),
              airbrushing: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    bonifications: z
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
    _count: z
      .union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })])
      .optional(),
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
      currentContractType: orderByDirectionSchema.optional(),
      currentContractStatus: orderByDirectionSchema.optional(),
      currentEmployeeType: orderByDirectionSchema.optional(),
      phone: orderByDirectionSchema.optional(),
      positionId: orderByDirectionSchema.optional(),
      pis: orderByDirectionSchema.optional(),
      cpf: orderByDirectionSchema.optional(),
      verified: orderByDirectionSchema.optional(),
      payrollNumber: orderByDirectionSchema.optional(),
      birth: orderByDirectionSchema.optional(),
      unionMember: orderByDirectionSchema.optional(),
      unionAuthorizationDate: orderByDirectionSchema.optional(),
      dependentsCount: orderByDirectionSchema.optional(),
      hasSimplifiedDeduction: orderByDirectionSchema.optional(),
      performanceLevel: orderByDirectionSchema.optional(),
      sectorId: orderByDirectionSchema.optional(),
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

      ledSector: z
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
        currentContractType: orderByDirectionSchema.optional(),
        currentContractStatus: orderByDirectionSchema.optional(),
        currentEmployeeType: orderByDirectionSchema.optional(),
        phone: orderByDirectionSchema.optional(),
        positionId: orderByDirectionSchema.optional(),
        pis: orderByDirectionSchema.optional(),
        cpf: orderByDirectionSchema.optional(),
        verified: orderByDirectionSchema.optional(),
        payrollNumber: orderByDirectionSchema.optional(),
        birth: orderByDirectionSchema.optional(),
        unionMember: orderByDirectionSchema.optional(),
        unionAuthorizationDate: orderByDirectionSchema.optional(),
        dependentsCount: orderByDirectionSchema.optional(),
        hasSimplifiedDeduction: orderByDirectionSchema.optional(),
        performanceLevel: orderByDirectionSchema.optional(),
        sectorId: orderByDirectionSchema.optional(),
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

        ledSector: z
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
            mode: z.enum(['default', 'insensitive']).optional(),
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
            mode: z.enum(['default', 'insensitive']).optional(),
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

      currentContractType: z
        .union([
          z.nativeEnum(CONTRACT_TYPE),
          z.null(),
          z.object({
            equals: z.union([z.nativeEnum(CONTRACT_TYPE), z.null()]).optional(),
            not: z.union([z.nativeEnum(CONTRACT_TYPE), z.null()]).optional(),
            in: z.array(z.nativeEnum(CONTRACT_TYPE)).optional(),
            notIn: z.array(z.nativeEnum(CONTRACT_TYPE)).optional(),
          }),
        ])
        .optional(),

      currentContractStatus: z
        .union([
          z.nativeEnum(CONTRACT_STATUS),
          z.null(),
          z.object({
            equals: z.union([z.nativeEnum(CONTRACT_STATUS), z.null()]).optional(),
            not: z.union([z.nativeEnum(CONTRACT_STATUS), z.null()]).optional(),
            in: z.array(z.nativeEnum(CONTRACT_STATUS)).optional(),
            notIn: z.array(z.nativeEnum(CONTRACT_STATUS)).optional(),
          }),
        ])
        .optional(),

      currentEmployeeType: z
        .union([
          z.nativeEnum(EMPLOYEE_TYPE),
          z.null(),
          z.object({
            equals: z.union([z.nativeEnum(EMPLOYEE_TYPE), z.null()]).optional(),
            not: z.union([z.nativeEnum(EMPLOYEE_TYPE), z.null()]).optional(),
            in: z.array(z.nativeEnum(EMPLOYEE_TYPE)).optional(),
            notIn: z.array(z.nativeEnum(EMPLOYEE_TYPE)).optional(),
          }),
        ])
        .optional(),

      currentContractId: z
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

      isActive: z
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

      unionMember: z
        .union([
          z.boolean(),
          z.object({
            equals: z.boolean().optional(),
            not: z.boolean().optional(),
          }),
        ])
        .optional(),

      unionAuthorizationDate: z
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

      dependentsCount: z
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

      hasSimplifiedDeduction: z
        .union([
          z.boolean(),
          z.object({
            equals: z.boolean().optional(),
            not: z.boolean().optional(),
          }),
        ])
        .optional(),

      // Employment-date filters now live on the contract. Filter via the
      // currentContract relation, e.g. { currentContract: { is: { effectedAt: {...} } } }.
      currentContract: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),
      contracts: z
        .object({
          some: z.lazy(() => z.any()).optional(),
          every: z.lazy(() => z.any()).optional(),
          none: z.lazy(() => z.any()).optional(),
        })
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

      secullumEmployeeId: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            in: z.array(z.number()).optional(),
            notIn: z.array(z.number()).optional(),
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

      bonifications: z
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
  positionIds: z.array(z.string()).optional(),
  // Granular situação/modalidade/categoria filters (key off the synced cache columns).
  contractStatuses: z.array(z.nativeEnum(CONTRACT_STATUS)).optional(),
  contractTypes: z.array(z.nativeEnum(CONTRACT_TYPE)).optional(),
  employeeTypes: z.array(z.nativeEnum(EMPLOYEE_TYPE)).optional(),
  // Alias kept for backward compatibility — maps to currentContractType like contractTypes.
  contractKinds: z.array(z.nativeEnum(CONTRACT_TYPE)).optional(),
  isActive: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  hasPosition: z.boolean().optional(),
  hasSector: z.boolean().optional(),
  hasLedSector: z.boolean().optional(),
  hasPpeSize: z.boolean().optional(),
  hasActivities: z.boolean().optional(),
  hasTasks: z.boolean().optional(),
  performanceLevelRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  // Sector privilege filters - filter users by their sector's privilege level
  excludeSectorPrivileges: z.array(z.nativeEnum(SECTOR_PRIVILEGES)).optional(),
  includeSectorPrivileges: z.array(z.nativeEnum(SECTOR_PRIVILEGES)).optional(),
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
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    const searchTerm = data.searchingFor.trim();
    const searchNumber = parseInt(searchTerm, 10);

    // If the search term is purely numeric, search ONLY in payrollNumber for exact match
    if (!isNaN(searchNumber) && searchNumber.toString() === searchTerm) {
      andConditions.push({ payrollNumber: searchNumber });
    } else {
      // Otherwise, search across text fields
      const orConditions: any[] = [
        { nameNormalized: { contains: normalizeSearchTerm(searchTerm) } },
        { emailNormalized: { contains: normalizeSearchTerm(searchTerm) } },
        { phoneNormalized: { contains: normalizeSearchTerm(searchTerm) } },
        { cpfNormalized: { contains: normalizeSearchTerm(searchTerm) } },
        { pisNormalized: { contains: normalizeSearchTerm(searchTerm) } },
        { position: { is: { nameNormalized: { contains: normalizeSearchTerm(searchTerm) } } } },
        { sector: { is: { nameNormalized: { contains: normalizeSearchTerm(searchTerm) } } } },
        { ledSector: { is: { nameNormalized: { contains: normalizeSearchTerm(searchTerm) } } } },
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

  // Handle positionIds filter
  if (data.positionIds && Array.isArray(data.positionIds) && data.positionIds.length > 0) {
    andConditions.push({ positionId: { in: data.positionIds } });
    delete data.positionIds;
  }

  // Handle granular situação filter (current contract lifecycle status).
  if (
    data.contractStatuses &&
    Array.isArray(data.contractStatuses) &&
    data.contractStatuses.length > 0
  ) {
    andConditions.push({ currentContractStatus: { in: data.contractStatuses } });
    delete data.contractStatuses;
  }

  // Handle granular modalidade filter (current contract type). `contractKinds`
  // is a backward-compatible alias that maps to the same cache column.
  const contractTypeValues =
    (Array.isArray(data.contractTypes) && data.contractTypes.length > 0 && data.contractTypes) ||
    (Array.isArray(data.contractKinds) && data.contractKinds.length > 0 && data.contractKinds) ||
    null;
  if (contractTypeValues) {
    andConditions.push({ currentContractType: { in: contractTypeValues } });
  }
  delete data.contractTypes;
  delete data.contractKinds;

  // Handle categoria filter (worker category — CLT/PJ/terceirizado/etc.)
  if (data.employeeTypes && Array.isArray(data.employeeTypes) && data.employeeTypes.length > 0) {
    andConditions.push({ currentEmployeeType: { in: data.employeeTypes } });
    delete data.employeeTypes;
  }

  // Handle isActive filter — THE canonical "currently employed" signal.
  // Keyed off the synced `User.isActive` column (robust for null/zero-contract
  // users). Dismissed === isActive === false. When undefined, no condition is
  // applied so ALL users (incl. dismissed) are returned — the default
  // "active only" view is a frontend concern.
  if (typeof data.isActive === 'boolean') {
    andConditions.push({ isActive: data.isActive });
    delete data.isActive;
  }

  // Handle isVerified filter
  if (typeof data.isVerified === 'boolean') {
    andConditions.push({ verified: data.isVerified });
    delete data.isVerified;
  }

  // Handle hasPosition filter
  if (typeof data.hasPosition === 'boolean') {
    if (data.hasPosition) {
      andConditions.push({ positionId: { not: null } });
    } else {
      andConditions.push({ positionId: null });
    }
    delete data.hasPosition;
  }

  // Handle hasSector filter
  if (typeof data.hasSector === 'boolean') {
    if (data.hasSector) {
      andConditions.push({ sectorId: { not: null } });
    } else {
      andConditions.push({ sectorId: null });
    }
    delete data.hasSector;
  }

  // Handle hasLedSector filter
  if (typeof data.hasLedSector === 'boolean') {
    if (data.hasLedSector) {
      andConditions.push({ ledSector: { is: { id: { not: undefined } } } });
    } else {
      andConditions.push({ ledSector: { is: null } });
    }
    delete data.hasLedSector;
  }

  // Handle hasPpeSize filter
  if (typeof data.hasPpeSize === 'boolean') {
    if (data.hasPpeSize) {
      andConditions.push({ ppeSize: { is: { id: { not: undefined } } } });
    } else {
      andConditions.push({ ppeSize: { is: null } });
    }
    delete data.hasPpeSize;
  }

  // Handle hasActivities filter
  if (typeof data.hasActivities === 'boolean') {
    if (data.hasActivities) {
      andConditions.push({ activities: { some: {} } });
    } else {
      andConditions.push({ activities: { none: {} } });
    }
    delete data.hasActivities;
  }

  // Handle hasTasks filter
  if (typeof data.hasTasks === 'boolean') {
    if (data.hasTasks) {
      andConditions.push({ createdTasks: { some: {} } });
    } else {
      andConditions.push({ createdTasks: { none: {} } });
    }
    delete data.hasTasks;
  }

  // Handle performanceLevelRange filter
  if (data.performanceLevelRange && typeof data.performanceLevelRange === 'object') {
    const levelCondition: any = {};
    if (typeof data.performanceLevelRange.min === 'number')
      levelCondition.gte = data.performanceLevelRange.min;
    if (typeof data.performanceLevelRange.max === 'number')
      levelCondition.lte = data.performanceLevelRange.max;
    if (Object.keys(levelCondition).length > 0) {
      andConditions.push({ performanceLevel: levelCondition });
    }
    delete data.performanceLevelRange;
  }

  // Handle excludeSectorPrivileges filter - exclude users whose sector has specific privileges
  if (
    data.excludeSectorPrivileges &&
    Array.isArray(data.excludeSectorPrivileges) &&
    data.excludeSectorPrivileges.length > 0
  ) {
    andConditions.push({
      OR: [
        // Include users with no sector
        { sectorId: null },
        // Include users whose sector privilege is NOT in the excluded list
        { sector: { is: { privileges: { notIn: data.excludeSectorPrivileges } } } },
      ],
    });
    delete data.excludeSectorPrivileges;
  }

  // Handle includeSectorPrivileges filter - only include users whose sector has specific privileges
  if (
    data.includeSectorPrivileges &&
    Array.isArray(data.includeSectorPrivileges) &&
    data.includeSectorPrivileges.length > 0
  ) {
    andConditions.push({
      sector: { is: { privileges: { in: data.includeSectorPrivileges } } },
    });
    delete data.includeSectorPrivileges;
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
    select: userSelectSchema.optional(),

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
  shorts: z.string().nullish(),
  sleeves: z.string().nullish(),
  mask: z.string().nullish(),
  gloves: z.string().nullish(),
  rainBoots: z.string().nullish(),
});

// Notification preferences nested creation schema
const notificationPreferenceCreateNestedSchema = z.object({
  notificationType: z.string(),
  enabled: z.boolean().default(true),
  channels: z.array(z.string()).default(['EMAIL']),
  importance: z.string().default('MEDIUM'),
});

// First employment contract (vínculo) created together with the collaborator.
// When omitted, the service defaults CLT to contractType=EXPERIENCE_PERIOD_1 + status=ACTIVE
// (efetivação later changes modality EXPERIENCE_PERIOD_2→INDETERMINATE) and uses the user's
// admissionDate (positionId/sectorId mirror the user).
export const userContractCreateNestedSchema = z.object({
  employeeType: z
    .enum(Object.values(EMPLOYEE_TYPE) as [string, ...string[]], {
      errorMap: () => ({ message: 'categoria de colaborador inválida' }),
    })
    .default(EMPLOYEE_TYPE.CLT),
  contractType: z
    .enum(Object.values(CONTRACT_TYPE) as [string, ...string[]], {
      errorMap: () => ({ message: 'tipo de contrato inválido' }),
    })
    .nullable()
    .optional(),
  admissionDate: nullableDate.optional(),
  positionId: z.string().uuid('Cargo inválido').nullable().optional(),
  sectorId: z.string().uuid('Setor inválido').nullable().optional(),
  payrollNumber: z.number().int().positive('Número da folha deve ser positivo').nullable().optional(),
  providerName: z.string().nullable().optional(),
  providerCnpj: z.string().nullable().optional(),
  // Art. 481 CLT — cláusula assecuratória do direito recíproco de rescisão.
  hasArt481Clause: z.boolean().optional(),
  // Overrides per-vínculo da insalubridade/periculosidade do cargo (NULL = herda).
  insalubrityDegreeOverride: z.nativeEnum(INSALUBRITY_DEGREE).nullable().optional(),
  hazardPayOverride: z.boolean().nullable().optional(),
  // Estabilidade — janela que bloqueia o desligamento.
  stabilityType: z.nativeEnum(STABILITY_TYPE).nullable().optional(),
  stabilityStart: nullableDate.optional(),
  stabilityEnd: nullableDate.optional(),
}).refine(
  data => {
    // Only validate when a modality is explicitly provided (omitted = service default).
    if (data.contractType == null) return true;
    return (
      validateEmployeeContractTypeIntegrity({
        employeeType: data.employeeType as EMPLOYEE_TYPE,
        contractType: data.contractType as CONTRACT_TYPE,
      }) === null
    );
  },
  {
    message:
      'Categoria e modalidade incompatíveis: CLT exige uma modalidade CLT; terceirizado/PJ/autônomo/estagiário não devem ter modalidade. Aprendiz só com CLT.',
    path: ['contractType'],
  },
);

export const userCreateSchema = z
  .object({
    email: emailSchema.nullable().optional(),
    name: createNameSchema(2, 200, 'Nome'),
    avatarId: z.string().uuid('ID de avatar inválido').nullable().optional(),
    // First vínculo (EmploymentContract) created with the collaborator. Optional;
    // the service defaults CLT to contractType=EXPERIENCE_PERIOD_1 + status=ACTIVE.
    contract: userContractCreateNestedSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    // Cargo (position) — required at create time for on-folha collaborators. The
    // bound Secullum função is resolved from it, and HR workflows assume every CLT
    // collaborator has a cargo. Off-payroll providers (terceirizado/PJ) don't
    // occupy a cargo, so the requirement is relaxed for them via the refine below.
    // userUpdateSchema keeps it nullable.optional so legacy rows aren't blocked.
    positionId: z.string().uuid('Cargo inválido').nullable().optional(),
    pis: pisSchema.nullable().optional(),
    // CPF — required at create time. Secullum requires it for funcionario
    // creation and Brazilian payroll mandates it. userUpdateSchema keeps it
    // nullable.optional so legacy rows aren't blocked.
    cpf: z
      .string({
        required_error: 'CPF é obrigatório',
        invalid_type_error: 'CPF é obrigatório',
      })
      .min(1, 'CPF é obrigatório')
      .transform(cleanCPF)
      .refine(isValidCPF, { message: 'CPF inválido' }),
    verified: z.boolean().default(false),
    isActive: z.boolean().default(true),
    performanceLevel: z.number().int().min(0).max(5).default(0),
    // Setor (sector) — required at create time. Drives the Secullum departamento
    // mapping and sector-scoped permissions/reports. userUpdateSchema keeps it
    // nullable.optional so legacy rows aren't blocked.
    sectorId: z
      .string({
        required_error: 'Setor é obrigatório',
        invalid_type_error: 'Setor é obrigatório',
      })
      .uuid('Setor inválido'),
    password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres').nullable().optional(),

    // Address fields
    address: z.string().nullable().optional(),
    addressNumber: z.string().nullable().optional(),
    addressComplement: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z
      .string()
      .nullable()
      .optional()
      .refine(val => !val || val.length === 2, {
        message: 'Estado deve ter 2 caracteres',
      }),
    zipCode: z.string().nullable().optional(),
    site: z
      .string()
      .nullable()
      .optional()
      .refine(val => !val || z.string().url().safeParse(val).success, {
        message: 'URL inválida',
      }),

    // Additional dates - birth is nullable in Prisma
    birth: z.coerce
      .date()
      .refine(
        date => {
          const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
          })
            .format(new Date())
            .split('-')
            .map(Number);
          const eighteenYearsAgo = new Date(year - 18, month - 1, day);
          const birthDateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
          return birthDateOnly <= eighteenYearsAgo;
        },
        { message: 'O colaborador deve ter pelo menos 18 anos' },
      )
      .nullable()
      .optional(),

    // Payroll fields
    unionMember: z.boolean().default(false),
    unionAuthorizationDate: nullableDate.optional(),
    dependentsCount: z.number().int().min(0).default(0),
    hasSimplifiedDeduction: z.boolean().default(true),

    // Admission date — required at create time. Drives CLT period
    // auto-calculation and Secullum's Admissao field. The service routes this
    // into the first EmploymentContract (vínculo) as its admissionDate.
    // createDateSchema rejects null/'' up front; a bare z.coerce.date() would
    // coerce a null/empty field to the 1970 epoch and pass.
    admissionDate: createDateSchema('Data de admissão'),

    // Payroll info — required at create time (Secullum NumeroFolha + payroll
    // computations). userUpdateSchema keeps it nullable.optional for editing
    // existing rows that pre-date this constraint.
    payrollNumber: z
      .number({
        required_error: 'Número da folha é obrigatório',
        invalid_type_error: 'Número da folha deve ser numérico',
      })
      .int()
      .positive('Número da folha deve ser positivo'),

    // Nested PPE size creation for new users
    ppeSize: ppeSizeCreateNestedSchema.optional(),
    // Nested notification preferences creation
    notificationPreferences: z.array(notificationPreferenceCreateNestedSchema).optional(),
    // Required for changelog tracking
    userId: z.string().optional(),
    // Sector leader flag - when true, sets this user as leader of their sector
    // The backend will update Sector.leaderId accordingly
    isSectorLeader: z.boolean().default(false),
    // Secullum integration: when true, after user is created the backend
    // emits 'secullum.user.created' so UserSecullumSyncService can provision
    // a matching Funcionario in Secullum. Default false (opt-in).
    secullumSyncEnabled: z.boolean().default(false).optional(),
    // Per-user override for Secullum Horario.Id. When omitted, bridge falls
    // back to the user's Sector.secullumHorarioId, then to 1.
    secullumHorarioId: z.number().int().nullable().optional(),
  })
  .refine(data => data.email || data.phone, {
    message: 'Email ou telefone deve ser fornecido',
    path: ['email'], // Show error on email field
  })
  .refine(
    data => {
      // Cargo is required for on-folha collaborators. Off-payroll providers
      // (terceirizado/PJ) don't occupy a cargo, so it stays optional for them.
      const employeeType = data.contract?.employeeType;
      const isProvider =
        employeeType === EMPLOYEE_TYPE.TERCEIRIZADO || employeeType === EMPLOYEE_TYPE.PJ;
      return isProvider || !!data.positionId;
    },
    {
      message: 'Cargo é obrigatório',
      path: ['positionId'],
    },
  );

export const userUpdateSchema = z
  .object({
    email: emailSchema.nullable().optional(),
    name: createNameSchema(2, 200, 'Nome').optional(),
    avatarId: z.string().uuid('ID de avatar inválido').nullable().optional(),
    // Current vínculo edit — these update the user's CURRENT EmploymentContract
    // (and re-sync the User cache). The contract is the source of truth.
    contractType: z
      .enum(Object.values(CONTRACT_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de contrato inválido' }),
      })
      .optional(),
    contractStatus: z
      .enum(Object.values(CONTRACT_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'situação do contrato inválida' }),
      })
      .optional(),
    employeeType: z
      .enum(Object.values(EMPLOYEE_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'categoria de colaborador inválida' }),
      })
      .optional(),
    phone: phoneSchema.nullable().optional(),
    positionId: z.string().uuid('Cargo inválido').nullable().optional(),
    pis: pisSchema.nullable().optional(),
    cpf: cpfSchema.nullable().optional(),
    verified: z.boolean().optional(),
    isActive: z.boolean().optional(),
    performanceLevel: z.number().int().min(0).max(5).optional(),
    sectorId: z.string().uuid('Setor inválido').nullable().optional(),
    password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres').nullable().optional(),

    // Address fields
    address: z.string().nullable().optional(),
    addressNumber: z.string().nullable().optional(),
    addressComplement: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z
      .string()
      .nullable()
      .optional()
      .refine(val => !val || val.length === 2, {
        message: 'Estado deve ter 2 caracteres',
      }),
    zipCode: z.string().nullable().optional(),
    site: z
      .string()
      .nullable()
      .optional()
      .refine(val => !val || z.string().url().safeParse(val).success, {
        message: 'URL inválida',
      }),

    // Additional dates
    birth: z.coerce
      .date()
      .refine(
        date => {
          const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
          })
            .format(new Date())
            .split('-')
            .map(Number);
          const eighteenYearsAgo = new Date(year - 18, month - 1, day);
          const birthDateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
          return birthDateOnly <= eighteenYearsAgo;
        },
        { message: 'O colaborador deve ter pelo menos 18 anos' },
      )
      .nullable()
      .optional(),

    // Payroll fields
    unionMember: z.boolean().optional(),
    unionAuthorizationDate: nullableDate.optional(),
    dependentsCount: z.number().int().min(0).optional(),
    hasSimplifiedDeduction: z.boolean().optional(),

    // Current vínculo (EmploymentContract) date edits — applied to the user's
    // current contract by the service, then mirrored back into the User cache.
    admissionDate: nullableDate.optional(),
    effectedAt: nullableDate.optional(),
    exp1StartAt: nullableDate.optional(),
    exp1EndAt: nullableDate.optional(),
    exp2StartAt: nullableDate.optional(),
    exp2EndAt: nullableDate.optional(),
    // Art. 481 CLT — cláusula assecuratória do direito recíproco de rescisão.
    hasArt481Clause: z.boolean().optional(),
    // Overrides per-vínculo da insalubridade/periculosidade do cargo (NULL = herda).
    insalubrityDegreeOverride: z.nativeEnum(INSALUBRITY_DEGREE).nullable().optional(),
    hazardPayOverride: z.boolean().nullable().optional(),
    // Estabilidade — janela que bloqueia o desligamento do vínculo atual.
    stabilityType: z.nativeEnum(STABILITY_TYPE).nullable().optional(),
    stabilityStart: nullableDate.optional(),
    stabilityEnd: nullableDate.optional(),
    terminationDate: nullableDate.optional(),
    terminationType: z
      .enum(Object.values(TERMINATION_TYPE) as [string, ...string[]])
      .nullable()
      .optional(),

    // Payroll info
    payrollNumber: z
      .number()
      .int()
      .positive('Número da folha deve ser positivo')
      .nullable()
      .optional(),

    verificationCode: z.string().nullable().optional(),
    verificationExpiresAt: z.date().nullable().optional(),
    verificationType: z
      .enum(Object.values(VERIFICATION_TYPE) as [string, ...string[]])
      .nullable()
      .optional(),
    requirePasswordChange: z.boolean().optional(),
    lastLoginAt: z.date().optional(),
    // SECURITY (audit B8): sessionToken intentionally NOT accepted via update —
    // it is managed exclusively by the auth flow.
    // Required for changelog tracking
    userId: z.string().optional(),
    preferences: z.record(z.any()).optional(),
    // PPE Size update
    ppeSize: ppeSizeCreateNestedSchema.optional(),
    // Store the current contract type for transition validation (set by backend).
    currentContractType: z.nativeEnum(CONTRACT_TYPE).nullable().optional(),
    // Sector leader flag - when true, sets this user as leader of their sector
    // The backend will update Sector.leaderId accordingly
    isSectorLeader: z.boolean().optional(),
    // Secullum integration toggle. When true on update + secullumEmployeeId is
    // already set, the backend mirrors the change to Secullum after commit.
    secullumSyncEnabled: z.boolean().optional(),
    // Per-user override for Secullum Horario.Id (see userCreateSchema).
    secullumHorarioId: z.number().int().nullable().optional(),
  })
  .refine(
    data => {
      // If a termination date is provided, the contract status must be TERMINATED.
      if (data.terminationDate && data.contractStatus && data.contractStatus !== CONTRACT_STATUS.TERMINATED) {
        return false;
      }
      return true;
    },
    {
      message: 'Quando a data de demissão é fornecida, a situação do contrato deve ser TERMINATED',
      path: ['contractStatus'],
    },
  )
  .refine(
    data => {
      // EmployeeType ↔ ContractType integrity: CLT requires a CLT modality;
      // off-folha (terceirizado/PJ/autônomo/estagiário) must NOT carry a modality.
      // Only validated when both are present in this update (partial edits OK —
      // the service re-validates against the merged resulting state).
      if (data.employeeType === undefined && data.contractType === undefined) return true;
      if (data.employeeType === undefined) return true; // can't decide without category
      return (
        validateEmployeeContractTypeIntegrity({
          employeeType: data.employeeType as EMPLOYEE_TYPE,
          contractType:
            data.contractType === undefined
              ? undefined
              : (data.contractType as CONTRACT_TYPE | null),
        }) === null ||
        // when contractType not in this payload we cannot assert NULL-ness; defer to service
        data.contractType === undefined
      );
    },
    {
      message:
        'Categoria e modalidade incompatíveis: CLT exige uma modalidade CLT; terceirizado/PJ/autônomo/estagiário não devem ter modalidade. Aprendiz só com CLT.',
      path: ['contractType'],
    },
  )
  .refine(
    data => {
      // An efetivado vínculo (INDETERMINATE) cannot have its modality changed.
      if (
        data.currentContractType === CONTRACT_TYPE.INDETERMINATE &&
        data.contractType &&
        data.contractType !== CONTRACT_TYPE.INDETERMINATE
      ) {
        return false;
      }
      return true;
    },
    {
      message: 'A modalidade de um vínculo já efetivado (prazo indeterminado) não pode ser alterada.',
      path: ['contractType'],
    },
  )
  .refine(
    data => {
      // Validate the contract-modality transition within the current vínculo.
      if (data.currentContractType && data.contractType && data.currentContractType !== data.contractType) {
        return isValidStatusTransition(data.currentContractType, data.contractType);
      }
      return true;
    },
    {
      message: 'Transição de tipo de contrato inválida',
      path: ['contractType'],
    },
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
        id: z.string().uuid('Usuário inválido'),
        data: userUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma atualização é necessária'),
});

export const userBatchDeleteSchema = z.object({
  userIds: z
    .array(z.string().uuid('Usuário inválido'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

export const userMergeSchema = z.object({
  targetUserId: z.string().uuid({ message: 'ID do usuário principal inválido' }),
  sourceUserIds: z
    .array(z.string().uuid({ message: 'ID de usuário inválido' }))
    .min(1, { message: 'É necessário selecionar pelo menos 1 usuário para mesclar' })
    .max(10, { message: 'Máximo de 10 usuários podem ser mesclados por vez' }),
  conflictResolutions: z.record(z.any()).optional(),
});

// Query schema for include/select parameters
export const userQuerySchema = z.object({
  include: userIncludeSchema.optional(),
  select: userSelectSchema.optional(),
});

// =====================
// Additional Query Schemas
// =====================

export const userGetByIdSchema = z.object({
  include: userIncludeSchema.optional(),
  select: userSelectSchema.optional(),
});

// =====================
// Type Inference (FormData types)
// =====================

export type UserGetManyFormData = z.infer<typeof userGetManySchema>;
export type UserGetByIdFormData = z.infer<typeof userGetByIdSchema>;
export type UserQueryFormData = z.infer<typeof userQuerySchema>;

export type UserCreateFormData = z.infer<typeof userCreateSchema>;
// SECURITY (audit B8): sessionToken is intentionally absent from the client-facing
// update schema (zod strips it from request bodies), but internal auth flows still
// set it through the repository — keep it on the inferred type for server-side use.
export type UserUpdateFormData = z.infer<typeof userUpdateSchema> & {
  sessionToken?: string | null;
};

export type UserBatchCreateFormData = z.infer<typeof userBatchCreateSchema>;
export type UserBatchUpdateFormData = z.infer<typeof userBatchUpdateSchema>;
export type UserBatchDeleteFormData = z.infer<typeof userBatchDeleteSchema>;
export type UserMergeFormData = z.infer<typeof userMergeSchema>;

export type UserInclude = z.infer<typeof userIncludeSchema>;
export type UserSelect = z.infer<typeof userSelectSchema>;
export type UserOrderBy = z.infer<typeof userOrderBySchema>;
export type UserWhere = z.infer<typeof userWhereSchema>;

// =====================
// Helper Functions
// =====================

/**
 * Contract-type (MODALITY/phase) transition rules WITHIN a single vínculo
 * (EmploymentContract). Experiência is now encoded in the modality
 * (EXPERIENCE_PERIOD_1 → EXPERIENCE_PERIOD_2 → INDETERMINATE on efetivação,
 * CLT art. 451) while status stays ACTIVE. Administrative modality corrections
 * among CLT modalities are allowed; demissão is a STATUS change handled in the
 * status machine in `@utils/contract`.
 */
export const CONTRACT_TYPE_TRANSITIONS: Record<CONTRACT_TYPE, CONTRACT_TYPE[]> = {
  // INDETERMINATE (efetivo) is terminal as a modality.
  [CONTRACT_TYPE.INDETERMINATE]: [],
  // Experiência phases advance to one another and efetivam (→ INDETERMINATE).
  [CONTRACT_TYPE.EXPERIENCE_PERIOD_1]: [
    CONTRACT_TYPE.EXPERIENCE_PERIOD_2,
    CONTRACT_TYPE.INDETERMINATE,
  ],
  [CONTRACT_TYPE.EXPERIENCE_PERIOD_2]: [CONTRACT_TYPE.INDETERMINATE],
  // The other CLT modalities can be efetivadas (→ INDETERMINATE) or corrected
  // between one another administratively.
  [CONTRACT_TYPE.FIXED_TERM]: [
    CONTRACT_TYPE.INDETERMINATE,
    CONTRACT_TYPE.INTERMITTENT,
    CONTRACT_TYPE.APPRENTICE,
    CONTRACT_TYPE.TEMPORARY,
  ],
  [CONTRACT_TYPE.INTERMITTENT]: [CONTRACT_TYPE.INDETERMINATE, CONTRACT_TYPE.FIXED_TERM],
  [CONTRACT_TYPE.APPRENTICE]: [CONTRACT_TYPE.INDETERMINATE, CONTRACT_TYPE.FIXED_TERM],
  [CONTRACT_TYPE.TEMPORARY]: [CONTRACT_TYPE.INDETERMINATE, CONTRACT_TYPE.FIXED_TERM],
};

/**
 * Validates whether a contract MODALITY transition is allowed within a vínculo.
 * Lifecycle/efetivação gating lives in the CONTRACT_STATUS machine, not here.
 * @param currentType - The current contract modality
 * @param newType - The desired new contract modality
 * @returns true if the transition is allowed, false otherwise
 */
export function isValidStatusTransition(
  currentType: CONTRACT_TYPE | string,
  newType: CONTRACT_TYPE | string,
): boolean {
  // Same type is always allowed
  if (currentType === newType) {
    return true;
  }

  const allowedTransitions = CONTRACT_TYPE_TRANSITIONS[currentType as CONTRACT_TYPE];
  if (!allowedTransitions) {
    return false;
  }
  return allowedTransitions.includes(newType as CONTRACT_TYPE);
}

/**
 * Gets a human-readable error message for an invalid contract-modality transition.
 * @param currentType - The current contract modality
 * @param newType - The attempted new contract modality
 * @returns Error message in Portuguese
 */
export function getStatusTransitionError(
  currentType: CONTRACT_TYPE | string,
  newType: CONTRACT_TYPE | string,
): string {
  const typeLabels: Record<string, string> = {
    [CONTRACT_TYPE.INDETERMINATE]: 'Prazo indeterminado (efetivo)',
    [CONTRACT_TYPE.FIXED_TERM]: 'Prazo determinado',
    [CONTRACT_TYPE.INTERMITTENT]: 'Intermitente',
    [CONTRACT_TYPE.APPRENTICE]: 'Aprendiz',
    [CONTRACT_TYPE.TEMPORARY]: 'Temporário',
    [CONTRACT_TYPE.EXPERIENCE_PERIOD_1]: 'Experiência 1',
    [CONTRACT_TYPE.EXPERIENCE_PERIOD_2]: 'Experiência 2',
  };

  if (currentType === CONTRACT_TYPE.INDETERMINATE) {
    return 'A modalidade de um vínculo já efetivado (prazo indeterminado) não pode ser alterada.';
  }

  const allowedTransitions = CONTRACT_TYPE_TRANSITIONS[currentType as CONTRACT_TYPE] || [];
  const allowedLabels = allowedTransitions.map((t: CONTRACT_TYPE) => typeLabels[t]).join(', ');

  return `Transição inválida de ${typeLabels[currentType] || currentType} para ${typeLabels[newType] || newType}. Transições permitidas: ${allowedLabels}`;
}

export const mapUserToFormData = createMapToFormDataHelper<User, UserUpdateFormData>(user => ({
  email: user.email || undefined,
  name: user.name,
  avatarId: user.avatarId || undefined,
  contractType: (user.currentContractType ?? undefined) as CONTRACT_TYPE | undefined,
  employeeType: (user.currentEmployeeType ?? undefined) as EMPLOYEE_TYPE | undefined,
  phone: user.phone || undefined,
  positionId: user.positionId || undefined,
  pis: user.pis || undefined,
  cpf: user.cpf || undefined,
  verified: user.verified,
  performanceLevel: user.performanceLevel,
  sectorId: user.sectorId || undefined,
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

  // Additional dates
  birth: user.birth || undefined,

  // Payroll info
  payrollNumber: user.payrollNumber || undefined,

  // Store the current contract type for transition validation
  currentContractType: (user.currentContractType ?? undefined) as CONTRACT_TYPE | undefined,
}));
