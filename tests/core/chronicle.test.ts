import { describe, expect, it, vi } from 'vitest';

import type { LogBackend } from '../../src/core/backend';
import { createChronicle } from '../../src/core/chronicle';
import { ChroniclerError } from '../../src/core/errors';
import { defineEvents, event, span } from '../../src/core/events';
import { field } from '../../src/core/fields';
import { events, setup } from '../helpers/fixtures';
import { MockLoggerBackend } from '../helpers/mock-logger';

describe('createChronicle', () => {
  it('works without a backend (uses default console backend)', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(vi.fn());
    const chronicle = createChronicle({ events });

    chronicle.system.startup({ port: 3000 });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    infoSpy.mockRestore();
  });

  it('throws if backend misses levels', () => {
    const mock = new MockLoggerBackend();
    const backend: Partial<LogBackend> = { ...mock.backend };
    delete backend.error;

    expect(() => createChronicle({ events, backend: backend as LogBackend })).toThrow(
      'Log backend is missing level(s): error',
    );
  });

  it('throws when metadata uses reserved keys', () => {
    const mock = new MockLoggerBackend();
    for (const key of ['eventKey', 'traceId', 'spanState']) {
      expect(() =>
        createChronicle({ events, backend: mock.backend, metadata: { [key]: 'bad' } }),
      ).toThrow(`Reserved fields cannot be used in metadata: ${key}`);
    }
  });

  it('throws INVALID_CATALOG for a malformed catalog', () => {
    const create = createChronicle as (config: { events: object }) => unknown;
    expect(() => create({ events: { fork: event({ level: 'info', message: 'x' }) } })).toThrow(
      expect.objectContaining({ code: 'INVALID_CATALOG' }) as Error,
    );
  });

  it('accepts a plain catalog object that was not passed through defineEvents', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      events: { a: { b: event({ level: 'info', message: 'x' }) } },
      backend: mock.backend,
    });
    chronicle.a.b();
    expect(mock.getKeys()).toEqual(['a.b']);
    expect(chronicle.a.b.key).toBe('a.b');
  });

  it('logs events with metadata, fields, level and message', () => {
    const { mock, chronicle } = setup({ metadata: { deploymentId: 'dep-1' } });

    chronicle.system.startup({ port: 3000 });

    const [entry] = mock.getEntries();
    expect(entry?.level).toBe('info');
    expect(entry?.message).toBe('started');
    expect(entry?.payload.metadata).toEqual({ deploymentId: 'dep-1' });
    expect(entry?.payload.fields).toEqual({ port: 3000 });
    expect(entry?.payload.timestamp).toEqual(expect.any(String));
    expect(new Date(entry!.payload.timestamp).toISOString()).toBe(entry?.payload.timestamp);
  });
});

