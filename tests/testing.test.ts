import { describe, expect, it } from 'vitest';

import { correlation, createChronicle, defineEvents, event, field } from '../src';
import { captureEvents, createTestChronicle } from '../src/testing';

const events = defineEvents({
  admin: {
    login: event({
      level: 'audit',
      message: 'User login attempt',
      fields: { userId: field.string(), success: field.boolean() },
    }),
    heartbeat: event({ level: 'debug', message: 'tick' }),
  },
  http: {
    request: correlation({
      events: {
        received: event({ level: 'info', message: 'received', fields: { path: field.string() } }),
      },
    }),
  },
});

describe('createTestChronicle', () => {
  it('records emitted events in memory with level, message and payload', () => {
    const t = createTestChronicle(events);
    t.chronicle.admin.login({ userId: 'u1', success: true });

    expect(t.emitted).toHaveLength(1);
    expect(t.emitted[0]).toMatchObject({
      level: 'audit',
      message: 'User login attempt',
      payload: { eventKey: 'admin.login', fields: { userId: 'u1', success: true } },
    });
  });

  it('passes config through (metadata, minLevel, strict)', () => {
    const t = createTestChronicle(events, { metadata: { svc: 'api' }, minLevel: 'info' });
    t.chronicle.admin.heartbeat();
    t.chronicle.admin.login({ userId: 'u', success: true });
    expect(t.emitted).toHaveLength(1);
    expect(t.emitted[0]?.payload.metadata).toEqual({ svc: 'api' });

    const strict = createTestChronicle(events, { strict: true });
    expect(() => strict.chronicle.admin.login({} as never)).toThrow('missing required fields');
  });

  it('eventsOf() filters by definition or emitter', () => {
    const t = createTestChronicle(events);
    t.chronicle.admin.login({ userId: 'a', success: true });
    t.chronicle.admin.heartbeat();
    t.chronicle.admin.login({ userId: 'b', success: false });

    expect(t.eventsOf(events.admin.login).map((e) => e.payload.fields.userId)).toEqual(['a', 'b']);
    expect(t.eventsOf(t.chronicle.admin.heartbeat)).toHaveLength(1);
    expect(t.eventsOf(events.http.request.events.received)).toEqual([]);
  });

  it('eventsOf() finds correlation events and lifecycle events by key', () => {
    const t = createTestChronicle(events);
    t.chronicle.http.request.run((req) => {
      req.received({ path: '/x' });
      req.complete();
    });
    expect(t.eventsOf(events.http.request.events.received)).toHaveLength(1);
    expect(t.eventsOf({ key: 'http.request.complete' })).toHaveLength(1);
  });

  it('assertEmitted() without fields returns the first matching event', () => {
    const t = createTestChronicle(events);
    t.chronicle.admin.login({ userId: 'a', success: true });
    t.chronicle.admin.login({ userId: 'b', success: true });
    const found = t.assertEmitted(events.admin.login);
    expect(found.payload.fields.userId).toBe('a');
    expect(t.assertEmitted(t.chronicle.admin.login)).toBe(found);
  });

  it('assertEmitted() with fields matches a subset', () => {
    const t = createTestChronicle(events);
    t.chronicle.admin.login({ userId: 'a', success: true });
    t.chronicle.admin.login({ userId: 'b', success: false });
    expect(t.assertEmitted(events.admin.login, { userId: 'b' }).payload.fields.success).toBe(false);
    expect(t.assertEmitted(events.admin.login, { userId: 'a', success: true })).toBeDefined();
  });

  it('assertEmitted() compares values with Object.is', () => {
    const t = createTestChronicle(events);
    t.chronicle.admin.login({ userId: '1', success: true });
    expect(() => t.assertEmitted(events.admin.login, { userId: 1 })).toThrow();
  });

  it('assertEmitted() throws a descriptive error listing what was emitted', () => {
    const t = createTestChronicle(events);
    t.chronicle.admin.login({ userId: 'a', success: true });
    t.chronicle.admin.heartbeat();

    expect(() => t.assertEmitted(events.admin.login, { userId: 'z' })).toThrow(
      'Expected "admin.login" to be emitted with {"userId":"z"}.\n' +
        'Emitted:\n' +
        '  admin.login {"userId":"a","success":true}\n' +
        '  admin.heartbeat {}',
    );
  });

  it('assertEmitted() says when nothing was emitted', () => {
    const t = createTestChronicle(events);
    expect(() => t.assertEmitted(events.admin.heartbeat)).toThrow(
      'Expected "admin.heartbeat" to be emitted.\nNothing was emitted.',
    );
  });

  it('assertEmitted() throws a plain Error', () => {
    const t = createTestChronicle(events);
    try {
      t.assertEmitted(events.admin.heartbeat);
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe('Error');
    }
  });

  it('clear() forgets everything emitted so far', () => {
    const t = createTestChronicle(events);
    t.chronicle.admin.heartbeat();
    const emitted = t.emitted;
    t.clear();
    expect(t.emitted).toHaveLength(0);
    expect(emitted).toBe(t.emitted);
    expect(() => t.assertEmitted(events.admin.heartbeat)).toThrow('Nothing was emitted.');
    t.chronicle.admin.heartbeat();
    expect(t.eventsOf(events.admin.heartbeat)).toHaveLength(1);
  });

  it('keeps separate test chronicles isolated', () => {
    const a = createTestChronicle(events);
    const b = createTestChronicle(events);
    a.chronicle.admin.heartbeat();
    expect(b.emitted).toHaveLength(0);
  });
});

