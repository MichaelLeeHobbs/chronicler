import { describe, expect, it, vi } from 'vitest';

import type { LogBackend } from '../../src/core/backend';
import { createChronicle } from '../../src/core/chronicle';
import { defineEvent } from '../../src/core/events';

type BackendLogArgs = Parameters<LogBackend['log']>;

// FIXME: TS2344: Type [level: LogLevel, message: string, data: Record<string, unknown>] does not satisfy the constraint Procedure | Constructable
const createLogMock = () => vi.fn<BackendLogArgs>();

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

  it('logs events with metadata and fields', () => {
    const log = createLogMock();
    const backend = mockBackend({ log });
    const chronicle = createChronicle({ backend, metadata: { deploymentId: 'dep-1' } });

    chronicle.event(sampleEvent, { port: 3000 });

    const calls = log.mock.calls as BackendLogArgs[];
    const lastCall = calls.at(-1);
    expect(lastCall).toBeDefined();
    const [level, message, payload] = lastCall!;
    expect(level).toBe('info');
    expect(message).toBe('started');
    expect(payload.eventKey).toBe('system.startup');
    expect(payload.fields).toEqual({ port: 3000 });
    expect(typeof payload.correlationId).toBe('string');
    expect(payload.metadata).toMatchObject({ deploymentId: 'dep-1' });
  });

  it('adds context incrementally', () => {
    const log = createLogMock();
    const backend = mockBackend({ log });
    const chronicle = createChronicle({ backend, metadata: {} });

    chronicle.addContext({ userId: '123' });
    chronicle.addContext({ requestId: '456' });
    chronicle.event(sampleEvent, { port: 3000 });

    const [, , payload] = log.mock.calls[0] as BackendLogArgs;
    expect(payload.metadata).toMatchObject({ userId: '123', requestId: '456' });
  });
});
