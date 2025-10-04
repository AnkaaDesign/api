// packages/schemas/src/deployment.ts

import { z } from "zod";
import {
  DEPLOYMENT_STATUS,
  DEPLOYMENT_ENVIRONMENT,
  DEPLOYMENT_TRIGGER,
} from '@constants';
import {
  orderByDirectionSchema,
  normalizeOrderBy,
} from "./common";

// =====================
// Include Schema
// =====================

export const deploymentIncludeSchema = z
  .object({
    user: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

export type DeploymentInclude = z.infer<typeof deploymentIncludeSchema>;

// =====================
// Where Schema
// =====================

export const deploymentWhereSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([deploymentWhereSchema, z.array(deploymentWhereSchema)]).optional(),
      OR: z.array(deploymentWhereSchema).optional(),
      NOT: z.union([deploymentWhereSchema, z.array(deploymentWhereSchema)]).optional(),

      // Field filters
      id: z.union([z.string(), z.object({ in: z.array(z.string()) })]).optional(),

      commitSha: z
        .union([
          z.string(),
          z.object({
            contains: z.string().optional(),
            startsWith: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      branch: z
        .union([
          z.string(),
          z.object({
            in: z.array(z.string()).optional(),
            contains: z.string().optional(),
            mode: z.enum(["default", "insensitive"]).optional(),
          }),
        ])
        .optional(),

      environment: z
        .union([
          z.nativeEnum(DEPLOYMENT_ENVIRONMENT),
          z.object({
            in: z.array(z.nativeEnum(DEPLOYMENT_ENVIRONMENT)).optional(),
            notIn: z.array(z.nativeEnum(DEPLOYMENT_ENVIRONMENT)).optional(),
          }),
        ])
        .optional(),

      status: z
        .union([
          z.nativeEnum(DEPLOYMENT_STATUS),
          z.object({
            in: z.array(z.nativeEnum(DEPLOYMENT_STATUS)).optional(),
            notIn: z.array(z.nativeEnum(DEPLOYMENT_STATUS)).optional(),
          }),
        ])
        .optional(),

      deployedBy: z
        .union([
          z.string(),
          z.object({
            in: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      createdAt: z
        .object({
          gte: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
        })
        .optional(),

      startedAt: z
        .object({
          gte: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
        })
        .optional(),

      completedAt: z
        .object({
          gte: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
        })
        .optional(),
    })
    .partial(),
);

export type DeploymentWhere = z.infer<typeof deploymentWhereSchema>;

// =====================
// OrderBy Schema
// =====================

export const deploymentOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      environment: orderByDirectionSchema.optional(),
      commitSha: orderByDirectionSchema.optional(),
      branch: orderByDirectionSchema.optional(),
      status: orderByDirectionSchema.optional(),
      statusOrder: orderByDirectionSchema.optional(),
      deployedBy: orderByDirectionSchema.optional(),
      version: orderByDirectionSchema.optional(),
      startedAt: orderByDirectionSchema.optional(),
      completedAt: orderByDirectionSchema.optional(),
      rolledBackAt: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        environment: orderByDirectionSchema.optional(),
        commitSha: orderByDirectionSchema.optional(),
        branch: orderByDirectionSchema.optional(),
        status: orderByDirectionSchema.optional(),
        statusOrder: orderByDirectionSchema.optional(),
        deployedBy: orderByDirectionSchema.optional(),
        version: orderByDirectionSchema.optional(),
        startedAt: orderByDirectionSchema.optional(),
        completedAt: orderByDirectionSchema.optional(),
        rolledBackAt: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      }),
    ),
  ])
  .transform(normalizeOrderBy);

export type DeploymentOrderBy = z.infer<typeof deploymentOrderBySchema>;

// =====================
// Create Schema
// =====================

export const deploymentCreateSchema = z.object({
  environment: z.nativeEnum(DEPLOYMENT_ENVIRONMENT, {
    errorMap: () => ({ message: "Ambiente inválido" }),
  }),

  commitSha: z
    .string()
    .min(7, "Hash do commit deve ter pelo menos 7 caracteres")
    .max(255, "Hash do commit deve ter no máximo 255 caracteres"),

  commitMessage: z
    .string()
    .max(1000, "Mensagem do commit deve ter no máximo 1000 caracteres")
    .optional()
    .nullable(),

  commitAuthor: z
    .string()
    .max(255, "Autor do commit deve ter no máximo 255 caracteres")
    .optional()
    .nullable(),

  branch: z
    .string()
    .min(1, "Branch é obrigatório")
    .max(255, "Branch deve ter no máximo 255 caracteres"),

  triggeredBy: z.nativeEnum(DEPLOYMENT_TRIGGER, {
    errorMap: () => ({ message: "Tipo de gatilho inválido" }),
  }).optional(),

  workflowRunId: z
    .string()
    .max(255, "ID do workflow deve ter no máximo 255 caracteres")
    .optional()
    .nullable(),

  startedAt: z.coerce.date().optional().nullable(),

  version: z.string().max(255).optional().nullable(),
  previousCommit: z.string().max(255).optional().nullable(),
  rollbackData: z.any().optional().nullable(),
  deploymentLog: z.string().optional().nullable(),
  healthCheckUrl: z.string().url("URL inválida").optional().nullable(),
  healthCheckStatus: z.string().max(255).optional().nullable(),
});

export type DeploymentCreateFormData = z.infer<typeof deploymentCreateSchema>;

// =====================
// Update Schema
// =====================

export const deploymentUpdateSchema = z.object({
  status: z.nativeEnum(DEPLOYMENT_STATUS).optional(),

  version: z.string().max(255).optional().nullable(),
  previousCommit: z.string().max(255).optional().nullable(),
  rollbackData: z.any().optional().nullable(),
  deploymentLog: z.string().optional().nullable(),
  healthCheckUrl: z.string().url("URL inválida").optional().nullable(),
  healthCheckStatus: z.string().max(255).optional().nullable(),
  completedAt: z.coerce.date().optional().nullable(),
  rolledBackAt: z.coerce.date().optional().nullable(),
});

export type DeploymentUpdateFormData = z.infer<typeof deploymentUpdateSchema>;

// =====================
// Query Schemas
// =====================

export const deploymentGetManySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),

    where: deploymentWhereSchema.optional(),
    orderBy: deploymentOrderBySchema.optional(),
    include: deploymentIncludeSchema.optional(),

    searchingFor: z.string().optional(),
  })
  .transform((data) => {
    // Transform searchingFor into where clause
    if (data.searchingFor && typeof data.searchingFor === "string") {
      data.where = {
        ...data.where,
        OR: [
          { commitSha: { contains: data.searchingFor, mode: "insensitive" } },
          { branch: { contains: data.searchingFor, mode: "insensitive" } },
          { version: { contains: data.searchingFor, mode: "insensitive" } },
        ],
      };
      delete data.searchingFor;
    }
    return data;
  });

