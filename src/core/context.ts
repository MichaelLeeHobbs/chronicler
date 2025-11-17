import { isReservedTopLevelField } from './reserved';

type SimpleValue = string | number | boolean | null;
export type ContextValue = SimpleValue | SimpleValue[];

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

const isSimpleValue = (value: unknown): value is SimpleValue => {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
};

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

    // TODO: We should likely warn/log about complex types being skipped or support them properly
    // Invalid type - skip this key - runtime type checking only for simple values
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

export class ContextStore {
  private readonly context: ContextRecord = {};

  constructor(initial: ContextRecord = {}) {
    const { context } = sanitizeContextInput(initial);
    this.context = { ...context };
  }

  add(raw: ContextRecord): ContextValidationResult {
    const { context, validation } = sanitizeContextInput(raw, this.context);
    Object.assign(this.context, context);
    return validation;
  }

  snapshot(): ContextRecord {
    return { ...this.context };
  }
}
