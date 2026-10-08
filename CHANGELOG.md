# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

2.0 redesigns how events are defined and logged, and renames correlations to spans with OpenTelemetry-style trace ids. See [Migrating from 1.x](README.md#migrating-from-1x).

### Breaking

- Events are defined in one catalog with `defineEvents({...})`, whose leaves are `event({ level, message, doc?, fields?, key? })` and `span({ events, doc?, timeout?, key?, complete?, fail? })`. Keys are derived from the path (`admin.login`) instead of being written out. `defineEvent`, `defineEventGroup`, `defineCorrelationGroup` and the `type: 'system' | 'correlation'` group shape are removed
- Correlations are now **spans**. `createChronicle({ events, ... })` returns a typed emitter tree mirroring the catalog: `chronicle.admin.login({...})`, or `admin.login({...})` after `export const { admin } = chronicle`. `chronicle.event(def, fields)` and `chronicle.startCorrelation(group, ctx)` are removed; spans start with `chronicle.http.request.begin(ctx?, options?)` or `.run(ctx?, options?, fn)`, and their events are methods on the handle (`request.validated({...})`)
- Payload ids follow OpenTelemetry: `correlationId` is replaced by `traceId` (shared by a span and the spans nested in it; filter on it to see a request) and `spanId`, plus `parentSpanId` on nested spans. Ids are W3C hex strings (32 and 16 characters) instead of UUIDs, and are absent outside spans instead of `''`. `correlationIdGenerator` is replaced by `traceIdGenerator` and `spanIdGenerator`
- Removed types `Chronicler`, `CorrelationChronicle` and `EventFields`; use `Chronicle<typeof events>`, `SpanHandle`, `SpanFork`, `SpanStarter`, `HandleOf` and `FieldsOf`
- Catalog names must be camelCase and can't use the reserved names `fork`, `run`, `log`, `addContext`, `begin`, `start`, `complete`, `fail`, `timeout`, `traceId`, `spanId`, `traceparent` or `then`. Invalid catalogs (including undefined entries from circular imports, duplicate keys and spans defined inside spans) fail to compile and throw `ChroniclerError` with the new code `INVALID_CATALOG`
- Removed the `CORRELATION_LIMIT_EXCEEDED` error code (see Changed)
- Context passed to `fork()`, `begin()` or `run()` now overrides inherited values with the same key. `addContext()` stays first-write-wins
- `traceId`, `spanId`, `parentSpanId` and `spanState` are reserved payload fields and are dropped from context
- Field builders carry their value type as a third type parameter (`FieldBuilder<T, R, V>`), and `ParsedField` in the CLI gained `sensitive`, `values` and `items`

### Added

- Ambient spans: `span.run(ctx?, fn)` makes the span ambient via `AsyncLocalStorage`, so emitters called anywhere inside `fn`, including after `await`, log with its ids and context. `run()` fails the span if `fn` throws or rejects and never completes it. The store is created on the first `run()`
- Root `chronicle.run(fn)` runs `fn` with no ambient span, for background work that outlives a request; `fork.run(fn)` makes a fork ambient
- Nested spans: a span started inside another shares its `traceId` and records it as `parentSpanId`
- W3C `traceparent` support: `begin(ctx, { traceparent })` and `run(ctx, { traceparent }, fn)` continue an incoming trace (an invalid header starts a new one and sets `_validation.invalidTraceparent`), and handles and span forks expose `traceparent` for outgoing requests. Passing OpenTelemetry's propagated header logs under the active OpenTelemetry trace
- `spanState` (`'timedOut' | 'completed' | 'failed'`) on events logged to a span that is no longer active
- `_validation.staleSpanId` when the ambient span had already finished; the event is logged outside it
- `field.enum([...])`, typed as the union of its values; values outside the list are reported in `_validation.invalidValues`
- `field.array(item)` for strings, numbers, booleans and enums. Arrays past `limits.maxArrayLength` (default 100) are truncated and listed in `_validation.truncatedFields`
- `.sensitive()` on any field, and a `redact: { mode, hashKey, keys }` option: `'mask'` (default), `'hash'` (HMAC-SHA256) or `'drop'`, applied before the backend. `redact.keys` also covers context, untyped `log()` fields and undeclared fields. `'hash'` without `hashKey` throws the new code `INVALID_CONFIG`
- `group({ doc }, children)` to document a namespace, and a `key` option on `event()` and `span()` to keep a wire key stable across renames
- Catalogs compose: a catalog mounted inside another has its keys re-derived from the outer path
- `walkCatalog()`, `isCatalog()`, `isEventDefinition()` and `isSpanDefinition()` for tooling; the CLI uses them instead of inspecting object shapes
- `backend` may be a function, created lazily on the first event
- `@ubercode/chronicler/testing` with `createTestChronicle(events, config?)`, which records events in memory and provides `eventsOf()` and `assertEmitted()`, and `captureEvents(chronicle)`, which records an existing chronicle's events (such as the one your app exports) until `restore()`
- `span({ complete, fail })` declares typed extra fields for the `.complete` and `.fail` events; `complete()` and `fail()` only accept declared fields
- Events without required fields can be called with no argument (`admin.heartbeat()`), and events that declare no fields reject extra keys at compile time
- CLI: `chronicler keys --write` / `--check` / `--json` records event keys in a lockfile (`chronicler.lock.json`, configurable as `keys.lockfile`) and fails when a key changes. It also records enum values and sensitive fields: removing a value or changing `.sensitive()` fails the check, adding a value doesn't. `eventsExport` in `chronicler.config.ts` names the catalog export
- CLI docs show enum values, array item types and which fields are sensitive

### Changed

- Starting a span past `limits.maxActiveSpans` (formerly `maxActiveCorrelations`) no longer throws. The span works but isn't tracked, and its `.start` event has `_validation.spanLimitExceeded: true`
- After a timeout, a late `complete()` or `fail()` is accepted once and reports the real duration
- `createChronicle`'s `metadata` option is optional
- **Breaking:** the CLI moved to its own package, `@ubercode/chronicler-cli`. `@ubercode/chronicler` no longer has runtime dependencies (`esbuild` and `commander` are gone) and no longer provides the `chronicler` binary. Projects that run `chronicler validate` or `chronicler docs` should add `@ubercode/chronicler-cli` as a devDependency ([#11](https://github.com/MichaelLeeHobbs/chronicler/issues/11))
- The CLI now depends on `esbuild` `^0.28.1`, which includes the fix for [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) ([#11](https://github.com/MichaelLeeHobbs/chronicler/issues/11))

### Fixed

- Forks of a correlation could start nested correlations that weren't declared in its catalog entry or governed by its docs. A span fork now exposes only that span's events; nested spans are started from the catalog and recorded with `parentSpanId`
- Forks kept logging after their correlation completed, with nothing in the payload to show it. They now carry `spanState`, and ambient emitters skip a finished span and flag `_validation.staleSpanId`
- Starting too many correlations threw from inside request handling; the limit is now reported in `_validation` instead

## [1.0.4] - 2026-02-19

### Fixed

- CLI cannot load `.ts` config or event files in CJS projects — replaced tsx loader with esbuild compilation to temp `.mjs` files, which forces ESM parsing regardless of project `"type"` ([#6](https://github.com/MichaelLeeHobbs/chronicler/issues/6))

### Changed

- Replaced `tsx` dependency with `esbuild` — compiles user `.ts` files directly instead of relying on Node.js loader hooks. Also resolves the Node 24 `Dynamic require of "fs"` error ([#5](https://github.com/MichaelLeeHobbs/chronicler/issues/5))

## [1.0.2] - 2026-02-19

### Fixed

- CLI fails with `Dynamic require of "fs" is not supported` on Node 24 — mark `tsx` as external in CLI bundle and inject `createRequire` shim ([#5](https://github.com/MichaelLeeHobbs/chronicler/issues/5))
- CLI cannot load `.ts` config or event files in CJS projects — switch from `register()` + `import()` to `tsImport()` which works in both ESM and CJS contexts ([#6](https://github.com/MichaelLeeHobbs/chronicler/issues/6))
- Move `tsx` from devDependencies to dependencies so CLI works for consumers

## [1.0.1] - 2026-02-19

### Fixed

- Export `RequiredFieldBuilder` and `OptionalFieldBuilder` types — fixes TS4023 for consumers with `declaration: true` that re-export `defineEvent()` results ([#4](https://github.com/MichaelLeeHobbs/chronicler/issues/4))

### Improved

- Rewrote README to explain _why_ each feature matters (events, event groups, correlations, forks, context) with real-world before/after examples

## [1.0.0] - 2026-02-16

### Changed

- **Stable release** — public API is finalized and ready for production use
- Consolidated `LogLevel` type to single source in `constants.ts`
- Narrowed `ResolvedChroniclerConfig` to explicit fields (removed dead spread)
- Replaced changesets with tag-based publishing workflow

### Improved

- Extracted `validateEventKey` helper eliminating duplicate validation logic
- Extracted `cleanEvent` helper eliminating duplicate event extraction in CLI parser
- Fixed `collectAllGroupEventKeys` called per-element instead of once in docs generator
- Used `isReservedTopLevelField` from core instead of redundant Set in CLI validator
- Simplified `isAlreadyNormalized` from 6 conditions to 3
- Removed orphaned `LogLevel` re-exports (backend.ts, events.ts)
- Removed dead code: unused `group` field, unreachable `eventsFile` default, broken `getCallCount`

### Added

- `publish.yml` GitHub Actions workflow with npm provenance
- Version management scripts (`version:patch/minor/major`, `dry-run`)
- CI testing across Node 20, 22, and 24

## [0.1.0] - 2025-01-01

### Added

- Core `createChronicle()` API with type-safe event logging
- `defineEvent()`, `defineEventGroup()`, `defineCorrelationGroup()` for event schema definitions
- Field builder system (`field.string()`, `field.number()`, `field.boolean()`, `field.error()`) with `.optional()` and `.doc()` chaining
- Correlation lifecycle with automatic start/complete/fail/timeout events and duration tracking
- Fork support with hierarchical IDs for parallel sub-operations
- Immutable `ContextStore` with collision detection and reserved field protection
- Field validation with results captured in `_validation` metadata
- `LogBackend` interface — any object with log level methods works
- `createConsoleBackend()`, `createBackend()`, `createRouterBackend()` factory functions
- CLI with `validate` and `docs` commands for event definition analysis
- ESM + CJS dual bundles with TypeScript declarations
- Winston integration example (`examples/winston-app`)
