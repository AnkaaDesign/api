import { COLOR_SCHEMA } from '@constants';
import { COLOR_SCHEMA_LABELS } from '@constants';
import {
  isValidEmail,
  isValidBrazilianPhoneEnhanced,
  detectContactMethod,
  validateContactMethod,
  isValidSmsCode,
  isValidEmailToken,
  isValidPasswordResetToken,
  isValidJwtToken,
  validatePasswordStrength,
  validateAuthData,
} from "./validators";

export function getColorSchemaLabel(schema: COLOR_SCHEMA): string {
  return COLOR_SCHEMA_LABELS[schema] || schema;
}

// =====================
// Authentication Helper Functions
// =====================

/**
 * Determines if a login identifier is an email or phone number
 */
export const getAuthIdentifierType = (identifier: string): "email" | "phone" | "unknown" => {
  return detectContactMethod(identifier);
};

/**
 * Validates authentication credentials
 */
export const validateAuthCredentials = (
  identifier: string,
  password: string,
): {
  isValid: boolean;
  errors: string[];
  identifierType?: "email" | "phone";
} => {
  return validateAuthData({
    identifier,
    password,
    type: "login",
  });
};

/**
 * Validates registration data
 */
export const validateRegistrationData = (data: {
  name: string;
  identifier: string;
  password: string;
  confirmPassword?: string;
}): {
  isValid: boolean;
  errors: string[];
  identifierType?: "email" | "phone";
} => {
  const errors: string[] = [];

  // Validate name
  if (!data.name || data.name.trim().length < 2) {
    errors.push("Nome deve ter pelo menos 2 caracteres");
  }

  // Validate identifier and password
  const authValidation = validateAuthData({
    identifier: data.identifier,
    password: data.password,
    type: "register",
  });

  errors.push(...authValidation.errors);

  // Validate password confirmation
  if (data.confirmPassword && data.password !== data.confirmPassword) {
    errors.push("As senhas não coincidem");
  }

  return {
    isValid: errors.length === 0,
    errors,
    identifierType: authValidation.contactMethod,
  };
};

/**
 * Validates password reset request
 */
export const validatePasswordResetRequest = (
  identifier: string,
): {
  isValid: boolean;
  errors: string[];
  identifierType?: "email" | "phone";
} => {
  return validateAuthData({
    identifier,
    type: "reset",
  });
};

/**
 * Validates SMS verification code
 */
export const validateSmsVerification = (
  phone: string,
  code: string,
): {
  isValid: boolean;
  errors: string[];
} => {
  return validateAuthData({
    identifier: phone,
    code,
    type: "verify",
  });
};

/**
 * Validates email verification token
 */
