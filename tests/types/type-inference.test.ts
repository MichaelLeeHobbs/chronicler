import { describe, expectTypeOf, it } from 'vitest';

import {
  type Chronicle,
  correlation,
  type CorrelationFork,
  type CorrelationHandle,
  type CorrelationStarter,
  createChronicle,
  defineEvents,
  type Emitter,
  type EmitterArgs,
  event,
  type EventDefinition,
  field,
  type FieldsOf,
  group,
  type HandleOf,
  type InferFields,
  type NoFields,
} from '../../src';
import { createTestChronicle } from '../../src/testing';
import { MockLoggerBackend } from '../helpers/mock-logger';

const events = defineEvents({
  admin: group(
    { doc: 'Admin' },
    {
      login: event({
        level: 'audit',
        message: 'User login attempt',
        fields: {
          userId: field.string(),
          success: field.boolean(),
          ip: field.string().optional(),
          error: field.error().optional(),
          attempts: field.number().optional(),
        },
      }),
      heartbeat: event({ level: 'debug', message: 'tick' }),
      note: event({ level: 'info', message: 'note', fields: { text: field.string().optional() } }),
    },
  ),
  http: {
    request: correlation({
      timeout: 1000,
      complete: { status: field.number().optional() },
      fail: { status: field.number().optional() },
      events: {
        received: event({ level: 'info', message: 'received', fields: { path: field.string() } }),
        ping: event({ level: 'debug', message: 'ping' }),
      },
    }),
  },
});

const chronicle = createChronicle({ events, backend: new MockLoggerBackend().backend });

// Type tests run their assertions at compile time; the bodies are wrapped so nothing is logged.
const typeOnly = (fn: () => void): void => {
  void fn;
};

