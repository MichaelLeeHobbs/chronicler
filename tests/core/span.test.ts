import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setup } from '../helpers/fixtures';

describe('span lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('begin() emits start and complete() emits complete with duration', () => {
    const { mock, chronicle } = setup();

    const req = chronicle.http.request.begin({ requestId: 'r1' });
    vi.advanceTimersByTime(42);
    req.complete();

    expect(mock.getKeys()).toEqual(['http.request.start', 'http.request.complete']);
    const [start, complete] = mock.getEntries();
    expect(start).toMatchObject({ level: 'info', message: 'http.request started' });
    expect(start?.payload.fields).toEqual({});
    expect(complete).toMatchObject({ level: 'info', message: 'http.request completed' });
    expect(complete?.payload.fields).toEqual({ duration: 42 });
    expect(complete?.payload.metadata).toEqual({ requestId: 'r1' });
  });

  it('exposes the span id on the handle and on every event', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    req.received({ path: '/a' });
    req.phase.parsed();
    req.complete();
    expect(req.spanId).toBe('c1');
    expect(new Set(mock.getPayloads().map((p) => p.spanId))).toEqual(new Set(['c1']));
    expect(mock.getKeys()).toEqual([
      'http.request.start',
      'http.request.received',
      'http.request.phase.parsed',
      'http.request.complete',
    ]);
  });

  it('passes declared extra fields to complete() without validation issues', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.begin().complete({ status: 200 });
    expect(mock.getLastPayload()?.fields).toEqual({ duration: 0, status: 200 });
    expect(mock.getLastPayload()?._validation).toBeUndefined();
  });

  it('validates declared complete() fields at runtime', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin() as unknown as {
      complete: (fields: Record<string, unknown>) => void;
    };
    req.complete({ status: 'ok' });
    expect(mock.getLastPayload()?._validation).toEqual({ typeErrors: ['status'] });
  });

  it('fail() emits fail at error level with duration and serialized error', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    vi.advanceTimersByTime(5);
    req.fail(new Error('something broke'), { status: 500 });

    expect(mock.getKeys()).toEqual(['http.request.start', 'http.request.fail']);
    const fail = mock.getEntries()[1];
    expect(fail?.level).toBe('error');
    expect(fail?.payload.fields.duration).toBe(5);
    expect(fail?.payload.fields.error).toContain('something broke');
    expect(fail?.payload.fields.status).toBe(500);
  });

  it('fail() without an error omits the error field', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.begin().fail();
    expect(mock.getLastPayload()?.fields).toEqual({ duration: 0 });
  });

  it('accepts a string error', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.begin().fail('nope');
    expect(mock.getLastPayload()?.fields.error).toBe('nope');
  });

  it('ignores a second complete() or fail()', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    req.complete();
    req.complete();
    req.fail(new Error('late'));
    expect(mock.getKeys()).toEqual(['http.request.start', 'http.request.complete']);
  });

  it('ignores complete() after fail()', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    req.fail();
    req.complete();
    expect(mock.getKeys()).toEqual(['http.request.start', 'http.request.fail']);
  });

  it('inherits context from the scope it starts in, with begin() context overriding it', () => {
    const { mock, chronicle } = setup({ metadata: { svc: 'api', env: 'prod' } });
    chronicle.http.request.begin({ env: 'test', requestId: 'r1' }).complete();
    expect(mock.getLastPayload()?.metadata).toEqual({ svc: 'api', env: 'test', requestId: 'r1' });
  });

  it('does not leak span context to the root', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin({ requestId: 'r1' });
    req.addContext({ userId: 'u1' });
    chronicle.admin.heartbeat();
    expect(mock.getLastPayload()?.metadata).toEqual({});
    req.complete();
  });

  it('returns collision info from addContext on handles', () => {
    const { chronicle } = setup();
    const req = chronicle.http.request.begin({ userId: 'old' });
    const result = req.addContext({ userId: 'new' });
    expect(result.collisionDetails.map((d) => d.key)).toEqual(['userId']);
    req.complete();
  });

  it('gives each begin() its own span', () => {
    const { mock, chronicle } = setup();
    const a = chronicle.http.request.begin();
    const b = chronicle.http.request.begin();
    b.ping();
    a.ping();
    expect(mock.findAllByKey('http.request.ping').map((p) => p.spanId)).toEqual(['c2', 'c1']);
    // both are top-level: begin() from the root never nests
    expect(mock.getPayloads().every((p) => p.parentSpanId === undefined)).toBe(true);
    a.complete();
    b.complete();
  });

  it('starts spans from a fork with the fork id', () => {
    const { mock, chronicle } = setup();
    const fork = chronicle.fork({ task: 'A' });
    const req = fork.http.request.begin({ workflowId: 'wf1' });
    req.ping();
    expect(mock.getPayloads().map((p) => p.forkId)).toEqual(['1', '1']);
    expect(mock.getLastPayload()?.metadata).toEqual({ task: 'A', workflowId: 'wf1' });
    req.complete();
  });
});

