// packages/utils/src/validators.ts

export const isValidCPF = (cpf: string): boolean => {
  if (!cpf) return false;

  const cleaned = cpf.replace(/\D/g, "");

  // Check for correct length and not all same digits
  if (cleaned.length !== 11 || /^(\d)\1{10}$/.test(cleaned)) return false;

  // Calculate first verification digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned[i]) * (10 - i);
  }

  let remainder = sum % 11;
  let digit1 = remainder < 2 ? 0 : 11 - remainder;

  if (digit1 !== parseInt(cleaned[9])) return false;

  // Calculate second verification digit
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleaned[i]) * (11 - i);
  }

  remainder = sum % 11;
  let digit2 = remainder < 2 ? 0 : 11 - remainder;

  return digit2 === parseInt(cleaned[10]);
};

export const isValidCNPJ = (cnpj: string): boolean => {
  if (!cnpj) return false;

  const cleaned = cnpj.replace(/\D/g, "");

  // Check for correct length and not all same digits
  if (cleaned.length !== 14 || /^(\d)\1{13}$/.test(cleaned)) return false;

  // Calculate first verification digit
  let length = 12;
  let numbers = cleaned.substring(0, length);
  let digits = cleaned.substring(length);

  let sum = 0;
  let pos = length - 7;

  for (let i = length; i >= 1; i--) {
    sum += parseInt(numbers.charAt(length - i)) * pos--;
    if (pos < 2) pos = 9;
  }

  let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);

  if (result !== parseInt(digits.charAt(0))) return false;

  // Calculate second verification digit
  length = 13;
  numbers = cleaned.substring(0, length);
  sum = 0;
  pos = length - 7;

  for (let i = length; i >= 1; i--) {
    sum += parseInt(numbers.charAt(length - i)) * pos--;
    if (pos < 2) pos = 9;
  }

  result = sum % 11 < 2 ? 0 : 11 - (sum % 11);

  return result === parseInt(digits.charAt(1));
};

export const isValidPhone = (phone: string): boolean => {
  if (!phone || typeof phone !== "string") {
    return true; // Allow empty phones (they're optional)
  }

  const cleaned = phone.replace(/\D/g, "");

  // Empty string after cleaning is valid (optional field)
  if (cleaned.length === 0) {
    return true;
  }

  // Valid formats:
  // - 10 or 11 digits (without country code)
  // - 12 or 13 digits starting with 55 (with country code)
  if (cleaned.length === 10 || cleaned.length === 11) {
    return true;
  }

  if (cleaned.startsWith("55") && (cleaned.length === 12 || cleaned.length === 13)) {
    return true;
  }

  return false;
};