describe('emitter tree', () => {
  it('mirrors the catalog: events are functions, spans are starters', () => {
    const { chronicle } = setup();
    expect(typeof chronicle.admin.login).toBe('function');
    expect(typeof chronicle.http.request.begin).toBe('function');
    expect(typeof chronicle.http.request.run).toBe('function');
    expect(typeof chronicle.fork).toBe('function');
    expect(typeof chronicle.run).toBe('function');
    expect(typeof chronicle.log).toBe('function');
    expect(typeof chronicle.addContext).toBe('function');
    expect(Object.keys(chronicle)).toEqual(
      expect.arrayContaining([
        'system',
        'admin',
        'http',
        'job',
        'fork',
        'run',
        'log',
        'addContext',
      ]),
    );
  });

  it('is not thenable, so it can be returned from async functions', async () => {
    const { chronicle } = setup();
    expect('then' in chronicle).toBe(false);
    const resolved = await Promise.resolve(chronicle);
    expect(resolved).toBe(chronicle);
  });

  it('exposes .key on emitters, starters and definitions', () => {
    const { chronicle } = setup();
    expect(chronicle.admin.login.key).toBe('admin.login');
    expect(chronicle.http.request.key).toBe('http.request');
    expect(events.admin.login.key).toBe('admin.login');
    expect(events.http.request.key).toBe('http.request');
    expect(events.http.request.events.received.key).toBe('http.request.received');
  });

  it('uses key overrides on the wire', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      events: {
        auth: {
          login: event({ level: 'info', message: 'x', key: 'legacy.login' }),
          flow: span({
            key: 'legacy.flow',
            events: { step: event({ level: 'info', message: 's' }) },
          }),
        },
      },
      backend: mock.backend,
    });
    chronicle.auth.login();
    const flow = chronicle.auth.flow.begin();
    flow.step();
    expect(chronicle.auth.login.key).toBe('legacy.login');
    expect(chronicle.auth.flow.key).toBe('legacy.flow');
    expect(mock.getKeys()).toEqual(['legacy.login', 'legacy.flow.start', 'legacy.flow.step']);
  });

  it('supports both call styles: chronicle.admin.login and destructured admin.login', () => {
    const { mock, chronicle } = setup();
    const { admin } = chronicle;
    const { login } = chronicle.admin;

    chronicle.admin.login({ userId: 'a', success: true });
    admin.login({ userId: 'b', success: true });
    login({ userId: 'c', success: false });

    expect(mock.getPayloads().map((p) => p.fields.userId)).toEqual(['a', 'b', 'c']);
    expect(mock.getKeys()).toEqual(['admin.login', 'admin.login', 'admin.login']);
  });

  it('calls events without required fields with no arguments', () => {
    const { mock, chronicle } = setup();
    chronicle.admin.heartbeat();
    chronicle.admin.note();
    chronicle.admin.note({ text: 'hi' });
    expect(mock.getPayloads().map((p) => p.fields)).toEqual([{}, {}, { text: 'hi' }]);
    expect(mock.getPayloads().every((p) => p._validation === undefined)).toBe(true);
  });

  it('binds namespaces lazily and keeps them working after destructuring', () => {
    const { mock, chronicle } = setup();
    const descriptor = Object.getOwnPropertyDescriptor(chronicle, 'admin');
    expect(descriptor).toHaveProperty('get', expect.any(Function));

    const { admin, http } = chronicle;
    const { heartbeat } = admin;
    heartbeat();
    const req = http.request.begin();
    req.phase.parsed();

    // after first access the namespace is cached as a plain value
    expect(Object.getOwnPropertyDescriptor(chronicle, 'admin')?.value).toBe(admin);
    expect(chronicle.admin).toBe(admin);
    expect(mock.getKeys()).toEqual([
      'admin.heartbeat',
      'http.request.start',
      'http.request.phase.parsed',
    ]);
  });

  it('gives each chronicle independent emitters', () => {
    const a = setup();
    const b = setup();
    a.chronicle.admin.heartbeat();
    expect(a.mock.getKeys()).toEqual(['admin.heartbeat']);
    expect(b.mock.getKeys()).toEqual([]);
  });
});

describe('payload shape', () => {
  it('has exactly the base fields outside a span', () => {
    const { mock, chronicle } = setup({ metadata: { svc: 'api' } });
    chronicle.admin.heartbeat();
    const payload = mock.getLastPayload()!;
    expect(Object.keys(payload).sort()).toEqual(
      ['eventKey', 'fields', 'forkId', 'metadata', 'timestamp'].sort(),
    );
    expect(payload).toMatchObject({
      eventKey: 'admin.heartbeat',
      forkId: '0',
      fields: {},
      metadata: { svc: 'api' },
    });
  });

  it('adds traceId (but not parent or state) in an active top-level span', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    req.ping();
    const payload = mock.getLastPayload()!;
    expect(payload.spanId).toBe('c1');
    expect(payload.traceId).toBe('t1');
    expect(payload).not.toHaveProperty('parentSpanId');
    expect(payload).not.toHaveProperty('spanState');
    expect(payload).not.toHaveProperty('_validation');
    req.complete();
  });

  it('adds parentSpanId only for nested spans', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.run((req) => {
      chronicle.job.batch.run((batch) => {
        batch.step({ n: 1 });
        batch.complete();
      });
      req.complete();
    });
    const step = mock.findByKey('job.batch.step')!;
    expect(step).toMatchObject({
      spanId: 'c2',
      parentSpanId: 'c1',
      traceId: 't1',
    });
  });

  it('adds spanState only once a span is no longer active', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    req.complete();
    req.ping();
    expect(mock.findByKey('http.request.complete')).not.toHaveProperty('spanState');
    expect(mock.findByKey('http.request.ping')?.spanState).toBe('completed');
  });

  it('adds _validation only when there is something to report', () => {
    const { mock, chronicle } = setup();
    chronicle.system.startup({ port: 1 });
    chronicle.system.startup({} as never);
    const [ok, bad] = mock.getPayloads();
    expect(ok).not.toHaveProperty('_validation');
    expect(bad?._validation).toEqual({ missingFields: ['port'] });
  });
});

