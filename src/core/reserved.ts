/** Reserved top-level field names that cannot be used in user context or metadata. */
export const RESERVED_TOP_LEVEL_FIELDS = [
  'eventKey',
  'level',
  'message',
  'correlationId',
  'forkId',
  'timestamp',
  'fields',
  '_validation',
] as const;

export type ReservedTopLevelField = (typeof RESERVED_TOP_LEVEL_FIELDS)[number];

/** Set for O(1) lookup during validation. */
const TOP_LEVEL_SET = new Set<string>(RESERVED_TOP_LEVEL_FIELDS);

/**
 * Check if a key is a reserved top-level field.
 *
 * @param key - Field name to check against the reserved set
 * @returns True if the key is reserved and must not be used in user context or metadata
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
