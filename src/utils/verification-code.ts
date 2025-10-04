// packages/utils/src/verification-code.ts

// Browser-compatible crypto for verification code generation
const getCrypto = () => {
  // Check globalThis first (works in Node.js and browsers)
  if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    return globalThis.crypto;
  }

  // Check window for browser environments
  if (typeof globalThis !== "undefined" && (globalThis as any).window && (globalThis as any).window.crypto) {
    return (globalThis as any).window.crypto;
  }

  // Node.js environment - only import when needed
  try {
    const crypto = require("crypto");
    return crypto;
  } catch {
    throw new Error("Crypto not available in this environment");
  }
};

// Cross-platform random bytes function
const getRandomBytes = (size: number): Uint8Array => {
  const crypto = getCrypto();

  if (typeof crypto.getRandomValues === "function") {
    // Browser crypto API
    const array = new Uint8Array(size);
    crypto.getRandomValues(array);
    return array;
  } else if (typeof crypto.randomBytes === "function") {
    // Node.js crypto API
    return new Uint8Array(crypto.randomBytes(size));
  } else {
    throw new Error("No secure random number generator available");
  }
};

// =====================
// Verification Code Generation
// =====================

/**
 * Generates a secure random 6-digit verification code using crypto.randomBytes
 * This provides cryptographically secure random numbers, suitable for security-sensitive operations
 */
export const generateVerificationCode = (): string => {
  // Generate random bytes and convert to numbers
  const bytes = getRandomBytes(4); // 4 bytes gives us enough entropy

  // Convert bytes to number (compatible with both browser and Node.js)
  let randomNumber = 0;
  for (let i = 0; i < 4; i++) {
    randomNumber = (randomNumber << 8) + bytes[i];
  }

  // Ensure randomNumber is positive by using unsigned right shift
  randomNumber = randomNumber >>> 0;

  // Get a 6-digit number (100000 to 999999)
  const code = (randomNumber % 900000) + 100000;

  // Additional safety check to ensure positive number
  if (code < 100000 || code > 999999) {
    console.error("Verification code out of range:", code);
    return "100000"; // Fallback to a valid code
  }

  return code.toString();
};

/**
 * Generates multiple unique verification codes
 * Useful for testing or bulk operations
 */
export const generateMultipleVerificationCodes = (count: number): string[] => {
  const codes = new Set<string>();

  while (codes.size < count) {
    codes.add(generateVerificationCode());
  }

  return Array.from(codes);
};

/**
 * Validates that a verification code has the correct format
 * - Must be exactly 6 digits
 * - Must be numeric only
 * - Must not be all the same digit (e.g., 111111)
 */
export const isValidVerificationCodeFormat = (code: string): boolean => {
  if (!code || typeof code !== "string") {
    return false;
  }

  // Check if it's exactly 6 digits
  if (!/^\d{6}$/.test(code)) {
    return false;
  }

  // Check if it's not all the same digit (security best practice)
  if (/^(\d)\1{5}$/.test(code)) {
    return false;
  }

  return true;
};

/**
 * Sanitizes a verification code input by removing non-numeric characters
 */
export const sanitizeVerificationCode = (input: string): string => {
  return input.replace(/\D/g, "").substring(0, 6);
};

// =====================
// Code Expiration Utilities
// =====================

/**
 * Creates an expiration date for verification codes (default: 10 minutes from now)
 */
export const createVerificationCodeExpiration = (minutes: number = 10): Date => {
  const expiration = new Date();
  expiration.setMinutes(expiration.getMinutes() + minutes);
  return expiration;
};

/**
 * Checks if a verification code has expired
 */
export const isVerificationCodeExpired = (expiresAt: Date | null): boolean => {
  if (!expiresAt) {
    return true; // If no expiration date, consider it expired
  }

  return new Date() > expiresAt;
};

/**
 * Gets the remaining time until code expiration in milliseconds
 */
export const getTimeUntilExpiration = (expiresAt: Date | null): number => {
  if (!expiresAt) {
    return 0;
  }

  const now = new Date();
  const timeRemaining = expiresAt.getTime() - now.getTime();

  return Math.max(0, timeRemaining);
};