describe('Type Inference Tests', () => {
  describe('field inference', () => {
    it('infers required and optional field types', () => {
      type Login = FieldsOf<typeof events.admin.login>;
      type Expected = {
        userId: string;
        success: boolean;
        ip?: string;
        error?: Error | string;
        attempts?: number;
      };
      // mutual extension: catches wrong types and wrong optionality
      expectTypeOf<Login>().toExtend<Expected>();
      expectTypeOf<Expected>().toExtend<Login>();
      expectTypeOf<Login['userId']>().toEqualTypeOf<string>();
      expectTypeOf<Login['error']>().toEqualTypeOf<Error | string | undefined>();
      expectTypeOf<{ userId: string; success: boolean }>().toExtend<Login>();
      expectTypeOf<{ userId: string }>().not.toExtend<Login>();
    });

    it('infers fields without `as const`', () => {
      const fields = { id: field.string(), count: field.number().optional() };
      const def = event({ level: 'info', message: 'x', fields });
      expectTypeOf(def.fields).toEqualTypeOf(fields);
      type Inferred = InferFields<typeof def.fields>;
      expectTypeOf<Inferred>().toExtend<{ id: string; count?: number }>();
      expectTypeOf<{ id: string; count?: number }>().toExtend<Inferred>();
      expectTypeOf<{ id: string }>().toExtend<Inferred>();
      expectTypeOf<{ count: number }>().not.toExtend<Inferred>();
    });

    it('gives events without fields NoFields', () => {
      const def = event({ level: 'info', message: 'x' });
      expectTypeOf(def).toEqualTypeOf<EventDefinition<NoFields>>();
      expectTypeOf<FieldsOf<typeof def>>().toEqualTypeOf<Record<never, never>>();
    });

    it('keeps the level as a LogLevel and doc optional', () => {
      const def = event({ level: 'warn', message: 'x' });
      expectTypeOf(def.level).toEqualTypeOf<
        'fatal' | 'critical' | 'alert' | 'error' | 'warn' | 'audit' | 'info' | 'debug' | 'trace'
      >();
      expectTypeOf(def.doc).toEqualTypeOf<string | undefined>();
      // @ts-expect-error -- not a log level
      event({ level: 'verbose', message: 'x' });
    });

    it('rejects non-builder field definitions', () => {
      // @ts-expect-error -- fields must be field builders
      event({ level: 'info', message: 'x', fields: { id: 'string' } });
    });
  });

  describe('catalog shape', () => {
    it('preserves the catalog structure and exposes keys', () => {
      expectTypeOf(events.admin.login.key).toEqualTypeOf<string>();
      expectTypeOf(events.http.request.events.received.fields.path._type).toEqualTypeOf<'string'>();
      expectTypeOf(events.http.request.timeout).toEqualTypeOf<number>();
    });

    it('rejects reserved names at any level', () => {
      typeOnly(() => {
        // @ts-expect-error -- reserved at the root
        defineEvents({ fork: event({ level: 'info', message: 'x' }) });
        // @ts-expect-error -- reserved in a namespace
        defineEvents({ admin: { run: event({ level: 'info', message: 'x' }) } });
        // @ts-expect-error -- reserved as a namespace name
        defineEvents({ log: { a: event({ level: 'info', message: 'x' }) } });
        // @ts-expect-error -- reserved in a deeper namespace
        defineEvents({ a: { b: { then: event({ level: 'info', message: 'x' }) } } });
        // @ts-expect-error -- reserved inside a correlation
        correlation({ events: { complete: event({ level: 'info', message: 'x' }) } });
        // @ts-expect-error -- reserved in a namespace inside a correlation
        correlation({ events: { phase: { begin: event({ level: 'info', message: 'x' }) } } });
        // @ts-expect-error -- reserved at the root of createChronicle
        createChronicle({ events: { addContext: event({ level: 'info', message: 'x' }) } });
      });
    });

    it('rejects a correlation nested in a correlation', () => {
      const inner = correlation({ events: {} });
      // @ts-expect-error -- correlation directly inside a correlation
      correlation({ events: { inner } });
      // @ts-expect-error -- correlation in a namespace inside a correlation
      correlation({ events: { phase: { inner } } });
    });

    it('rejects functions and primitives as catalog entries', () => {
      typeOnly(() => {
        // @ts-expect-error -- function entry
        defineEvents({ a: () => undefined });
        // @ts-expect-error -- primitive entry
        defineEvents({ a: 'x' });
      });
    });

    it('accepts a mounted catalog', () => {
      const inner = defineEvents({ login: event({ level: 'info', message: 'x' }) });
      const outer = defineEvents({ admin: inner });
      expectTypeOf(outer.admin.login).toEqualTypeOf<EventDefinition<NoFields>>();
    });
  });

  describe('emitters', () => {
    it('types the emitter tree from the catalog', () => {
      expectTypeOf(chronicle.admin.login).toEqualTypeOf<
        Emitter<(typeof events)['admin']['login']['fields']>
      >();
      expectTypeOf(chronicle.admin.login.key).toEqualTypeOf<string>();
      expectTypeOf(chronicle.http.request).toEqualTypeOf<
        CorrelationStarter<
          (typeof events)['http']['request']['events'],
          (typeof events)['http']['request']['completeFields'],
          (typeof events)['http']['request']['failFields']
        >
      >();
      expectTypeOf(chronicle.http.request.key).toEqualTypeOf<string>();
      expectTypeOf(chronicle).toEqualTypeOf<Chronicle<typeof events>>();
      expectTypeOf(chronicle.admin.login).returns.toEqualTypeOf<void>();
    });

    it('requires required fields, with correct types', () => {
      typeOnly(() => {
        chronicle.admin.login({ userId: 'u', success: true });
        chronicle.admin.login({ userId: 'u', success: true, ip: '1.1.1.1', error: new Error() });
        // @ts-expect-error -- missing success
        chronicle.admin.login({ userId: 'u' });
        // @ts-expect-error -- missing argument
        chronicle.admin.login();
        // @ts-expect-error -- wrong type
        chronicle.admin.login({ userId: 1, success: true });
        // @ts-expect-error -- wrong optional type
        chronicle.admin.login({ userId: 'u', success: true, attempts: '3' });
        // @ts-expect-error -- extra field
        chronicle.admin.login({ userId: 'u', success: true, extra: 1 });
      });
    });

    it('allows no-arg calls for events without required fields', () => {
      typeOnly(() => {
        chronicle.admin.heartbeat();
        chronicle.admin.heartbeat({});
        chronicle.admin.note();
        chronicle.admin.note({ text: 'x' });
        // @ts-expect-error -- events without fields reject extra keys
        chronicle.admin.heartbeat({ x: 1 });
        // @ts-expect-error -- wrong optional type
        chronicle.admin.note({ text: 1 });
      });
      expectTypeOf<EmitterArgs<NoFields>>().toEqualTypeOf<[fields?: Record<string, never>]>();
      type NoteArgs = EmitterArgs<(typeof events)['admin']['note']['fields']>;
      expectTypeOf<NoteArgs>().toExtend<[fields?: { text?: string }]>();
      expectTypeOf<[fields?: { text?: string }]>().toExtend<NoteArgs>();
      expectTypeOf<[]>().toExtend<NoteArgs>();
      type LoginArgs = EmitterArgs<(typeof events)['admin']['login']['fields']>;
      expectTypeOf<[]>().not.toExtend<LoginArgs>();
    });

    it('types destructured emitters the same as dotted ones', () => {
      const { admin } = chronicle;
      const { login } = admin;
      expectTypeOf(login).toEqualTypeOf(chronicle.admin.login);
      typeOnly(() => {
        // @ts-expect-error -- missing userId
        login({ success: true });
      });
    });

    it('does not expose unknown events', () => {
      // @ts-expect-error -- not in the catalog
      void chronicle.admin.logout;
      // @ts-expect-error -- `then` is never present
      void chronicle.then;
    });

    it('types scope methods', () => {
      expectTypeOf(chronicle.fork({})).toEqualTypeOf<Chronicle<typeof events>>();
      expectTypeOf(chronicle.run(() => 42)).toEqualTypeOf<number>();
      expectTypeOf(chronicle.run(() => Promise.resolve('x'))).toEqualTypeOf<Promise<string>>();
      typeOnly(() => {
        chronicle.log('info', 'msg', { any: { nested: true } });
        // @ts-expect-error -- invalid level
        chronicle.log('verbose', 'msg');
        // @ts-expect-error -- context values must be primitives
        chronicle.addContext({ nested: { a: 1 } });
        // @ts-expect-error -- context values must be primitives
        chronicle.fork({ list: [1] });
      });
    });
  });

  describe('correlations', () => {
    type Request = HandleOf<typeof chronicle.http.request>;
    type RequestEvents = (typeof events)['http']['request']['events'];
    type RequestDef = (typeof events)['http']['request'];

    it('HandleOf gives the correlation handle', () => {
      expectTypeOf<Request>().toEqualTypeOf<
        CorrelationHandle<RequestEvents, RequestDef['completeFields'], RequestDef['failFields']>
      >();
      expectTypeOf(chronicle.http.request.begin()).toEqualTypeOf<Request>();
      expectTypeOf<HandleOf<typeof chronicle.admin.login>>().toBeNever();
    });

    it('types handle events, ids and lifecycle', () => {
      typeOnly(() => {
        const req = chronicle.http.request.begin({ requestId: 'r' });
        req.received({ path: '/' });
        req.ping();
        expectTypeOf(req.correlationId).toEqualTypeOf<string>();
        req.complete();
        req.complete({ status: 200 });
        req.fail(new Error('x'), { status: 500 });
        req.fail();
        // @ts-expect-error -- undeclared complete() field
        req.complete({ nope: 1 });
        // @ts-expect-error -- wrong type for a declared field
        req.complete({ status: '200' });
        // @ts-expect-error -- missing path
        req.received({});
        // @ts-expect-error -- root events are not on the handle
        void req.admin;
      });
    });

    it('types correlation forks without lifecycle methods', () => {
      typeOnly(() => {
        const fork = chronicle.http.request.begin().fork();
        expectTypeOf(fork).toEqualTypeOf<CorrelationFork<RequestEvents>>();
        fork.received({ path: '/' });
        expectTypeOf(fork.correlationId).toEqualTypeOf<string>();
        // @ts-expect-error -- forks cannot complete the correlation
        void fork.complete;
        // @ts-expect-error -- forks cannot fail the correlation
        void fork.fail;
        expectTypeOf(fork.fork()).toEqualTypeOf<CorrelationFork<RequestEvents>>();
      });
    });

    it('types run() with and without context', () => {
      typeOnly(() => {
        const n = chronicle.http.request.run((req) => {
          expectTypeOf(req).toEqualTypeOf<Request>();
          return 1;
        });
        expectTypeOf(n).toEqualTypeOf<number>();
        const p = chronicle.http.request.run({ requestId: 'r' }, () => Promise.resolve('done'));
        expectTypeOf(p).toEqualTypeOf<Promise<string>>();
        // @ts-expect-error -- context values must be primitives
        chronicle.http.request.run({ bad: {} }, () => 1);
      });
    });
  });

  describe('FieldsOf', () => {
    it('works on definitions and emitters', () => {
      expectTypeOf<FieldsOf<typeof chronicle.http.request.begin>>().toBeNever();
      type Received = FieldsOf<typeof events.http.request.events.received>;
      expectTypeOf<Received>().toExtend<{ path: string }>();
      expectTypeOf<{ path: string }>().toExtend<Received>();
      expectTypeOf<FieldsOf<typeof chronicle.admin.login>>().toEqualTypeOf<
        FieldsOf<typeof events.admin.login>
      >();
    });
  });

  describe('createTestChronicle', () => {
    it('returns a typed chronicle', () => {
      const t = createTestChronicle(events);
      expectTypeOf(t.chronicle).toEqualTypeOf<Chronicle<typeof events>>();
      typeOnly(() => {
        t.assertEmitted(events.admin.login, { userId: 'u' });
        t.eventsOf(t.chronicle.admin.login);
        // @ts-expect-error -- needs something with a key
        t.eventsOf('admin.login');
      });
      typeOnly(() => {
        // @ts-expect-error -- reserved names are rejected here too
        createTestChronicle({ fork: event({ level: 'info', message: 'x' }) });
      });
    });
  });
});