export const isValidBrazilianPhone = (phone: string): boolean => {
  const cleaned = phone.replace(/\D/g, "");

  // Remove country code if present
  let phoneNumber = cleaned;
  if (cleaned.startsWith("55")) {
    phoneNumber = cleaned.substring(2);
  }

  // Check if it's a valid Brazilian phone number
  if (phoneNumber.length === 11) {
    // Mobile phone: first digit after area code must be 9
    const areaCode = phoneNumber.substring(0, 2);
    const firstDigit = phoneNumber.charAt(2);

    // Valid area codes in Brazil (11-99)
    const validAreaCodes = [
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19", // São Paulo
      "21",
      "22",
      "24", // Rio de Janeiro
      "27",
      "28", // Espírito Santo
      "31",
      "32",
      "33",
      "34",
      "35",
      "37",
      "38", // Minas Gerais
      "41",
      "42",
      "43",
      "44",
      "45",
      "46", // Paraná
      "47",
      "48",
      "49", // Santa Catarina
      "51",
      "53",
      "54",
      "55", // Rio Grande do Sul
      "61", // Distrito Federal
      "62",
      "64", // Goiás
      "63", // Tocantins
      "65",
      "66", // Mato Grosso
      "67", // Mato Grosso do Sul
      "68", // Acre
      "69", // Rondônia
      "71",
      "73",
      "74",
      "75",
      "77", // Bahia
      "79", // Sergipe
      "81",
      "87", // Pernambuco
      "82", // Alagoas
      "83", // Paraíba
      "84", // Rio Grande do Norte
      "85",
      "88", // Ceará
      "86",
      "89", // Piauí
      "91",
      "93",
      "94", // Pará
      "92",
      "97", // Amazonas
      "95", // Roraima
      "96", // Amapá
      "98",
      "99", // Maranhão
    ];

    return validAreaCodes.includes(areaCode) && firstDigit === "9";
  } else if (phoneNumber.length === 10) {
    // Landline phone: first digit after area code must be 2-5
    const areaCode = phoneNumber.substring(0, 2);
    const firstDigit = phoneNumber.charAt(2);

    // Valid area codes and first digit should be 2-5 for landlines
    const validAreaCodes = [
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
      "21",
      "22",
      "24",
      "27",
      "28",
      "31",
      "32",
      "33",
      "34",
      "35",
      "37",
      "38",
      "41",
      "42",
      "43",
      "44",
      "45",
      "46",
      "47",
      "48",
      "49",
      "51",
      "53",
      "54",
      "55",
      "61",
      "62",
      "63",
      "64",
      "65",
      "66",
      "67",
      "68",
      "69",
      "71",
      "73",
      "74",
      "75",
      "77",
      "79",
      "81",
      "82",
      "83",
      "84",
      "85",
      "86",
      "87",
      "88",
      "89",
      "91",
      "92",
      "93",
      "94",
      "95",
      "96",
      "97",
      "98",
      "99",
    ];

    return validAreaCodes.includes(areaCode) && /^[2-5]/.test(firstDigit);
  }

  return false;
};

export const isBrazilianMobilePhone = (phone: string): boolean => {
  const cleaned = phone.replace(/\D/g, "");

  // Remove country code if present
  let phoneNumber = cleaned;
  if (cleaned.startsWith("55")) {
    phoneNumber = cleaned.substring(2);
  }

  // Mobile phones in Brazil have 11 digits and start with 9 after area code
  return phoneNumber.length === 11 && phoneNumber.charAt(2) === "9";
};

export const getBrazilianPhoneType = (phone: string): "mobile" | "landline" | "invalid" => {
  const cleaned = phone.replace(/\D/g, "");

  // Remove country code if present
  let phoneNumber = cleaned;
  if (cleaned.startsWith("55")) {
    phoneNumber = cleaned.substring(2);
  }

  if (phoneNumber.length === 11 && phoneNumber.charAt(2) === "9") {
    return "mobile";
  } else if (phoneNumber.length === 10 && /^[2-5]/.test(phoneNumber.charAt(2))) {
    return "landline";
  }

  return "invalid";
};

// =====================
// Enhanced Email Validation
// =====================

/**
 * Enhanced email validation with comprehensive regex patterns
 * Validates according to RFC 5322 standards with practical limitations
 */
export const isValidEmail = (email: string): boolean => {
  if (!email || typeof email !== "string") {
    return false;
  }

  // Basic length and format checks
  if (email.length > 254 || email.length < 3) {
    return false;
  }

  // Check for multiple @ symbols
  const atSymbolCount = (email.match(/@/g) || []).length;
  if (atSymbolCount !== 1) {
    return false;
  }

  const [localPart, domain] = email.split("@");

  // Validate local part (before @)
  if (!localPart || localPart.length > 64 || localPart.length < 1) {
    return false;
  }

  // Validate domain part (after @)
  if (!domain || domain.length > 253 || domain.length < 3) {
    return false;
  }

  // Enhanced regex for email validation
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  if (!emailRegex.test(email)) {
    return false;
  }

  // Additional checks for common invalid patterns
  if (email.startsWith(".") || email.endsWith(".") || email.includes("..")) {
    return false;
  }

  // Check for valid domain extension
  const domainParts = domain.split(".");
  if (domainParts.length < 2) {
    return false;
  }

  const tld = domainParts[domainParts.length - 1];
  if (tld.length < 2 || !/^[a-zA-Z]+$/.test(tld)) {
    return false;
  }

  return true;
};

