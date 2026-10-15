import { describe, expect, expectTypeOf, it } from 'vitest';

import { createChronicle } from '../../src/core/chronicle';
import { defineEvents, event } from '../../src/core/events';
import { field, type InferFields } from '../../src/core/fields';
import { validateFields } from '../../src/core/validation';
import { MockLoggerBackend } from '../helpers/mock-logger';

const def = event({
  level: 'info',
  message: 'login',
  fields: {
    outcome: field.enum(['success', 'failure', 'locked']),
    roles: field.array(field.string()).optional(),
    scores: field.array(field.number()).optional(),
    states: field.array(field.enum(['a', 'b'])).optional(),
  },
});

describe('field.enum', () => {
  it('infers the union of its values', () => {
    expectTypeOf<InferFields<typeof def.fields>['outcome']>().toEqualTypeOf<
      'success' | 'failure' | 'locked'
    >();
    // @ts-expect-error -- not one of the values
    const bad: InferFields<typeof def.fields>['outcome'] = 'other';
    expect(bad).toBe('other');
  });

  it('records its values on the builder', () => {
    expect(def.fields.outcome).toMatchObject({
      _type: 'enum',
      _values: ['success', 'failure', 'locked'],
    });
  });

  it('flags values outside the list as invalid and non-strings as type errors', () => {
    expect(validateFields(def, { outcome: 'success' }).invalidValues).toEqual([]);
    expect(validateFields(def, { outcome: 'other' }).invalidValues).toEqual(['outcome']);
    expect(validateFields(def, { outcome: 1 }).typeErrors).toEqual(['outcome']);
  });
});

describe('field.array', () => {
  it('infers readonly arrays of the item type', () => {
    type Fields = InferFields<typeof def.fields>;
    expectTypeOf<Fields['roles']>().toEqualTypeOf<readonly string[] | undefined>();
    expectTypeOf<Fields['states']>().toEqualTypeOf<readonly ('a' | 'b')[] | undefined>();
  });

  it('only takes primitive and enum item builders', () => {
    // @ts-expect-error -- no arrays of arrays
    field.array(field.array(field.string()));
    // @ts-expect-error -- no arrays of errors
    field.array(field.error());
  });

  it('checks every item', () => {
    expect(validateFields(def, { outcome: 'success', roles: ['a', 'b'] }).typeErrors).toEqual([]);
    expect(validateFields(def, { outcome: 'success', roles: ['a', 1] }).typeErrors).toEqual([
      'roles',
    ]);
    expect(validateFields(def, { outcome: 'success', roles: 'a' }).typeErrors).toEqual(['roles']);
    expect(
      validateFields(def, { outcome: 'success', scores: [1, Infinity] }).invalidValues,
    ).toEqual(['scores']);
    expect(validateFields(def, { outcome: 'success', states: ['a', 'c'] }).invalidValues).toEqual([
      'states',
    ]);
  });

  it('sanitizes string items and copies the array', () => {
    const roles = ['a\nb'];
    const result = validateFields(def, { outcome: 'success', roles });
    expect(result.normalizedFields.roles).toEqual(['a\\nb']);
    expect(result.normalizedFields.roles).not.toBe(roles);
  });

  it('truncates past the limit', () => {
    const result = validateFields(def, { outcome: 'success', scores: [1, 2, 3] }, 2);
    expect(result.normalizedFields.scores).toEqual([1, 2]);
    expect(result.truncatedFields).toEqual(['scores']);
  });

  it('applies limits.maxArrayLength (default 100) in a chronicle', () => {
    const mock = new MockLoggerBackend();
    const events = defineEvents({ login: def });
    const chronicle = createChronicle({ events, backend: mock.backend });
    chronicle.login({ outcome: 'success', scores: Array.from({ length: 101 }, (_, i) => i) });
    expect(mock.getLastPayload()?.fields.scores).toHaveLength(100);
    expect(mock.getLastPayload()?._validation).toEqual({ truncatedFields: ['scores'] });

    const small = createChronicle({ events, backend: mock.backend, limits: { maxArrayLength: 1 } });
    small.login({ outcome: 'success', roles: ['a', 'b'] });
    expect(mock.getLastPayload()?.fields.roles).toEqual(['a']);
  });
});
