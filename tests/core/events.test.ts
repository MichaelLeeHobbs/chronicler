import { describe, expect, it } from 'vitest';

import { DEFAULT_CORRELATION_TIMEOUT_MS } from '../../src/core/constants';
import { ChroniclerError } from '../../src/core/errors';
import {
  type CatalogEntry,
  correlation,
  CORRELATION_KIND,
  defineEvents,
  event,
  EVENT_KIND,
  group,
  isCatalog,
  isCorrelationDefinition,
  isEventDefinition,
  isMountedCatalog,
  lifecycleEvents,
  namespaceDoc,
  RESERVED_CATALOG_NAMES,
  walkCatalog,
} from '../../src/core/events';
import { field } from '../../src/core/fields';

/** Run `fn`, expect it to throw an INVALID_CATALOG ChroniclerError, and return the message. */
const catalogError = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(ChroniclerError);
    expect((err as ChroniclerError).code).toBe('INVALID_CATALOG');
    return (err as ChroniclerError).message;
  }
  throw new Error('expected an INVALID_CATALOG error');
};

/** Bypass compile-time catalog checks to exercise runtime validation. */
const defineUnchecked = (catalog: object): object =>
  (defineEvents as (c: object) => object)(catalog);

const ping = () => event({ level: 'info', message: 'ping' });

describe('event()', () => {
  it('creates an event definition with an empty key until placed in a catalog', () => {
    const def = event({
      level: 'info',
      message: 'started',
      doc: 'doc',
      fields: { port: field.number(), mode: field.string().optional() },
    });

    expect(def.kind).toBe(EVENT_KIND);
    expect(def.key).toBe('');
    expect(def.level).toBe('info');
    expect(def.message).toBe('started');
    expect(def.doc).toBe('doc');
    expect(def.fields.port._required).toBe(true);
    expect(def.fields.mode._required).toBe(false);
    expect(def).not.toHaveProperty('keyOverride');
  });

  it('defaults fields to an empty object and omits doc when not given', () => {
    const def = event({ level: 'debug', message: 'tick' });
    expect(def.fields).toEqual({});
    expect(def).not.toHaveProperty('doc');
  });

  it('stores the key option as keyOverride', () => {
    const def = event({ level: 'info', message: 'x', key: 'legacy.name' });
    expect(def.keyOverride).toBe('legacy.name');
    expect(def.key).toBe('');
  });
});

describe('correlation()', () => {
  it('creates a correlation definition with the default timeout', () => {
    const def = correlation({ events: { step: ping() } });
    expect(def.kind).toBe(CORRELATION_KIND);
    expect(def.timeout).toBe(DEFAULT_CORRELATION_TIMEOUT_MS);
    expect(def.key).toBe('');
    expect(def).not.toHaveProperty('doc');
    expect(def).not.toHaveProperty('keyOverride');
  });

  it('keeps timeout, doc and key options', () => {
    const def = correlation({ doc: 'd', timeout: 0, key: 'legacy.flow', events: {} });
    expect(def.timeout).toBe(0);
    expect(def.doc).toBe('d');
    expect(def.keyOverride).toBe('legacy.flow');
  });
});

describe('type guards', () => {
  it('discriminates events, correlations and catalogs', () => {
    const ev = ping();
    const corr = correlation({ events: {} });
    const catalog = defineEvents({ a: ping() });

    expect(isEventDefinition(ev)).toBe(true);
    expect(isEventDefinition(corr)).toBe(false);
    expect(isCorrelationDefinition(corr)).toBe(true);
    expect(isCorrelationDefinition(ev)).toBe(false);
    expect(isCatalog(catalog)).toBe(true);
    expect(isCatalog({ a: ev })).toBe(false);

    for (const value of [null, undefined, 'x', 1, {}]) {
      expect(isEventDefinition(value)).toBe(false);
      expect(isCorrelationDefinition(value)).toBe(false);
      expect(isCatalog(value)).toBe(false);
      expect(isMountedCatalog(value)).toBe(false);
    }
  });

  it('recognises definitions from another copy of the package by their string kind', () => {
    expect(isEventDefinition({ kind: 'chronicler:event' })).toBe(true);
    expect(isCorrelationDefinition({ kind: 'chronicler:correlation' })).toBe(true);
  });

  it('does not enumerate the catalog marker', () => {
    const catalog = defineEvents({ a: ping() });
    expect(Object.keys(catalog)).toEqual(['a']);
  });
});

