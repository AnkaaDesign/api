// packages/utils/src/masking.ts

import { cleanCPF, cleanCNPJ, cleanPhone, cleanPIS } from "./cleaners";
import { formatCPF, formatCNPJ, formatPhone, formatPIS } from "./formatters";

export const maskCPF = (value: string): string => {
  try {
    return formatCPF(cleanCPF(value));
  } catch {
    return value;
  }
};

export const maskCNPJ = (value: string): string => {
  try {
    return formatCNPJ(cleanCNPJ(value));
  } catch {
    return value;
  }
};

export const maskPhone = (value: string): string => {
  try {
    return formatPhone(cleanPhone(value));
  } catch {
    return value;
  }
};

export const maskPIS = (value: string): string => {
  try {
    return formatPIS(cleanPIS(value));
  } catch {
    return value;
  }
};
