import { z } from 'zod';

export const GovbrEnvironmentSchema = z.enum(['staging', 'production']);
export type GovbrEnvironment = z.infer<typeof GovbrEnvironmentSchema>;

export const SignDocumentRequestSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  hashBase64: z.string().min(1, 'Document hash is required'),
  environment: GovbrEnvironmentSchema.default('staging'),
});
export type SignDocumentRequest = z.infer<typeof SignDocumentRequestSchema>;

export const SignDocumentResponseSchema = z.object({
  signature: z.string(),
  signedAt: z.string(),
});
export type SignDocumentResponse = z.infer<typeof SignDocumentResponseSchema>;

export const GetCertificateRequestSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  environment: GovbrEnvironmentSchema.default('staging'),
});
export type GetCertificateRequest = z.infer<typeof GetCertificateRequestSchema>;

export const GetCertificateResponseSchema = z.object({
  certificate: z.string(),
  subjectDN: z.string().optional(),
  issuerDN: z.string().optional(),
  notBefore: z.string().optional(),
  notAfter: z.string().optional(),
});
export type GetCertificateResponse = z.infer<typeof GetCertificateResponseSchema>;
