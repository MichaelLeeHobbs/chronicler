import { isReservedTopLevelField } from './reserved';

const isSimpleValue = (value: unknown): value is string | number | boolean | null =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

const DANGEROUS_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

export type ContextValue = string | number | boolean | null;

export type ContextRecord = Record<string, ContextValue>;

export interface ContextCollisionDetail {
  readonly key: string;
  readonly existingValue: ContextValue;
  readonly attemptedValue: ContextValue;
}

export interface ContextValidationResult {
  readonly collisions: string[];
  readonly reserved: string[];
  readonly collisionDetails: ContextCollisionDetail[];
  readonly dropped: string[];
}

/**
 * Sanitize and validate context input
 *
 * **Validation Strategy:**
 * - Returns validation results rather than throwing errors
 * - Logs should succeed even with invalid metadata
 * - Validation errors are reported via system events and _validation metadata
 *
 * **Collision Handling:**
 * - When a key exists with a different value, the ORIGINAL value is preserved
 * - The attempted new value is rejected
 * - A collision detail is recorded for system event emission
 *
 * **Reserved Fields:**
 * - Reserved field attempts are silently dropped
 * - A warning is recorded for system event emission
 *
 * @param context - New context to add
 * @param existingContext - Current context (for collision detection)
 * @returns Sanitized context and validation results
 *
 * @see {@link ContextValidationResult} for validation result structure
 */
export const sanitizeContextInput = (
  context: ContextRecord,
  existingContext: ContextRecord = {},
  maxNewKeys = Infinity,
): {
  context: ContextRecord;
  validation: ContextValidationResult;
} => {
  const sanitized: ContextRecord = {};
  const collisions: string[] = [];
  const reserved: string[] = [];
  const collisionDetails: ContextCollisionDetail[] = [];
  const dropped: string[] = [];
  let acceptedCount = 0;

  for (const [key, rawValue] of Object.entries(context)) {
    if (isReservedTopLevelField(key)) {
      reserved.push(key);
      continue;
    }

    if (DANGEROUS_KEYS.has(key)) {
      reserved.push(key);
      continue;
    }

    // Invalid type (object, array, undefined, etc.) - skip this key
    if (!isSimpleValue(rawValue)) continue;

    if (Object.hasOwn(existingContext, key) || Object.hasOwn(sanitized, key)) {
      collisions.push(key);
      const existingValue = (
        Object.hasOwn(sanitized, key) ? sanitized[key] : existingContext[key]
      )!;
      collisionDetails.push({ key, existingValue, attemptedValue: rawValue });
      continue;
    }

    if (acceptedCount >= maxNewKeys) {
      dropped.push(key);
      continue;
    }

    sanitized[key] = rawValue;
    acceptedCount++;
  }

  return { context: sanitized, validation: { collisions, reserved, collisionDetails, dropped } };
};

/**
 * Immutable-snapshot context store for structured log metadata.
 *
 * Context is accumulated over time via {@link add}. Collisions (duplicate keys
 * with different values) preserve the original value and are reported via the
 * returned {@link ContextValidationResult}. Reserved field names are silently
 * dropped.
 */
export class ContextStore {
  private readonly context: ContextRecord = {};
  private readonly maxKeys: number;

  constructor(initial: ContextRecord = {}, maxKeys = Infinity) {
    this.maxKeys = maxKeys;
    const { context } = sanitizeContextInput(initial, {}, maxKeys);
    this.context = { ...context };
  }

  /**
   * Merge new context into the store.
   *
   * @param raw - Key-value pairs to add
   * @returns Validation result with any collisions or reserved field attempts
   */
  add(raw: ContextRecord): ContextValidationResult {
    const remaining = Math.max(0, this.maxKeys - Object.keys(this.context).length);
    const { context, validation } = sanitizeContextInput(raw, this.context, remaining);
    Object.assign(this.context, context);
    return validation;
  }

  /**
   * Return a shallow copy of the current context.
   *
   * @returns A new object containing all accumulated context key-value pairs
   */
  snapshot(): ContextRecord {
    return { ...this.context };
  }
}
