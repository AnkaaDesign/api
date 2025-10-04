// packages/utils/src/verification-errors.ts

import {
  VERIFICATION_ERROR_CODE,
  VERIFICATION_ERROR_SEVERITY,
  VERIFICATION_ERROR_CATEGORY,
} from '@constants';

export interface VerificationErrorDetails {
  code: VERIFICATION_ERROR_CODE;
  category: VERIFICATION_ERROR_CATEGORY;
  severity: VERIFICATION_ERROR_SEVERITY;
  userMessage: string;
  technicalMessage: string;
  suggestedActions: string[];
  retryable: boolean;
  retryAfter?: number; // milliseconds
  helpUrl?: string;
  progressiveMessage?: string; // Used for progressive error disclosure
}

export interface VerificationErrorContext {
  contact?: string;
  verificationType?: string;
  attemptCount?: number;
  lastAttemptTime?: Date;
  ipAddress?: string;
  userAgent?: string;
  retryAfter?: number;
}

// Error mapping configuration
export const VERIFICATION_ERROR_CONFIG: Record<VERIFICATION_ERROR_CODE, Omit<VerificationErrorDetails, "code">> = {
  // Request validation errors
  [VERIFICATION_ERROR_CODE.INVALID_CONTACT]: {
    category: VERIFICATION_ERROR_CATEGORY.VALIDATION,
    severity: VERIFICATION_ERROR_SEVERITY.MEDIUM,
    userMessage: "O contato fornecido não é válido. Verifique se o e-mail ou telefone está correto.",
    technicalMessage: "Invalid contact format provided",
    suggestedActions: [
      "Verifique se o e-mail está no formato correto (exemplo@dominio.com)",
      "Verifique se o telefone está no formato correto (+55 11 99999-9999)",
      "Certifique-se de que não há espaços extras no início ou fim",
    ],
    retryable: true,
    progressiveMessage: "Formato inválido",
  },

  [VERIFICATION_ERROR_CODE.CONTACT_REQUIRED]: {
    category: VERIFICATION_ERROR_CATEGORY.VALIDATION,
    severity: VERIFICATION_ERROR_SEVERITY.MEDIUM,
    userMessage: "É necessário fornecer um e-mail ou telefone para verificação.",
    technicalMessage: "Contact field is required",
    suggestedActions: ["Insira seu e-mail ou telefone", "Verifique se o campo não está vazio"],
    retryable: true,
    progressiveMessage: "Campo obrigatório",
  },

  [VERIFICATION_ERROR_CODE.CODE_REQUIRED]: {
    category: VERIFICATION_ERROR_CATEGORY.VALIDATION,
    severity: VERIFICATION_ERROR_SEVERITY.MEDIUM,
    userMessage: "É necessário inserir o código de verificação.",
    technicalMessage: "Verification code is required",
    suggestedActions: ["Insira o código de 6 dígitos recebido", "Verifique se não há espaços no código"],
    retryable: true,
    progressiveMessage: "Código necessário",
  },

  [VERIFICATION_ERROR_CODE.INVALID_CONTACT_FORMAT]: {
    category: VERIFICATION_ERROR_CATEGORY.VALIDATION,
    severity: VERIFICATION_ERROR_SEVERITY.MEDIUM,
    userMessage: "O formato do contato não é válido. Use um e-mail ou telefone válido.",
    technicalMessage: "Contact format validation failed",
    suggestedActions: ["Para e-mail: use o formato exemplo@dominio.com", "Para telefone: use o formato +55 11 99999-9999 ou (11) 99999-9999"],
    retryable: true,
    progressiveMessage: "Formato incorreto",
  },

  // User-related errors
  [VERIFICATION_ERROR_CODE.USER_NOT_FOUND]: {
    category: VERIFICATION_ERROR_CATEGORY.AUTHENTICATION,
    severity: VERIFICATION_ERROR_SEVERITY.HIGH,
    userMessage: "Não encontramos uma conta associada a este contato. Verifique se o e-mail ou telefone está correto.",
    technicalMessage: "User not found for the provided contact",
    suggestedActions: ["Verifique se o e-mail ou telefone está correto", "Certifique-se de que você já possui uma conta", "Entre em contato com o suporte se precisar de ajuda"],
    retryable: true,
    progressiveMessage: "Conta não encontrada",
  },

  [VERIFICATION_ERROR_CODE.USER_ALREADY_VERIFIED]: {
    category: VERIFICATION_ERROR_CATEGORY.AUTHENTICATION,
    severity: VERIFICATION_ERROR_SEVERITY.LOW,
    userMessage: "Sua conta já está verificada! Você pode fazer login normalmente.",
    technicalMessage: "User account is already verified",
    suggestedActions: ["Tente fazer login com suas credenciais", "Se esqueceu a senha, use a opção 'Esqueci minha senha'"],
    retryable: false,
    progressiveMessage: "Já verificado",
  },

  [VERIFICATION_ERROR_CODE.USER_INACTIVE]: {
    category: VERIFICATION_ERROR_CATEGORY.AUTHENTICATION,
    severity: VERIFICATION_ERROR_SEVERITY.HIGH,
    userMessage: "Sua conta está inativa. Entre em contato com o suporte para reativá-la.",
    technicalMessage: "User account is inactive",
    suggestedActions: ["Entre em contato com o suporte", "Forneça seu e-mail ou telefone ao suporte para assistência"],
    retryable: false,
    progressiveMessage: "Conta inativa",
  },

  // Code validation errors
  [VERIFICATION_ERROR_CODE.INVALID_CODE]: {
    category: VERIFICATION_ERROR_CATEGORY.AUTHENTICATION,
    severity: VERIFICATION_ERROR_SEVERITY.MEDIUM,
    userMessage: "O código de verificação está incorreto. Verifique e tente novamente.",
    technicalMessage: "Verification code does not match",
    suggestedActions: ["Verifique se digitou o código corretamente", "Certifique-se de usar o código mais recente", "Se o código expirou, solicite um novo"],
    retryable: true,
    progressiveMessage: "Código incorreto",
  },

  [VERIFICATION_ERROR_CODE.CODE_EXPIRED]: {
    category: VERIFICATION_ERROR_CATEGORY.AUTHENTICATION,
    severity: VERIFICATION_ERROR_SEVERITY.MEDIUM,
    userMessage: "O código de verificação expirou. Solicite um novo código para continuar.",
    technicalMessage: "Verification code has expired",
    suggestedActions: ["Clique em 'Reenviar código' para receber um novo", "Use o novo código dentro de 10 minutos"],
    retryable: true,
    progressiveMessage: "Código expirado",
  },

  [VERIFICATION_ERROR_CODE.NO_CODE_SENT]: {
    category: VERIFICATION_ERROR_CATEGORY.AUTHENTICATION,
    severity: VERIFICATION_ERROR_SEVERITY.MEDIUM,
    userMessage: "Nenhum código foi enviado ainda. Solicite um código de verificação primeiro.",
    technicalMessage: "No verification code has been sent",
    suggestedActions: ["Clique em 'Enviar código' primeiro", "Aguarde receber o código antes de tentar verificar"],
    retryable: true,
    progressiveMessage: "Código não enviado",
  },

  [VERIFICATION_ERROR_CODE.CODE_MISMATCH]: {
    category: VERIFICATION_ERROR_CATEGORY.AUTHENTICATION,
    severity: VERIFICATION_ERROR_SEVERITY.MEDIUM,
    userMessage: "O código não confere com o enviado. Verifique o código e tente novamente.",
    technicalMessage: "Verification code mismatch",
    suggestedActions: ["Verifique cada dígito do código", "Certifique-se de não confundir números similares (0 e O, 1 e l)", "Solicite um novo código se necessário"],
    retryable: true,
    progressiveMessage: "Código não confere",
  },

  // Rate limiting errors
  [VERIFICATION_ERROR_CODE.TOO_MANY_ATTEMPTS]: {
    category: VERIFICATION_ERROR_CATEGORY.RATE_LIMITING,
    severity: VERIFICATION_ERROR_SEVERITY.HIGH,
    userMessage: "Muitas tentativas de verificação. Aguarde alguns minutos antes de tentar novamente.",
    technicalMessage: "Rate limit exceeded for verification attempts",
    suggestedActions: [
      "Aguarde 5 minutos antes de tentar novamente",
      "Certifique-se de usar o código correto na próxima tentativa",
      "Entre em contato com o suporte se continuar tendo problemas",
    ],
    retryable: true,
    retryAfter: 5 * 60 * 1000, // 5 minutes
    progressiveMessage: "Muitas tentativas",
  },

  [VERIFICATION_ERROR_CODE.TOO_MANY_REQUESTS]: {
    category: VERIFICATION_ERROR_CATEGORY.RATE_LIMITING,
    severity: VERIFICATION_ERROR_SEVERITY.HIGH,
    userMessage: "Muitas solicitações de verificação. Aguarde antes de solicitar um novo código.",
    technicalMessage: "Rate limit exceeded for verification requests",
    suggestedActions: ["Aguarde alguns minutos antes de solicitar novo código", "Use o código mais recente que recebeu", "Verifique sua caixa de spam se não recebeu o e-mail"],
    retryable: true,
    retryAfter: 5 * 60 * 1000, // 5 minutes
    progressiveMessage: "Limite excedido",
  },

  [VERIFICATION_ERROR_CODE.CONTACT_COOLDOWN]: {
    category: VERIFICATION_ERROR_CATEGORY.RATE_LIMITING,
    severity: VERIFICATION_ERROR_SEVERITY.MEDIUM,
    userMessage: "Aguarde um pouco antes de tentar novamente. Isso ajuda a manter sua conta segura.",
    technicalMessage: "Contact is in cooldown period",
    suggestedActions: ["Aguarde o tempo indicado", "Use o código que você já recebeu", "Verifique se já não recebeu o código por SMS ou e-mail"],
    retryable: true,
    progressiveMessage: "Aguarde para tentar",
  },

  [VERIFICATION_ERROR_CODE.IP_RATE_LIMITED]: {
    category: VERIFICATION_ERROR_CATEGORY.RATE_LIMITING,
    severity: VERIFICATION_ERROR_SEVERITY.HIGH,
    userMessage: "Muitas tentativas de verificação deste local. Aguarde uma hora antes de tentar novamente.",
    technicalMessage: "IP address rate limit exceeded",
    suggestedActions: ["Aguarde 1 hora antes de tentar novamente", "Tente usar uma conexão de internet diferente", "Entre em contato com o suporte se precisar de ajuda urgente"],
    retryable: true,
    retryAfter: 60 * 60 * 1000, // 1 hour
    progressiveMessage: "IP limitado",
  },

  [VERIFICATION_ERROR_CODE.PROGRESSIVE_DELAY]: {
    category: VERIFICATION_ERROR_CATEGORY.RATE_LIMITING,
    severity: VERIFICATION_ERROR_SEVERITY.MEDIUM,
    userMessage: "Aguarde um momento antes da próxima tentativa. O tempo de espera aumenta a cada tentativa incorreta.",
    technicalMessage: "Progressive delay in effect",
    suggestedActions: ["Aguarde o tempo indicado", "Verifique cuidadosamente o código na próxima tentativa", "Certifique-se de usar o código mais recente"],
    retryable: true,
    progressiveMessage: "Aguarde para tentar",
  },

  // Service errors
  [VERIFICATION_ERROR_CODE.SMS_SEND_FAILED]: {
    category: VERIFICATION_ERROR_CATEGORY.EXTERNAL_SERVICE,
    severity: VERIFICATION_ERROR_SEVERITY.HIGH,
    userMessage: "Não foi possível enviar o SMS. Tente usar verificação por e-mail ou tente novamente mais tarde.",
    technicalMessage: "SMS service failed to send message",
    suggestedActions: [
      "Tente verificação por e-mail como alternativa",
      "Verifique se o número de telefone está correto",
      "Aguarde alguns minutos e tente novamente",
      "Entre em contato com o suporte se o problema persistir",
    ],
    retryable: true,
    retryAfter: 2 * 60 * 1000, // 2 minutes
    progressiveMessage: "Erro no envio de SMS",
  },

  [VERIFICATION_ERROR_CODE.EMAIL_SEND_FAILED]: {
    category: VERIFICATION_ERROR_CATEGORY.EXTERNAL_SERVICE,
    severity: VERIFICATION_ERROR_SEVERITY.HIGH,
    userMessage: "Não foi possível enviar o e-mail. Tente usar verificação por SMS ou tente novamente mais tarde.",
    technicalMessage: "Email service failed to send message",
    suggestedActions: [
      "Tente verificação por SMS como alternativa",
      "Verifique se o e-mail está correto",
      "Aguarde alguns minutos e tente novamente",
      "Verifique sua caixa de spam",
      "Entre em contato com o suporte se o problema persistir",
    ],
    retryable: true,
    retryAfter: 2 * 60 * 1000, // 2 minutes
    progressiveMessage: "Erro no envio de e-mail",
  },

  [VERIFICATION_ERROR_CODE.NOTIFICATION_FAILED]: {
    category: VERIFICATION_ERROR_CATEGORY.EXTERNAL_SERVICE,
    severity: VERIFICATION_ERROR_SEVERITY.MEDIUM,
    userMessage: "Erro ao enviar notificação. Tente novamente ou use um método alternativo.",
    technicalMessage: "Notification service failed",
    suggestedActions: ["Tente novamente em alguns minutos", "Use um método de verificação alternativo", "Entre em contato com o suporte se necessário"],
    retryable: true,
    retryAfter: 1 * 60 * 1000, // 1 minute
    progressiveMessage: "Erro na notificação",
  },

  [VERIFICATION_ERROR_CODE.EXTERNAL_SERVICE_ERROR]: {
    category: VERIFICATION_ERROR_CATEGORY.EXTERNAL_SERVICE,
    severity: VERIFICATION_ERROR_SEVERITY.HIGH,
    userMessage: "Erro temporário no serviço de verificação. Tente novamente em alguns minutos.",
    technicalMessage: "External service error",
    suggestedActions: ["Aguarde alguns minutos e tente novamente", "Tente um método de verificação alternativo", "Entre em contato com o suporte se o problema persistir"],
    retryable: true,
    retryAfter: 5 * 60 * 1000, // 5 minutes
    progressiveMessage: "Serviço indisponível",
  },

  // System errors
  [VERIFICATION_ERROR_CODE.DATABASE_ERROR]: {
    category: VERIFICATION_ERROR_CATEGORY.SYSTEM,
    severity: VERIFICATION_ERROR_SEVERITY.CRITICAL,
    userMessage: "Erro interno do sistema. Nossa equipe foi notificada. Tente novamente em alguns minutos.",
    technicalMessage: "Database operation failed",
    suggestedActions: ["Aguarde alguns minutos e tente novamente", "Entre em contato com o suporte se o problema persistir", "Nossa equipe técnica já foi notificada"],
    retryable: true,
    retryAfter: 5 * 60 * 1000, // 5 minutes
    progressiveMessage: "Erro do sistema",
  },

  [VERIFICATION_ERROR_CODE.CACHE_ERROR]: {
    category: VERIFICATION_ERROR_CATEGORY.SYSTEM,
    severity: VERIFICATION_ERROR_SEVERITY.MEDIUM,
    userMessage: "Erro temporário no sistema. Tente novamente em alguns instantes.",
    technicalMessage: "Cache operation failed",
    suggestedActions: ["Aguarde alguns instantes e tente novamente", "Recarregue a página se necessário"],
    retryable: true,
    retryAfter: 30 * 1000, // 30 seconds
    progressiveMessage: "Erro temporário",
  },

  [VERIFICATION_ERROR_CODE.CONFIGURATION_ERROR]: {
    category: VERIFICATION_ERROR_CATEGORY.SYSTEM,
    severity: VERIFICATION_ERROR_SEVERITY.CRITICAL,
    userMessage: "Erro na configuração do sistema. Nossa equipe técnica foi notificada.",
    technicalMessage: "System configuration error",
    suggestedActions: ["Entre em contato com o suporte", "Nossa equipe técnica já foi notificada", "Tente novamente mais tarde"],
    retryable: false,
    progressiveMessage: "Erro de configuração",
  },

  [VERIFICATION_ERROR_CODE.INTERNAL_ERROR]: {
    category: VERIFICATION_ERROR_CATEGORY.SYSTEM,
    severity: VERIFICATION_ERROR_SEVERITY.CRITICAL,
    userMessage: "Erro interno do sistema. Nossa equipe foi notificada. Tente novamente mais tarde.",
    technicalMessage: "Internal system error",
    suggestedActions: ["Aguarde alguns minutos e tente novamente", "Entre em contato com o suporte se o problema persistir", "Nossa equipe técnica já foi notificada"],
    retryable: true,
    retryAfter: 10 * 60 * 1000, // 10 minutes
    progressiveMessage: "Erro interno",
  },

  // Security errors
  [VERIFICATION_ERROR_CODE.SUSPICIOUS_ACTIVITY]: {
    category: VERIFICATION_ERROR_CATEGORY.SECURITY,
    severity: VERIFICATION_ERROR_SEVERITY.CRITICAL,
    userMessage: "Atividade suspeita detectada. Por segurança, as verificações foram temporariamente bloqueadas.",
    technicalMessage: "Suspicious activity detected",
    suggestedActions: [
      "Entre em contato com o suporte para verificar sua conta",
      "Aguarde 24 horas antes de tentar novamente",
      "Use um dispositivo ou rede diferentes se possível",
    ],
    retryable: false,
    progressiveMessage: "Atividade suspeita",
  },

  [VERIFICATION_ERROR_CODE.BLOCKED_IP]: {
    category: VERIFICATION_ERROR_CATEGORY.SECURITY,
    severity: VERIFICATION_ERROR_SEVERITY.CRITICAL,
    userMessage: "Seu IP foi temporariamente bloqueado por motivos de segurança. Entre em contato com o suporte.",
    technicalMessage: "IP address is blocked",
    suggestedActions: ["Entre em contato com o suporte", "Tente usar uma conexão de internet diferente", "Aguarde 24 horas e tente novamente"],
    retryable: false,
    progressiveMessage: "IP bloqueado",
  },

  [VERIFICATION_ERROR_CODE.BLACKLISTED_CONTACT]: {
    category: VERIFICATION_ERROR_CATEGORY.SECURITY,
    severity: VERIFICATION_ERROR_SEVERITY.HIGH,
    userMessage: "Este contato não pode ser usado para verificação. Entre em contato com o suporte.",
    technicalMessage: "Contact is blacklisted",
    suggestedActions: ["Entre em contato com o suporte", "Use um e-mail ou telefone diferente", "Forneça informações adicionais para verificar sua identidade"],
    retryable: false,
    progressiveMessage: "Contato bloqueado",
  },

  [VERIFICATION_ERROR_CODE.SECURITY_VIOLATION]: {
    category: VERIFICATION_ERROR_CATEGORY.SECURITY,
    severity: VERIFICATION_ERROR_SEVERITY.CRITICAL,
    userMessage: "Violação de segurança detectada. Sua conta foi temporariamente restrita.",
    technicalMessage: "Security violation detected",
    suggestedActions: ["Entre em contato com o suporte imediatamente", "Não tente novamente até falar com o suporte", "Tenha documentos de identificação em mãos"],
    retryable: false,
    progressiveMessage: "Violação de segurança",
  },
};

