# Winston Express Example App

This example demonstrates a complete Express.js application using **Chronicler** with **Winston** as the logging backend, featuring **router-based multi-stream logging** where a single chronicle instance routes events to different backends by event key.

## Architecture

The application follows an MVC pattern with proper separation of concerns:

```
src/
├── config/          # Configuration management
├── services/        # Logger and Chronicler setup
├── middleware/      # Express middleware (logging, errors)
├── controllers/     # Route handlers
├── routes/          # Route definitions
├── events.ts        # Chronicler event definitions
├── app.ts           # Express app setup
└── index.ts         # Application entry point
```

### Log Streams via Router Backend

The app uses a **single `chronicle` instance** with `createRouterBackend` to route events to three separate Winston loggers based on event key prefix:

| Event Prefix     | Winston Stream | Purpose                             |
| ---------------- | -------------- | ----------------------------------- |
| `admin.*`        | `audit`        | Security, compliance, admin actions |
| `http.request.*` | `http`         | HTTP request/response tracking      |
| everything else  | `main`         | Application logs, business logic    |

```typescript
// src/services/chronicler.ts
export const chronicle: Chronicle<typeof events> = createChronicle({
  events,
  backend: () =>
    createRouterBackend([
      { backend: toBackend(loggerAudit), filter: (_lvl, p) => isAudit(p.eventKey) },
      { backend: toBackend(loggerHttp), filter: (_lvl, p) => isHttp(p.eventKey) },
      {
        backend: toBackend(loggerMain),
        filter: (_lvl, p) => !isAudit(p.eventKey) && !isHttp(p.eventKey),
      },
    ]),
  metadata: { serviceName: 'winston-app', appVersion: '1.0.0', env: 'production' },
});

export const { system, http, admin, business } = chronicle;
```

This approach gives you:

- **One chronicle** — shared context, metadata, and span IDs across all streams
- **Event-key routing** — controllers just call `admin.login(...)` without knowing which stream receives it
- **Stream isolation** — query specific log types independently in CloudWatch
- **Different retention** — apply different retention policies per stream

## Prerequisites

- Node 20+
- pnpm

## Installation & Running

```powershell
# From repository root
pnpm install
pnpm -w run build

# Navigate to example
cd examples/winston-app
pnpm install

# Run automated demo (starts server, makes API calls, shuts down)
pnpm run demo

# Or run in development mode manually
pnpm run dev

# Or build and run production mode
pnpm run build
NODE_ENV=production pnpm run start
```

## Quick Demo

The easiest way to see Chronicler in action is to run the automated demo:

```powershell
cd examples/winston-app
pnpm run demo
```

This script will:

1. Start the Express server on port 3001
2. Make API calls to all endpoints
3. Demonstrate different log streams (main, audit, HTTP)
4. Show error handling and span tracking
5. Cleanly shut down the server

Watch the output to see:

- Colorized server logs in real-time
- HTTP request spans with duration tracking
- Business events routed to the main stream
- Audit events routed to the audit stream
- Error handling with full context

## API Endpoints

### Health Checks

```bash
# Basic health check
GET http://localhost:3000/api/health

# Deep health check
GET http://localhost:3000/api/health/deep
```

### Users (Business Logic + Logging)

```bash
# Get all users
GET http://localhost:3000/api/users

# Get specific user
GET http://localhost:3000/api/users/:id

# Create user (logs business.userCreated event)
POST http://localhost:3000/api/users
Content-Type: application/json

{
  "email": "user@example.com",
  "name": "John Doe"
}

# Delete user
DELETE http://localhost:3000/api/users/:id
```

### Admin (Audit Logging)

```bash
# Admin login (routed to audit stream)
POST http://localhost:3000/api/admin/login
Content-Type: application/json

{
  "userId": "admin",
  "password": "demo123"
}

# Perform admin action (routed to audit stream)
POST http://localhost:3000/api/admin/action
Content-Type: application/json
X-User-Id: admin

{
  "action": "delete_user",
  "resource": "user-123"
}
```

## Configuration

Set via environment variables:

