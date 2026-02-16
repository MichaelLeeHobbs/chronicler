# @ubercode/chronicler

> A TypeScript-first, strongly-typed logging toolkit that enforces consistent, documented events with correlations and forks.

- Node: 20+ (ES2022)
- Bundles: ESM + CJS with types
- Runtime only, framework-agnostic

## Why Chronicler?

- Define events once with keys, levels, fields, and docs; get type-safe logging everywhere
- Enforce required/optional fields and flag type issues at runtime
- Correlate related logs with auto start/complete/timeout events and durations
- Fork work into sub-operations with hierarchical fork IDs
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
  t,
} from '@ubercode/chronicler';

// 1) Define events (typed, using field builders)
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
      fields: { port: t.number().doc('Listening port') },
    } as const),
  },
});

const request = defineCorrelationGroup({
  key: 'api.request',
  type: 'correlation',
  doc: 'HTTP request handling',
  timeout: 30_000, // default is 300s if omitted
  events: {
    validated: defineEvent({
      key: 'api.request.validated',
      level: 'info',
      message: 'Request validated',
      doc: 'Validation passed',
      fields: {
        method: t.string().doc('HTTP method'),
        path: t.string().doc('Request path'),
      },
    } as const),
  },
});

// 2) Create a chronicle (uses console backend by default)
const chronicle = createChronicle({
  metadata: { service: 'api', env: 'dev' },
  monitoring: { memory: true, cpu: true },
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

### Custom backends

```ts
import { createConsoleBackend, createBackend } from '@ubercode/chronicler';

// Zero-config console backend (same as the default)
const consoleBackend = createConsoleBackend();

// Partial backend — only provide the levels you care about.
// Missing levels fall back through a chain (e.g. fatal → critical → error → warn → info),
// then to console if nothing matches.
const customBackend = createBackend({
  error: (msg, payload) => myErrorTracker.capture(msg, payload),
  info: (msg, payload) => myLogger.info(msg, payload),
});
```

## API highlights

- defineEvent({ key, level, message, doc, fields? })
- defineEventGroup({ key, type: 'system', doc, events, groups? })
- defineCorrelationGroup({ key, type: 'correlation', doc, timeout?, events, groups? })
- createChronicle({ backend?, metadata?, monitoring? })
  - chronicle.event(eventDef, fields)
  - chronicle.addContext(context)
  - chronicle.startCorrelation(corrGroup, context?)
  - chronicle.fork(context?)

### Log levels

Chronicler uses:

```ts
const LOG_LEVELS = {
  fatal: 0,
  critical: 1,
  alert: 2,
  error: 3,
  warn: 4,
  audit: 5,
  info: 6,
  debug: 7,
  trace: 8,
} as const;
```

### Reserved fields

Top-level in payload: `eventKey, level, message, correlationId, forkId, timestamp, hostname, environment, version, service, fields, _perf, _validation` are reserved. Attempting to place e.g. `environment` in metadata is blocked. Collisions are reported in `_validation.contextCollisions`.

### Performance

- Enable per-log sampling via `monitoring: { memory?: boolean, cpu?: boolean }`
- `_perf` contains memory and CPU deltas when enabled

### Error serialization

- Fields declared as `error` are serialized via `stderr-lib` (string). Safe to ship to log sinks.

## Using with Winston

To integrate with Winston, create a simple backend object that maps Chronicler levels to Winston:

```ts
import winston from 'winston';
import { createChronicle } from '@ubercode/chronicler';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

// Create backend adapter - just an object with level methods
const winstonBackend = {
  fatal: (msg: string, data: unknown) => logger.error(msg, data),
  critical: (msg: string, data: unknown) => logger.error(msg, data),
  alert: (msg: string, data: unknown) => logger.error(msg, data),
  error: (msg: string, data: unknown) => logger.error(msg, data),
  warn: (msg: string, data: unknown) => logger.warn(msg, data),
  audit: (msg: string, data: unknown) => logger.info(msg, data),
  info: (msg: string, data: unknown) => logger.info(msg, data),
  debug: (msg: string, data: unknown) => logger.debug(msg, data),
  trace: (msg: string, data: unknown) => logger.silly(msg, data),
};

const chronicle = createChronicle({
  backend: winstonBackend,
  metadata: { service: 'my-app', env: 'production' },
});
```

See `examples/winston-app` for a runnable setup.

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
