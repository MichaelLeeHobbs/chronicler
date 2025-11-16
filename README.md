# chronicler

> A TypeScript-first, strongly-typed logging toolkit that enforces consistent, documented events with correlations and forks.

- Node: 20+ (ES2022)
- Bundles: ESM + CJS with types
- Runtime only, framework-agnostic

## Why Chronicler?

- Define events once with keys, levels, fields, and docs; get type-safe logging everywhere
- Enforce required/optional fields and flag type issues at runtime
- Correlate related logs with auto start/complete/timeout events and durations
- Fork work into sub-operations with hierarchical fork IDs
- Structured payloads ready for ingestion (e.g., CloudWatch, ELK, Datadog)

## Install

```powershell
pnpm add chronicler
```

Node 20+ required.

## Quick start

```ts
import {
  createChronicle,
  defineEvent,
  defineEventGroup,
  defineCorrelationGroup,
  type LogBackend,
  type LogPayload,
} from 'chronicler';

// Minimal backend (Console)
class ConsoleBackend implements LogBackend {
  supportsLevel(): boolean {
    return true;
  }
  log(level: string, message: string, payload: LogPayload) {
    // Ship to your sink here; for demo we print JSON
    console.log(JSON.stringify({ level, message, ...payload }));
  }
}

// 1) Define events (typed)
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
      fields: { port: { type: 'number', required: true, doc: 'Port' } },
    }),
  },
});

const request = defineCorrelationGroup({
  key: 'api.request',
  type: 'correlation',
  doc: 'HTTP request handling',
  // default timeout is 300s if omitted
  timeout: 30_000,
  events: {
    validated: defineEvent({
      key: 'api.request.validated',
      level: 'info',
      message: 'Request validated',
      doc: 'Validation passed',
      fields: {
        method: { type: 'string', required: true, doc: 'HTTP method' },
        path: { type: 'string', required: true, doc: 'Path' },
      },
    }),
  },
});

// 2) Create a chronicle with a backend
const chronicle = createChronicle({
  backend: new ConsoleBackend(),
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
import { createChronicle } from 'chronicler';

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

## CLI (local workspace)

Until publishing (Task 11), run the CLI via tsx:

```powershell
pnpm exec tsx src/cli/index.ts validate
pnpm exec tsx src/cli/index.ts docs --format markdown --output docs/events.md
```

When published, the `chronicler` CLI will be available.

## Scripts

- `pnpm run dev` – watch build via tsup
- `pnpm run build` – clean & create production bundles
- `pnpm run lint` – ESLint with TypeScript rules
- `pnpm run format` – Prettier formatting check
- `pnpm run test` – Vitest unit/integration tests
- `pnpm run coverage` – Coverage report
- `pnpm run check` – lint + typecheck + tests