/**
 * Validates if email is from a disposable email provider
 * Returns true if email is from a known disposable provider
 */
export const isDisposableEmail = (email: string): boolean => {
  if (!isValidEmail(email)) {
    return false;
  }

  const domain = email.split("@")[1].toLowerCase();

  // Common disposable email domains
  const disposableDomains = [
    "10minutemail.com",
    "guerrillamail.com",
    "mailinator.com",
    "tempmail.org",
    "temp-mail.org",
    "throwaway.email",
    "yopmail.com",
    "maildrop.cc",
    "mohmal.com",
    "sharklasers.com",
    "getnada.com",
    "mail-temporary.com",
    "emkei.cz",
    "fake-mail.ml",
    "tempmailaddress.com",
  ];

  return disposableDomains.includes(domain);
};

/**
 * Validates if email domain has valid MX record (basic check)
 * This is a simplified version - in production, you'd want to use DNS lookup
 */
export const hasValidEmailDomain = (email: string): boolean => {
  if (!isValidEmail(email)) {
    return false;
  }

  const domain = email.split("@")[1].toLowerCase();

  // Common valid domains for basic validation
  const commonValidDomains = [
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "terra.com.br",
    "uol.com.br",
    "globo.com",
    "ig.com.br",
    "bol.com.br",
    "r7.com",
    "zipmail.com.br",
    "click21.com.br",
  ];

  // If it's a common domain, it's valid
  if (commonValidDomains.includes(domain)) {
    return true;
  }

  // Basic domain format validation
  const domainParts = domain.split(".");
  return domainParts.length >= 2 && domainParts.every((part) => part.length > 0);
};

// =====================
// Enhanced Phone Validation
// =====================

/**
 * Enhanced Brazilian phone validation with detailed area code validation
 */
export const isValidBrazilianPhoneEnhanced = (phone: string): boolean => {
  if (!phone || typeof phone !== "string") {
    return false;
  }

  const cleaned = phone.replace(/\D/g, "");

  // Remove country code if present
  let phoneNumber = cleaned;
  if (cleaned.startsWith("55")) {
    phoneNumber = cleaned.substring(2);
  }

  // Must be exactly 10 or 11 digits
  if (phoneNumber.length !== 10 && phoneNumber.length !== 11) {
    return false;
  }

  const areaCode = phoneNumber.substring(0, 2);
  const areaCodeNum = parseInt(areaCode);

  // Valid Brazilian area codes (11-99)
  if (areaCodeNum < 11 || areaCodeNum > 99) {
    return false;
  }

  // Enhanced validation for mobile phones (11 digits)
  if (phoneNumber.length === 11) {
    const firstDigit = phoneNumber.charAt(2);
    // Mobile phones must start with 9
    if (firstDigit !== "9") {
      return false;
    }

    // Second digit for mobile must be 6-9
    const secondDigit = phoneNumber.charAt(3);
    if (!/^[6-9]$/.test(secondDigit)) {
      return false;
    }
  }

  // Enhanced validation for landline phones (10 digits)
  if (phoneNumber.length === 10) {
    const firstDigit = phoneNumber.charAt(2);
    // Landline phones must start with 2-5
    if (!/^[2-5]$/.test(firstDigit)) {
      return false;
    }
  }

  // Check for obviously invalid patterns
  if (/^(\d)\1+$/.test(phoneNumber)) {
    return false; // All same digits
  }

  return true;
};

/**
 * Validates international phone numbers with country code
 */
export const isValidInternationalPhone = (phone: string): boolean => {
  if (!phone || typeof phone !== "string") {
    return false;
  }

  const cleaned = phone.replace(/\D/g, "");

  // International format: country code + number
  if (cleaned.length < 10 || cleaned.length > 15) {
    return false;
  }

  // If it starts with 55, validate as Brazilian
  if (cleaned.startsWith("55")) {
    return isValidBrazilianPhoneEnhanced(cleaned);
  }

  // Basic validation for other countries
  // This is a simplified version - in production, you'd want comprehensive country code validation
  const countryCodeRegex = /^[1-9]\d{0,3}/;
  return countryCodeRegex.test(cleaned);
};

