import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';

/**
 * Pipe to fix array serialization issues where arrays are converted to objects
 * with numeric keys (e.g., { '0': 'value1', '1': 'value2' } -> ['value1', 'value2'])
 */
@Injectable()
export class ArrayFixPipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    if (metadata.type !== 'body') {
      return value;
    }

    // When body is undefined/null (e.g., file-only FormData), return empty object
    // This allows validation to pass with all-optional schemas
    if (!value) {
      return {};
    }

    if (typeof value !== 'object') {
      return value;
    }

    return this.fixArrays(value);
  }

  private fixArrays(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.fixArrays(item));
    }

    // Handle JSON strings (from FormData)
    if (typeof obj === 'string') {
      try {
        const parsed = JSON.parse(obj);
        // Only process if it's an object or array
        if (typeof parsed === 'object' && parsed !== null) {
          return this.fixArrays(parsed);
        }
      } catch (e) {
        // Not JSON, return as-is
        return obj;
      }
      return obj;
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    // ✅ FIX: Don't process Date objects - they are valid values
    if (obj instanceof Date) {
      return obj;
    }

    // Check if this object looks like a serialized array
    if (this.isSerializedArray(obj)) {
      return this.convertToArray(obj);
    }

    // Recursively fix nested objects
    const fixed: any = {};
    for (const [key, value] of Object.entries(obj)) {
      fixed[key] = this.fixArrays(value);
    }

    return fixed;
  }

  private isSerializedArray(obj: any): boolean {
    const keys = Object.keys(obj);
    if (keys.length === 0) return false;

    // Check if all keys are numeric and sequential starting from 0
    const numericKeys = keys.map(k => parseInt(k, 10));
    if (numericKeys.some(k => isNaN(k))) return false;

    numericKeys.sort((a, b) => a - b);
    return numericKeys.every((key, index) => key === index);
  }

  private convertToArray(obj: any): any[] {
    const keys = Object.keys(obj)
      .map(k => parseInt(k, 10))
      .sort((a, b) => a - b);
    const array: any[] = [];

    for (const key of keys) {
      array.push(this.fixArrays(obj[key.toString()]));
    }

    return array;
  }
}
