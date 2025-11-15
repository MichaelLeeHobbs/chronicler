import type { ReservedTopLevelField } from './reserved';
import { isReservedTopLevelField } from './reserved';

type SimpleValue = string | number | boolean | null;
export type ContextValue = SimpleValue | SimpleValue[];

export type ContextRecord = Record<string, ContextValue>;

export type ContextKey = Exclude<string, ReservedTopLevelField>;

export type Context = Partial<Record<ContextKey, ContextValue>>;

type MetadataValue = SimpleValue;
export type MetadataContext = Partial<Record<ContextKey, MetadataValue>>;

export interface ContextValidationResult {
  collisions: string[];
  reserved: string[];
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
      continue;
    }

    sanitized[key] = flattened;
  }

  return { context: sanitized, validation: { collisions, reserved } };
};

export class ContextStore {
  private context: ContextRecord = {};
  private history: ContextValidationResult[] = [];

  constructor(initial: Record<string, unknown> = {}) {
    const { context, validation } = sanitizeContextInput(initial);
    this.context = { ...context };
    this.history.push(validation);
  }

  add(raw: Record<string, unknown>): ContextValidationResult {
    const { context, validation } = sanitizeContextInput(raw, this.context);
    Object.assign(this.context, context);
    this.history.push(validation);
    return validation;
  }

  snapshot(): ContextRecord {
    return { ...this.context };
  }

  getValidationHistory(): ContextValidationResult[] {
    return [...this.history];
  }
}
