import { stderr } from 'stderr-lib';

import type { ValidationMetadata } from './backend';
import type { EventDefinition, EventFields } from './events';
import type { FieldBuilder } from './fields';

export interface FieldValidationResult {
  missingFields: string[];
  typeErrors: string[];
  normalizedFields: Record<string, unknown>;
}

const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g;
const NEWLINE_RE = /[\r\n]/g;

/**
 * Sanitize a string value to prevent log injection.
 * Strips ANSI escape sequences and replaces newlines with a visible placeholder.
 */
export const sanitizeString = (value: string): string =>
  value.replace(ANSI_ESCAPE_RE, '').replace(NEWLINE_RE, '\\n');

const isSimpleTypeMatch = (value: unknown, type: string): boolean => {
  if (type === 'error') {
    return value instanceof Error || typeof value === 'string';
  }
  if (type === 'string') {
    return typeof value === 'string';
  }
  if (type === 'number') {
    return typeof value === 'number';
  }
  if (type === 'boolean') {
    return typeof value === 'boolean';
  }
  return false;
};

export const validateFields = <
  E extends EventDefinition<string, Record<string, FieldBuilder<string, boolean>>>,
>(
  event: E,
  payload: EventFields<E>,
  options: { sanitizeStrings?: boolean } = {},
): FieldValidationResult => {
  const providedFields = (payload ?? {}) as Record<string, unknown>;
  const normalizedFields: Record<string, unknown> = {};
  const missingFields: string[] = [];
  const typeErrors: string[] = [];

  const fieldBuilders = event.fields ?? ({} as Record<string, FieldBuilder<string, boolean>>);

  for (const [name, builder] of Object.entries(fieldBuilders)) {
    const value = providedFields[name];

    // Extract metadata from builder (runtime info)
    const fieldType = builder._type;
    const isRequired = builder._required;

    if (value === undefined || value === null) {
      if (isRequired) {
        missingFields.push(name);
      }
      continue;
    }

    if (!isSimpleTypeMatch(value, fieldType)) {
      typeErrors.push(name);
      continue;
    }

    if (fieldType === 'error') {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      normalizedFields[name] = stderr(value, { patchToString: true }).toString();
    } else if (options.sanitizeStrings && fieldType === 'string' && typeof value === 'string') {
      normalizedFields[name] = sanitizeString(value);
    } else {
      normalizedFields[name] = value;
    }
  }

  return { missingFields, typeErrors, normalizedFields };
};

export const buildValidationMetadata = (
  fieldValidation: FieldValidationResult,
  overrides?: Partial<ValidationMetadata>,
): ValidationMetadata | undefined => {
  const metadata: ValidationMetadata = { ...(overrides ?? {}) };

  if (fieldValidation.missingFields.length > 0) {
    metadata.missingFields = [...fieldValidation.missingFields];
  }

  if (fieldValidation.typeErrors.length > 0) {
    metadata.typeErrors = [...fieldValidation.typeErrors];
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
};
