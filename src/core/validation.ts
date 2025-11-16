import { stderr } from 'stderr-lib';

import type { ValidationMetadata } from './backend';
import type { EventDefinition } from './events';
import type { FieldDefinitions, InferFields } from './fields';

export interface FieldValidationResult {
  missingFields: string[];
  typeErrors: string[];
  normalizedFields: Record<string, unknown>;
}

const isSimpleTypeMatch = (value: unknown, type: string): boolean => {
  if (type === 'error') {
    return typeof value === 'object' || typeof value === 'string';
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

export const validateFields = <F extends FieldDefinitions>(
  event: EventDefinition<F>,
  payload: InferFields<F>,
): FieldValidationResult => {
  const providedFields = (payload ?? {}) as Record<string, unknown>;
  const normalizedFields: Record<string, unknown> = {};
  const missingFields: string[] = [];
  const typeErrors: string[] = [];

  const definitions = event.fields ?? ({} as FieldDefinitions);

  for (const [name, definition] of Object.entries(definitions)) {
    const value = providedFields[name];

    if (value === undefined || value === null) {
      if (definition.required) {
        missingFields.push(name);
      }
      continue;
    }

    if (!isSimpleTypeMatch(value, definition.type)) {
      typeErrors.push(name);
      continue;
    }

    normalizedFields[name] =
      definition.type === 'error'
        ? // eslint-disable-next-line @typescript-eslint/no-base-to-string
          stderr(value, { patchToString: true }).toString()
        : value;
  }

  return { missingFields, typeErrors, normalizedFields };
};

export const buildValidationMetadata = (
  fieldValidation: FieldValidationResult,
  contextCollisions: string[],
  overrides?: Partial<ValidationMetadata>,
): ValidationMetadata | undefined => {
  const metadata: ValidationMetadata = { ...(overrides ?? {}) };

  if (fieldValidation.missingFields.length > 0) {
    metadata.missingFields = [...fieldValidation.missingFields];
  }

  if (fieldValidation.typeErrors.length > 0) {
    metadata.typeErrors = [...fieldValidation.typeErrors];
  }

  if (contextCollisions.length > 0) {
    metadata.contextCollisions = [...contextCollisions];
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
};
