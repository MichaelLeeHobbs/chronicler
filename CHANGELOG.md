# Changelog

All notable changes to this project will be documented in this file.

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
