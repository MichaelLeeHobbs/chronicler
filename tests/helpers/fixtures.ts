import type { ChroniclerConfig } from '../../src/core/chronicle';
import { createChronicle } from '../../src/core/chronicle';
import { correlation, defineEvents, event, group } from '../../src/core/events';
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
    request: correlation({
      doc: 'HTTP request lifecycle',
      timeout: 100,
      events: {
        received: event({ level: 'info', message: 'received', fields: { path: field.string() } }),
        ping: event({ level: 'debug', message: 'ping' }),
        phase: { parsed: event({ level: 'info', message: 'parsed' }) },
      },
    }),
  },
  job: {
    batch: correlation({
      timeout: 0,
      events: { step: event({ level: 'info', message: 'step', fields: { n: field.number() } }) },
    }),
  },
});

export type Events = typeof events;

/** Correlation id generator producing `c1`, `c2`, ... */
export const sequentialIds = (): (() => string) => {
  let n = 0;
  return () => `c${++n}`;
};

/** A chronicle over {@link events} with a mock backend and predictable correlation ids. */
export const setup = (config: Omit<ChroniclerConfig<Events>, 'events' | 'backend'> = {}) => {
  const mock = new MockLoggerBackend();
  const chronicle = createChronicle({
    correlationIdGenerator: sequentialIds(),
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
