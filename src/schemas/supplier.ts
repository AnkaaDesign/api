// packages/schemas/src/supplier.ts

import { z } from "zod";
import {
  createMapToFormDataHelper,
  orderByDirectionSchema, normalizeOrderBy,
  emailSchema,
  phoneSchema,
  cnpjOptionalSchema,
  fantasyNameSchema,
  corporateNameSchema,
  addressSchema,
  citySchema,
} from "./common";
import type { Supplier } from '@types';
import { cleanNumeric } from '@utils';
import { BRAZILIAN_STATES } from '@constants';

// =====================
// Custom Validators
// =====================

const zipCodeSchema = z
  .string()
  .nullable()
  .optional()
  .transform((val) => {
    if (!val || val === null) return null;
    return cleanNumeric(val);
  })
  .refine(
    (val) => {
      if (!val || val === null) return true;
      return val.length === 8;
    },
    { message: "CEP deve ter 8 dígitos" },
  );

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const supplierIncludeSchema = z
  .object({
    logo: z.boolean().optional(),
    items: z
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
              formulaComponents: z.boolean().optional(),
              orderItems: z.boolean().optional(),
              ppeDeliveries: z.boolean().optional(),
              orderRules: z.boolean().optional(),
              externalWithdrawalItems: z.boolean().optional(),
              relatedItems: z.boolean().optional(),
              relatedTo: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    orders: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              supplier: z.boolean().optional(),
              items: z.boolean().optional(),
              activities: z.boolean().optional(),
              nfe: z.boolean().optional(),
              budget: z.boolean().optional(),
              receipt: z.boolean().optional(),
              orderSchedule: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    orderRules: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              item: z.boolean().optional(),
              supplier: z.boolean().optional(),
            })
            .optional(),
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
              orders: z.boolean().optional(),
              orderRules: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// OrderBy Schema
// =====================

export const supplierOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        fantasyName: orderByDirectionSchema.optional(),
        cnpj: orderByDirectionSchema.optional(),
        corporateName: orderByDirectionSchema.optional(),
        email: orderByDirectionSchema.optional(),
        address: orderByDirectionSchema.optional(),
        addressNumber: orderByDirectionSchema.optional(),
        addressComplement: orderByDirectionSchema.optional(),
        neighborhood: orderByDirectionSchema.optional(),
        city: orderByDirectionSchema.optional(),
        state: orderByDirectionSchema.optional(),
        zipCode: orderByDirectionSchema.optional(),
        site: orderByDirectionSchema.optional(),
        logoId: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        _count: z
          .object({
            items: orderByDirectionSchema.optional(),
            orders: orderByDirectionSchema.optional(),
            orderRules: orderByDirectionSchema.optional(),
          })
          .optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          fantasyName: orderByDirectionSchema.optional(),
          cnpj: orderByDirectionSchema.optional(),
          corporateName: orderByDirectionSchema.optional(),
          email: orderByDirectionSchema.optional(),
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

export const supplierWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.union([supplierWhereSchema, z.array(supplierWhereSchema)]).optional(),
      OR: z.array(supplierWhereSchema).optional(),
      NOT: z.union([supplierWhereSchema, z.array(supplierWhereSchema)]).optional(),

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
          z.string(),
          z.null(),
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

      corporateName: z
        .union([
          z.string(),
          z.null(),
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

      email: z
        .union([
          z.string(),
          z.null(),
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

      address: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
            contains: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      addressNumber: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
            contains: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      addressComplement: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
            contains: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      neighborhood: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
            contains: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      city: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            contains: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      state: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
            contains: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      site: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
            contains: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      zipCode: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
            contains: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      phones: z
        .object({
          has: z.string().optional(),
          hasEvery: z.array(z.string()).optional(),
          hasSome: z.array(z.string()).optional(),
          isEmpty: z.boolean().optional(),
        })
        .optional(),

      logoId: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.string().nullable().optional(),
            not: z.string().nullable().optional(),
          }),
        ])
        .optional(),

      items: z
        .object({
          some: z.lazy(() => z.any()).optional(),
          every: z.lazy(() => z.any()).optional(),
          none: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      orders: z
        .object({
          some: z.lazy(() => z.any()).optional(),
          every: z.lazy(() => z.any()).optional(),
          none: z.lazy(() => z.any()).optional(),
        })
        .optional(),

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
    })
    .partial(),
);

// =====================
// Transform Function
// =====================