describe('lazy backend', () => {
  it('resolves a backend function once, on the first event', () => {
    const mock = new MockLoggerBackend();
    const factory = vi.fn(() => mock.backend);
    const chronicle = createChronicle({ events, backend: factory });

    expect(factory).not.toHaveBeenCalled();
    chronicle.admin.heartbeat();
    expect(factory).toHaveBeenCalledTimes(1);
    chronicle.admin.heartbeat();
    chronicle.log('info', 'x');
    chronicle.fork().admin.heartbeat();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(mock.getPayloads()).toHaveLength(4);
  });

  it('does not resolve the backend for events dropped by minLevel', () => {
    const factory = vi.fn(() => new MockLoggerBackend().backend);
    const chronicle = createChronicle({ events, backend: factory, minLevel: 'error' });
    chronicle.admin.heartbeat();
    expect(factory).not.toHaveBeenCalled();
  });

  it('validates the lazily created backend on first use', () => {
    const chronicle = createChronicle({ events, backend: () => ({}) as LogBackend });
    expect(() => chronicle.admin.heartbeat()).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_LOG_LEVEL' }) as Error,
    );
  });
});

describe('addContext', () => {
  it('adds context incrementally', () => {
    const { mock, chronicle } = setup();

    chronicle.addContext({ userId: '123' });
    chronicle.addContext({ requestId: '456' });
    chronicle.system.startup({ port: 3000 });

    expect(mock.getLastPayload()?.metadata).toEqual({ userId: '123', requestId: '456' });
  });

  it('returns collision info and keeps the first value', () => {
    const { mock, chronicle } = setup();

    chronicle.addContext({ userId: '123' });
    const result = chronicle.addContext({ userId: '456' });
    chronicle.admin.heartbeat();

    expect(result.collisionDetails).toEqual([
      { key: 'userId', existingValue: '123', attemptedValue: '456' },
    ]);
    expect(mock.getLastPayload()?.metadata.userId).toBe('123');
  });

  it('collides with config metadata', () => {
    const { chronicle } = setup({ metadata: { env: 'prod' } });
    expect(chronicle.addContext({ env: 'dev' }).collisionDetails).toHaveLength(1);
  });

  it('silently drops reserved keys', () => {
    const { mock, chronicle } = setup();
    const result = chronicle.addContext({ forkId: 'x', ok: 1 });
    chronicle.admin.heartbeat();
    expect(result.reserved).toEqual(['forkId']);
    expect(mock.getLastPayload()?.metadata).toEqual({ ok: 1 });
    expect(mock.getLastPayload()?.forkId).toBe('0');
  });

  it('returns dropped keys when exceeding limits.maxContextKeys', () => {
    const { chronicle } = setup({ limits: { maxContextKeys: 2 } });
    expect(chronicle.addContext({ a: '1', b: '2', c: '3' }).dropped).toEqual(['c']);
  });

  it('applies maxContextKeys to config metadata', () => {
    const { mock, chronicle } = setup({
      metadata: { a: 1, b: 2, c: 3 },
      limits: { maxContextKeys: 2 },
    });
    chronicle.admin.heartbeat();
    expect(Object.keys(mock.getLastPayload()!.metadata)).toHaveLength(2);
  });
});

