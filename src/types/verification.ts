// packages/types/src/verification.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { SMS_VERIFICATION_TYPE, SMS_VERIFICATION_STATUS, VERIFICATION_TYPE } from '@constants';
import type { User, UserIncludes } from "./user";

// =====================
// Unified Verification Entity Interface
// =====================

export interface Verification extends BaseEntity {
  contact: string; // Email or phone number
  code: string;
  type: SMS_VERIFICATION_TYPE;
  status: SMS_VERIFICATION_STATUS;
  verificationType: VERIFICATION_TYPE; // EMAIL or PHONE
  expiresAt: Date;
  verifiedAt?: Date | null;
  userId?: string | null;
  attempts?: number;

  // Relations
  user?: User;
}

// =====================
// Include Types
// =====================

export interface VerificationIncludes {
  user?: boolean | { include?: UserIncludes };
}

// =====================
// Order By Types
// =====================

export interface VerificationOrderBy {
  contact?: "asc" | "desc";
  type?: "asc" | "desc";
  status?: "asc" | "desc";
  verificationType?: "asc" | "desc";
  createdAt?: "asc" | "desc";
  updatedAt?: "asc" | "desc";
  expiresAt?: "asc" | "desc";
  verifiedAt?: "asc" | "desc";
}

// =====================
// Where Clause Types
// =====================

export interface VerificationWhere {
  // Logical operators
  AND?: VerificationWhere | VerificationWhere[];
  OR?: VerificationWhere[];
  NOT?: VerificationWhere | VerificationWhere[];

  // Fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  contact?:
    | string
    | { equals?: string; not?: string; in?: string[]; notIn?: string[]; contains?: string; startsWith?: string; endsWith?: string; mode?: "default" | "insensitive" };
  code?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  type?: SMS_VERIFICATION_TYPE | { equals?: SMS_VERIFICATION_TYPE; not?: SMS_VERIFICATION_TYPE; in?: SMS_VERIFICATION_TYPE[]; notIn?: SMS_VERIFICATION_TYPE[] };
  status?: SMS_VERIFICATION_STATUS | { equals?: SMS_VERIFICATION_STATUS; not?: SMS_VERIFICATION_STATUS; in?: SMS_VERIFICATION_STATUS[]; notIn?: SMS_VERIFICATION_STATUS[] };
  verificationType?: VERIFICATION_TYPE | { equals?: VERIFICATION_TYPE; not?: VERIFICATION_TYPE; in?: VERIFICATION_TYPE[]; notIn?: VERIFICATION_TYPE[] };
  userId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] } | null;
  attempts?: number | { equals?: number; not?: number; in?: number[]; notIn?: number[]; lt?: number; lte?: number; gt?: number; gte?: number };

  // Date fields
  createdAt?: Date | { equals?: Date; not?: Date; in?: Date[]; notIn?: Date[]; lt?: Date; lte?: Date; gt?: Date; gte?: Date };
  updatedAt?: Date | { equals?: Date; not?: Date; in?: Date[]; notIn?: Date[]; lt?: Date; lte?: Date; gt?: Date; gte?: Date };
  expiresAt?: Date | { equals?: Date; not?: Date; in?: Date[]; notIn?: Date[]; lt?: Date; lte?: Date; gt?: Date; gte?: Date };
  verifiedAt?: Date | { equals?: Date; not?: Date; in?: Date[]; notIn?: Date[]; lt?: Date; lte?: Date; gt?: Date; gte?: Date } | null;

  // Relations
  user?: UserIncludes | null;
}

// =====================
// API Request Types
// =====================

export interface VerificationGetManyParams {
  where?: VerificationWhere;
  include?: VerificationIncludes;
  orderBy?: VerificationOrderBy;
  skip?: number;
  take?: number;
  searchingFor?: string;
}

export interface VerificationGetByIdParams {
  include?: VerificationIncludes;
}

// =====================
// API Response Types
// =====================

export interface VerificationGetManyResponse extends BaseGetManyResponse<Verification> {}
export interface VerificationGetUniqueResponse extends BaseGetUniqueResponse<Verification> {}
export interface VerificationCreateResponse extends BaseCreateResponse<Verification> {}
export interface VerificationUpdateResponse extends BaseUpdateResponse<Verification> {}
export interface VerificationDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Types
// =====================

export interface VerificationBatchCreateResponse extends BaseBatchResponse<Verification> {}
export interface VerificationBatchUpdateResponse extends BaseBatchResponse<Verification> {}
export interface VerificationBatchDeleteResponse extends BaseBatchResponse<Verification> {}

