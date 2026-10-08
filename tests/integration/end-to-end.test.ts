import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type Chronicle,
  correlation,
  createChronicle,
  createRouterBackend,
  defineEvents,
  event,
  field,
  group,
  type HandleOf,
} from '../../src';
import { sequentialIds, sleep } from '../helpers/fixtures';
import { MockLoggerBackend } from '../helpers/mock-logger';

// An app-shaped catalog assembled from per-module catalogs, as a real service would.
const adminEvents = defineEvents({
  login: event({
    level: 'audit',
    message: 'Login attempt',
    doc: 'User login attempt',
    fields: { userId: field.string().doc('User ID'), success: field.boolean().doc('Success') },
  }),
  action: event({
    level: 'audit',
    message: 'Admin action',
    fields: { action: field.string().doc('Action name') },
  }),
});

const apiEvents = defineEvents({
  request: correlation({
    doc: 'API request',
    timeout: 5000,
    events: {
      validated: event({
        level: 'info',
        message: 'Request validated',
        fields: { method: field.string(), path: field.string() },
      }),
      db: {
        query: event({
          level: 'debug',
          message: 'Query',
          fields: { table: field.string(), ms: field.number().optional() },
        }),
      },
    },
  }),
});

const events = defineEvents({
  system: group(
    { doc: 'Process lifecycle' },
    {
      startup: event({
        level: 'info',
        message: 'Application started',
        fields: { port: field.number(), mode: field.string().optional() },
      }),
      error: event({
        level: 'error',
        message: 'Error occurred',
        fields: { error: field.error(), code: field.string() },
      }),
    },
  ),
  admin: adminEvents,
  api: apiEvents,
  jobs: {
    sync: correlation({
      timeout: 0,
      events: { batch: event({ level: 'info', message: 'batch', fields: { n: field.number() } }) },
    }),
  },
});

type Events = typeof events;
type Request = HandleOf<Chronicle<Events>['api']['request']>;

const build = (backend = new MockLoggerBackend().backend) =>
  createChronicle({
    events,
    backend,
    metadata: { app: 'my-api' },
    correlationIdGenerator: sequentialIds(),
  });