describe('span timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits timeout at warn level when idle', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.begin();
    vi.advanceTimersByTime(99);
    expect(mock.getKeys()).toEqual(['http.request.start']);
    vi.advanceTimersByTime(1);
    expect(mock.getKeys()).toEqual(['http.request.start', 'http.request.timeout']);
    const timeout = mock.getEntries()[1];
    expect(timeout?.level).toBe('warn');
    expect(timeout?.payload.fields).toEqual({});
    expect(timeout?.payload.spanId).toBe('c1');
    // the timeout event reports the state before the timeout
    expect(timeout?.payload).not.toHaveProperty('spanState');
  });

  it('resets the timer on activity', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();

    req.received({ path: '/hello' });
    vi.advanceTimersByTime(90);
    req.received({ path: '/world' });
    vi.advanceTimersByTime(90);
    req.log('info', 'raw');
    vi.advanceTimersByTime(90);
    expect(mock.getKeys()).not.toContain('http.request.timeout');
    vi.advanceTimersByTime(10);

    expect(mock.getKeys()).toEqual([
      'http.request.start',
      'http.request.received',
      'http.request.received',
      '',
      'http.request.timeout',
    ]);
  });

  it('emits timeout only once', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.begin();
    vi.advanceTimersByTime(1000);
    expect(mock.findAllByKey('http.request.timeout')).toHaveLength(1);
  });

  it('never times out with timeout 0', () => {
    const { mock, chronicle } = setup();
    chronicle.job.batch.begin();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(mock.getKeys()).toEqual(['job.batch.start']);
  });

  it('complete() and fail() prevent the timeout', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.begin().complete();
    chronicle.http.request.begin().fail();
    vi.advanceTimersByTime(500);
    expect(mock.getKeys()).not.toContain('http.request.timeout');
  });

  it('keeps the span id on later events with spanState timedOut', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    vi.advanceTimersByTime(100);
    req.received({ path: '/late' });
    req.fork().ping();
    req.log('info', 'raw');

    const late = mock.getPayloads().slice(2);
    expect(late).toHaveLength(3);
    for (const p of late) {
      expect(p.spanId).toBe('c1');
      expect(p.spanState).toBe('timedOut');
    }
  });

  it('does not restart the timer after a timeout', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    vi.advanceTimersByTime(100);
    req.ping();
    vi.advanceTimersByTime(1000);
    expect(mock.findAllByKey('http.request.timeout')).toHaveLength(1);
  });

  it('accepts a late complete() once and reports the real duration', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    vi.advanceTimersByTime(250);
    req.complete();
    req.complete();
    req.ping();

    expect(mock.getKeys()).toEqual([
      'http.request.start',
      'http.request.timeout',
      'http.request.complete',
      'http.request.ping',
    ]);
    const complete = mock.findByKey('http.request.complete');
    expect(complete?.fields.duration).toBe(250);
    expect(complete?.spanId).toBe('c1');
    expect(complete?.spanState).toBe('timedOut');
    expect(mock.findByKey('http.request.ping')?.spanState).toBe('completed');
  });

  it('accepts a late fail() once and reports the real duration', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    vi.advanceTimersByTime(300);
    req.fail(new Error('late'));
    req.fail(new Error('later'));
    const fails = mock.findAllByKey('http.request.fail');
    expect(fails).toHaveLength(1);
    expect(fails[0]?.fields.duration).toBe(300);
    expect(fails[0]?.spanState).toBe('timedOut');
  });

  it('fork activity keeps the parent span alive', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    const fork = req.fork();
    fork.ping();
    vi.advanceTimersByTime(90);
    fork.ping();
    vi.advanceTimersByTime(90);
    expect(mock.getKeys()).not.toContain('http.request.timeout');
    vi.advanceTimersByTime(10);
    expect(mock.getKeys()).toContain('http.request.timeout');
  });
});

