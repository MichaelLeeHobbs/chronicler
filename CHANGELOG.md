# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2025-01-01

### Added

- Core `createChronicle()` API with type-safe event logging
- `defineEvent()`, `defineEventGroup()`, `defineCorrelationGroup()` for event schema definitions
- Field builder system (`t.string()`, `t.number()`, `t.boolean()`, `t.error()`) with `.optional()` and `.doc()` chaining
- Correlation lifecycle with automatic start/complete/timeout events and duration tracking
- Fork support with hierarchical IDs for parallel sub-operations
- Immutable `ContextStore` with collision detection and reserved field protection
- System events (`chronicler.contextCollision`, `chronicler.reservedFieldAttempt`) for diagnostics
- Optional performance monitoring (memory + CPU sampling via `_perf`)
- Field validation with results captured in `_validation` metadata
- `LogBackend` interface — any object with log level methods works
- CLI with `validate` and `docs` commands for event definition analysis
- ESM + CJS dual bundles with TypeScript declarations
- Winston integration example (`examples/winston-app`)
