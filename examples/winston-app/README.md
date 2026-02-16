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
export const chronicle = createChronicle({
  backend: createRouterBackend([
    { backend: auditBackend, filter: (_lvl, p) => p.eventKey.startsWith('admin.') },
    { backend: httpBackend,  filter: (_lvl, p) => p.eventKey.startsWith('http.request.') },
    { backend: mainBackend,  filter: (_lvl, p) => /* everything else */ },
  ]),
  metadata: { service: 'winston-app', version: '1.0.0', env: 'production' },
});
```

This approach gives you:

- **One chronicle** — shared context, metadata, and correlation IDs across all streams
- **Event-key routing** — controllers just call `chronicle.event()` without knowing which stream receives it
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
4. Show error handling and correlation tracking
5. Cleanly shut down the server

Watch the output to see:

- Colorized server logs in real-time
- HTTP request correlations with duration tracking
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

All three Winston loggers are adapted to `LogBackend` and combined into a single router:

```typescript
// src/services/chronicler.ts
const mainBackend = toBackend(loggerMain);
const auditBackend = toBackend(loggerAudit);
const httpBackend = toBackend(loggerHttp);

export const chronicle = createChronicle({
  backend: createRouterBackend([
    { backend: auditBackend, filter: (_lvl, p) => p.eventKey.startsWith('admin.') },
    { backend: httpBackend, filter: (_lvl, p) => p.eventKey.startsWith('http.request.') },
    {
      backend: mainBackend,
      filter: (_lvl, p) =>
        !p.eventKey.startsWith('admin.') && !p.eventKey.startsWith('http.request.'),
    },
  ]),
  metadata: { service: 'winston-app', version: '1.0.0', env: 'production' },
});
```

Controllers simply import the single `chronicle` — no need to know which stream receives their events.

## Event Documentation

Generate markdown documentation for all events:

```powershell
pnpm run docs
```

This creates `logs.md` with all event definitions, fields, and auto-events.

## Key Features

- **Router Backend** — Single chronicle routes events to multiple Winston streams
- **Correlation Tracking** — HTTP requests tracked end-to-end with shared correlation IDs
- **Structured Events** — Type-safe event definitions with field validation
- **Error Handling** — Centralized error logging with full context
- **Audit Trail** — Security actions automatically routed to audit stream
- **CloudWatch Ready** — Drop-in mock for easy migration
- **Auto Documentation** — Generate docs from code

---

**Note**: This is a demonstration app. In production, add proper authentication, input validation, rate limiting, and security headers.
