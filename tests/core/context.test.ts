import { describe, expect, it } from 'vitest';

import { ContextStore, type ContextValue, sanitizeContextInput } from '../../src/core/context';

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
    expect(next.validation.collisionDetails.map((d) => d.key)).toEqual(['foo', 'bar']);
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

describe('ContextStore.add', () => {
  it('keeps the first value on collision (first write wins)', () => {
    const store = new ContextStore({ a: '1' });
    const result = store.add({ a: '2', b: '3' });
    expect(store.snapshot()).toEqual({ a: '1', b: '3' });
    expect(result.collisionDetails).toEqual([
      { key: 'a', existingValue: '1', attemptedValue: '2' },
    ]);
  });

  it('silently drops reserved keys and reports them', () => {
    const store = new ContextStore();
    const result = store.add({ forkId: 'x', ok: true });
    expect(store.snapshot()).toEqual({ ok: true });
    expect(result.reserved).toEqual(['forkId']);
  });

  it('returns copies from snapshot()', () => {
    const store = new ContextStore({ a: '1' });
    const snap = store.snapshot();
    (snap as Record<string, ContextValue>).a = 'mutated';
    expect(store.snapshot()).toEqual({ a: '1' });
  });
});

describe('ContextStore.derive', () => {
  it('creates a child that inherits context without affecting the parent', () => {
    const parent = new ContextStore({ a: '1' });
    const { store: child } = parent.derive({ b: '2' });
    child.add({ c: '3' });
    expect(child.snapshot()).toEqual({ a: '1', b: '2', c: '3' });
    expect(parent.snapshot()).toEqual({ a: '1' });
  });

  it('lets overrides replace inherited values', () => {
    const parent = new ContextStore({ a: '1', b: '1' });
    const { store, validation } = parent.derive({ a: '2' });
    expect(store.snapshot()).toEqual({ a: '2', b: '1' });
    expect(validation.collisionDetails).toEqual([]);
  });

  it('keeps first-write-wins inside the child after deriving', () => {
    const { store } = new ContextStore({ a: '1' }).derive({ a: '2' });
    const result = store.add({ a: '3' });
    expect(store.snapshot()).toEqual({ a: '2' });
    expect(result.collisionDetails).toHaveLength(1);
  });

  it('reports reserved keys in overrides and drops them', () => {
    const { store, validation } = new ContextStore({ a: '1' }).derive({ eventKey: 'x' });
    expect(store.snapshot()).toEqual({ a: '1' });
    expect(validation.reserved).toEqual(['eventKey']);
  });

  it('applies maxKeys to the child', () => {
    const { store, validation } = new ContextStore({ a: '1' }, 2).derive({ b: '2', c: '3' });
    expect(Object.keys(store.snapshot())).toHaveLength(2);
    expect(validation.dropped).toEqual(['c']);
  });

  it('defaults to no overrides', () => {
    const { store } = new ContextStore({ a: '1' }).derive();
    expect(store.snapshot()).toEqual({ a: '1' });
  });
});
