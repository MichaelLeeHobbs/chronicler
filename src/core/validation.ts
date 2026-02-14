import { stderr } from 'stderr-lib';

import type { ValidationMetadata } from './backend';
import type { EventDefinition, EventFields } from './events';
import type { FieldBuilder } from './fields';

export interface FieldValidationResult {
  readonly missingFields: string[];
  readonly typeErrors: string[];
  readonly unknownFields: string[];
  readonly normalizedFields: Record<string, unknown>;
}

const ANSI_ESCAPE_RE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const NEWLINE_RE = /[\r\n]/g;

/**
 * Sanitize a string value to prevent log injection.
 * Strips ANSI escape sequences and replaces newlines with a visible placeholder.
 */
const sanitizeString = (value: string): string =>
  value.replace(ANSI_ESCAPE_RE, '').replace(NEWLINE_RE, '\\n');

/**
 * Sanitize string values in an untyped fields record.
 * Used by the `log()` escape hatch to apply the same sanitization as typed events.
 */
export const sanitizeLogFields = (fields: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = typeof value === 'string' ? sanitizeString(value) : value;
  }
  return result;
};

const isSimpleTypeMatch = (value: unknown, type: string): boolean => {
  switch (type) {
    case 'error':
      return value instanceof Error || typeof value === 'string';
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      // Unknown field type — always fail validation so new types
      // surface as type errors until this switch is updated.
      return false;
  }
};

/**
 * Validate event fields against their definitions and normalize values.
 *
 * @param event - Event definition containing field schemas to validate against
 * @param payload - User-provided field values to validate
 * @param options - Validation options (e.g. whether to sanitize string values)
 * @returns Validation result with missing fields, type errors, unknown fields, and normalized values
 */
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
  const unknownFields: string[] = [];

  const fieldBuilders = event.fields ?? ({} as Record<string, FieldBuilder<string, boolean>>);
  const definedFieldNames = new Set(Object.keys(fieldBuilders));

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

  // Pass through extra fields not in the event definition
  for (const [name, value] of Object.entries(providedFields)) {
    if (!definedFieldNames.has(name) && value !== undefined && value !== null) {
      unknownFields.push(name);
      if (options.sanitizeStrings && typeof value === 'string') {
        normalizedFields[name] = sanitizeString(value);
      } else {
        normalizedFields[name] = value;
      }
    }
  }

  return { missingFields, typeErrors, unknownFields, normalizedFields };
};

/**
 * Build validation metadata from field validation results, omitting empty arrays.
 *
 * @param fieldValidation - Result from {@link validateFields} containing validation issues
 * @param overrides - Additional metadata entries to merge into the result
 * @returns Validation metadata object, or undefined if there are no issues or overrides
 */
export const buildValidationMetadata = (
  fieldValidation: FieldValidationResult,
  overrides?: Partial<ValidationMetadata>,
): ValidationMetadata | undefined => {
  const metadata: ValidationMetadata = {
    ...(overrides ?? {}),
    ...(fieldValidation.missingFields.length > 0
      ? { missingFields: [...fieldValidation.missingFields] }
      : {}),
    ...(fieldValidation.typeErrors.length > 0
      ? { typeErrors: [...fieldValidation.typeErrors] }
      : {}),
    ...(fieldValidation.unknownFields.length > 0
      ? { unknownFields: [...fieldValidation.unknownFields] }
      : {}),
  };

  return Object.keys(metadata).length > 0 ? metadata : undefined;
};