describe('group()', () => {
  it('attaches a non-enumerable doc and returns the same object', () => {
    const children = { a: ping() };
    const grouped = group({ doc: 'Admin events' }, children);
    expect(grouped).toBe(children);
    expect(namespaceDoc(grouped)).toBe('Admin events');
    expect(Object.keys(grouped)).toEqual(['a']);
  });

  it('preserves the doc through defineEvents', () => {
    const events = defineEvents({ admin: group({ doc: 'Admin' }, { login: ping() }) });
    expect(namespaceDoc(events.admin)).toBe('Admin');
    expect(namespaceDoc(events)).toBeUndefined();
  });
});

describe('defineEvents() key derivation', () => {
  it('stamps path-derived keys onto events at every depth', () => {
    const events = defineEvents({
      top: ping(),
      admin: { login: ping(), deep: { nested: { leaf: ping() } } },
    });

    expect(events.top.key).toBe('top');
    expect(events.admin.login.key).toBe('admin.login');
    expect(events.admin.deep.nested.leaf.key).toBe('admin.deep.nested.leaf');
  });

  it('stamps keys onto correlations and their events', () => {
    const events = defineEvents({
      http: { request: correlation({ events: { started: ping(), sub: { step: ping() } } }) },
    });

    expect(events.http.request.key).toBe('http.request');
    expect(events.http.request.events.started.key).toBe('http.request.started');
    expect(events.http.request.events.sub.step.key).toBe('http.request.sub.step');
  });

  it('uses the key override instead of the path', () => {
    const events = defineEvents({
      admin: { login: event({ level: 'info', message: 'x', key: 'auth.signIn' }) },
    });
    expect(events.admin.login.key).toBe('auth.signIn');
  });

  it('derives correlation event keys from the overridden correlation key', () => {
    const events = defineEvents({
      http: { request: correlation({ key: 'web.req', events: { started: ping() } }) },
    });
    expect(events.http.request.key).toBe('web.req');
    expect(events.http.request.events.started.key).toBe('web.req.started');
  });

  it('copies definitions instead of mutating the originals', () => {
    const login = ping();
    const events = defineEvents({ admin: { login } });
    expect(login.key).toBe('');
    expect(events.admin.login).not.toBe(login);
    expect(events.admin.login.key).toBe('admin.login');
  });

  it('lets the same definition appear at two paths with two keys', () => {
    const shared = ping();
    const events = defineEvents({ a: { x: shared }, b: { x: shared } });
    expect(events.a.x.key).toBe('a.x');
    expect(events.b.x.key).toBe('b.x');
  });
});

describe('catalog composition', () => {
  it('re-derives keys when one catalog is mounted inside another', () => {
    const admin = defineEvents({ login: ping(), flow: correlation({ events: { step: ping() } }) });
    expect(admin.login.key).toBe('login');

    const events = defineEvents({ admin });

    expect(events.admin.login.key).toBe('admin.login');
    expect(events.admin.flow.key).toBe('admin.flow');
    expect(events.admin.flow.events.step.key).toBe('admin.flow.step');
    // the inner catalog keeps its own keys
    expect(admin.login.key).toBe('login');
  });

  it('marks the inner catalog as mounted but not the outer one', () => {
    const inner = defineEvents({ login: ping() });
    expect(isMountedCatalog(inner)).toBe(false);
    const outer = defineEvents({ admin: inner });
    expect(isMountedCatalog(inner)).toBe(true);
    expect(isMountedCatalog(outer)).toBe(false);
    expect(isCatalog(outer)).toBe(true);
  });

  it('keeps key overrides inside a mounted catalog', () => {
    const inner = defineEvents({ login: event({ level: 'info', message: 'x', key: 'auth.in' }) });
    const outer = defineEvents({ admin: inner });
    expect(outer.admin.login.key).toBe('auth.in');
  });

  it('accepts a catalog redefined at the root without changing keys', () => {
    const events = defineEvents({ admin: { login: ping() } });
    const again = defineEvents(events);
    expect(again.admin.login.key).toBe('admin.login');
    expect(isMountedCatalog(events)).toBe(false);
  });

  it('can mount a catalog at a deeper path', () => {
    const inner = defineEvents({ login: ping() });
    const outer = defineEvents({ services: { auth: inner } });
    expect(outer.services.auth.login.key).toBe('services.auth.login');
  });
});

