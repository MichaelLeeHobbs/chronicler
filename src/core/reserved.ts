const RESERVED_TOP_LEVEL_FIELDS = [
  'eventKey', // Used in Payload
  'level', // Used in Payload
  'message', // Used in Payload
  'correlationId', // Used in Payload
  'forkId', // Used in Payload
  'timestamp', // Used in Payload
  'hostname', // Used in correlationId generation
  'fields', // Used in Payload
  '_validation', // Used in Payload
] as const;

const RESERVED_VALIDATION_FIELDS = [
  'missingFields',
  'typeErrors',
  'contextCollisions',
  'multipleCompletes',
] as const;

export type ReservedTopLevelField = (typeof RESERVED_TOP_LEVEL_FIELDS)[number];
export type ReservedValidationField = (typeof RESERVED_VALIDATION_FIELDS)[number];

/**
 * Union type of all possible reserved field paths
 * Used for type narrowing in validation functions
 */
export type AllReservedFields = ReservedTopLevelField | `_validation.${ReservedValidationField}`;

// Sets for O(1) lookup during validation
const TOP_LEVEL_SET = new Set<string>(RESERVED_TOP_LEVEL_FIELDS);
const VALIDATION_SET = new Set<string>(RESERVED_VALIDATION_FIELDS);

/**
 * Export RESERVED_TOP_LEVEL_FIELDS for CLI validation
 * RESERVED_VALIDATION_FIELDS is kept internal
 * as it's only used for nested path validation (_validation.*)
 */
export { RESERVED_TOP_LEVEL_FIELDS };

/**
 * Check if a key is a reserved top-level field
 */
export const isReservedTopLevelField = (key: string): key is ReservedTopLevelField =>
  TOP_LEVEL_SET.has(key);

/**
 * Check if a key is any type of reserved field (top-level or nested)
 */
export const isReservedFieldPath = (key: string): key is AllReservedFields => {
  if (isReservedTopLevelField(key)) {
    return true;
  }

  if (key.startsWith('_validation.')) {
    const field = key.replace('_validation.', '');
    return VALIDATION_SET.has(field);
  }

  return false;
};

/**
 * Find all reserved keys in an iterable of strings
 * @param keys - Keys to check
 * @returns Array of reserved keys found
 */
export const findReservedKeys = (keys: Iterable<string>): string[] => {
  const invalid: string[] = [];

  for (const key of keys) {
    if (isReservedFieldPath(key)) {
      invalid.push(key);
    }
  }

  return invalid;
};

/**
 * Check a record for reserved keys and return array of violations
 * @param record - Object to check
 * @returns Array of reserved keys found in the record
 */
export const assertNoReservedKeys = (record: Record<string, unknown>): string[] =>
  findReservedKeys(Object.keys(record));
