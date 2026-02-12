import { describe, expect, it } from 'vitest';

import type { InferFields, InferFieldType } from '../../src/core/fields';
import { t } from '../../src/core/fields';

describe('Field inference primitives', () => {
  it('infers scalar field types', () => {
    const stringField = t.string();
    const numberField = t.number();

    type StringType = InferFieldType<typeof stringField>;
    type NumberType = InferFieldType<typeof numberField>;

    const stringValue: StringType = 'hello';
    const numberValue: NumberType = 42;

    expect(stringField._type).toBe('string');
    expect(stringField._required).toBe(true);
    expect(numberField._type).toBe('number');
    expect(numberField._required).toBe(true);
    expect(stringValue).toBe('hello');
    expect(numberValue).toBe(42);
  });

  it('infers optional vs required fields', () => {
    const fields = {
      id: t.string().doc('identifier'),
      count: t.number().optional().doc('count'),
      active: t.boolean().doc('active flag'),
      error: t.error().optional().doc('error payload'),
    };

    // Verify builder metadata at runtime
    expect(fields.id._type).toBe('string');
    expect(fields.id._required).toBe(true);
    expect(fields.count._type).toBe('number');
    expect(fields.count._required).toBe(false);
    expect(fields.active._type).toBe('boolean');
    expect(fields.error._type).toBe('error');

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
