import { describe, expect, it } from 'vitest';

import { event } from '../../src/core/events';
import { field } from '../../src/core/fields';
import {
  buildValidationMetadata,
  sanitizeLogFields,
  validateFields,
} from '../../src/core/validation';

describe('validateFields', () => {
  const def = event({
    level: 'info',
    message: 'msg',
    doc: 'doc',
    fields: {
      requiredString: field.string().doc('req'),
      optionalNumber: field.number().optional().doc('opt'),
      errorField: field.error().optional().doc('err'),
      flag: field.boolean().optional(),
    },
  });

  it('accepts valid fields with no issues', () => {
    const result = validateFields(def, { requiredString: 'ok', optionalNumber: 1, flag: false });
    expect(result).toMatchObject({
      missingFields: [],
      typeErrors: [],
      invalidValues: [],
      unknownFields: [],
    });
    expect(result.normalizedFields).toEqual({
      requiredString: 'ok',
      optionalNumber: 1,
      flag: false,
    });
  });

  it('captures missing required fields', () => {
    const result = validateFields(def, { optionalNumber: 5 });

    expect(result.missingFields).toEqual(['requiredString']);
    expect(result.typeErrors).toEqual([]);
  });

  it('treats null and undefined as missing', () => {
    expect(validateFields(def, { requiredString: null }).missingFields).toEqual(['requiredString']);
    expect(validateFields(def, undefined).missingFields).toEqual(['requiredString']);
  });

  it('captures type errors', () => {
    const result = validateFields(def, { requiredString: 'ok', optionalNumber: 'bad', flag: 1 });

    expect(result.typeErrors).toEqual(['optionalNumber', 'flag']);
    expect(result.normalizedFields).toEqual({ requiredString: 'ok' });
  });

  it('flags non-finite numbers as invalid values', () => {
    const nan = validateFields(def, { requiredString: 'ok', optionalNumber: Number.NaN });
    const inf = validateFields(def, { requiredString: 'ok', optionalNumber: Infinity });
    expect(nan.invalidValues).toEqual(['optionalNumber']);
    expect(inf.invalidValues).toEqual(['optionalNumber']);
    expect(nan.normalizedFields).not.toHaveProperty('optionalNumber');
  });

  it('normalizes error fields to their stack', () => {
    const result = validateFields(def, { requiredString: 'ok', errorField: new Error('boom') });

    expect(typeof result.normalizedFields.errorField).toBe('string');
    expect(result.normalizedFields.errorField).toContain('boom');
  });

  it('falls back to the message for errors without a stack', () => {
    const err = new Error('no stack');
    delete err.stack;
    const result = validateFields(def, { requiredString: 'ok', errorField: err });
    expect(result.normalizedFields.errorField).toBe('no stack');
  });

  it('preserves string error inputs as-is', () => {
    const result = validateFields(def, { requiredString: 'ok', errorField: 'textual failure' });

    expect(result.normalizedFields.errorField).toBe('textual failure');
  });

  it('rejects non-Error objects as type errors for error fields', () => {
    const result = validateFields(def, {
      requiredString: 'ok',
      errorField: { message: 'not an error' },
    });

    expect(result.typeErrors).toEqual(['errorField']);
    expect(result.normalizedFields.errorField).toBeUndefined();
  });

  it('reports unknown fields, passes serializable ones through and drops functions/symbols', () => {
    const result = validateFields(def, {
      requiredString: 'ok',
      extra: 'x\ny',
      count: 2,
      fn: () => 1,
      sym: Symbol('s'),
      nothing: undefined,
    });
    expect(result.unknownFields).toEqual(['extra', 'count', 'fn', 'sym']);
    expect(result.normalizedFields).toEqual({ requiredString: 'ok', extra: 'x\\ny', count: 2 });
  });

  it('sanitizes ANSI escapes and newlines in string fields', () => {
    const result = validateFields(def, { requiredString: '\x1b[31mred\x1b[0m\r\nline2' });
    expect(result.normalizedFields.requiredString).toBe('red\\n\\nline2');
  });
});

describe('buildValidationMetadata', () => {
  const empty = {
    missingFields: [],
    typeErrors: [],
    invalidValues: [],
    unknownFields: [],
    truncatedFields: [],
    normalizedFields: {},
  };

  it('returns undefined when there are no issues', () => {
    expect(buildValidationMetadata(empty)).toBeUndefined();
  });

  it('includes only non-empty arrays', () => {
    expect(
      buildValidationMetadata({ ...empty, missingFields: ['a'], unknownFields: ['b'] }),
    ).toEqual({ missingFields: ['a'], unknownFields: ['b'] });
  });
});

describe('sanitizeLogFields', () => {
  it('sanitizes strings and leaves other values untouched', () => {
    const obj = { nested: true };
    expect(sanitizeLogFields({ s: 'a\nb\x1b[1m', n: 1, o: obj })).toEqual({
      s: 'a\\nb',
      n: 1,
      o: obj,
    });
  });
});
