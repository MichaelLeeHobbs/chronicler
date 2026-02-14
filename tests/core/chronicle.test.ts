import { describe, expect, it, vi } from 'vitest';

import type { Chronicler } from '../../src/core/chronicle';
import { createChronicle } from '../../src/core/chronicle';
import { defineEvent } from '../../src/core/events';
import { t } from '../../src/core/fields';
import { MockLoggerBackend } from '../helpers/mock-logger';

const sampleEvent = defineEvent({
  key: 'system.startup',
  level: 'info',
  message: 'started',
  doc: 'doc',
  fields: {
    port: t.number().doc('port'),
  },
} as const);

const errorEvent = defineEvent({
  key: 'system.failure',
  level: 'error',
  message: 'boom',
  doc: 'error event',
  fields: {
    error: t.error().doc('err'),
  },
} as const);

describe('createChronicle', () => {
  it('works without a backend (uses default console backend)', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(vi.fn());
    const chronicle = createChronicle({ metadata: {} });

    chronicle.event(sampleEvent, { port: 3000 });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    infoSpy.mockRestore();
  });

  it('throws if backend missing levels', () => {
    const mock = new MockLoggerBackend();

    // @ts-expect-error -- deleting method for test
    delete mock.backend.error; // Remove error method

    expect(() => createChronicle({ backend: mock.backend, metadata: {} })).toThrow(
      'Log backend is missing level(s): error',
    );
  });

  it('throws when metadata uses reserved keys', () => {
    const mock = new MockLoggerBackend();

    expect(() => createChronicle({ backend: mock.backend, metadata: { eventKey: 'bad' } })).toThrow(
      'Reserved fields cannot be used in metadata: eventKey',
    );
  });

  it('logs events with metadata', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: { deploymentId: 'dep-1' },
    });

    chronicle.event(sampleEvent, { port: 3000 });

    const payload = mock.getLastPayload();
    expect(payload?.metadata).toMatchObject({ deploymentId: 'dep-1' });
    expect(payload?.fields).toEqual({ port: 3000 });
    expect(payload?.timestamp).toEqual(expect.any(String));
  });

  it('adds context incrementally', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

    chronicle.addContext({ userId: '123' });
    chronicle.addContext({ requestId: '456' });
    chronicle.event(sampleEvent, { port: 3000 });

    const payload = mock.getLastPayload();
    expect(payload?.metadata).toMatchObject({ userId: '123', requestId: '456' });
  });

  it('captures validation errors without throwing', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

    chronicle.event(sampleEvent, { port: undefined as never } as unknown as { port: number });

    const payload = mock.getLastPayload();
    expect(payload?._validation?.missingFields).toEqual(['port']);
    expect(payload?.fields).toEqual({});
  });

  it('serializes error fields using stderr', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

    const err = new Error('failure');
    chronicle.event(errorEvent, { error: err });

    const payload = mock.findByLevel('error');
    expect(typeof payload?.fields.error).toBe('string');
    expect(payload?.fields.error as string).toContain('failure');
  });

  it('returns collision info from addContext', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

    chronicle.addContext({ userId: '123' });
    const result = chronicle.addContext({ userId: '456' }); // Collision

    expect(result.collisions).toEqual(['userId']);
    expect(result.collisionDetails).toHaveLength(1);
    expect(result.collisionDetails[0]?.key).toBe('userId');
  });
});

const createChronicleInstance = (
  configOverrides: Partial<Parameters<typeof createChronicle>[0]> = {},
): Chronicler => {
  return createChronicle({
    backend: new MockLoggerBackend().backend,
    metadata: {},
    ...configOverrides,
  });
};

describe('context limits via config', () => {
  it('returns dropped keys when context keys exceed maxContextKeys', () => {
    const chronicle = createChronicle({
      backend: new MockLoggerBackend().backend,
      metadata: {},
      limits: { maxContextKeys: 2 },
    });

    const result = chronicle.addContext({ a: '1', b: '2', c: '3' });

    expect(result.dropped).toHaveLength(1);
  });
});

