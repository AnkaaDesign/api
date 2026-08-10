import { z } from 'zod';
import { ResponsibleRole } from '@prisma/client';
import { cpfSchema } from './common';

export const responsibleRoleSchema = z.nativeEnum(ResponsibleRole);

/**
 * Canonical order for a responsible's roles: the enum declaration order.
 *
 * Postgres preserves insertion order in an enum array, so ['OWNER','DRIVER']
 * and ['DRIVER','OWNER'] are distinct values that mean the same thing. Without
 * canonicalisation every re-order would be recorded as a real change by the
 * changelog differ (which compares serialized values), producing phantom
 * history entries.
 */
const ROLE_DECLARATION_ORDER = Object.values(ResponsibleRole);

export const normalizeResponsibleRoles = (roles: ResponsibleRole[]): ResponsibleRole[] =>
  [...new Set(roles)].sort(
    (a, b) => ROLE_DECLARATION_ORDER.indexOf(a) - ROLE_DECLARATION_ORDER.indexOf(b),
  );

/**
 * A non-empty, de-duplicated, canonically ordered set of roles.
 *
 * Accepts a bare scalar as well as an array so that clients still on the
 * pre-array contract (notably installed Flutter APKs, which POST
 * `{ role: 'COMMERCIAL' }` on inline contact creation) keep working. Zod is not
 * strict anywhere in this codebase, so without the scalar branch an old
 * client's `role` would be silently stripped and the request would fail with a
 * confusing "roles is required".
 */
export const responsibleRolesSchema = z.preprocess(
  value => (typeof value === 'string' ? [value] : value),
  z
    .array(responsibleRoleSchema)
    .min(1, 'Selecione ao menos uma função')
    .transform(normalizeResponsibleRoles),
);

/**
 * Merges a legacy scalar `role` into `roles` and drops it, so every downstream
 * consumer only ever sees the array. Applied to create/register payloads.
 */
const withLegacyRole = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(value => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const data = value as Record<string, unknown>;
      if (data.roles === undefined && data.role !== undefined) {
        const { role, ...rest } = data;
        return { ...rest, roles: role };
      }
      if (data.role !== undefined) {
        const { role: _role, ...rest } = data;
        return rest;
      }
    }
    return value;
  }, schema);

// E-mail é OPCIONAL em todo o cadastro de responsável. A exigência real não
// mora aqui: quem cobra é a emissão do envelope de assinatura, que recusa
// nominalmente quem está sem endereço ("Responsáveis sem e-mail válido no
// cadastro: ..." em signature-envelope.service) — no momento em que o e-mail
// é de fato usado.
//
// Vazio vira null COMO OS CLIENTES REALMENTE ENVIAM: formulário manda `""`
// para campo em branco, não null. A coluna é `@unique`, então gravar '' faria
// o segundo contato sem e-mail colidir com o primeiro.
//
// `undefined` (chave AUSENTE) tem de continuar `undefined` — é o que distingue
// "não mexi neste campo" de "limpe este campo". Colapsar ausente em null faria
// todo PATCH parcial apagar o e-mail de quem já tinha.
//
// A normalização (trim + lowercase) acontece no preprocess, ANTES do .email().
// Se fosse um `.transform()` depois da validação, " a@b.com " — colado ou vindo
// do autocomplete do teclado — seria recusado pelos espaços antes de chegar a
// ser limpo.
//
// Exportado porque os newResponsibles inline de schemas/task.ts gravam NA MESMA
// coluna e precisam da mesma regra. As duas cópias já nasceram uma vez e
// divergiram; com uma fonte só, não têm como divergir de novo. A mensagem fica
// por conta de quem usa — os dois arquivos escrevem "e-mail" de formas
// diferentes e isso é visível para o usuário.
export const makeOptionalEmailSchema = (invalidMessage: string) =>
  z.preprocess(
    v => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      if (typeof v === 'string') return v.trim().toLowerCase() || null;
      return v;
    },
    z.string().email(invalidMessage).nullable().optional(),
  );

const optionalEmailSchema = makeOptionalEmailSchema('Email inválido');

export const responsibleContactSchema = z.object({
  name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
  phone: z.string().regex(/^\d{10,11}$/, 'Telefone inválido'),
  email: optionalEmailSchema,
});

export const responsibleCreateObjectSchema = z.object({
  name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
  email: optionalEmailSchema, // Optional for contact-only responsibles
  phone: z.string().regex(/^\d{10,11}$/, 'Telefone inválido'),
  // Âncora de identidade da assinatura eletrônica. Opcional: contato sem CPF
  // continua valendo, e a primeira assinatura preenche o campo.
  cpf: cpfSchema.optional().nullable(),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres').optional().nullable(), // Optional if no system access needed
  companyId: z.string().uuid('ID da empresa inválido').optional().nullable(), // Optional - can create responsible without company
  roles: responsibleRolesSchema,
  isActive: z.boolean().optional().default(true),
});

export const responsibleCreateSchema = withLegacyRole(responsibleCreateObjectSchema);

export const responsibleUpdateObjectSchema = z.object({
  name: z.string().min(3).optional(),
  email: optionalEmailSchema,
  cpf: cpfSchema.optional().nullable(),
  phone: z
    .string()
    .regex(/^\d{10,11}$/)
    .optional(),
  // `.optional()` wraps the non-empty rule: "field absent" (no change) and
  // "empty array" (invalid) must stay distinguishable.
  roles: responsibleRolesSchema.optional(),
  isActive: z.boolean().optional(),
  companyId: z.string().uuid().optional().nullable(),
});