describe('Integration Tests', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-derives keys for mounted module catalogs', () => {
    expect(events.admin.login.key).toBe('admin.login');
    expect(events.api.request.key).toBe('api.request');
    expect(events.api.request.events.db.query.key).toBe('api.request.db.query');
    const chronicle = build();
    expect(chronicle.api.request.key).toBe('api.request');
    expect(chronicle.admin.login.key).toBe('admin.login');
  });

  it('runs a request through handlers that only import the chronicle', async () => {
    const mock = new MockLoggerBackend();
    const chronicle = build(mock.backend);
    const { admin, api } = chronicle;

    // a "repository" module that knows nothing about the request
    const findUser = async (id: string) => {
      await sleep(1);
      chronicle.log('debug', 'cache miss', { id });
      return { id };
    };

    // a handler using its typed correlation handle
    const handle = async (req: Request, userId: string) => {
      req.validated({ method: 'POST', path: '/login' });
      const user = await findUser(userId);
      req.db.query({ table: 'users', ms: 3 });
      admin.login({ userId: user.id, success: true });
      chronicle.addContext({ userId });
    };

    chronicle.system.startup({ port: 3000, mode: 'test' });
    await Promise.all(
      ['u1', 'u2'].map((userId) =>
        api.request.run({ requestId: `r-${userId}` }, async (req) => {
          await handle(req, userId);
          const fork = req.fork({ phase: 'audit' });
          fork.db.query({ table: 'audit' });
          req.complete({ status: 200 });
        }),
      ),
    );
    chronicle.system.startup({ port: 3001 });

    const payloads = mock.getPayloads();
    expect(payloads[0]).toMatchObject({ eventKey: 'system.startup', correlationId: '' });
    expect(payloads.at(-1)).toMatchObject({
      eventKey: 'system.startup',
      metadata: { app: 'my-api' },
    });
    expect(payloads.at(-1)?.metadata).not.toHaveProperty('userId');

    for (const [user, id] of [
      ['u1', 'c1'],
      ['u2', 'c2'],
    ] as const) {
      const ofRequest = payloads.filter((p) => p.correlationId === id);
      expect(ofRequest.map((p) => p.eventKey)).toEqual([
        'api.request.start',
        'api.request.validated',
        '',
        'api.request.db.query',
        'admin.login',
        'api.request.db.query',
        'api.request.complete',
      ]);
      for (const p of ofRequest) {
        expect(p.metadata.requestId).toBe(`r-${user}`);
        expect(p.rootCorrelationId).toBe(id);
      }
      expect(ofRequest.find((p) => p.eventKey === 'admin.login')?.fields.userId).toBe(user);
      expect(ofRequest.at(-1)?.metadata.userId).toBe(user);
      expect(ofRequest.at(-2)).toMatchObject({ forkId: '1', metadata: { phase: 'audit' } });
    }
  });

  it('nests a background job inside a request and detaches fire-and-forget work', async () => {
    const mock = new MockLoggerBackend();
    const chronicle = build(mock.backend);
    let detached!: Promise<void>;

    await chronicle.api.request.run(async (req) => {
      await chronicle.jobs.sync.run(async (job) => {
        job.batch({ n: 1 });
        await sleep(1);
        job.batch({ n: 2 });
        job.complete();
      });
      detached = chronicle.run(async () => {
        await sleep(2);
        chronicle.system.startup({ port: 9 });
      });
      req.complete();
    });
    await detached;

    const batches = mock.findAllByKey('jobs.sync.batch');
    expect(
      batches.map((p) => [p.correlationId, p.parentCorrelationId, p.rootCorrelationId]),
    ).toEqual([
      ['c2', 'c1', 'c1'],
      ['c2', 'c1', 'c1'],
    ]);
    const late = mock.findByKey('system.startup');
    expect(late?.correlationId).toBe('');
    expect(late).not.toHaveProperty('_validation');
  });

  it('emits timeout when no activity occurs and resets on fork activity', () => {
    vi.useFakeTimers();
    const mock = new MockLoggerBackend();
    const chronicle = build(mock.backend);

    const req = chronicle.api.request.begin();
    const fork = req.fork();
    vi.advanceTimersByTime(4000);
    fork.db.query({ table: 't' });
    vi.advanceTimersByTime(4000);
    expect(mock.findByKey('api.request.timeout')).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(mock.findByKey('api.request.timeout')).toBeDefined();

    req.complete();
    expect(mock.findByKey('api.request.complete')?.fields.duration).toBe(9000);
  });

  it('tracks validation errors without throwing', () => {
    const mock = new MockLoggerBackend();
    const chronicle = build(mock.backend);
    chronicle.system.startup({} as never);
    chronicle.system.startup({ port: 'x' } as never);
    expect(mock.getPayloads().map((p) => p._validation)).toEqual([
      { missingFields: ['port'] },
      { typeErrors: ['port'] },
    ]);
  });

  it('isolates context between fork branches', () => {
    const mock = new MockLoggerBackend();
    const chronicle = build(mock.backend);
    const a = chronicle.fork({ branch: 'a' });
    const b = chronicle.fork({ branch: 'b' });
    a.addContext({ a: 1 });
    b.addContext({ b: 2 });
    a.fork().system.startup({ port: 1 });
    b.fork().system.startup({ port: 2 });
    expect(mock.getPayloads().map((p) => [p.forkId, p.metadata])).toEqual([
      ['1.1', { app: 'my-api', branch: 'a', a: 1 }],
      ['2.1', { app: 'my-api', branch: 'b', b: 2 }],
    ]);
  });

  it('safely serializes error fields (stack preferred over message)', () => {
    const mock = new MockLoggerBackend();
    const chronicle = build(mock.backend);
    const error = new Error('Test error');
    error.stack = 'Stack trace here';
    chronicle.system.error({ error, code: 'ERR_TEST' });
    expect(mock.getPayloads()[0]?.fields).toEqual({ error: 'Stack trace here', code: 'ERR_TEST' });
  });

  describe('Router Backend — Multi-Stream Routing', () => {
    const routed = () => {
      const audit = new MockLoggerBackend();
      const http = new MockLoggerBackend();
      const main = new MockLoggerBackend();
      const router = createRouterBackend([
        { backend: audit.backend, filter: (_lvl, p) => p.eventKey.startsWith('admin.') },
        { backend: http.backend, filter: (_lvl, p) => p.eventKey.startsWith('api.request.') },
        {
          backend: main.backend,
          filter: (_lvl, p) =>
            !p.eventKey.startsWith('admin.') && !p.eventKey.startsWith('api.request.'),
        },
      ]);
      return { audit, http, main, chronicle: build(router) };
    };

    it('routes events to separate backends by event key prefix', () => {
      const { audit, http, main, chronicle } = routed();
      chronicle.system.startup({ port: 3000 });
      chronicle.admin.login({ userId: 'admin', success: true });
      const req = chronicle.api.request.begin();
      req.validated({ method: 'GET', path: '/' });
      req.complete();

      expect(main.getKeys()).toEqual(['system.startup']);
      expect(audit.getKeys()).toEqual(['admin.login']);
      expect(http.getKeys()).toEqual([
        'api.request.start',
        'api.request.validated',
        'api.request.complete',
      ]);
    });

    it('supports fan-out where one event matches multiple routes', () => {
      const primary = new MockLoggerBackend();
      const errors = new MockLoggerBackend();
      const chronicle = build(
        createRouterBackend([
          { backend: primary.backend },
          { backend: errors.backend, filter: (lvl) => lvl === 'error' || lvl === 'fatal' },
        ]),
      );
      chronicle.system.startup({ port: 3000 });
      chronicle.log('error', 'Something broke');
      expect(primary.getPayloads()).toHaveLength(2);
      expect(errors.findAllByLevel('error')).toHaveLength(1);
    });

    it('preserves shared context and correlation ids across routed backends', () => {
      const { http, chronicle } = routed();
      chronicle.addContext({ deploymentId: 'deploy-abc' });
      const req = chronicle.api.request.begin({ requestId: 'req-1' });
      req.validated({ method: 'POST', path: '/users' });
      req.complete();
      const validated = http.findByKey('api.request.validated');
      expect(validated?.metadata).toEqual({
        app: 'my-api',
        deploymentId: 'deploy-abc',
        requestId: 'req-1',
      });
      expect(new Set(http.getPayloads().map((p) => p.correlationId))).toEqual(new Set(['c1']));
    });

    it('routes lifecycle events (fail, timeout) to the correct backend', () => {
      vi.useFakeTimers();
      const { http, main, chronicle } = routed();
      chronicle.api.request.begin().fail(new Error('DB down'));
      chronicle.api.request.begin();
      vi.advanceTimersByTime(6000);
      expect(http.findByKey('api.request.fail')).toBeDefined();
      expect(http.findByKey('api.request.timeout')).toBeDefined();
      expect(main.getPayloads()).toHaveLength(0);
    });
  });
});