describe('defineEvents() INVALID_CATALOG errors', () => {
  it('rejects an undefined entry with a circular-import hint', () => {
    const message = catalogError(() => defineUnchecked({ admin: { login: undefined } }));
    expect(message).toContain('"admin.login" is undefined');
    expect(message).toContain('circular import');
  });

  it('rejects null and primitive entries', () => {
    expect(catalogError(() => defineUnchecked({ a: null }))).toContain('"a" is not an object');
    expect(catalogError(() => defineUnchecked({ a: 42 }))).toContain('"a" is not an object');
    expect(catalogError(() => defineUnchecked({ a: 'str' }))).toContain('not an object');
  });

  it.each(RESERVED_CATALOG_NAMES)('rejects the reserved name "%s" at the root', (name) => {
    const message = catalogError(() => defineUnchecked({ [name]: ping() }));
    expect(message).toContain(`reserved name "${name}"`);
  });

  it.each(RESERVED_CATALOG_NAMES)('rejects the reserved name "%s" in a namespace', (name) => {
    const message = catalogError(() => defineUnchecked({ admin: { deep: { [name]: ping() } } }));
    expect(message).toContain(`"admin.deep.${name}"`);
  });

  it.each(RESERVED_CATALOG_NAMES)('rejects the reserved name "%s" in a correlation', (name) => {
    const message = catalogError(() =>
      defineUnchecked({
        http: { request: correlation({ events: { [name]: ping() } as never }) },
      }),
    );
    expect(message).toContain(`"http.request.${name}"`);
  });

  it('rejects a reserved name used as a namespace', () => {
    expect(catalogError(() => defineUnchecked({ run: { a: ping() } }))).toContain('reserved');
  });

  it('rejects a reserved name nested in a namespace inside a correlation', () => {
    const message = catalogError(() =>
      defineUnchecked({
        job: correlation({ events: { phase: { then: ping() } } as never }),
      }),
    );
    expect(message).toContain('"job.phase.then"');
  });

  it.each(['Login', 'user-login', 'user_login', '1st', 'user login', ''])(
    'rejects the non-camelCase name "%s"',
    (name) => {
      expect(catalogError(() => defineUnchecked({ admin: { [name]: ping() } }))).toContain(
        'invalid name',
      );
    },
  );

  it('rejects an invalid level', () => {
    const bad = { ...ping(), level: 'verbose' };
    const message = catalogError(() => defineUnchecked({ admin: { x: bad } }));
    expect(message).toContain('invalid level "verbose"');
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the timeout %s', (timeout) => {
    const message = catalogError(() =>
      defineUnchecked({ job: correlation({ timeout, events: {} }) }),
    );
    expect(message).toContain('invalid timeout');
  });

  it('accepts a timeout of 0', () => {
    expect(() => defineEvents({ job: correlation({ timeout: 0, events: {} }) })).not.toThrow();
  });

  it('rejects a correlation directly inside a correlation', () => {
    const inner = correlation({ events: {} });
    const message = catalogError(() =>
      defineUnchecked({ outer: correlation({ events: { inner } as never }) }),
    );
    expect(message).toContain('inside correlation "outer"');
  });

  it('rejects a correlation in a namespace inside a correlation', () => {
    const inner = correlation({ events: {} });
    const message = catalogError(() =>
      defineUnchecked({ outer: correlation({ events: { phase: { inner } } as never }) }),
    );
    expect(message).toContain('"outer.phase.inner"');
  });

  it('rejects duplicate keys created by a key override', () => {
    const message = catalogError(() =>
      defineEvents({
        admin: { login: ping() },
        auth: { signIn: event({ level: 'info', message: 'x', key: 'admin.login' }) },
      }),
    );
    expect(message).toContain('Duplicate event key "admin.login"');
    expect(message).toContain('"auth.signIn"');
    expect(message).toContain('"admin.login"');
  });

  it('rejects a key override that collides with a lifecycle event', () => {
    const message = catalogError(() =>
      defineEvents({
        job: correlation({ events: {} }),
        other: event({ level: 'info', message: 'x', key: 'job.start' }),
      }),
    );
    expect(message).toContain('Duplicate event key "job.start"');
  });

  it('rejects duplicate correlation keys through their lifecycle events', () => {
    const message = catalogError(() =>
      defineEvents({
        a: correlation({ key: 'shared', events: {} }),
        b: correlation({ key: 'shared', events: {} }),
      }),
    );
    expect(message).toContain('Duplicate event key "shared.start"');
  });

  it('rejects malformed key overrides', () => {
    for (const key of ['Bad', 'a..b', 'a.B', 'a-b', '.a', 'a.']) {
      expect(
        catalogError(() => defineEvents({ x: event({ level: 'info', message: 'x', key }) })),
      ).toContain('Invalid event key');
    }
    expect(
      catalogError(() => defineEvents({ x: correlation({ key: 'Nope', events: {} }) })),
    ).toContain('Invalid event key');
  });

  it('rejects keys longer than 256 characters', () => {
    const key = `a${'b'.repeat(256)}`;
    const message = catalogError(() =>
      defineEvents({ x: event({ level: 'info', message: 'x', key }) }),
    );
    expect(message).toContain('maximum length of 256');
  });

  it('also validates catalogs given straight to walkCatalog', () => {
    expect(() => walkCatalog({ fork: ping() })).toThrow(ChroniclerError);
  });
});

