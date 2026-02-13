import { describe, expect, it } from 'vitest';

import { ContextStore, type ContextValue, sanitizeContextInput } from '../../src/core/ContextStore';

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

  it('blocks __proto__ as dangerous key', () => {
    // Use JSON.parse to create an object with __proto__ as an own enumerable property,
    // since object literals set the prototype instead
    const input = JSON.parse('{"__proto__":"evil","safe":"ok"}') as Record<string, ContextValue>;
    const result = sanitizeContextInput(input);
    expect(result.context).toEqual({ safe: 'ok' });
    expect(result.validation.reserved).toContain('__proto__');
  });

  it('blocks constructor as dangerous key', () => {
    const result = sanitizeContextInput({ constructor: 'evil' } as Record<string, ContextValue>);
    expect(result.context).toEqual({});
    expect(result.validation.reserved).toContain('constructor');
  });

  it('blocks prototype as dangerous key', () => {
    const result = sanitizeContextInput({ prototype: 'evil' } as Record<string, ContextValue>);
    expect(result.context).toEqual({});
    expect(result.validation.reserved).toContain('prototype');
  });

  it('returns empty dropped array when within limits', () => {
    const result = sanitizeContextInput({ a: '1', b: '2' });
    expect(result.validation.dropped).toEqual([]);
  });

  it('drops keys exceeding maxNewKeys limit', () => {
    const result = sanitizeContextInput({ a: '1', b: '2', c: '3' }, {}, 2);
    expect(Object.keys(result.context)).toHaveLength(2);
    expect(result.validation.dropped).toHaveLength(1);
  });
});

describe('ContextStore with maxKeys', () => {
  it('enforces maxKeys on initial construction', () => {
    const store = new ContextStore({ a: '1', b: '2', c: '3' }, 2);
    const snap = store.snapshot();
    expect(Object.keys(snap)).toHaveLength(2);
  });

  it('enforces maxKeys on add() when store is already at capacity', () => {
    const store = new ContextStore({ a: '1', b: '2' }, 2);
    const result = store.add({ c: '3' });
    expect(result.dropped).toEqual(['c']);
    expect(store.snapshot()).toEqual({ a: '1', b: '2' });
  });

  it('allows partial adds when some capacity remains', () => {
    const store = new ContextStore({ a: '1' }, 2);
    const result = store.add({ b: '2', c: '3' });
    expect(Object.keys(store.snapshot())).toHaveLength(2);
    expect(result.dropped).toHaveLength(1);
  });

  it('allows unlimited keys when maxKeys is Infinity', () => {
    const store = new ContextStore({});
    for (let i = 0; i < 200; i++) {
      store.add({ [`key${i}`]: `value${i}` });
    }
    expect(Object.keys(store.snapshot())).toHaveLength(200);
  });
});