describe('sanitizeStrings option', () => {
  it('strips ANSI escapes and replaces newlines when enabled', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      sanitizeStrings: true,
    });

    const event = defineEvent({
      key: 'test.sanitize',
      level: 'info',
      message: 'test',
      doc: 'test',
      fields: { name: t.string() },
    } as const);

    chronicle.event(event, { name: '\x1b[31mred\x1b[0m\nline2' });

    const payload = mock.getLastPayload();
    expect(payload?.fields.name).toBe('red\\nline2');
  });

  it('does not sanitize when option is off (default)', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

    const event = defineEvent({
      key: 'test.nosanit',
      level: 'info',
      message: 'test',
      doc: 'test',
      fields: { name: t.string() },
    } as const);

    chronicle.event(event, { name: 'hello\nworld' });

    const payload = mock.getLastPayload();
    expect(payload?.fields.name).toBe('hello\nworld');
  });
});

describe('log() escape hatch', () => {
  it('logs without a pre-defined event', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: { app: 'test' } });

    chronicle.log('info', 'hello world', { foo: 'bar' });

    const payload = mock.getLastPayload();
    expect(payload?.eventKey).toBe('');
    expect(payload?.fields).toEqual({ foo: 'bar' });
    expect(payload?.metadata.app).toBe('test');
    expect(mock.findByLevel('info')).toBeDefined();
  });

  it('logs at different levels', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

    chronicle.log('error', 'something broke');
    chronicle.log('debug', 'checking state');

    expect(mock.findByLevel('error')).toBeDefined();
    expect(mock.findByLevel('debug')).toBeDefined();
  });

  it('defaults fields to empty object', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

    chronicle.log('warn', 'watch out');

    const payload = mock.getLastPayload();
    expect(payload?.fields).toEqual({});
  });
});

describe('createChronicleExtended', () => {
  it('verifies startCorrelation availability', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicleInstance({ backend: mock.backend, metadata: {} });

    expect(mock.backend.info).toBeDefined();
    expect(typeof chronicle.startCorrelation).toBe('function');
  });
});

describe('strict mode', () => {
  it('emits console.warn on missing required fields', () => {
    const mock = new MockLoggerBackend();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      strict: true,
    });

    chronicle.event(sampleEvent, {} as never);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing required fields: port'));
    warnSpy.mockRestore();
  });

  it('emits console.warn on type mismatches', () => {
    const mock = new MockLoggerBackend();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      strict: true,
    });

    chronicle.event(sampleEvent, { port: 'not-a-number' } as never);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('type errors'));
    warnSpy.mockRestore();
  });

  it('does not warn when strict is off (default)', () => {
    const mock = new MockLoggerBackend();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
    });

    chronicle.event(sampleEvent, {} as never);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('minLevel filtering', () => {
  it('drops events below minLevel', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      minLevel: 'warn',
    });

    const debugEvent = defineEvent({
      key: 'test.debug',
      level: 'debug',
      message: 'debug msg',
      doc: 'test',
      fields: {},
    } as const);

    chronicle.event(debugEvent, {});

    expect(mock.getPayloads()).toHaveLength(0);
  });

  it('allows events at or above minLevel', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      minLevel: 'warn',
    });

    chronicle.event(errorEvent, { error: 'fail' });

    expect(mock.getPayloads()).toHaveLength(1);
  });

  it('filters log() calls below minLevel', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      minLevel: 'error',
    });

    chronicle.log('info', 'this should be dropped');
    chronicle.log('error', 'this should pass');

    expect(mock.getPayloads()).toHaveLength(1);
    expect(mock.findByLevel('error')).toBeDefined();
  });

  it('defaults to trace (all events pass)', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
    });

    chronicle.log('trace', 'most verbose');
    chronicle.log('debug', 'verbose');

    expect(mock.getPayloads()).toHaveLength(2);
  });
});
