# Winston Express Example App

This example demonstrates a complete Express.js application using **Chronicler** with **Winston** as the logging backend, featuring multiple log streams and CloudWatch integration patterns.

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

### Log Streams

The app uses **three separate log streams**, each with its own Winston logger and Chronicler instance:

| Stream    | Purpose                             | Chronicle        | CloudWatch Stream |
| --------- | ----------------------------------- | ---------------- | ----------------- |
| **main**  | Application logs, business logic    | `chronicleMain`  | `/main`           |
| **audit** | Security, compliance, admin actions | `chronicleAudit` | `/audit`          |
| **http**  | HTTP request/response tracking      | `chronicleHttp`  | `/http`           |

This separation allows you to:

- Query specific log types independently in CloudWatch
- Apply different retention policies per stream
- Control access to sensitive audit logs separately
- Reduce noise when troubleshooting specific issues

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
- Business events logged to main stream
- Audit events logged to audit stream
- Error handling with full context
- Performance monitoring metrics

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
# Admin login (logs to audit stream)
POST http://localhost:3000/api/admin/login
Content-Type: application/json

{
  "userId": "admin",
  "password": "demo123"
}

# Perform admin action (logs to audit stream)
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

## Multi-Logger Setup

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

### Chronicler Instances

Each Winston logger is wrapped by a Chronicler instance:

```typescript
// src/services/chronicler.ts
export const chronicleMain = createChronicle({
  backend: createBackend(loggerMain),
  metadata: { service: 'winston-app', version: '1.0.0', env: 'production' },
  monitoring: { memory: true, cpu: true },
});
```

## Event Documentation

Generate markdown documentation for all events:

```powershell
pnpm run docs
```

This creates `logs.md` with all event definitions, fields, and auto-events.

## Key Features

✅ **Multiple Log Streams** - Separate logs by purpose  
✅ **Correlation Tracking** - HTTP requests tracked end-to-end  
✅ **Structured Events** - Type-safe event definitions  
✅ **Performance Monitoring** - Automatic memory/CPU tracking  
✅ **Error Handling** - Centralized error logging  
✅ **Audit Trail** - Security actions in separate stream  
✅ **CloudWatch Ready** - Drop-in mock for easy migration  
✅ **Auto Documentation** - Generate docs from code

---

**Note**: This is a demonstration app. In production, add proper authentication, input validation, rate limiting, and security headers.
