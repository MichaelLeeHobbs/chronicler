# Chronicler Project Task Breakdown

> Living implementation plan derived from `Specification.md`. Each task is
> scoped so it can be developed and tested end-to-end before moving on.

## 📊 Project Status (Updated: Session End)

**Phase 1 Core Features: 75% Complete** ✅

- ✅ **Core Type System** (Tasks 1.1-1.4): Complete with strict TypeScript
  coverage
- ✅ **Runtime Foundations** (Tasks 2.1-2.3): Chronicle, backend, context
  management implemented
- ✅ **Event Emission & Validation** (Tasks 3.1-3.3): Field validation, log
  envelopes, error serialization working
- ✅ **Correlation Lifecycle** (Tasks 4.1-4.4): Auto-events, timers, duration
  tracking, collision warnings complete
- ⚠️ **Fork System** (Tasks 5.1-5.3): Not yet started - next priority
- ✅ **Memory Monitoring** (Task 6.1): Basic memory sampling implemented
- ⏳ **CPU Monitoring** (Task 6.2): Planned for Phase 1 completion
- ❌ **CLI & Tooling** (Tasks 7.x): Not started - Phase 2
- ❌ **Documentation & Release** (Tasks 9.x): Pending API stability

**Test Status**: 32/32 tests passing ✅  
**Lint**: Clean ✅  
**TypeCheck**: No errors ✅

**Next Steps**:

1. Implement Fork System (Task 5.1-5.3) - hierarchical IDs, context isolation,
   nested forks
2. Add CPU monitoring (Task 6.2) to complete performance monitoring
3. Expand test coverage for edge cases
4. Begin CLI implementation for validation/docs generation

## Legend

- **Status**: ☐ pending, ☐▶ in-progress, ☑ done
- **Tests**: indicates required validation steps (unit, integration, docs, etc.)
- **Deps**: upstream tasks that must be finished first

---

## 1. Core Type System & Guardrails

| Status | Task                           | Description                                                                                                       | Tests                                                     | Deps    |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------- |
| ☑     | 1.1 Field inference primitives | Implement `FieldType`, `FieldDefinition`, `InferFieldType`, `InferFields` w/ strict TS coverage.                  | `pnpm test`, `pnpm run typecheck`, add `tsd` suite later. | —       |
| ☑     | 1.2 Reserved field registry    | Encode `ReservedTopLevelFields`, `_validation`, `_perf`, `AllReservedFields`; expose helpers to validate inputs.  | Unit tests for allow/deny matrices.                       | 1.1     |
| ☑     | 1.3 Context & metadata types   | Enforce flat values, arrays, reserved-name blocking (compile-time + runtime validator skeleton).                  | Tests proving reserved names rejected and arrays allowed. | 1.2     |
| ☑     | 1.4 Event definition builders  | `defineEvent`, `defineEventGroup`, `defineCorrelationGroup` helpers that preserve inference + auto-events typing. | Type tests + runtime smoke verifying identity.            | 1.1–1.3 |

## 2. Runtime Foundations

| Status | Task                          | Description                                                                                                                                                        | Tests                                                                  | Deps     |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------- |
| ☑     | 2.1 Log backend contract      | Implement `LogBackend`, synchronous-only enforcement, error messages.                                                                                              | Unit tests mocking backend behaviors.                                  | 1.x      |
| ☑     | 2.2 Chronicle state container | Skeleton `createChronicle` returning object with `event`, `addContext`, `startCorrelation`, `fork`. Include metadata validation + default correlationId generator. | Unit tests for initialization success/failure.                         | 2.1      |
| ☑     | 2.3 Context manager           | Runtime layer that stores immutable base metadata + additive contexts per Chronicle instance, tracks collisions & flattening.                                      | Unit tests verifying collisions, nested flattening, reserved handling. | 1.3, 2.2 |

## 3. Event Emission & Validation

