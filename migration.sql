-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."CutType" AS ENUM ('VINYL', 'STENCIL');

-- CreateEnum
CREATE TYPE "public"."CutRequestReason" AS ENUM ('WRONG_APPLY', 'LOST', 'WRONG');

-- CreateEnum
CREATE TYPE "public"."CutOrigin" AS ENUM ('PLAN', 'REQUEST');

-- CreateEnum
CREATE TYPE "public"."PpeType" AS ENUM ('SHIRT', 'PANTS', 'BOOTS', 'SLEEVES', 'MASK', 'GLOVES', 'RAIN_BOOTS');

-- CreateEnum
CREATE TYPE "public"."PpeDeliveryMode" AS ENUM ('SCHEDULED', 'ON_DEMAND', 'BOTH');

-- CreateEnum
CREATE TYPE "public"."ShirtSize" AS ENUM ('P', 'M', 'G', 'GG', 'XG');

-- CreateEnum
CREATE TYPE "public"."PantsSize" AS ENUM ('SIZE_36', 'SIZE_38', 'SIZE_40', 'SIZE_42', 'SIZE_44', 'SIZE_46', 'SIZE_48');

-- CreateEnum
CREATE TYPE "public"."BootSize" AS ENUM ('SIZE_36', 'SIZE_38', 'SIZE_40', 'SIZE_42', 'SIZE_44', 'SIZE_46', 'SIZE_48');

-- CreateEnum
CREATE TYPE "public"."SleevesSize" AS ENUM ('P', 'M', 'G', 'GG', 'XG');

-- CreateEnum
CREATE TYPE "public"."MaskSize" AS ENUM ('P', 'M');

-- CreateEnum
CREATE TYPE "public"."GlovesSize" AS ENUM ('P', 'M', 'G');

-- CreateEnum
CREATE TYPE "public"."RainBootsSize" AS ENUM ('SIZE_36', 'SIZE_38', 'SIZE_40', 'SIZE_42', 'SIZE_44', 'SIZE_46');

-- CreateEnum
CREATE TYPE "public"."PpeSizeEnum" AS ENUM ('P', 'M', 'G', 'GG', 'XG', 'SIZE_36', 'SIZE_38', 'SIZE_40', 'SIZE_42', 'SIZE_44', 'SIZE_46', 'SIZE_48');

-- CreateEnum
CREATE TYPE "public"."PpeDeliveryStatus" AS ENUM ('PENDING', 'APPROVED', 'DELIVERED', 'REPROVED');

