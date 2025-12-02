-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2', 'EFFECTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "CutType" AS ENUM ('VINYL', 'STENCIL');

-- CreateEnum
CREATE TYPE "CutRequestReason" AS ENUM ('WRONG_APPLY', 'LOST', 'WRONG');

-- CreateEnum
CREATE TYPE "CutOrigin" AS ENUM ('PLAN', 'REQUEST');

-- CreateEnum
CREATE TYPE "PpeType" AS ENUM ('SHIRT', 'PANTS', 'BOOTS', 'SLEEVES', 'MASK', 'GLOVES', 'RAIN_BOOTS', 'OUTROS', 'OTHERS');

-- CreateEnum
CREATE TYPE "PpeDeliveryMode" AS ENUM ('SCHEDULED', 'ON_DEMAND', 'BOTH');

-- CreateEnum
CREATE TYPE "ShirtSize" AS ENUM ('P', 'M', 'G', 'GG', 'XG');

-- CreateEnum
CREATE TYPE "PantsSize" AS ENUM ('SIZE_36', 'SIZE_38', 'SIZE_40', 'SIZE_42', 'SIZE_44', 'SIZE_46', 'SIZE_48');

-- CreateEnum
CREATE TYPE "BootSize" AS ENUM ('SIZE_36', 'SIZE_38', 'SIZE_40', 'SIZE_42', 'SIZE_44', 'SIZE_46', 'SIZE_48', 'SIZE_35', 'SIZE_37', 'SIZE_39', 'SIZE_41', 'SIZE_43', 'SIZE_45', 'SIZE_47');

-- CreateEnum
CREATE TYPE "SleevesSize" AS ENUM ('P', 'M', 'G', 'GG', 'XG');

-- CreateEnum
CREATE TYPE "MaskSize" AS ENUM ('P', 'M');

-- CreateEnum
CREATE TYPE "GlovesSize" AS ENUM ('P', 'M', 'G');

-- CreateEnum
CREATE TYPE "RainBootsSize" AS ENUM ('SIZE_36', 'SIZE_38', 'SIZE_40', 'SIZE_42', 'SIZE_44', 'SIZE_46', 'SIZE_35', 'SIZE_37', 'SIZE_39', 'SIZE_41', 'SIZE_43', 'SIZE_45', 'SIZE_47', 'SIZE_48');

-- CreateEnum
CREATE TYPE "PpeSizeEnum" AS ENUM ('P', 'M', 'G', 'GG', 'XG', 'SIZE_36', 'SIZE_38', 'SIZE_40', 'SIZE_42', 'SIZE_44', 'SIZE_46', 'SIZE_48', 'SIZE_35', 'SIZE_37', 'SIZE_39', 'SIZE_41', 'SIZE_43', 'SIZE_45', 'SIZE_47');

-- CreateEnum
CREATE TYPE "PpeDeliveryStatus" AS ENUM ('PENDING', 'APPROVED', 'DELIVERED', 'REPROVED');

-- CreateEnum
CREATE TYPE "ActivityReason" AS ENUM ('ORDER_RECEIVED', 'PRODUCTION_USAGE', 'PPE_DELIVERY', 'BORROW', 'RETURN', 'EXTERNAL_WITHDRAWAL', 'EXTERNAL_WITHDRAWAL_RETURN', 'INVENTORY_COUNT', 'MANUAL_ADJUSTMENT', 'MAINTENANCE', 'DAMAGE', 'LOSS', 'PAINT_PRODUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'OVERDUE', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaintenanceScheduleStatus" AS ENUM ('PENDING', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED', 'ON_HOLD', 'INVOICED', 'SETTLED');

