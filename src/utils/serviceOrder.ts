import { SERVICE_ORDER_STATUS_LABELS } from '@constants';
import { SERVICE_ORDER_STATUS } from '@constants';
import type { ServiceOrder } from '@types';
import type { ServiceOrderStatus } from "@prisma/client";

/**
 * Map SERVICE_ORDER_STATUS enum to Prisma ServiceOrderStatus enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapServiceOrderStatusToPrisma(status: SERVICE_ORDER_STATUS | string): ServiceOrderStatus {
  return status as ServiceOrderStatus;
}

export const isServiceOrderStarted = (serviceOrder: Pick<ServiceOrder, "startedAt">): boolean => {
  return serviceOrder.startedAt !== null;
};

export const isServiceOrderFinished = (serviceOrder: Pick<ServiceOrder, "finishedAt">): boolean => {
  return serviceOrder.finishedAt !== null;
};

export const getServiceOrderStatus = (serviceOrder: Pick<ServiceOrder, "startedAt" | "finishedAt">): "pending" | "in_progress" | "completed" => {
  if (serviceOrder.finishedAt) return "completed";
  if (serviceOrder.startedAt) return "in_progress";
  return "pending";
};

export const calculateServiceOrderDuration = (serviceOrder: Pick<ServiceOrder, "startedAt" | "finishedAt">): number | null => {
  if (!serviceOrder.startedAt) return null;

  const endTime = serviceOrder.finishedAt || new Date();
  return endTime.getTime() - serviceOrder.startedAt.getTime();
};

export const canStartServiceOrder = (serviceOrder: Pick<ServiceOrder, "startedAt" | "finishedAt">): boolean => {
  return !serviceOrder.startedAt && !serviceOrder.finishedAt;
};

export const canFinishServiceOrder = (serviceOrder: Pick<ServiceOrder, "startedAt" | "finishedAt">): boolean => {
  return serviceOrder.startedAt !== null && !serviceOrder.finishedAt;
};

export function getServiceOrderStatusLabel(status: SERVICE_ORDER_STATUS): string {
  return SERVICE_ORDER_STATUS_LABELS[status] || status;
}
