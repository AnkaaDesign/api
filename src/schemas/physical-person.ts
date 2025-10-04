// packages/schemas/src/physical-person.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, emailSchema, createNameSchema, phoneSchema } from "./common";
import type { Customer } from '@types';
import { BRAZILIAN_STATES } from '@constants';
import { isValidCPF } from '@utils';

// =====================
// Physical Person Specific Schemas
// =====================

// RG Schema (Brazilian identity document)
export const rgSchema = z
  .string()
  .min(7, "RG deve ter pelo menos 7 caracteres")
  .max(15, "RG deve ter no máximo 15 caracteres")
  .regex(/^[0-9A-Za-z.-]+$/, "RG contém caracteres inválidos")
  .nullable()
  .optional();

// Brazilian State Schema
export const brazilianStateSchema = z
  .enum(Object.values(BRAZILIAN_STATES) as [string, ...string[]], {
    errorMap: () => ({ message: "Estado inválido" }),
  })
  .nullable()
  .optional();

// =====================
// Include Schema Based on Customer Schema (CPF focused)
// =====================

export const physicalPersonIncludeSchema = z
  .object({
    logo: z.boolean().optional(),
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
    _count: z
      .object({
        tasks: z.boolean().optional(),
      })
      .optional(),
  })
  .partial();

// =====================
// OrderBy Schema
// =====================

export const physicalPersonOrderBySchema = z
  .union([
    // Single ordering object
    z
      .object({
        id: orderByDirectionSchema.optional(),
        fantasyName: orderByDirectionSchema.optional(),
        cpf: orderByDirectionSchema.optional(),
        email: orderByDirectionSchema.optional(),
        address: orderByDirectionSchema.optional(),
        addressNumber: orderByDirectionSchema.optional(),
        neighborhood: orderByDirectionSchema.optional(),
        city: orderByDirectionSchema.optional(),
        state: orderByDirectionSchema.optional(),
        zipCode: orderByDirectionSchema.optional(),
        site: orderByDirectionSchema.optional(),
        logoId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),

    // Array of ordering objects
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          fantasyName: orderByDirectionSchema.optional(),
          cpf: orderByDirectionSchema.optional(),
          email: orderByDirectionSchema.optional(),
          address: orderByDirectionSchema.optional(),
          addressNumber: orderByDirectionSchema.optional(),
          neighborhood: orderByDirectionSchema.optional(),
          city: orderByDirectionSchema.optional(),
          state: orderByDirectionSchema.optional(),
          zipCode: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// Where Schema
// =====================

export const physicalPersonWhereSchema: z.ZodType<any> = z
  .object({
    // Boolean operators
    AND: z.array(z.lazy(() => physicalPersonWhereSchema)).optional(),
    OR: z.array(z.lazy(() => physicalPersonWhereSchema)).optional(),
    NOT: z.lazy(() => physicalPersonWhereSchema).optional(),

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

    logoId: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
        }),
      ])
      .optional(),

    // String fields
    fantasyName: z
      .union([
        z.string(),
        z.object({
          equals: z.string().optional(),
          not: z.string().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(["default", "insensitive"]).optional(),
        }),
      ])
      .optional(),

    cpf: z
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

    email: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(["default", "insensitive"]).optional(),
        }),
      ])
      .optional(),

    address: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(["default", "insensitive"]).optional(),
        }),
      ])
      .optional(),

    addressNumber: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(["default", "insensitive"]).optional(),
        }),
      ])
      .optional(),

    addressComplement: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(["default", "insensitive"]).optional(),
        }),
      ])
      .optional(),

    neighborhood: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(["default", "insensitive"]).optional(),
        }),
      ])
      .optional(),

    city: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(["default", "insensitive"]).optional(),
        }),
      ])
      .optional(),

    state: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(["default", "insensitive"]).optional(),
        }),
      ])
      .optional(),

    zipCode: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(["default", "insensitive"]).optional(),
        }),
      ])
      .optional(),

    site: z
      .union([
        z.string().nullable(),
        z.object({
          equals: z.string().nullable().optional(),
          not: z.string().nullable().optional(),
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
          mode: z.enum(["default", "insensitive"]).optional(),
        }),
      ])
      .optional(),

    // Array fields
    phones: z
      .object({
        has: z.string().optional(),
        hasEvery: z.array(z.string()).optional(),
        hasSome: z.array(z.string()).optional(),
        isEmpty: z.boolean().optional(),
      })
      .optional(),

    tags: z
      .object({
        has: z.string().optional(),
        hasEvery: z.array(z.string()).optional(),
        hasSome: z.array(z.string()).optional(),
        isEmpty: z.boolean().optional(),
      })
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

    // Relation filters
    logo: z
      .object({
        is: z.lazy(() => z.any()).optional(),
        isNot: z.lazy(() => z.any()).optional(),
      })
      .optional(),

    tasks: z
      .object({
        some: z.lazy(() => z.any()).optional(),
        every: z.lazy(() => z.any()).optional(),
        none: z.lazy(() => z.any()).optional(),
      })
      .optional(),
  })
  .partial();