| Status | Task                        | Description                                                                                                       | Tests                                                      | Deps |
| ------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---- |
| ☑     | 3.1 Field validation engine | Validate required/optional fields, type coercion rejection, produce `_validation.missingFields` / `typeErrors`.   | ✅ 5 tests in validation.test.ts                           | 2.2  |
| ☑     | 3.2 Log envelope builder    | Compose final log object (timestamp, metadata, context, `_perf`, `_validation`). Memory metrics sampling working. | ✅ Chronicle tests verify shape + perf fields              | 3.1  |
| ☑     | 3.3 Error serialization     | Integrate `stderr-lib` to serialize `error` fields safely.                                                        | ✅ Chronicle test verifies error serialization with stderr | 3.1  |

## 4. Correlation Lifecycle

| Status | Task                              | Description                                                                                                                                 | Tests                                                         | Deps     |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------- |
| ☑     | 4.1 Auto-event generation         | At runtime, synthesize `.start`, `.complete`, `.timeout`, `.metadataWarning` definitions + logging helpers.                                 | ✅ 4 tests in correlation.test.ts verify all auto-events      | 2.x, 3.x |
| ☑     | 4.2 Activity timer                | Implement inactivity timer reset on every log (including forks), auto-timeout emission, durable cleanup. Default timeout 300s when omitted. | ✅ Fake timers test verifies reset/timeout/clear + defaulting | 4.1      |
| ☑     | 4.3 Duration + multiple completes | Track start timestamps, compute duration, log `_validation.multipleCompletes`.                                                              | ✅ Tests verify duration field + multipleCompletes flag       | 4.1      |
| ☑     | 4.4 Metadata collision warnings   | Emit `.metadataWarning` when metadata overrides attempted.                                                                                  | ✅ Test verifies metadataWarning emission on collision        | 3.x      |

## 5. Fork System & Hierarchies

| Status | Task                               | Description                                                                                       | Tests                                                                  | Deps     |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| ☐      | 5.1 Fork ID generator              | Counter-per-instance hierarchical IDs ("0", "1", "2.1").                                          | Deterministic unit tests with sync + async scenarios (using promises). | 2.2      |
| ☐      | 5.2 Fork Chronicle API             | Implement `fork()` cloning context, forbidding correlation start/complete, enabling nested forks. | Tests for inheritance, no upward propagation, unique IDs.              | 5.1, 3.x |
| ☐      | 5.3 Correlation vs fork separation | Ensure correlation-only features unavailable on forks, and forks respect parent timers.           | Integration tests bridging Sections 4 & 5.                             | 4.x, 5.2 |

## 6. Observability & Monitoring

| Status | Task                      | Description                                                                                               | Tests                                                         | Deps    |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------- |
| ☑     | 6.1 Memory sampler        | Capture `heapUsed`, `heapTotal`, `external`, `rss` when monitoring enabled; ensure minimal overhead.      | ✅ Chronicle test verifies \_perf fields when monitoring on   | 3.2     |
| ☐      | 6.2 CPU sampler (Phase 1) | Implement basic CPU sampling per event (process.cpuUsage diff) behind a feature flag; include in `_perf`. | Unit tests mocking `process.cpuUsage`.                        | 3.2     |
| ☐      | 6.3 Perf flags plumbing   | Thread monitoring toggles through correlation/fork contexts.                                              | Integration test verifying `_perf` only present when enabled. | 6.1–6.2 |

## 7. CLI & Tooling

| Status | Task                   | Description                                                                           | Tests                                               | Deps |
| ------ | ---------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- | ---- |
| ☐      | 7.1 CLI config schema  | Define `ChroniclerCliConfig`, load `chronicler.config.ts` via tsx, validate paths.    | Unit tests for config parsing errors.               | 1.x  |
| ☐      | 7.2 AST event parser   | Parse `defineEvent*` usage to build tree, enforce key path validity, reserved fields. | Integration tests using fixture events.             | 7.1  |
| ☐      | 7.3 `validate` command | CLI command verifying spec invariants, exit codes.                                    | CLI tests via Vitest + `execa`.                     | 7.2  |
| ☐      | 7.4 Docs generator     | Markdown + JSON output, watch mode.                                                   | Snapshot tests for docs, watch-mode smoke manually. | 7.2  |

