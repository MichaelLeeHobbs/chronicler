import { describe, expect, it } from 'vitest';

import { sanitizeContextInput } from '../../src/core/context';

describe('context sanitizer', () => {
  it('strips reserved keys', () => {
    const result = sanitizeContextInput({ eventKey: 'bad', custom: 'ok' });

    expect(result.context).toEqual({ custom: 'ok' });
    expect(result.validation.reserved).toEqual(['eventKey']);
  });

  // it('flattens nested structures', () => {
  //   const result = sanitizeContextInput({ nested: { foo: 'bar', inner: { baz: 2 } } });
  //
  //   expect(result.context).toEqual({ nested: ['bar', 2] });
  // });

  it('tracks collisions', () => {
    const first = sanitizeContextInput({ foo: 'a', bar: 'b' });
    const next = sanitizeContextInput({ ...first.context, foo: 'override' }, first.context);

    expect(first.context.foo).toBe('a');
    expect(next.validation.collisions).toEqual(['foo', 'bar']);
  });

  it('drops unsupported values', () => {
    const result = sanitizeContextInput({ skipped: [], kept: true });
    expect(result.context).toEqual({ kept: true });
  });
});