// =====================
// Convenience Filters
// =====================

const physicalPersonFilters = {
  searchingFor: z.string().optional(),
  hasTasks: z.boolean().optional(),
  hasLogo: z.boolean().optional(),
  cities: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
};

// =====================
// Transform Function
// =====================

const physicalPersonTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  // Extract convenience filters
  const { searchingFor, hasTasks, hasLogo, cities, states, tags } = data;

  // Build where conditions
  const andConditions: any[] = [];

  // Text search (case insensitive) - focused on physical person fields
  if (searchingFor) {
    andConditions.push({
      OR: [
        { fantasyName: { contains: searchingFor, mode: "insensitive" } },
        { email: { contains: searchingFor, mode: "insensitive" } },
        { cpf: { contains: searchingFor } },
        { city: { contains: searchingFor, mode: "insensitive" } },
        { state: { contains: searchingFor, mode: "insensitive" } },
        { neighborhood: { contains: searchingFor, mode: "insensitive" } },
        { address: { contains: searchingFor, mode: "insensitive" } },
      ],
    });
  }

  // Has tasks filter
  if (hasTasks !== undefined) {
    if (hasTasks) {
      andConditions.push({ tasks: { some: {} } });
    } else {
      andConditions.push({ tasks: { none: {} } });
    }
  }

  // Has logo filter
  if (hasLogo !== undefined) {
    if (hasLogo) {
      andConditions.push({ logoId: { not: null } });
    } else {
      andConditions.push({ logoId: null });
    }
  }

  // Cities filter
  if (cities?.length) {
    andConditions.push({ city: { in: cities } });
  }

  // States filter
  if (states?.length) {
    andConditions.push({ state: { in: states } });
  }

  // Tags filter
  if (tags?.length) {
    andConditions.push({ tags: { hasSome: tags } });
  }

  // Ensure only CPF customers (no CNPJ) for physical persons
  andConditions.push({ cpf: { not: null } });
  andConditions.push({ cnpj: null });

  // Date range filter
  if (data.createdAt) {
    const dateCondition: any = {};
    if (data.createdAt.gte) dateCondition.gte = data.createdAt.gte;
    if (data.createdAt.lte) dateCondition.lte = data.createdAt.lte;
    if (Object.keys(dateCondition).length > 0) {
      andConditions.push({ createdAt: dateCondition });
    }
  }

  if (data.updatedAt) {
    const dateCondition: any = {};
    if (data.updatedAt.gte) dateCondition.gte = data.updatedAt.gte;
    if (data.updatedAt.lte) dateCondition.lte = data.updatedAt.lte;
    if (Object.keys(dateCondition).length > 0) {
      andConditions.push({ updatedAt: dateCondition });
    }
  }

  // Apply conditions to where clause
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
// Query Schema
// =====================

export const physicalPersonGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: physicalPersonWhereSchema.optional(),
    orderBy: physicalPersonOrderBySchema.optional(),
    include: physicalPersonIncludeSchema.optional(),

    // Convenience filters
    ...physicalPersonFilters,

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
  .transform(physicalPersonTransform);

// =====================
// GetById Schema
// =====================

export const physicalPersonGetByIdSchema = z.object({
  include: physicalPersonIncludeSchema.optional(),
  id: z.string().uuid("Pessoa física inválida"),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const physicalPersonCreateSchema = z
  .object({
    fantasyName: createNameSchema(2, 200, "Nome"),
    cpf: z
      .string()
      .min(1, "CPF é obrigatório")
      .regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/, "CPF deve estar no formato 000.000.000-00")
      .refine((val) => isValidCPF(val), { message: "CPF inválido" }),
    corporateName: z.string().nullable().optional(),
    email: emailSchema.nullable().optional(),
    address: z.string().nullable().optional(),
    addressNumber: z.string().nullable().optional(),
    addressComplement: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: brazilianStateSchema,
    zipCode: z
      .string()
      .regex(/^\d{5}-?\d{3}$/, "CEP inválido")
      .nullable()
      .optional()
      .transform((val) => {
        if (!val) return val;
        // Ensure CEP has the hyphen format
        return val.replace(/^(\d{5})(\d{3})$/, "$1-$2");
      }),
    site: z.string().url("URL inválida").nullable().optional(),
    phones: z.array(phoneSchema).default([]),
    tags: z.array(z.string()).default([]),
    logoId: z.string().uuid("Logo inválido").nullable().optional(),
    // Extra fields for physical persons
    rg: rgSchema,
    birthDate: z.coerce.date().nullable().optional(),
  })
  .transform(toFormData);

// Minimal schema for quick physical person creation
export const physicalPersonQuickCreateSchema = z
  .object({
    fantasyName: createNameSchema(2, 200, "Nome"),
    cpf: z
      .string()
      .min(1, "CPF é obrigatório")
      .regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/, "CPF deve estar no formato 000.000.000-00")
      .refine((val) => isValidCPF(val), { message: "CPF inválido" }),
  })
  .transform(toFormData);