export const responsibleUpdateSchema = withLegacyRole(responsibleUpdateObjectSchema);

export const responsibleLoginSchema = z.object({
  contact: z.string().min(1, 'Email ou telefone obrigatório'),
  password: z.string().min(1, 'Senha obrigatória'),
});

export const responsibleRegisterSchema = withLegacyRole(
  z
    .object({
      name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
      email: z.string().email('Email inválido'), // Required for registration
      phone: z.string().regex(/^\d{10,11}$/, 'Telefone inválido'),
      password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'), // Required for registration
      passwordConfirmation: z.string().min(6),
      companyId: z.string().uuid('ID da empresa inválido'),
      roles: responsibleRolesSchema,
      isActive: z.boolean().optional().default(true),
    })
    .refine(data => data.password === data.passwordConfirmation, {
      message: 'Senhas não coincidem',
      path: ['passwordConfirmation'],
    }),
);

export const responsibleIncludeSchema = z.object({
  company: z.boolean().optional(),
  tasks: z.boolean().optional(),
});

// NOTE: `roles` is deliberately absent and must stay that way. Prisma cannot
// orderBy a scalar list, so accepting the key would forward it to Prisma and
// throw a PrismaClientValidationError (a 500, not a 400). Stale bookmarks and
// persisted table layouts still carrying `orderBy: { role: 'asc' }` are
// stripped here, because unknown keys are dropped by Zod.
export const responsibleOrderBySchema = z.object({
  name: z.enum(['asc', 'desc']).optional(),
  createdAt: z.enum(['asc', 'desc']).optional(),
  email: z.enum(['asc', 'desc']).optional(),
});

// Prisma scalar-list filters are { has | hasSome | hasEvery | isEmpty } -- a
// bare enum value would be accepted by Zod and then blow up inside Prisma.
export const responsibleRolesFilterSchema = z.object({
  has: responsibleRoleSchema.optional(),
  hasSome: z.array(responsibleRoleSchema).optional(),
  hasEvery: z.array(responsibleRoleSchema).optional(),
  isEmpty: z.boolean().optional(),
});

export const responsibleWhereSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  name: z.object({ contains: z.string() }).optional(),
  companyId: z.string().uuid().optional(),
  roles: responsibleRolesFilterSchema.optional(),
  isActive: z.boolean().optional(),
  verified: z.boolean().optional(),
});

export const responsibleGetManyObjectSchema = z.object({
  skip: z.coerce.number().optional(),
  take: z.coerce.number().optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  search: z.string().optional(),
  where: responsibleWhereSchema.optional(),
  orderBy: responsibleOrderBySchema.optional(),
  include: responsibleIncludeSchema.optional(),
  // Direct filters (commonly used by frontend). `roles` is any-of (hasSome):
  // pick FINANCIAL + FLEET_MANAGER to list every contact holding either.
  // A bare scalar is coerced so `?roles=OWNER` and legacy `?role=OWNER` work.
  companyId: z.string().uuid().optional(),
  roles: z
    .preprocess(
      value => (typeof value === 'string' ? [value] : value),
      z.array(responsibleRoleSchema).optional(),
    )
    .optional(),
  isActive: z.preprocess(val => {
    if (val === 'true') return true;
    if (val === 'false') return false;
    return val;
  }, z.boolean().optional()),
});

/**
 * Accepts the pre-array query contract for one release: a legacy `?role=OWNER`
 * (or `where[role]=OWNER`) is folded into `roles` / `where.roles.has` instead
 * of reaching Prisma as an invalid scalar-list filter. Anything left over is
 * dropped, so a stale `orderBy[role]` from a bookmark or a persisted table
 * layout self-heals rather than 500-ing.
 */
export const responsibleGetManySchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const data = { ...(value as Record<string, unknown>) };

  if (data.roles === undefined && data.role !== undefined) {
    data.roles = data.role;
  }
  delete data.role;

  if (data.where && typeof data.where === 'object' && !Array.isArray(data.where)) {
    const where = { ...(data.where as Record<string, unknown>) };
    if (where.roles === undefined && typeof where.role === 'string') {
      where.roles = { has: where.role };
    }
    delete where.role;
    data.where = where;
  }

  if (data.orderBy && typeof data.orderBy === 'object' && !Array.isArray(data.orderBy)) {
    const orderBy = { ...(data.orderBy as Record<string, unknown>) };
    delete orderBy.role;
    delete orderBy.roles;
    data.orderBy = orderBy;
  }

  return data;
}, responsibleGetManyObjectSchema);

// The batch endpoints were previously unvalidated, which would let a payload
// through with no roles at all and land an empty array in the database,
// bypassing the ">= 1 role" rule enforced everywhere else.
export const responsibleBatchCreateSchema = z.object({
  responsibles: z.array(responsibleCreateSchema).min(1, 'Informe ao menos um responsável'),
});

export const responsibleBatchUpdateSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string().uuid('ID inválido'),
        data: responsibleUpdateSchema,
      }),
    )
    .min(1, 'Informe ao menos uma atualização'),
});

// Type exports
export type ResponsibleCreateFormData = z.infer<typeof responsibleCreateSchema>;
export type ResponsibleUpdateFormData = z.infer<typeof responsibleUpdateSchema>;
export type ResponsibleLoginFormData = z.infer<typeof responsibleLoginSchema>;
export type ResponsibleRegisterFormData = z.infer<typeof responsibleRegisterSchema>;
