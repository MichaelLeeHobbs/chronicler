# Chronicler Project Task Breakdown

> Living implementation plan derived from `Specification.md`. Each task is
> scoped so it can be developed and tested end-to-end before moving on.

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

| Status | Task                        | Description                                                                                                                             | Tests                                                       | Deps |
| ------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---- |
| ☐▶    | 3.1 Field validation engine | Validate required/optional fields, type coercion rejection, produce `_validation.missingFields` / `typeErrors`. Never throw after init. | Extensive unit tests covering each field type & error path. | 2.2  |
| ☐      | 3.2 Log envelope builder    | Compose final log object (timestamp, metadata, context, `_perf`, `_validation`). Hook memory metrics toggle.                            | Unit tests verifying shape + perf fields.                   | 3.1  |
| ☐      | 3.3 Error serialization     | Integrate `stderr-lib` to serialize `error` fields safely.                                                                              | Tests with real Error, circular refs, custom objects.       | 3.1  |

## 4. Correlation Lifecycle

| Status | Task                              | Description                                                                                                                                 | Tests                                                              | Deps     |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| ☐      | 4.1 Auto-event generation         | At runtime, synthesize `.start`, `.complete`, `.timeout`, `.metadataWarning` definitions + logging helpers.                                 | Unit tests ensuring events log even if user omits custom events.   | 2.x, 3.x |
| ☐      | 4.2 Activity timer                | Implement inactivity timer reset on every log (including forks), auto-timeout emission, durable cleanup. Default timeout 300s when omitted. | Fake timers unit tests verifying reset/timeout/clear + defaulting. | 4.1      |
| ☐      | 4.3 Duration + multiple completes | Track start timestamps, compute duration, log `_validation.multipleCompletes`.                                                              | Tests covering repeated complete, timeout before complete.         | 4.1      |
| ☐      | 4.4 Metadata collision warnings   | Emit `.metadataWarning` when metadata overrides attempted.                                                                                  | Behavioral tests hooking into context manager.                     | 3.x      |

## 5. Fork System & Hierarchies

| Status | Task                               | Description                                                                                       | Tests                                                                  | Deps     |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| ☐      | 5.1 Fork ID generator              | Counter-per-instance hierarchical IDs ("0", "1", "2.1").                                          | Deterministic unit tests with sync + async scenarios (using promises). | 2.2      |
| ☐      | 5.2 Fork Chronicle API             | Implement `fork()` cloning context, forbidding correlation start/complete, enabling nested forks. | Tests for inheritance, no upward propagation, unique IDs.              | 5.1, 3.x |
| ☐      | 5.3 Correlation vs fork separation | Ensure correlation-only features unavailable on forks, and forks respect parent timers.           | Integration tests bridging Sections 4 & 5.                             | 4.x, 5.2 |

## 6. Observability & Monitoring

| Status | Task                      | Description                                                                                               | Tests                                                         | Deps    |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------- |
| ☐      | 6.1 Memory sampler        | Capture `heapUsed`, `heapTotal`, `external`, `rss` when monitoring enabled; ensure minimal overhead.      | Tests mocking `process.memoryUsage()`.                        | 3.2     |
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

| Status | Task                     | Description                                                                           | Tests                           | Deps     |
| ------ | ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------- | -------- |
| ☐      | 8.1 Vitest suites        | Cover runtime behaviors (validation, context, correlation, forks).                    | `pnpm test` w/ coverage gating. | 2–6      |
| ☐      | 8.2 Type tests           | Add `tsd` (or `vitest` type tests) for inference guarantees.                          | `pnpm run test:types`.          | 1,4,5    |
| ☐      | 8.3 Integration harness  | Mock backend to assert log envelopes; end-to-end flows from init to correlation/fork. | Dedicated integration spec.     | 2–6      |
| ☐      | 8.4 Performance baseline | Micro-bench to ensure timers + validation overhead acceptable.                        | Optional bench script.          | Post-RTM |

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