## 8. Testing & Quality Gates

| Status | Task                     | Description                                                                           | Tests                                       | Deps     |
| ------ | ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------- | -------- |
| ☑     | 8.1 Vitest suites        | Cover runtime behaviors (validation, context, correlation, forks).                    | ✅ 32 tests across 8 test files passing     | 2–6      |
| ☐      | 8.2 Type tests           | Add `tsd` (or `vitest` type tests) for inference guarantees.                          | `pnpm run test:types`.                      | 1,4,5    |
| ☐▶    | 8.3 Integration harness  | Mock backend to assert log envelopes; end-to-end flows from init to correlation/fork. | Partial - correlation tests cover some e2e. | 2–6      |
| ☐      | 8.4 Performance baseline | Micro-bench to ensure timers + validation overhead acceptable.                        | Optional bench script.                      | Post-RTM |

## 9. Documentation & Release

| Status | Task                                | Description                                                                    | Tests                   | Deps              |
| ------ | ----------------------------------- | ------------------------------------------------------------------------------ | ----------------------- | ----------------- |
| ☐      | 9.1 README expansion                | Usage guide aligned with implemented API, correlation examples, fork patterns. | Manual review, lint.    | Post 2–5          |
| ☐      | 9.2 CloudWatch cookbook             | Move query examples into docs + cross-link from README.                        | Markdown lint.          | 7.4               |
| ☐      | 9.3 Migration/best-practices guides | Explain reserved fields, context collisions, error handling.                   | Docs review.            | After APIs stable |
| ☐      | 9.4 Release automation              | Configure Changesets workflow + npm publish instructions.                      | GitHub Actions dry-run. | 7.x               |

---

## Decisions (resolving prior questions)

- Keep field types simple: `string | number | boolean | error`. No
  enums/dates/complex shapes in v1.
- Use `stderr-lib` for error serialization.
- `_validation.contextCollisions` is sufficient; no extra hooks.
- Correlation timeout: default to 300 seconds when not specified.
- CLI loads config/events via `tsx` for simplicity.
- Use standard Markdown for docs formatting.
- Implement CPU monitoring (basic) in Phase 1, behind a flag.
- Fork logs reset correlation activity timer.
- Package name: publish as `chronicler` (unscoped).

---

## 📝 Recent Implementation Notes

### Session: Correlation Lifecycle Implementation (Task 4 Complete)

**What Was Built:**

1. **CorrelationChronicleImpl Class** - Full lifecycle management
   - Auto-generates `.start`, `.complete`, `.timeout`, `.metadataWarning`
     events
   - Manages activity timer that resets on every log
   - Tracks start time and computes duration
   - Handles multiple complete() calls with validation warning

2. **Auto-Event System** in `events.ts`
   - `buildAutoEvents()` generates typed event definitions
   - `defineCorrelationGroup()` merges user events with auto-events
   - Proper field definitions for `duration` (number, optional) and
     metadataWarning fields

3. **Activity Timer** (`CorrelationTimer` class)
   - Resets on every log event (via `onActivity` hook)
   - Clears on completion to prevent double-fire
   - Defaults to 300s when timeout not specified
   - Properly handles the completed state

4. **Metadata Collision Detection**
   - Hooks into ContextStore validation
   - Emits `.metadataWarning` event with collision details
   - Includes attemptedKey, existingValue, attemptedValue

**Type System Fixes:**

- Fixed generic constraints in `emitAutoEvent()` - simplified to accept
  `Record<string, unknown>`
- Fixed parameter ordering for optional parameters
- Ensured proper field definitions attached to auto-events

**Tests Added:**

- 4 comprehensive correlation tests covering:
  - Start/complete with duration calculation
  - Activity timer reset and timeout emission
  - Metadata collision warnings
  - Multiple complete() calls with validation metadata

**Known Limitations:**

- Fork system not implemented yet (Task 5)
- CPU monitoring not implemented (Task 6.2)
- No integration tests for nested correlations yet

**Next Priority:** Task 5 - Fork System for isolated child contexts with
hierarchical IDs