// =====================
// Contact Method Detection
// =====================

/**
 * Detects if input is an email or phone number
 * Returns 'email', 'phone', or 'unknown'
 */
export const detectContactMethod = (input: string): "email" | "phone" | "unknown" => {
  if (!input || typeof input !== "string") {
    return "unknown";
  }

  const trimmed = input.trim();

  // Check if it contains @ symbol (likely email)
  if (trimmed.includes("@")) {
    return isValidEmail(trimmed) ? "email" : "unknown";
  }

  // Check if it's mostly numbers (likely phone)
  const numericOnly = trimmed.replace(/\D/g, "");
  if (numericOnly.length >= 10 && numericOnly.length <= 15) {
    return isValidBrazilianPhoneEnhanced(trimmed) || isValidInternationalPhone(trimmed) ? "phone" : "unknown";
  }

  return "unknown";
};

/**
 * Validates if input is a valid contact method (email or phone)
 */
export const isValidContactMethod = (input: string): boolean => {
  return detectContactMethod(input) !== "unknown";
};

/**
 * Validates contact method and returns detailed information
 */
export const validateContactMethod = (
  input: string,
): {
  isValid: boolean;
  type: "email" | "phone" | "unknown";
  formatted?: string;
  errors: string[];
} => {
  const errors: string[] = [];

  if (!input || typeof input !== "string") {
    return {
      isValid: false,
      type: "unknown",
      errors: ["Entrada inválida"],
    };
  }

  const trimmed = input.trim();
  const type = detectContactMethod(trimmed);

  if (type === "unknown") {
    errors.push("Formato não reconhecido como email ou telefone");
    return { isValid: false, type, errors };
  }

  if (type === "email") {
    if (!isValidEmail(trimmed)) {
      errors.push("Email inválido");
    }
    if (isDisposableEmail(trimmed)) {
      errors.push("Email temporário não é permitido");
    }
    if (!hasValidEmailDomain(trimmed)) {
      errors.push("Domínio do email inválido");
    }

    return {
      isValid: errors.length === 0,
      type,
      formatted: trimmed.toLowerCase(),
      errors,
    };
  }

  if (type === "phone") {
    if (!isValidBrazilianPhoneEnhanced(trimmed)) {
      errors.push("Número de telefone inválido");
    }

    return {
      isValid: errors.length === 0,
      type,
      formatted: trimmed.replace(/\D/g, ""),
      errors,
    };
  }

  return { isValid: false, type: "unknown", errors: ["Tipo desconhecido"] };
};

// =====================
// SMS/OTP Code Validation
// =====================

/**
 * Validates SMS verification codes
 */
export const isValidSmsCode = (code: string): boolean => {
  if (!code || typeof code !== "string") {
    return false;
  }

  const cleaned = code.replace(/\s/g, "");
  return /^\d{6}$/.test(cleaned);
};

/**
 * Enhanced verification code validation for unified system
 * Validates 6-digit codes with security checks
 */
export const isValidVerificationCode = (code: string): boolean => {
  if (!code || typeof code !== "string") {
    return false;
  }

  const cleaned = code.replace(/\D/g, "");

  // Must be exactly 6 digits
  if (cleaned.length !== 6) {
    return false;
  }

  // Check for obviously invalid patterns
  if (/^(\d)\1{5}$/.test(cleaned)) {
    return false; // All same digits (111111, 222222, etc.)
  }

  // Check for sequential patterns
  const sequential = ["012345", "123456", "234567", "345678", "456789", "567890", "654321", "543210", "432109", "321098", "210987", "109876"];
  if (sequential.includes(cleaned)) {
    return false;
  }

  return true;
};

/**
 * Validates OTP codes (can be 4, 6, or 8 digits)
 */
export const isValidOtpCode = (code: string, length: number = 6): boolean => {
  if (!code || typeof code !== "string") {
    return false;
  }

  const cleaned = code.replace(/\s/g, "");
  const regex = new RegExp(`^\\d{${length}}$`);
  return regex.test(cleaned);
};