/**
 * Get detailed error information for a verification error code
 */
export function getVerificationErrorDetails(code: VERIFICATION_ERROR_CODE, context?: VerificationErrorContext): VerificationErrorDetails {
  const config = VERIFICATION_ERROR_CONFIG[code];

  if (!config) {
    return {
      code: VERIFICATION_ERROR_CODE.INTERNAL_ERROR,
      ...VERIFICATION_ERROR_CONFIG[VERIFICATION_ERROR_CODE.INTERNAL_ERROR],
    };
  }

  let retryAfter = config.retryAfter;

  // Override retry time from context if provided
  if (context?.retryAfter) {
    retryAfter = context.retryAfter;
  }

  return {
    code,
    ...config,
    retryAfter,
  };
}

/**
 * Get a user-friendly error message with progressive disclosure
 */
export function getProgressiveErrorMessage(code: VERIFICATION_ERROR_CODE, attemptCount: number = 1, context?: VerificationErrorContext): string {
  const details = getVerificationErrorDetails(code, context);

  // For first attempt, show progressive message (shorter)
  if (attemptCount === 1) {
    return details.progressiveMessage || details.userMessage;
  }

  // For subsequent attempts, show full message
  if (attemptCount === 2) {
    return details.userMessage;
  }

  // For many attempts, show full message with suggestions
  if (attemptCount >= 3) {
    const suggestions = details.suggestedActions.slice(0, 2).join(" • ");
    return `${details.userMessage}\n\nDicas: ${suggestions}`;
  }

  return details.userMessage;
}

