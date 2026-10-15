import type { ChroniclerConfig } from '../../src/core/chronicle';
import { createChronicle } from '../../src/core/chronicle';
import { defineEvents, event, group, span } from '../../src/core/events';
import { field } from '../../src/core/fields';
import { MockLoggerBackend } from './mock-logger';

/** A small catalog that exercises every kind of entry. */
export const events = defineEvents({
  system: {
    startup: event({
      level: 'info',
      message: 'started',
      doc: 'Service started',
      fields: { port: field.number().doc('port') },
    }),
    failure: event({
      level: 'error',
      message: 'boom',
      fields: { error: field.error().doc('err') },
    }),
  },
  admin: group(
    { doc: 'Admin events' },
    {
      login: event({
        level: 'audit',
        message: 'User login attempt',
        fields: {
          userId: field.string(),
          success: field.boolean(),
          ip: field.string().optional(),
        },
      }),
      heartbeat: event({ level: 'debug', message: 'tick' }),
      note: event({ level: 'info', message: 'note', fields: { text: field.string().optional() } }),
    },
  ),
  http: {
    request: span({
      doc: 'HTTP request lifecycle',
      timeout: 100,
      complete: { status: field.number().optional() },
      fail: { status: field.number().optional() },
      events: {
        received: event({ level: 'info', message: 'received', fields: { path: field.string() } }),
        ping: event({ level: 'debug', message: 'ping' }),
        phase: { parsed: event({ level: 'info', message: 'parsed' }) },
      },
    }),
  },
  job: {
    batch: span({
      timeout: 0,
      events: { step: event({ level: 'info', message: 'step', fields: { n: field.number() } }) },
    }),
  },
});

export type Events = typeof events;

/** Span id generator producing `c1`, `c2`, ... */
export const sequentialIds = (prefix = 'c'): (() => string) => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

/** A chronicle over {@link events} with a mock backend and predictable span ids. */
export const setup = (config: Omit<ChroniclerConfig<Events>, 'events' | 'backend'> = {}) => {
  const mock = new MockLoggerBackend();
  const chronicle = createChronicle({
    traceIdGenerator: sequentialIds('t'),
    spanIdGenerator: sequentialIds(),
    ...config,
    events,
    backend: mock.backend,
  });
  return { mock, chronicle };
};

/** Wait `ms` milliseconds on a real timer. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