export const validateEmailVerification = (
  token: string,
): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  if (!isValidEmailToken(token)) {
    errors.push("Token de verificação inválido");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Validates password reset token
 */
export const validatePasswordResetToken = (
  token: string,
): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  if (!isValidPasswordResetToken(token)) {
    errors.push("Token de redefinição inválido ou expirado");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Validates JWT token format
 */
export const validateJwtToken = (
  token: string,
): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  if (!isValidJwtToken(token)) {
    errors.push("Token de acesso inválido");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Validates new password with strength requirements
 */
export const validateNewPassword = (
  password: string,
  confirmPassword?: string,
): {
  isValid: boolean;
  errors: string[];
  suggestions: string[];
  score: number;
} => {
  const validation = validatePasswordStrength(password);

  if (confirmPassword && password !== confirmPassword) {
    validation.errors.push("As senhas não coincidem");
  }

  return {
    isValid: validation.isValid && (!confirmPassword || password === confirmPassword),
    errors: validation.errors,
    suggestions: validation.suggestions,
    score: validation.score,
  };
};

/**
 * Checks if contact method is suitable for two-factor authentication
 */
export const isTwoFactorCapable = (identifier: string): boolean => {
  const contactValidation = validateContactMethod(identifier);

  // Both email and phone can be used for 2FA
  return contactValidation.isValid && (contactValidation.type === "email" || contactValidation.type === "phone");
};

/**
 * Gets the preferred two-factor method based on contact type
 */
export const getPreferredTwoFactorMethod = (identifier: string): "email" | "sms" | "none" => {
  const type = detectContactMethod(identifier);

  switch (type) {
    case "email":
      return "email";
    case "phone":
      return "sms";
    default:
      return "none";
  }
};

/**
 * Validates multi-factor authentication setup
 */
export const validateMfaSetup = (data: {
  primaryMethod: string;
  backupMethod?: string;
  phoneNumber?: string;
  email?: string;
}): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  // Validate primary method
  const primaryValidation = validateContactMethod(data.primaryMethod);
  if (!primaryValidation.isValid) {
    errors.push("Método principal inválido");
  }

  // Validate backup method if provided
  if (data.backupMethod) {
    const backupValidation = validateContactMethod(data.backupMethod);
    if (!backupValidation.isValid) {
      errors.push("Método de backup inválido");
    }

    // Ensure backup method is different from primary
    if (data.primaryMethod === data.backupMethod) {
      errors.push("Método de backup deve ser diferente do método principal");
    }
  }

  // Validate phone number if provided
  if (data.phoneNumber && !isValidBrazilianPhoneEnhanced(data.phoneNumber)) {
    errors.push("Número de telefone inválido");
  }

  // Validate email if provided
  if (data.email && !isValidEmail(data.email)) {
    errors.push("Email inválido");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Generates a masked version of contact information for security
 */
export const maskContactInfo = (contact: string): string => {
  const type = detectContactMethod(contact);

  if (type === "email") {
    const [local, domain] = contact.split("@");
    const maskedLocal = local.length > 2 ? local.substring(0, 2) + "*".repeat(local.length - 2) : local;
    return `${maskedLocal}@${domain}`;
  }

  if (type === "phone") {
    const cleaned = contact.replace(/\D/g, "");
    if (cleaned.length >= 10) {
      const areaCode = cleaned.substring(0, 2);
      const lastDigits = cleaned.substring(cleaned.length - 4);
      const masked = "*".repeat(cleaned.length - 6);
      return `(${areaCode}) ${masked}${lastDigits}`;
    }
  }

  return contact.substring(0, 2) + "*".repeat(Math.max(0, contact.length - 4)) + contact.substring(contact.length - 2);
};

/**
 * Validates account recovery data
 */
export const validateAccountRecovery = (data: {
  identifier: string;
  recoveryCode?: string;
  newPassword?: string;
  confirmPassword?: string;
}): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  // Validate identifier
  const identifierValidation = validateContactMethod(data.identifier);
  if (!identifierValidation.isValid) {
    errors.push(...identifierValidation.errors);
  }

  // Validate recovery code if provided
  if (data.recoveryCode && !isValidSmsCode(data.recoveryCode)) {
    errors.push("Código de recuperação inválido");
  }

  // Validate new password if provided
  if (data.newPassword) {
    const passwordValidation = validateNewPassword(data.newPassword, data.confirmPassword);
    if (!passwordValidation.isValid) {
      errors.push(...passwordValidation.errors);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Validates session data
 */
export const validateSession = (data: {
  token: string;
  refreshToken?: string;
  expiresAt?: Date;
}): {
  isValid: boolean;
  errors: string[];
  isExpired: boolean;
} => {
  const errors: string[] = [];
  let isExpired = false;

  // Validate token
  if (!isValidJwtToken(data.token)) {
    errors.push("Token de sessão inválido");
  }

  // Validate refresh token if provided
  if (data.refreshToken && !isValidJwtToken(data.refreshToken)) {
    errors.push("Token de atualização inválido");
  }

  // Check expiration
  if (data.expiresAt) {
    isExpired = new Date() > data.expiresAt;
    if (isExpired) {
      errors.push("Sessão expirada");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    isExpired,
  };
};
