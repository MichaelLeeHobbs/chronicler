import { describe, expect, it } from 'vitest';

import type { FieldDefinition } from '../../src/core/fields';
import { InferFields, InferFieldType } from '../../src/core/fields';

describe('Field inference primitives', () => {
  it('infers scalar field types', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const stringField: FieldDefinition<'string'> = {
      type: 'string',
      required: true,
      doc: 'string field',
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const numberField: FieldDefinition<'number'> = {
      type: 'number',
      required: true,
      doc: 'number field',
    };

    type StringType = InferFieldType<typeof stringField>;
    type NumberType = InferFieldType<typeof numberField>;

    const stringValue: StringType = 'hello';
    const numberValue: NumberType = 42;

    expect(typeof stringValue).toBe('string');
    expect(typeof numberValue).toBe('number');
  });

  it('infers optional vs required fields', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const fields = {
      id: { type: 'string', required: true, doc: 'identifier' },
      count: { type: 'number', required: false, doc: 'count' },
      active: { type: 'boolean', required: true, doc: 'active flag' },
      error: { type: 'error', required: false, doc: 'error payload' },
    } as const;

    type Result = InferFields<typeof fields>;

    const valid: Result = {
      id: 'abc',
      active: true,
    };

    const withOptionals: Result = {
      id: 'abc',
      active: false,
      count: 10,
      error: new Error('boom'),
    };

    expect(valid.id).toBe('abc');
    expect(withOptionals.count).toBe(10);
  });
});
