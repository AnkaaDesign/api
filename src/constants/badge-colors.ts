/**
 * Centralized Badge Color Configuration System
 *
 * This file defines a comprehensive, consistent color mapping for all badges
 * across the Ankaa application, ensuring no color duplication for different
 * statuses and maintaining semantic meaning.
 *
 * Color Philosophy:
 * - Green: Success, completed, positive actions (entry, approved, active)
 * - Red: Failure, cancelled, negative actions (exit, rejected, lost)
 * - Orange/Amber: Warning states (overdue, pending, partially complete)
 * - Blue: Information, in-progress, neutral active states
 * - Gray: Inactive, muted, disabled states
 */

import {
  ORDER_STATUS,
  TASK_STATUS,
  MAINTENANCE_STATUS,
  USER_STATUS,
  EXTERNAL_WITHDRAWAL_STATUS,
  VACATION_STATUS,
  SERVICE_ORDER_STATUS,
  AIRBRUSHING_STATUS,
  CUT_STATUS,
  BORROW_STATUS,
  PPE_REQUEST_STATUS,
  PPE_DELIVERY_STATUS,
  MAINTENANCE_SCHEDULE_STATUS,
  SMS_VERIFICATION_STATUS,
  EMAIL_STATUS,
  VERIFICATION_STATUS,
  BATCH_OPERATION_STATUS,
  PRIORITY_TYPE,
  URGENCY_LEVEL,
  RISK_LEVEL,
  STOCK_LEVEL,
  HEALTH_STATUS,
  PERFORMANCE_LEVEL,
  NOTIFICATION_IMPORTANCE,
  WARNING_SEVERITY,
  WORKLOAD_LEVEL,
  EFFORT_LEVEL,
  CONFIDENCE_LEVEL,
  ACTIVITY_LEVEL,
  ACTIVITY_OPERATION,
  TREND_DIRECTION,
  TREND_TYPE,
  ABC_CATEGORY,
  XYZ_CATEGORY,
  VALIDATION_SEVERITY,
  VERIFICATION_ERROR_SEVERITY,
  SECTOR_PRIVILEGES,
  COMMISSION_STATUS,
} from "./enums";

/**
 * Badge Variant Types
 * These are the available badge variants in the UI components
 */
export type BadgeVariant =
  | "default"
  | "primary"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "muted"
  | "pending"
  | "active"
  | "inactive"
  | "completed"
  | "cancelled"
  | "onHold"
  | "inProgress";

/**
 * Badge Color Definitions
 * Maps variants to Tailwind CSS classes for consistent styling
 */
export const BADGE_COLORS: Record<
  BadgeVariant,
  {
    bg: string;
    text: string;
    hover: string;
    border?: string;
  }