describe('field validation', () => {
  it('captures missing fields without throwing', () => {
    const { mock, chronicle } = setup();
    chronicle.system.startup({ port: undefined } as never);
    const payload = mock.getLastPayload();
    expect(payload?._validation?.missingFields).toEqual(['port']);
    expect(payload?.fields).toEqual({});
  });

  it('captures type errors, invalid values and unknown fields', () => {
    const { mock, chronicle } = setup();
    chronicle.system.startup({ port: 'x' } as never);
    chronicle.system.startup({ port: Number.NaN });
    chronicle.system.startup({ port: 1, extra: true } as never);
    const [typeErr, invalid, unknown] = mock.getPayloads();
    expect(typeErr?._validation).toEqual({ typeErrors: ['port'] });
    expect(invalid?._validation).toEqual({ invalidValues: ['port'] });
    expect(unknown?._validation).toEqual({ unknownFields: ['extra'] });
    expect(unknown?.fields).toEqual({ port: 1, extra: true });
  });

  it('serializes error fields to strings', () => {
    const { mock, chronicle } = setup();
    chronicle.system.failure({ error: new Error('failure') });
    const payload = mock.findByLevel('error');
    expect(typeof payload?.fields.error).toBe('string');
    expect(payload?.fields.error as string).toContain('failure');
  });

  it('strips ANSI escapes and replaces newlines in string fields', () => {
    const { mock, chronicle } = setup();
    chronicle.admin.login({ userId: '\x1b[31mred\x1b[0m\nline2', success: true });
    expect(mock.getLastPayload()?.fields.userId).toBe('red\\nline2');
  });
});

describe('strict mode', () => {
  it('throws FIELD_VALIDATION on missing required fields', () => {
    const { mock, chronicle } = setup({ strict: true });
    expect(() => chronicle.system.startup({} as never)).toThrow('missing required fields: port');
    expect(mock.getPayloads()).toHaveLength(0);
  });

  it('throws on type mismatches and invalid values', () => {
    const { chronicle } = setup({ strict: true });
    expect(() => chronicle.system.startup({ port: 'x' } as never)).toThrow('type errors');
    expect(() => chronicle.system.startup({ port: Infinity })).toThrow('invalid values');
  });

  it('throws a ChroniclerError naming the event key', () => {
    const { chronicle } = setup({ strict: true });
    try {
      chronicle.admin.login({ userId: 'u' } as never);
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ChroniclerError);
      expect((err as ChroniclerError).code).toBe('FIELD_VALIDATION');
      expect((err as ChroniclerError).message).toContain('"admin.login"');
    }
  });

  it('does not throw for unknown fields', () => {
    const { mock, chronicle } = setup({ strict: true });
    expect(() => chronicle.system.startup({ port: 1, extra: 1 } as never)).not.toThrow();
    expect(mock.getLastPayload()?._validation).toEqual({ unknownFields: ['extra'] });
  });

  it('applies to span events', () => {
    const { chronicle } = setup({ strict: true });
    const req = chronicle.http.request.begin();
    expect(() => req.received({} as never)).toThrow(ChroniclerError);
    req.complete();
  });

  it('does not throw when strict is off (default)', () => {
    const { chronicle } = setup();
    expect(() => chronicle.system.startup({} as never)).not.toThrow();
  });

  it('skips validation for events dropped by minLevel', () => {
    const { chronicle } = setup({ strict: true, minLevel: 'error' });
    expect(() => chronicle.system.startup({} as never)).not.toThrow();
  });
});