describe('walkCatalog()', () => {
  const events = defineEvents({
    admin: group({ doc: 'Admin events' }, { login: ping() }),
    http: {
      request: correlation({
        doc: 'HTTP request',
        events: { started: ping(), phase: { parsed: ping() } },
      }),
    },
  });

  const summarise = (entries: CatalogEntry[]) =>
    entries.map((e) =>
      e.kind === 'event'
        ? `${e.kind}:${e.key}${e.lifecycle ? ':life' : ''}${e.correlationKey ? `@${e.correlationKey}` : ''}`
        : `${e.kind}:${e.key}`,
    );

  it('lists namespaces, correlations, lifecycle events and events in order', () => {
    expect(summarise(walkCatalog(events))).toEqual([
      'namespace:admin',
      'event:admin.login',
      'namespace:http',
      'correlation:http.request',
      'event:http.request.start:life@http.request',
      'event:http.request.complete:life@http.request',
      'event:http.request.fail:life@http.request',
      'event:http.request.timeout:life@http.request',
      'event:http.request.started@http.request',
      'namespace:http.request.phase',
      'event:http.request.phase.parsed@http.request',
    ]);
  });

  it('reports namespace docs and correlation keys of namespaces', () => {
    const entries = walkCatalog(events);
    const admin = entries.find((e) => e.kind === 'namespace' && e.key === 'admin');
    expect(admin).toMatchObject({ doc: 'Admin events', path: 'admin' });
    expect(admin).not.toHaveProperty('correlationKey');
    const phase = entries.find((e) => e.kind === 'namespace' && e.key === 'http.request.phase');
    expect(phase).toMatchObject({ correlationKey: 'http.request' });
    expect(phase).not.toHaveProperty('doc');
  });

  it('resolves keys from a plain object and returns definitions with keys set', () => {
    const entries = walkCatalog({ a: { b: ping() } });
    const entry = entries.find((e) => e.kind === 'event');
    expect(entry?.kind === 'event' && entry.definition.key).toBe('a.b');
    expect(entry).toMatchObject({ path: 'a.b', lifecycle: false });
    expect(entry).not.toHaveProperty('correlationKey');
  });

  it('distinguishes key from path when a key override is used', () => {
    const entries = walkCatalog({
      a: { b: event({ level: 'info', message: 'x', key: 'legacy.b' }) },
      flow: correlation({ key: 'legacy.flow', events: { s: ping() } }),
    });
    const ev = entries.find((e) => e.kind === 'event' && e.path === 'a.b');
    expect(ev?.key).toBe('legacy.b');
    const corr = entries.find((e) => e.kind === 'correlation');
    expect(corr).toMatchObject({ key: 'legacy.flow', path: 'flow' });
    const step = entries.find((e) => e.kind === 'event' && e.path === 'flow.s');
    expect(step?.key).toBe('legacy.flow.s');
  });
});

describe('lifecycleEvents()', () => {
  it('builds start, complete, fail and timeout with levels and fields', () => {
    const life = lifecycleEvents('api.request');
    expect(life.start).toMatchObject({ key: 'api.request.start', level: 'info', fields: {} });
    expect(life.complete).toMatchObject({ key: 'api.request.complete', level: 'info' });
    expect(life.fail).toMatchObject({ key: 'api.request.fail', level: 'error' });
    expect(life.timeout).toMatchObject({ key: 'api.request.timeout', level: 'warn', fields: {} });
    expect(life.complete.fields.duration?._required).toBe(false);
    expect(life.fail.fields.error?._type).toBe('error');
    expect(life.fail.fields.error?._required).toBe(false);
  });

  it('adds fields declared with correlation({ complete, fail })', () => {
    const life = lifecycleEvents('api.request', {
      completeFields: { status: field.number() },
      failFields: { reason: field.string().optional() },
    });
    expect(Object.keys(life.complete.fields)).toEqual(['status', 'duration']);
    expect(Object.keys(life.fail.fields)).toEqual(['reason', 'duration', 'error']);
  });

  it('rejects lifecycle fields that redefine duration or error', () => {
    const bad = correlation({ events: {} }) as unknown as Record<string, unknown>;
    expect(() =>
      defineEvents({ a: { ...bad, failFields: { error: field.string() } } } as never),
    ).toThrow(/redefines built-in lifecycle field\(s\): error/);
  });
});