// =====================
// Unified Verification Specific Response Types
// =====================

export interface VerificationRequestResponse {
  success: boolean;
  message: string;
  data?: {
    contact: string;
    verificationType: VERIFICATION_TYPE;
    expiresAt: Date;
    canResendAt?: Date;
  };
}

export interface VerificationCodeResponse {
  success: boolean;
  message: string;
  data?: {
    verified: boolean;
    contact: string;
    verificationType: VERIFICATION_TYPE;
    verifiedAt?: Date;
    user?: {
      id: string;
      name: string;
      email?: string;
      phone?: string;
      verified: boolean;
    };
  };
}

export interface VerificationStatusResponse {
  success: boolean;
  message: string;
  data?: {
    contact: string;
    verificationType: VERIFICATION_TYPE;
    status: SMS_VERIFICATION_STATUS;
    type: SMS_VERIFICATION_TYPE;
    expiresAt?: Date;
    verifiedAt?: Date;
    attemptsRemaining?: number;
  };
}

export interface ResendVerificationResponse {
  success: boolean;
  message: string;
  data?: {
    contact: string;
    verificationType: VERIFICATION_TYPE;
    expiresAt: Date;
    canResendAt?: Date;
    attemptsRemaining?: number;
  };
}

// =====================
// Unified Verification Context Types
// =====================

export interface VerificationContextType {
  // State
  isLoading: boolean;
  isVerifying: boolean;
  isResending: boolean;
  error: string | null;
  contact: string | null;
  verificationType: VERIFICATION_TYPE | null;
  status: SMS_VERIFICATION_STATUS | null;
  expiresAt: Date | null;
  canResendAt: Date | null;
  attemptsRemaining: number;

  // Actions
  requestVerification: (contact: string, verificationType?: VERIFICATION_TYPE) => Promise<void>;
  verifyCode: (contact: string, code: string, verificationType?: VERIFICATION_TYPE) => Promise<boolean>;
  resendCode: (contact: string, verificationType?: VERIFICATION_TYPE) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

// =====================
// Unified Verification Hook Return Types
// =====================

export interface UseVerificationReturn {
  // State
  isLoading: boolean;
  isVerifying: boolean;
  isResending: boolean;
  error: string | null;
  data: VerificationStatusResponse | null;

  // Actions
  requestVerification: (contact: string, verificationType?: VERIFICATION_TYPE) => Promise<VerificationRequestResponse>;
  verifyCode: (contact: string, code: string, verificationType?: VERIFICATION_TYPE) => Promise<VerificationCodeResponse>;
  resendCode: (contact: string, verificationType?: VERIFICATION_TYPE) => Promise<ResendVerificationResponse>;
  getStatus: (contact: string, verificationType?: VERIFICATION_TYPE) => Promise<VerificationStatusResponse>;
  clearError: () => void;
  reset: () => void;
}

// =====================
// Form State Types
// =====================

export interface VerificationFormState {
  contact: string;
  code: string;
  verificationType: VERIFICATION_TYPE;
  isSubmitting: boolean;
  errors: {
    contact?: string;
    code?: string;
    general?: string;
  };
}

// =====================
// Validation Types
// =====================

export interface VerificationValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// =====================
// Timer Types
// =====================

export interface VerificationTimer {
  timeRemaining: number;
  isExpired: boolean;
  isActive: boolean;
  formattedTime: string;
}

// =====================
// Constants for UI
// =====================

export const VERIFICATION_CONSTANTS = {
  CODE_LENGTH: 6,
  EXPIRATION_TIME: 15 * 60 * 1000, // 15 minutes in milliseconds
  RESEND_COOLDOWN: 60 * 1000, // 1 minute in milliseconds
  MAX_ATTEMPTS: 3,
  VALID_CODES: {
    PHONE: "860611", // Phone verification test code
    EMAIL: "123456", // Email verification test code
  },
} as const;

// =====================
// Type Utilities
// =====================

export type VerificationMethod = "email" | "phone";

export interface VerificationConfig {
  method: VerificationMethod;
  contact: string;
  purpose: SMS_VERIFICATION_TYPE;
  expirationMinutes?: number;
  maxAttempts?: number;
  cooldownSeconds?: number;
}

// Helper type for form components
export interface VerificationFormProps {
  contact: string;
  verificationType: VERIFICATION_TYPE;
  purpose: SMS_VERIFICATION_TYPE;
  onSuccess: (response: VerificationCodeResponse) => void;
  onError?: (error: string) => void;
  showResend?: boolean;
  autoFocus?: boolean;
}
