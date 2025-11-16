const RESERVED_TOP_LEVEL_FIELDS = [
  'eventKey',
  'level',
  'message',
  'correlationId',
  'forkId',
  'timestamp',
  'hostname',
  // 'environment', // Why was this reserved? It's not used anywhere.
  // 'version', // Why was this reserved? It's not used anywhere.
  // 'service', // Why was this reserved? It's not used anywhere.
  'fields',
  '_perf',
  '_validation',
] as const;

const RESERVED_VALIDATION_FIELDS = [
  'missingFields',
  'typeErrors',
  'contextCollisions',
  'multipleCompletes',
] as const;

const RESERVED_PERF_FIELDS = [
  'heapUsed',
  'heapTotal',
  'external',
  'rss',
  'cpuUser',
  'cpuSystem',
] as const;

export type ReservedTopLevelField = (typeof RESERVED_TOP_LEVEL_FIELDS)[number];
export type ReservedValidationField = (typeof RESERVED_VALIDATION_FIELDS)[number];
export type ReservedPerfField = (typeof RESERVED_PERF_FIELDS)[number];

export type AllReservedFields =
  | ReservedTopLevelField
  | `_validation.${ReservedValidationField}`
  | `_perf.${ReservedPerfField}`;

const TOP_LEVEL_SET = new Set<string>(RESERVED_TOP_LEVEL_FIELDS);
const VALIDATION_SET = new Set<string>(RESERVED_VALIDATION_FIELDS);
const PERF_SET = new Set<string>(RESERVED_PERF_FIELDS);

export const RESERVED_FIELD_PATHS: ReadonlySet<AllReservedFields> = new Set<AllReservedFields>([
  ...RESERVED_TOP_LEVEL_FIELDS,
  ...RESERVED_VALIDATION_FIELDS.map((field) => `_validation.${field}` as const),
  ...RESERVED_PERF_FIELDS.map((field) => `_perf.${field}` as const),
]);

// Export the reserved field arrays for CLI usage
export { RESERVED_PERF_FIELDS, RESERVED_TOP_LEVEL_FIELDS, RESERVED_VALIDATION_FIELDS };

export const isReservedTopLevelField = (key: string): key is ReservedTopLevelField =>
  TOP_LEVEL_SET.has(key);

export const isReservedFieldPath = (key: string): key is AllReservedFields => {
  if (isReservedTopLevelField(key)) {
    return true;
  }

  if (key.startsWith('_validation.')) {
    const field = key.replace('_validation.', '');
    return VALIDATION_SET.has(field);
  }

  if (key.startsWith('_perf.')) {
    const field = key.replace('_perf.', '');
    return PERF_SET.has(field);
  }

  return false;
};

export const findReservedKeys = (keys: Iterable<string>): string[] => {
  const invalid: string[] = [];

  for (const key of keys) {
    if (isReservedFieldPath(key)) {
      invalid.push(key);
    }
  }

  return invalid;
};

export const assertNoReservedKeys = (record: Record<string, unknown>): string[] =>
  findReservedKeys(Object.keys(record));
