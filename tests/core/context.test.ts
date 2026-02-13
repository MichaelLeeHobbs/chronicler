import { describe, expect, it } from 'vitest';

import { type ContextValue, sanitizeContextInput } from '../../src/core/ContextStore';

describe('context sanitizer', () => {
  it('strips reserved keys', () => {
    const result = sanitizeContextInput({ eventKey: 'bad', custom: 'ok' });

    expect(result.context).toEqual({ custom: 'ok' });
    expect(result.validation.reserved).toEqual(['eventKey']);
  });

  it('tracks collisions', () => {
    const first = sanitizeContextInput({ foo: 'a', bar: 'b' });
    const next = sanitizeContextInput({ ...first.context, foo: 'override' }, first.context);

    expect(first.context.foo).toBe('a');
    expect(next.validation.collisions).toEqual(['foo', 'bar']);
  });

  it('drops unsupported values (arrays)', () => {
    const result = sanitizeContextInput({
      skipped: [] as unknown as ContextValue,
      kept: true,
    });
    expect(result.context).toEqual({ kept: true });
  });

  it('drops unsupported values (objects)', () => {
    const result = sanitizeContextInput({
      skipped: { nested: 'object' } as unknown as ContextValue,
      kept: 'yes',
    });
    expect(result.context).toEqual({ kept: 'yes' });
  });
});