/**
 * Formats the remaining time in a human-readable format
 */
export const formatTimeUntilExpiration = (expiresAt: Date | null): string => {
  const timeRemaining = getTimeUntilExpiration(expiresAt);

  if (timeRemaining <= 0) {
    return "Expirado";
  }

  const minutes = Math.floor(timeRemaining / (1000 * 60));
  const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
};

/**
 * Creates a cooldown period for resending verification codes (default: 1 minute)
 */
export const createResendCooldown = (minutes: number = 1): Date => {
  const cooldown = new Date();
  cooldown.setMinutes(cooldown.getMinutes() + minutes);
  return cooldown;
};

/**
 * Checks if the resend cooldown period has passed
 */
export const canResendCode = (lastSentAt: Date | null, cooldownMinutes: number = 1): boolean => {
  if (!lastSentAt) {
    return true; // Can send if never sent before
  }

  const cooldownExpiration = new Date(lastSentAt);
  cooldownExpiration.setMinutes(cooldownExpiration.getMinutes() + cooldownMinutes);

  return new Date() > cooldownExpiration;
};

// =====================
// Security Utilities
// =====================

/**
 * Generates a cryptographically secure random string for additional security
 * Used for internal verification tracking
 */
export const generateSecureToken = (length: number = 32): string => {
  const bytes = getRandomBytes(Math.ceil(length / 2));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .substring(0, length);
};

/**
 * Hashes a verification code for secure storage (optional enhancement)
 * In most cases, verification codes are stored in plain text due to their short lifespan
 */
export const hashVerificationCode = (code: string): string => {
  // For demonstration - in production you might want to use a proper hashing library
  // But for verification codes with short lifespans, plain text storage is often acceptable
  return Buffer.from(code).toString("base64");
};

/**
 * Validates verification code security requirements with standardized error messages
 */
export const validateCodeSecurity = (
  code: string,
): {
  isSecure: boolean;
  issues: string[];
} => {
  const issues: string[] = [];

  if (!isValidVerificationCodeFormat(code)) {
    issues.push(VERIFICATION_ERROR_MESSAGES.INVALID_FORMAT);
  }

  // Check for sequential numbers (123456, 654321)
  const isSequential = /^(?:012345|123456|234567|345678|456789|567890|654321|543210|432109|321098|210987|109876)$/.test(code);
  if (isSequential) {
    issues.push(VERIFICATION_ERROR_MESSAGES.SEQUENTIAL_PATTERN);
  }

  // Check for repeating patterns (121212, 123123)
  const hasPattern = /^(\d{1,3})\1+$/.test(code);
  if (hasPattern) {
    issues.push(VERIFICATION_ERROR_MESSAGES.REPETITIVE_PATTERN);
  }

  return {
    isSecure: issues.length === 0,
    issues,
  };
};

// =====================
// Constants
// =====================

export const VERIFICATION_CODE_CONSTANTS = {
  LENGTH: 6,
  DEFAULT_EXPIRATION_MINUTES: 10,
  DEFAULT_RESEND_COOLDOWN_MINUTES: 1,
  MAX_ATTEMPTS: 3,
  MIN_VALUE: 100000,
  MAX_VALUE: 999999,
} as const;

// =====================
// Error Messages (Portuguese)
// =====================

