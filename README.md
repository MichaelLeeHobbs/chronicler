# @ubercode/chronicler

> A TypeScript-first, strongly-typed logging toolkit that enforces consistent, documented events with correlations and forks.

- Node: 20+ (ES2022)
- Bundles: ESM + CJS with types
- Runtime only, framework-agnostic

## Why Chronicler?

- Define events once with keys, levels, fields, and docs; get type-safe logging everywhere
- Enforce required/optional fields and flag type issues at runtime
- Correlate related logs with auto start/complete/fail/timeout events and durations
- Fork work into sub-operations with hierarchical fork IDs
- Route events to multiple backends with filter-based routing
- Auto-generate Markdown or JSON documentation from event definitions via the CLI
- Structured payloads ready for ingestion (e.g., CloudWatch, ELK, Datadog)

## Install

```powershell
pnpm add @ubercode/chronicler
```

Node 20+ required.

## Quick start

```ts
import {
  createChronicle,
  defineEvent,
  defineEventGroup,
  defineCorrelationGroup,
  field,
} from '@ubercode/chronicler';

// 1) Define events
const system = defineEventGroup({
  key: 'system',
  type: 'system',
  doc: 'System lifecycle events',
  events: {
    startup: defineEvent({
      key: 'system.startup',
      level: 'info',
      message: 'Application started',
      doc: 'Emitted when the app boots',
      fields: { port: field.number().doc('Listening port') },
    }),
  },
});

const request = defineCorrelationGroup({
  key: 'api.request',
  type: 'correlation',
  doc: 'HTTP request handling',
  timeout: 30_000, // default 300s if omitted
  events: {
    validated: defineEvent({
      key: 'api.request.validated',
      level: 'info',
      message: 'Request validated',
      doc: 'Validation passed',
      fields: {
        method: field.string().doc('HTTP method'),
        path: field.string().doc('Request path'),
      },
    }),
  },
});

// 2) Create a chronicle (uses console backend by default)
const chronicle = createChronicle({
  metadata: { service: 'api', env: 'dev' },
});

// 3) Emit typed events
chronicle.event(system.events.startup, { port: 3000 });

// 4) Correlate work
const corr = chronicle.startCorrelation(request, { requestId: 'r-123' });
corr.event(request.events.validated, { method: 'GET', path: '/' });

// Fork parallel steps
const forkA = corr.fork({ step: 'A' });
forkA.event(system.events.startup, { port: 0 });

// Complete the correlation (emits api.request.complete with duration)
corr.complete();
```

## Backends

### Console (default)

```ts
import { createConsoleBackend } from '@ubercode/chronicler';

const backend = createConsoleBackend();
// Maps: fatal/critical/alert/error → console.error, warn → console.warn,
//       audit/info → console.info, debug/trace → console.debug
```

### Partial backend with fallbacks

```ts
import { createBackend } from '@ubercode/chronicler';

// Only provide the levels you care about.
// Missing levels fall back through a chain (e.g. fatal → critical → error → warn → info),
// then to console if nothing matches.
const backend = createBackend({
  error: (msg, payload) => myErrorTracker.capture(msg, payload),
  info: (msg, payload) => myLogger.info(msg, payload),
});
```

### Router backend (multiple streams)

```ts
import { createRouterBackend } from '@ubercode/chronicler';

// Route events to different backends based on filters.
// Events fan out to ALL matching routes (not first-match-wins).
const backend = createRouterBackend([
  { backend: auditBackend, filter: (_lvl, p) => p.eventKey.startsWith('admin.') },
  { backend: httpBackend, filter: (_lvl, p) => p.eventKey.startsWith('http.') },
  {
    backend: mainBackend,
    filter: (_lvl, p) => !p.eventKey.startsWith('admin.') && !p.eventKey.startsWith('http.'),
  },
]);

const chronicle = createChronicle({ backend, metadata: { app: 'my-app' } });
```

## API highlights

### Core

- `createChronicle({ backend?, metadata, strict?, minLevel?, limits?, correlationIdGenerator? })`
  - `chronicle.event(eventDef, fields)` — emit a typed event
  - `chronicle.log(level, message, fields?)` — untyped escape hatch
  - `chronicle.addContext(context)` — add metadata to all subsequent events
  - `chronicle.startCorrelation(corrGroup, context?)` — start a correlation
  - `chronicle.fork(context?)` — create an isolated child chronicle

### Definitions

- `defineEvent({ key, level, message, doc?, fields? })`
- `defineEventGroup({ key, type: 'system', doc?, events?, groups? })`
- `defineCorrelationGroup({ key, type: 'correlation', doc?, timeout?, events?, groups? })`

### Field builders

```ts
field.string(); // required string
field.number().optional(); // optional number
field.boolean().doc('...'); // required boolean with documentation
field.error(); // Error | string, serialized to stack trace
```

### Log levels

```ts
const LOG_LEVELS = {
  fatal: 0, // System is unusable
  critical: 1, // Critical conditions requiring immediate attention
  alert: 2, // Action must be taken immediately
  error: 3, // Error conditions
  warn: 4, // Warning conditions
  audit: 5, // Audit trail events (compliance, security)
  info: 6, // Informational messages
  debug: 7, // Debug-level messages
  trace: 8, // Trace-level messages (very verbose)
} as const;
```

Filter events with `minLevel`:

```ts
const chronicle = createChronicle({
  metadata: {},
  minLevel: 'warn', // only fatal, critical, alert, error, warn are emitted
});
```

### Strict mode

When `strict: true`, Chronicler throws a `ChroniclerError` with code `FIELD_VALIDATION` if events have missing required fields, type mismatches, or invalid values. Useful for CI/CD enforcement and testing.

```ts
const chronicle = createChronicle({
  metadata: {},
  strict: true, // throws on field validation errors
});
```

### Reserved fields

These payload field names cannot be used in metadata or context: `eventKey`, `level`, `message`, `correlationId`, `forkId`, `timestamp`, `fields`, `_validation`.

### Error serialization

Fields declared as `field.error()` accept `Error | string` and are serialized to the stack trace string (or message if no stack). Safe to ship to log sinks.

### String sanitization

All string field values are automatically sanitized — ANSI escape sequences are stripped and newlines are replaced with `\n`. This prevents log injection attacks.

## Using with Winston

```ts
import winston from 'winston';
import { createBackend, createChronicle } from '@ubercode/chronicler';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

// createBackend handles fallback chains automatically
const backend = createBackend({
  error: (msg, payload) => {
    logger.error(msg, payload);
  },
  warn: (msg, payload) => {
    logger.warn(msg, payload);
  },
  info: (msg, payload) => {
    logger.info(msg, payload);
  },
  debug: (msg, payload) => {
    logger.debug(msg, payload);
  },
});

const chronicle = createChronicle({
  backend,
  metadata: { service: 'my-app', env: 'production' },
});
```

See `examples/winston-app` for a full multi-stream setup using `createRouterBackend`.

## CLI

```powershell
pnpm exec tsx src/cli/index.ts validate
pnpm exec tsx src/cli/index.ts docs --format markdown --output docs/events.md
```

## Scripts

- `pnpm run dev` – watch build via tsup
- `pnpm run build` – clean & create production bundles
- `pnpm run lint` – ESLint with TypeScript rules
- `pnpm run format` – Prettier formatting check
- `pnpm run test` – Vitest unit/integration tests
- `pnpm run coverage` – Coverage report
- `pnpm run check` – lint + typecheck + tests