-- CreateEnum
CREATE TYPE "public"."ActivityReason" AS ENUM ('ORDER_RECEIVED', 'PRODUCTION_USAGE', 'PPE_DELIVERY', 'BORROW', 'RETURN', 'EXTERNAL_WITHDRAWAL', 'EXTERNAL_WITHDRAWAL_RETURN', 'INVENTORY_COUNT', 'MANUAL_ADJUSTMENT', 'MAINTENANCE', 'DAMAGE', 'LOSS', 'PAINT_PRODUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('CREATED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'OVERDUE', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."MaintenanceScheduleStatus" AS ENUM ('PENDING', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TaskStatus" AS ENUM ('PENDING', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "public"."ServiceOrderStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."AirbrushingStatus" AS ENUM ('PENDING', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."CutStatus" AS ENUM ('PENDING', 'CUTTING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."MaintenanceStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "public"."AbsenceStatus" AS ENUM ('PENDING_JUSTIFICATION', 'JUSTIFICATION_SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."VacationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."PpeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."BorrowStatus" AS ENUM ('ACTIVE', 'RETURNED', 'LOST');

-- CreateEnum
CREATE TYPE "public"."ExternalWithdrawalStatus" AS ENUM ('PENDING', 'PARTIALLY_RETURNED', 'FULLY_RETURNED', 'CHARGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."VacationType" AS ENUM ('ANNUAL', 'COLLECTIVE', 'MEDICAL', 'MATERNITY', 'PATERNITY', 'EMERGENCY', 'STUDY', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."PaintFinish" AS ENUM ('SOLID', 'METALLIC', 'PEARL', 'MATTE', 'SATIN');

-- CreateEnum
CREATE TYPE "public"."PaintBaseType" AS ENUM ('TRANSPARENT', 'WHITE', 'ALUMINUM', 'BLACK', 'MIXING');

-- CreateEnum
CREATE TYPE "public"."ColorPalette" AS ENUM ('BLACK', 'GRAY', 'WHITE', 'SILVER', 'GOLDEN', 'YELLOW', 'ORANGE', 'BROWN', 'RED', 'PINK', 'PURPLE', 'BLUE', 'GREEN', 'BEIGE');

-- CreateEnum
CREATE TYPE "public"."TruckManufacturer" AS ENUM ('SCANIA', 'VOLVO', 'DAF', 'VOLKSWAGEN', 'IVECO', 'MERCEDES_BENZ');

-- CreateEnum
CREATE TYPE "public"."WarningSeverity" AS ENUM ('VERBAL', 'WRITTEN', 'SUSPENSION', 'FINAL_WARNING');

-- CreateEnum
CREATE TYPE "public"."WarningCategory" AS ENUM ('SAFETY', 'MISCONDUCT', 'INSUBORDINATION', 'POLICY_VIOLATION', 'ATTENDANCE', 'PERFORMANCE', 'BEHAVIOR', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('SYSTEM', 'TASK', 'ORDER', 'PPE', 'VACATION', 'WARNING', 'STOCK', 'GENERAL');

-- CreateEnum
CREATE TYPE "public"."NotificationImportance" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "public"."ColorSchema" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."VerificationType" AS ENUM ('EMAIL', 'PHONE', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "public"."MeasureUnit" AS ENUM ('KILOGRAM', 'GRAM', 'MILLILITER', 'LITER', 'CUBIC_METER', 'CUBIC_CENTIMETER', 'MILLIMETER', 'CENTIMETER', 'METER', 'INCHES', 'INCH_1_8', 'INCH_1_4', 'INCH_3_8', 'INCH_1_2', 'INCH_5_8', 'INCH_3_4', 'INCH_7_8', 'INCH_1', 'INCH_1_1_4', 'INCH_1_1_2', 'INCH_2', 'THREAD_MM', 'THREAD_TPI', 'WATT', 'VOLT', 'AMPERE', 'SQUARE_CENTIMETER', 'SQUARE_METER', 'UNIT', 'PAIR', 'DOZEN', 'HUNDRED', 'THOUSAND', 'PACKAGE', 'BOX', 'ROLL', 'SHEET', 'SET', 'SACK', 'P', 'M', 'G', 'GG', 'XG');

-- CreateEnum
CREATE TYPE "public"."MeasureType" AS ENUM ('WEIGHT', 'VOLUME', 'LENGTH', 'AREA', 'COUNT', 'DIAMETER', 'THREAD', 'ELECTRICAL', 'SIZE');

-- CreateEnum
CREATE TYPE "public"."SectorPrivileges" AS ENUM ('BASIC', 'PRODUCTION', 'LEADER', 'MAINTENANCE', 'WAREHOUSE', 'ADMIN', 'HUMAN_RESOURCES', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "public"."ScheduleFrequency" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'TRIANNUAL', 'QUADRIMESTRAL', 'SEMI_ANNUAL', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."AssignmentType" AS ENUM ('ALL', 'ALL_EXCEPT', 'SPECIFIC');

-- CreateEnum
CREATE TYPE "public"."DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "public"."Month" AS ENUM ('JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER');

-- CreateEnum
CREATE TYPE "public"."MonthOccurrence" AS ENUM ('FIRST', 'SECOND', 'THIRD', 'FOURTH', 'LAST');

-- CreateEnum
CREATE TYPE "public"."OrderTriggerType" AS ENUM ('STOCK_LEVEL', 'CONSUMPTION_RATE', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "public"."ChangeLogTriggeredByType" AS ENUM ('TASK_CREATE', 'TASK_UPDATE', 'USER_ACTION', 'BATCH_CREATE', 'BATCH_UPDATE', 'BATCH_DELETE', 'BATCH_OPERATION', 'SYSTEM', 'USER', 'EXTERNAL_WITHDRAWAL', 'EXTERNAL_WITHDRAWAL_DELETE', 'EXTERNAL_WITHDRAWAL_RETURN', 'EXTERNAL_WITHDRAWAL_SYNC', 'EXTERNAL_WITHDRAWAL_ITEM', 'EXTERNAL_WITHDRAWAL_ITEM_UPDATE', 'EXTERNAL_WITHDRAWAL_ITEM_DELETE', 'PAINT_FORMULA_COMPONENT_CREATE', 'PAINT_FORMULA_COMPONENT_UPDATE', 'PAINT_FORMULA_COMPONENT_DELETE', 'PAINT_FORMULA_COMPONENT_BATCH_CREATE', 'PAINT_FORMULA_COMPONENT_BATCH_UPDATE', 'PAINT_FORMULA_COMPONENT_BATCH_DELETE', 'PAINT_PRODUCTION_CREATE', 'PAINT_PRODUCTION_UPDATE', 'PAINT_PRODUCTION_DELETE', 'PAINT_PRODUCTION_BATCH_CREATE', 'PAINT_PRODUCTION_BATCH_UPDATE', 'PAINT_PRODUCTION_BATCH_DELETE', 'PAINT_CREATE', 'PAINT_UPDATE', 'PAINT_DELETE', 'PAINT_BATCH_CREATE', 'PAINT_BATCH_UPDATE', 'PAINT_BATCH_DELETE', 'PAINT_FORMULA_CREATE', 'PAINT_FORMULA_UPDATE', 'PAINT_FORMULA_DELETE', 'PAINT_FORMULA_BATCH_CREATE', 'PAINT_FORMULA_BATCH_UPDATE', 'PAINT_FORMULA_BATCH_DELETE', 'PAINT_TYPE_CREATE', 'PAINT_TYPE_UPDATE', 'PAINT_TYPE_DELETE', 'PAINT_TYPE_BATCH_CREATE', 'PAINT_TYPE_BATCH_UPDATE', 'PAINT_TYPE_BATCH_DELETE', 'PAINT_GROUND_CREATE', 'PAINT_GROUND_UPDATE', 'PAINT_GROUND_DELETE', 'PAINT_GROUND_BATCH_CREATE', 'PAINT_GROUND_BATCH_UPDATE', 'PAINT_GROUND_BATCH_DELETE', 'ORDER_UPDATE', 'ORDER_CREATE', 'ORDER_STATUS_CHANGE', 'ORDER_CANCEL', 'ORDER_ITEM_UPDATE', 'ORDER_ITEM_RECEIVED', 'ORDER_ITEM_SYNC', 'SCHEDULE', 'ACTIVITY_CREATE', 'ACTIVITY_UPDATE', 'ACTIVITY_DELETE', 'ACTIVITY_SYNC', 'INVENTORY_ADJUSTMENT', 'ITEM_MONTHLY_CONSUMPTION_UPDATE', 'AUTOMATIC_MIN_MAX_UPDATE');

-- CreateEnum
CREATE TYPE "public"."ChangeLogEntityType" AS ENUM ('ABSENCE', 'ACTIVITY', 'AIRBRUSHING', 'BORROW', 'CALCULATION', 'CALCULATION_DETAIL', 'CALCULATION_DECOMPOSITION', 'CATEGORY', 'COLLECTION', 'CUSTOMER', 'CUT', 'CUT_ITEM', 'CUT_PLAN', 'CUT_REQUEST', 'DELIVERY', 'PPE_DELIVERY', 'PPE_DELIVERY_ITEM', 'PPE_REQUEST', 'PPE_DELIVERY_SCHEDULE', 'PPE_SIZE', 'EXTERNAL_WITHDRAWAL', 'EXTERNAL_WITHDRAWAL_ITEM', 'FILE', 'ITEM', 'ITEM_BRAND', 'ITEM_CATEGORY', 'MAINTENANCE', 'MAINTENANCE_SCHEDULE', 'NOTIFICATION', 'ORDER', 'ORDER_ITEM', 'ORDER_RULE', 'ORDER_SCHEDULE', 'PAINT', 'PAINT_TYPE', 'SERVICE', 'PAINT_GROUND', 'PAINT_FORMULA', 'PAINT_FORMULA_COMPONENT', 'PAINT_PRODUCTION', 'PIECE', 'POSITION', 'PRODUCTION', 'PURCHASE', 'WARNING', 'SECTOR', 'SERVICE_ORDER', 'SUPPLIER', 'TASK', 'TRUCK', 'LAYOUT', 'USER', 'VACATION');

-- CreateEnum
CREATE TYPE "public"."ChangeLogAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'ARCHIVE', 'UNARCHIVE', 'ACTIVATE', 'DEACTIVATE', 'APPROVE', 'REJECT', 'CANCEL', 'COMPLETE', 'ROLLBACK', 'RESCHEDULE', 'BATCH_CREATE', 'BATCH_UPDATE', 'BATCH_DELETE');

-- CreateEnum
CREATE TYPE "public"."NotificationActionType" AS ENUM ('VIEW_DETAILS', 'APPROVE_REQUEST', 'REJECT_REQUEST', 'COMPLETE_TASK', 'VIEW_ORDER', 'VIEW_REPORT', 'ACKNOWLEDGE', 'DISMISS');

-- CreateEnum
CREATE TYPE "public"."RescheduleReason" AS ENUM ('LOW_FUNDS', 'SUPPLIER_DELAY', 'OPERATIONAL_ISSUE', 'PRIORITY_CHANGE', 'SEASONAL_ADJUSTMENT', 'EMERGENCY', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ActivityOperation" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "public"."AbcCategory" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "public"."XyzCategory" AS ENUM ('X', 'Y', 'Z');

-- CreateEnum
CREATE TYPE "public"."ItemCategoryType" AS ENUM ('REGULAR', 'TOOL', 'PPE');

-- CreateEnum
CREATE TYPE "public"."BonusStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "public"."CommissionStatus" AS ENUM ('PARTIAL_COMMISSION', 'NO_COMMISSION', 'FULL_COMMISSION', 'SUSPENDED_COMMISSION');

-- CreateTable
CREATE TABLE "public"."Activity" (
    "id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "operation" "public"."ActivityOperation" NOT NULL DEFAULT 'OUTBOUND',
    "userId" TEXT,
    "itemId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "reason" "public"."ActivityReason" NOT NULL DEFAULT 'PRODUCTION_USAGE',
    "reasonOrder" INTEGER DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Airbrushing" (
    "id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "finishDate" TIMESTAMP(3),
    "price" DOUBLE PRECISION,
    "status" "public"."AirbrushingStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Airbrushing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Borrow" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" "public"."BorrowStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Borrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChangeLog" (
    "id" TEXT NOT NULL,
    "entityType" "public"."ChangeLogEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "public"."ChangeLogAction" NOT NULL,
    "field" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "userId" TEXT,
    "triggeredBy" "public"."ChangeLogTriggeredByType",
    "triggeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Bonus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "baseBonus" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "performanceLevel" INTEGER NOT NULL,
    "ponderedTaskCount" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "averageTasksPerUser" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "calculationPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculationPeriodEnd" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "payrollId" TEXT,

    CONSTRAINT "Bonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Payroll" (
    "id" TEXT NOT NULL,
    "baseRemuneration" DECIMAL(10,2) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BonusDiscount" (
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
CREATE TABLE "public"."PayrollDiscount" (
    "id" TEXT NOT NULL,
    "percentage" DECIMAL(5,2),
    "value" DECIMAL(10,2),
    "calculationOrder" INTEGER NOT NULL DEFAULT 1,
    "reference" TEXT NOT NULL,
    "payrollId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Customer" (
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

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PpeSize" (
    "id" TEXT NOT NULL,
    "shirts" "public"."ShirtSize",
    "boots" "public"."BootSize",
    "pants" "public"."PantsSize",
    "sleeves" "public"."SleevesSize",
    "mask" "public"."MaskSize",
    "gloves" "public"."GlovesSize",
    "rainBoots" "public"."RainBootsSize",
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PpeSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PpeDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" "public"."PpeDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "quantity" INTEGER NOT NULL,
    "reviewedBy" TEXT,
    "ppeScheduleId" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "actualDeliveryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PpeDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PpeDeliverySchedule" (
    "id" TEXT NOT NULL,
    "assignmentType" "public"."AssignmentType" NOT NULL DEFAULT 'ALL',
    "excludedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "frequency" "public"."ScheduleFrequency" NOT NULL,
    "frequencyCount" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ppeItems" JSONB NOT NULL,
    "specificDate" TIMESTAMP(3),
    "dayOfMonth" INTEGER,
    "dayOfWeek" "public"."DayOfWeek",
    "month" "public"."Month",
    "customMonths" "public"."Month"[],
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "originalDate" TIMESTAMP(3),
    "lastRescheduleDate" TIMESTAMP(3),
    "rescheduleReason" "public"."RescheduleReason",
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
CREATE TABLE "public"."File" (
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
CREATE TABLE "public"."Price" (
    "id" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Measure" (
    "id" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "unit" "public"."MeasureUnit",
    "measureType" "public"."MeasureType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PositionRemuneration" (
    "id" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "positionId" TEXT NOT NULL,

    CONSTRAINT "PositionRemuneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uniCode" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxQuantity" DOUBLE PRECISION,
    "reorderPoint" DOUBLE PRECISION,
    "reorderQuantity" DOUBLE PRECISION,
    "boxQuantity" INTEGER,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPrice" DOUBLE PRECISION,
    "monthlyConsumption" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "monthlyConsumptionTrendPercent" DECIMAL(5,2),
    "barcodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shouldAssignToUser" BOOLEAN NOT NULL DEFAULT true,
    "abcCategory" "public"."AbcCategory",
    "abcCategoryOrder" INTEGER,
    "xyzCategory" "public"."XyzCategory",
    "xyzCategoryOrder" INTEGER,
    "brandId" TEXT,
    "categoryId" TEXT,
    "supplierId" TEXT,
    "estimatedLeadTime" INTEGER DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ppeType" "public"."PpeType",
    "ppeCA" TEXT,
    "ppeDeliveryMode" "public"."PpeDeliveryMode",
    "ppeStandardQuantity" INTEGER,
    "ppeAutoOrderMonths" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WeeklyScheduleConfig" (
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
CREATE TABLE "public"."MonthlyScheduleConfig" (
    "id" TEXT NOT NULL,
    "dayOfMonth" INTEGER,
    "occurrence" "public"."MonthOccurrence",
    "dayOfWeek" "public"."DayOfWeek",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyScheduleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."YearlyScheduleConfig" (
    "id" TEXT NOT NULL,
    "month" "public"."Month" NOT NULL,
    "dayOfMonth" INTEGER,
    "occurrence" "public"."MonthOccurrence",
    "dayOfWeek" "public"."DayOfWeek",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YearlyScheduleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderRule" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "supplierId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "triggerType" "public"."OrderTriggerType" NOT NULL,
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
CREATE TABLE "public"."ItemBrand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ItemCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."ItemCategoryType" NOT NULL DEFAULT 'REGULAR',
    "typeOrder" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Observation" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExternalWithdrawal" (
    "id" TEXT NOT NULL,
    "withdrawerName" TEXT NOT NULL,
    "willReturn" BOOLEAN NOT NULL DEFAULT true,
    "status" "public"."ExternalWithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "nfeId" TEXT,
    "receiptId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExternalWithdrawalItem" (
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
CREATE TABLE "public"."Maintenance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "public"."MaintenanceStatus" NOT NULL DEFAULT 'PENDING',
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
CREATE TABLE "public"."MaintenanceItem" (
    "id" TEXT NOT NULL,
    "maintenanceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MaintenanceSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "itemId" TEXT,
    "frequency" "public"."ScheduleFrequency" NOT NULL,
    "frequencyCount" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" "public"."MaintenanceScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "maintenanceItemsConfig" JSONB,
    "specificDate" TIMESTAMP(3),
    "dayOfMonth" INTEGER,
    "dayOfWeek" "public"."DayOfWeek",
    "month" "public"."Month",
    "customMonths" "public"."Month"[],
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "originalDate" TIMESTAMP(3),
    "lastRescheduleDate" TIMESTAMP(3),
    "rescheduleReason" "public"."RescheduleReason",
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
CREATE TABLE "public"."Order" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "forecast" TIMESTAMP(3),
    "status" "public"."OrderStatus" NOT NULL DEFAULT 'CREATED',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "budgetId" TEXT,
    "nfeId" TEXT,
    "receiptId" TEXT,
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
CREATE TABLE "public"."OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "orderedQuantity" DOUBLE PRECISION NOT NULL,
    "receivedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderSchedule" (
    "id" TEXT NOT NULL,
    "frequency" "public"."ScheduleFrequency" NOT NULL,
    "frequencyCount" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "items" TEXT[],
    "specificDate" TIMESTAMP(3),
    "dayOfMonth" INTEGER,
    "dayOfWeek" "public"."DayOfWeek",
    "month" "public"."Month",
    "customMonths" "public"."Month"[],
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "originalDate" TIMESTAMP(3),
    "lastRescheduleDate" TIMESTAMP(3),
    "rescheduleReason" "public"."RescheduleReason",
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
CREATE TABLE "public"."PaintProduction" (
    "id" TEXT NOT NULL,
    "volumeLiters" DOUBLE PRECISION NOT NULL,
    "formulaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintProduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Paint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "finish" "public"."PaintFinish" NOT NULL,
    "manufacturer" "public"."TruckManufacturer",
    "tags" TEXT[],
    "palette" "public"."ColorPalette" NOT NULL DEFAULT 'BLACK',
    "paletteOrder" INTEGER NOT NULL DEFAULT 1,
    "paintTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT,
    "paintBrandId" TEXT,

    CONSTRAINT "Paint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaintBrand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaintType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "needGround" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaintGround" (
    "id" TEXT NOT NULL,
    "paintId" TEXT NOT NULL,
    "groundPaintId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintGround_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaintFormula" (
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
CREATE TABLE "public"."PaintFormulaComponent" (
    "id" TEXT NOT NULL,
    "ratio" DOUBLE PRECISION NOT NULL,
    "itemId" TEXT NOT NULL,
    "formulaPaintId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintFormulaComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Position" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bonifiable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Warning" (
    "id" TEXT NOT NULL,
    "description" TEXT,
    "collaboratorId" TEXT NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "category" "public"."WarningCategory" NOT NULL,
    "severity" "public"."WarningSeverity" NOT NULL,
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
CREATE TABLE "public"."Sector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "privileges" "public"."SectorPrivileges" NOT NULL DEFAULT 'BASIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Service" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ServiceOrder" (
    "id" TEXT NOT NULL,
    "status" "public"."ServiceOrderStatus" NOT NULL DEFAULT 'PENDING',
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
CREATE TABLE "public"."Supplier" (
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

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Task" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "public"."TaskStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "serialNumber" TEXT,
    "plate" TEXT,
    "details" TEXT,
    "entryDate" TIMESTAMP(3),
    "term" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "paintId" TEXT,
    "customerId" TEXT,
    "sectorId" TEXT,
    "commission" "public"."CommissionStatus" NOT NULL,
    "budgetId" TEXT,
    "nfeId" TEXT,
    "receiptId" TEXT,
    "price" DECIMAL(10,2),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bonusDiscountId" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Cut" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "type" "public"."CutType" NOT NULL,
    "taskId" TEXT,
    "origin" "public"."CutOrigin" NOT NULL DEFAULT 'PLAN',
    "reason" "public"."CutRequestReason",
    "parentCutId" TEXT,
    "status" "public"."CutStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Truck" (
    "id" TEXT NOT NULL,
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
CREATE TABLE "public"."Layout" (
    "id" TEXT NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "sections" JSONB,
    "photoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Layout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LayoutSection" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "isDoor" BOOLEAN NOT NULL DEFAULT false,
    "doorOffset" DOUBLE PRECISION,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LayoutSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Garage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "length" DOUBLE PRECISION NOT NULL DEFAULT 45,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Garage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GarageLane" (
    "id" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "length" DOUBLE PRECISION NOT NULL,
    "xPosition" DOUBLE PRECISION NOT NULL,
    "yPosition" DOUBLE PRECISION NOT NULL,
    "garageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GarageLane_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ParkingSpot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "length" DOUBLE PRECISION NOT NULL DEFAULT 12.5,
    "garageLaneId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkingSpot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SecullumToken" (
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
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "payrollNumber" INTEGER,
    "name" TEXT NOT NULL,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
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
    "dismissal" TIMESTAMP(3),
    "sectorId" TEXT,
    "managedSectorId" TEXT,
    "requirePasswordChange" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "verificationCode" TEXT,
    "verificationExpiresAt" TIMESTAMP(3),
    "verificationType" "public"."VerificationType",
    "sessionToken" TEXT,
    "secullum_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "performanceLevel" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Vacation" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isCollective" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."VacationStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "type" "public"."VacationType" NOT NULL DEFAULT 'COLLECTIVE',
    "typeOrder" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vacation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "colorSchema" "public"."ColorSchema" NOT NULL DEFAULT 'LIGHT',
    "favorites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NotificationPreference" (
    "id" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "channels" "public"."NotificationChannel"[],
    "importance" "public"."NotificationImportance" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" "public"."NotificationType" NOT NULL,
    "channel" "public"."NotificationChannel"[],
    "importance" "public"."NotificationImportance" NOT NULL DEFAULT 'NORMAL',
    "actionType" "public"."NotificationActionType",
    "actionUrl" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SeenNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeenNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."thumbnail_jobs" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "job_id" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "progress" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "thumbnail_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."_AIRBRUSHING_ARTWORKS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AIRBRUSHING_ARTWORKS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_AIRBRUSHING_NFES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AIRBRUSHING_NFES_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_AIRBRUSHING_RECEIPTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AIRBRUSHING_RECEIPTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_BonusPeriodUsers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BonusPeriodUsers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_BonusTasks" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BonusTasks_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_FileToWarning" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FileToWarning_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_OBSERVATIONS_FILES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_OBSERVATIONS_FILES_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_TASK_FILES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TASK_FILES_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_PAINT_BRAND_COMPONENT_ITEMS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PAINT_BRAND_COMPONENT_ITEMS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_PAINT_TYPE_COMPONENT_ITEMS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PAINT_TYPE_COMPONENT_ITEMS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_RelatedItems" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RelatedItems_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_RelatedPaints" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RelatedPaints_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_TASK_LOGO_PAINT" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TASK_LOGO_PAINT_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_RelatedTasks" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RelatedTasks_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_WITNESS_WARNING" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_WITNESS_WARNING_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_NotificationPreferenceToPreferences" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_NotificationPreferenceToPreferences_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Activity_itemId_idx" ON "public"."Activity"("itemId");

-- CreateIndex
CREATE INDEX "Activity_userId_idx" ON "public"."Activity"("userId");

-- CreateIndex
CREATE INDEX "Activity_orderId_idx" ON "public"."Activity"("orderId");

-- CreateIndex
CREATE INDEX "Activity_orderItemId_idx" ON "public"."Activity"("orderItemId");

-- CreateIndex
CREATE INDEX "Activity_createdAt_idx" ON "public"."Activity"("createdAt");

-- CreateIndex
CREATE INDEX "Activity_reasonOrder_idx" ON "public"."Activity"("reasonOrder");

-- CreateIndex
CREATE INDEX "Airbrushing_statusOrder_idx" ON "public"."Airbrushing"("statusOrder");

-- CreateIndex
CREATE INDEX "Borrow_itemId_idx" ON "public"."Borrow"("itemId");

-- CreateIndex
CREATE INDEX "Borrow_userId_idx" ON "public"."Borrow"("userId");

-- CreateIndex
CREATE INDEX "Borrow_status_statusOrder_idx" ON "public"."Borrow"("status", "statusOrder");

-- CreateIndex
CREATE INDEX "ChangeLog_entityType_entityId_idx" ON "public"."ChangeLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ChangeLog_createdAt_idx" ON "public"."ChangeLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Bonus_payrollId_key" ON "public"."Bonus"("payrollId");

-- CreateIndex
CREATE INDEX "Bonus_userId_idx" ON "public"."Bonus"("userId");

-- CreateIndex
CREATE INDEX "Bonus_year_month_idx" ON "public"."Bonus"("year", "month");

-- CreateIndex
CREATE INDEX "Bonus_calculationPeriodStart_calculationPeriodEnd_idx" ON "public"."Bonus"("calculationPeriodStart", "calculationPeriodEnd");

-- CreateIndex
CREATE INDEX "Bonus_ponderedTaskCount_idx" ON "public"."Bonus"("ponderedTaskCount");

-- CreateIndex
CREATE INDEX "Bonus_averageTasksPerUser_idx" ON "public"."Bonus"("averageTasksPerUser");

-- CreateIndex
CREATE UNIQUE INDEX "Bonus_userId_year_month_key" ON "public"."Bonus"("userId", "year", "month");

-- CreateIndex
CREATE INDEX "Payroll_userId_idx" ON "public"."Payroll"("userId");

-- CreateIndex
CREATE INDEX "Payroll_year_month_idx" ON "public"."Payroll"("year", "month");

-- CreateIndex
CREATE INDEX "Payroll_positionId_idx" ON "public"."Payroll"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_userId_year_month_key" ON "public"."Payroll"("userId", "year", "month");

-- CreateIndex
CREATE INDEX "BonusDiscount_bonusId_idx" ON "public"."BonusDiscount"("bonusId");

-- CreateIndex
CREATE INDEX "BonusDiscount_calculationOrder_idx" ON "public"."BonusDiscount"("calculationOrder");

-- CreateIndex
CREATE INDEX "PayrollDiscount_payrollId_idx" ON "public"."PayrollDiscount"("payrollId");

-- CreateIndex
CREATE INDEX "PayrollDiscount_calculationOrder_idx" ON "public"."PayrollDiscount"("calculationOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_fantasyName_key" ON "public"."Customer"("fantasyName");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_cnpj_key" ON "public"."Customer"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_cpf_key" ON "public"."Customer"("cpf");

-- CreateIndex
CREATE INDEX "Customer_fantasyName_idx" ON "public"."Customer"("fantasyName");

-- CreateIndex
CREATE INDEX "Customer_cpf_idx" ON "public"."Customer"("cpf");

-- CreateIndex
CREATE INDEX "Customer_neighborhood_idx" ON "public"."Customer"("neighborhood");

-- CreateIndex
CREATE INDEX "Customer_zipCode_idx" ON "public"."Customer"("zipCode");

-- CreateIndex
CREATE UNIQUE INDEX "PpeSize_userId_key" ON "public"."PpeSize"("userId");

-- CreateIndex
CREATE INDEX "PpeDelivery_userId_idx" ON "public"."PpeDelivery"("userId");

-- CreateIndex
CREATE INDEX "PpeDelivery_itemId_idx" ON "public"."PpeDelivery"("itemId");

-- CreateIndex
CREATE INDEX "PpeDelivery_ppeScheduleId_idx" ON "public"."PpeDelivery"("ppeScheduleId");

-- CreateIndex
CREATE INDEX "PpeDelivery_scheduledDate_idx" ON "public"."PpeDelivery"("scheduledDate");

-- CreateIndex
CREATE INDEX "PpeDelivery_status_statusOrder_idx" ON "public"."PpeDelivery"("status", "statusOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PpeDeliverySchedule_weeklyConfigId_key" ON "public"."PpeDeliverySchedule"("weeklyConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "PpeDeliverySchedule_monthlyConfigId_key" ON "public"."PpeDeliverySchedule"("monthlyConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "PpeDeliverySchedule_yearlyConfigId_key" ON "public"."PpeDeliverySchedule"("yearlyConfigId");

-- CreateIndex
CREATE INDEX "PpeDeliverySchedule_nextRun_idx" ON "public"."PpeDeliverySchedule"("nextRun");

-- CreateIndex
CREATE INDEX "PpeDeliverySchedule_isActive_idx" ON "public"."PpeDeliverySchedule"("isActive");

-- CreateIndex
CREATE INDEX "PpeDeliverySchedule_assignmentType_idx" ON "public"."PpeDeliverySchedule"("assignmentType");

-- CreateIndex
CREATE INDEX "File_filename_idx" ON "public"."File"("filename");

-- CreateIndex
CREATE INDEX "File_originalName_idx" ON "public"."File"("originalName");

-- CreateIndex
CREATE INDEX "File_mimetype_idx" ON "public"."File"("mimetype");

-- CreateIndex
CREATE INDEX "File_path_idx" ON "public"."File"("path");

-- CreateIndex
CREATE INDEX "Measure_itemId_idx" ON "public"."Measure"("itemId");

-- CreateIndex
CREATE INDEX "Measure_measureType_idx" ON "public"."Measure"("measureType");

-- CreateIndex
CREATE INDEX "PositionRemuneration_positionId_idx" ON "public"."PositionRemuneration"("positionId");

-- CreateIndex
CREATE INDEX "PositionRemuneration_createdAt_idx" ON "public"."PositionRemuneration"("createdAt");

-- CreateIndex
CREATE INDEX "Item_shouldAssignToUser_idx" ON "public"."Item"("shouldAssignToUser");

-- CreateIndex
CREATE INDEX "Item_categoryId_brandId_idx" ON "public"."Item"("categoryId", "brandId");

-- CreateIndex
CREATE INDEX "Item_name_idx" ON "public"."Item"("name");

-- CreateIndex
CREATE INDEX "Item_isActive_idx" ON "public"."Item"("isActive");

-- CreateIndex
CREATE INDEX "Item_supplierId_idx" ON "public"."Item"("supplierId");

-- CreateIndex
CREATE INDEX "Item_abcCategory_abcCategoryOrder_idx" ON "public"."Item"("abcCategory", "abcCategoryOrder");

-- CreateIndex
CREATE INDEX "Item_xyzCategory_xyzCategoryOrder_idx" ON "public"."Item"("xyzCategory", "xyzCategoryOrder");

-- CreateIndex
CREATE INDEX "Item_ppeType_idx" ON "public"."Item"("ppeType");

-- CreateIndex
CREATE INDEX "Item_categoryId_ppeType_idx" ON "public"."Item"("categoryId", "ppeType");

-- CreateIndex
CREATE INDEX "OrderRule_itemId_idx" ON "public"."OrderRule"("itemId");

-- CreateIndex
CREATE INDEX "OrderRule_supplierId_idx" ON "public"."OrderRule"("supplierId");

-- CreateIndex
CREATE INDEX "OrderRule_isActive_idx" ON "public"."OrderRule"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ItemBrand_name_key" ON "public"."ItemBrand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_name_key" ON "public"."ItemCategory"("name");

-- CreateIndex
CREATE INDEX "ItemCategory_type_typeOrder_idx" ON "public"."ItemCategory"("type", "typeOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_taskId_key" ON "public"."Observation"("taskId");

-- CreateIndex
CREATE INDEX "ExternalWithdrawal_withdrawerName_idx" ON "public"."ExternalWithdrawal"("withdrawerName");

-- CreateIndex
CREATE INDEX "ExternalWithdrawal_status_statusOrder_idx" ON "public"."ExternalWithdrawal"("status", "statusOrder");

-- CreateIndex
CREATE INDEX "ExternalWithdrawal_willReturn_idx" ON "public"."ExternalWithdrawal"("willReturn");

-- CreateIndex
CREATE INDEX "ExternalWithdrawal_createdAt_idx" ON "public"."ExternalWithdrawal"("createdAt");

-- CreateIndex
CREATE INDEX "ExternalWithdrawalItem_externalWithdrawalId_idx" ON "public"."ExternalWithdrawalItem"("externalWithdrawalId");

-- CreateIndex
CREATE INDEX "ExternalWithdrawalItem_itemId_idx" ON "public"."ExternalWithdrawalItem"("itemId");

-- CreateIndex
CREATE INDEX "Maintenance_itemId_idx" ON "public"."Maintenance"("itemId");

-- CreateIndex
CREATE INDEX "Maintenance_status_idx" ON "public"."Maintenance"("status");

-- CreateIndex
CREATE INDEX "Maintenance_statusOrder_idx" ON "public"."Maintenance"("statusOrder");

-- CreateIndex
CREATE INDEX "Maintenance_maintenanceScheduleId_idx" ON "public"."Maintenance"("maintenanceScheduleId");

-- CreateIndex
CREATE INDEX "Maintenance_scheduledFor_idx" ON "public"."Maintenance"("scheduledFor");

-- CreateIndex
CREATE INDEX "MaintenanceItem_maintenanceId_idx" ON "public"."MaintenanceItem"("maintenanceId");

-- CreateIndex
CREATE INDEX "MaintenanceItem_itemId_idx" ON "public"."MaintenanceItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceSchedule_weeklyConfigId_key" ON "public"."MaintenanceSchedule"("weeklyConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceSchedule_monthlyConfigId_key" ON "public"."MaintenanceSchedule"("monthlyConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceSchedule_yearlyConfigId_key" ON "public"."MaintenanceSchedule"("yearlyConfigId");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_itemId_idx" ON "public"."MaintenanceSchedule"("itemId");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_nextRun_idx" ON "public"."MaintenanceSchedule"("nextRun");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_status_statusOrder_idx" ON "public"."MaintenanceSchedule"("status", "statusOrder");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_lastRunId_idx" ON "public"."MaintenanceSchedule"("lastRunId");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_originalScheduleId_idx" ON "public"."MaintenanceSchedule"("originalScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderScheduleId_key" ON "public"."Order"("orderScheduleId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "public"."Order"("status");

-- CreateIndex
CREATE INDEX "Order_statusOrder_idx" ON "public"."Order"("statusOrder");

-- CreateIndex
CREATE INDEX "Order_supplierId_idx" ON "public"."Order"("supplierId");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "public"."Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_ppeScheduleId_idx" ON "public"."Order"("ppeScheduleId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "public"."OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_itemId_idx" ON "public"."OrderItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSchedule_weeklyConfigId_key" ON "public"."OrderSchedule"("weeklyConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSchedule_monthlyConfigId_key" ON "public"."OrderSchedule"("monthlyConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSchedule_yearlyConfigId_key" ON "public"."OrderSchedule"("yearlyConfigId");

-- CreateIndex
CREATE INDEX "OrderSchedule_nextRun_idx" ON "public"."OrderSchedule"("nextRun");

-- CreateIndex
CREATE INDEX "OrderSchedule_lastRunId_idx" ON "public"."OrderSchedule"("lastRunId");

-- CreateIndex
CREATE INDEX "OrderSchedule_originalScheduleId_idx" ON "public"."OrderSchedule"("originalScheduleId");

-- CreateIndex
CREATE INDEX "PaintProduction_formulaId_idx" ON "public"."PaintProduction"("formulaId");

-- CreateIndex
CREATE INDEX "Paint_name_idx" ON "public"."Paint"("name");

-- CreateIndex
CREATE INDEX "Paint_paintTypeId_idx" ON "public"."Paint"("paintTypeId");

-- CreateIndex
CREATE INDEX "Paint_paintBrandId_idx" ON "public"."Paint"("paintBrandId");

-- CreateIndex
CREATE INDEX "Paint_paintTypeId_paintBrandId_idx" ON "public"."Paint"("paintTypeId", "paintBrandId");

-- CreateIndex
CREATE INDEX "Paint_palette_paletteOrder_idx" ON "public"."Paint"("palette", "paletteOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PaintBrand_name_key" ON "public"."PaintBrand"("name");

-- CreateIndex
CREATE INDEX "PaintBrand_name_idx" ON "public"."PaintBrand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PaintType_name_key" ON "public"."PaintType"("name");

-- CreateIndex
CREATE INDEX "PaintType_name_idx" ON "public"."PaintType"("name");

-- CreateIndex
CREATE INDEX "PaintGround_paintId_idx" ON "public"."PaintGround"("paintId");

-- CreateIndex
CREATE INDEX "PaintGround_groundPaintId_idx" ON "public"."PaintGround"("groundPaintId");

-- CreateIndex
CREATE UNIQUE INDEX "PaintGround_paintId_groundPaintId_key" ON "public"."PaintGround"("paintId", "groundPaintId");

-- CreateIndex
CREATE INDEX "PaintFormula_paintId_idx" ON "public"."PaintFormula"("paintId");

-- CreateIndex
CREATE INDEX "PaintFormulaComponent_itemId_idx" ON "public"."PaintFormulaComponent"("itemId");

-- CreateIndex
CREATE INDEX "PaintFormulaComponent_formulaPaintId_idx" ON "public"."PaintFormulaComponent"("formulaPaintId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_name_key" ON "public"."Position"("name");

-- CreateIndex
CREATE INDEX "Position_name_idx" ON "public"."Position"("name");

-- CreateIndex
CREATE INDEX "Warning_collaboratorId_idx" ON "public"."Warning"("collaboratorId");

-- CreateIndex
CREATE INDEX "Warning_severityOrder_idx" ON "public"."Warning"("severityOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Service_description_key" ON "public"."Service"("description");

-- CreateIndex
CREATE INDEX "ServiceOrder_taskId_idx" ON "public"."ServiceOrder"("taskId");

-- CreateIndex
CREATE INDEX "ServiceOrder_statusOrder_idx" ON "public"."ServiceOrder"("statusOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_fantasyName_key" ON "public"."Supplier"("fantasyName");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_cnpj_key" ON "public"."Supplier"("cnpj");

-- CreateIndex
CREATE INDEX "Supplier_fantasyName_idx" ON "public"."Supplier"("fantasyName");

-- CreateIndex
CREATE INDEX "Supplier_cnpj_idx" ON "public"."Supplier"("cnpj");

-- CreateIndex
CREATE INDEX "Supplier_state_idx" ON "public"."Supplier"("state");

-- CreateIndex
CREATE INDEX "Supplier_city_idx" ON "public"."Supplier"("city");

-- CreateIndex
CREATE UNIQUE INDEX "Task_serialNumber_key" ON "public"."Task"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Task_plate_key" ON "public"."Task"("plate");

-- CreateIndex
CREATE INDEX "Task_status_sectorId_idx" ON "public"."Task"("status", "sectorId");

-- CreateIndex
CREATE INDEX "Task_statusOrder_idx" ON "public"."Task"("statusOrder");

-- CreateIndex
CREATE INDEX "Task_term_idx" ON "public"."Task"("term");

-- CreateIndex
CREATE INDEX "Task_createdAt_idx" ON "public"."Task"("createdAt");

-- CreateIndex
CREATE INDEX "Task_customerId_idx" ON "public"."Task"("customerId");

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "public"."Task"("createdById");

-- CreateIndex
CREATE INDEX "Cut_status_idx" ON "public"."Cut"("status");

-- CreateIndex
CREATE INDEX "Cut_statusOrder_idx" ON "public"."Cut"("statusOrder");

-- CreateIndex
CREATE INDEX "Cut_taskId_idx" ON "public"."Cut"("taskId");

-- CreateIndex
CREATE INDEX "Cut_parentCutId_idx" ON "public"."Cut"("parentCutId");

-- CreateIndex
CREATE INDEX "Cut_origin_idx" ON "public"."Cut"("origin");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_taskId_key" ON "public"."Truck"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_backSideLayoutId_key" ON "public"."Truck"("backSideLayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_leftSideLayoutId_key" ON "public"."Truck"("leftSideLayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_rightSideLayoutId_key" ON "public"."Truck"("rightSideLayoutId");

-- CreateIndex
CREATE INDEX "LayoutSection_layoutId_position_idx" ON "public"."LayoutSection"("layoutId", "position");

-- CreateIndex
CREATE INDEX "GarageLane_garageId_idx" ON "public"."GarageLane"("garageId");

-- CreateIndex
CREATE INDEX "ParkingSpot_garageLaneId_idx" ON "public"."ParkingSpot"("garageLaneId");

-- CreateIndex
CREATE UNIQUE INDEX "SecullumToken_identifier_key" ON "public"."SecullumToken"("identifier");

-- CreateIndex
CREATE INDEX "SecullumToken_expiresAt_idx" ON "public"."SecullumToken"("expiresAt");

-- CreateIndex
CREATE INDEX "SecullumToken_identifier_idx" ON "public"."SecullumToken"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "public"."User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_preferenceId_key" ON "public"."User"("preferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "User_pis_key" ON "public"."User"("pis");

-- CreateIndex
CREATE UNIQUE INDEX "User_cpf_key" ON "public"."User"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "User_sessionToken_key" ON "public"."User"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_secullum_id_key" ON "public"."User"("secullum_id");

-- CreateIndex
CREATE INDEX "User_status_sectorId_idx" ON "public"."User"("status", "sectorId");

-- CreateIndex
CREATE INDEX "User_statusOrder_idx" ON "public"."User"("statusOrder");

-- CreateIndex
CREATE INDEX "User_admissional_idx" ON "public"."User"("admissional");

-- CreateIndex
CREATE INDEX "User_dismissal_idx" ON "public"."User"("dismissal");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "public"."User"("phone");

-- CreateIndex
CREATE INDEX "User_email_phone_idx" ON "public"."User"("email", "phone");

-- CreateIndex
CREATE INDEX "User_verificationCode_idx" ON "public"."User"("verificationCode");

-- CreateIndex
CREATE INDEX "User_verificationExpiresAt_idx" ON "public"."User"("verificationExpiresAt");

-- CreateIndex
CREATE INDEX "User_verificationType_idx" ON "public"."User"("verificationType");

-- CreateIndex
CREATE INDEX "User_sessionToken_idx" ON "public"."User"("sessionToken");

-- CreateIndex
CREATE INDEX "User_verified_idx" ON "public"."User"("verified");

-- CreateIndex
CREATE INDEX "Vacation_userId_idx" ON "public"."Vacation"("userId");

-- CreateIndex
CREATE INDEX "Vacation_startAt_endAt_idx" ON "public"."Vacation"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "Vacation_statusOrder_idx" ON "public"."Vacation"("statusOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Preferences_userId_key" ON "public"."Preferences"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "public"."Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_scheduledAt_idx" ON "public"."Notification"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeenNotification_userId_notificationId_key" ON "public"."SeenNotification"("userId", "notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "thumbnail_jobs_file_id_key" ON "public"."thumbnail_jobs"("file_id");

-- CreateIndex
CREATE INDEX "_AIRBRUSHING_ARTWORKS_B_index" ON "public"."_AIRBRUSHING_ARTWORKS"("B");

-- CreateIndex
CREATE INDEX "_AIRBRUSHING_NFES_B_index" ON "public"."_AIRBRUSHING_NFES"("B");

-- CreateIndex
CREATE INDEX "_AIRBRUSHING_RECEIPTS_B_index" ON "public"."_AIRBRUSHING_RECEIPTS"("B");

-- CreateIndex
CREATE INDEX "_BonusPeriodUsers_B_index" ON "public"."_BonusPeriodUsers"("B");

-- CreateIndex
CREATE INDEX "_BonusTasks_B_index" ON "public"."_BonusTasks"("B");

-- CreateIndex
CREATE INDEX "_FileToWarning_B_index" ON "public"."_FileToWarning"("B");

-- CreateIndex
CREATE INDEX "_OBSERVATIONS_FILES_B_index" ON "public"."_OBSERVATIONS_FILES"("B");

-- CreateIndex
CREATE INDEX "_TASK_FILES_B_index" ON "public"."_TASK_FILES"("B");

-- CreateIndex
CREATE INDEX "_PAINT_BRAND_COMPONENT_ITEMS_B_index" ON "public"."_PAINT_BRAND_COMPONENT_ITEMS"("B");

-- CreateIndex
CREATE INDEX "_PAINT_TYPE_COMPONENT_ITEMS_B_index" ON "public"."_PAINT_TYPE_COMPONENT_ITEMS"("B");

-- CreateIndex
CREATE INDEX "_RelatedItems_B_index" ON "public"."_RelatedItems"("B");

-- CreateIndex
CREATE INDEX "_RelatedPaints_B_index" ON "public"."_RelatedPaints"("B");

-- CreateIndex
CREATE INDEX "_TASK_LOGO_PAINT_B_index" ON "public"."_TASK_LOGO_PAINT"("B");

-- CreateIndex
CREATE INDEX "_RelatedTasks_B_index" ON "public"."_RelatedTasks"("B");

-- CreateIndex
CREATE INDEX "_WITNESS_WARNING_B_index" ON "public"."_WITNESS_WARNING"("B");

-- CreateIndex
CREATE INDEX "_NotificationPreferenceToPreferences_B_index" ON "public"."_NotificationPreferenceToPreferences"("B");

-- AddForeignKey
ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "public"."OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Airbrushing" ADD CONSTRAINT "Airbrushing_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Borrow" ADD CONSTRAINT "Borrow_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Borrow" ADD CONSTRAINT "Borrow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChangeLog" ADD CONSTRAINT "ChangeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Bonus" ADD CONSTRAINT "Bonus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Bonus" ADD CONSTRAINT "Bonus_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "public"."Payroll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Payroll" ADD CONSTRAINT "Payroll_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Payroll" ADD CONSTRAINT "Payroll_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "public"."Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BonusDiscount" ADD CONSTRAINT "BonusDiscount_bonusId_fkey" FOREIGN KEY ("bonusId") REFERENCES "public"."Bonus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayrollDiscount" ADD CONSTRAINT "PayrollDiscount_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "public"."Payroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Customer" ADD CONSTRAINT "Customer_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PpeSize" ADD CONSTRAINT "PpeSize_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PpeDelivery" ADD CONSTRAINT "PpeDelivery_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PpeDelivery" ADD CONSTRAINT "PpeDelivery_ppeScheduleId_fkey" FOREIGN KEY ("ppeScheduleId") REFERENCES "public"."PpeDeliverySchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PpeDelivery" ADD CONSTRAINT "PpeDelivery_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PpeDelivery" ADD CONSTRAINT "PpeDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PpeDeliverySchedule" ADD CONSTRAINT "PpeDeliverySchedule_monthlyConfigId_fkey" FOREIGN KEY ("monthlyConfigId") REFERENCES "public"."MonthlyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PpeDeliverySchedule" ADD CONSTRAINT "PpeDeliverySchedule_weeklyConfigId_fkey" FOREIGN KEY ("weeklyConfigId") REFERENCES "public"."WeeklyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PpeDeliverySchedule" ADD CONSTRAINT "PpeDeliverySchedule_yearlyConfigId_fkey" FOREIGN KEY ("yearlyConfigId") REFERENCES "public"."YearlyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Price" ADD CONSTRAINT "Price_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Measure" ADD CONSTRAINT "Measure_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PositionRemuneration" ADD CONSTRAINT "PositionRemuneration_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "public"."Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Item" ADD CONSTRAINT "Item_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "public"."ItemBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."ItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Item" ADD CONSTRAINT "Item_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderRule" ADD CONSTRAINT "OrderRule_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderRule" ADD CONSTRAINT "OrderRule_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Observation" ADD CONSTRAINT "Observation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExternalWithdrawal" ADD CONSTRAINT "ExternalWithdrawal_nfeId_fkey" FOREIGN KEY ("nfeId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExternalWithdrawal" ADD CONSTRAINT "ExternalWithdrawal_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExternalWithdrawalItem" ADD CONSTRAINT "ExternalWithdrawalItem_externalWithdrawalId_fkey" FOREIGN KEY ("externalWithdrawalId") REFERENCES "public"."ExternalWithdrawal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExternalWithdrawalItem" ADD CONSTRAINT "ExternalWithdrawalItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Maintenance" ADD CONSTRAINT "Maintenance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Maintenance" ADD CONSTRAINT "Maintenance_maintenanceScheduleId_fkey" FOREIGN KEY ("maintenanceScheduleId") REFERENCES "public"."MaintenanceSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "public"."Maintenance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_monthlyConfigId_fkey" FOREIGN KEY ("monthlyConfigId") REFERENCES "public"."MonthlyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_weeklyConfigId_fkey" FOREIGN KEY ("weeklyConfigId") REFERENCES "public"."WeeklyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_yearlyConfigId_fkey" FOREIGN KEY ("yearlyConfigId") REFERENCES "public"."YearlyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_nfeId_fkey" FOREIGN KEY ("nfeId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_orderScheduleId_fkey" FOREIGN KEY ("orderScheduleId") REFERENCES "public"."OrderSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_ppeScheduleId_fkey" FOREIGN KEY ("ppeScheduleId") REFERENCES "public"."PpeDeliverySchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderSchedule" ADD CONSTRAINT "OrderSchedule_monthlyConfigId_fkey" FOREIGN KEY ("monthlyConfigId") REFERENCES "public"."MonthlyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderSchedule" ADD CONSTRAINT "OrderSchedule_weeklyConfigId_fkey" FOREIGN KEY ("weeklyConfigId") REFERENCES "public"."WeeklyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderSchedule" ADD CONSTRAINT "OrderSchedule_yearlyConfigId_fkey" FOREIGN KEY ("yearlyConfigId") REFERENCES "public"."YearlyScheduleConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaintProduction" ADD CONSTRAINT "PaintProduction_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "public"."PaintFormula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Paint" ADD CONSTRAINT "Paint_paintBrandId_fkey" FOREIGN KEY ("paintBrandId") REFERENCES "public"."PaintBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Paint" ADD CONSTRAINT "Paint_paintTypeId_fkey" FOREIGN KEY ("paintTypeId") REFERENCES "public"."PaintType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaintGround" ADD CONSTRAINT "PaintGround_groundPaintId_fkey" FOREIGN KEY ("groundPaintId") REFERENCES "public"."Paint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaintGround" ADD CONSTRAINT "PaintGround_paintId_fkey" FOREIGN KEY ("paintId") REFERENCES "public"."Paint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaintFormula" ADD CONSTRAINT "PaintFormula_paintId_fkey" FOREIGN KEY ("paintId") REFERENCES "public"."Paint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaintFormulaComponent" ADD CONSTRAINT "PaintFormulaComponent_formulaPaintId_fkey" FOREIGN KEY ("formulaPaintId") REFERENCES "public"."PaintFormula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaintFormulaComponent" ADD CONSTRAINT "PaintFormulaComponent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Warning" ADD CONSTRAINT "Warning_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Warning" ADD CONSTRAINT "Warning_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceOrder" ADD CONSTRAINT "ServiceOrder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Supplier" ADD CONSTRAINT "Supplier_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_nfeId_fkey" FOREIGN KEY ("nfeId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_paintId_fkey" FOREIGN KEY ("paintId") REFERENCES "public"."Paint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "public"."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_bonusDiscountId_fkey" FOREIGN KEY ("bonusDiscountId") REFERENCES "public"."BonusDiscount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Cut" ADD CONSTRAINT "Cut_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "public"."File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Cut" ADD CONSTRAINT "Cut_parentCutId_fkey" FOREIGN KEY ("parentCutId") REFERENCES "public"."Cut"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Cut" ADD CONSTRAINT "Cut_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Truck" ADD CONSTRAINT "Truck_backSideLayoutId_fkey" FOREIGN KEY ("backSideLayoutId") REFERENCES "public"."Layout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Truck" ADD CONSTRAINT "Truck_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "public"."Garage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Truck" ADD CONSTRAINT "Truck_leftSideLayoutId_fkey" FOREIGN KEY ("leftSideLayoutId") REFERENCES "public"."Layout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Truck" ADD CONSTRAINT "Truck_rightSideLayoutId_fkey" FOREIGN KEY ("rightSideLayoutId") REFERENCES "public"."Layout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Truck" ADD CONSTRAINT "Truck_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Layout" ADD CONSTRAINT "Layout_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LayoutSection" ADD CONSTRAINT "LayoutSection_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "public"."Layout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GarageLane" ADD CONSTRAINT "GarageLane_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "public"."Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ParkingSpot" ADD CONSTRAINT "ParkingSpot_garageLaneId_fkey" FOREIGN KEY ("garageLaneId") REFERENCES "public"."GarageLane"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_managedSectorId_fkey" FOREIGN KEY ("managedSectorId") REFERENCES "public"."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "public"."Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "public"."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Vacation" ADD CONSTRAINT "Vacation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Preferences" ADD CONSTRAINT "Preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SeenNotification" ADD CONSTRAINT "SeenNotification_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "public"."Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SeenNotification" ADD CONSTRAINT "SeenNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."thumbnail_jobs" ADD CONSTRAINT "thumbnail_jobs_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_AIRBRUSHING_ARTWORKS" ADD CONSTRAINT "_AIRBRUSHING_ARTWORKS_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Airbrushing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_AIRBRUSHING_ARTWORKS" ADD CONSTRAINT "_AIRBRUSHING_ARTWORKS_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_AIRBRUSHING_NFES" ADD CONSTRAINT "_AIRBRUSHING_NFES_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Airbrushing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_AIRBRUSHING_NFES" ADD CONSTRAINT "_AIRBRUSHING_NFES_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_AIRBRUSHING_RECEIPTS" ADD CONSTRAINT "_AIRBRUSHING_RECEIPTS_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Airbrushing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_AIRBRUSHING_RECEIPTS" ADD CONSTRAINT "_AIRBRUSHING_RECEIPTS_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_BonusPeriodUsers" ADD CONSTRAINT "_BonusPeriodUsers_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Bonus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_BonusPeriodUsers" ADD CONSTRAINT "_BonusPeriodUsers_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_BonusTasks" ADD CONSTRAINT "_BonusTasks_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Bonus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_BonusTasks" ADD CONSTRAINT "_BonusTasks_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_FileToWarning" ADD CONSTRAINT "_FileToWarning_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_FileToWarning" ADD CONSTRAINT "_FileToWarning_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Warning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_OBSERVATIONS_FILES" ADD CONSTRAINT "_OBSERVATIONS_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_OBSERVATIONS_FILES" ADD CONSTRAINT "_OBSERVATIONS_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_TASK_FILES" ADD CONSTRAINT "_TASK_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_TASK_FILES" ADD CONSTRAINT "_TASK_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_PAINT_BRAND_COMPONENT_ITEMS" ADD CONSTRAINT "_PAINT_BRAND_COMPONENT_ITEMS_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_PAINT_BRAND_COMPONENT_ITEMS" ADD CONSTRAINT "_PAINT_BRAND_COMPONENT_ITEMS_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."PaintBrand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_PAINT_TYPE_COMPONENT_ITEMS" ADD CONSTRAINT "_PAINT_TYPE_COMPONENT_ITEMS_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_PAINT_TYPE_COMPONENT_ITEMS" ADD CONSTRAINT "_PAINT_TYPE_COMPONENT_ITEMS_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."PaintType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_RelatedItems" ADD CONSTRAINT "_RelatedItems_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_RelatedItems" ADD CONSTRAINT "_RelatedItems_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_RelatedPaints" ADD CONSTRAINT "_RelatedPaints_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Paint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_RelatedPaints" ADD CONSTRAINT "_RelatedPaints_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Paint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_TASK_LOGO_PAINT" ADD CONSTRAINT "_TASK_LOGO_PAINT_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Paint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_TASK_LOGO_PAINT" ADD CONSTRAINT "_TASK_LOGO_PAINT_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_RelatedTasks" ADD CONSTRAINT "_RelatedTasks_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_RelatedTasks" ADD CONSTRAINT "_RelatedTasks_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_WITNESS_WARNING" ADD CONSTRAINT "_WITNESS_WARNING_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_WITNESS_WARNING" ADD CONSTRAINT "_WITNESS_WARNING_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Warning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_NotificationPreferenceToPreferences" ADD CONSTRAINT "_NotificationPreferenceToPreferences_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."NotificationPreference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_NotificationPreferenceToPreferences" ADD CONSTRAINT "_NotificationPreferenceToPreferences_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Preferences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

