// packages/utils/src/cleaners.ts

export const cleanNumeric = (value: string): string => {
  return value.replace(/\D/g, "");
};

export const cleanCPF = (value: string): string => {
  if (!value || typeof value !== "string") {
    return "";
  }

  const cleaned = cleanNumeric(value);

  // Don't throw error for partial input - just return the cleaned value
  // Validation should be handled by validators, not cleaners
  return cleaned.substring(0, 11); // Limit to 11 digits max
};

export const cleanCNPJ = (value: string): string => {
  if (!value || typeof value !== "string") {
    return "";
  }

  const cleaned = cleanNumeric(value);

  // Don't throw error for partial input - just return the cleaned value
  return cleaned.substring(0, 14); // Limit to 14 digits max
};

export const cleanPhone = (value: string): string => {
  if (!value || typeof value !== "string") {
    return "";
  }

  const cleaned = cleanNumeric(value);

  // Handle empty strings after cleaning
  if (cleaned.length === 0) {
    return "";
  }

  // For partial inputs, just return the cleaned value
  // Don't add country code or throw errors during typing
  return cleaned.substring(0, 11); // Brazilian phones have max 11 digits (without country code)
};

export const cleanPIS = (value: string): string => {
  if (!value || typeof value !== "string") {
    return "";
  }

  const cleaned = cleanNumeric(value);

  // Don't throw error for partial input
  return cleaned.substring(0, 11); // Limit to 11 digits max
};

export const cleanZipCode = (value: string): string => {
  if (!value || typeof value !== "string") {
    return "";
  }
  return cleanNumeric(value);
};

// Alias for Brazilian naming
export const cleanCEP = cleanZipCode;

// =====================
// Enhanced Auth Cleaners
// =====================

/**
 * Cleans and normalizes email addresses
 */
export const cleanEmail = (value: string): string => {
  if (!value || typeof value !== "string") {
    throw new Error("Email é obrigatório");
  }

  const cleaned = value.trim().toLowerCase();

  if (cleaned.length === 0) {
    throw new Error("Email não pode ser vazio");
  }

  if (cleaned.length > 254) {
    throw new Error("Email muito longo");
  }

  return cleaned;
};

/**
 * Cleans SMS verification codes
 */
export const cleanSmsCode = (value: string): string => {
  if (!value || typeof value !== "string") {
    throw new Error("Código SMS é obrigatório");
  }

  const cleaned = value.replace(/\s/g, "");

  if (cleaned.length !== 6) {
    throw new Error("Código SMS deve ter 6 dígitos");
  }

  if (!/^\d{6}$/.test(cleaned)) {
    throw new Error("Código SMS deve conter apenas números");
  }

  return cleaned;
};

/**
 * Cleans OTP codes with configurable length
 */
export const cleanOtpCode = (value: string, length: number = 6): string => {
  if (!value || typeof value !== "string") {
    throw new Error("Código OTP é obrigatório");
  }

  const cleaned = value.replace(/\s/g, "");

  if (cleaned.length !== length) {
    throw new Error(`Código OTP deve ter ${length} dígitos`);
  }

  const regex = new RegExp(`^\\d{${length}}$`);
  if (!regex.test(cleaned)) {
    throw new Error("Código OTP deve conter apenas números");
  }

  return cleaned;
};

/**
 * Cleans email verification tokens
 */
export const cleanEmailToken = (value: string): string => {
  if (!value || typeof value !== "string") {
    throw new Error("Token de verificação é obrigatório");
  }

  const cleaned = value.trim();

  if (cleaned.length < 32 || cleaned.length > 128) {
    throw new Error("Token de verificação inválido");
  }

  if (!/^[a-zA-Z0-9]+$/.test(cleaned)) {
    throw new Error("Token de verificação contém caracteres inválidos");
  }

  return cleaned;
};

/**
 * Cleans password reset tokens
 */
export const cleanPasswordResetToken = (value: string): string => {
  if (!value || typeof value !== "string") {
    throw new Error("Token de redefinição é obrigatório");
  }

  const cleaned = value.trim();

  if (cleaned.length < 64 || cleaned.length > 256) {
    throw new Error("Token de redefinição inválido");
  }

  if (!/^[a-zA-Z0-9]+$/.test(cleaned)) {
    throw new Error("Token de redefinição contém caracteres inválidos");
  }

  return cleaned;
};

/**
 * Cleans and normalizes contact method (email or phone)
 */
export const cleanContactMethod = (value: string): string => {
  if (!value || typeof value !== "string") {
    throw new Error("Email ou telefone é obrigatório");
  }

  const trimmed = value.trim();

  // Check if it's an email
  if (trimmed.includes("@")) {
    return cleanEmail(trimmed);
  }

  // Check if it's a phone number
  const numericOnly = trimmed.replace(/\D/g, "");
  if (numericOnly.length >= 10 && numericOnly.length <= 15) {
    return cleanPhone(trimmed);
  }

  throw new Error("Formato inválido. Digite um email ou telefone válido");
};

/**
 * Cleans passwords by trimming whitespace but preserving internal spaces
 */
export const cleanPassword = (value: string): string => {
  if (!value || typeof value !== "string") {
    throw new Error("Senha é obrigatória");
  }

  // Don't trim internal spaces, only leading/trailing
  const cleaned = value.replace(/^\s+|\s+$/g, "");

  if (cleaned.length === 0) {
    throw new Error("Senha não pode ser vazia");
  }

  if (cleaned.length < 8) {
    throw new Error("Senha deve ter pelo menos 8 caracteres");
  }

  if (cleaned.length > 128) {
    throw new Error("Senha muito longa");
  }

  return cleaned;
};

/**
 * Cleans CNH (Carteira Nacional de Habilitação) number
 */
export const cleanCNH = (value: string): string => {
  if (!value || typeof value !== "string") {
    return "";
  }

  const cleaned = cleanNumeric(value);

  // For partial inputs during typing, don't throw error
  if (cleaned.length > 0 && cleaned.length !== 11) {
    return cleaned;
  }

  return cleaned;
};