> = {
  // Neutral variants
  default: {
    bg: "bg-neutral-500",
    text: "text-white",
    hover: "hover:bg-neutral-600",
  },
  secondary: {
    bg: "bg-neutral-200 dark:bg-neutral-700",
    text: "text-neutral-900 dark:text-neutral-100",
    hover: "hover:bg-neutral-300 dark:hover:bg-neutral-600",
  },
  muted: {
    bg: "bg-gray-500",
    text: "text-white",
    hover: "hover:bg-gray-600",
  },
  outline: {
    bg: "bg-transparent",
    text: "text-neutral-900 dark:text-neutral-100",
    hover: "hover:bg-neutral-100 dark:hover:bg-neutral-800",
    border: "border border-neutral-300 dark:border-neutral-600",
  },

  // Primary/Info variants (Blue tones)
  primary: {
    bg: "bg-blue-600",
    text: "text-white",
    hover: "hover:bg-blue-700",
  },
  info: {
    bg: "bg-sky-500",
    text: "text-white",
    hover: "hover:bg-sky-600",
  },
  inProgress: {
    bg: "bg-blue-500",
    text: "text-white",
    hover: "hover:bg-blue-600",
  },

  // Success variants (Green tones - positive actions)
  success: {
    bg: "bg-green-600",
    text: "text-white",
    hover: "hover:bg-green-700",
  },
  completed: {
    bg: "bg-green-600",
    text: "text-white",
    hover: "hover:bg-green-700",
  },
  active: {
    bg: "bg-green-600",
    text: "text-white",
    hover: "hover:bg-green-700",
  },

  // Warning variants (Orange/Amber tones - attention needed)
  warning: {
    bg: "bg-orange-500",
    text: "text-white",
    hover: "hover:bg-orange-600",
  },
  pending: {
    bg: "bg-amber-500",
    text: "text-white",
    hover: "hover:bg-amber-600",
  },
  onHold: {
    bg: "bg-orange-500",
    text: "text-white",
    hover: "hover:bg-orange-600",
  },

  // Error/Destructive variants (Red tones - negative actions)
  error: {
    bg: "bg-red-600",
    text: "text-white",
    hover: "hover:bg-red-700",
  },
  destructive: {
    bg: "bg-red-600",
    text: "text-white",
    hover: "hover:bg-red-700",
  },
  cancelled: {
    bg: "bg-red-600",
    text: "text-white",
    hover: "hover:bg-red-700",
  },

  // Inactive variant (Gray - disabled/inactive states)
  inactive: {
    bg: "bg-gray-500",
    text: "text-white",
    hover: "hover:bg-gray-600",
  },
};

/**
 * Entity-specific badge configurations
 * Maps specific entity status enums to badge variants
 */