export const physicalPersonUpdateSchema = z
  .object({
    fantasyName: createNameSchema(2, 200, "Nome").optional(),
    cpf: z
      .string()
      .regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/, "CPF deve estar no formato 000.000.000-00")
      .refine((val) => isValidCPF(val), { message: "CPF inválido" })
      .optional(),
    corporateName: z.string().nullable().optional(),
    email: emailSchema.nullable().optional(),
    address: z.string().nullable().optional(),
    addressNumber: z.string().nullable().optional(),
    addressComplement: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: brazilianStateSchema,
    zipCode: z
      .string()
      .regex(/^\d{5}-?\d{3}$/, "CEP inválido")
      .nullable()
      .optional()
      .transform((val) => {
        if (!val) return val;
        // Ensure CEP has the hyphen format
        return val.replace(/^(\d{5})(\d{3})$/, "$1-$2");
      }),
    site: z.string().url("URL inválida").nullable().optional(),
    phones: z.array(phoneSchema).optional(),
    tags: z.array(z.string()).optional(),
    logoId: z.string().uuid("Logo inválido").nullable().optional(),
    // Extra fields for physical persons
    rg: rgSchema,
    birthDate: z.coerce.date().nullable().optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations Schemas
// =====================

export const physicalPersonBatchCreateSchema = z.object({
  physicalPersons: z.array(physicalPersonCreateSchema),
});

export const physicalPersonBatchUpdateSchema = z.object({
  physicalPersons: z
    .array(
      z.object({
        id: z.string().uuid("Pessoa física inválida"),
        data: physicalPersonUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma pessoa física deve ser fornecida"),
});

export const physicalPersonBatchDeleteSchema = z.object({
  physicalPersonIds: z.array(z.string().uuid("Pessoa física inválida")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const physicalPersonQuerySchema = z.object({
  include: physicalPersonIncludeSchema.optional(),
});

// Batch query schema for include parameter
export const physicalPersonBatchQuerySchema = z.object({
  include: physicalPersonIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

export type PhysicalPersonGetManyFormData = z.infer<typeof physicalPersonGetManySchema>;
export type PhysicalPersonGetByIdFormData = z.infer<typeof physicalPersonGetByIdSchema>;
export type PhysicalPersonQueryFormData = z.infer<typeof physicalPersonQuerySchema>;
export type PhysicalPersonBatchQueryFormData = z.infer<typeof physicalPersonBatchQuerySchema>;

export type PhysicalPersonCreateFormData = z.infer<typeof physicalPersonCreateSchema>;
export type PhysicalPersonQuickCreateFormData = z.infer<typeof physicalPersonQuickCreateSchema>;
export type PhysicalPersonUpdateFormData = z.infer<typeof physicalPersonUpdateSchema>;

export type PhysicalPersonBatchCreateFormData = z.infer<typeof physicalPersonBatchCreateSchema>;
export type PhysicalPersonBatchUpdateFormData = z.infer<typeof physicalPersonBatchUpdateSchema>;
export type PhysicalPersonBatchDeleteFormData = z.infer<typeof physicalPersonBatchDeleteSchema>;

export type PhysicalPersonInclude = z.infer<typeof physicalPersonIncludeSchema>;
export type PhysicalPersonOrderBy = z.infer<typeof physicalPersonOrderBySchema>;
export type PhysicalPersonWhere = z.infer<typeof physicalPersonWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapPhysicalPersonToFormData = createMapToFormDataHelper<Customer, PhysicalPersonUpdateFormData>((physicalPerson) => ({
  fantasyName: physicalPerson.fantasyName,
  cpf: physicalPerson.cpf || undefined,
  corporateName: physicalPerson.corporateName,
  email: physicalPerson.email,
  address: physicalPerson.address,
  addressNumber: physicalPerson.addressNumber,
  addressComplement: physicalPerson.addressComplement,
  neighborhood: physicalPerson.neighborhood,
  city: physicalPerson.city,
  state: physicalPerson.state,
  zipCode: physicalPerson.zipCode,
  site: physicalPerson.site,
  phones: physicalPerson.phones,
  tags: physicalPerson.tags,
  logoId: physicalPerson.logoId,
  // Additional physical person fields
  rg: null, // This would come from additional data if available
  birthDate: null, // This would come from additional data if available
}));
