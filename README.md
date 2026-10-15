# @ubercode/chronicler

Type-safe structured logging for Node.js. Define your events once, in one catalog, with levels, fields and docs. Then log them as typed function calls, with compile-time safety, runtime validation, request span and auto-generated documentation.

```
npm install @ubercode/chronicler
```

Node 20+ required. ESM + CJS with full TypeScript declarations. No runtime dependencies.

> **Upgrading from 1.x?** 2.0 is a breaking redesign of how events are defined and logged. See [Migrating from 1.x](#migrating-from-1x).

## The Problem

Most logging looks like this:

```ts
logger.info('user created', { userId: id, email });
logger.info('User Created', { user_id: id }); // different dev, different shape
logger.info('user created', { userId: id, emailAddress: email }); // another variation
```

Three devs, three formats, zero consistency. When you search your logs for user creation events, you find three different field names, two different message formats, and no way to know which fields are required. Your dashboards break, your alerts miss events, and nobody trusts the logs.

## The Solution

Define events once in a catalog, then call them like functions:

```ts
// events.ts
import { defineEvents, event, field } from '@ubercode/chronicler';

export const events = defineEvents({
  user: {
    created: event({
      level: 'info',
      message: 'User created',
      doc: 'Emitted when a new user account is created',
      fields: {
        userId: field.string().doc('Unique user identifier'),
        email: field.string().optional().doc('User email address'),
      },
    }),
  },
});
```

```ts
// logger.ts
import { createChronicle } from '@ubercode/chronicler';
import { events } from './events';

export const chronicle = createChronicle({ events, metadata: { service: 'api' } });
export const { user } = chronicle;
```

```ts
// anywhere
import { user } from './logger';

user.created({ userId: 'u-123', email: 'a@b.com' }); // OK, logs eventKey "user.created"
user.created({ user_id: 'u-123' }); // compile error: wrong field name
user.created({}); // compile error: missing required 'userId'
user.deleted({ userId: 'u-123' }); // compile error: no such event
```

The event key (`user.created`) comes from the event's path in the catalog. Every log entry has the same structure. Dashboards work. Alerts fire. New devs read the catalog to see what's logged, and the CLI turns it into documentation.

## Core Concepts

### Events and the catalog

An **event** is a single, well-defined thing that happens in your system. `event()` declares its level, message, fields and docs; `defineEvents()` collects events into a nested **catalog**:

```ts
import { defineEvents, event, field, group } from '@ubercode/chronicler';

export const events = defineEvents({
  order: {
    placed: event({
      level: 'info',
      message: 'Order placed',
      doc: 'Emitted when a customer successfully places an order',
      fields: {
        orderId: field.string().doc('Order identifier'),
        total: field.number().doc('Order total in cents'),
        itemCount: field.number().doc('Number of items'),
      },
    }),
  },
  admin: group(
    { doc: 'Administrative and compliance events' },
    {
      login: event({
        level: 'audit',
        message: 'Login attempt',
        doc: 'Emitted on every authentication attempt',
        fields: {
          userId: field.string().doc('User ID'),
          success: field.boolean().doc('Whether login succeeded'),
          ip: field.string().optional().doc('Client IP'),
        },
      }),
      heartbeat: event({ level: 'debug', message: 'Admin session heartbeat' }),
    },
  ),
});
```

This gives you:

- **Compile-time safety**: TypeScript catches missing, misspelled or mistyped fields, and calls to events that don't exist
- **Runtime validation**: problems are flagged in `_validation` metadata (or thrown in [strict mode](#strict-mode))
- **Self-documenting logs**: `doc` strings on events, fields and namespaces feed the CLI's generated docs
- **Consistent payloads**: every instance of an event has the same shape, so log aggregation is reliable

Rules for the catalog:

- **Keys come from the path.** `events.admin.login` has the key `admin.login`; `defineEvents` stamps it on the definition (`events.admin.login.key === 'admin.login'`). Names must be camelCase identifiers (`userCreated`, not `user-created`).
- **`group({ doc }, children)`** documents a namespace. It's optional; a plain object works as a namespace too.
- **`key` overrides the wire key.** Moving or renaming an event changes its key, which breaks dashboards and alerts that filter on it. Pass `key` to keep the old one:

  ```ts
  auth: {
    // Moved from admin.login; keep the key that alerts already use.
    login: event({ key: 'admin.login', level: 'audit', message: 'Login attempt' }),
  },
  ```

  The CLI's [`chronicler keys`](#cli) command keeps a lockfile of keys so an accidental rename fails CI.

- **Reserved names.** `fork`, `run`, `log`, `addContext`, `begin`, `start`, `complete`, `fail`, `timeout`, `traceId`, `spanId`, `traceparent` and `then` can't be used as names at any level, because the emitter tree and span handles use them. This is a compile error and a runtime `ChroniclerError` with code `INVALID_CATALOG`.
- **Catalogs compose.** Split a large catalog by area and mount the pieces: `defineEvents({ billing: billingEvents, auth: authEvents })`. Keys are re-derived from the outer path.
- **Keep catalog files free of logger imports.** The module that calls `createChronicle()` imports the catalog; if a catalog file imports that module back (say, to log something), the circular import hands `createChronicle()` an `undefined` entry. Chronicler throws `INVALID_CATALOG` with a hint when it sees one, but the fix is to keep `events.ts` a pure definitions module.

### Logging events

`createChronicle({ events })` returns a tree of emitter functions that mirrors the catalog:

```ts
export const chronicle = createChronicle({ events, backend, metadata: { service: 'api' } });

chronicle.admin.login({ userId: 'u-1', success: true, ip: '10.0.0.1' });

// Destructure namespaces and import them where you log:
export const { admin, order } = chronicle;

admin.login({ userId: 'u-1', success: true });
admin.heartbeat(); // events without required fields take no argument
order.placed({ orderId: 'o-1', total: 4200, itemCount: 3 });
```

Each emitter has a `key` (`admin.login.key === 'admin.login'`). For large catalogs, annotate the exported chronicle to keep generated declaration files small:

```ts
import type { Chronicle } from '@ubercode/chronicler';

export const chronicle: Chronicle<typeof events> = createChronicle({ events, backend });
```

For one-off logs without a defined event, `chronicle.log(level, message, fields?)` is an untyped escape hatch. Its payload has an empty `eventKey`.

Groups of keys also enable **router backends**: you can route all `admin.*` events to a compliance log stream and all `http.*` events to a monitoring stream, from a single chronicle.

### Spans

A **span** tracks a unit of work from start to finish. This is the feature you wish you had every time you're debugging a production issue and trying to piece together what happened during a single HTTP request across 20 log lines.

Without spans, you get this in your logs:

```
INFO  Request validated         { path: '/api/users' }
INFO  Database query complete   { table: 'users', rows: 42 }
INFO  Request validated         { path: '/api/orders' }   ← different request!
ERROR Database query failed     { table: 'orders' }       ← which request?
INFO  Response sent             { status: 200 }           ← which request??
```

With spans, every log entry for a single request shares a trace ID (`traceId`), and you get automatic lifecycle events. The ids follow the [W3C Trace Context](https://www.w3.org/TR/trace-context/) format that OpenTelemetry uses, so log tools can link these entries to your traces. Define one with `span()`:

```ts
import { defineEvents, event, field, span } from '@ubercode/chronicler';

export const events = defineEvents({
  http: {
    request: span({
      doc: 'HTTP request lifecycle',
      timeout: 30_000,
      events: {
        validated: event({
          level: 'info',
          message: 'Request validated',
          fields: { method: field.string(), path: field.string() },
        }),
      },
    }),
  },
  // ...admin, order, etc.
});
```

In the emitter tree, a span is a **starter** with `begin()` and `run()`.

#### `begin()`: an explicit handle

```ts
const request = http.request.begin({ requestId: 'req-abc' });
// Auto-emits: http.request.start

request.validated({ method: 'GET', path: '/api/users' });

request.complete();
// Auto-emits: http.request.complete { duration: 142 }
```

The handle has the span's own events (`request.validated`), its `traceId`, `spanId` and `traceparent`, `complete(fields?)`, `fail(error?, fields?)`, `fork(context?)`, `run(fn)`, `log()` and `addContext()`.

#### `run()`: an ambient span

Passing a handle to every function that logs is tedious. `run()` starts the span and makes it **ambient** (via `AsyncLocalStorage`) for everything `fn` calls, including after `await`. Any emitter on the chronicle, like `admin.login(...)`, logs inside the span without being passed anything.

An Express middleware:

```ts
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { http } from './logger';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = req.get('x-request-id') ?? randomUUID();

  // Continue the caller's trace when it sent a traceparent header.
  http.request.run({ requestId }, { traceparent: req.get('traceparent') }, (request) => {
    request.validated({ method: req.method, path: req.path });
    res.setHeader('x-trace-id', request.traceId);

    res.on('finish', () => request.complete());
    res.on('close', () => {
      if (!res.writableFinished) request.fail(new Error('Client closed the connection'));
    });

    next(); // every handler downstream runs inside the span
  });
}
```

```ts
// A controller: no request-scoped logger to thread through.
export const login = async (req: Request, res: Response) => {
  const success = await authenticate(req.body);
  admin.login({ userId: req.body.userId, success }); // carries the request's traceId and requestId
  res.json({ success });
};
```

`run()` **never completes the span on its own**: in a middleware the response is sent long after `next()` returns, so you call `complete()` when the work is really done. It **does fail** the span if `fn` throws or its returned promise rejects (the error is rethrown). For a self-contained job, that makes this pattern safe:

```ts
await jobs.nightly.run(async (job) => {
  await doTheWork();
  job.complete();
}); // a throw inside emits jobs.nightly.fail with the error
```

Now filter by `traceId` in your log aggregator and see the entire request in order. Auto-generated events give you:

| Auto-event       | When                                 | Includes            |
| ---------------- | ------------------------------------ | ------------------- |
| `{key}.start`    | `begin()` or `run()` called          | none                |
| `{key}.complete` | `complete()` called                  | `duration` (ms)     |
| `{key}.fail`     | `fail(error)` called, or `run` threw | `duration`, `error` |
| `{key}.timeout`  | No activity within `timeout`         | none                |

To log more on `.complete` or `.fail`, declare the extra fields on the span. They're typed and validated like any event's fields:

```ts
request: span({
  events: {
    /* ... */
  },
  complete: { statusCode: field.number() },
  fail: { statusCode: field.number().optional() },
}),
```

```ts
request.complete({ statusCode: 200 }); // http.request.complete { duration, statusCode }
request.fail(err, { statusCode: 502 }); // http.request.fail { duration, error, statusCode }
request.complete({ status: 200 }); // compile error: not declared
```

They can't redefine `duration` or `error`. Without declarations, `complete()` takes no fields and `fail()` takes only the error.

#### Nested spans

A span started while another is active (it's ambient, or you start it from a `chronicle.fork()` taken inside it) is **nested**. Its events carry its own `spanId`, its parent's span id as `parentSpanId`, and the trace id it shares with its parent as `traceId`:

```ts
http.request.run({ requestId }, async (request) => {
  await db.query.run(async (query) => {
    // spanId: query's id, parentSpanId: request's spanId, traceId: request's traceId
    query.executed({ table: 'users' });
    query.complete();
  });
  request.complete();
});
```

Every event logged inside a span has `traceId`; filter on it to see a whole request including nested work. Each nested span has its own lifecycle events and timeout. Spans can't be _defined_ inside spans (that's a compile and `INVALID_CATALOG` error); they nest at runtime.

#### Across services: `traceparent`

Spans speak the [W3C `traceparent`](https://www.w3.org/TR/trace-context/#traceparent-header) header, so one trace can follow a request through several services:

- **Incoming:** pass the header to `begin(context, { traceparent })` or `run(context, { traceparent }, fn)`. A top-level span then joins that trace: it takes the header's trace id, and the caller's span id becomes its `parentSpanId`. A missing (`undefined`) header is ignored. An invalid one starts a new trace and sets `_validation.invalidTraceparent` on the `.start` event. Inside another span the header is ignored, because the span is already part of a trace.
- **Outgoing:** every handle and span fork has `traceparent` (`00-<traceId>-<spanId>-01`). Send it on calls to other services.

```ts
await fetch(url, { headers: { traceparent: request.traceparent } });
```

**With OpenTelemetry:** to log under the trace OpenTelemetry already started, hand its context to the span. Chronicler stays dependency-free; you call the OpenTelemetry API:

```ts
import { context, propagation } from '@opentelemetry/api';

const carrier: Record<string, string> = {};
propagation.inject(context.active(), carrier);
http.request.run({ requestId }, { traceparent: carrier.traceparent }, (request) => {
  // traceId matches the OpenTelemetry trace; parentSpanId is the active OpenTelemetry span
});
```

Chronicler only reads and writes the header. It doesn't export spans, sample, or patch HTTP clients; that's what a tracer is for.

#### Background work: `chronicle.run(fn)`

Work started during a request but outliving it (a timer, a queue consumer, a fire-and-forget promise) inherits the request's ambient span. Once the request completes, that's wrong. Wrap it in the root chronicle's `run()`, which runs `fn` with no ambient span:

```ts
http.request.run(async (request) => {
  chronicle.run(() => {
    setInterval(() => cache.refreshed({ entries: cache.size }), 60_000); // not part of this request
  });
  request.complete();
});
```

If you forget, Chronicler catches it: an emitter whose ambient span has already completed or failed logs outside it instead, with `_validation.staleSpanId` set to the finished span's id. Search for that flag to find leaks.

#### Timeouts and `spanState`

Each span has an idle `timeout` (default 5 minutes; `0` disables it). It resets on every event logged in the span. When it fires, `{key}.timeout` is emitted and the span is **timed out**:

- Events logged to it afterwards still carry its `traceId` and `spanId`, plus `spanState: 'timedOut'`.
- A late `complete()` or `fail()` is still accepted once and reports the real `duration`.

Handles and forks of a span that has completed or failed also keep logging with its ids, marked `spanState: 'completed'` or `'failed'`. `spanState` is absent while the span is active, so `ispresent(spanState)` finds late events.

#### Limits

`limits.maxActiveSpans` (default 1000) bounds how many active spans are tracked. Starting one past the limit never throws: the span works normally but isn't counted, and its `.start` event carries `_validation.spanLimitExceeded: true`. A sustained stream of these usually means spans that are never completed.

### Forks

**Forks** handle parallel work. When a request fans out to several services, queries or steps, forks give each branch its own `forkId` while keeping the span:

```ts
await http.request.run(async (request) => {
  await Promise.all([
    chronicle.fork({ step: 'auth' }).run(() => checkAuth()), // forkId "1"
    chronicle.fork({ step: 'data' }).run(() => loadData()), // forkId "2"
  ]);
  request.complete();
});

async function loadData() {
  const cache = chronicle.fork({ step: 'cache-lookup' }); // forkId "2.1"
  cache.order.placed({ orderId: 'o-1', total: 100, itemCount: 1 });
}
```

- `chronicle.fork(ctx?)` forks the ambient scope (or the root) and returns the full emitter tree bound to the fork. Calling `fork.run(fn)` makes the fork ambient for `fn`.
- `handle.fork(ctx?)` on a span handle returns a fork with only that span's events, plus `fork`, `run`, `log` and `addContext`. It can't start other spans directly; use `fork.run(() => ...)` to make it ambient for code that does.

Every log entry carries its `forkId` (`0` for root, then `1`, `2`, `2.1`, ...), so you can reconstruct the execution tree. Nesting past `limits.maxForkDepth` (default 10) throws `FORK_DEPTH_EXCEEDED`.

### Context

**Context** is metadata attached to every event in a scope. Set it once and it flows through:

```ts
const chronicle = createChronicle({
  events,
  metadata: { service: 'api', env: 'production', version: '2.0.0' },
});
// Every event includes service, env and version in payload.metadata.
```

Child scopes start from their parent's context:

- **`fork(ctx)`, `begin(ctx)` and `run(ctx, fn)` override.** The context passed when a scope is created replaces inherited values with the same key: `chronicle.fork({ env: 'canary' })` logs `env: 'canary'`.
- **`addContext(ctx)` is first-write-wins.** Within a scope, adding a key that's already set keeps the original value and reports the collision in the returned `ContextValidationResult`, so downstream code can't accidentally overwrite upstream context.

```ts
http.request.run({ requestId }, async (request) => {
  const user = await authenticate(req);
  chronicle.addContext({ userId: user.id }); // added to this request's span only
  admin.login({ userId: user.id, success: true }); // metadata includes requestId and userId
});
```

Like emitters, `chronicle.addContext()` acts on the ambient scope. Called outside any `run()`, it adds to the root scope, which every later event shares.

Reserved payload names (`eventKey`, `spanId`, `fields`, etc.) are dropped from context. Passing them in `createChronicle({ metadata })` throws `RESERVED_FIELD`.

### Ambient scopes and performance

Ambient scopes use `AsyncLocalStorage`. Chronicler creates its store on the first `run()` call, so an app that only uses `begin()` and explicit handles pays nothing for it. On Node 20 and 22, `AsyncLocalStorage` enables async hooks process-wide, which adds a small cost to every promise; on Node 24+ it uses `AsyncContextFrame` and that cost is gone. For typical request-scoped logging the overhead is negligible next to I/O, but it's worth knowing if you run a promise-heavy hot path on Node 20/22.

## Backends

Chronicler doesn't care where your logs go. You provide the transport.

### Console (default)

```ts
import { createConsoleBackend } from '@ubercode/chronicler';

const backend = createConsoleBackend();
// fatal/critical/alert/error → console.error
// warn → console.warn
// audit/info → console.info
// debug/trace → console.debug
```

### Custom backend with fallbacks

```ts
import { createBackend } from '@ubercode/chronicler';

const backend = createBackend({
  error: (msg, payload) => errorTracker.capture(msg, payload),
  info: (msg, payload) => logger.info(msg, payload),
});
// Missing levels fall back: fatal → critical → error → warn → info → console
```

### Router backend (multiple streams)

Split events into separate streams from a single chronicle:

```ts
import { createRouterBackend } from '@ubercode/chronicler';

const backend = createRouterBackend([
  { backend: auditBackend, filter: (_lvl, p) => p.eventKey.startsWith('admin.') },
  { backend: httpBackend, filter: (_lvl, p) => p.eventKey.startsWith('http.') },
  { backend: mainBackend }, // no filter = receives everything
]);

const chronicle = createChronicle({ events, backend, metadata: { app: 'my-app' } });
```

Events fan out to **all** matching routes, not first-match-wins.

### Lazy backends

Pass a function as `backend` to create it on the first event instead of at import time. This helps when transports need configuration that's loaded after the logger module is imported:

```ts
export const chronicle = createChronicle({
  events,
  backend: () => createBackend({ info: (msg, p) => getTransport().write(msg, p) }),
});
```

Backend exceptions are caught and reported to `console.error`, so logging never crashes the caller.

### Using with Winston

```ts
import winston from 'winston';
import { createBackend, createChronicle } from '@ubercode/chronicler';
import { events } from './events';

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

const backend = createBackend({
  error: (msg, payload) => logger.error(msg, payload),
  warn: (msg, payload) => logger.warn(msg, payload),
  info: (msg, payload) => logger.info(msg, payload),
  debug: (msg, payload) => logger.debug(msg, payload),
});

export const chronicle = createChronicle({
  events,
  backend,
  metadata: { service: 'my-app', env: 'production' },
});
```

See [`examples/winston-app`](examples/winston-app) for a full Express app with a router backend, ambient request spans, forks and background work.

## Field Builders

```ts
field.string(); // required string
field.number().optional(); // optional number
field.boolean().doc('...'); // required boolean with documentation
field.error(); // Error | string, serialized to stack trace
field.enum(['success', 'failure', 'locked']); // 'success' | 'failure' | 'locked'
field.array(field.string()); // readonly string[]
field.array(field.enum(['read', 'write'])); // readonly ('read' | 'write')[]
field.string().sensitive(); // redacted before it reaches the backend
```

Error fields accept `Error` objects or strings and serialize to the stack trace (or message if no stack). Safe to ship to any log sink.

**Enums** take a fixed list of strings. The field's type is their union, and a value outside the list is dropped and listed in `_validation.invalidValues`.

**Arrays** hold strings, numbers, booleans or enum values; every item is checked. Arrays longer than `limits.maxArrayLength` (default 100) are cut to that length and listed in `_validation.truncatedFields`. Nested objects and arrays of objects aren't supported: they're hard to query in most log tools, so prefer flat fields (`shippingCity`, `shippingZip`).

All string values, including array items, are automatically sanitized: ANSI escape sequences are stripped and newlines are replaced with `\n` to prevent log injection.

### Sensitive fields

Mark a field `.sensitive()` and its value is redacted before the payload reaches the backend, whatever the backend is. Validation still checks the real value. Choose how with the chronicle's `redact` option:

```ts
const events = defineEvents({
  user: {
    created: event({
      level: 'info',
      message: 'User created',
      fields: { userId: field.string(), email: field.string().sensitive() },
    }),
  },
});

createChronicle({ events }); // email: '[REDACTED]'
createChronicle({ events, redact: { mode: 'hash', hashKey: process.env.LOG_HASH_KEY } }); // email: 'hmac:3f1c…'
createChronicle({ events, redact: { mode: 'drop' } }); // no email field
```

- `'mask'` (default) writes `[REDACTED]`.
- `'hash'` writes an HMAC-SHA256 of the value with your `hashKey`, so you can still find every event for the same email without the email being readable. `createChronicle` throws `INVALID_CONFIG` if `hashKey` is missing.
- `'drop'` removes the field.

`redact.keys` redacts names that aren't declared as sensitive fields: context keys, untyped `log()` fields and undeclared fields. Request context is where personal data most often leaks:

```ts
const chronicle = createChronicle({ events, redact: { keys: ['email', 'authorization'] } });
chronicle.addContext({ email: user.email }); // metadata.email: '[REDACTED]'
```

The CLI's docs mark sensitive fields, and the key lockfile records them, so removing `.sensitive()` fails `chronicler keys --check`.

Use `FieldsOf` to name an event's fields type:

```ts
import type { FieldsOf } from '@ubercode/chronicler';

type LoginFields = FieldsOf<typeof events.admin.login>; // { userId: string; success: boolean; ip?: string }
```

## Log Levels

```ts
fatal: 0; // System is unusable
critical: 1; // Critical conditions requiring immediate attention
alert: 2; // Action must be taken immediately
error: 3; // Error conditions
warn: 4; // Warning conditions
audit: 5; // Audit trail events (compliance, security)
info: 6; // Informational messages
debug: 7; // Debug-level messages
trace: 8; // Trace-level messages (very verbose)
```

Filter with `minLevel`:

```ts
const chronicle = createChronicle({
  events,
  minLevel: 'warn', // only fatal through warn are emitted
});
```

## Strict Mode

In development or CI, enable strict mode to throw on field validation errors instead of capturing them in `_validation`:

```ts
const chronicle = createChronicle({
  events,
  strict: true, // throws ChroniclerError with code FIELD_VALIDATION
});
```

## Testing

`@ubercode/chronicler/testing` records events in memory instead of sending them to a backend:

```ts
import { createTestChronicle } from '@ubercode/chronicler/testing';
import { events } from '../src/events';

test('logs the login', () => {
  const t = createTestChronicle(events, { strict: true });

  t.chronicle.admin.login({ userId: 'u-1', success: true });

  t.assertEmitted(events.admin.login, { userId: 'u-1' }); // throws, listing what was emitted, if not found
  expect(t.eventsOf(t.chronicle.admin.login)).toHaveLength(1);
});
```

`createTestChronicle(events, config?)` accepts every `createChronicle` option except `events` and `backend`, and returns `{ chronicle, emitted, eventsOf(event), assertEmitted(event, fields?), clear() }`. `eventsOf` and `assertEmitted` take an event definition or an emitter. `assertEmitted` works with any test runner.

`createTestChronicle` builds a new chronicle. To test code that logs through your app's own chronicle, use `captureEvents` on it instead:

```ts
import { captureEvents } from '@ubercode/chronicler/testing';
import { chronicle } from '../src/logger';
import { events } from '../src/events';

let capture: ReturnType<typeof captureEvents>;
beforeEach(() => (capture = captureEvents(chronicle)));
afterEach(() => capture.restore());

test('login handler audits the attempt', async () => {
  await loginHandler(req, res); // calls admin.login(...) internally
  capture.assertEmitted(events.admin.login, { success: true });
});
```

While capturing, every emitter, fork and span of that chronicle records in memory, and its configured backend isn't used (a lazy `backend` function isn't even called). `captureEvents` returns the same helpers plus `restore()`.

## Payload Reference

Every event reaches the backend as `(message, payload)`, where `payload` is a `LogPayload`:

| Field          | Type                                     | Description                                                                       |
| -------------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| `eventKey`     | `string`                                 | The event's key, e.g. `admin.login`. Empty for `log()`.                           |
| `fields`       | `Record<string, unknown>`                | The event's fields, validated and sanitized.                                      |
| `traceId`      | `string?`                                | W3C trace id, shared by a span and every span nested in it. Absent outside spans. |
| `spanId`       | `string?`                                | W3C span id of the innermost span. Absent outside spans.                          |
| `parentSpanId` | `string?`                                | Span id of the enclosing span, or of the caller from an incoming `traceparent`.   |
| `spanState`    | `'timedOut' \| 'completed' \| 'failed'?` | Only when the span is no longer active.                                           |
| `forkId`       | `string`                                 | `0` for the root, then `1`, `2`, `2.1`, ...                                       |
| `metadata`     | `Record<string, unknown>`                | Context: `metadata` from config plus fork, span and `addContext` context.         |
| `timestamp`    | `string`                                 | ISO 8601.                                                                         |
| `_validation`  | `ValidationMetadata?`                    | Present only when something needs attention (below).                              |

`_validation` keys:

| Key                  | Meaning                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `missingFields`      | Required fields that were not provided.                                                               |
| `typeErrors`         | Fields whose value has the wrong type.                                                                |
| `invalidValues`      | Fields with an invalid value of the right type (e.g. `NaN` for a number, or a value outside an enum). |
| `truncatedFields`    | Array fields cut to `limits.maxArrayLength` items.                                                    |
| `unknownFields`      | Fields not in the event definition. They're still logged.                                             |
| `staleSpanId`        | The ambient span had already finished; the event was logged outside it.                               |
| `spanLimitExceeded`  | On a `.start` event: the span was started past `limits.maxActiveSpans`.                               |
| `invalidTraceparent` | On a `.start` event: the `traceparent` passed in wasn't valid, so a new trace was started.            |

See [`docs/CloudWatch.md`](docs/CloudWatch.md) for CloudWatch Logs Insights queries over these fields.

## CLI

The CLI ships as a separate package, `@ubercode/chronicler-cli`, so the library itself has no runtime dependencies. Install it as a devDependency:

```bash
npm install --save-dev @ubercode/chronicler-cli
```

```bash
# Validate the event catalog
chronicler validate

# Generate Markdown or JSON docs
chronicler docs --format markdown --output docs/events.md

# Record every event key in chronicler.lock.json, then fail CI if a key is removed or changed
chronicler keys --write
chronicler keys --check
```

`chronicler keys --check` catches the silent breakage of path-derived keys: renaming or moving an event changes its key, which breaks dashboards and alerts. When a check fails, either restore the old key with the `key` option or rerun `--write` to accept the change. With no flag, `chronicler keys` lists the keys; `--json` prints results as JSON.

Configure it with a `chronicler.config.ts` in your project root:

```ts
export default {
  eventsFile: './src/events.ts',
  eventsExport: 'events', // the defineEvents() export to read
  docs: { format: 'markdown', outputPath: './docs/events.md' },
  keys: { lockfile: 'chronicler.lock.json' },
};
```

See [`packages/cli/README.md`](packages/cli/README.md) for all commands and options.

## API Reference

### Defining events

| Function                                                   | Description                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `defineEvents(catalog)`                                    | Validate a catalog and stamp each definition's `key`. Throws `INVALID_CATALOG` if malformed. |
| `event({ level, message, doc?, fields?, key? })`           | Define an event.                                                                             |
| `span({ events, doc?, timeout?, key?, complete?, fail? })` | Define a span. `timeout` in ms, default 5 minutes, `0` disables.                             |
| `group({ doc }, children)`                                 | Document a namespace.                                                                        |
| `walkCatalog(catalog)`                                     | List every namespace, span and event (including lifecycle events) with its resolved key.     |
| `isEventDefinition`, `isSpanDefinition`, `isCatalog`       | Type guards, e.g. for tooling.                                                               |

### `createChronicle(config)`

| Option                  | Type                                                  | Default         | Description                               |
| ----------------------- | ----------------------------------------------------- | --------------- | ----------------------------------------- |
| `events`                | catalog                                               | _required_      | The event catalog                         |
| `backend`               | `LogBackend \| () => LogBackend`                      | Console backend | Where events are sent; a function is lazy |
| `metadata`              | `Record<string, string \| number \| boolean \| null>` | `{}`            | Context attached to every event           |
| `strict`                | `boolean`                                             | `false`         | Throw on field validation errors          |
| `minLevel`              | `LogLevel`                                            | `'trace'`       | Minimum level to emit                     |
| `limits.maxContextKeys` | `number`                                              | `100`           | Max context entries per scope             |
| `limits.maxForkDepth`   | `number`                                              | `10`            | Max fork nesting depth                    |
| `limits.maxActiveSpans` | `number`                                              | `1000`          | Active spans tracked before flagging      |
| `limits.maxArrayLength` | `number`                                              | `100`           | Array items logged before truncating      |
| `redact`                | `{ mode?, hashKey?, keys? }`                          | `mask`          | How sensitive values are redacted         |
| `traceIdGenerator`      | `() => string`                                        | 32 random hex   | Custom trace ID generator                 |
| `spanIdGenerator`       | `() => string`                                        | 16 random hex   | Custom span ID generator                  |

### `Chronicle<typeof events>` (returned by `createChronicle`)

The emitter tree for the catalog: an `Emitter` function for each event and a `SpanStarter` for each span, plus:

- `fork(context?)`: a child of the ambient scope (or the root), as a full emitter tree
- `run(fn)`: on the root chronicle, runs `fn` with no ambient span; on a fork, runs `fn` with the fork ambient
- `log(level, message, fields?)`: untyped escape hatch
- `addContext(context)`: add context to the ambient scope (or the root), first write wins

### `SpanStarter`

- `key`: the span's key
- `begin(context?, options?)`: start the span and return its `SpanHandle`. `options.traceparent` continues an incoming trace
- `run(fn)` / `run(context, fn)` / `run(context, options, fn)`: start it, run `fn(handle)` with it ambient; fails it if `fn` throws or rejects, never completes it

### `SpanHandle` (returned by `begin`, passed to `run`)

- The span's own events as emitters
- `traceId`, `spanId`: the span's ids
- `traceparent`: W3C header to send to downstream services
- `complete(fields?)`: emit `{key}.complete` with `duration` and the fields declared in `span({ complete })`
- `fail(error?, fields?)`: emit `{key}.fail` with `duration`, `error` and the fields declared in `span({ fail })`
- `fork(context?)`: a `SpanFork` (the span's events, `traceId`, `spanId`, `traceparent`, `fork`, `run`, `log`, `addContext`)
- `run(fn)`, `log(...)`, `addContext(...)`

Use `HandleOf<typeof chronicle.http.request>` to type a parameter that receives a handle.

### Errors

Configuration and programming errors throw `ChroniclerError` with a `code`: `INVALID_CATALOG`, `RESERVED_FIELD`, `UNSUPPORTED_LOG_LEVEL`, `BACKEND_METHOD`, `FORK_DEPTH_EXCEEDED`, `INVALID_CONFIG`, and `FIELD_VALIDATION` (strict mode only). Everything else is reported in `_validation` and never throws.

## Migrating from 1.x

2.0 replaces standalone event definitions and `chronicle.event(def, fields)` with a catalog and typed emitters. There is no compatibility shim.

| 1.x                                                                                     | 2.0                                                                                                            |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `defineEvent({ key: 'admin.login', level, message, fields })`                           | `event({ level, message, fields })` placed at `admin.login` in `defineEvents({...})`                           |
| `defineEventGroup({ key: 'admin', type: 'system', doc, events })`                       | A nested object, or `group({ doc }, { ... })` for a documented namespace                                       |
| `defineCorrelationGroup({ key: 'http.request', type: 'correlation', timeout, events })` | `span({ timeout, events })` placed at `http.request`                                                           |
| A key that doesn't match where the definition now sits                                  | `event({ key: 'old.key', ... })` / `span({ key: 'old.key', ... })`                                             |
| `createChronicle({ backend, metadata })`                                                | `createChronicle({ events, backend, metadata })` (`metadata` is now optional)                                  |
| `chronicle.event(admin.events.login, { userId, success })`                              | `chronicle.admin.login({ userId, success })`, or `admin.login(...)` after `export const { admin } = chronicle` |
| `chronicle.event(def, {})` for an event without fields                                  | `admin.heartbeat()`                                                                                            |
| `const corr = chronicle.startCorrelation(httpRequest, ctx)`                             | `const corr = chronicle.http.request.begin(ctx)`, or `http.request.run(ctx, fn)` for an ambient span           |
| `corr.event(httpRequest.events.validated, fields)`                                      | `corr.validated(fields)`                                                                                       |
| Attaching the correlation to `req` (`(req as any).chronicle = corr`)                    | `http.request.run(...)` in middleware; handlers call `admin.login(...)` directly                               |
| `CORRELATION_LIMIT_EXCEEDED` thrown by `startCorrelation`                               | Never throws; `_validation.spanLimitExceeded` on the `.start` event                                            |
| `Chronicler`, `CorrelationChronicle` types                                              | `Chronicle<typeof events>`, `SpanHandle`, `SpanFork`, `HandleOf`                                               |
| `EventFields<typeof def>`                                                               | `FieldsOf<typeof events.admin.login>`                                                                          |
| Tests with a hand-rolled mock backend                                                   | `createTestChronicle(events)` from `@ubercode/chronicler/testing`                                              |
| `correlationId` in payloads                                                             | `traceId` (filter on it to see a request) and `spanId`                                                         |
| `correlationIdGenerator`                                                                | `traceIdGenerator` and `spanIdGenerator`                                                                       |

Behavior changes to check:

- **Keys come from the catalog path.** Before migrating, export your 1.x keys (`chronicler docs --format json` with the 1.x CLI). After migrating, compare them with `chronicler keys` and add `key` overrides wherever a key changed, then run `chronicler keys --write` to lock them.
- **Catalog names are validated.** Names must be camelCase and can't be [reserved](#events-and-the-catalog).
- **Forks of a span** expose only that span's events and can't start unrelated spans. Forks and handles used after the span ends still log, but now carry `spanState`.
- **Child scope context overrides.** Context passed to `fork()`, `begin()` or `run()` now replaces inherited values with the same key. `addContext()` is still first-write-wins.
- **Correlations are now spans**, and payload ids follow OpenTelemetry: `correlationId` is gone; use `traceId` to group a request and `spanId` for one unit of work. Ids are W3C hex strings instead of UUIDs, and are absent (not `''`) outside spans. Update dashboards and alerts that filter on `correlationId`.
- **New payload fields**: `traceId`, `spanId`, `parentSpanId` and `spanState`. They're reserved, so they can't be used as context keys.

## License

MIT
