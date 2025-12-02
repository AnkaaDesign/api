import { z } from 'zod';
import { phoneSchema, emailSchema, contactMethodSchema, smsCodeSchema } from './common';
import { USER_STATUS } from '@constants';

// Enhanced helper using the new contact method validation
const contactStringSchema = contactMethodSchema;

// Simple password validation schema - minimum 6 characters
const passwordSchema = z
  .string()
  .min(6, 'Senha deve ter pelo menos 6 caracteres')
  .max(128, 'Senha deve ter no máximo 128 caracteres');

// =====================
// Core Authentication Schemas
// =====================

// Login schema with Portuguese messages
export const signInSchema = z.object({
  contact: contactStringSchema,
  password: passwordSchema,
});

export type SignInFormData = z.infer<typeof signInSchema>;

// Register schema with simple password validation
export const signUpSchema = z
  .object({
    name: z
      .string()
      .min(2, 'Nome deve ter pelo menos 2 caracteres')
      .max(200, 'Nome deve ter no máximo 200 caracteres'),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
  })
  .refine(data => data.email || data.phone, {
    message: 'Email ou telefone é obrigatório',
    path: ['email'], // Show error on email field
  });

export type SignUpFormData = z.infer<typeof signUpSchema>;

// Change password schema
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
    newPassword: passwordSchema,
    confirmNewPassword: z.string(),
  })
  .refine(data => data.newPassword === data.confirmNewPassword, {
    message: 'As senhas não coincidem',
    path: ['confirmNewPassword'],
  });

export type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

// =====================
// Unified 6-Digit Code Verification Schemas
// =====================

// Send verification code schema (unified for email/phone)
export const sendVerificationSchema = z.object({
  contact: contactMethodSchema,
});

export type SendVerificationFormData = z.infer<typeof sendVerificationSchema>;

// Verify 6-digit code schema (unified for email/phone)
export const verifyCodeSchema = z.object({
  contact: contactMethodSchema,
  code: smsCodeSchema,
});

export type VerifyCodeFormData = z.infer<typeof verifyCodeSchema>;

// =====================
// Password Reset Schemas (6-digit codes)
// =====================

// Password reset request schema
export const passwordResetRequestSchema = z.object({
  contact: contactMethodSchema,
});

export type PasswordResetRequestFormData = z.infer<typeof passwordResetRequestSchema>;

// Password reset schema (with 6-digit code)
export const passwordResetSchema = z
  .object({
    contact: contactMethodSchema,
    code: smsCodeSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: 'As senhas não coincidem',
    path: ['confirmPassword'],
  });

export type PasswordResetFormData = z.infer<typeof passwordResetSchema>;

// =====================
// Admin Operations Schemas
// =====================

// Admin toggle user status schema
export const adminToggleUserStatusSchema = z.object({
  userId: z.string().uuid('Usuário inválido'),
  status: z.enum(Object.values(USER_STATUS) as [string, ...string[]], {
    errorMap: () => ({ message: 'Status inválido' }),
  }),
  reason: z.string().min(3, 'Motivo deve ter pelo menos 3 caracteres').optional(),
});

export type AdminToggleUserStatusFormData = z.infer<typeof adminToggleUserStatusSchema>;

// Admin reset user password schema
export const adminResetUserPasswordSchema = z.object({
  userId: z.string().uuid('Usuário inválido'),
  temporaryPassword: passwordSchema,
  requirePasswordChange: z.boolean().default(true),
});

export type AdminResetUserPasswordFormData = z.infer<typeof adminResetUserPasswordSchema>;

// Admin logout user schema
export const adminLogoutUserSchema = z.object({
  userId: z.string().uuid('Usuário inválido'),
  reason: z.string().min(3, 'Motivo deve ter pelo menos 3 caracteres'),
});

export type AdminLogoutUserFormData = z.infer<typeof adminLogoutUserSchema>;

// =====================
// Legacy Compatibility Aliases (deprecated - use unified schemas above)
// =====================

// @deprecated Use sendVerificationSchema instead
export const sendVerificationCodeSchema = sendVerificationSchema;
export type SendVerificationCodeFormData = SendVerificationFormData;

// @deprecated Use sendVerificationSchema instead
export const resendVerificationSchema = sendVerificationSchema;
export type ResendVerificationFormData = SendVerificationFormData;

// @deprecated Use verifyCodeSchema instead
export const smsVerificationSchema = verifyCodeSchema;
export type SmsVerificationFormData = VerifyCodeFormData;

// @deprecated Use passwordResetRequestSchema instead
export const passwordRecoverySchema = passwordResetRequestSchema;
export type PasswordRecoveryFormData = PasswordResetRequestFormData;
