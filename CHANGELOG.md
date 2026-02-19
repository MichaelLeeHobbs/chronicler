# Changelog

All notable changes to this project will be documented in this file.

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
