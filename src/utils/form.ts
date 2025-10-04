/**
 * Safely extracts error message from various error types
 * @param error - The error object
 * @returns A user-friendly error message
 */
export function getErrorMessage(error: unknown): string {
  if (!error) return "Erro desconhecido";

  if (typeof error === "string") return error;

  if (error instanceof Error) return error.message;

  if (typeof error === "object" && "message" in error) {
    return String((error as any).message);
  }

  return "Erro desconhecido";
}

/**
 * Safely converts any value to string
 * @param value - The value to convert
 * @returns String representation or empty string for null/undefined
 */
export function safeToString(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") return value;

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Deep equality comparison that properly handles Date objects
 * Unlike JSON.stringify comparison, this correctly compares Date instances
 */
function deepEquals(a: any, b: any): boolean {
  // Primitive equality
  if (a === b) return true;

  // Both null/undefined
  if (a == null && b == null) return true;

  // One is null/undefined, other isn't
  if (a == null || b == null) return false;

  // ✅ FIX: Handle Date comparison properly
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // One is Date, other isn't
  if (a instanceof Date || b instanceof Date) return false;

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEquals(item, b[index]));
  }

  // One is array, other isn't
  if (Array.isArray(a) || Array.isArray(b)) return false;

  // Handle objects
  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) => deepEquals(a[key], b[key]));
  }

  // Different types or values
  return false;
}

/**
 * Extracts changed fields by comparing two objects
 * Used for optimizing API updates by only sending modified fields
 */
export function getChangedFields<T extends Record<string, any>>(originalData: T, newData: T, ignoreFields: string[] = []): Partial<T> {
  const changedFields: Partial<T> = {};

  Object.keys(newData).forEach((key) => {
    if (ignoreFields.includes(key)) return;

    const originalValue = originalData[key];
    const newValue = newData[key];

    // Use Date-aware deep equality comparison
    if (!deepEquals(originalValue, newValue)) {
      changedFields[key as keyof T] = newValue;
    }
  });

  return changedFields;
}

/**
 * Validates if all required fields in a form are filled
 */
export function validateRequiredFields<T extends Record<string, any>>(data: T, requiredFields: (keyof T)[]): { isValid: boolean; missingFields: (keyof T)[] } {
  const missingFields: (keyof T)[] = [];

  requiredFields.forEach((field) => {
    const value = data[field];
    if (value == null || value === "" || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0)) {
      missingFields.push(field);
    }
  });

  return {
    isValid: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Transforms form data by trimming string values and removing empty strings
 */
export function cleanFormData<T extends Record<string, any>>(data: T): T {
  const cleaned = {} as T;

  Object.entries(data).forEach(([key, value]) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed !== "") {
        cleaned[key as keyof T] = trimmed as any;
      }
    } else if (value != null) {
      cleaned[key as keyof T] = value;
    }
  });

  return cleaned;
}

/**
 * Debounces a function call
 * Useful for search inputs and form validation
 */
export function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(later, wait);
  };
}

/**
 * Creates a form error message in Portuguese
 */
export function createFormErrorMessage(fieldName: string, errorType: "required" | "invalid" | "min" | "max", extra?: string | number): string {
  const formattedField = fieldName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();

  switch (errorType) {
    case "required":
      return `${formattedField} é obrigatório`;
    case "invalid":
      return `${formattedField} é inválido`;
    case "min":
      return `${formattedField} deve ter no mínimo ${extra} caracteres`;
    case "max":
      return `${formattedField} deve ter no máximo ${extra} caracteres`;
    default:
      return `${formattedField} contém erros`;
  }
}
