import { z } from 'zod';
import { RepresentativeRole } from '@prisma/client';

export const representativeRoleSchema = z.nativeEnum(RepresentativeRole);

export const representativeContactSchema = z.object({
  name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
  phone: z.string().regex(/^\d{10,11}$/, 'Telefone inválido'),
  email: z.string().email('Email inválido').optional().nullable(),
});

export const representativeCreateSchema = z.object({
  name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
  email: z.string().email('Email inválido').optional(), // Optional for contact-only representatives
  phone: z.string().regex(/^\d{10,11}$/, 'Telefone inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres').optional(), // Optional if no system access needed
  customerId: z.string().uuid('ID do cliente inválido').optional().nullable(), // Optional - can create representative without customer
  role: representativeRoleSchema,
  isActive: z.boolean().optional().default(true),
});

export const representativeUpdateSchema = z.object({
  name: z.string().min(3).optional(),
  email: z.string().email().optional().nullable(),
  phone: z
    .string()
    .regex(/^\d{10,11}$/)
    .optional(),
  role: representativeRoleSchema.optional(),
  isActive: z.boolean().optional(),
  customerId: z.string().uuid().optional().nullable(),
});

export const representativeLoginSchema = z.object({
  contact: z.string().min(1, 'Email ou telefone obrigatório'),
  password: z.string().min(1, 'Senha obrigatória'),
});

export const representativeRegisterSchema = z
  .object({
    name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
    email: z.string().email('Email inválido'), // Required for registration
    phone: z.string().regex(/^\d{10,11}$/, 'Telefone inválido'),
    password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'), // Required for registration
    passwordConfirmation: z.string().min(6),
    customerId: z.string().uuid('ID do cliente inválido'),
    role: representativeRoleSchema,
    isActive: z.boolean().optional().default(true),
  })
  .refine(data => data.password === data.passwordConfirmation, {
    message: 'Senhas não coincidem',
    path: ['passwordConfirmation'],
  });

export const representativeIncludeSchema = z.object({
  customer: z.boolean().optional(),
  tasks: z.boolean().optional(),
});

export const representativeOrderBySchema = z.object({
  name: z.enum(['asc', 'desc']).optional(),
  role: z.enum(['asc', 'desc']).optional(),
  createdAt: z.enum(['asc', 'desc']).optional(),
  email: z.enum(['asc', 'desc']).optional(),
});

export const representativeWhereSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  name: z.object({ contains: z.string() }).optional(),
  customerId: z.string().uuid().optional(),
  role: representativeRoleSchema.optional(),
  isActive: z.boolean().optional(),
  verified: z.boolean().optional(),
});

export const representativeGetManySchema = z.object({
  skip: z.coerce.number().optional(),
  take: z.coerce.number().optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  search: z.string().optional(),
  where: representativeWhereSchema.optional(),
  orderBy: representativeOrderBySchema.optional(),
  include: representativeIncludeSchema.optional(),
  // Direct filters (commonly used by frontend)
  customerId: z.string().uuid().optional(),
  role: representativeRoleSchema.optional(),
  isActive: z.preprocess(val => {
    if (val === 'true') return true;
    if (val === 'false') return false;
    return val;
  }, z.boolean().optional()),
});

// Type exports
export type RepresentativeCreateFormData = z.infer<typeof representativeCreateSchema>;
export type RepresentativeUpdateFormData = z.infer<typeof representativeUpdateSchema>;
export type RepresentativeLoginFormData = z.infer<typeof representativeLoginSchema>;
export type RepresentativeRegisterFormData = z.infer<typeof representativeRegisterSchema>;
