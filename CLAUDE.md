# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chronicler is a TypeScript-first structured logging toolkit for Node.js 20+. It enforces type-safe, documented event definitions with correlations, forks, and field validation. Events are defined once with keys, levels, fields, and docs, then logged through backends (Winston, CloudWatch, etc.).

## Commands

| Task                                 | Command                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| Install                              | `pnpm install`                                                                  |
| Build                                | `pnpm run build`                                                                |
| Dev (watch)                          | `pnpm run dev`                                                                  |
| Test                                 | `pnpm run test`                                                                 |
| Test (watch)                         | `pnpm run test:watch`                                                           |
| Single test file                     | `pnpm exec vitest run tests/core/chronicle.test.ts`                             |
| Single test by name                  | `pnpm exec vitest run -t "test name pattern"`                                   |
| Coverage                             | `pnpm run coverage`                                                             |
| Lint                                 | `pnpm run lint`                                                                 |
| Lint fix                             | `pnpm run lint:fix`                                                             |
| Format check                         | `pnpm run format`                                                               |
| Format fix                           | `pnpm run format:fix`                                                           |
| Typecheck                            | `pnpm run typecheck`                                                            |
| Full check (lint + typecheck + test) | `pnpm run check`                                                                |
| CLI validate                         | `pnpm exec tsx src/cli/index.ts validate`                                       |
| CLI docs                             | `pnpm exec tsx src/cli/index.ts docs --format markdown --output docs/events.md` |

Package manager is **pnpm 10.18.0**. Lint enforces zero warnings (`--max-warnings=0`). Pre-commit hooks (husky + lint-staged) auto-lint and format staged files.

## Architecture

### Core (`src/core/`)

The central API flow: `createChronicle(config)` → `Chronicler` interface → `event()` / `startCorrelation()` / `fork()`.

- **chronicle.ts** — Factory (`createChronicle`) and main `Chronicler`/`CorrelationChronicle` implementations. `buildPayload()` orchestrates validation, sampling, and payload assembly before calling the backend.
- **events.ts** — `defineEvent()` creates type-safe event schemas. `defineCorrelationGroup()` auto-generates lifecycle events (`.start`, `.complete`, `.fail`, `.timeout`). Event groups are discriminated by `type: 'system' | 'correlation'`.
- **fields.ts** — Field builder system via `t` object (`t.string()`, `t.number()`, `t.boolean()`, `t.error()`). Builders chain `.optional()` and `.doc()`. `InferFields<F>` derives TypeScript types from field definitions at compile time.
- **validation.ts** — Validates required fields and types at runtime. Errors are captured in `_validation` metadata, never thrown.
- **context-store.ts** — Immutable context snapshots. Context collisions preserve original values; reserved field attempts are silently dropped. `addContext()` returns `ContextValidationResult`.
- **backend.ts** — `LogBackend` is a simple `Record<LogLevel, (message, payload) => void>`. Nine log levels: fatal(0) through trace(8).
- **constants.ts** — Global constants: log level priority map, default timeout (5min), fork ID separator (`.`).
- **reserved.ts** — Reserved top-level fields (eventKey, level, message, correlationId, forkId, timestamp, hostname, fields, \_validation). O(1) lookups via Set.
- **correlation-timer.ts** — Auto-reset timeout management for correlations.
- **errors.ts** — Single `ChroniclerError` class with `code` discriminator (`UNSUPPORTED_LOG_LEVEL`, `RESERVED_FIELD`, `BACKEND_METHOD`, `FORK_DEPTH_EXCEEDED`, `CORRELATION_LIMIT_EXCEEDED`).

### CLI (`src/cli/`)

Commander.js-based CLI with `validate` and `docs` commands. Uses AST parsing to analyze event definition files.

### Public API (`src/index.ts`)

Clean re-export surface. All public types and functions are exported from here.

## Key Design Decisions

- **Non-throwing validation**: Field/context validation failures are captured in `_validation` payload metadata, not thrown as exceptions. Only configuration errors (missing backend, reserved fields in metadata) throw.
- **Immutable context**: `ContextStore` returns copies, not references. Collisions preserve original values.
- **Fork hierarchy**: Dotted IDs (`0`, `1`, `1.1`, `1.2.1`) represent parent-child fork relationships. Root is always `0`.
- **`as const` not required**: `defineEvent` uses const generic parameters (TS 5.0+), so literal types narrow automatically.

## Testing

Tests use **Vitest** with globals enabled. Test helper `MockLoggerBackend` (in `tests/helpers/mock-logger.ts`) captures log payloads for assertion.

Test directories mirror source: `tests/core/`, `tests/cli/`, `tests/types/` (compile-time type tests), `tests/integration/`.

## Code Style

- Prettier: single quotes, semicolons, trailing commas, 100 char width
- ESLint: typescript-eslint recommended + stylistic type-checked rules, simple-import-sort
- Constants: `UPPER_SNAKE_CASE`
- Types/interfaces: `PascalCase`
- Functions: `camelCase`
- Event keys: dotted camelCase — each segment starts lowercase (`system.startup`, `api.request.validated`, `http.requestStarted`)
