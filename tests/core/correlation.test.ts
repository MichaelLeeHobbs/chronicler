import { describe, expect, it, vi } from 'vitest';

import type { LogBackend, LogPayload } from '../../src/core/backend';
import { createChronicle } from '../../src/core/chronicle';
import { defineCorrelationGroup, defineEvent } from '../../src/core/events';

const createBackend = () => {
  const log = vi.fn<LogBackend['log']>();
  const backend: LogBackend = {
    log,
    supportsLevel: () => true,
  };
  return { backend, log };
};

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

const lastPayload = (log: ReturnType<typeof vi.fn>): LogPayload => {
  const call = log.mock.calls.at(-1);
  if (!call) {
    throw new Error('no log');
  }
  return call[2] as LogPayload;
};

describe('correlation chronicle', () => {
  it('emits auto start and complete with duration', () => {
    const { backend, log } = createBackend();
    const chronicle = createChronicle({ backend, metadata: {} });

    const correlation = chronicle.startCorrelation(events, { requestId: 'r1' });
    correlation.complete();

    const keys = log.mock.calls.map(([, , payload]) => payload.eventKey);
    expect(keys).toEqual(['api.request.start', 'api.request.complete']);
    expect(lastPayload(log).fields.duration).toBeGreaterThanOrEqual(0);
  });

  it('resets timeout on activity and emits timeout when idle', () => {
    vi.useFakeTimers();
    const { backend, log } = createBackend();
    const chronicle = createChronicle({ backend, metadata: {} });
    const correlation = chronicle.startCorrelation(events);

    correlation.event(events.events.payload, { body: 'hello' });
    vi.advanceTimersByTime(90);
    correlation.event(events.events.payload, { body: 'world' });
    vi.advanceTimersByTime(110);

    const keys = log.mock.calls.map(([, , payload]) => payload.eventKey);
    expect(keys).toEqual([
      'api.request.start',
      'api.request.payload',
      'api.request.payload',
      'api.request.timeout',
    ]);
    vi.useRealTimers();
  });

  it('emits metadataWarning when context collisions occur', () => {
    const { backend, log } = createBackend();
    const chronicle = createChronicle({ backend, metadata: {} });
    const correlation = chronicle.startCorrelation(events, { userId: 'old' });

    correlation.addContext({ userId: 'new' });

    expect(
      log.mock.calls.some(([, , payload]) => payload.eventKey === 'api.request.metadataWarning'),
    ).toBe(true);
  });

  it('marks multiple completes via validation metadata', () => {
    const { backend, log } = createBackend();
    const chronicle = createChronicle({ backend, metadata: {} });
    const correlation = chronicle.startCorrelation(events);

    correlation.complete();
    correlation.complete();

    const completeCalls = log.mock.calls.filter(
      ([, , payload]) => payload.eventKey === 'api.request.complete',
    );
    expect(completeCalls).toHaveLength(2);
    const second = completeCalls[1][2];
    expect(second._validation?.multipleCompletes).toBe(true);
  });
});