-- CreateEnum
CREATE TYPE "ServiceOrderStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AirbrushingStatus" AS ENUM ('PENDING', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CutStatus" AS ENUM ('PENDING', 'CUTTING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "AbsenceStatus" AS ENUM ('PENDING_JUSTIFICATION', 'JUSTIFICATION_SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VacationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PpeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BorrowStatus" AS ENUM ('ACTIVE', 'RETURNED', 'LOST');

-- CreateEnum
CREATE TYPE "ExternalWithdrawalType" AS ENUM ('RETURNABLE', 'CHARGEABLE', 'COMPLIMENTARY');

-- CreateEnum
CREATE TYPE "ExternalWithdrawalStatus" AS ENUM ('PENDING', 'CANCELLED', 'PARTIALLY_RETURNED', 'FULLY_RETURNED', 'CHARGED', 'LIQUIDATED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "VacationType" AS ENUM ('ANNUAL', 'COLLECTIVE', 'MEDICAL', 'MATERNITY', 'PATERNITY', 'EMERGENCY', 'STUDY', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "PaintFinish" AS ENUM ('SOLID', 'METALLIC', 'PEARL', 'MATTE', 'SATIN');

-- CreateEnum
CREATE TYPE "ColorPalette" AS ENUM ('BLACK', 'GRAY', 'WHITE', 'SILVER', 'GOLDEN', 'YELLOW', 'ORANGE', 'BROWN', 'RED', 'PINK', 'PURPLE', 'BLUE', 'GREEN', 'BEIGE');

-- CreateEnum
CREATE TYPE "TruckManufacturer" AS ENUM ('SCANIA', 'VOLVO', 'DAF', 'VOLKSWAGEN', 'IVECO', 'MERCEDES_BENZ');

-- CreateEnum
CREATE TYPE "WarningSeverity" AS ENUM ('VERBAL', 'WRITTEN', 'SUSPENSION', 'FINAL_WARNING');

-- CreateEnum
CREATE TYPE "WarningCategory" AS ENUM ('SAFETY', 'MISCONDUCT', 'INSUBORDINATION', 'POLICY_VIOLATION', 'ATTENDANCE', 'PERFORMANCE', 'BEHAVIOR', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SYSTEM', 'TASK', 'ORDER', 'PPE', 'VACATION', 'WARNING', 'STOCK', 'GENERAL');

-- CreateEnum
CREATE TYPE "NotificationImportance" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "ColorSchema" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "VerificationType" AS ENUM ('EMAIL', 'PHONE', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "MeasureUnit" AS ENUM ('KILOGRAM', 'GRAM', 'MILLILITER', 'LITER', 'CUBIC_METER', 'CUBIC_CENTIMETER', 'MILLIMETER', 'CENTIMETER', 'METER', 'INCHES', 'THREAD_MM', 'THREAD_TPI', 'WATT', 'VOLT', 'AMPERE', 'SQUARE_CENTIMETER', 'SQUARE_METER', 'UNIT', 'PAIR', 'DOZEN', 'HUNDRED', 'THOUSAND', 'PACKAGE', 'BOX', 'ROLL', 'SHEET', 'SET', 'SACK', 'P', 'M', 'G', 'GG', 'XG');

-- CreateEnum
CREATE TYPE "MeasureType" AS ENUM ('WEIGHT', 'VOLUME', 'LENGTH', 'WIDTH', 'AREA', 'COUNT', 'DIAMETER', 'THREAD', 'ELECTRICAL', 'SIZE');

-- CreateEnum
CREATE TYPE "SectorPrivileges" AS ENUM ('BASIC', 'PRODUCTION', 'LEADER', 'MAINTENANCE', 'WAREHOUSE', 'ADMIN', 'HUMAN_RESOURCES', 'EXTERNAL', 'DESIGNER', 'FINANCIAL', 'LOGISTIC');

-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'TRIANNUAL', 'QUADRIMESTRAL', 'SEMI_ANNUAL', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('ALL', 'ALL_EXCEPT', 'SPECIFIC');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "Month" AS ENUM ('JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER');

-- CreateEnum
CREATE TYPE "MonthOccurrence" AS ENUM ('FIRST', 'SECOND', 'THIRD', 'FOURTH', 'LAST');

-- CreateEnum
CREATE TYPE "OrderTriggerType" AS ENUM ('STOCK_LEVEL', 'CONSUMPTION_RATE', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "ChangeLogTriggeredByType" AS ENUM ('TASK_CREATE', 'TASK_UPDATE', 'ITEM_UPDATE', 'USER_ACTION', 'BATCH_CREATE', 'BATCH_UPDATE', 'BATCH_DELETE', 'BATCH_OPERATION', 'SYSTEM', 'SYSTEM_GENERATED', 'USER', 'EXTERNAL_WITHDRAWAL', 'EXTERNAL_WITHDRAWAL_DELETE', 'EXTERNAL_WITHDRAWAL_RETURN', 'EXTERNAL_WITHDRAWAL_SYNC', 'EXTERNAL_WITHDRAWAL_ITEM', 'EXTERNAL_WITHDRAWAL_ITEM_UPDATE', 'EXTERNAL_WITHDRAWAL_ITEM_DELETE', 'PAINT_FORMULA_COMPONENT_CREATE', 'PAINT_FORMULA_COMPONENT_UPDATE', 'PAINT_FORMULA_COMPONENT_DELETE', 'PAINT_FORMULA_COMPONENT_BATCH_CREATE', 'PAINT_FORMULA_COMPONENT_BATCH_UPDATE', 'PAINT_FORMULA_COMPONENT_BATCH_DELETE', 'PAINT_PRODUCTION_CREATE', 'PAINT_PRODUCTION_UPDATE', 'PAINT_PRODUCTION_DELETE', 'PAINT_PRODUCTION_BATCH_CREATE', 'PAINT_PRODUCTION_BATCH_UPDATE', 'PAINT_PRODUCTION_BATCH_DELETE', 'PAINT_CREATE', 'PAINT_UPDATE', 'PAINT_DELETE', 'PAINT_BATCH_CREATE', 'PAINT_BATCH_UPDATE', 'PAINT_BATCH_DELETE', 'PAINT_FORMULA_CREATE', 'PAINT_FORMULA_UPDATE', 'PAINT_FORMULA_DELETE', 'PAINT_FORMULA_BATCH_CREATE', 'PAINT_FORMULA_BATCH_UPDATE', 'PAINT_FORMULA_BATCH_DELETE', 'PAINT_TYPE_CREATE', 'PAINT_TYPE_UPDATE', 'PAINT_TYPE_DELETE', 'PAINT_TYPE_BATCH_CREATE', 'PAINT_TYPE_BATCH_UPDATE', 'PAINT_TYPE_BATCH_DELETE', 'PAINT_BRAND_CREATE', 'PAINT_BRAND_UPDATE', 'PAINT_BRAND_DELETE', 'PAINT_BRAND_BATCH_CREATE', 'PAINT_BRAND_BATCH_UPDATE', 'PAINT_BRAND_BATCH_DELETE', 'PAINT_GROUND_CREATE', 'PAINT_GROUND_UPDATE', 'PAINT_GROUND_DELETE', 'PAINT_GROUND_BATCH_CREATE', 'PAINT_GROUND_BATCH_UPDATE', 'PAINT_GROUND_BATCH_DELETE', 'ORDER_UPDATE', 'ORDER_CREATE', 'ORDER_STATUS_CHANGE', 'ORDER_CANCEL', 'ORDER_ITEM_UPDATE', 'ORDER_ITEM_RECEIVED', 'ORDER_ITEM_SYNC', 'SCHEDULE', 'ACTIVITY_CREATE', 'ACTIVITY_UPDATE', 'ACTIVITY_DELETE', 'ACTIVITY_SYNC', 'INVENTORY_ADJUSTMENT', 'INVENTORY_COUNT', 'ITEM_MONTHLY_CONSUMPTION_UPDATE', 'AUTOMATIC_MIN_MAX_UPDATE', 'PPE_DELIVERY', 'SMS_VERIFICATION_CREATE', 'SMS_VERIFICATION_SEND', 'SMS_VERIFICATION_VERIFY', 'SMS_VERIFICATION_EXPIRE', 'SMS_VERIFICATION_CANCEL', 'EMAIL_SERVICE', 'VERIFICATION_CREATE', 'VERIFICATION_SEND', 'VERIFICATION_VERIFY', 'VERIFICATION_EXPIRE', 'VERIFICATION_CANCEL', 'VERIFICATION_RESEND', 'OBSERVATION_CREATE', 'OBSERVATION_DELETE', 'SCHEDULED_JOB', 'API', 'WEBHOOK', 'ADMIN');

-- CreateEnum
CREATE TYPE "ChangeLogEntityType" AS ENUM ('ABSENCE', 'ACTIVITY', 'AIRBRUSHING', 'BORROW', 'CALCULATION', 'CALCULATION_DETAIL', 'CALCULATION_DECOMPOSITION', 'CATEGORY', 'COLLECTION', 'CUSTOMER', 'CUT', 'CUT_ITEM', 'CUT_PLAN', 'CUT_REQUEST', 'DELIVERY', 'PPE_DELIVERY', 'PPE_DELIVERY_ITEM', 'PPE_REQUEST', 'PPE_DELIVERY_SCHEDULE', 'PPE_SIZE', 'ECONOMIC_ACTIVITY', 'EXTERNAL_WITHDRAWAL', 'EXTERNAL_WITHDRAWAL_ITEM', 'FILE', 'ITEM', 'ITEM_BRAND', 'ITEM_CATEGORY', 'MAINTENANCE', 'MAINTENANCE_SCHEDULE', 'NOTIFICATION', 'ORDER', 'ORDER_ITEM', 'ORDER_RULE', 'ORDER_SCHEDULE', 'PAINT', 'PAINT_TYPE', 'SERVICE', 'PAINT_GROUND', 'PAINT_FORMULA', 'PAINT_FORMULA_COMPONENT', 'PAINT_PRODUCTION', 'PIECE', 'POSITION', 'PRODUCTION', 'PURCHASE', 'WARNING', 'SECTOR', 'SERVICE_ORDER', 'SUPPLIER', 'TASK', 'TRUCK', 'LAYOUT', 'USER', 'VACATION', 'DEPLOYMENT', 'OBSERVATION', 'BONUS', 'COMMISSION', 'DISCOUNT', 'MAINTENANCE_ITEM', 'PARKING_SPOT', 'PAYROLL', 'TIME_CLOCK_ENTRY', 'PPE_CONFIG', 'PRICE', 'HOLIDAY', 'SEEN_NOTIFICATION', 'NOTIFICATION_PREFERENCE', 'VERIFICATION', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ChangeLogAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'ARCHIVE', 'UNARCHIVE', 'ACTIVATE', 'DEACTIVATE', 'APPROVE', 'REJECT', 'CANCEL', 'COMPLETE', 'ROLLBACK', 'RESCHEDULE', 'BATCH_CREATE', 'BATCH_UPDATE', 'BATCH_DELETE');

-- CreateEnum
CREATE TYPE "NotificationActionType" AS ENUM ('VIEW_DETAILS', 'APPROVE_REQUEST', 'REJECT_REQUEST', 'COMPLETE_TASK', 'VIEW_ORDER', 'VIEW_REPORT', 'ACKNOWLEDGE', 'DISMISS');

-- CreateEnum
CREATE TYPE "ActivityOperation" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "AbcCategory" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "XyzCategory" AS ENUM ('X', 'Y', 'Z');

-- CreateEnum
CREATE TYPE "ItemCategoryType" AS ENUM ('REGULAR', 'TOOL', 'PPE');

-- CreateEnum
CREATE TYPE "BonusStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PARTIAL_COMMISSION', 'NO_COMMISSION', 'FULL_COMMISSION', 'SUSPENDED_COMMISSION');

-- CreateEnum
CREATE TYPE "PayrollDiscountType" AS ENUM ('INSS', 'IRRF', 'FGTS', 'ABSENCE', 'PARTIAL_ABSENCE', 'DSR_ABSENCE', 'LATE_ARRIVAL', 'SICK_LEAVE', 'UNION', 'ALIMONY', 'GARNISHMENT', 'HEALTH_INSURANCE', 'DENTAL_INSURANCE', 'MEAL_VOUCHER', 'TRANSPORT_VOUCHER', 'LOAN', 'ADVANCE', 'AUTHORIZED_DISCOUNT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('INSS', 'IRRF');

-- CreateEnum
CREATE TYPE "TaxCalculationMethod" AS ENUM ('PROGRESSIVE', 'FIXED', 'ABSOLUTE');

-- CreateEnum
CREATE TYPE "DeploymentEnvironment" AS ENUM ('STAGING', 'PRODUCTION', 'DEVELOPMENT');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK', 'BUILDING', 'TESTING', 'DEPLOYING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AppType" AS ENUM ('API', 'WEB', 'MOBILE', 'WORKER', 'CRON');

-- CreateEnum
CREATE TYPE "DeploymentLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DeploymentPhase" AS ENUM ('INITIALIZATION', 'FETCH_CODE', 'BUILD', 'TEST', 'DEPLOY', 'HEALTH_CHECK', 'CLEANUP', 'ROLLBACK', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DeploymentTrigger" AS ENUM ('MANUAL', 'AUTO', 'PUSH', 'PULL_REQUEST', 'TAG', 'SCHEDULE', 'WEBHOOK', 'ROLLBACK', 'API');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'UNFIT', 'ACTIVE_NOT_REGULAR', 'DEREGISTERED');

-- CreateEnum
CREATE TYPE "StreetType" AS ENUM ('STREET', 'AVENUE', 'ALLEY', 'CROSSING', 'SQUARE', 'HIGHWAY', 'ROAD', 'WAY', 'PLAZA', 'LANE', 'DEADEND', 'SMALL_STREET', 'PATH', 'PASSAGE', 'GARDEN', 'BLOCK', 'LOT', 'SITE', 'PARK', 'FARM', 'RANCH', 'CONDOMINIUM', 'COMPLEX', 'RESIDENTIAL', 'OTHER');

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "operation" "ActivityOperation" NOT NULL DEFAULT 'OUTBOUND',
    "userId" TEXT,
    "itemId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "reason" "ActivityReason" NOT NULL DEFAULT 'PRODUCTION_USAGE',
    "reasonOrder" INTEGER DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Airbrushing" (
    "id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "finishDate" TIMESTAMP(3),
    "price" DOUBLE PRECISION,
    "status" "AirbrushingStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Airbrushing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Borrow" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" "BorrowStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Borrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL,
    "entityType" "ChangeLogEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "ChangeLogAction" NOT NULL,
    "field" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "userId" TEXT,
    "triggeredBy" "ChangeLogTriggeredByType",
    "triggeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bonus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "baseBonus" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netBonus" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "weightedTasks" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "averageTaskPerUser" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "performanceLevel" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "payrollId" TEXT,

    CONSTRAINT "Bonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payroll" (
    "id" TEXT NOT NULL,
    "baseRemuneration" DECIMAL(10,2) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT,
    "workingDaysInMonth" INTEGER,
    "workedDaysInMonth" INTEGER,
    "absenceHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "overtime50Hours" DECIMAL(10,2),
    "overtime50Amount" DECIMAL(10,2),
    "overtime100Hours" DECIMAL(10,2),
    "overtime100Amount" DECIMAL(10,2),
    "nightHours" DECIMAL(10,2),
    "nightDifferentialAmount" DECIMAL(10,2),
    "dsrAmount" DECIMAL(10,2),
    "dsrDays" INTEGER,
    "grossSalary" DECIMAL(10,2),
    "inssBase" DECIMAL(10,2),
    "inssAmount" DECIMAL(10,2),
    "irrfBase" DECIMAL(10,2),
    "irrfAmount" DECIMAL(10,2),
    "fgtsAmount" DECIMAL(10,2),
    "netSalary" DECIMAL(10,2),
    "totalDiscounts" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusDiscount" (
    "id" TEXT NOT NULL,
    "bonusId" TEXT NOT NULL,
    "percentage" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "calculationOrder" INTEGER NOT NULL DEFAULT 1,
    "reference" TEXT NOT NULL,
    "value" DECIMAL(10,2),

    CONSTRAINT "BonusDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollDiscount" (
    "id" TEXT NOT NULL,
    "percentage" DECIMAL(5,2),
    "value" DECIMAL(10,2),
    "reference" TEXT NOT NULL,
    "discountType" "PayrollDiscountType" NOT NULL DEFAULT 'CUSTOM',
    "isPersistent" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "taxYear" INTEGER,
    "taxTableId" TEXT,
    "expirationDate" TIMESTAMP(3),
    "baseValue" DECIMAL(10,2),
    "payrollId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxTable" (
    "id" TEXT NOT NULL,
    "taxType" "TaxType" NOT NULL,
    "year" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "calculationMethod" "TaxCalculationMethod" NOT NULL DEFAULT 'PROGRESSIVE',
    "description" TEXT,
    "legalReference" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxBracket" (
    "id" TEXT NOT NULL,
    "taxTableId" TEXT NOT NULL,
    "bracketOrder" INTEGER NOT NULL,
    "minValue" DECIMAL(10,2) NOT NULL,
    "maxValue" DECIMAL(10,2),
    "rate" DECIMAL(5,2) NOT NULL,
    "deduction" DECIMAL(10,2),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxBracket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EconomicActivity" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EconomicActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "fantasyName" TEXT NOT NULL,
    "cnpj" TEXT,
    "cpf" TEXT,
    "corporateName" TEXT,
    "email" TEXT,
    "address" TEXT,
    "addressNumber" TEXT,
    "addressComplement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "site" TEXT,
    "phones" TEXT[],
    "tags" TEXT[],
    "logoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "economicActivityId" TEXT,
    "registrationStatus" "RegistrationStatus",
    "streetType" "StreetType",

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PpeSize" (
    "id" TEXT NOT NULL,
    "shirts" "ShirtSize",
    "boots" "BootSize",
    "pants" "PantsSize",
    "sleeves" "SleevesSize",
    "mask" "MaskSize",
    "gloves" "GlovesSize",
    "rainBoots" "RainBootsSize",
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PpeSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PpeDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" "PpeDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "reviewedBy" TEXT,
    "ppeScheduleId" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "actualDeliveryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PpeDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PpeDeliverySchedule" (
    "id" TEXT NOT NULL,
    "assignmentType" "AssignmentType" NOT NULL DEFAULT 'ALL',
    "excludedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "frequency" "ScheduleFrequency" NOT NULL,
    "frequencyCount" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ppeItems" JSONB NOT NULL,
    "specificDate" TIMESTAMP(3),
    "dayOfMonth" INTEGER,
    "dayOfWeek" "DayOfWeek",
    "month" "Month",
    "customMonths" "Month"[],
    "weeklyConfigId" TEXT,
    "monthlyConfigId" TEXT,
    "yearlyConfigId" TEXT,
    "nextRun" TIMESTAMP(3),
    "lastRun" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PpeDeliverySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "thumbnailUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonetaryValue" (
    "id" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "itemId" TEXT,
    "positionId" TEXT,

    CONSTRAINT "MonetaryValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measure" (
    "id" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "unit" "MeasureUnit",
    "measureType" "MeasureType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uniCode" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxQuantity" DOUBLE PRECISION,
    "reorderPoint" DOUBLE PRECISION,
    "reorderQuantity" DOUBLE PRECISION,
    "boxQuantity" INTEGER,
    "totalPrice" DOUBLE PRECISION,
    "monthlyConsumption" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "monthlyConsumptionTrendPercent" DECIMAL(5,2),
    "barcodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shouldAssignToUser" BOOLEAN NOT NULL DEFAULT true,
    "abcCategory" "AbcCategory",
    "abcCategoryOrder" INTEGER,
    "xyzCategory" "XyzCategory",
    "xyzCategoryOrder" INTEGER,
    "brandId" TEXT,
    "categoryId" TEXT,
    "supplierId" TEXT,
    "estimatedLeadTime" INTEGER DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ppeType" "PpeType",
    "ppeCA" TEXT,
    "ppeDeliveryMode" "PpeDeliveryMode",
    "ppeStandardQuantity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "icms" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ipi" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyScheduleConfig" (
    "id" TEXT NOT NULL,
    "monday" BOOLEAN NOT NULL DEFAULT false,
    "tuesday" BOOLEAN NOT NULL DEFAULT false,
    "wednesday" BOOLEAN NOT NULL DEFAULT false,
    "thursday" BOOLEAN NOT NULL DEFAULT false,
    "friday" BOOLEAN NOT NULL DEFAULT false,
    "saturday" BOOLEAN NOT NULL DEFAULT false,
    "sunday" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyScheduleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyScheduleConfig" (
    "id" TEXT NOT NULL,
    "dayOfMonth" INTEGER,
    "occurrence" "MonthOccurrence",
    "dayOfWeek" "DayOfWeek",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyScheduleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YearlyScheduleConfig" (
    "id" TEXT NOT NULL,
    "month" "Month" NOT NULL,
    "dayOfMonth" INTEGER,
    "occurrence" "MonthOccurrence",
    "dayOfWeek" "DayOfWeek",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YearlyScheduleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRule" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "supplierId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "triggerType" "OrderTriggerType" NOT NULL,
    "consumptionDays" INTEGER,
    "safetyStockDays" INTEGER,
    "minOrderQuantity" DOUBLE PRECISION,
    "maxOrderQuantity" DOUBLE PRECISION,
    "orderMultiple" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemBrand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ItemCategoryType" NOT NULL DEFAULT 'REGULAR',
    "typeOrder" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalWithdrawal" (
    "id" TEXT NOT NULL,
    "withdrawerName" TEXT NOT NULL,
    "type" "ExternalWithdrawalType" NOT NULL DEFAULT 'RETURNABLE',
    "status" "ExternalWithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalWithdrawalItem" (
    "id" TEXT NOT NULL,
    "externalWithdrawalId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "withdrawedQuantity" DOUBLE PRECISION NOT NULL,
    "returnedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalWithdrawalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Maintenance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "itemId" TEXT NOT NULL,
    "maintenanceScheduleId" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "timeTaken" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceItem" (
    "id" TEXT NOT NULL,
    "maintenanceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "itemId" TEXT,
    "frequency" "ScheduleFrequency" NOT NULL,
    "frequencyCount" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" "MaintenanceScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "maintenanceItemsConfig" JSONB,
    "specificDate" TIMESTAMP(3),
    "dayOfMonth" INTEGER,
    "dayOfWeek" "DayOfWeek",
    "month" "Month",
    "customMonths" "Month"[],
    "weeklyConfigId" TEXT,
    "monthlyConfigId" TEXT,
    "yearlyConfigId" TEXT,
    "nextRun" TIMESTAMP(3),
    "lastRun" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "lastRunId" TEXT,
    "originalScheduleId" TEXT,

    CONSTRAINT "MaintenanceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "forecast" TIMESTAMP(3),
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "supplierId" TEXT,
    "orderScheduleId" TEXT,
    "orderRuleId" TEXT,
    "ppeScheduleId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT,
    "orderedQuantity" DOUBLE PRECISION NOT NULL,
    "receivedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "temporaryItemDescription" TEXT,
    "icms" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ipi" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSchedule" (
    "id" TEXT NOT NULL,
    "frequency" "ScheduleFrequency" NOT NULL,
    "frequencyCount" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "items" TEXT[],
    "specificDate" TIMESTAMP(3),
    "dayOfMonth" INTEGER,
    "dayOfWeek" "DayOfWeek",
    "month" "Month",
    "customMonths" "Month"[],
    "weeklyConfigId" TEXT,
    "monthlyConfigId" TEXT,
    "yearlyConfigId" TEXT,
    "nextRun" TIMESTAMP(3),
    "lastRun" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "lastRunId" TEXT,
    "originalScheduleId" TEXT,

    CONSTRAINT "OrderSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintProduction" (
    "id" TEXT NOT NULL,
    "volumeLiters" DOUBLE PRECISION NOT NULL,
    "formulaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintProduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "finish" "PaintFinish" NOT NULL,
    "manufacturer" "TruckManufacturer",
    "tags" TEXT[],
    "palette" "ColorPalette" NOT NULL DEFAULT 'BLACK',
    "paletteOrder" INTEGER NOT NULL DEFAULT 1,
    "paintTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT,
    "paintBrandId" TEXT,
    "colorOrder" INTEGER NOT NULL DEFAULT 0,
    "colorPreview" TEXT,

    CONSTRAINT "Paint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintBrand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "needGround" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintGround" (
    "id" TEXT NOT NULL,
    "paintId" TEXT NOT NULL,
    "groundPaintId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintGround_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintFormula" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT 'Cor criada.',
    "paintId" TEXT NOT NULL,
    "density" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "pricePerLiter" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintFormula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintFormulaComponent" (
    "id" TEXT NOT NULL,
    "ratio" DOUBLE PRECISION NOT NULL,
    "itemId" TEXT NOT NULL,
    "formulaPaintId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "weight" DOUBLE PRECISION,

    CONSTRAINT "PaintFormulaComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bonifiable" BOOLEAN NOT NULL DEFAULT true,
    "hierarchy" INTEGER,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warning" (
    "id" TEXT NOT NULL,
    "description" TEXT,
    "collaboratorId" TEXT NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "category" "WarningCategory" NOT NULL,
    "severity" "WarningSeverity" NOT NULL,
    "severityOrder" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hrNotes" TEXT,
    "followUpDate" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "privileges" "SectorPrivileges" NOT NULL DEFAULT 'BASIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceOrder" (
    "id" TEXT NOT NULL,
    "status" "ServiceOrderStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "expiresIn" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetItem" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "budgetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "fantasyName" TEXT NOT NULL,
    "cnpj" TEXT,
    "corporateName" TEXT,
    "email" TEXT,
    "address" TEXT,
    "addressNumber" TEXT,
    "addressComplement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "site" TEXT,
    "phones" TEXT[],
    "logoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "streetType" "StreetType",
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "serialNumber" TEXT,
    "details" TEXT,
    "entryDate" TIMESTAMP(3),
    "term" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "paintId" TEXT,
    "customerId" TEXT,
    "sectorId" TEXT,
    "commission" "CommissionStatus" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bonusDiscountId" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cut" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "type" "CutType" NOT NULL,
    "taskId" TEXT,
    "origin" "CutOrigin" NOT NULL DEFAULT 'PLAN',
    "reason" "CutRequestReason",
    "parentCutId" TEXT,
    "status" "CutStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Truck" (
    "id" TEXT NOT NULL,
    "plate" TEXT,
    "chassisNumber" TEXT,
    "xPosition" DOUBLE PRECISION,
    "yPosition" DOUBLE PRECISION,
    "taskId" TEXT NOT NULL,
    "garageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "backSideLayoutId" TEXT,
    "leftSideLayoutId" TEXT,
    "rightSideLayoutId" TEXT,

    CONSTRAINT "Truck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Layout" (
    "id" TEXT NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "photoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Layout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayoutSection" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "isDoor" BOOLEAN NOT NULL DEFAULT false,
    "doorHeight" DOUBLE PRECISION,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LayoutSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Garage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "length" DOUBLE PRECISION NOT NULL DEFAULT 45,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Garage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecullumToken" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenType" TEXT NOT NULL DEFAULT 'Bearer',
    "expiresIn" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT,
    "identifier" TEXT NOT NULL DEFAULT 'default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecullumToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "payrollNumber" INTEGER,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'EXPERIENCE_PERIOD_1',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "phone" TEXT,
    "password" TEXT,
    "positionId" TEXT,
    "preferenceId" TEXT,
    "pis" TEXT,
    "cpf" TEXT,
    "address" TEXT,
    "addressNumber" TEXT,
    "addressComplement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "site" TEXT,
    "birth" TIMESTAMP(3),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "admissional" TIMESTAMP(3),
    "sectorId" TEXT,
    "managedSectorId" TEXT,
    "requirePasswordChange" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "verificationCode" TEXT,
    "verificationExpiresAt" TIMESTAMP(3),
    "verificationType" "VerificationType",
    "sessionToken" TEXT,
    "secullum_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "performanceLevel" INTEGER NOT NULL DEFAULT 0,
    "effectedAt" TIMESTAMP(3),
    "exp1StartAt" TIMESTAMP(3),
    "exp1EndAt" TIMESTAMP(3),
    "exp2StartAt" TIMESTAMP(3),
    "exp2EndAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "avatarId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "unionMember" BOOLEAN NOT NULL DEFAULT false,
    "unionAuthorizationDate" TIMESTAMP(3),
    "dependentsCount" INTEGER NOT NULL DEFAULT 0,
    "hasSimplifiedDeduction" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vacation" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isCollective" BOOLEAN NOT NULL DEFAULT false,
    "status" "VacationStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "type" "VacationType" NOT NULL DEFAULT 'COLLECTIVE',
    "typeOrder" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vacation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "colorSchema" "ColorSchema" NOT NULL DEFAULT 'LIGHT',
    "favorites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "channels" "NotificationChannel"[],
    "importance" "NotificationImportance" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel"[],
    "importance" "NotificationImportance" NOT NULL DEFAULT 'NORMAL',
    "actionType" "NotificationActionType",
    "actionUrl" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeenNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeenNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thumbnail_jobs" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "job_id" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "progress" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "thumbnail_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "git_url" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "git_commits" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "short_hash" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "author_email" TEXT NOT NULL,
    "committed_at" TIMESTAMP(3) NOT NULL,
    "branch" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "files_changed" INTEGER NOT NULL DEFAULT 0,
    "insertions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "git_commits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apps" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "app_type" "AppType" NOT NULL,
    "build_command" TEXT,
    "deploy_command" TEXT,
    "health_check_url" TEXT,
    "environment_vars" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL,
    "environment" "DeploymentEnvironment" NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'PENDING',
    "status_order" INTEGER NOT NULL DEFAULT 2,
    "deployed_by" TEXT,
    "version" TEXT,
    "rollback_data" JSONB,
    "deployment_log" TEXT,
    "health_check_url" TEXT,
    "health_check_status" TEXT,
    "completed_at" TIMESTAMP(3),
    "rolled_back_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "app_id" TEXT NOT NULL,
    "git_commit_id" TEXT NOT NULL,
    "triggered_by" "DeploymentTrigger" NOT NULL DEFAULT 'MANUAL',
    "build_number" INTEGER,
    "previous_deployment_id" TEXT,
    "workflow_run_id" TEXT,
    "workflow_url" TEXT,
    "duration" INTEGER,
    "build_log" TEXT,
    "error_message" TEXT,
    "error_stack" TEXT,
    "health_check_log" TEXT,
    "can_rollback" BOOLEAN NOT NULL DEFAULT true,
    "rollback_reason" TEXT,
    "started_at" TIMESTAMP(3),

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_logs" (
    "id" TEXT NOT NULL,
    "deployment_id" TEXT NOT NULL,
    "level" "DeploymentLogLevel" NOT NULL,
    "phase" "DeploymentPhase" NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "stack_trace" TEXT,
    "source" TEXT,
    "duration" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_metrics" (
    "id" TEXT NOT NULL,
    "deployment_id" TEXT NOT NULL,
    "metric_type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AIRBRUSHING_ARTWORKS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AIRBRUSHING_ARTWORKS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_AIRBRUSHING_BUDGETS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AIRBRUSHING_BUDGETS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_AIRBRUSHING_INVOICES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AIRBRUSHING_INVOICES_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_AIRBRUSHING_INVOICE_REIMBURSEMENTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AIRBRUSHING_INVOICE_REIMBURSEMENTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_AIRBRUSHING_RECEIPTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AIRBRUSHING_RECEIPTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_AIRBRUSHING_REIMBURSEMENTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AIRBRUSHING_REIMBURSEMENTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_BonusPeriodUsers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BonusPeriodUsers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_BonusTasks" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BonusTasks_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_FileToWarning" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FileToWarning_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_OBSERVATIONS_FILES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_OBSERVATIONS_FILES_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ORDER_BUDGETS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ORDER_BUDGETS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ORDER_INVOICES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ORDER_INVOICES_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ORDER_INVOICE_REIMBURSEMENTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ORDER_INVOICE_REIMBURSEMENTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ORDER_RECEIPTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ORDER_RECEIPTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ORDER_REIMBURSEMENTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ORDER_REIMBURSEMENTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TASK_BUDGETS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TASK_BUDGETS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TASK_FILES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TASK_FILES_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TASK_INVOICES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TASK_INVOICES_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TASK_INVOICE_REIMBURSEMENTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TASK_INVOICE_REIMBURSEMENTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TASK_RECEIPTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TASK_RECEIPTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TASK_REIMBURSEMENTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TASK_REIMBURSEMENTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_PAINT_BRAND_COMPONENT_ITEMS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PAINT_BRAND_COMPONENT_ITEMS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_PAINT_TYPE_COMPONENT_ITEMS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PAINT_TYPE_COMPONENT_ITEMS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_RelatedItems" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RelatedItems_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_EXTERNAL_WITHDRAWAL_INVOICES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_EXTERNAL_WITHDRAWAL_INVOICES_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_EXTERNAL_WITHDRAWAL_INVOICE_REIMBURSEMENTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_EXTERNAL_WITHDRAWAL_INVOICE_REIMBURSEMENTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_EXTERNAL_WITHDRAWAL_RECEIPTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_EXTERNAL_WITHDRAWAL_RECEIPTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_EXTERNAL_WITHDRAWAL_REIMBURSEMENTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_EXTERNAL_WITHDRAWAL_REIMBURSEMENTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_RelatedPaints" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RelatedPaints_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TASK_LOGO_PAINT" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TASK_LOGO_PAINT_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_RelatedTasks" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RelatedTasks_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_WITNESS_WARNING" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_WITNESS_WARNING_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_NotificationPreferenceToPreferences" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_NotificationPreferenceToPreferences_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Activity_itemId_idx" ON "Activity"("itemId");

-- CreateIndex
CREATE INDEX "Activity_userId_idx" ON "Activity"("userId");

-- CreateIndex
CREATE INDEX "Activity_orderId_idx" ON "Activity"("orderId");

-- CreateIndex
CREATE INDEX "Activity_orderItemId_idx" ON "Activity"("orderItemId");

-- CreateIndex
CREATE INDEX "Activity_createdAt_idx" ON "Activity"("createdAt");

-- CreateIndex
CREATE INDEX "Activity_reasonOrder_idx" ON "Activity"("reasonOrder");

-- CreateIndex
CREATE INDEX "Airbrushing_statusOrder_idx" ON "Airbrushing"("statusOrder");

-- CreateIndex
CREATE INDEX "Borrow_itemId_idx" ON "Borrow"("itemId");

-- CreateIndex
CREATE INDEX "Borrow_userId_idx" ON "Borrow"("userId");

-- CreateIndex
CREATE INDEX "Borrow_status_statusOrder_idx" ON "Borrow"("status", "statusOrder");

-- CreateIndex
CREATE INDEX "ChangeLog_entityType_entityId_idx" ON "ChangeLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ChangeLog_createdAt_idx" ON "ChangeLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Bonus_payrollId_key" ON "Bonus"("payrollId");

-- CreateIndex
CREATE INDEX "Bonus_userId_idx" ON "Bonus"("userId");

-- CreateIndex
CREATE INDEX "Bonus_year_month_idx" ON "Bonus"("year", "month");

-- CreateIndex
CREATE INDEX "Bonus_weightedTasks_idx" ON "Bonus"("weightedTasks");

-- CreateIndex
CREATE INDEX "Bonus_averageTaskPerUser_idx" ON "Bonus"("averageTaskPerUser");

-- CreateIndex
CREATE INDEX "Bonus_netBonus_idx" ON "Bonus"("netBonus");

-- CreateIndex
CREATE UNIQUE INDEX "Bonus_userId_year_month_key" ON "Bonus"("userId", "year", "month");

-- CreateIndex
CREATE INDEX "Payroll_userId_idx" ON "Payroll"("userId");

-- CreateIndex
CREATE INDEX "Payroll_year_month_idx" ON "Payroll"("year", "month");

-- CreateIndex
CREATE INDEX "Payroll_positionId_idx" ON "Payroll"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_userId_year_month_key" ON "Payroll"("userId", "year", "month");

-- CreateIndex
CREATE INDEX "BonusDiscount_bonusId_idx" ON "BonusDiscount"("bonusId");

-- CreateIndex
CREATE INDEX "BonusDiscount_calculationOrder_idx" ON "BonusDiscount"("calculationOrder");

-- CreateIndex
CREATE INDEX "PayrollDiscount_payrollId_idx" ON "PayrollDiscount"("payrollId");

-- CreateIndex
CREATE INDEX "PayrollDiscount_discountType_idx" ON "PayrollDiscount"("discountType");

-- CreateIndex
CREATE INDEX "PayrollDiscount_isPersistent_idx" ON "PayrollDiscount"("isPersistent");

-- CreateIndex
CREATE INDEX "PayrollDiscount_isActive_idx" ON "PayrollDiscount"("isActive");

-- CreateIndex
CREATE INDEX "PayrollDiscount_taxYear_idx" ON "PayrollDiscount"("taxYear");

-- CreateIndex
CREATE INDEX "TaxTable_taxType_year_idx" ON "TaxTable"("taxType", "year");

-- CreateIndex
CREATE INDEX "TaxTable_isActive_idx" ON "TaxTable"("isActive");

-- CreateIndex
CREATE INDEX "TaxTable_effectiveFrom_idx" ON "TaxTable"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TaxTable_taxType_year_isActive_key" ON "TaxTable"("taxType", "year", "isActive");

-- CreateIndex
CREATE INDEX "TaxBracket_taxTableId_idx" ON "TaxBracket"("taxTableId");

-- CreateIndex
CREATE INDEX "TaxBracket_bracketOrder_idx" ON "TaxBracket"("bracketOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TaxBracket_taxTableId_bracketOrder_key" ON "TaxBracket"("taxTableId", "bracketOrder");

-- CreateIndex
CREATE UNIQUE INDEX "EconomicActivity_code_key" ON "EconomicActivity"("code");

-- CreateIndex
CREATE INDEX "EconomicActivity_code_idx" ON "EconomicActivity"("code");

-- CreateIndex
CREATE INDEX "EconomicActivity_description_idx" ON "EconomicActivity"("description");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_fantasyName_key" ON "Customer"("fantasyName");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_cnpj_key" ON "Customer"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_cpf_key" ON "Customer"("cpf");

-- CreateIndex
CREATE INDEX "Customer_fantasyName_idx" ON "Customer"("fantasyName");

-- CreateIndex
CREATE INDEX "Customer_cpf_idx" ON "Customer"("cpf");

-- CreateIndex
CREATE INDEX "Customer_neighborhood_idx" ON "Customer"("neighborhood");

-- CreateIndex
CREATE INDEX "Customer_zipCode_idx" ON "Customer"("zipCode");

-- CreateIndex
CREATE INDEX "Customer_economicActivityId_idx" ON "Customer"("economicActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "PpeSize_userId_key" ON "PpeSize"("userId");

-- CreateIndex
CREATE INDEX "PpeDelivery_userId_idx" ON "PpeDelivery"("userId");

-- CreateIndex
CREATE INDEX "PpeDelivery_itemId_idx" ON "PpeDelivery"("itemId");

-- CreateIndex
CREATE INDEX "PpeDelivery_ppeScheduleId_idx" ON "PpeDelivery"("ppeScheduleId");

-- CreateIndex
CREATE INDEX "PpeDelivery_scheduledDate_idx" ON "PpeDelivery"("scheduledDate");

-- CreateIndex
CREATE INDEX "PpeDelivery_status_statusOrder_idx" ON "PpeDelivery"("status", "statusOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PpeDeliverySchedule_weeklyConfigId_key" ON "PpeDeliverySchedule"("weeklyConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "PpeDeliverySchedule_monthlyConfigId_key" ON "PpeDeliverySchedule"("monthlyConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "PpeDeliverySchedule_yearlyConfigId_key" ON "PpeDeliverySchedule"("yearlyConfigId");

-- CreateIndex
CREATE INDEX "PpeDeliverySchedule_nextRun_idx" ON "PpeDeliverySchedule"("nextRun");

-- CreateIndex
CREATE INDEX "PpeDeliverySchedule_isActive_idx" ON "PpeDeliverySchedule"("isActive");

-- CreateIndex
CREATE INDEX "PpeDeliverySchedule_assignmentType_idx" ON "PpeDeliverySchedule"("assignmentType");

-- CreateIndex
CREATE INDEX "File_filename_idx" ON "File"("filename");

-- CreateIndex
CREATE INDEX "File_originalName_idx" ON "File"("originalName");

-- CreateIndex
CREATE INDEX "File_mimetype_idx" ON "File"("mimetype");

-- CreateIndex
CREATE INDEX "File_path_idx" ON "File"("path");

-- CreateIndex
CREATE INDEX "MonetaryValue_current_idx" ON "MonetaryValue"("current");

-- CreateIndex
CREATE INDEX "MonetaryValue_itemId_idx" ON "MonetaryValue"("itemId");

-- CreateIndex
CREATE INDEX "MonetaryValue_positionId_idx" ON "MonetaryValue"("positionId");

-- CreateIndex
CREATE INDEX "MonetaryValue_itemId_current_idx" ON "MonetaryValue"("itemId", "current");

-- CreateIndex
CREATE INDEX "MonetaryValue_positionId_current_idx" ON "MonetaryValue"("positionId", "current");

-- CreateIndex
CREATE INDEX "Measure_itemId_idx" ON "Measure"("itemId");

-- CreateIndex
CREATE INDEX "Measure_measureType_idx" ON "Measure"("measureType");

-- CreateIndex
CREATE INDEX "Item_shouldAssignToUser_idx" ON "Item"("shouldAssignToUser");

-- CreateIndex
CREATE INDEX "Item_categoryId_brandId_idx" ON "Item"("categoryId", "brandId");

-- CreateIndex
CREATE INDEX "Item_name_idx" ON "Item"("name");

-- CreateIndex
CREATE INDEX "Item_isActive_idx" ON "Item"("isActive");

-- CreateIndex
CREATE INDEX "Item_supplierId_idx" ON "Item"("supplierId");

-- CreateIndex
CREATE INDEX "Item_abcCategory_abcCategoryOrder_idx" ON "Item"("abcCategory", "abcCategoryOrder");

-- CreateIndex
CREATE INDEX "Item_xyzCategory_xyzCategoryOrder_idx" ON "Item"("xyzCategory", "xyzCategoryOrder");

-- CreateIndex
CREATE INDEX "Item_ppeType_idx" ON "Item"("ppeType");

-- CreateIndex
CREATE INDEX "Item_categoryId_ppeType_idx" ON "Item"("categoryId", "ppeType");

-- CreateIndex
CREATE INDEX "OrderRule_itemId_idx" ON "OrderRule"("itemId");

-- CreateIndex
CREATE INDEX "OrderRule_supplierId_idx" ON "OrderRule"("supplierId");

-- CreateIndex
CREATE INDEX "OrderRule_isActive_idx" ON "OrderRule"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ItemBrand_name_key" ON "ItemBrand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_name_key" ON "ItemCategory"("name");

-- CreateIndex
CREATE INDEX "ItemCategory_type_typeOrder_idx" ON "ItemCategory"("type", "typeOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_taskId_key" ON "Observation"("taskId");

-- CreateIndex
CREATE INDEX "Observation_taskId_idx" ON "Observation"("taskId");

-- CreateIndex
CREATE INDEX "Observation_createdAt_idx" ON "Observation"("createdAt");

-- CreateIndex
CREATE INDEX "ExternalWithdrawal_withdrawerName_idx" ON "ExternalWithdrawal"("withdrawerName");

-- CreateIndex
CREATE INDEX "ExternalWithdrawal_type_idx" ON "ExternalWithdrawal"("type");

-- CreateIndex
CREATE INDEX "ExternalWithdrawal_status_statusOrder_idx" ON "ExternalWithdrawal"("status", "statusOrder");

-- CreateIndex
CREATE INDEX "ExternalWithdrawal_createdAt_idx" ON "ExternalWithdrawal"("createdAt");

-- CreateIndex
CREATE INDEX "ExternalWithdrawalItem_externalWithdrawalId_idx" ON "ExternalWithdrawalItem"("externalWithdrawalId");

-- CreateIndex
CREATE INDEX "ExternalWithdrawalItem_itemId_idx" ON "ExternalWithdrawalItem"("itemId");

-- CreateIndex
CREATE INDEX "Maintenance_itemId_idx" ON "Maintenance"("itemId");

-- CreateIndex
CREATE INDEX "Maintenance_status_idx" ON "Maintenance"("status");

-- CreateIndex
CREATE INDEX "Maintenance_statusOrder_idx" ON "Maintenance"("statusOrder");

-- CreateIndex
CREATE INDEX "Maintenance_maintenanceScheduleId_idx" ON "Maintenance"("maintenanceScheduleId");

-- CreateIndex
CREATE INDEX "Maintenance_scheduledFor_idx" ON "Maintenance"("scheduledFor");

-- CreateIndex
CREATE INDEX "MaintenanceItem_maintenanceId_idx" ON "MaintenanceItem"("maintenanceId");

-- CreateIndex
CREATE INDEX "MaintenanceItem_itemId_idx" ON "MaintenanceItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceSchedule_weeklyConfigId_key" ON "MaintenanceSchedule"("weeklyConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceSchedule_monthlyConfigId_key" ON "MaintenanceSchedule"("monthlyConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceSchedule_yearlyConfigId_key" ON "MaintenanceSchedule"("yearlyConfigId");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_itemId_idx" ON "MaintenanceSchedule"("itemId");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_nextRun_idx" ON "MaintenanceSchedule"("nextRun");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_status_statusOrder_idx" ON "MaintenanceSchedule"("status", "statusOrder");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_lastRunId_idx" ON "MaintenanceSchedule"("lastRunId");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_originalScheduleId_idx" ON "MaintenanceSchedule"("originalScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderScheduleId_key" ON "Order"("orderScheduleId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_statusOrder_idx" ON "Order"("statusOrder");

-- CreateIndex
CREATE INDEX "Order_supplierId_idx" ON "Order"("supplierId");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_ppeScheduleId_idx" ON "Order"("ppeScheduleId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_itemId_idx" ON "OrderItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSchedule_weeklyConfigId_key" ON "OrderSchedule"("weeklyConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSchedule_monthlyConfigId_key" ON "OrderSchedule"("monthlyConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSchedule_yearlyConfigId_key" ON "OrderSchedule"("yearlyConfigId");

-- CreateIndex
CREATE INDEX "OrderSchedule_nextRun_idx" ON "OrderSchedule"("nextRun");

-- CreateIndex
CREATE INDEX "OrderSchedule_lastRunId_idx" ON "OrderSchedule"("lastRunId");

-- CreateIndex
CREATE INDEX "OrderSchedule_originalScheduleId_idx" ON "OrderSchedule"("originalScheduleId");

-- CreateIndex
CREATE INDEX "PaintProduction_formulaId_idx" ON "PaintProduction"("formulaId");

-- CreateIndex
CREATE INDEX "Paint_name_idx" ON "Paint"("name");

-- CreateIndex
CREATE INDEX "Paint_paintTypeId_idx" ON "Paint"("paintTypeId");

-- CreateIndex
CREATE INDEX "Paint_paintBrandId_idx" ON "Paint"("paintBrandId");

-- CreateIndex
CREATE INDEX "Paint_paintTypeId_paintBrandId_idx" ON "Paint"("paintTypeId", "paintBrandId");

-- CreateIndex
CREATE INDEX "Paint_palette_paletteOrder_idx" ON "Paint"("palette", "paletteOrder");

-- CreateIndex
CREATE INDEX "Paint_colorOrder_idx" ON "Paint"("colorOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PaintBrand_name_key" ON "PaintBrand"("name");

-- CreateIndex
CREATE INDEX "PaintBrand_name_idx" ON "PaintBrand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PaintType_name_key" ON "PaintType"("name");

-- CreateIndex
CREATE INDEX "PaintType_name_idx" ON "PaintType"("name");

-- CreateIndex
CREATE INDEX "PaintGround_paintId_idx" ON "PaintGround"("paintId");

-- CreateIndex
CREATE INDEX "PaintGround_groundPaintId_idx" ON "PaintGround"("groundPaintId");

-- CreateIndex
CREATE UNIQUE INDEX "PaintGround_paintId_groundPaintId_key" ON "PaintGround"("paintId", "groundPaintId");

-- CreateIndex
CREATE INDEX "PaintFormula_paintId_idx" ON "PaintFormula"("paintId");

-- CreateIndex
CREATE INDEX "PaintFormulaComponent_itemId_idx" ON "PaintFormulaComponent"("itemId");

-- CreateIndex
CREATE INDEX "PaintFormulaComponent_formulaPaintId_idx" ON "PaintFormulaComponent"("formulaPaintId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_name_key" ON "Position"("name");

-- CreateIndex
CREATE INDEX "Position_name_idx" ON "Position"("name");

-- CreateIndex
CREATE INDEX "Position_hierarchy_idx" ON "Position"("hierarchy");

-- CreateIndex
CREATE INDEX "Warning_collaboratorId_idx" ON "Warning"("collaboratorId");

-- CreateIndex
CREATE INDEX "Warning_severityOrder_idx" ON "Warning"("severityOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Service_description_key" ON "Service"("description");

-- CreateIndex
CREATE INDEX "ServiceOrder_taskId_idx" ON "ServiceOrder"("taskId");

-- CreateIndex
CREATE INDEX "ServiceOrder_statusOrder_idx" ON "ServiceOrder"("statusOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_taskId_key" ON "Budget"("taskId");

-- CreateIndex
CREATE INDEX "Budget_taskId_idx" ON "Budget"("taskId");

-- CreateIndex
CREATE INDEX "BudgetItem_budgetId_idx" ON "BudgetItem"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_fantasyName_key" ON "Supplier"("fantasyName");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_cnpj_key" ON "Supplier"("cnpj");

-- CreateIndex
CREATE INDEX "Supplier_fantasyName_idx" ON "Supplier"("fantasyName");

-- CreateIndex
CREATE INDEX "Supplier_cnpj_idx" ON "Supplier"("cnpj");

-- CreateIndex
CREATE INDEX "Supplier_state_idx" ON "Supplier"("state");

-- CreateIndex
CREATE INDEX "Supplier_city_idx" ON "Supplier"("city");

-- CreateIndex
CREATE UNIQUE INDEX "Task_serialNumber_key" ON "Task"("serialNumber");

-- CreateIndex
CREATE INDEX "Task_status_sectorId_idx" ON "Task"("status", "sectorId");

-- CreateIndex
CREATE INDEX "Task_statusOrder_idx" ON "Task"("statusOrder");

-- CreateIndex
CREATE INDEX "Task_term_idx" ON "Task"("term");

-- CreateIndex
CREATE INDEX "Task_createdAt_idx" ON "Task"("createdAt");

-- CreateIndex
CREATE INDEX "Task_customerId_idx" ON "Task"("customerId");

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");

-- CreateIndex
CREATE INDEX "Cut_status_idx" ON "Cut"("status");

-- CreateIndex
CREATE INDEX "Cut_statusOrder_idx" ON "Cut"("statusOrder");

-- CreateIndex
CREATE INDEX "Cut_taskId_idx" ON "Cut"("taskId");

-- CreateIndex
CREATE INDEX "Cut_parentCutId_idx" ON "Cut"("parentCutId");

-- CreateIndex
CREATE INDEX "Cut_origin_idx" ON "Cut"("origin");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_plate_key" ON "Truck"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_taskId_key" ON "Truck"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_backSideLayoutId_key" ON "Truck"("backSideLayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_leftSideLayoutId_key" ON "Truck"("leftSideLayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_rightSideLayoutId_key" ON "Truck"("rightSideLayoutId");

-- CreateIndex
CREATE INDEX "Truck_garageId_idx" ON "Truck"("garageId");

-- CreateIndex
CREATE INDEX "Truck_plate_idx" ON "Truck"("plate");

-- CreateIndex
CREATE INDEX "LayoutSection_layoutId_position_idx" ON "LayoutSection"("layoutId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SecullumToken_identifier_key" ON "SecullumToken"("identifier");

-- CreateIndex
CREATE INDEX "SecullumToken_expiresAt_idx" ON "SecullumToken"("expiresAt");

-- CreateIndex
CREATE INDEX "SecullumToken_identifier_idx" ON "SecullumToken"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_preferenceId_key" ON "User"("preferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "User_pis_key" ON "User"("pis");

-- CreateIndex
CREATE UNIQUE INDEX "User_cpf_key" ON "User"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "User_sessionToken_key" ON "User"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_secullum_id_key" ON "User"("secullum_id");

-- CreateIndex
CREATE INDEX "User_status_sectorId_idx" ON "User"("status", "sectorId");

-- CreateIndex
CREATE INDEX "User_statusOrder_idx" ON "User"("statusOrder");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "User_exp1StartAt_idx" ON "User"("exp1StartAt");

-- CreateIndex
CREATE INDEX "User_exp1EndAt_idx" ON "User"("exp1EndAt");

-- CreateIndex
CREATE INDEX "User_exp2StartAt_idx" ON "User"("exp2StartAt");

-- CreateIndex
CREATE INDEX "User_exp2EndAt_idx" ON "User"("exp2EndAt");

-- CreateIndex
CREATE INDEX "User_effectedAt_idx" ON "User"("effectedAt");

-- CreateIndex
CREATE INDEX "User_dismissedAt_idx" ON "User"("dismissedAt");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_email_phone_idx" ON "User"("email", "phone");

-- CreateIndex
CREATE INDEX "User_verificationCode_idx" ON "User"("verificationCode");

-- CreateIndex
CREATE INDEX "User_verificationExpiresAt_idx" ON "User"("verificationExpiresAt");

-- CreateIndex
CREATE INDEX "User_verificationType_idx" ON "User"("verificationType");

-- CreateIndex
CREATE INDEX "User_sessionToken_idx" ON "User"("sessionToken");

-- CreateIndex
CREATE INDEX "User_verified_idx" ON "User"("verified");

-- CreateIndex
CREATE INDEX "User_admissional_idx" ON "User"("admissional");

-- CreateIndex
CREATE INDEX "Vacation_userId_idx" ON "Vacation"("userId");

-- CreateIndex
CREATE INDEX "Vacation_startAt_endAt_idx" ON "Vacation"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "Vacation_statusOrder_idx" ON "Vacation"("statusOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Preferences_userId_key" ON "Preferences"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_scheduledAt_idx" ON "Notification"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeenNotification_userId_notificationId_key" ON "SeenNotification"("userId", "notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "thumbnail_jobs_file_id_key" ON "thumbnail_jobs"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_name_key" ON "repositories"("name");

-- CreateIndex
CREATE INDEX "git_commits_repository_id_idx" ON "git_commits"("repository_id");

-- CreateIndex
CREATE INDEX "git_commits_committed_at_idx" ON "git_commits"("committed_at");

-- CreateIndex
CREATE INDEX "git_commits_branch_idx" ON "git_commits"("branch");

-- CreateIndex
CREATE UNIQUE INDEX "git_commits_repository_id_hash_key" ON "git_commits"("repository_id", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "apps_name_key" ON "apps"("name");

-- CreateIndex
CREATE INDEX "apps_repository_id_idx" ON "apps"("repository_id");

-- CreateIndex
CREATE INDEX "apps_app_type_idx" ON "apps"("app_type");

-- CreateIndex
CREATE UNIQUE INDEX "deployments_previous_deployment_id_key" ON "deployments"("previous_deployment_id");

-- CreateIndex
CREATE INDEX "deployments_app_id_environment_status_idx" ON "deployments"("app_id", "environment", "status");

-- CreateIndex
CREATE INDEX "deployments_git_commit_id_idx" ON "deployments"("git_commit_id");

-- CreateIndex
CREATE INDEX "deployments_app_id_environment_idx" ON "deployments"("app_id", "environment");

-- CreateIndex
CREATE INDEX "deployments_created_at_idx" ON "deployments"("created_at");

-- CreateIndex
CREATE INDEX "deployments_status_order_idx" ON "deployments"("status_order");

-- CreateIndex
CREATE INDEX "deployments_triggered_by_idx" ON "deployments"("triggered_by");

-- CreateIndex
CREATE INDEX "deployment_logs_deployment_id_idx" ON "deployment_logs"("deployment_id");

-- CreateIndex
CREATE INDEX "deployment_logs_deployment_id_phase_idx" ON "deployment_logs"("deployment_id", "phase");

-- CreateIndex
CREATE INDEX "deployment_logs_level_idx" ON "deployment_logs"("level");

-- CreateIndex
CREATE INDEX "deployment_logs_created_at_idx" ON "deployment_logs"("created_at");

-- CreateIndex
CREATE INDEX "deployment_metrics_deployment_id_idx" ON "deployment_metrics"("deployment_id");

-- CreateIndex
CREATE INDEX "deployment_metrics_metric_type_idx" ON "deployment_metrics"("metric_type");

-- CreateIndex
CREATE INDEX "_AIRBRUSHING_ARTWORKS_B_index" ON "_AIRBRUSHING_ARTWORKS"("B");

-- CreateIndex
CREATE INDEX "_AIRBRUSHING_BUDGETS_B_index" ON "_AIRBRUSHING_BUDGETS"("B");

-- CreateIndex
CREATE INDEX "_AIRBRUSHING_INVOICES_B_index" ON "_AIRBRUSHING_INVOICES"("B");

-- CreateIndex
CREATE INDEX "_AIRBRUSHING_INVOICE_REIMBURSEMENTS_B_index" ON "_AIRBRUSHING_INVOICE_REIMBURSEMENTS"("B");

-- CreateIndex
CREATE INDEX "_AIRBRUSHING_RECEIPTS_B_index" ON "_AIRBRUSHING_RECEIPTS"("B");

-- CreateIndex
CREATE INDEX "_AIRBRUSHING_REIMBURSEMENTS_B_index" ON "_AIRBRUSHING_REIMBURSEMENTS"("B");

-- CreateIndex
CREATE INDEX "_BonusPeriodUsers_B_index" ON "_BonusPeriodUsers"("B");

-- CreateIndex
CREATE INDEX "_BonusTasks_B_index" ON "_BonusTasks"("B");

-- CreateIndex
CREATE INDEX "_FileToWarning_B_index" ON "_FileToWarning"("B");

-- CreateIndex
CREATE INDEX "_OBSERVATIONS_FILES_B_index" ON "_OBSERVATIONS_FILES"("B");

-- CreateIndex
CREATE INDEX "_ORDER_BUDGETS_B_index" ON "_ORDER_BUDGETS"("B");

-- CreateIndex
CREATE INDEX "_ORDER_INVOICES_B_index" ON "_ORDER_INVOICES"("B");

-- CreateIndex
CREATE INDEX "_ORDER_INVOICE_REIMBURSEMENTS_B_index" ON "_ORDER_INVOICE_REIMBURSEMENTS"("B");

-- CreateIndex
CREATE INDEX "_ORDER_RECEIPTS_B_index" ON "_ORDER_RECEIPTS"("B");

-- CreateIndex
CREATE INDEX "_ORDER_REIMBURSEMENTS_B_index" ON "_ORDER_REIMBURSEMENTS"("B");

-- CreateIndex
CREATE INDEX "_TASK_BUDGETS_B_index" ON "_TASK_BUDGETS"("B");

-- CreateIndex
CREATE INDEX "_TASK_FILES_B_index" ON "_TASK_FILES"("B");

-- CreateIndex
CREATE INDEX "_TASK_INVOICES_B_index" ON "_TASK_INVOICES"("B");

-- CreateIndex
CREATE INDEX "_TASK_INVOICE_REIMBURSEMENTS_B_index" ON "_TASK_INVOICE_REIMBURSEMENTS"("B");

-- CreateIndex
CREATE INDEX "_TASK_RECEIPTS_B_index" ON "_TASK_RECEIPTS"("B");

-- CreateIndex
CREATE INDEX "_TASK_REIMBURSEMENTS_B_index" ON "_TASK_REIMBURSEMENTS"("B");

-- CreateIndex
CREATE INDEX "_PAINT_BRAND_COMPONENT_ITEMS_B_index" ON "_PAINT_BRAND_COMPONENT_ITEMS"("B");

-- CreateIndex
CREATE INDEX "_PAINT_TYPE_COMPONENT_ITEMS_B_index" ON "_PAINT_TYPE_COMPONENT_ITEMS"("B");

-- CreateIndex
CREATE INDEX "_RelatedItems_B_index" ON "_RelatedItems"("B");

-- CreateIndex
CREATE INDEX "_EXTERNAL_WITHDRAWAL_INVOICES_B_index" ON "_EXTERNAL_WITHDRAWAL_INVOICES"("B");

-- CreateIndex
CREATE INDEX "_EXTERNAL_WITHDRAWAL_INVOICE_REIMBURSEMENTS_B_index" ON "_EXTERNAL_WITHDRAWAL_INVOICE_REIMBURSEMENTS"("B");

-- CreateIndex
CREATE INDEX "_EXTERNAL_WITHDRAWAL_RECEIPTS_B_index" ON "_EXTERNAL_WITHDRAWAL_RECEIPTS"("B");

-- CreateIndex
CREATE INDEX "_EXTERNAL_WITHDRAWAL_REIMBURSEMENTS_B_index" ON "_EXTERNAL_WITHDRAWAL_REIMBURSEMENTS"("B");

-- CreateIndex
CREATE INDEX "_RelatedPaints_B_index" ON "_RelatedPaints"("B");

-- CreateIndex
CREATE INDEX "_TASK_LOGO_PAINT_B_index" ON "_TASK_LOGO_PAINT"("B");

-- CreateIndex
CREATE INDEX "_RelatedTasks_B_index" ON "_RelatedTasks"("B");

-- CreateIndex
CREATE INDEX "_WITNESS_WARNING_B_index" ON "_WITNESS_WARNING"("B");

-- CreateIndex
CREATE INDEX "_NotificationPreferenceToPreferences_B_index" ON "_NotificationPreferenceToPreferences"("B");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Airbrushing" ADD CONSTRAINT "Airbrushing_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrow" ADD CONSTRAINT "Borrow_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrow" ADD CONSTRAINT "Borrow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeLog" ADD CONSTRAINT "ChangeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "Payroll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusDiscount" ADD CONSTRAINT "BonusDiscount_bonusId_fkey" FOREIGN KEY ("bonusId") REFERENCES "Bonus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollDiscount" ADD CONSTRAINT "PayrollDiscount_taxTableId_fkey" FOREIGN KEY ("taxTableId") REFERENCES "TaxTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollDiscount" ADD CONSTRAINT "PayrollDiscount_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "Payroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxBracket" ADD CONSTRAINT "TaxBracket_taxTableId_fkey" FOREIGN KEY ("taxTableId") REFERENCES "TaxTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_economicActivityId_fkey" FOREIGN KEY ("economicActivityId") REFERENCES "EconomicActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpeSize" ADD CONSTRAINT "PpeSize_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpeDelivery" ADD CONSTRAINT "PpeDelivery_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpeDelivery" ADD CONSTRAINT "PpeDelivery_ppeScheduleId_fkey" FOREIGN KEY ("ppeScheduleId") REFERENCES "PpeDeliverySchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpeDelivery" ADD CONSTRAINT "PpeDelivery_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpeDelivery" ADD CONSTRAINT "PpeDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpeDeliverySchedule" ADD CONSTRAINT "PpeDeliverySchedule_monthlyConfigId_fkey" FOREIGN KEY ("monthlyConfigId") REFERENCES "MonthlyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpeDeliverySchedule" ADD CONSTRAINT "PpeDeliverySchedule_weeklyConfigId_fkey" FOREIGN KEY ("weeklyConfigId") REFERENCES "WeeklyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpeDeliverySchedule" ADD CONSTRAINT "PpeDeliverySchedule_yearlyConfigId_fkey" FOREIGN KEY ("yearlyConfigId") REFERENCES "YearlyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonetaryValue" ADD CONSTRAINT "MonetaryValue_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonetaryValue" ADD CONSTRAINT "MonetaryValue_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measure" ADD CONSTRAINT "Measure_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "ItemBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRule" ADD CONSTRAINT "OrderRule_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRule" ADD CONSTRAINT "OrderRule_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalWithdrawalItem" ADD CONSTRAINT "ExternalWithdrawalItem_externalWithdrawalId_fkey" FOREIGN KEY ("externalWithdrawalId") REFERENCES "ExternalWithdrawal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalWithdrawalItem" ADD CONSTRAINT "ExternalWithdrawalItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_maintenanceScheduleId_fkey" FOREIGN KEY ("maintenanceScheduleId") REFERENCES "MaintenanceSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "Maintenance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_monthlyConfigId_fkey" FOREIGN KEY ("monthlyConfigId") REFERENCES "MonthlyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_weeklyConfigId_fkey" FOREIGN KEY ("weeklyConfigId") REFERENCES "WeeklyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_yearlyConfigId_fkey" FOREIGN KEY ("yearlyConfigId") REFERENCES "YearlyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_orderScheduleId_fkey" FOREIGN KEY ("orderScheduleId") REFERENCES "OrderSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_ppeScheduleId_fkey" FOREIGN KEY ("ppeScheduleId") REFERENCES "PpeDeliverySchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSchedule" ADD CONSTRAINT "OrderSchedule_monthlyConfigId_fkey" FOREIGN KEY ("monthlyConfigId") REFERENCES "MonthlyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSchedule" ADD CONSTRAINT "OrderSchedule_weeklyConfigId_fkey" FOREIGN KEY ("weeklyConfigId") REFERENCES "WeeklyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSchedule" ADD CONSTRAINT "OrderSchedule_yearlyConfigId_fkey" FOREIGN KEY ("yearlyConfigId") REFERENCES "YearlyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintProduction" ADD CONSTRAINT "PaintProduction_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "PaintFormula"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Paint" ADD CONSTRAINT "Paint_paintBrandId_fkey" FOREIGN KEY ("paintBrandId") REFERENCES "PaintBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paint" ADD CONSTRAINT "Paint_paintTypeId_fkey" FOREIGN KEY ("paintTypeId") REFERENCES "PaintType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintGround" ADD CONSTRAINT "PaintGround_groundPaintId_fkey" FOREIGN KEY ("groundPaintId") REFERENCES "Paint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintGround" ADD CONSTRAINT "PaintGround_paintId_fkey" FOREIGN KEY ("paintId") REFERENCES "Paint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintFormula" ADD CONSTRAINT "PaintFormula_paintId_fkey" FOREIGN KEY ("paintId") REFERENCES "Paint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintFormulaComponent" ADD CONSTRAINT "PaintFormulaComponent_formulaPaintId_fkey" FOREIGN KEY ("formulaPaintId") REFERENCES "PaintFormula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintFormulaComponent" ADD CONSTRAINT "PaintFormulaComponent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warning" ADD CONSTRAINT "Warning_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warning" ADD CONSTRAINT "Warning_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_bonusDiscountId_fkey" FOREIGN KEY ("bonusDiscountId") REFERENCES "BonusDiscount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_paintId_fkey" FOREIGN KEY ("paintId") REFERENCES "Paint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cut" ADD CONSTRAINT "Cut_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cut" ADD CONSTRAINT "Cut_parentCutId_fkey" FOREIGN KEY ("parentCutId") REFERENCES "Cut"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cut" ADD CONSTRAINT "Cut_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_backSideLayoutId_fkey" FOREIGN KEY ("backSideLayoutId") REFERENCES "Layout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_leftSideLayoutId_fkey" FOREIGN KEY ("leftSideLayoutId") REFERENCES "Layout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_rightSideLayoutId_fkey" FOREIGN KEY ("rightSideLayoutId") REFERENCES "Layout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayoutSection" ADD CONSTRAINT "LayoutSection_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "Layout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managedSectorId_fkey" FOREIGN KEY ("managedSectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vacation" ADD CONSTRAINT "Vacation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preferences" ADD CONSTRAINT "Preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeenNotification" ADD CONSTRAINT "SeenNotification_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeenNotification" ADD CONSTRAINT "SeenNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thumbnail_jobs" ADD CONSTRAINT "thumbnail_jobs_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "git_commits" ADD CONSTRAINT "git_commits_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apps" ADD CONSTRAINT "apps_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_deployed_by_fkey" FOREIGN KEY ("deployed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_git_commit_id_fkey" FOREIGN KEY ("git_commit_id") REFERENCES "git_commits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_previous_deployment_id_fkey" FOREIGN KEY ("previous_deployment_id") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_metrics" ADD CONSTRAINT "deployment_metrics_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AIRBRUSHING_ARTWORKS" ADD CONSTRAINT "_AIRBRUSHING_ARTWORKS_A_fkey" FOREIGN KEY ("A") REFERENCES "Airbrushing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AIRBRUSHING_ARTWORKS" ADD CONSTRAINT "_AIRBRUSHING_ARTWORKS_B_fkey" FOREIGN KEY ("B") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AIRBRUSHING_BUDGETS" ADD CONSTRAINT "_AIRBRUSHING_BUDGETS_A_fkey" FOREIGN KEY ("A") REFERENCES "Airbrushing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AIRBRUSHING_BUDGETS" ADD CONSTRAINT "_AIRBRUSHING_BUDGETS_B_fkey" FOREIGN KEY ("B") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AIRBRUSHING_INVOICES" ADD CONSTRAINT "_AIRBRUSHING_INVOICES_A_fkey" FOREIGN KEY ("A") REFERENCES "Airbrushing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AIRBRUSHING_INVOICES" ADD CONSTRAINT "_AIRBRUSHING_INVOICES_B_fkey" FOREIGN KEY ("B") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AIRBRUSHING_INVOICE_REIMBURSEMENTS" ADD CONSTRAINT "_AIRBRUSHING_INVOICE_REIMBURSEMENTS_A_fkey" FOREIGN KEY ("A") REFERENCES "Airbrushing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AIRBRUSHING_INVOICE_REIMBURSEMENTS" ADD CONSTRAINT "_AIRBRUSHING_INVOICE_REIMBURSEMENTS_B_fkey" FOREIGN KEY ("B") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AIRBRUSHING_RECEIPTS" ADD CONSTRAINT "_AIRBRUSHING_RECEIPTS_A_fkey" FOREIGN KEY ("A") REFERENCES "Airbrushing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AIRBRUSHING_RECEIPTS" ADD CONSTRAINT "_AIRBRUSHING_RECEIPTS_B_fkey" FOREIGN KEY ("B") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AIRBRUSHING_REIMBURSEMENTS" ADD CONSTRAINT "_AIRBRUSHING_REIMBURSEMENTS_A_fkey" FOREIGN KEY ("A") REFERENCES "Airbrushing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AIRBRUSHING_REIMBURSEMENTS" ADD CONSTRAINT "_AIRBRUSHING_REIMBURSEMENTS_B_fkey" FOREIGN KEY ("B") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BonusPeriodUsers" ADD CONSTRAINT "_BonusPeriodUsers_A_fkey" FOREIGN KEY ("A") REFERENCES "Bonus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BonusPeriodUsers" ADD CONSTRAINT "_BonusPeriodUsers_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BonusTasks" ADD CONSTRAINT "_BonusTasks_A_fkey" FOREIGN KEY ("A") REFERENCES "Bonus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BonusTasks" ADD CONSTRAINT "_BonusTasks_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FileToWarning" ADD CONSTRAINT "_FileToWarning_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FileToWarning" ADD CONSTRAINT "_FileToWarning_B_fkey" FOREIGN KEY ("B") REFERENCES "Warning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OBSERVATIONS_FILES" ADD CONSTRAINT "_OBSERVATIONS_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OBSERVATIONS_FILES" ADD CONSTRAINT "_OBSERVATIONS_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ORDER_BUDGETS" ADD CONSTRAINT "_ORDER_BUDGETS_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ORDER_BUDGETS" ADD CONSTRAINT "_ORDER_BUDGETS_B_fkey" FOREIGN KEY ("B") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ORDER_INVOICES" ADD CONSTRAINT "_ORDER_INVOICES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ORDER_INVOICES" ADD CONSTRAINT "_ORDER_INVOICES_B_fkey" FOREIGN KEY ("B") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ORDER_INVOICE_REIMBURSEMENTS" ADD CONSTRAINT "_ORDER_INVOICE_REIMBURSEMENTS_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ORDER_INVOICE_REIMBURSEMENTS" ADD CONSTRAINT "_ORDER_INVOICE_REIMBURSEMENTS_B_fkey" FOREIGN KEY ("B") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ORDER_RECEIPTS" ADD CONSTRAINT "_ORDER_RECEIPTS_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ORDER_RECEIPTS" ADD CONSTRAINT "_ORDER_RECEIPTS_B_fkey" FOREIGN KEY ("B") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ORDER_REIMBURSEMENTS" ADD CONSTRAINT "_ORDER_REIMBURSEMENTS_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ORDER_REIMBURSEMENTS" ADD CONSTRAINT "_ORDER_REIMBURSEMENTS_B_fkey" FOREIGN KEY ("B") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_BUDGETS" ADD CONSTRAINT "_TASK_BUDGETS_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_BUDGETS" ADD CONSTRAINT "_TASK_BUDGETS_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_FILES" ADD CONSTRAINT "_TASK_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_FILES" ADD CONSTRAINT "_TASK_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_INVOICES" ADD CONSTRAINT "_TASK_INVOICES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_INVOICES" ADD CONSTRAINT "_TASK_INVOICES_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_INVOICE_REIMBURSEMENTS" ADD CONSTRAINT "_TASK_INVOICE_REIMBURSEMENTS_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_INVOICE_REIMBURSEMENTS" ADD CONSTRAINT "_TASK_INVOICE_REIMBURSEMENTS_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_RECEIPTS" ADD CONSTRAINT "_TASK_RECEIPTS_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_RECEIPTS" ADD CONSTRAINT "_TASK_RECEIPTS_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_REIMBURSEMENTS" ADD CONSTRAINT "_TASK_REIMBURSEMENTS_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_REIMBURSEMENTS" ADD CONSTRAINT "_TASK_REIMBURSEMENTS_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PAINT_BRAND_COMPONENT_ITEMS" ADD CONSTRAINT "_PAINT_BRAND_COMPONENT_ITEMS_A_fkey" FOREIGN KEY ("A") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PAINT_BRAND_COMPONENT_ITEMS" ADD CONSTRAINT "_PAINT_BRAND_COMPONENT_ITEMS_B_fkey" FOREIGN KEY ("B") REFERENCES "PaintBrand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PAINT_TYPE_COMPONENT_ITEMS" ADD CONSTRAINT "_PAINT_TYPE_COMPONENT_ITEMS_A_fkey" FOREIGN KEY ("A") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PAINT_TYPE_COMPONENT_ITEMS" ADD CONSTRAINT "_PAINT_TYPE_COMPONENT_ITEMS_B_fkey" FOREIGN KEY ("B") REFERENCES "PaintType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RelatedItems" ADD CONSTRAINT "_RelatedItems_A_fkey" FOREIGN KEY ("A") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RelatedItems" ADD CONSTRAINT "_RelatedItems_B_fkey" FOREIGN KEY ("B") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EXTERNAL_WITHDRAWAL_INVOICES" ADD CONSTRAINT "_EXTERNAL_WITHDRAWAL_INVOICES_A_fkey" FOREIGN KEY ("A") REFERENCES "ExternalWithdrawal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EXTERNAL_WITHDRAWAL_INVOICES" ADD CONSTRAINT "_EXTERNAL_WITHDRAWAL_INVOICES_B_fkey" FOREIGN KEY ("B") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EXTERNAL_WITHDRAWAL_INVOICE_REIMBURSEMENTS" ADD CONSTRAINT "_EXTERNAL_WITHDRAWAL_INVOICE_REIMBURSEMENTS_A_fkey" FOREIGN KEY ("A") REFERENCES "ExternalWithdrawal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EXTERNAL_WITHDRAWAL_INVOICE_REIMBURSEMENTS" ADD CONSTRAINT "_EXTERNAL_WITHDRAWAL_INVOICE_REIMBURSEMENTS_B_fkey" FOREIGN KEY ("B") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EXTERNAL_WITHDRAWAL_RECEIPTS" ADD CONSTRAINT "_EXTERNAL_WITHDRAWAL_RECEIPTS_A_fkey" FOREIGN KEY ("A") REFERENCES "ExternalWithdrawal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EXTERNAL_WITHDRAWAL_RECEIPTS" ADD CONSTRAINT "_EXTERNAL_WITHDRAWAL_RECEIPTS_B_fkey" FOREIGN KEY ("B") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EXTERNAL_WITHDRAWAL_REIMBURSEMENTS" ADD CONSTRAINT "_EXTERNAL_WITHDRAWAL_REIMBURSEMENTS_A_fkey" FOREIGN KEY ("A") REFERENCES "ExternalWithdrawal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EXTERNAL_WITHDRAWAL_REIMBURSEMENTS" ADD CONSTRAINT "_EXTERNAL_WITHDRAWAL_REIMBURSEMENTS_B_fkey" FOREIGN KEY ("B") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RelatedPaints" ADD CONSTRAINT "_RelatedPaints_A_fkey" FOREIGN KEY ("A") REFERENCES "Paint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RelatedPaints" ADD CONSTRAINT "_RelatedPaints_B_fkey" FOREIGN KEY ("B") REFERENCES "Paint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_LOGO_PAINT" ADD CONSTRAINT "_TASK_LOGO_PAINT_A_fkey" FOREIGN KEY ("A") REFERENCES "Paint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_LOGO_PAINT" ADD CONSTRAINT "_TASK_LOGO_PAINT_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RelatedTasks" ADD CONSTRAINT "_RelatedTasks_A_fkey" FOREIGN KEY ("A") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RelatedTasks" ADD CONSTRAINT "_RelatedTasks_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WITNESS_WARNING" ADD CONSTRAINT "_WITNESS_WARNING_A_fkey" FOREIGN KEY ("A") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WITNESS_WARNING" ADD CONSTRAINT "_WITNESS_WARNING_B_fkey" FOREIGN KEY ("B") REFERENCES "Warning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NotificationPreferenceToPreferences" ADD CONSTRAINT "_NotificationPreferenceToPreferences_A_fkey" FOREIGN KEY ("A") REFERENCES "NotificationPreference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NotificationPreferenceToPreferences" ADD CONSTRAINT "_NotificationPreferenceToPreferences_B_fkey" FOREIGN KEY ("B") REFERENCES "Preferences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