/**
 * Validates email verification tokens
 */
export const isValidEmailToken = (token: string): boolean => {
  if (!token || typeof token !== "string") {
    return false;
  }

  // Basic token validation - should be alphanumeric and reasonable length
  return /^[a-zA-Z0-9]{32,128}$/.test(token);
};

/**
 * Validates password reset tokens
 */
export const isValidPasswordResetToken = (token: string): boolean => {
  if (!token || typeof token !== "string") {
    return false;
  }

  // Password reset tokens should be longer and more secure
  return /^[a-zA-Z0-9]{64,256}$/.test(token);
};

/**
 * Validates JWT tokens (basic format check)
 */
export const isValidJwtToken = (token: string): boolean => {
  if (!token || typeof token !== "string") {
    return false;
  }

  // JWT tokens have 3 parts separated by dots
  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }

  // Each part should be base64url encoded
  const base64urlRegex = /^[A-Za-z0-9_-]+$/;
  return parts.every((part) => base64urlRegex.test(part));
};

// =====================
// Password Validation
// =====================

/**
 * Validates password strength according to security requirements
 */
export const validatePasswordStrength = (
  password: string,
): {
  isValid: boolean;
  score: number; // 0-4 (weak to strong)
  errors: string[];
  suggestions: string[];
} => {
  const errors: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  if (!password || typeof password !== "string") {
    return {
      isValid: false,
      score: 0,
      errors: ["Senha é obrigatória"],
      suggestions: ["Digite uma senha"],
    };
  }

  // Length requirements
  if (password.length < 8) {
    errors.push("Senha deve ter pelo menos 8 caracteres");
  } else if (password.length >= 8) {
    score++;
  }

  if (password.length >= 12) {
    score++;
  }

  // Character requirements
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChars = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  if (!hasLowercase) {
    errors.push("Senha deve conter pelo menos uma letra minúscula");
    suggestions.push("Adicione letras minúsculas");
  }

  if (!hasUppercase) {
    errors.push("Senha deve conter pelo menos uma letra maiúscula");
    suggestions.push("Adicione letras maiúsculas");
  }

  if (!hasNumbers) {
    errors.push("Senha deve conter pelo menos um número");
    suggestions.push("Adicione números");
  }

  if (!hasSpecialChars) {
    suggestions.push("Considere adicionar caracteres especiais para maior segurança");
  } else {
    score++;
  }

  // Common patterns to avoid
  const commonPatterns = [
    /123456/,
    /password/i,
    /admin/i,
    /qwerty/i,
    /(\w)\1{2,}/, // repeated characters
  ];

  if (commonPatterns.some((pattern) => pattern.test(password))) {
    errors.push("Senha contém padrões muito comuns");
    suggestions.push('Evite padrões óbvios como "123456" ou "password"');
    score = Math.max(0, score - 1);
  }

  // Bonus for character diversity
  const charTypes = [hasLowercase, hasUppercase, hasNumbers, hasSpecialChars];
  const diversity = charTypes.filter(Boolean).length;
  if (diversity >= 3) {
    score++;
  }

  return {
    isValid: errors.length === 0,
    score: Math.min(4, score),
    errors,
    suggestions,
  };
};

// =====================
// Comprehensive Auth Validation
// =====================

/**
 * Validates email or phone for authentication
 */
export const isValidAuthIdentifier = (identifier: string): boolean => {
  return isValidContactMethod(identifier);
};

/**
 * Validates authentication data comprehensively for unified verification system
 */