export const ENTITY_BADGE_CONFIG = {
  // Order Status
  ORDER: {
    [ORDER_STATUS.CREATED]: "primary" as BadgeVariant,
    [ORDER_STATUS.PARTIALLY_FULFILLED]: "warning" as BadgeVariant,
    [ORDER_STATUS.FULFILLED]: "success" as BadgeVariant,
    [ORDER_STATUS.OVERDUE]: "warning" as BadgeVariant, // Changed from error to warning (orange)
    [ORDER_STATUS.PARTIALLY_RECEIVED]: "warning" as BadgeVariant,
    [ORDER_STATUS.RECEIVED]: "success" as BadgeVariant,
    [ORDER_STATUS.CANCELLED]: "cancelled" as BadgeVariant,
  },

  // Task Status
  TASK: {
    [TASK_STATUS.PENDING]: "pending" as BadgeVariant,
    [TASK_STATUS.IN_PRODUCTION]: "inProgress" as BadgeVariant,
    [TASK_STATUS.ON_HOLD]: "onHold" as BadgeVariant,
    [TASK_STATUS.COMPLETED]: "completed" as BadgeVariant,
    [TASK_STATUS.CANCELLED]: "cancelled" as BadgeVariant,
  },

  // Maintenance Status
  MAINTENANCE: {
    [MAINTENANCE_STATUS.PENDING]: "pending" as BadgeVariant,
    [MAINTENANCE_STATUS.IN_PROGRESS]: "inProgress" as BadgeVariant,
    [MAINTENANCE_STATUS.COMPLETED]: "completed" as BadgeVariant,
    [MAINTENANCE_STATUS.CANCELLED]: "cancelled" as BadgeVariant,
    [MAINTENANCE_STATUS.OVERDUE]: "warning" as BadgeVariant, // Changed from error to warning (orange)
  },

  // User Status
  USER: {
    [USER_STATUS.EXPERIENCE_PERIOD_1]: "pending" as BadgeVariant,  // Yellow - first trial period
    [USER_STATUS.EXPERIENCE_PERIOD_2]: "primary" as BadgeVariant,  // Blue - second trial period
    [USER_STATUS.CONTRACTED]: "success" as BadgeVariant,           // Green - fully hired
    [USER_STATUS.DISMISSED]: "destructive" as BadgeVariant,        // Red - dismissed
  },

  // External Withdrawal Status
  EXTERNAL_WITHDRAWAL: {
    [EXTERNAL_WITHDRAWAL_STATUS.PENDING]: "pending" as BadgeVariant, // Yellow - pending
    [EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED]: "warning" as BadgeVariant, // Orange - partial
    [EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED]: "success" as BadgeVariant, // Green - completed
    [EXTERNAL_WITHDRAWAL_STATUS.CHARGED]: "primary" as BadgeVariant, // Blue - charged
    [EXTERNAL_WITHDRAWAL_STATUS.CANCELLED]: "cancelled" as BadgeVariant, // Red - cancelled
  },

  // Vacation Status
  VACATION: {
    [VACATION_STATUS.PENDING]: "pending" as BadgeVariant,
    [VACATION_STATUS.APPROVED]: "success" as BadgeVariant,
    [VACATION_STATUS.REJECTED]: "destructive" as BadgeVariant,
    [VACATION_STATUS.CANCELLED]: "cancelled" as BadgeVariant,
    [VACATION_STATUS.IN_PROGRESS]: "inProgress" as BadgeVariant,
    [VACATION_STATUS.COMPLETED]: "completed" as BadgeVariant,
  },


  // Service Order Status
  SERVICE_ORDER: {
    [SERVICE_ORDER_STATUS.PENDING]: "pending" as BadgeVariant,
    [SERVICE_ORDER_STATUS.IN_PROGRESS]: "inProgress" as BadgeVariant,
    [SERVICE_ORDER_STATUS.COMPLETED]: "completed" as BadgeVariant,
    [SERVICE_ORDER_STATUS.CANCELLED]: "cancelled" as BadgeVariant,
  },

  // Airbrushing Status
  AIRBRUSHING: {
    [AIRBRUSHING_STATUS.PENDING]: "pending" as BadgeVariant,
    [AIRBRUSHING_STATUS.IN_PRODUCTION]: "inProgress" as BadgeVariant,
    [AIRBRUSHING_STATUS.COMPLETED]: "completed" as BadgeVariant,
    [AIRBRUSHING_STATUS.CANCELLED]: "cancelled" as BadgeVariant,
  },

  // Cut Status
  CUT: {
    [CUT_STATUS.PENDING]: "pending" as BadgeVariant,
    [CUT_STATUS.CUTTING]: "inProgress" as BadgeVariant,
    [CUT_STATUS.COMPLETED]: "completed" as BadgeVariant,
  },

  // Borrow Status
  BORROW: {
    [BORROW_STATUS.ACTIVE]: "inProgress" as BadgeVariant, // Blue for active borrows
    [BORROW_STATUS.RETURNED]: "completed" as BadgeVariant, // Green for returned
    [BORROW_STATUS.LOST]: "destructive" as BadgeVariant, // Red for lost
  },

  // PPE Request Status
  PPE_REQUEST: {
    [PPE_REQUEST_STATUS.PENDING]: "pending" as BadgeVariant,
    [PPE_REQUEST_STATUS.APPROVED]: "success" as BadgeVariant,
    [PPE_REQUEST_STATUS.REJECTED]: "destructive" as BadgeVariant,
    [PPE_REQUEST_STATUS.DELIVERED]: "completed" as BadgeVariant,
    [PPE_REQUEST_STATUS.CANCELLED]: "cancelled" as BadgeVariant,
  },

  // PPE Delivery Status
  PPE_DELIVERY: {
    [PPE_DELIVERY_STATUS.PENDING]: "pending" as BadgeVariant,
    [PPE_DELIVERY_STATUS.APPROVED]: "success" as BadgeVariant,
    [PPE_DELIVERY_STATUS.DELIVERED]: "completed" as BadgeVariant,
    [PPE_DELIVERY_STATUS.REPROVED]: "cancelled" as BadgeVariant,
    [PPE_DELIVERY_STATUS.CANCELLED]: "cancelled" as BadgeVariant,
  },

  // Maintenance Schedule Status
  MAINTENANCE_SCHEDULE: {
    [MAINTENANCE_SCHEDULE_STATUS.PENDING]: "pending" as BadgeVariant,
    [MAINTENANCE_SCHEDULE_STATUS.FINISHED]: "completed" as BadgeVariant,
    [MAINTENANCE_SCHEDULE_STATUS.CANCELLED]: "cancelled" as BadgeVariant,
  },

  // Activity Operation (Entrada/Saída)
  ACTIVITY: {
    [ACTIVITY_OPERATION.INBOUND]: "success" as BadgeVariant, // Green for entry
    [ACTIVITY_OPERATION.OUTBOUND]: "error" as BadgeVariant, // Red for exit
  },

  // Priority Type
  PRIORITY: {
    [PRIORITY_TYPE.LOW]: "muted" as BadgeVariant,
    [PRIORITY_TYPE.MEDIUM]: "pending" as BadgeVariant,
    [PRIORITY_TYPE.HIGH]: "warning" as BadgeVariant,
    [PRIORITY_TYPE.CRITICAL]: "destructive" as BadgeVariant,
  },

  // Urgency Level
  URGENCY: {
    [URGENCY_LEVEL.LOW]: "muted" as BadgeVariant,
    [URGENCY_LEVEL.MEDIUM]: "pending" as BadgeVariant,
    [URGENCY_LEVEL.HIGH]: "warning" as BadgeVariant,
    [URGENCY_LEVEL.CRITICAL]: "destructive" as BadgeVariant,
  },

  // Risk Level
  RISK: {
    [RISK_LEVEL.LOW]: "success" as BadgeVariant,
    [RISK_LEVEL.MEDIUM]: "pending" as BadgeVariant,
    [RISK_LEVEL.HIGH]: "warning" as BadgeVariant,
    [RISK_LEVEL.CRITICAL]: "destructive" as BadgeVariant,
  },

  // Stock Level
  STOCK: {
    [STOCK_LEVEL.NEGATIVE_STOCK]: "destructive" as BadgeVariant,
    [STOCK_LEVEL.OUT_OF_STOCK]: "error" as BadgeVariant,
    [STOCK_LEVEL.CRITICAL]: "warning" as BadgeVariant,
    [STOCK_LEVEL.LOW]: "pending" as BadgeVariant,
    [STOCK_LEVEL.OPTIMAL]: "success" as BadgeVariant,
    [STOCK_LEVEL.OVERSTOCKED]: "info" as BadgeVariant,
  },

  // Health Status
  HEALTH: {
    [HEALTH_STATUS.EXCELLENT]: "success" as BadgeVariant,
    [HEALTH_STATUS.GOOD]: "active" as BadgeVariant,
    [HEALTH_STATUS.FAIR]: "pending" as BadgeVariant,
    [HEALTH_STATUS.POOR]: "warning" as BadgeVariant,
    [HEALTH_STATUS.CRITICAL]: "destructive" as BadgeVariant,
  },

  // Performance Level
  PERFORMANCE: {
    [PERFORMANCE_LEVEL.EXCELLENT]: "success" as BadgeVariant,
    [PERFORMANCE_LEVEL.GOOD]: "active" as BadgeVariant,
    [PERFORMANCE_LEVEL.FAIR]: "pending" as BadgeVariant,
    [PERFORMANCE_LEVEL.POOR]: "warning" as BadgeVariant,
  },

  // Notification Importance
  NOTIFICATION: {
    [NOTIFICATION_IMPORTANCE.LOW]: "muted" as BadgeVariant,
    [NOTIFICATION_IMPORTANCE.NORMAL]: "default" as BadgeVariant,
    [NOTIFICATION_IMPORTANCE.HIGH]: "warning" as BadgeVariant,
    [NOTIFICATION_IMPORTANCE.URGENT]: "destructive" as BadgeVariant,
  },

  // Warning Severity
  WARNING: {
    [WARNING_SEVERITY.VERBAL]: "info" as BadgeVariant,
    [WARNING_SEVERITY.WRITTEN]: "pending" as BadgeVariant,
    [WARNING_SEVERITY.SUSPENSION]: "warning" as BadgeVariant,
    [WARNING_SEVERITY.FINAL_WARNING]: "destructive" as BadgeVariant,
  },

  // SMS Verification Status
  SMS_VERIFICATION: {
    [SMS_VERIFICATION_STATUS.PENDING]: "pending" as BadgeVariant,
    [SMS_VERIFICATION_STATUS.SENT]: "info" as BadgeVariant,
    [SMS_VERIFICATION_STATUS.VERIFIED]: "success" as BadgeVariant,
    [SMS_VERIFICATION_STATUS.EXPIRED]: "muted" as BadgeVariant,
    [SMS_VERIFICATION_STATUS.FAILED]: "error" as BadgeVariant,
    [SMS_VERIFICATION_STATUS.CANCELLED]: "cancelled" as BadgeVariant,
    [SMS_VERIFICATION_STATUS.RATE_LIMITED]: "warning" as BadgeVariant,
    [SMS_VERIFICATION_STATUS.BLOCKED]: "destructive" as BadgeVariant,
  },

  // Email Status
  EMAIL: {
    [EMAIL_STATUS.PENDING]: "pending" as BadgeVariant,
    [EMAIL_STATUS.SENT]: "info" as BadgeVariant,
    [EMAIL_STATUS.DELIVERED]: "success" as BadgeVariant,
    [EMAIL_STATUS.FAILED]: "error" as BadgeVariant,
    [EMAIL_STATUS.BOUNCED]: "destructive" as BadgeVariant,
    [EMAIL_STATUS.CANCELLED]: "cancelled" as BadgeVariant,
  },

  // Verification Status
  VERIFICATION: {
    [VERIFICATION_STATUS.PENDING]: "pending" as BadgeVariant,
    [VERIFICATION_STATUS.SENT]: "info" as BadgeVariant,
    [VERIFICATION_STATUS.VERIFIED]: "success" as BadgeVariant,
    [VERIFICATION_STATUS.EXPIRED]: "muted" as BadgeVariant,
    [VERIFICATION_STATUS.FAILED]: "error" as BadgeVariant,
    [VERIFICATION_STATUS.CANCELLED]: "cancelled" as BadgeVariant,
  },

  // Batch Operation Status
  BATCH_OPERATION: {
    [BATCH_OPERATION_STATUS.PENDING]: "pending" as BadgeVariant,
    [BATCH_OPERATION_STATUS.PROCESSING]: "inProgress" as BadgeVariant,
    [BATCH_OPERATION_STATUS.COMPLETED]: "completed" as BadgeVariant,
    [BATCH_OPERATION_STATUS.FAILED]: "error" as BadgeVariant,
    [BATCH_OPERATION_STATUS.PARTIAL]: "warning" as BadgeVariant,
  },

  // Workload Level
  WORKLOAD: {
    [WORKLOAD_LEVEL.LOW]: "success" as BadgeVariant,
    [WORKLOAD_LEVEL.NORMAL]: "default" as BadgeVariant,
    [WORKLOAD_LEVEL.HIGH]: "warning" as BadgeVariant,
    [WORKLOAD_LEVEL.CRITICAL]: "destructive" as BadgeVariant,
  },

  // Effort Level
  EFFORT: {
    [EFFORT_LEVEL.LOW]: "success" as BadgeVariant,
    [EFFORT_LEVEL.MEDIUM]: "pending" as BadgeVariant,
    [EFFORT_LEVEL.HIGH]: "warning" as BadgeVariant,
  },

  // Confidence Level
  CONFIDENCE: {
    [CONFIDENCE_LEVEL.LOW]: "warning" as BadgeVariant,
    [CONFIDENCE_LEVEL.MEDIUM]: "pending" as BadgeVariant,
    [CONFIDENCE_LEVEL.HIGH]: "success" as BadgeVariant,
  },

  // Activity Level
  ACTIVITY_LEVEL: {
    [ACTIVITY_LEVEL.VERY_ACTIVE]: "success" as BadgeVariant,
    [ACTIVITY_LEVEL.ACTIVE]: "active" as BadgeVariant,
    [ACTIVITY_LEVEL.OCCASIONAL]: "pending" as BadgeVariant,
    [ACTIVITY_LEVEL.DORMANT]: "muted" as BadgeVariant,
    [ACTIVITY_LEVEL.LOST]: "destructive" as BadgeVariant,
  },

  // Trend Direction
  TREND: {
    [TREND_DIRECTION.UP]: "success" as BadgeVariant,
    [TREND_DIRECTION.DOWN]: "error" as BadgeVariant,
    [TREND_DIRECTION.STABLE]: "default" as BadgeVariant,
  },

  // Trend Type
  TREND_TYPE: {
    [TREND_TYPE.POSITIVE]: "success" as BadgeVariant,
    [TREND_TYPE.NEGATIVE]: "error" as BadgeVariant,
    [TREND_TYPE.NEUTRAL]: "default" as BadgeVariant,
    [TREND_TYPE.VOLATILE]: "warning" as BadgeVariant,
    [TREND_TYPE.SEASONAL]: "info" as BadgeVariant,
  },

  // Validation Severity
  VALIDATION: {
    [VALIDATION_SEVERITY.ERROR]: "error" as BadgeVariant,
    [VALIDATION_SEVERITY.WARNING]: "warning" as BadgeVariant,
    [VALIDATION_SEVERITY.INFO]: "info" as BadgeVariant,
  },

  // Verification Error Severity
  VERIFICATION_ERROR: {
    [VERIFICATION_ERROR_SEVERITY.LOW]: "info" as BadgeVariant,
    [VERIFICATION_ERROR_SEVERITY.MEDIUM]: "pending" as BadgeVariant,
    [VERIFICATION_ERROR_SEVERITY.HIGH]: "warning" as BadgeVariant,
    [VERIFICATION_ERROR_SEVERITY.CRITICAL]: "destructive" as BadgeVariant,
  },

  // Sector Privileges
  SECTOR_PRIVILEGES: {
    [SECTOR_PRIVILEGES.BASIC]: "muted" as BadgeVariant,
    [SECTOR_PRIVILEGES.MAINTENANCE]: "secondary" as BadgeVariant,
    [SECTOR_PRIVILEGES.WAREHOUSE]: "default" as BadgeVariant,
    [SECTOR_PRIVILEGES.ADMIN]: "primary" as BadgeVariant,
    [SECTOR_PRIVILEGES.PRODUCTION]: "info" as BadgeVariant,
    [SECTOR_PRIVILEGES.LEADER]: "inProgress" as BadgeVariant,
    [SECTOR_PRIVILEGES.HUMAN_RESOURCES]: "warning" as BadgeVariant,
    [SECTOR_PRIVILEGES.EXTERNAL]: "outline" as BadgeVariant,
  },

  // Commission Status
  COMMISSION_STATUS: {
    [COMMISSION_STATUS.FULL_COMMISSION]: "success" as BadgeVariant,     // Green
    [COMMISSION_STATUS.PARTIAL_COMMISSION]: "primary" as BadgeVariant,  // Blue
    [COMMISSION_STATUS.NO_COMMISSION]: "warning" as BadgeVariant,       // Orange
    [COMMISSION_STATUS.SUSPENDED_COMMISSION]: "destructive" as BadgeVariant, // Red
  },
};

