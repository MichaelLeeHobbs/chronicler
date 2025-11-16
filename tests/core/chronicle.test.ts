import { describe, expect, it, vi } from 'vitest';

import type { LogBackend, LogPayload } from '../../src/core/backend';
import type { Chronicler } from '../../src/core/chronicle';
import { createChronicle } from '../../src/core/chronicle';
import { defineEvent } from '../../src/core/events';

const createLogMock = () => vi.fn<LogBackend['log']>();

const mockBackend = (overrides: Partial<LogBackend> = {}): LogBackend => ({
  log: createLogMock(),
  supportsLevel: () => true,
  ...overrides,
});

const sampleEvent = defineEvent({
  key: 'system.startup',
  level: 'info',
  message: 'started',
  doc: 'doc',
  fields: {
    port: { type: 'number', required: true, doc: 'port' },
  },
});

const errorEvent = defineEvent({
  key: 'system.failure',
  level: 'error',
  message: 'boom',
  doc: 'error event',
  fields: {
    error: { type: 'error', required: true, doc: 'err' },
  },
});

const getPayload = (log: ReturnType<typeof createLogMock>): LogPayload => {
  const entry = log.mock.calls.at(-1);
  if (!entry) {
    throw new Error('No log calls recorded');
  }
  const payload = entry[2];
  if (!payload) {
    throw new Error('Missing payload');
  }
  return payload;
};

describe('createChronicle', () => {
  it('throws if backend missing levels', () => {
    const backend = mockBackend({ supportsLevel: (level) => level !== 'error' });

    expect(() => createChronicle({ backend, metadata: {} })).toThrow(
      'Log backend does not support level: error',
    );
  });

  it('throws when metadata uses reserved keys', () => {
    const backend = mockBackend();

    expect(() => createChronicle({ backend, metadata: { eventKey: 'bad' } })).toThrow(
      'Reserved fields cannot be used in metadata: eventKey',
    );
  });

  it('logs events with metadata', () => {
    const log = createLogMock();
    const backend = mockBackend({ log });
    const chronicle = createChronicle({ backend, metadata: { deploymentId: 'dep-1' } });

    chronicle.event(sampleEvent, { port: 3000 });

    const payload = getPayload(log);
    expect(payload.metadata).toMatchObject({ deploymentId: 'dep-1' });
    expect(payload.fields).toEqual({ port: 3000 });
    expect(payload.timestamp).toEqual(expect.any(String));
  });

  it('adds context incrementally', () => {
    const log = createLogMock();
    const backend = mockBackend({ log });
    const chronicle = createChronicle({ backend, metadata: {} });

    chronicle.addContext({ userId: '123' });
    chronicle.addContext({ requestId: '456' });
    chronicle.event(sampleEvent, { port: 3000 });

    expect(getPayload(log).metadata).toMatchObject({ userId: '123', requestId: '456' });
  });

  it('captures validation errors without throwing', () => {
    const log = createLogMock();
    const backend = mockBackend({ log });
    const chronicle = createChronicle({ backend, metadata: {} });

    chronicle.event(sampleEvent, { port: undefined as never } as unknown as { port: number });

    const payload = getPayload(log);
    expect(payload._validation?.missingFields).toEqual(['port']);
    expect(payload.fields).toEqual({});
  });

  it('serializes error fields using stderr', () => {
    const log = createLogMock();
    const backend = mockBackend({ log });
    const chronicle = createChronicle({ backend, metadata: {} });

    const err = new Error('failure');
    chronicle.event(errorEvent, { error: err });

    const payload = getPayload(log);
    expect(typeof payload.fields.error).toBe('string');
    expect(payload.fields.error as string).toContain('failure');
  });

  it('records context collision warnings in validation metadata', () => {
    const log = createLogMock();
    const backend = mockBackend({ log });
    const chronicle = createChronicle({ backend, metadata: {} });

    chronicle.addContext({ userId: '123' });
    chronicle.addContext({ userId: '456' });
    chronicle.event(sampleEvent, { port: 3000 });

    const payload = getPayload(log);
    expect(payload._validation?.contextCollisions).toEqual(['userId']);
  });

  it('attaches perf metrics when monitoring enabled', () => {
    const log = createLogMock();
    const backend = mockBackend({ log });
    const chronicle = createChronicle({
      backend,
      metadata: {},
      monitoring: { memory: true },
    });

    chronicle.event(sampleEvent, { port: 3000 });

    const payload = getPayload(log);
    const perf = payload._perf;
    expect(perf).toBeDefined();
    if (!perf) {
      throw new Error('Expected perf sample when monitoring enabled');
    }
    expect(typeof perf.heapUsed).toBe('number');
    expect(typeof perf.heapTotal).toBe('number');
    expect(typeof perf.external).toBe('number');
    expect(typeof perf.rss).toBe('number');
  });
});

const createChronicleInstance = (
  configOverrides: Partial<Parameters<typeof createChronicle>[0]> = {},
): Chronicler => {
  return createChronicle({ backend: mockBackend(), metadata: {}, ...configOverrides });
};

describe('createChronicleExtended', () => {
  it('verifies startCorrelation availability', () => {
    const logSpy = createLogMock();
    const backend = mockBackend({ log: logSpy });
    const chronicle = createChronicleInstance({ backend, metadata: {} });

    expect(logSpy).toBeDefined();
    expect(typeof chronicle.startCorrelation).toBe('function');
  });
});