export const validateAuthData = (data: {
  identifier: string;
  password?: string;
  code?: string;
  type: "login" | "register" | "reset" | "verify" | "phone_verify" | "email_verify";
}): {
  isValid: boolean;
  errors: string[];
  contactMethod?: "email" | "phone";
} => {
  const errors: string[] = [];

  // Validate identifier
  const contactValidation = validateContactMethod(data.identifier);
  if (!contactValidation.isValid) {
    errors.push(...contactValidation.errors);
  }

  // Validate password if required
  if (data.type === "login" || data.type === "register") {
    if (!data.password) {
      errors.push("Senha é obrigatória");
    } else {
      const passwordValidation = validatePasswordStrength(data.password);
      if (data.type === "register" && !passwordValidation.isValid) {
        errors.push(...passwordValidation.errors);
      }
    }
  }

  // Validate verification code if required
  if (["verify", "reset", "phone_verify", "email_verify"].includes(data.type)) {
    if (!data.code) {
      errors.push("Código de verificação é obrigatório");
    } else if (!isValidVerificationCode(data.code)) {
      errors.push("Código de verificação inválido - deve ter 6 dígitos e não pode ser sequencial");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    contactMethod: contactValidation.type === "unknown" ? undefined : contactValidation.type,
  };
};

/**
 * Validates verification request data
 */
export const validateVerificationRequest = (data: {
  identifier: string;
  method: "email" | "phone" | "both";
  purpose: "account_verification" | "password_reset" | "login_verification" | "phone_verification" | "email_verification";
}): {
  isValid: boolean;
  errors: string[];
  detectedContactMethod?: "email" | "phone";
} => {
  const errors: string[] = [];

  // Validate identifier
  const contactValidation = validateContactMethod(data.identifier);
  if (!contactValidation.isValid) {
    errors.push(...contactValidation.errors);
  }

  // Validate method compatibility with identifier
  if (contactValidation.isValid) {
    if (data.method === "email" && contactValidation.type !== "email") {
      errors.push("Método de email não compatível com telefone fornecido");
    }
    if (data.method === "phone" && contactValidation.type !== "phone") {
      errors.push("Método de telefone não compatível com email fornecido");
    }
  }

  // Validate purpose-specific requirements
  if (data.purpose === "phone_verification" && contactValidation.type !== "phone") {
    errors.push("Verificação de telefone requer um número de telefone válido");
  }
  if (data.purpose === "email_verification" && contactValidation.type !== "email") {
    errors.push("Verificação de email requer um endereço de email válido");
  }

  return {
    isValid: errors.length === 0,
    errors,
    detectedContactMethod: contactValidation.type === "unknown" ? undefined : contactValidation.type,
  };
};

export const isValidPIS = (pis: string): boolean => {
  const cleaned = pis.replace(/\D/g, "");
  if (cleaned.length !== 11) return false;

  const multipliers = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;

  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleaned[i]) * multipliers[i];
  }

  const remainder = sum % 11;
  const digit = remainder < 2 ? 0 : 11 - remainder;

  return digit === parseInt(cleaned[10]);
};

/**
 * Validates CNH (Carteira Nacional de Habilitação) number
 * Brazilian driver's license number validation
 */
export const isValidCNH = (cnh: string): boolean => {
  const cleaned = cnh.replace(/\D/g, "");

  // CNH must have exactly 11 digits
  if (cleaned.length !== 11) return false;

  // Cannot be all the same digit
  if (/^(\d)\1{10}$/.test(cleaned)) return false;

  // First check digit calculation
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned[i]) * (9 - i);
  }

  let remainder = sum % 11;
  let firstDigit = remainder >= 2 ? 11 - remainder : 0;

  if (firstDigit !== parseInt(cleaned[9])) return false;

  // Second check digit calculation
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleaned[i]) * (i === 9 ? 2 : 9 - i);
  }

  remainder = sum % 11;
  let secondDigit = remainder >= 2 ? 11 - remainder : 0;

  return secondDigit === parseInt(cleaned[10]);
};

/**
 * Validates if a CNH expiry date is still valid
 */
export const isCNHExpired = (expiryDate: Date): boolean => {
  return new Date() > expiryDate;
};

/**
 * Validates if CNH expiry date is within 90 days
 */
export const isCNHExpiringSoon = (expiryDate: Date, daysThreshold: number = 90): boolean => {
  const today = new Date();
  const thresholdDate = new Date();
  thresholdDate.setDate(today.getDate() + daysThreshold);

  return expiryDate <= thresholdDate && expiryDate > today;
};
