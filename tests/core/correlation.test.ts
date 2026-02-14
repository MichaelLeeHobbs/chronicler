import { describe, expect, it, vi } from 'vitest';

import { createChronicle } from '../../src/core/chronicle';
import { CorrelationLimitExceededError } from '../../src/core/errors';
import { defineCorrelationGroup, defineEvent } from '../../src/core/events';
import { t } from '../../src/core/fields';
import { MockLoggerBackend } from '../helpers/mock-logger';

const events = defineCorrelationGroup({
  key: 'api.request',
  type: 'correlation',
  doc: 'request lifecycle',
  timeout: 100,
  events: {
    payload: defineEvent({
      key: 'api.request.payload',
      level: 'info',
      message: 'payload',
      doc: 'payload',
      fields: {
        body: t.string().doc('body'),
      },
    } as const),
  },
});

describe('correlation chronicle', () => {
  it('emits auto start and complete with duration', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

    const correlation = chronicle.startCorrelation(events, { requestId: 'r1' });
    correlation.complete();

    const keys = mock.getPayloads().map((p) => p.eventKey);
    expect(keys).toEqual(['api.request.start', 'api.request.complete']);
    expect(mock.getLastPayload()?.fields.duration).toBeGreaterThanOrEqual(0);
  });

  it('resets timeout on activity and emits timeout when idle', () => {
    vi.useFakeTimers();
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });
    const correlation = chronicle.startCorrelation(events);

    correlation.event(events.events.payload, { body: 'hello' });
    vi.advanceTimersByTime(90);
    correlation.event(events.events.payload, { body: 'world' });
    vi.advanceTimersByTime(110);

    const keys = mock.getPayloads().map((p) => p.eventKey);
    expect(keys).toEqual([
      'api.request.start',
      'api.request.payload',
      'api.request.payload',
      'api.request.timeout',
    ]);
    vi.useRealTimers();
  });

  it('emits metadataWarning when context collisions occur', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });
    const correlation = chronicle.startCorrelation(events, { userId: 'old' });

    correlation.addContext({ userId: 'new' });

    expect(mock.getPayloads().some((p) => p.eventKey === 'api.request.metadataWarning')).toBe(true);
  });

  it('emits fail event at error level with duration', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

    const correlation = chronicle.startCorrelation(events);
    correlation.fail(new Error('something broke'));

    const keys = mock.getPayloads().map((p) => p.eventKey);
    expect(keys).toEqual(['api.request.start', 'api.request.fail']);

    const failPayload = mock.findByKey('api.request.fail');
    expect(failPayload).toBeDefined();
    expect(failPayload?.fields.duration).toBeGreaterThanOrEqual(0);
    expect(failPayload?.fields.error).toBeDefined();
  });

  it('fail() prevents timeout', () => {
    vi.useFakeTimers();
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

    const correlation = chronicle.startCorrelation(events);
    correlation.fail();

    vi.advanceTimersByTime(200);

    const keys = mock.getPayloads().map((p) => p.eventKey);
    expect(keys).not.toContain('api.request.timeout');
    vi.useRealTimers();
  });

  it('marks multiple completes via validation metadata', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });
    const correlation = chronicle.startCorrelation(events);

    correlation.complete();
    correlation.complete();

    const completeCalls = mock.findAllByKey('api.request.complete');
    expect(completeCalls).toHaveLength(2);
    const second = completeCalls[1]!;
    expect(second._validation?.multipleCompletes).toBe(true);
  });
});

describe('correlation limits', () => {
  it('throws CorrelationLimitExceededError when active limit exceeded', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      limits: { maxActiveCorrelations: 2 },
    });

    chronicle.startCorrelation(events);
    chronicle.startCorrelation(events);

    expect(() => chronicle.startCorrelation(events)).toThrow(CorrelationLimitExceededError);
  });

  it('decrements on complete(), allowing new correlations', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      limits: { maxActiveCorrelations: 1 },
    });

    const corr1 = chronicle.startCorrelation(events);
    corr1.complete();

    // Should succeed since corr1 was completed
    const corr2 = chronicle.startCorrelation(events);
    expect(corr2).toBeDefined();
  });

  it('decrements on timeout(), allowing new correlations', () => {
    vi.useFakeTimers();
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      limits: { maxActiveCorrelations: 1 },
    });

    chronicle.startCorrelation(events);
    vi.advanceTimersByTime(200); // trigger timeout

    // Should succeed since corr1 timed out
    const corr2 = chronicle.startCorrelation(events);
    expect(corr2).toBeDefined();
    vi.useRealTimers();
  });

  it('counter shared across forks', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      limits: { maxActiveCorrelations: 2 },
    });

    const fork = chronicle.fork();
    chronicle.startCorrelation(events);
    fork.startCorrelation(events);

    expect(() => chronicle.startCorrelation(events)).toThrow(CorrelationLimitExceededError);
  });

  it('decrements on fail(), allowing new correlations', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      limits: { maxActiveCorrelations: 1 },
    });

    const corr1 = chronicle.startCorrelation(events);
    corr1.fail(new Error('oops'));

    const corr2 = chronicle.startCorrelation(events);
    expect(corr2).toBeDefined();
  });

  it('no double-decrement on multiple complete() calls', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: {},
      limits: { maxActiveCorrelations: 2 },
    });

    const corr1 = chronicle.startCorrelation(events);
    chronicle.startCorrelation(events);

    corr1.complete();
    corr1.complete(); // second complete should not double-decrement

    // Only 1 slot freed, so starting 2 more should fail on the second
    chronicle.startCorrelation(events);
    expect(() => chronicle.startCorrelation(events)).toThrow(CorrelationLimitExceededError);
  });
});
