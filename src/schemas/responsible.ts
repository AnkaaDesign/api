import { z } from 'zod';
import { ResponsibleRole } from '@prisma/client';

export const responsibleRoleSchema = z.nativeEnum(ResponsibleRole);

export const responsibleContactSchema = z.object({
  name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
  phone: z.string().regex(/^\d{10,11}$/, 'Telefone inválido'),
  email: z.string().email('Email inválido').optional().nullable(),
});

export const responsibleCreateSchema = z.object({
  name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
  email: z.string().email('Email inválido').optional().nullable(), // Optional for contact-only responsibles
  phone: z.string().regex(/^\d{10,11}$/, 'Telefone inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres').optional().nullable(), // Optional if no system access needed
  companyId: z.string().uuid('ID da empresa inválido').optional().nullable(), // Optional - can create responsible without company
  role: responsibleRoleSchema,
  isActive: z.boolean().optional().default(true),
});

export const responsibleUpdateSchema = z.object({
  name: z.string().min(3).optional(),
  email: z.string().email().optional().nullable(),
  phone: z
    .string()
    .regex(/^\d{10,11}$/)
    .optional(),
  role: responsibleRoleSchema.optional(),
  isActive: z.boolean().optional(),
  companyId: z.string().uuid().optional().nullable(),
});

export const responsibleLoginSchema = z.object({
  contact: z.string().min(1, 'Email ou telefone obrigatório'),
  password: z.string().min(1, 'Senha obrigatória'),
});

export const responsibleRegisterSchema = z
  .object({
    name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
    email: z.string().email('Email inválido'), // Required for registration
    phone: z.string().regex(/^\d{10,11}$/, 'Telefone inválido'),
    password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'), // Required for registration
    passwordConfirmation: z.string().min(6),
    companyId: z.string().uuid('ID da empresa inválido'),
    role: responsibleRoleSchema,
    isActive: z.boolean().optional().default(true),
  })
  .refine(data => data.password === data.passwordConfirmation, {
    message: 'Senhas não coincidem',
    path: ['passwordConfirmation'],
  });

export const responsibleIncludeSchema = z.object({
  company: z.boolean().optional(),
  tasks: z.boolean().optional(),
});

export const responsibleOrderBySchema = z.object({
  name: z.enum(['asc', 'desc']).optional(),
  role: z.enum(['asc', 'desc']).optional(),
  createdAt: z.enum(['asc', 'desc']).optional(),
  email: z.enum(['asc', 'desc']).optional(),
});

export const responsibleWhereSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  name: z.object({ contains: z.string() }).optional(),
  companyId: z.string().uuid().optional(),
  role: responsibleRoleSchema.optional(),
  isActive: z.boolean().optional(),
  verified: z.boolean().optional(),
});

export const responsibleGetManySchema = z.object({
  skip: z.coerce.number().optional(),
  take: z.coerce.number().optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  search: z.string().optional(),
  where: responsibleWhereSchema.optional(),
  orderBy: responsibleOrderBySchema.optional(),
  include: responsibleIncludeSchema.optional(),
  // Direct filters (commonly used by frontend)
  companyId: z.string().uuid().optional(),
  role: responsibleRoleSchema.optional(),
  isActive: z.preprocess(val => {
    if (val === 'true') return true;
    if (val === 'false') return false;
    return val;
  }, z.boolean().optional()),
});

// Type exports
export type ResponsibleCreateFormData = z.infer<typeof responsibleCreateSchema>;
export type ResponsibleUpdateFormData = z.infer<typeof responsibleUpdateSchema>;
export type ResponsibleLoginFormData = z.infer<typeof responsibleLoginSchema>;
export type ResponsibleRegisterFormData = z.infer<typeof responsibleRegisterSchema>;
