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

export type ReservedTopLevelField = (typeof RESERVED_TOP_LEVEL_FIELDS)[number];

// Set for O(1) lookup during validation
const TOP_LEVEL_SET = new Set<string>(RESERVED_TOP_LEVEL_FIELDS);

/**
 * Export RESERVED_TOP_LEVEL_FIELDS for CLI validation
 */
export { RESERVED_TOP_LEVEL_FIELDS };

/**
 * Check if a key is a reserved top-level field
 */
export const isReservedTopLevelField = (key: string): key is ReservedTopLevelField =>
  TOP_LEVEL_SET.has(key);

/**
 * Check a record for reserved keys and return array of violations
 * @param record - Object to check
 * @returns Array of reserved keys found in the record
 */
export const assertNoReservedKeys = (record: Record<string, unknown>): string[] => {
  const invalid: string[] = [];
  for (const key of Object.keys(record)) {
    if (isReservedTopLevelField(key)) {
      invalid.push(key);
    }
  }
  return invalid;
};
