import { afterEach, describe, expect, it, vi } from 'vitest';

import { setup, sleep } from '../helpers/fixtures';

// AsyncLocalStorage follows real async resources. These tests use real (short) timers, because
// fake timers run callbacks synchronously from `advanceTimersByTime` and so lose the store.

/**
 * Capture `fn` in the current async context, like a listener or pooled callback registered
 * during a request. Calling the result runs `fn` later, still in the captured context.
 */
const leak = (fn: () => void): (() => Promise<void>) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = gate.then(fn);
  return () => {
    release();
    return done;
  };
};

describe('ambient correlations', () => {
  it('routes root emitters to the ambient correlation across awaits and setTimeout', async () => {
    const { mock, chronicle } = setup();
    const { admin } = chronicle;

    await chronicle.http.request.run(async (req) => {
      admin.heartbeat();
      await sleep(1);
      chronicle.admin.heartbeat();
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          admin.heartbeat();
          resolve();
        }, 1);
      });
      await Promise.all(
        [1, 2].map(async () => {
          await sleep(1);
          admin.heartbeat();
        }),
      );
      req.complete();
    });

    const beats = mock.findAllByKey('admin.heartbeat');
    expect(beats).toHaveLength(5);
    for (const p of beats) {
      expect(p.correlationId).toBe('c1');
      expect(p.rootCorrelationId).toBe('c1');
    }
  });

  it('returns to the root scope after run() finishes', async () => {
    const { mock, chronicle } = setup();
    await chronicle.http.request.run(async (req) => {
      await sleep(1);
      req.complete();
    });
    chronicle.admin.heartbeat();
    expect(mock.getLastPayload()?.correlationId).toBe('');
  });

  it('routes log() to the ambient correlation', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.run((req) => {
      chronicle.log('info', 'inside');
      req.complete();
    });
    expect(mock.getPayloads()[1]).toMatchObject({ eventKey: '', correlationId: 'c1' });
  });

  it('never crosses ids between concurrent interleaved run() calls', async () => {
    const { mock, chronicle } = setup();
    const { admin } = chronicle;
    const seen = new Map<string, string>();

    const work = (user: string, delays: number[]) =>
      chronicle.http.request.run({ user }, async (req) => {
        seen.set(user, req.correlationId);
        for (const ms of delays) {
          await sleep(ms);
          admin.login({ userId: user, success: true });
        }
        req.complete();
      });

    await Promise.all([
      work('alice', [3, 1, 4, 1]),
      work('bob', [1, 5, 2, 1]),
      work('carol', [2, 2, 2, 2]),
    ]);

    const logins = mock.findAllByKey('admin.login');
    expect(logins).toHaveLength(12);
    // the logins interleave, so this is a real concurrency test
    expect(logins.slice(0, 3).map((p) => p.fields.userId)).not.toEqual(['alice', 'alice', 'alice']);
    for (const p of logins) {
      const user = p.fields.userId as string;
      expect(p.correlationId).toBe(seen.get(user));
      expect(p.metadata.user).toBe(user);
    }
    expect(new Set(seen.values()).size).toBe(3);
  });

  it('root run() detaches from the ambient correlation', async () => {
    const { mock, chronicle } = setup({ metadata: { svc: 'api' } });
    await chronicle.http.request.run({ requestId: 'r1' }, async (req) => {
      const result = chronicle.run(() => {
        chronicle.admin.heartbeat();
        return 'detached';
      });
      expect(result).toBe('detached');
      let background: Promise<void> = Promise.resolve();
      chronicle.run(() => {
        background = (async () => {
          await sleep(1);
          chronicle.admin.note({ text: 'background' });
        })();
      });
      await background;
      chronicle.admin.heartbeat();
      req.complete();
    });

    const [detached, background, inside] = mock
      .getPayloads()
      .filter((p) => p.eventKey.startsWith('admin.'));
    expect(detached).toMatchObject({ correlationId: '', metadata: { svc: 'api' } });
    expect(detached).not.toHaveProperty('rootCorrelationId');
    expect(background).toMatchObject({ correlationId: '', metadata: { svc: 'api' } });
    expect(inside).toMatchObject({ correlationId: 'c1', metadata: { requestId: 'r1' } });
  });

  it('fork() inside an ambient correlation creates a fork of that correlation', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.run({ requestId: 'r1' }, (req) => {
      const fork = chronicle.fork({ step: 'x' });
      fork.admin.heartbeat();
      req.complete();
      fork.admin.note();
    });
    const [heartbeat, note] = [mock.findByKey('admin.heartbeat'), mock.findByKey('admin.note')];
    expect(heartbeat).toMatchObject({
      correlationId: 'c1',
      forkId: '1',
      metadata: { requestId: 'r1', step: 'x' },
    });
    expect(heartbeat).not.toHaveProperty('correlationState');
    expect(note).toMatchObject({ correlationId: 'c1', correlationState: 'completed' });
  });

  it('addContext() inside an ambient correlation adds to that correlation only', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.run((req) => {
      const result = chronicle.addContext({ user: 'bob' });
      expect(result.collisionDetails).toEqual([]);
      chronicle.admin.heartbeat();
      req.ping();
      req.complete();
    });
    chronicle.admin.heartbeat();

    const beats = mock.findAllByKey('admin.heartbeat');
    expect(beats[0]?.metadata).toEqual({ user: 'bob' });
    expect(mock.findByKey('http.request.ping')?.metadata).toEqual({ user: 'bob' });
    expect(beats[1]?.metadata).toEqual({});
  });

  it('a fork made ambient with fork.run() receives root emitter calls', () => {
    const { mock, chronicle } = setup();
    const fork = chronicle.fork({ worker: 'w1' });
    fork.run(() => {
      chronicle.admin.heartbeat();
    });
    expect(mock.getLastPayload()).toMatchObject({ forkId: '1', metadata: { worker: 'w1' } });
  });

  it('a correlation fork made ambient with run() receives root emitter calls', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    const fork = req.fork({ part: 'a' });
    fork.run(() => {
      chronicle.admin.heartbeat();
    });
    expect(mock.getLastPayload()).toMatchObject({
      correlationId: 'c1',
      forkId: '1',
      metadata: { part: 'a' },
    });
    req.complete();
  });

  it('explicit handles stay bound to their own correlation inside another ambient correlation', () => {
    const { mock, chronicle } = setup();
    const outer = chronicle.http.request.begin();
    chronicle.job.batch.run((batch) => {
      outer.ping();
      batch.step({ n: 1 });
      batch.complete();
    });
    expect(mock.findByKey('http.request.ping')?.correlationId).toBe('c1');
    expect(mock.findByKey('job.batch.step')?.correlationId).toBe('c2');
    outer.complete();
  });
});