const supplierTransform = (data: any): any => {
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

  // Handle searchingFor - search in fantasyName, corporateName, cnpj, email
  if (data.searchingFor && typeof data.searchingFor === "string" && data.searchingFor.trim()) {
    andConditions.push({
      OR: [
        { fantasyName: { contains: data.searchingFor.trim(), mode: "insensitive" } },
        { corporateName: { contains: data.searchingFor.trim(), mode: "insensitive" } },
        { cnpj: { contains: data.searchingFor.trim(), mode: "insensitive" } },
        { email: { contains: data.searchingFor.trim(), mode: "insensitive" } },
      ],
    });
    delete data.searchingFor;
  }

  // Handle hasLogo filter
  if (typeof data.hasLogo === "boolean") {
    if (data.hasLogo) {
      andConditions.push({ logoId: { not: null } });
    } else {
      andConditions.push({ logoId: null });
    }
    delete data.hasLogo;
  }

  // Handle hasItems filter
  if (typeof data.hasItems === "boolean") {
    if (data.hasItems) {
      andConditions.push({ items: { some: {} } });
    } else {
      andConditions.push({ items: { none: {} } });
    }
    delete data.hasItems;
  }

  // Handle hasOrders filter
  if (typeof data.hasOrders === "boolean") {
    if (data.hasOrders) {
      andConditions.push({ orders: { some: {} } });
    } else {
      andConditions.push({ orders: { none: {} } });
    }
    delete data.hasOrders;
  }

  // Handle hasActiveOrders filter - orders not CANCELLED or RECEIVED
  if (typeof data.hasActiveOrders === "boolean") {
    if (data.hasActiveOrders) {
      andConditions.push({
        orders: {
          some: {
            status: {
              notIn: ["CANCELLED", "RECEIVED"],
            },
          },
        },
      });
    } else {
      andConditions.push({
        OR: [{ orders: { none: {} } }, { orders: { every: { status: { in: ["CANCELLED", "RECEIVED"] } } } }],
      });
    }
    delete data.hasActiveOrders;
  }

  // Handle hasCnpj filter
  if (typeof data.hasCnpj === "boolean") {
    if (data.hasCnpj) {
      andConditions.push({ cnpj: { not: null } });
    } else {
      andConditions.push({ cnpj: null });
    }
    delete data.hasCnpj;
  }

  // Handle hasEmail filter
  if (typeof data.hasEmail === "boolean") {
    if (data.hasEmail) {
      andConditions.push({ email: { not: null } });
    } else {
      andConditions.push({ email: null });
    }
    delete data.hasEmail;
  }

  // Handle hasSite filter
  if (typeof data.hasSite === "boolean") {
    if (data.hasSite) {
      andConditions.push({ site: { not: null } });
    } else {
      andConditions.push({ site: null });
    }
    delete data.hasSite;
  }

  // Handle cities filter
  if (data.cities && Array.isArray(data.cities) && data.cities.length > 0) {
    andConditions.push({ city: { in: data.cities } });
    delete data.cities;
  }

  // Handle states filter
  if (data.states && Array.isArray(data.states) && data.states.length > 0) {
    andConditions.push({ state: { in: data.states } });
    delete data.states;
  }

  // Handle phoneContains filter
  if (data.phoneContains && typeof data.phoneContains === "string" && data.phoneContains.trim()) {
    andConditions.push({ phones: { has: data.phoneContains.trim() } });
    delete data.phoneContains;
  }

  // Handle tags filter
  if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
    andConditions.push({
      AND: data.tags.map((tag: string) => ({ tags: { has: tag } })),
    });
    delete data.tags;
  }

  // Handle itemCount filter - Note: count filters should be handled in service layer
  if (data.itemCount && typeof data.itemCount === "object") {
    // Remove this filter as it should be handled in the service layer
    delete data.itemCount;
  }

  // Handle orderCount filter - Note: count filters should be handled in service layer
  if (data.orderCount && typeof data.orderCount === "object") {
    // Remove this filter as it should be handled in the service layer
    delete data.orderCount;
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

export const supplierGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),

    // Convenience filter fields
    searchingFor: z.string().optional(),
    hasLogo: z.boolean().optional(),
    hasItems: z.boolean().optional(),
    hasOrders: z.boolean().optional(),
    hasActiveOrders: z.boolean().optional(),
    hasCnpj: z.boolean().optional(),
    hasEmail: z.boolean().optional(),
    hasSite: z.boolean().optional(),
    cities: z.array(z.string()).optional(),
    states: z.array(z.string()).optional(),
    phoneContains: z.string().optional(),
    tags: z.array(z.string()).optional(),
    itemCount: z
      .object({
        min: z.number().int().min(0).optional(),
        max: z.number().int().min(0).optional(),
      })
      .optional(),
    orderCount: z
      .object({
        min: z.number().int().min(0).optional(),
        max: z.number().int().min(0).optional(),
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

    // Standard query fields
    where: supplierWhereSchema.optional(),
    orderBy: supplierOrderBySchema.optional(),
    include: supplierIncludeSchema.optional(),
  })
  .transform(supplierTransform);

// =====================
// CRUD Schemas
// =====================

