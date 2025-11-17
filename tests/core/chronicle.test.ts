import { describe, expect, it } from 'vitest';

import type { Chronicler } from '../../src/core/chronicle';
import { createChronicle } from '../../src/core/chronicle';
import { defineEvent } from '../../src/core/events';
import { MockLoggerBackend } from '../helpers/mock-logger';

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

describe('createChronicle', () => {
  it('throws if backend missing levels', () => {
    const mock = new MockLoggerBackend();

    // @ts-expect-error -- deleting method for test
    delete mock.backend.error; // Remove error method

    expect(() => createChronicle({ backend: mock.backend, metadata: {} })).toThrow(
      'Log backend does not support level: error',
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

  it('emits system event for context collisions', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

    chronicle.addContext({ userId: '123' });
    chronicle.addContext({ userId: '456' }); // Collision

    // Check that chronicler.contextCollision event was emitted
    const collisionEvent = mock.findByKey('chronicler.contextCollision');
    expect(collisionEvent).toBeDefined();
    expect(collisionEvent?.fields.key).toBe('userId');
    expect(collisionEvent?.fields.existingValue).toBe('123');
    expect(collisionEvent?.fields.attemptedValue).toBe('456');
  });

  it('attaches perf metrics when monitoring enabled', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      monitoring: { memory: true },
    });

    chronicle.event(sampleEvent, { port: 3000 });

    const payload = mock.getLastPayload();
    const perf = payload?._perf;
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
  return createChronicle({
    backend: new MockLoggerBackend().backend,
    metadata: {},
    ...configOverrides,
  });
};

describe('createChronicleExtended', () => {
  it('verifies startCorrelation availability', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicleInstance({ backend: mock.backend, metadata: {} });

    expect(mock.backend.info).toBeDefined();
    expect(typeof chronicle.startCorrelation).toBe('function');
  });
});