export const VERIFICATION_ERROR_MESSAGES = {
  // Format validation
  INVALID_FORMAT: "Código deve ter exatamente 6 dígitos",
  INVALID_LENGTH: "Código deve ter 6 dígitos",
  NON_NUMERIC: "Código deve conter apenas números",

  // Security validation
  ALL_SAME_DIGITS: "Código não pode ter todos os dígitos iguais",
  SEQUENTIAL_PATTERN: "Código não pode ser sequencial",
  REPETITIVE_PATTERN: "Código não pode ter padrões repetitivos",

  // Expiration and timing
  CODE_EXPIRED: "Código de verificação expirado",
  CODE_NOT_FOUND: "Código de verificação não encontrado",
  CODE_ALREADY_USED: "Código de verificação já foi utilizado",

  // Verification process
  CODE_MISMATCH: "Código de verificação inválido",
  TOO_MANY_ATTEMPTS: "Muitas tentativas de verificação. Solicite um novo código",
  VERIFICATION_FAILED: "Falha na verificação do código",

  // Resend cooldown
  RESEND_TOO_SOON: "Aguarde antes de solicitar um novo código",
  COOLDOWN_ACTIVE: "Código já enviado recentemente. Aguarde para solicitar novamente",

  // Network and service errors
  SEND_FAILED: "Falha ao enviar código de verificação",
  SERVICE_UNAVAILABLE: "Serviço de verificação temporariamente indisponível",
  RATE_LIMIT_EXCEEDED: "Limite de tentativas excedido. Tente novamente mais tarde",

  // Contact method validation
  INVALID_EMAIL: "Endereço de email inválido",
  INVALID_PHONE: "Número de telefone inválido",
  UNSUPPORTED_CONTACT_METHOD: "Método de contato não suportado",

  // General errors
  VERIFICATION_CANCELLED: "Verificação cancelada",
  UNKNOWN_ERROR: "Erro desconhecido na verificação",
  INVALID_REQUEST: "Solicitação de verificação inválida",
} as const;

// =====================
// Success Messages (Portuguese)
// =====================

export const VERIFICATION_SUCCESS_MESSAGES = {
  CODE_SENT: "Código de verificação enviado com sucesso",
  CODE_VERIFIED: "Código verificado com sucesso",
  EMAIL_VERIFIED: "Email verificado com sucesso",
  PHONE_VERIFIED: "Telefone verificado com sucesso",
  VERIFICATION_COMPLETE: "Verificação concluída com sucesso",
  CODE_RESENT: "Novo código de verificação enviado",
} as const;

// =====================
// Type Definitions
// =====================

export interface VerificationCodeData {
  code: string;
  expiresAt: Date;
  createdAt: Date;
  token?: string; // Optional secure token for tracking
}

export interface VerificationCodeValidation {
  isValid: boolean;
  isExpired: boolean;
  isSecure: boolean;
  errors: string[];
  timeRemaining: number;
}

/**
 * Creates a complete verification code data object
 */
export const createVerificationCodeData = (expirationMinutes: number = VERIFICATION_CODE_CONSTANTS.DEFAULT_EXPIRATION_MINUTES): VerificationCodeData => {
  const code = generateVerificationCode();
  const expiresAt = createVerificationCodeExpiration(expirationMinutes);
  const createdAt = new Date();
  const token = generateSecureToken();

  return {
    code,
    expiresAt,
    createdAt,
    token,
  };
};

/**
 * Validates a verification code comprehensively with standardized error messages
 */
export const validateVerificationCode = (inputCode: string, storedCode: string, expiresAt: Date | null): VerificationCodeValidation => {
  const errors: string[] = [];

  // Basic format validation
  if (!isValidVerificationCodeFormat(inputCode)) {
    errors.push(VERIFICATION_ERROR_MESSAGES.INVALID_FORMAT);
  }

  // Check if expired
  const isExpired = isVerificationCodeExpired(expiresAt);
  if (isExpired) {
    errors.push(VERIFICATION_ERROR_MESSAGES.CODE_EXPIRED);
  }

  // Check if codes match
  const isValid = inputCode === storedCode;
  if (!isValid && !isExpired) {
    errors.push(VERIFICATION_ERROR_MESSAGES.CODE_MISMATCH);
  }

  // Security validation
  const securityValidation = validateCodeSecurity(inputCode);
  if (!securityValidation.isSecure) {
    errors.push(...securityValidation.issues);
  }

  const timeRemaining = getTimeUntilExpiration(expiresAt);

  return {
    isValid: isValid && !isExpired,
    isExpired,
    isSecure: securityValidation.isSecure,
    errors,
    timeRemaining,
  };
};
