import { describe, expect, it, vi } from 'vitest';

import { createChronicle } from '../../src/core/chronicle';
import { defineCorrelationGroup, defineEvent } from '../../src/core/events';
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
        body: { type: 'string', required: true, doc: 'body' },
      },
    }),
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

  it('marks multiple completes via validation metadata', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({ backend: mock.backend, metadata: {} });
    const correlation = chronicle.startCorrelation(events);

    correlation.complete();
    correlation.complete();

    const completeCalls = mock.findAllByKey('api.request.complete');
    expect(completeCalls).toHaveLength(2);
    const second = completeCalls[1];
    expect(second._validation?.multipleCompletes).toBe(true);
  });
});
