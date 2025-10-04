// SMS types following mailer pattern
export interface SmsResult {
  success: boolean;
  message: string;
  messageId?: string;
}

export interface SendSmsOptions {
  to: string;
  message: string;
  options?: Record<string, any>;
}

export interface SmsDeliveryStatus {
  messageId: string;
  status: "pending" | "sent" | "delivered" | "failed";
  error?: string;
  timestamp?: Date;
}

export interface SmsNotificationResponse {
  success: boolean;
  message: string;
  data?: {
    messageId: string;
    deliveryStatus?: SmsDeliveryStatus;
  };
}

export interface BulkSmsResponse {
  success: boolean;
  message: string;
  data?: {
    totalSent: number;
    totalFailed: number;
    results: SmsResult[];
  };
}