export type DeploymentGetManyFormData = z.infer<typeof deploymentGetManySchema>;

export const deploymentQuerySchema = z.object({
  include: deploymentIncludeSchema.optional(),
});

export type DeploymentQueryFormData = z.infer<typeof deploymentQuerySchema>;

// =====================
// Batch Schemas
// =====================

export const deploymentBatchCreateSchema = z.object({
  deployments: z.array(deploymentCreateSchema).min(1, "Deve incluir pelo menos um deployment").max(50, "Limite máximo de 50 deployments"),
});

export type DeploymentBatchCreateFormData = z.infer<typeof deploymentBatchCreateSchema>;

export const deploymentBatchUpdateSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string().uuid("ID inválido"),
        data: deploymentUpdateSchema,
      }),
    )
    .min(1, "Deve incluir pelo menos uma atualização")
    .max(50, "Limite máximo de 50 atualizações"),
});

export type DeploymentBatchUpdateFormData = z.infer<typeof deploymentBatchUpdateSchema>;

export const deploymentBatchDeleteSchema = z.object({
  ids: z.array(z.string().uuid("ID inválido")).min(1, "Deve incluir pelo menos um ID").max(50, "Limite máximo de 50 IDs"),
});

export type DeploymentBatchDeleteFormData = z.infer<typeof deploymentBatchDeleteSchema>;