/**
 * Generic status mapping for common patterns
 * These are fallbacks when entity-specific mapping is not found
 */
export const GENERIC_STATUS_CONFIG: Record<string, BadgeVariant> = {
  // Common status values
  PENDING: "pending",
  IN_PROGRESS: "inProgress",
  IN_PRODUCTION: "inProgress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  ACTIVE: "active",
  INACTIVE: "inactive",
  APPROVED: "success",
  REJECTED: "destructive",
  DELIVERED: "completed",
  FAILED: "error",
  EXPIRED: "muted",
  VERIFIED: "success",
  RETURNED: "completed",
  LOST: "destructive",
  OVERDUE: "warning", // Changed from error to warning
  CREATED: "primary",
  FULFILLED: "success",
  RECEIVED: "success",
  SENT: "info",
  ON_HOLD: "onHold",
  SUSPENDED: "warning",
  BLOCKED: "destructive",
  PROCESSING: "inProgress",
  PARTIAL: "warning",
  CUTTING: "inProgress",
  FINISHED: "completed",
  CHARGED: "info",
  RATE_LIMITED: "warning",
  BOUNCED: "destructive",

  // Operations
  INBOUND: "success", // Green for entry
  OUTBOUND: "error", // Red for exit
  "1": "success", // Numeric inbound
  "-1": "error", // Numeric outbound

  // Performance/Health levels
  EXCELLENT: "success",
  GOOD: "active",
  FAIR: "pending",
  POOR: "warning",
  CRITICAL: "destructive",

  // Priority/Urgency levels
  LOW: "muted",
  MEDIUM: "pending",
  HIGH: "warning",
  NORMAL: "default",
  URGENT: "destructive",

  // Trends
  UP: "success",
  DOWN: "error",
  STABLE: "default",
  POSITIVE: "success",
  NEGATIVE: "error",
  NEUTRAL: "default",
  VOLATILE: "warning",
  SEASONAL: "info",

  // Activity levels
  VERY_ACTIVE: "success",
  OCCASIONAL: "pending",
  DORMANT: "muted",

  // Validation
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",

  // Special
  VERBAL: "info",
  WRITTEN: "pending",
  SUSPENSION: "warning",
  FINAL_WARNING: "destructive",
  PENDING_JUSTIFICATION: "pending",
  JUSTIFICATION_SUBMITTED: "info",
  PARTIALLY_FULFILLED: "warning",
  PARTIALLY_RECEIVED: "warning",
  PARTIALLY_RETURNED: "warning",
  FULLY_RETURNED: "success",

  // Commission Status fallback
  FULL_COMMISSION: "success",     // Green
  PARTIAL_COMMISSION: "primary",  // Blue
  NO_COMMISSION: "warning",       // Orange
  SUSPENDED_COMMISSION: "destructive", // Red
};