describe('captureEvents', () => {
  const makeApp = () => {
    const sent: string[] = [];
    let created = 0;
    const app = createChronicle({
      events,
      backend: () => {
        created++;
        const send = (_message: string, payload: { eventKey: string }) => {
          sent.push(payload.eventKey);
        };
        return {
          fatal: send,
          critical: send,
          alert: send,
          error: send,
          warn: send,
          audit: send,
          info: send,
          debug: send,
          trace: send,
        };
      },
    });
    return { app, sent, created: () => created };
  };

  it('records events of an existing chronicle instead of sending them', () => {
    const { app, sent, created } = makeApp();
    const { admin } = app;
    const capture = captureEvents(app);
    admin.login({ userId: 'u1', success: true });
    capture.assertEmitted(events.admin.login, { userId: 'u1' });
    expect(sent).toEqual([]);
    expect(created()).toBe(0);
    capture.restore();
  });

  it('covers forks and correlations of the chronicle', async () => {
    const { app } = makeApp();
    const capture = captureEvents(app);
    app.fork({ step: 'a' }).admin.heartbeat();
    await app.http.request.run(async (req) => {
      await Promise.resolve();
      req.received({ path: '/' });
      app.admin.heartbeat();
      req.complete();
    });
    expect(capture.emitted.map((e) => e.payload.eventKey)).toEqual([
      'admin.heartbeat',
      'http.request.start',
      'http.request.received',
      'admin.heartbeat',
      'http.request.complete',
    ]);
    capture.restore();
  });

  it('restore() sends events to the real backend again, and is idempotent', () => {
    const { app, sent } = makeApp();
    const capture = captureEvents(app);
    app.admin.heartbeat();
    capture.restore();
    capture.restore();
    app.admin.heartbeat();
    expect(capture.emitted).toHaveLength(1);
    expect(sent).toEqual(['admin.heartbeat']);
  });

  it('nested captures restore the outer capture', () => {
    const { app } = makeApp();
    const outer = captureEvents(app);
    const inner = captureEvents(app);
    app.admin.heartbeat();
    inner.restore();
    app.admin.heartbeat();
    expect(inner.emitted).toHaveLength(1);
    expect(outer.emitted).toHaveLength(1);
    outer.restore();
  });

  it('throws a TypeError for objects that are not chronicles', () => {
    expect(() => captureEvents({})).toThrow(TypeError);
  });
});
