# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

2.0 redesigns how events are defined and logged. See [Migrating from 1.x](README.md#migrating-from-1x).

### Breaking

- Events are defined in one catalog with `defineEvents({...})`, whose leaves are `event({ level, message, doc?, fields?, key? })` and `correlation({ events, doc?, timeout?, key? })`. Keys are derived from the path (`admin.login`) instead of being written out. `defineEvent`, `defineEventGroup`, `defineCorrelationGroup` and the `type: 'system' | 'correlation'` group shape are removed
- `createChronicle({ events, ... })` returns a typed emitter tree mirroring the catalog: `chronicle.admin.login({...})`, or `admin.login({...})` after `export const { admin } = chronicle`. `chronicle.event(def, fields)` and `chronicle.startCorrelation(group, ctx)` are removed; correlations start with `chronicle.http.request.begin(ctx?)` or `.run(ctx?, fn)`, and their events are methods on the handle (`request.validated({...})`)
- Removed types `Chronicler`, `CorrelationChronicle` and `EventFields`; use `Chronicle<typeof events>`, `CorrelationHandle`, `CorrelationFork`, `HandleOf` and `FieldsOf`
- Catalog names must be camelCase and can't use the reserved names `fork`, `run`, `log`, `addContext`, `begin`, `start`, `complete`, `fail`, `timeout`, `correlationId` or `then`. Invalid catalogs (including undefined entries from circular imports, duplicate keys and correlations defined inside correlations) fail to compile and throw `ChroniclerError` with the new code `INVALID_CATALOG`
- Removed the `CORRELATION_LIMIT_EXCEEDED` error code (see Changed)
- Context passed to `fork()`, `begin()` or `run()` now overrides inherited values with the same key. `addContext()` stays first-write-wins
- `parentCorrelationId`, `rootCorrelationId` and `correlationState` are reserved payload fields and are dropped from context

### Added

- Ambient correlations: `correlation.run(ctx?, fn)` makes the correlation ambient via `AsyncLocalStorage`, so emitters called anywhere inside `fn`, including after `await`, log with its correlation id and context. `run()` fails the correlation if `fn` throws or rejects and never completes it. The store is created on the first `run()`
- Root `chronicle.run(fn)` runs `fn` with no ambient correlation, for background work that outlives a request; `fork.run(fn)` makes a fork ambient
- Nested correlations: a correlation started inside another is logged with `parentCorrelationId`, and every correlated event has `rootCorrelationId`
- `correlationState` (`'timedOut' | 'completed' | 'failed'`) on events logged to a correlation that is no longer active
- `_validation.staleCorrelationId` when the ambient correlation had already finished; the event is logged outside it
- `group({ doc }, children)` to document a namespace, and a `key` option on `event()` and `correlation()` to keep a wire key stable across renames
- Catalogs compose: a catalog mounted inside another has its keys re-derived from the outer path
- `walkCatalog()`, `isCatalog()`, `isEventDefinition()` and `isCorrelationDefinition()` for tooling; the CLI uses them instead of inspecting object shapes
- `backend` may be a function, created lazily on the first event
- `@ubercode/chronicler/testing` with `createTestChronicle(events, config?)`, which records events in memory and provides `eventsOf()` and `assertEmitted()`, and `captureEvents(chronicle)`, which records an existing chronicle's events (such as the one your app exports) until `restore()`
- `correlation({ complete, fail })` declares typed extra fields for the `.complete` and `.fail` events; `complete()` and `fail()` only accept declared fields
- Events without required fields can be called with no argument (`admin.heartbeat()`), and events that declare no fields reject extra keys at compile time
- CLI: `chronicler keys --write` / `--check` / `--json` records event keys in a lockfile (`chronicler.lock.json`, configurable as `keys.lockfile`) and fails when a key changes. `eventsExport` in `chronicler.config.ts` names the catalog export

### Changed

- Starting a correlation past `limits.maxActiveCorrelations` no longer throws. The correlation works but isn't tracked, and its `.start` event has `_validation.correlationLimitExceeded: true`
- After a timeout, a late `complete()` or `fail()` is accepted once and reports the real duration
- `createChronicle`'s `metadata` option is optional
- **Breaking:** the CLI moved to its own package, `@ubercode/chronicler-cli`. `@ubercode/chronicler` no longer has runtime dependencies (`esbuild` and `commander` are gone) and no longer provides the `chronicler` binary. Projects that run `chronicler validate` or `chronicler docs` should add `@ubercode/chronicler-cli` as a devDependency ([#11](https://github.com/MichaelLeeHobbs/chronicler/issues/11))
- The CLI now depends on `esbuild` `^0.28.1`, which includes the fix for [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) ([#11](https://github.com/MichaelLeeHobbs/chronicler/issues/11))

### Fixed

- Forks of a correlation could start nested correlations that weren't declared in its catalog entry or governed by its docs. A correlation fork now exposes only that correlation's events; nested correlations are started from the catalog and recorded with `parentCorrelationId`
- Forks kept logging after their correlation completed, with nothing in the payload to show it. They now carry `correlationState`, and ambient emitters skip a finished correlation and flag `_validation.staleCorrelationId`
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