/**
 * ABC Category Badge Colors
 * Special color scheme for inventory analysis badges
 */
export const ABC_BADGE_COLORS: Record<
  ABC_CATEGORY,
  {
    bg: string;
    text: string;
    hover: string;
  }
> = {
  [ABC_CATEGORY.A]: {
    bg: "bg-red-100 dark:bg-red-900/20",
    text: "text-red-700 dark:text-red-400",
    hover: "hover:bg-red-200 dark:hover:bg-red-900/30",
  },
  [ABC_CATEGORY.B]: {
    bg: "bg-yellow-100 dark:bg-yellow-900/20",
    text: "text-yellow-700 dark:text-yellow-400",
    hover: "hover:bg-yellow-200 dark:hover:bg-yellow-900/30",
  },
  [ABC_CATEGORY.C]: {
    bg: "bg-green-100 dark:bg-green-900/20",
    text: "text-green-700 dark:text-green-400",
    hover: "hover:bg-green-200 dark:hover:bg-green-900/30",
  },
};

/**
 * XYZ Category Badge Colors
 * Special color scheme for inventory analysis badges
 */
export const XYZ_BADGE_COLORS: Record<
  XYZ_CATEGORY,
  {
    bg: string;
    text: string;
    hover: string;
  }
> = {
  [XYZ_CATEGORY.X]: {
    bg: "bg-blue-100 dark:bg-blue-900/20",
    text: "text-blue-700 dark:text-blue-400",
    hover: "hover:bg-blue-200 dark:hover:bg-blue-900/30",
  },
  [XYZ_CATEGORY.Y]: {
    bg: "bg-purple-100 dark:bg-purple-900/20",
    text: "text-purple-700 dark:text-purple-400",
    hover: "hover:bg-purple-200 dark:hover:bg-purple-900/30",
  },
  [XYZ_CATEGORY.Z]: {
    bg: "bg-orange-100 dark:bg-orange-900/20",
    text: "text-orange-700 dark:text-orange-400",
    hover: "hover:bg-orange-200 dark:hover:bg-orange-900/30",
  },
};

