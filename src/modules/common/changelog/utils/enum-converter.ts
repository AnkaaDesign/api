import { ENTITY_TYPE, CHANGE_LOG_ENTITY_TYPE } from '../../../../constants';

/**
 * Converts ENTITY_TYPE to CHANGE_LOG_ENTITY_TYPE
 *
 * Both enums have identical string values, so this function provides a safe
 * type conversion between the two enum types to resolve TypeScript errors
 * when passing ENTITY_TYPE values to functions that expect CHANGE_LOG_ENTITY_TYPE.
 *
 * @param entityType - The ENTITY_TYPE value to convert
 * @returns The corresponding CHANGE_LOG_ENTITY_TYPE value
 * @throws Error if the entity type cannot be converted (shouldn't happen with current enum structures)
 *
 * @example
 * ```typescript
 * // Converting for changelog logging
 * const entityType = ENTITY_TYPE.USER;
 * const changeLogEntityType = convertToChangeLogEntityType(entityType);
 *
 * // Use in changelog service
 * await this.changeLogService.logChange(
 *   changeLogEntityType,
 *   CHANGE_LOG_ACTION.CREATE,
 *   user.id,
 *   null,
 *   user,
 *   userId
 * );
 * ```
 */
export function convertToChangeLogEntityType(entityType: ENTITY_TYPE): CHANGE_LOG_ENTITY_TYPE {
  // Since both enums have identical string values, we can safely cast
  // the string value to the target enum type
  const entityTypeValue = entityType as string;

  // Verify that the value exists in CHANGE_LOG_ENTITY_TYPE
  const changeLogEntityType = entityTypeValue as CHANGE_LOG_ENTITY_TYPE;

  // Type-safe validation: check if the value exists in the target enum
  if (!Object.values(CHANGE_LOG_ENTITY_TYPE).includes(changeLogEntityType)) {
    throw new Error(
      `Cannot convert ENTITY_TYPE.${entityType} to CHANGE_LOG_ENTITY_TYPE. ` +
        `Value "${entityTypeValue}" does not exist in CHANGE_LOG_ENTITY_TYPE enum.`,
    );
  }

  return changeLogEntityType;
}

/**
 * Type guard to check if an ENTITY_TYPE value can be converted to CHANGE_LOG_ENTITY_TYPE
 *
 * @param entityType - The ENTITY_TYPE value to check
 * @returns True if the conversion is possible, false otherwise
 *
 * @example
 * ```typescript
 * if (canConvertToChangeLogEntityType(ENTITY_TYPE.USER)) {
 *   const changeLogType = convertToChangeLogEntityType(ENTITY_TYPE.USER);
 *   // Safe to use changeLogType
 * }
 * ```
 */
export function canConvertToChangeLogEntityType(entityType: ENTITY_TYPE): boolean {
  try {
    convertToChangeLogEntityType(entityType);
    return true;
  } catch {
    return false;
  }
}

/**
 * Batch converts multiple ENTITY_TYPE values to CHANGE_LOG_ENTITY_TYPE
 *
 * @param entityTypes - Array of ENTITY_TYPE values to convert
 * @returns Array of corresponding CHANGE_LOG_ENTITY_TYPE values
 * @throws Error if any entity type cannot be converted
 *
 * @example
 * ```typescript
 * const entityTypes = [ENTITY_TYPE.USER, ENTITY_TYPE.TASK, ENTITY_TYPE.ITEM];
 * const changeLogTypes = batchConvertToChangeLogEntityType(entityTypes);
 * ```
 */
export function batchConvertToChangeLogEntityType(
  entityTypes: ENTITY_TYPE[],
): CHANGE_LOG_ENTITY_TYPE[] {
  return entityTypes.map(entityType => convertToChangeLogEntityType(entityType));
}

/**
 * Creates a mapping object from ENTITY_TYPE to CHANGE_LOG_ENTITY_TYPE
 * for efficient lookups when dealing with multiple conversions
 *
 * @returns Record mapping ENTITY_TYPE values to CHANGE_LOG_ENTITY_TYPE values
 *
 * @example
 * ```typescript
 * const conversionMap = createEntityTypeConversionMap();
 * const changeLogType = conversionMap[ENTITY_TYPE.USER];
 * ```
 */
export function createEntityTypeConversionMap(): Record<ENTITY_TYPE, CHANGE_LOG_ENTITY_TYPE> {
  const map = {} as Record<ENTITY_TYPE, CHANGE_LOG_ENTITY_TYPE>;

  // Build the mapping for all valid conversions
  Object.values(ENTITY_TYPE).forEach(entityType => {
    if (canConvertToChangeLogEntityType(entityType)) {
      map[entityType] = convertToChangeLogEntityType(entityType);
    }
  });

  return map;
}
