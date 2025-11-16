import type { ReservedTopLevelField } from './reserved';
import { isReservedTopLevelField } from './reserved';

type SimpleValue = string | number | boolean | null;
export type ContextValue = SimpleValue | SimpleValue[];

export type ContextRecord = Record<string, ContextValue>;

export type ContextKey = Exclude<string, ReservedTopLevelField>;

export interface ContextCollisionDetail {
  key: string;
  existingValue: ContextValue | undefined;
  attemptedValue: ContextValue;
}

export interface ContextValidationResult {
  collisions: string[];
  reserved: string[];
  collisionDetails: ContextCollisionDetail[];
}

/**
 * Defensive normalization of context values.
 *
 * TypeScript types enforce ContextValue at compile time via the ContextRecord type,
 * but this provides runtime safety against:
 * - Type bypassing (e.g., via `as any`)
 * - Mixed-type arrays that slip through
 * - Invalid values from external sources
 *
 * Accepts primitives (string, number, boolean, null) and arrays of primitives.
 * Returns undefined for invalid types (objects, functions, etc.)
 */
const normalizeValue = (value: unknown): ContextValue | undefined => {
  // Handle null explicitly
  if (value === null) {
    return null;
  }

  // Handle primitives
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  // Handle arrays of primitives
  if (Array.isArray(value)) {
    const normalized: SimpleValue[] = [];
    for (const item of value) {
      if (
        item === null ||
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean'
      ) {
        normalized.push(item as SimpleValue);
      }
      // Skip invalid items (objects, nested arrays, undefined, etc.)
    }
    return normalized;
  }

  // Invalid type - return undefined to skip
  return undefined;
};

export const sanitizeContextInput = (
  context: ContextRecord,
  existingContext: ContextRecord = {},
): { context: ContextRecord; validation: ContextValidationResult } => {
  const sanitized: ContextRecord = {};
  const collisions: string[] = [];
  const reserved: string[] = [];
  const collisionDetails: ContextCollisionDetail[] = [];

  for (const [key, rawValue] of Object.entries(context)) {
    if (isReservedTopLevelField(key)) {
      reserved.push(key);
      continue;
    }

    // Normalize value to allowed ContextValue types
    const normalized = normalizeValue(rawValue);

    if (normalized === undefined) {
      // Invalid type - skip this key
      continue;
    }

    if (key in existingContext || key in sanitized) {
      collisions.push(key);
      const existingValue = (key in sanitized ? sanitized[key] : existingContext[key]) as
        | ContextValue
        | undefined;
      collisionDetails.push({ key, existingValue, attemptedValue: normalized });
      continue;
    }

    sanitized[key] = normalized;
  }

  return { context: sanitized, validation: { collisions, reserved, collisionDetails } };
};

export class ContextStore {
  private readonly context: ContextRecord = {};
  private pendingCollisions = new Set<string>();

  constructor(initial: ContextRecord = {}) {
    const { context, validation } = sanitizeContextInput(initial);
    this.context = { ...context };
    this.track(validation);
  }

  add(raw: ContextRecord): ContextValidationResult {
    const { context, validation } = sanitizeContextInput(raw, this.context);
    Object.assign(this.context, context);
    this.track(validation);
    return validation;
  }

  snapshot(): ContextRecord {
    return { ...this.context };
  }

  consumeCollisions(): string[] {
    const collisions = Array.from(this.pendingCollisions);
    this.pendingCollisions.clear();
    return collisions;
  }

  private track(validation: ContextValidationResult): void {
    validation.collisions.forEach((key) => this.pendingCollisions.add(key));
  }
}