/**
 * Boolean Badge Configurations
 * For fields like willReturn, isActive, etc.
 */
export const BOOLEAN_BADGE_CONFIG = {
  willReturn: {
    true: "success" as BadgeVariant, // Green - will return items (positive)
    false: "destructive" as BadgeVariant, // Red - won't return items (negative)
  },
  isActive: {
    true: "active" as BadgeVariant,
    false: "inactive" as BadgeVariant,
  },
  isUrgent: {
    true: "destructive" as BadgeVariant,
    false: "default" as BadgeVariant,
  },
  isCritical: {
    true: "destructive" as BadgeVariant,
    false: "default" as BadgeVariant,
  },
  isCompleted: {
    true: "completed" as BadgeVariant,
    false: "pending" as BadgeVariant,
  },
  isApproved: {
    true: "success" as BadgeVariant,
    false: "pending" as BadgeVariant,
  },
  isVerified: {
    true: "success" as BadgeVariant,
    false: "warning" as BadgeVariant,
  },
  isDelivered: {
    true: "completed" as BadgeVariant,
    false: "pending" as BadgeVariant,
  },
  isOverdue: {
    true: "warning" as BadgeVariant, // Changed from error to warning
    false: "default" as BadgeVariant,
  },
};

/**
 * Helper function to get badge variant from any enum value
 * First checks entity-specific mappings, then falls back to generic mappings
 */