| Variable        | Default                      | Description                         |
| --------------- | ---------------------------- | ----------------------------------- |
| `NODE_ENV`      | `development`                | Environment mode                    |
| `PORT`          | `3000`                       | Server port                         |
| `LOG_LEVEL`     | `info`                       | Winston log level                   |
| `APP_VERSION`   | `1.0.0`                      | Application version                 |
| `AWS_REGION`    | `us-east-1`                  | CloudWatch region                   |
| `AWS_LOG_GROUP` | `/aws/nodejs/chronicler-app` | CloudWatch log group                |
| `DEBUG_CW`      | unset                        | Enable CloudWatch mock debug output |

## Multi-Stream Setup

### Winston Logger Factory

Each log stream has its own Winston logger instance:

```typescript
// src/services/logger.ts
export const loggerMain = createLogger('main'); // Application logs
export const loggerAudit = createLogger('audit'); // Audit trail
export const loggerHttp = createLogger('http'); // HTTP requests
```

**Development mode**: Logs to console with colors
**Production mode**: Sends to CloudWatch (or mock in this example)

### Router Backend

All three Winston loggers are adapted to `LogBackend` and combined into a single router. The backend is passed as a function, so it is created lazily on the first event:

```typescript
// src/services/chronicler.ts
const isAudit = (eventKey: string) => eventKey.startsWith('admin.');
const isHttp = (eventKey: string) => eventKey.startsWith('http.request.');

export const chronicle: Chronicle<typeof events> = createChronicle({
  events,
  backend: () =>
    createRouterBackend([
      { backend: toBackend(loggerAudit), filter: (_lvl, p) => isAudit(p.eventKey) },
      { backend: toBackend(loggerHttp), filter: (_lvl, p) => isHttp(p.eventKey) },
      {
        backend: toBackend(loggerMain),
        filter: (_lvl, p) => !isAudit(p.eventKey) && !isHttp(p.eventKey),
      },
    ]),
  metadata: {
    serviceName: config.app.name,
    appVersion: config.app.version,
    env: config.environment,
  },
});

export const { system, http, admin, business } = chronicle;
```

Controllers import the namespaces they need (`import { admin } from '../services/chronicler.js'`) and call `admin.login({ ... })`. They don't need to know which stream receives their events.

## Request Spans

`src/middleware/requestLogger.ts` runs every request inside an ambient `http.request` span:

```typescript
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = req.get('x-request-id') ?? `req-${randomUUID()}`;

  http.request.run({ requestId }, (request) => {
    const startTime = Date.now();
    request.started({ method: req.method, path: req.path });
    res.setHeader('x-span-id', request.spanId);

    res.on('finish', () => {
      request.completed({ statusCode: res.statusCode, duration: Date.now() - startTime });
      request.complete();
    });
    res.on('close', () => {
      if (!res.writableFinished) request.fail(new Error('Client closed the connection'));
    });

    next();
  });
}
```

Everything downstream of `next()`, including async handlers, logs inside that span. A controller calling `admin.login({ ... })` gets the request's `spanId` and `requestId` without being passed anything. `run()` never completes the span by itself (the response is sent later), so the middleware completes it on `finish`, and fails it if the client disconnects first.

The example also shows:

- **Context** — `admin.controller.ts` calls `chronicle.addContext({ userId })`, which applies to the rest of that request's events.
- **Forks** — `health.controller.ts` probes dependencies in parallel, each from `chronicle.fork({ dependency })`, so their events share the request's span id with distinct `forkId`s.
- **Background work** — `user.controller.ts` wraps a timer in `chronicle.run(...)` so the `business.dataProcessed` event it logs later is not attributed to the already-finished request.

## Event Documentation

Generate markdown documentation for all events:

```powershell
pnpm run docs
```

This creates `logs.md` with all event definitions, fields, and auto-events.

## Key Features

- **Router Backend** — Single chronicle routes events to multiple Winston streams
- **Span Tracking** — HTTP requests tracked end-to-end with shared span IDs
- **Structured Events** — Type-safe event definitions with field validation
- **Error Handling** — Centralized error logging with full context
- **Audit Trail** — Security actions automatically routed to audit stream
- **CloudWatch Ready** — Drop-in mock for easy migration
- **Auto Documentation** — Generate docs from code

---

**Note**: This is a demonstration app. In production, add proper authentication, input validation, rate limiting, and security headers.
