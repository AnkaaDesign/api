// packages/schemas/src/customer.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, emailSchema } from "./common";
import type { Customer } from '@types';
import { isValidCPF, isValidCNPJ } from '@utils';

// =====================
// Include Schema Based on Prisma Schema
// =====================

export const customerIncludeSchema = z
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

export const customerOrderBySchema = z
  .union([
    // Single ordering object
    z
      .object({
        id: orderByDirectionSchema.optional(),
        fantasyName: orderByDirectionSchema.optional(),
        cnpj: orderByDirectionSchema.optional(),
        cpf: orderByDirectionSchema.optional(),
        corporateName: orderByDirectionSchema.optional(),
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
          cnpj: orderByDirectionSchema.optional(),
          cpf: orderByDirectionSchema.optional(),
          corporateName: orderByDirectionSchema.optional(),
          email: orderByDirectionSchema.optional(),
          address: orderByDirectionSchema.optional(),
          addressNumber: orderByDirectionSchema.optional(),
          neighborhood: orderByDirectionSchema.optional(),
          city: orderByDirectionSchema.optional(),
          state: orderByDirectionSchema.optional(),
          zipCode: orderByDirectionSchema.optional(),
          site: orderByDirectionSchema.optional(),
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

export const customerWhereSchema: z.ZodType<any> = z
  .object({
    // Boolean operators
    AND: z.array(z.lazy(() => customerWhereSchema)).optional(),
    OR: z.array(z.lazy(() => customerWhereSchema)).optional(),
    NOT: z.lazy(() => customerWhereSchema).optional(),

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

    cnpj: z
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

    cpf: z
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

    corporateName: z
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

const customerFilters = {
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

const customerTransform = (data: any) => {
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

  // Text search (case insensitive)
  if (searchingFor) {
    andConditions.push({
      OR: [
        { fantasyName: { contains: searchingFor, mode: "insensitive" } },
        { corporateName: { contains: searchingFor, mode: "insensitive" } },
        { email: { contains: searchingFor, mode: "insensitive" } },
        { cnpj: { contains: searchingFor } },
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

export const customerGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Direct Prisma clauses
    where: customerWhereSchema.optional(),
    orderBy: customerOrderBySchema.optional(),
    include: customerIncludeSchema.optional(),

    // Convenience filters
    ...customerFilters,

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
  .transform(customerTransform);

// =====================
// GetById Schema
// =====================

export const customerGetByIdSchema = z.object({
  include: customerIncludeSchema.optional(),
  id: z.string().uuid("Cliente inválido"),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const customerCreateSchema = z
  .object({
    fantasyName: z.string().min(1, "Nome fantasia é obrigatório"),
    cnpj: z
      .string()
      .nullable()
      .optional()
      .refine((val) => !val || val === "" || isValidCNPJ(val), { message: "CNPJ inválido" }),
    cpf: z
      .string()
      .nullable()
      .optional()
      .refine((val) => !val || val === "" || isValidCPF(val), { message: "CPF inválido" }),
    corporateName: z.string().nullable().optional(),
    email: emailSchema.nullable().optional(),
    address: z.string().nullable().optional(),
    addressNumber: z.string().nullable().optional(),
    addressComplement: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().length(2, "Estado deve ter 2 caracteres").nullable().optional(),
    zipCode: z.string().nullable().optional(),
    site: z.string().url("URL inválida").nullable().optional(),
    phones: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    logoId: z.string().uuid("Logo inválido").nullable().optional(),
  })
  .transform(toFormData)
  .refine(
    (data) => {
      // At least one document (CNPJ or CPF) must be provided
      return data.cnpj || data.cpf;
    },
    {
      message: "É necessário informar CNPJ ou CPF",
      path: ["cnpj"],
    },
  );

// Minimal schema for quick customer creation (e.g., from combobox)
export const customerQuickCreateSchema = z
  .object({
    fantasyName: z.string().min(1, "Nome fantasia é obrigatório"),
  })
  .transform(toFormData);

export const customerUpdateSchema = z
  .object({
    fantasyName: z.string().min(1, "Nome fantasia é obrigatório").optional(),
    cnpj: z
      .string()
      .nullable()
      .optional()
      .refine((val) => !val || val === "" || isValidCNPJ(val), { message: "CNPJ inválido" }),
    cpf: z
      .string()
      .nullable()
      .optional()
      .refine((val) => !val || val === "" || isValidCPF(val), { message: "CPF inválido" }),
    corporateName: z.string().nullable().optional(),
    email: emailSchema.nullable().optional(),
    address: z.string().nullable().optional(),
    addressNumber: z.string().nullable().optional(),
    addressComplement: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().length(2, "Estado deve ter 2 caracteres").nullable().optional(),
    zipCode: z.string().nullable().optional(),
    site: z.string().url("URL inválida").nullable().optional(),
    phones: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    logoId: z.string().uuid("Logo inválido").nullable().optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations Schemas
// =====================

export const customerBatchCreateSchema = z.object({
  customers: z.array(customerCreateSchema),
});

export const customerBatchUpdateSchema = z.object({
  customers: z
    .array(
      z.object({
        id: z.string().uuid("Cliente inválido"),
        data: customerUpdateSchema,
      }),
    )
    .min(1, "Pelo menos um cliente deve ser fornecido"),
});

export const customerBatchDeleteSchema = z.object({
  customerIds: z.array(z.string().uuid("Cliente inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const customerQuerySchema = z.object({
  include: customerIncludeSchema.optional(),
});

// Batch query schema for include parameter
export const customerBatchQuerySchema = z.object({
  include: customerIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

export type CustomerGetManyFormData = z.infer<typeof customerGetManySchema>;
export type CustomerGetByIdFormData = z.infer<typeof customerGetByIdSchema>;
export type CustomerQueryFormData = z.infer<typeof customerQuerySchema>;
export type CustomerBatchQueryFormData = z.infer<typeof customerBatchQuerySchema>;

export type CustomerCreateFormData = z.infer<typeof customerCreateSchema>;
export type CustomerQuickCreateFormData = z.infer<typeof customerQuickCreateSchema>;
export type CustomerUpdateFormData = z.infer<typeof customerUpdateSchema>;

export type CustomerBatchCreateFormData = z.infer<typeof customerBatchCreateSchema>;
export type CustomerBatchUpdateFormData = z.infer<typeof customerBatchUpdateSchema>;
export type CustomerBatchDeleteFormData = z.infer<typeof customerBatchDeleteSchema>;

export type CustomerInclude = z.infer<typeof customerIncludeSchema>;
export type CustomerOrderBy = z.infer<typeof customerOrderBySchema>;
export type CustomerWhere = z.infer<typeof customerWhereSchema>;

// =====================
// Merge Schema
// =====================

export const customerMergeConflictsSchema = z
  .object({
    // Conflict resolution fields
  })
  .optional();

export const customerMergeSchema = z.object({
  targetCustomerId: z.string().uuid({ message: "ID do cliente principal inválido" }),
  sourceCustomerIds: z
    .array(z.string().uuid({ message: "ID de cliente inválido" }))
    .min(1, { message: "É necessário selecionar pelo menos 1 cliente para mesclar" })
    .max(10, { message: "Máximo de 10 clientes podem ser mesclados por vez" }),
  conflictResolutions: z.record(z.any()).optional(),
});

export type CustomerMergeConflicts = z.infer<typeof customerMergeConflictsSchema>;
export type CustomerMergeFormData = z.infer<typeof customerMergeSchema>;

// =====================
// Helper Functions
// =====================

export const mapCustomerToFormData = createMapToFormDataHelper<Customer, CustomerUpdateFormData>((customer) => ({
  fantasyName: customer.fantasyName,
  cnpj: customer.cnpj,
  cpf: customer.cpf,
  corporateName: customer.corporateName,
  email: customer.email,
  address: customer.address,
  addressNumber: customer.addressNumber,
  addressComplement: customer.addressComplement,
  neighborhood: customer.neighborhood,
  city: customer.city,
  state: customer.state,
  zipCode: customer.zipCode,
  site: customer.site,
  phones: customer.phones,
  tags: customer.tags,
  logoId: customer.logoId,
}));