export function getBadgeVariant(value: string, entity?: keyof typeof ENTITY_BADGE_CONFIG): BadgeVariant {
  // If entity is specified, check entity-specific config first
  if (entity && ENTITY_BADGE_CONFIG[entity]) {
    const entityConfig = ENTITY_BADGE_CONFIG[entity] as Record<string, BadgeVariant>;
    if (entityConfig[value]) {
      return entityConfig[value];
    }
  }

  // Fall back to generic status config
  return GENERIC_STATUS_CONFIG[value] || "default";
}

/**
 * Helper function to get badge colors from variant
 */
export function getBadgeColors(variant: BadgeVariant) {
  return BADGE_COLORS[variant];
}

/**
 * Helper function to get badge variant for boolean fields
 */
export function getBooleanBadgeVariant(field: keyof typeof BOOLEAN_BADGE_CONFIG, value: boolean): BadgeVariant {
  return BOOLEAN_BADGE_CONFIG[field]?.[String(value) as "true" | "false"] || "default";
}

/**
 * Helper function to get ABC category badge colors
 */
export function getABCBadgeColors(category: ABC_CATEGORY) {
  return ABC_BADGE_COLORS[category];
}

/**
 * Helper function to get XYZ category badge colors
 */
export function getXYZBadgeColors(category: XYZ_CATEGORY) {
  return XYZ_BADGE_COLORS[category];
}

/**
 * Export all badge configurations for use across the application
 */
export default {
  BADGE_COLORS,
  ENTITY_BADGE_CONFIG,
  GENERIC_STATUS_CONFIG,
  ABC_BADGE_COLORS,
  XYZ_BADGE_COLORS,
  BOOLEAN_BADGE_CONFIG,
  getBadgeVariant,
  getBadgeColors,
  getBooleanBadgeVariant,
  getABCBadgeColors,
  getXYZBadgeColors,
};
