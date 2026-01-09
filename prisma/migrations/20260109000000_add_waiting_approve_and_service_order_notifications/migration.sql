-- AddEnumValue: Add WAITING_APPROVE to ServiceOrderStatus
ALTER TYPE "ServiceOrderStatus" ADD VALUE 'WAITING_APPROVE';

-- AddEnumValue: Add SERVICE_ORDER to NotificationType
ALTER TYPE "NotificationType" ADD VALUE 'SERVICE_ORDER';