describe('span state after completion', () => {
  it('explicit handles still log with ids and spanState after complete/fail', () => {
    const { mock, chronicle } = setup();
    const done = chronicle.http.request.begin();
    const doneFork = done.fork();
    done.complete();
    done.ping();
    doneFork.ping();
    const failed = chronicle.http.request.begin();
    failed.fail();
    failed.ping();

    const pings = mock.findAllByKey('http.request.ping');
    expect(pings.map((p) => [p.spanId, p.spanState])).toEqual([
      ['c1', 'completed'],
      ['c1', 'completed'],
      ['c2', 'failed'],
    ]);
  });
});

describe('span minLevel filtering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('suppresses lifecycle events below minLevel', () => {
    const { mock, chronicle } = setup({ minLevel: 'error' });
    chronicle.http.request.begin().complete();
    expect(mock.getKeys()).toEqual([]);
  });

  it('emits fail at error level when minLevel is error', () => {
    const { mock, chronicle } = setup({ minLevel: 'error' });
    chronicle.http.request.begin().fail(new Error('oops'));
    expect(mock.getKeys()).toEqual(['http.request.fail']);
  });

  it('suppresses the timeout event (warn) when minLevel is error but still times out', () => {
    const { mock, chronicle } = setup({ minLevel: 'error' });
    const req = chronicle.http.request.begin();
    vi.advanceTimersByTime(200);
    expect(mock.getKeys()).toEqual([]);
    req.log('error', 'after');
    expect(mock.getLastPayload()?.spanState).toBe('timedOut');
  });
});

describe('span limits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never throws past maxActiveSpans and flags the start event', () => {
    const { mock, chronicle } = setup({ limits: { maxActiveSpans: 2 } });
    chronicle.http.request.begin();
    chronicle.http.request.begin();
    let third: ReturnType<typeof chronicle.http.request.begin> | undefined;
    expect(() => {
      third = chronicle.http.request.begin();
    }).not.toThrow();

    const starts = mock.findAllByKey('http.request.start');
    expect(starts.map((p) => p._validation)).toEqual([
      undefined,
      undefined,
      { spanLimitExceeded: true },
    ]);

    // the untracked span still works normally
    third?.received({ path: '/x' });
    third?.complete();
    expect(mock.findAllByKey('http.request.received')[0]?.spanId).toBe('c3');
    expect(mock.findAllByKey('http.request.complete')[0]?.spanId).toBe('c3');
  });

  it('flags spans started with run() too, without throwing', () => {
    const { mock, chronicle } = setup({ limits: { maxActiveSpans: 0 } });
    const result = chronicle.http.request.run((req) => {
      req.complete();
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(mock.findByKey('http.request.start')?._validation).toEqual({
      spanLimitExceeded: true,
    });
  });

  it('frees a slot on complete(), fail() and timeout', () => {
    const { mock, chronicle } = setup({ limits: { maxActiveSpans: 1 } });
    chronicle.http.request.begin().complete();
    chronicle.http.request.begin().fail();
    chronicle.http.request.begin();
    vi.advanceTimersByTime(100);
    chronicle.http.request.begin();
    expect(mock.findAllByKey('http.request.start').every((p) => p._validation === undefined)).toBe(
      true,
    );
  });

  it('does not double-free on repeated or late ends', () => {
    const { mock, chronicle } = setup({ limits: { maxActiveSpans: 2 } });
    const a = chronicle.http.request.begin();
    chronicle.http.request.begin();
    a.complete();
    a.complete();
    a.fail();

    chronicle.http.request.begin(); // takes the one freed slot
    chronicle.http.request.begin(); // over the limit
    const flags = mock.findAllByKey('http.request.start').map((p) => p._validation);
    expect(flags).toEqual([undefined, undefined, undefined, { spanLimitExceeded: true }]);
  });

  it('does not free a slot when an untracked span ends', () => {
    const { mock, chronicle } = setup({ limits: { maxActiveSpans: 1 } });
    chronicle.http.request.begin(); // tracked
    const untracked = chronicle.http.request.begin(); // flagged
    untracked.complete();
    chronicle.http.request.begin(); // still over the limit
    const flags = mock.findAllByKey('http.request.start').map((p) => p._validation);
    expect(flags).toEqual([undefined, { spanLimitExceeded: true }, { spanLimitExceeded: true }]);
  });

  it('shares the counter across forks and span types', () => {
    const { mock, chronicle } = setup({ limits: { maxActiveSpans: 2 } });
    chronicle.http.request.begin();
    chronicle.fork().job.batch.begin();
    chronicle.http.request.begin();
    expect(mock.findAllByKey('http.request.start')[1]?._validation).toEqual({
      spanLimitExceeded: true,
    });
  });

  it('does not share the counter between chronicles', () => {
    const a = setup({ limits: { maxActiveSpans: 1 } });
    const b = setup({ limits: { maxActiveSpans: 1 } });
    a.chronicle.http.request.begin();
    b.chronicle.http.request.begin();
    expect(b.mock.findByKey('http.request.start')?._validation).toBeUndefined();
  });
});

