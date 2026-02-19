# @ubercode/chronicler

Type-safe structured logging for Node.js. Define your events once — with keys, levels, fields, and docs — then get compile-time safety, runtime validation, and auto-generated documentation everywhere you log.

```
npm install @ubercode/chronicler
```

Node 20+ required. ESM + CJS with full TypeScript declarations.

## The Problem

Most logging looks like this:

```ts
logger.info('user created', { userId: id, email });
logger.info('User Created', { user_id: id }); // different dev, different shape
logger.info('user created', { userId: id, emailAddress: email }); // another variation
```

Three devs, three formats, zero consistency. When you search your logs for user creation events, you find three different field names, two different message formats, and no way to know which fields are required. Your dashboards break, your alerts miss events, and nobody trusts the logs.

## The Solution

Define events once, log them everywhere with the same shape:

```ts
import { createChronicle, defineEvent, field } from '@ubercode/chronicler';

const userCreated = defineEvent({
  key: 'user.created',
  level: 'info',
  message: 'User created',
  doc: 'Emitted when a new user account is created',
  fields: {
    userId: field.string().doc('Unique user identifier'),
    email: field.string().optional().doc('User email address'),
  },
});

const chronicle = createChronicle({ metadata: { service: 'api' } });

// TypeScript enforces the field contract
chronicle.event(userCreated, { userId: 'u-123', email: 'a@b.com' }); // OK
chronicle.event(userCreated, { user_id: 'u-123' }); // compile error: wrong field name
chronicle.event(userCreated, {}); // compile error: missing required 'userId'
```

Every log entry has the same structure. Dashboards work. Alerts fire. New devs can read the event definitions to understand what's logged.

## Core Concepts

### Events

An **event** is a single, well-defined thing that happens in your system. Instead of ad-hoc `logger.info()` calls with arbitrary strings and objects, you declare what each event looks like up front:

```ts
const orderPlaced = defineEvent({
  key: 'order.placed',
  level: 'info',
  message: 'Order placed',
  doc: 'Emitted when a customer successfully places an order',
  fields: {
    orderId: field.string().doc('Order identifier'),
    total: field.number().doc('Order total in cents'),
    itemCount: field.number().doc('Number of items'),
  },
});
```

This gives you:

- **Compile-time safety** — TypeScript catches missing or mistyped fields before your code runs
- **Runtime validation** — missing required fields are flagged in `_validation` metadata (or thrown in strict mode)
- **Self-documenting logs** — the `doc` strings generate documentation via the CLI
- **Consistent payloads** — every instance of this event has the same shape, making log aggregation reliable

### Event Groups

**Event groups** organize related events under a namespace. Without them, you end up with hundreds of flat event keys and no way to understand the structure:

```ts
const admin = defineEventGroup({
  key: 'admin',
  type: 'system',
  doc: 'Administrative and compliance events',
  events: {
    login: defineEvent({
      key: 'admin.login',
      level: 'audit',
      message: 'Login attempt',
      doc: 'Emitted on every authentication attempt',
      fields: {
        userId: field.string().doc('User ID'),
        success: field.boolean().doc('Whether login succeeded'),
        ip: field.string().optional().doc('Client IP'),
      },
    }),
    action: defineEvent({
      key: 'admin.action',
      level: 'audit',
      message: 'Admin action performed',
      doc: 'Emitted for auditable administrative actions',
      fields: {
        action: field.string().doc('Action performed'),
        userId: field.string().doc('User who performed the action'),
        success: field.boolean().doc('Whether the action succeeded'),
      },
    }),
  },
});

// Usage
chronicle.event(admin.events.login, { userId: 'u-1', success: true, ip: '10.0.0.1' });
```

Groups also enable **router backends** — you can route all `admin.*` events to a compliance log stream and all `http.*` events to a monitoring stream, from a single chronicle instance.

### Correlations

A **correlation** tracks a unit of work from start to finish. This is the feature you wish you had every time you're debugging a production issue and trying to piece together what happened during a single HTTP request across 20 log lines.

Without correlations, you get this in your logs:

```
INFO  Request validated         { path: '/api/users' }
INFO  Database query complete   { table: 'users', rows: 42 }
INFO  Request validated         { path: '/api/orders' }   ← different request!
ERROR Database query failed     { table: 'orders' }       ← which request?
INFO  Response sent             { status: 200 }           ← which request??
```

With correlations, every log entry for a single request shares a correlation ID, and you get automatic lifecycle events:

```ts
const httpRequest = defineCorrelationGroup({
  key: 'http.request',
  type: 'correlation',
  doc: 'HTTP request lifecycle',
  timeout: 30_000,
  events: {
    validated: defineEvent({
      key: 'http.request.validated',
      level: 'info',
      message: 'Request validated',
      doc: 'Request passed validation',
      fields: {
        method: field.string(),
        path: field.string(),
      },
    }),
  },
});

// In your middleware
const corr = chronicle.startCorrelation(httpRequest, { requestId: 'req-abc' });
// Auto-emits: http.request.start

corr.event(httpRequest.events.validated, { method: 'GET', path: '/api/users' });

// When done:
corr.complete();
// Auto-emits: http.request.complete { duration: 142 }
```

Now filter by `correlationId: "corr-xyz"` in your log aggregator and see the entire request lifecycle in order. Auto-generated events give you:

| Auto-event       | When                        | Includes            |
| ---------------- | --------------------------- | ------------------- |
| `{key}.start`    | `startCorrelation()` called | —                   |
| `{key}.complete` | `complete()` called         | `duration` (ms)     |
| `{key}.fail`     | `fail(error)` called        | `duration`, `error` |
| `{key}.timeout`  | No activity within timeout  | —                   |

### Forks

**Forks** handle parallel work within a correlation. When a single request fans out to multiple services, database queries, or processing steps, forks give each branch its own identity while maintaining the parent relationship:

```ts
const corr = chronicle.startCorrelation(httpRequest, { requestId: 'req-abc' });

// Fan out to parallel work
const authFork = corr.fork({ step: 'auth' });
authFork.event(someEvent, { ... });  // forkId: "1"

const dataFork = corr.fork({ step: 'data' });
dataFork.event(someEvent, { ... });  // forkId: "2"

// Forks can nest
const cacheFork = dataFork.fork({ step: 'cache-lookup' });
cacheFork.event(someEvent, { ... }); // forkId: "2.1"

corr.complete();
```

Every log entry carries its `forkId` (`0` for root, `1`, `2`, `2.1`, etc.), so you can reconstruct the execution tree when debugging. This is invaluable for understanding concurrency issues and performance bottlenecks.

### Context

**Context** is metadata attached to every subsequent event. Set it once, and it flows through all logs automatically:

```ts
const chronicle = createChronicle({
  metadata: { service: 'api', env: 'production', version: '1.2.0' },
});

// Every event now includes service, env, and version in its payload.

// Add more context later (e.g., after auth middleware resolves the user):
chronicle.addContext({ userId: 'u-123', tenantId: 't-456' });
```

Context is immutable — collisions preserve the original value, so downstream code can't accidentally overwrite upstream context.

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
  { backend: mainBackend }, // no filter = receives everything else
]);

const chronicle = createChronicle({ backend, metadata: { app: 'my-app' } });
```

Events fan out to **all** matching routes, not first-match-wins.

### Using with Winston

```ts
import winston from 'winston';
import { createBackend, createChronicle } from '@ubercode/chronicler';

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

const chronicle = createChronicle({
  backend,
  metadata: { service: 'my-app', env: 'production' },
});
```

See [`examples/winston-app`](examples/winston-app) for a full multi-stream setup with router backend.

## Field Builders

```ts
field.string(); // required string
field.number().optional(); // optional number
field.boolean().doc('...'); // required boolean with documentation
field.error(); // Error | string, serialized to stack trace
```

Error fields accept `Error` objects or strings and serialize to the stack trace (or message if no stack). Safe to ship to any log sink.

All string values are automatically sanitized — ANSI escape sequences are stripped and newlines are replaced with `\n` to prevent log injection.

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
  metadata: {},
  minLevel: 'warn', // only fatal through warn are emitted
});
```

## Strict Mode

In development or CI, enable strict mode to throw on field validation errors instead of silently capturing them:

```ts
const chronicle = createChronicle({
  metadata: {},
  strict: true, // throws ChroniclerError with code FIELD_VALIDATION
});
```

## CLI

After installing, use the CLI to validate event definitions and generate documentation:

```bash
# Validate all event definitions
chronicler validate

# Generate Markdown docs
chronicler docs --format markdown --output docs/events.md

# Generate JSON docs
chronicler docs --format json --output docs/events.json
```

Requires a `chronicler.config.ts` in your project root:

```ts
export default {
  eventsFile: './src/events.ts',
  docs: {
    format: 'markdown',
    outputPath: './docs/events.md',
  },
};
```

## API Reference

### `createChronicle(config)`

| Option                         | Type                                                  | Default         | Description                      |
| ------------------------------ | ----------------------------------------------------- | --------------- | -------------------------------- |
| `backend`                      | `LogBackend`                                          | Console backend | Where log events are sent        |
| `metadata`                     | `Record<string, string \| number \| boolean \| null>` | _required_      | Context attached to every event  |
| `strict`                       | `boolean`                                             | `false`         | Throw on field validation errors |
| `minLevel`                     | `LogLevel`                                            | `'trace'`       | Minimum level to emit            |
| `limits.maxContextKeys`        | `number`                                              | `100`           | Max context entries              |
| `limits.maxForkDepth`          | `number`                                              | `10`            | Max fork nesting depth           |
| `limits.maxActiveCorrelations` | `number`                                              | `1000`          | Max concurrent correlations      |
| `correlationIdGenerator`       | `() => string`                                        | UUID-based      | Custom correlation ID generator  |

### `Chronicler` (returned by `createChronicle`)

- `event(eventDef, fields)` — emit a typed event
- `log(level, message, fields?)` — untyped escape hatch
- `addContext(context)` — add metadata to all subsequent events
- `startCorrelation(corrGroup, context?)` — start a correlation
- `fork(context?)` — create an isolated child chronicle

### `CorrelationChronicle` (returned by `startCorrelation`)

- `event(eventDef, fields)` — emit a typed event within this correlation
- `log(level, message, fields?)` — untyped escape hatch
- `addContext(context)` — add metadata to this correlation's events
- `fork(context?)` — create a parallel branch within this correlation
- `complete()` — end the correlation successfully (emits `{key}.complete` with duration)
- `fail(error?)` — end the correlation with failure (emits `{key}.fail` with duration and error)

## License

MIT
