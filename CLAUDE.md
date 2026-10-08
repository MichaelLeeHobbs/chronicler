# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chronicler is a TypeScript-first structured logging toolkit for Node.js 20+. Events are defined once in a nested catalog (`defineEvents`) with levels, fields and docs; keys are derived from the catalog path. `createChronicle({ events })` returns a typed emitter tree (`chronicle.admin.login({...})`) with spans, forks, ambient scopes and non-throwing field validation, logged through pluggable backends (Winston, CloudWatch, etc.).

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

The central API flow: `defineEvents({...})` catalog → `createChronicle({ events, backend?, metadata? })` → `Chronicle<C>` emitter tree. Events are functions (`admin.login(fields)`); spans are starters (`http.request.begin(ctx?, options?)` / `.run(ctx?, options?, fn)`, where `options.traceparent` continues an incoming W3C trace) that return a `SpanHandle` with the span's own events plus `complete()` / `fail()` / `fork()`. `span({ complete, fail })` declares typed extra fields for the lifecycle events. Every scope also has `fork(ctx?)`, `run(fn)`, `log(level, msg, fields?)` and `addContext(ctx)`.

- **events.ts** — `event()`, `span()`, `group()` and `defineEvents()`. `defineEvents` walks the catalog (`walkCatalog()`), validates names/levels/timeouts/duplicate keys (throws `INVALID_CATALOG`), and stamps each definition's `key` from its path (or its `key` override). Definitions carry a string `kind` discriminant (`chronicler:event` / `chronicler:span`). `lifecycleEvents()` builds the auto `.start` / `.complete` / `.fail` / `.timeout` events. `RESERVED_CATALOG_NAMES` and the `CheckCatalog` type reject reserved names and nested span definitions at compile time.
- **chronicle.ts** — `createChronicle`. A `Runtime` holds resolved config, the lazily created `AsyncLocalStorage` (first `run()`), and the active-span count. A `Scope` (context store + forkId + optional `Span`) does validation, payload assembly and backend calls; the root, forks and spans are all scopes. Root-tree emitters resolve the ambient scope (skipping finished spans and flagging `staleSpanId`); fork trees and handles are bound to their own scope. Spans started from a scope inside an unfinished span are nested (share `traceId`, parent's id as `parentSpanId`); top-level spans take `traceId`/`parentSpanId` from a valid `traceparent` option. Ids default to W3C hex (`traceIdGenerator` / `spanIdGenerator`). Emitted fields pass through the `Redactor` and context snapshots through `redact.keys`.
- **chronicle-types.ts** — Public types: `Chronicle`, `Emitters`, `Emitter`, `EmitterArgs`, `SpanStarter`, `SpanHandle`, `SpanFork`, `HandleOf`, `FieldsOf`, `ScopeMethods`.
- **fields.ts** — Field builder system via `field` (`string`, `number`, `boolean`, `error`, `enum([...])`, `array(item)`). Builders chain `.optional()`, `.doc()` and `.sensitive()`. `FieldBuilder<T, R, V>` carries the value type `V`; `InferFields<F>` derives TypeScript types from it. Arrays hold primitives or enums only (no nested objects, by design: they query badly in log tools).
- **redaction.ts** — `createRedactor(config.redact)`: `mask` (default) / `hash` (HMAC-SHA256, needs `hashKey`, else `INVALID_CONFIG`) / `drop` for `.sensitive()` fields and `redact.keys` names.
- **traceparent.ts** — Parse/format W3C `traceparent` headers.
- **validation.ts** — Validates required fields and types at runtime. Results go in `_validation` (`ValidationMetadata`: `missingFields`, `typeErrors`, `invalidValues`, `unknownFields`, `truncatedFields`, `staleSpanId`, `spanLimitExceeded`, `invalidTraceparent`), never thrown except in strict mode.
- **context.ts** — `ContextStore`: immutable snapshots; `add()` is first-write-wins (collisions keep the original, reported in `ContextValidationResult`); `derive(overrides)` creates a child store where overrides replace inherited values. Reserved fields are dropped.
- **backend.ts** — `LogBackend` is a `Record<LogLevel, (message, payload) => void>`; `LogPayload` (eventKey, fields, traceId?, spanId?, parentSpanId?, spanState?, forkId, metadata, timestamp, \_validation?). `createConsoleBackend`, `createBackend` (fallback chains), `createRouterBackend`. Nine log levels: fatal(0) through trace(8).
- **span-timer.ts** — Auto-reset idle timeout for a span (`0` disables).
- **constants.ts** — Log level priority map, default timeout (5min), default limits, root fork id (`0`), fork ID separator (`.`).
- **reserved.ts** — Reserved top-level payload fields. O(1) lookups via Set.
- **errors.ts** — Single `ChroniclerError` class with `code` discriminator (`UNSUPPORTED_LOG_LEVEL`, `RESERVED_FIELD`, `BACKEND_METHOD`, `FORK_DEPTH_EXCEEDED`, `FIELD_VALIDATION`, `INVALID_CATALOG`, `INVALID_CONFIG`).

### Testing entry (`src/testing.ts`)

Published as `@ubercode/chronicler/testing`. `createTestChronicle(events, config?)` returns `{ chronicle, emitted, eventsOf(def|emitter), assertEmitted(def|emitter, fields?), clear() }`, recording events in memory. `captureEvents(chronicle)` records an existing chronicle's events through a non-enumerable `Symbol.for('chronicler.backendHook')` hook on every chronicle tree, which swaps the runtime's backend until `restore()`.

### CLI (`src/cli/`, published from `packages/cli`)

Commander.js-based CLI (`@ubercode/chronicler-cli`) with `validate`, `docs` and `keys` commands. The key lockfile records field type, required-ness, enum values and `sensitive`; removed values or a sensitivity change are breaking, added values are not. Loads the catalog from `eventsFile` (export named by `eventsExport`) and walks it with core `walkCatalog()`.

### Public API (`src/index.ts`)

Clean re-export surface. All public types and functions are exported from here.

## Key Design Decisions

- **Catalog, not standalone definitions**: keys come from the catalog path; `key` overrides keep a wire key stable across renames. Catalog files must not import the module that calls `createChronicle()` (circular import → undefined entry → `INVALID_CATALOG`).
- **Ambient scopes**: `span.run()` / `fork.run()` make a scope ambient via `AsyncLocalStorage`; root-tree emitters log to it. Root `chronicle.run(fn)` clears the ambient span for background work. `run()` never auto-completes a span but fails it if `fn` throws or rejects.
- **Non-throwing runtime**: field/context validation, stale ambient spans and the span limit are reported in `_validation`, not thrown. Only configuration errors (invalid catalog, missing backend levels, reserved fields in metadata, fork depth) and strict mode throw.
- **Context**: child scopes (`fork`/`begin`/`run` ctx) override inherited values; `addContext()` within a scope is first-write-wins. `ContextStore` returns copies, not references.
- **Span state**: after timeout/complete/fail, handles and forks keep logging with the span ids plus `spanState`; a late `complete()`/`fail()` after a timeout is accepted once.
- **Fork hierarchy**: Dotted IDs (`0`, `1`, `1.1`, `1.2.1`) represent parent-child fork relationships. Root is always `0`. Span forks expose only that span's events.
- **`as const` not required**: `event`, `span`, `defineEvents` and `createChronicle` use const generic parameters (TS 5.0+).

## Testing

Tests use **Vitest** with globals enabled. Tests use `createTestChronicle` from `src/testing.ts`, or the `MockLoggerBackend` helper (`tests/helpers/mock-logger.ts`) to capture raw backend payloads; shared catalogs live in `tests/helpers/fixtures.ts`.

Test directories mirror source: `tests/core/`, `tests/cli/`, `tests/types/` (compile-time type tests), `tests/integration/`.

## Code Style

- Prettier: single quotes, semicolons, trailing commas, 100 char width
- ESLint: typescript-eslint recommended + stylistic type-checked rules, simple-import-sort
- Constants: `UPPER_SNAKE_CASE`
- Types/interfaces: `PascalCase`
- Functions: `camelCase`
- Catalog names: camelCase, starting lowercase; event keys are the dotted path (`system.startup`, `api.request.validated`, `http.requestStarted`)