/**
 * Get formatted retry time message
 */
export function getRetryTimeMessage(retryAfter: number): string {
  if (retryAfter < 60 * 1000) {
    const seconds = Math.ceil(retryAfter / 1000);
    return `Aguarde ${seconds} segundo${seconds !== 1 ? "s" : ""}`;
  }

  if (retryAfter < 60 * 60 * 1000) {
    const minutes = Math.ceil(retryAfter / (60 * 1000));
    return `Aguarde ${minutes} minuto${minutes !== 1 ? "s" : ""}`;
  }

  const hours = Math.ceil(retryAfter / (60 * 60 * 1000));
  return `Aguarde ${hours} hora${hours !== 1 ? "s" : ""}`;
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(code: VERIFICATION_ERROR_CODE): boolean {
  const config = VERIFICATION_ERROR_CONFIG[code];
  return config?.retryable ?? true;
}

/**
 * Get error category color for UI
 */
export function getErrorCategoryColor(category: VERIFICATION_ERROR_CATEGORY): string {
  switch (category) {
    case VERIFICATION_ERROR_CATEGORY.VALIDATION:
      return "orange";
    case VERIFICATION_ERROR_CATEGORY.AUTHENTICATION:
      return "blue";
    case VERIFICATION_ERROR_CATEGORY.RATE_LIMITING:
      return "yellow";
    case VERIFICATION_ERROR_CATEGORY.EXTERNAL_SERVICE:
      return "purple";
    case VERIFICATION_ERROR_CATEGORY.SYSTEM:
      return "red";
    case VERIFICATION_ERROR_CATEGORY.SECURITY:
      return "darkred";
    default:
      return "gray";
  }
}

/**
 * Get error severity color for UI
 */
export function getErrorSeverityColor(severity: VERIFICATION_ERROR_SEVERITY): string {
  switch (severity) {
    case VERIFICATION_ERROR_SEVERITY.LOW:
      return "green";
    case VERIFICATION_ERROR_SEVERITY.MEDIUM:
      return "orange";
    case VERIFICATION_ERROR_SEVERITY.HIGH:
      return "red";
    case VERIFICATION_ERROR_SEVERITY.CRITICAL:
      return "darkred";
    default:
      return "gray";
  }
}

/**
 * Create a verification error with context
 */
export class VerificationError extends Error {
  public readonly code: VERIFICATION_ERROR_CODE;
  public readonly category: VERIFICATION_ERROR_CATEGORY;
  public readonly severity: VERIFICATION_ERROR_SEVERITY;
  public readonly retryable: boolean;
  public readonly retryAfter?: number;
  public readonly context?: VerificationErrorContext;
  public readonly details: VerificationErrorDetails;

  constructor(code: VERIFICATION_ERROR_CODE, context?: VerificationErrorContext, message?: string) {
    const details = getVerificationErrorDetails(code, context);
    super(message || details.userMessage);

    this.name = "VerificationError";
    this.code = code;
    this.category = details.category;
    this.severity = details.severity;
    this.retryable = details.retryable;
    this.retryAfter = details.retryAfter;
    this.context = context;
    this.details = details;
  }

  /**
   * Get user-friendly message based on attempt count
   */
  getProgressiveMessage(attemptCount: number = 1): string {
    return getProgressiveErrorMessage(this.code, attemptCount, this.context);
  }

  /**
   * Get retry time message if applicable
   */
  getRetryTimeMessage(): string | null {
    if (!this.retryAfter) return null;
    return getRetryTimeMessage(this.retryAfter);
  }

  /**
   * Convert to plain object for logging/serialization
   */
  toObject() {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      severity: this.severity,
      message: this.message,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
      context: this.context,
      timestamp: new Date().toISOString(),
    };
  }
}
