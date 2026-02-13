import { isReservedTopLevelField } from './reserved';
import { isSimpleValue } from './utils';

export type ContextValue = string | number | boolean | null;

export type ContextRecord = Record<string, ContextValue>;

export interface ContextCollisionDetail {
  key: string;
  existingValue: ContextValue;
  attemptedValue: ContextValue;
}

export interface ContextValidationResult {
  collisions: string[];
  reserved: string[];
  collisionDetails: ContextCollisionDetail[];
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
 * @see {@link chroniclerSystemEvents} for system events emitted on violations
 */
export const sanitizeContextInput = (
  context: ContextRecord,
  existingContext: ContextRecord = {},
): {
  context: ContextRecord;
  validation: ContextValidationResult;
} => {
  const sanitized: ContextRecord = {};
  const collisions: string[] = [];
  const reserved: string[] = [];
  const collisionDetails: ContextCollisionDetail[] = [];

  for (const [key, rawValue] of Object.entries(context)) {
    if (isReservedTopLevelField(key)) {
      reserved.push(key);
      continue;
    }

    // Invalid type (object, array, undefined, etc.) - skip this key
    if (!isSimpleValue(rawValue)) continue;

    if (key in existingContext || key in sanitized) {
      collisions.push(key);
      const existingValue = (key in sanitized ? sanitized[key] : existingContext[key])!;
      collisionDetails.push({ key, existingValue, attemptedValue: rawValue });
      continue;
    }

    sanitized[key] = rawValue;
  }

  return { context: sanitized, validation: { collisions, reserved, collisionDetails } };
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

  constructor(initial: ContextRecord = {}) {
    const { context } = sanitizeContextInput(initial);
    this.context = { ...context };
  }

  /**
   * Merge new context into the store.
   *
   * @param raw - Key-value pairs to add
   * @returns Validation result with any collisions or reserved field attempts
   */
  add(raw: ContextRecord): ContextValidationResult {
    const { context, validation } = sanitizeContextInput(raw, this.context);
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