describe('span run()', () => {
  it('starts the span, passes the handle and returns the result', () => {
    const { mock, chronicle } = setup();
    const result = chronicle.http.request.run((req) => {
      req.received({ path: '/a' });
      return req.spanId;
    });
    expect(result).toBe('c1');
    expect(mock.getKeys()).toEqual(['http.request.start', 'http.request.received']);
  });

  it('accepts context as the first argument', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.run({ requestId: 'r1' }, (req) => {
      req.ping();
    });
    expect(mock.getLastPayload()?.metadata).toEqual({ requestId: 'r1' });
  });

  it('does not auto-complete when fn returns', async () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.run(() => undefined);
    await chronicle.http.request.run(async () => {
      await Promise.resolve();
    });
    expect(mock.getKeys()).toEqual(['http.request.start', 'http.request.start']);
  });

  it('auto-fails and rethrows when fn throws synchronously', () => {
    const { mock, chronicle } = setup();
    const boom = new Error('boom');
    expect(() =>
      chronicle.http.request.run(() => {
        throw boom;
      }),
    ).toThrow(boom);
    expect(mock.getKeys()).toEqual(['http.request.start', 'http.request.fail']);
    expect(mock.getLastPayload()?.fields.error).toContain('boom');
    expect(mock.getLastPayload()?.spanId).toBe('c1');
  });

  it('auto-fails and propagates the rejection when fn rejects', async () => {
    const { mock, chronicle } = setup();
    const promise = chronicle.http.request.run(async () => {
      await Promise.resolve();
      throw new Error('async boom');
    });
    await expect(promise).rejects.toThrow('async boom');
    await Promise.resolve();
    expect(mock.getKeys()).toEqual(['http.request.start', 'http.request.fail']);
    expect(mock.getLastPayload()?.fields.error).toContain('async boom');
  });

  it('does not fail again when fn completed before throwing', () => {
    const { mock, chronicle } = setup();
    expect(() =>
      chronicle.http.request.run((req) => {
        req.complete();
        throw new Error('after');
      }),
    ).toThrow('after');
    expect(mock.getKeys()).toEqual(['http.request.start', 'http.request.complete']);
  });

  it('strict mode: auto-fail on a non-Error throw rethrows the original value', () => {
    const { mock, chronicle } = setup({ strict: true });
    const thrown = { code: 'E_PLAIN_OBJECT' };
    let caught: unknown;
    try {
      chronicle.http.request.run(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- JS code can throw any value
        throw thrown;
      });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBe(thrown);
    expect(mock.getKeys()).toEqual(['http.request.start', 'http.request.fail']);
  });

  it('strict mode: auto-fail on a non-Error rejection does not cause an unhandled rejection', async () => {
    const { mock, chronicle } = setup({ strict: true });
    const thrown = { code: 'E_PLAIN_OBJECT' };
    await expect(
      chronicle.http.request.run(async () => {
        await Promise.resolve();
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- JS code can throw any value
        throw thrown;
      }),
    ).rejects.toBe(thrown);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mock.getKeys()).toEqual(['http.request.start', 'http.request.fail']);
  });

  it('auto-fail on a non-Error throw keeps a description of the thrown value', () => {
    const { mock, chronicle } = setup();
    expect(() =>
      chronicle.http.request.run(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- JS code can throw any value
        throw { code: 'E_PLAIN_OBJECT' };
      }),
    ).toThrow();
    const fail = mock.findByKey('http.request.fail');
    expect(fail?.fields.error).toEqual(expect.stringContaining('E_PLAIN_OBJECT'));
    expect(fail).not.toHaveProperty('_validation');
  });

  it('throws a TypeError when no function is given', () => {
    const { chronicle } = setup();
    const starter = chronicle.http.request as unknown as { run: (ctx: object) => unknown };
    expect(() => starter.run({ a: 1 })).toThrow(TypeError);
  });

  it('handle.run() makes the handle ambient and returns the result', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    const out = req.run(() => {
      chronicle.admin.heartbeat();
      return 7;
    });
    expect(out).toBe(7);
    expect(mock.findByKey('admin.heartbeat')?.spanId).toBe('c1');
    req.complete();
  });
});