describe('nested correlations', () => {
  it('a correlation started inside another gets parent and root ids', async () => {
    const { mock, chronicle } = setup();
    await chronicle.http.request.run(async (req) => {
      await chronicle.job.batch.run(async (batch) => {
        await sleep(1);
        batch.step({ n: 1 });
        chronicle.admin.heartbeat();
        chronicle.http.request.run((inner) => {
          inner.ping();
          inner.complete();
        });
        batch.complete();
      });
      chronicle.admin.note();
      req.complete();
    });

    const byKey = (key: string) => mock.findAllByKey(key);
    expect(byKey('job.batch.start')[0]).toMatchObject({
      correlationId: 'c2',
      parentCorrelationId: 'c1',
      rootCorrelationId: 'c1',
    });
    expect(byKey('admin.heartbeat')[0]).toMatchObject({
      correlationId: 'c2',
      parentCorrelationId: 'c1',
    });
    expect(byKey('http.request.ping')[0]).toMatchObject({
      correlationId: 'c3',
      parentCorrelationId: 'c2',
      rootCorrelationId: 'c1',
    });
    // back in the outer correlation after the nested one returns
    const note = byKey('admin.note')[0];
    expect(note).toMatchObject({ correlationId: 'c1', rootCorrelationId: 'c1' });
    expect(note).not.toHaveProperty('parentCorrelationId');
  });

  it('begin() from a fork inside a correlation nests', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.run((req) => {
      const fork = chronicle.fork();
      const batch = fork.job.batch.begin();
      batch.step({ n: 1 });
      batch.complete();
      req.complete();
    });
    expect(mock.findByKey('job.batch.step')).toMatchObject({
      correlationId: 'c2',
      parentCorrelationId: 'c1',
      rootCorrelationId: 'c1',
      forkId: '1',
    });
  });

  it('nested context inherits the parent and can override it', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.run({ requestId: 'r1', tenant: 'a' }, (req) => {
      chronicle.job.batch.run({ tenant: 'b' }, (batch) => {
        batch.step({ n: 1 });
        batch.complete();
      });
      req.complete();
    });
    expect(mock.findByKey('job.batch.step')?.metadata).toEqual({ requestId: 'r1', tenant: 'b' });
  });

  it('has an independent lifecycle: completing the child leaves the parent active', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.run((req) => {
      chronicle.job.batch.run((batch) => {
        batch.complete();
      });
      req.ping();
      req.complete();
    });
    expect(mock.getKeys()).toEqual([
      'http.request.start',
      'job.batch.start',
      'job.batch.complete',
      'http.request.ping',
      'http.request.complete',
    ]);
    expect(mock.findByKey('http.request.ping')).not.toHaveProperty('correlationState');
  });

  it('a child can outlive its parent', async () => {
    const { mock, chronicle } = setup();
    let child: ReturnType<typeof chronicle.job.batch.begin> | undefined;
    await chronicle.http.request.run(async (req) => {
      child = chronicle.job.batch.begin();
      req.complete();
      await sleep(1);
    });
    child!.step({ n: 2 });
    child!.complete();

    const step = mock.findByKey('job.batch.step');
    expect(step).toMatchObject({
      correlationId: 'c2',
      parentCorrelationId: 'c1',
      rootCorrelationId: 'c1',
    });
    expect(step).not.toHaveProperty('correlationState');
    expect(mock.findByKey('job.batch.complete')).not.toHaveProperty('correlationState');
  });

  it('a child keeps working ambiently after its parent completes', async () => {
    const { mock, chronicle } = setup();
    await chronicle.http.request.run(async (req) => {
      await chronicle.job.batch.run(async (batch) => {
        req.complete();
        await sleep(1);
        chronicle.admin.heartbeat();
        batch.complete();
      });
    });
    const beat = mock.findByKey('admin.heartbeat');
    expect(beat).toMatchObject({ correlationId: 'c2', parentCorrelationId: 'c1' });
    expect(beat).not.toHaveProperty('_validation');
  });

  it('a parent timeout does not end the child', () => {
    vi.useFakeTimers();
    try {
      const { mock, chronicle } = setup();
      const parent = chronicle.http.request.begin();
      let batch: ReturnType<typeof chronicle.job.batch.begin> | undefined;
      parent.run(() => {
        batch = chronicle.job.batch.begin();
      });
      vi.advanceTimersByTime(100);
      batch!.step({ n: 1 });
      expect(mock.findByKey('http.request.timeout')).toBeDefined();
      expect(mock.findByKey('job.batch.step')).not.toHaveProperty('correlationState');
      batch!.complete();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a correlation started after the ambient one finished is not nested under it', async () => {
    const { mock, chronicle } = setup();
    let later: (() => Promise<void>) | undefined;
    chronicle.http.request.run((req) => {
      later = leak(() => {
        chronicle.job.batch.run((batch) => {
          batch.complete();
        });
      });
      req.complete();
    });
    await later!();
    const start = mock.findByKey('job.batch.start');
    expect(start).toMatchObject({ correlationId: 'c2', rootCorrelationId: 'c2' });
    expect(start).not.toHaveProperty('parentCorrelationId');
  });
});

