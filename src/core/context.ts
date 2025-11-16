import type { ReservedTopLevelField } from './reserved';
import { isReservedTopLevelField } from './reserved';

type SimpleValue = string | number | boolean | null;
export type ContextValue = SimpleValue | SimpleValue[];

export type ContextRecord = Record<string, ContextValue>;

export type ContextKey = Exclude<string, ReservedTopLevelField>;

export type Context = Partial<Record<ContextKey, ContextValue>>;

type MetadataValue = SimpleValue;
export type MetadataContext = Partial<Record<ContextKey, MetadataValue>>;

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

const flatten = (value: unknown): ContextValue | undefined => {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const flattened: SimpleValue[] = [];

    for (const item of value) {
      const result = flatten(item);
      if (result === undefined) {
        continue;
      }

      if (Array.isArray(result)) {
        flattened.push(...result);
      } else {
        flattened.push(result);
      }
    }

    return flattened;
  }

  if (typeof value === 'object') {
    const entries: SimpleValue[] = [];

    for (const item of Object.values(value)) {
      const result = flatten(item);
      if (result === undefined) {
        continue;
      }

      if (Array.isArray(result)) {
        entries.push(...result);
      } else {
        entries.push(result);
      }
    }

    return entries;
  }

  return undefined;
};

export const sanitizeContextInput = (
  context: Record<string, unknown>,
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

    const flattened = flatten(rawValue);

    if (flattened === undefined) {
      continue;
    }

    if (key in existingContext || key in sanitized) {
      collisions.push(key);
      const existingValue = (key in sanitized ? sanitized[key] : existingContext[key]) as
        | ContextValue
        | undefined;
      collisionDetails.push({ key, existingValue, attemptedValue: flattened });
      continue;
    }

    sanitized[key] = flattened;
  }

  return { context: sanitized, validation: { collisions, reserved, collisionDetails } };
};

export class ContextStore {
  private context: ContextRecord = {};
  private history: ContextValidationResult[] = [];
  private pendingCollisions = new Set<string>();
  private pendingCollisionDetails: ContextCollisionDetail[] = [];

  constructor(initial: Record<string, unknown> = {}) {
    const { context, validation } = sanitizeContextInput(initial);
    this.context = { ...context };
    this.history.push(validation);
    this.track(validation);
  }

  add(raw: Record<string, unknown>): ContextValidationResult {
    const { context, validation } = sanitizeContextInput(raw, this.context);
    Object.assign(this.context, context);
    this.history.push(validation);
    this.track(validation);
    return validation;
  }

  snapshot(): ContextRecord {
    return { ...this.context };
  }

  getValidationHistory(): ContextValidationResult[] {
    return [...this.history];
  }

  consumeCollisions(): string[] {
    const collisions = Array.from(this.pendingCollisions);
    this.pendingCollisions.clear();
    return collisions;
  }

  consumeCollisionDetails(): ContextCollisionDetail[] {
    const details = [...this.pendingCollisionDetails];
    this.pendingCollisionDetails = [];
    return details;
  }

  private track(validation: ContextValidationResult): void {
    validation.collisions.forEach((key) => this.pendingCollisions.add(key));
    this.pendingCollisionDetails.push(...validation.collisionDetails);
  }
}