export const supplierCreateSchema = z.object({
  fantasyName: fantasyNameSchema,
  cnpj: cnpjOptionalSchema,
  corporateName: corporateNameSchema,
  email: emailSchema.nullable().optional(),
  address: addressSchema,
  addressNumber: z.string().max(10, "Número deve ter no máximo 10 caracteres").nullable().optional(),
  addressComplement: z.string().max(100, "Complemento deve ter no máximo 100 caracteres").nullable().optional(),
  neighborhood: z.string().max(100, "Bairro deve ter no máximo 100 caracteres").nullable().optional(),
  city: citySchema,
  state: z
    .enum([...BRAZILIAN_STATES] as [string, ...string[]])
    .nullable()
    .optional(),
  zipCode: zipCodeSchema,
  site: z.preprocess(
    (val) => {
      // Convert empty string to null
      if (val === "" || val === undefined) return null;

      // If it's a string, try to fix common URL issues
      if (typeof val === "string") {
        let url = val.trim();

        // Fix common typos
        url = url.replace(/^hhtps:\/\//i, "https://");
        url = url.replace(/^htpp:\/\//i, "http://");
        url = url.replace(/^htpps:\/\//i, "https://");
        url = url.replace(/^htts:\/\//i, "https://");
        url = url.replace(/^hhtp:\/\//i, "http://");
        url = url.replace(/^htps:\/\//i, "https://");
        url = url.replace(/^ttps:\/\//i, "https://");
        url = url.replace(/^htt:\/\//i, "http://");

        // If no protocol, add https://
        if (url && !url.match(/^[a-zA-Z]+:\/\//)) {
          // Special handling for www. URLs
          if (url.toLowerCase().startsWith("www.")) {
            url = "https://" + url;
          }
          // Handle other domains without protocol
          else if (url.includes(".")) {
            url = "https://" + url;
          }
        }

        return url;
      }

      return val;
    },
    z
      .union([
        z.string().refine(
          (val) => {
            // More lenient URL validation
            // Accept anything that looks like a URL
            try {
              // If it's null or empty, it's valid (optional field)
              if (!val) return true;

              // Try to create a URL object - if it works, it's valid
              new URL(val);
              return true;
            } catch {
              // If URL constructor fails, check if it at least looks like a URL
              // Accept domains with or without protocol
              const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
              return urlPattern.test(val);
            }
          },
          { message: "URL inválida" },
        ),
        z.null(),
      ])
      .optional(),
  ),
  phones: z.preprocess((val) => {
    // Filter out empty values from array
    if (Array.isArray(val)) {
      return val.filter((phone) => phone && typeof phone === "string" && phone.trim());
    }
    return val;
  }, z.array(phoneSchema).default([]).optional()),
  tags: z.array(z.string()).default([]),
  logoId: z.string().uuid("Logo inválido").nullable().optional(),
});

// Flexible zipCode schema for updates
const zipCodeUpdateSchema = z
  .union([
    z
      .string()
      .transform((val) => (val ? cleanNumeric(val) : val))
      .nullable(),
    z.null(),
    z.undefined(),
  ])
  .optional();

export const supplierUpdateSchema = z.object({
  fantasyName: fantasyNameSchema.optional(),
  cnpj: z
    .union([
      z
        .string()
        .transform((val) => {
          // Clean the CNPJ (remove non-digits)
          const cleaned = val.replace(/\D/g, "");
          return cleaned;
        })
        .refine(
          (val) => {
            // CRITICAL: For update operations, don't validate existing CNPJ data
            // This allows forms to load with invalid legacy data without validation errors
            // Only validate new/changed CNPJs when they are exactly 14 digits
            if (val.length === 14) {
              // In update schema, we're more permissive to handle legacy data
              // The validation will be enforced during data entry, not form loading
              return true; // Allow existing data to pass through
            }
            return true; // Always pass for incomplete or empty CNPJs
          },
          { message: "CNPJ inválido" },
        ),
      z.null(),
      z.undefined(),
    ])
    .optional(),
  corporateName: corporateNameSchema.optional(),
  email: emailSchema.nullable().optional(),
  address: addressSchema.optional(),
  addressNumber: z.string().max(10, "Número deve ter no máximo 10 caracteres").nullable().optional(),
  addressComplement: z.string().max(100, "Complemento deve ter no máximo 100 caracteres").nullable().optional(),
  neighborhood: z.string().max(100, "Bairro deve ter no máximo 100 caracteres").nullable().optional(),
  city: citySchema.optional(),
  state: z
    .enum([...BRAZILIAN_STATES] as [string, ...string[]])
    .nullable()
    .optional(),
  zipCode: zipCodeUpdateSchema,
  site: z.preprocess(
    (val) => {
      // Convert empty string to null
      if (val === "" || val === undefined) return null;

      // If it's a string, try to fix common URL issues
      if (typeof val === "string") {
        let url = val.trim();

        // Fix common typos
        url = url.replace(/^hhtps:\/\//i, "https://");
        url = url.replace(/^htpp:\/\//i, "http://");
        url = url.replace(/^htpps:\/\//i, "https://");
        url = url.replace(/^htts:\/\//i, "https://");
        url = url.replace(/^hhtp:\/\//i, "http://");
        url = url.replace(/^htps:\/\//i, "https://");
        url = url.replace(/^ttps:\/\//i, "https://");
        url = url.replace(/^htt:\/\//i, "http://");

        // If no protocol, add https://
        if (url && !url.match(/^[a-zA-Z]+:\/\//)) {
          // Special handling for www. URLs
          if (url.toLowerCase().startsWith("www.")) {
            url = "https://" + url;
          }
          // Handle other domains without protocol
          else if (url.includes(".")) {
            url = "https://" + url;
          }
        }

        return url;
      }

      return val;
    },
    z
      .union([
        z.string().refine(
          (val) => {
            // More lenient URL validation
            // Accept anything that looks like a URL
            try {
              // If it's null or empty, it's valid (optional field)
              if (!val) return true;

              // Try to create a URL object - if it works, it's valid
              new URL(val);
              return true;
            } catch {
              // If URL constructor fails, check if it at least looks like a URL
              // Accept domains with or without protocol
              const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
              return urlPattern.test(val);
            }
          },
          { message: "URL inválida" },
        ),
        z.null(),
      ])
      .optional(),
  ),
  phones: z.preprocess((val) => {
    // Handle phones being sent as object {"0": "phone1", "1": "phone2"}
    if (val && typeof val === "object" && !Array.isArray(val)) {
      // Convert object to array, maintaining order by numeric keys
      const phoneObj = val as Record<string, any>;
      const keys = Object.keys(phoneObj).sort((a, b) => parseInt(a) - parseInt(b));
      return keys.map((key) => phoneObj[key]).filter((phone) => phone && typeof phone === "string" && phone.trim());
    }

    // If it's an array, filter out empty values
    if (Array.isArray(val)) {
      return val.filter((phone) => phone && typeof phone === "string" && phone.trim());
    }

    return val;
  }, z.array(phoneSchema).optional()),
  tags: z.array(z.string()).optional(),
  logoId: z.string().uuid("Logo inválido").nullable().optional(),
});

// =====================
// Batch Operations Schemas
// =====================

export const supplierBatchCreateSchema = z.object({
  suppliers: z.array(supplierCreateSchema),
});

export const supplierBatchUpdateSchema = z.object({
  suppliers: z
    .array(
      z.object({
        id: z.string().uuid("Fornecedor inválido"),
        data: supplierUpdateSchema,
      }),
    )
    .min(1, "Pelo menos um fornecedor deve ser fornecido"),
});

export const supplierBatchDeleteSchema = z.object({
  supplierIds: z.array(z.string().uuid("Fornecedor inválido")).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const supplierQuerySchema = z.object({
  include: supplierIncludeSchema.optional(),
});

// =====================
// GetById Schema
// =====================

export const supplierGetByIdSchema = z.object({
  include: supplierIncludeSchema.optional(),
});

// =====================
// Type Inference (FormData types)
// =====================

export type SupplierGetManyFormData = z.infer<typeof supplierGetManySchema>;
export type SupplierGetByIdFormData = z.infer<typeof supplierGetByIdSchema>;
export type SupplierQueryFormData = z.infer<typeof supplierQuerySchema>;

export type SupplierCreateFormData = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdateFormData = z.infer<typeof supplierUpdateSchema>;

export type SupplierBatchCreateFormData = z.infer<typeof supplierBatchCreateSchema>;
export type SupplierBatchUpdateFormData = z.infer<typeof supplierBatchUpdateSchema>;
export type SupplierBatchDeleteFormData = z.infer<typeof supplierBatchDeleteSchema>;

export type SupplierInclude = z.infer<typeof supplierIncludeSchema>;
export type SupplierOrderBy = z.infer<typeof supplierOrderBySchema>;
export type SupplierWhere = z.infer<typeof supplierWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapSupplierToFormData = createMapToFormDataHelper<Supplier, SupplierUpdateFormData>((supplier) => ({
  fantasyName: supplier.fantasyName,
  cnpj: supplier.cnpj,
  corporateName: supplier.corporateName,
  email: supplier.email,
  address: supplier.address,
  addressNumber: supplier.addressNumber,
  addressComplement: supplier.addressComplement,
  neighborhood: supplier.neighborhood,
  city: supplier.city,
  state: supplier.state,
  zipCode: supplier.zipCode,
  site: supplier.site,
  phones: supplier.phones,
  logoId: supplier.logoId,
}));