describe('minLevel filtering', () => {
  it('drops events below minLevel', () => {
    const { mock, chronicle } = setup({ minLevel: 'warn' });
    chronicle.admin.heartbeat();
    chronicle.admin.login({ userId: 'u', success: true });
    expect(mock.getPayloads()).toHaveLength(0);
  });

  it('allows events at or above minLevel', () => {
    const { mock, chronicle } = setup({ minLevel: 'error' });
    chronicle.system.failure({ error: 'fail' });
    expect(mock.getPayloads()).toHaveLength(1);
  });

  it('filters log() calls below minLevel', () => {
    const { mock, chronicle } = setup({ minLevel: 'error' });
    chronicle.log('info', 'this should be dropped');
    chronicle.log('error', 'this should pass');
    chronicle.log('fatal', 'and this');
    expect(mock.getEntries().map((e) => e.level)).toEqual(['error', 'fatal']);
  });

  it('defaults to trace (all events pass)', () => {
    const { mock, chronicle } = setup();
    chronicle.log('trace', 'most verbose');
    chronicle.log('debug', 'verbose');
    expect(mock.getPayloads()).toHaveLength(2);
  });
});

describe('log() escape hatch', () => {
  it('logs without a pre-defined event', () => {
    const { mock, chronicle } = setup({ metadata: { app: 'test' } });

    chronicle.log('info', 'hello world', { foo: 'bar' });

    const [entry] = mock.getEntries();
    expect(entry?.level).toBe('info');
    expect(entry?.message).toBe('hello world');
    expect(entry?.payload).toMatchObject({
      eventKey: '',
      fields: { foo: 'bar' },
      forkId: '0',
      metadata: { app: 'test' },
    });
    expect(entry?.payload).not.toHaveProperty('_validation');
  });

  it('defaults fields to an empty object', () => {
    const { mock, chronicle } = setup();
    chronicle.log('warn', 'watch out');
    expect(mock.getLastPayload()?.fields).toEqual({});
  });

  it('sanitizes string fields', () => {
    const { mock, chronicle } = setup();
    chronicle.log('info', 'msg', { s: 'a\nb\x1b[2J', n: 1 });
    expect(mock.getLastPayload()?.fields).toEqual({ s: 'a\\nb', n: 1 });
  });

  it('works on forks and span handles', () => {
    const { mock, chronicle } = setup();
    chronicle.fork().log('info', 'from fork');
    const req = chronicle.http.request.begin();
    req.log('info', 'from span');
    req.fork().log('info', 'from span fork');
    const logs = mock.getPayloads().filter((p) => p.eventKey === '');
    expect(logs.map((p) => [p.forkId, p.spanId])).toEqual([
      ['1', undefined],
      ['0', 'c1'],
      ['1', 'c1'],
    ]);
    req.complete();
  });
});

describe('backend errors', () => {
  it('never let a throwing backend crash the caller', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const mock = new MockLoggerBackend();
    const backend: LogBackend = {
      ...mock.backend,
      info: () => {
        throw new Error('backend exploded');
      },
    };
    const chronicle = createChronicle({ events, backend });
    expect(() => chronicle.system.startup({ port: 1 })).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      '[chronicler] Backend error during log emission:',
      'backend exploded',
    );
    errorSpy.mockRestore();
  });
});

describe('id generators', () => {
  it('defaults to random W3C trace and span ids', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ events, backend: mock.backend });
    const a = chronicle.http.request.begin();
    const b = chronicle.http.request.begin();
    expect(a.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(a.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.spanId).not.toBe(b.spanId);
    expect(a.traceId).not.toBe(b.traceId);
    a.complete();
    b.complete();
  });

  it('uses a custom generator', () => {
    const chronicle = createChronicle({
      events: defineEvents({
        j: span({
          events: {
            s: event({ level: 'info', message: 's', fields: { n: field.number().optional() } }),
          },
        }),
      }),
      backend: new MockLoggerBackend().backend,
      traceIdGenerator: () => 'trace',
      spanIdGenerator: () => 'fixed',
    });
    const handle = chronicle.j.begin();
    expect(handle.spanId).toBe('fixed');
    expect(handle.traceId).toBe('trace');
    handle.complete();
  });
});