describe('stale ambient correlations', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs in the outer scope with _validation.staleCorrelationId', async () => {
    const { mock, chronicle } = setup();
    let leaked: () => Promise<void> = () => Promise.resolve();
    chronicle.http.request.run((req) => {
      leaked = leak(() => {
        chronicle.admin.heartbeat();
        chronicle.log('info', 'raw');
      });
      req.complete();
    });
    await leaked();

    const [beat, raw] = mock.getPayloads().slice(-2);
    expect(beat).toMatchObject({ eventKey: 'admin.heartbeat', correlationId: '' });
    expect(beat?._validation).toEqual({ staleCorrelationId: 'c1' });
    expect(beat).not.toHaveProperty('correlationState');
    expect(raw?._validation).toEqual({ staleCorrelationId: 'c1' });
  });

  it('a timer outliving its request is flagged as stale', async () => {
    const { mock, chronicle } = setup();
    let fired!: Promise<void>;
    chronicle.http.request.run((req) => {
      fired = new Promise((resolve) => {
        setTimeout(() => {
          chronicle.admin.heartbeat();
          resolve();
        }, 5);
      });
      req.complete();
    });
    await fired;
    expect(mock.findByKey('admin.heartbeat')?._validation).toEqual({ staleCorrelationId: 'c1' });
  });

  it('merges staleCorrelationId with field validation issues', async () => {
    const { mock, chronicle } = setup();
    let leaked: () => Promise<void> = () => Promise.resolve();
    chronicle.http.request.run((req) => {
      leaked = leak(() => chronicle.system.startup({} as never));
      req.fail();
    });
    await leaked();
    expect(mock.getLastPayload()?._validation).toEqual({
      missingFields: ['port'],
      staleCorrelationId: 'c1',
    });
  });

  it('falls back to the enclosing active correlation and reports the innermost stale id', async () => {
    const { mock, chronicle } = setup();
    let leaked: () => Promise<void> = () => Promise.resolve();
    await chronicle.http.request.run(async (outer) => {
      chronicle.job.batch.run((batch) => {
        leaked = leak(() => chronicle.admin.heartbeat());
        batch.complete();
      });
      await leaked();
      outer.complete();
    });
    const beat = mock.findByKey('admin.heartbeat');
    expect(beat).toMatchObject({ correlationId: 'c1', _validation: { staleCorrelationId: 'c2' } });
  });

  it('a timed-out ambient correlation is not stale: events keep its id with correlationState', () => {
    vi.useFakeTimers();
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin();
    vi.advanceTimersByTime(100);
    req.run(() => chronicle.admin.heartbeat());
    const beat = mock.findByKey('admin.heartbeat');
    expect(beat).toMatchObject({ correlationId: 'c1', correlationState: 'timedOut' });
    expect(beat).not.toHaveProperty('_validation');
  });

  it('fork() and addContext() on a stale ambient correlation use the outer scope', async () => {
    const { mock, chronicle } = setup();
    let leaked: () => Promise<void> = () => Promise.resolve();
    chronicle.http.request.run({ requestId: 'r1' }, (req) => {
      leaked = leak(() => {
        chronicle.addContext({ late: true });
        chronicle.fork().admin.heartbeat();
      });
      req.complete();
    });
    await leaked();
    expect(mock.getLastPayload()).toMatchObject({
      correlationId: '',
      forkId: '1',
      metadata: { late: true },
    });
    expect(mock.getLastPayload()?.metadata).not.toHaveProperty('requestId');
  });
});
