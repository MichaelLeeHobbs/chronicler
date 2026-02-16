# Accepted Deviations — Chronicler

These items have been reviewed, discussed, and explicitly accepted across 3 prior deep code reviews. **Do NOT re-flag these.** If you encounter one of these patterns, skip it silently.

---

## Standards Deviations

### throw vs Result<T> (Rule 6.1 / 6.2)

**Accepted**: `defineEvent()`, `defineEventGroup()`, `defineCorrelationGroup()`, `nextForkId()`, and `startCorrelation()` throw exceptions instead of returning `Result<T>`.

**Rationale**: Rule 6.1 explicitly permits throws for "configuration errors" and "unrecoverable panics." These functions are called at module-load time (definition) or represent resource-limit violations. The project's documented design philosophy is "only configuration errors throw." CLI functions (`config-loader.ts`, `docs-generator.ts`) also throw, caught at the Commander.js boundary.

### throw uses plain Error in events.ts (Rule 6.1)

**Accepted**: `defineEvent()`, `defineEventGroup()`, and `defineCorrelationGroup()` throw `new Error(...)` rather than `ChroniclerError`.

**Rationale**: These are definition-time validation errors thrown during module initialization. Using `ChroniclerError` would be more consistent but is a cosmetic improvement. The error messages are descriptive and actionable.

### skipLibCheck: true (Rule 3.1)

**Accepted**: `tsconfig.base.json` has `skipLibCheck: true`.

**Rationale**: Third-party packages (tsup) reference optional dependencies (@swc/core) whose types aren't installed. `skipLibCheck: true` is required for practical library development. All other strict flags are enabled.

### No branded types for domain primitives (Rule 7.3)

**Accepted**: Event keys, fork IDs, correlation IDs, and log levels are plain `string`/`number`.

**Rationale**: Branded types would require unwrapping at every boundary and touch virtually every type signature. Extremely invasive for v0.1.0. Deferred.

### Functions exceeding 40 lines (Rule 8.4)

**Accepted**: `createChronicleInstance` (~92 lines), `convertGroup` (~59 lines), `generateGroupMarkdown` (~61 lines), and `parseEventsFile` (~50 lines) exceed the 40-line guideline.

**Rationale**: These are object-literal constructors or two-pass iterative algorithms where splitting would reduce readability without improving maintainability. Other long functions have been extracted.

### Iterative traversals use while-loops without MAX_ITERATIONS (Rule 8.1)

**Accepted**: Stack-based `while (stack.length > 0)` loops in `validator.ts`, `runtime-parser.ts`, and `docs-generator.ts` lack explicit upper bounds.

**Rationale**: These loops were converted FROM recursion (Rule 8.2 compliance). They iterate over finite, developer-defined event group hierarchies bounded by `MAX_EVENT_KEY_LENGTH` (256 chars). The input is not user-controlled at runtime.

### Non-null assertions on stack.pop() and Map.get() (Rule 3.2)

**Accepted**: ~14 non-null assertions (`!`) in iterative traversal code across `runtime-parser.ts`, `docs-generator.ts`, and `validator.ts`.

**Rationale**: These are in stack-based loops where the while-condition guarantees non-empty stacks, and Map.get() calls are for keys inserted in a prior pass. Converting to null-checks would add dead-code branches.

### Dynamic imports without timeouts (Rule 4.2)

**Accepted**: `await import()` calls in `config-loader.ts` and `runtime-parser.ts` have no timeout.

**Rationale**: These import user-authored local files in a CLI tool. Adding `Promise.race` with a timeout adds complexity for a local-only tool where the user can Ctrl+C. The dynamic imports have Rule 3.4 justification comments.

### switch default without assertUnreachable (Rule 8.3)

**Accepted**: `checkFieldType` in `validation.ts` has a `default` case returning `'type_error'` without `assertUnreachable`.

**Rationale**: The `type` parameter is `string` (not a discriminated union), so `assertUnreachable` is not applicable. The default handles unknown field types gracefully.

---

## Architecture Deviations

### chronicle.ts is a large module (~571 lines)

**Accepted**: `chronicle.ts` combines factory, root instance, correlation implementation, payload building, and fork management.

**Rationale**: The module is cohesive — these components are tightly coupled and splitting would create excessive cross-module imports. Deferred to a dedicated refactoring PR. Reviewed and accepted in 3 consecutive reviews.

### CorrelationChronicleImpl duplicates event/log/fork logic

**Accepted**: ~80 lines of near-identical code between `createChronicleInstance` and `CorrelationChronicleImpl`.

**Rationale**: `log()` has intentionally divergent codepaths (untyped escape hatch skips field validation). Correlation adds timer-touch logic. The duplication is a consequence of the accepted chronicle.ts structure.

### LogLevel type defined in backend.ts, re-exported from events.ts

**Accepted**: `LogLevel` lives in `backend.ts` (derived from `LOG_LEVELS` in `constants.ts`) and is re-exported through `events.ts`.

**Rationale**: Moving it to `constants.ts` is a cosmetic import-path change with many cascading updates. Low impact for v0.1.0.

### Shared mutable activeCorrelations counter

**Accepted**: `{ count: number }` passed by reference across forks and correlations.

**Rationale**: Intentional mechanism for tracking active correlations across the fork tree. Documented with TSDoc. Encapsulating behind a class would add abstraction for a single integer counter.

### ChroniclerCliConfig exported from main barrel

**Accepted**: `src/index.ts` re-exports `ChroniclerCliConfig` alongside core types.

**Rationale**: Config file authors import it from the main package (`import type { ChroniclerCliConfig } from '@ubercode/chronicler'`). Removing would be a breaking change. Separate entry point deferred to a major version.

### tsx register/unregister pattern duplicated

**Accepted**: `config-loader.ts` and `runtime-parser.ts` both have register/import/unregister patterns.

**Rationale**: The two call sites have different error handling and return types. A shared utility would couple config loading to event parsing for minimal DRY benefit.

---

## YAGNI Deviations

### `field` alias for `t` (fields.ts)

**Accepted**: The `field` export provides a non-colliding alias for codebases where `t` conflicts with i18n translation functions.

**Rationale**: Intentionally added as a DX improvement. One line of code, documented in the public API.

### `touch()` alias for `start()` (correlation-timer.ts)

**Accepted**: `touch()` provides semantic clarity at call sites (`this.timer.touch()` vs `this.timer.start()`).

**Rationale**: The alias conveys "activity occurred" intent. One line of code.

### NormalizedCorrelationGroup / isAlreadyNormalized / resolveCorrelationGroup

**Accepted**: This is a correctness guard, not a premature optimization.

**Rationale**: `defineCorrelationGroup` throws on already-normalized groups due to auto-event collision detection. `resolveCorrelationGroup` must detect pre-defined groups to avoid false-positive collision errors when the same group is passed to `startCorrelation` multiple times.

### Iterative traversals for small group trees

**Accepted**: `convertGroup`, `validateGroup`, `serializeGroup`, `generateGroupMarkdown`, and `collectEventsFromGroup` use iterative stack-based algorithms.

**Rationale**: These were explicitly converted from recursion to comply with Rule 8.2 (no recursion). Reverting to recursion would contradict that prior fix.

### Reserved fields: hostname, environment, version, service, \_perf

**Accepted**: These are reserved to prevent conflicts with common log infrastructure fields.

**Rationale**: Added to match README documentation and prevent collisions when backends (Winston, CloudWatch) add these fields. `_perf` is reserved for planned internal performance metadata.

---

## Security Deviations

### Dynamic imports execute user-authored code (CLI)

**Accepted**: `config-loader.ts` and `runtime-parser.ts` dynamically import user files.

**Rationale**: This is architecturally required — the CLI must load user-authored TypeScript config and event definition files. Security notes document this. The CLI is a locally-invoked tool, not a server.

### Config module not validated with Zod/schema library

**Accepted**: The loaded config is trusted as `ChroniclerCliConfig` with basic field checks.

**Rationale**: The config file is user-authored and locally invoked. Adding Zod introduces a new runtime dependency for a 2-field interface. Existing checks (`!config`, `!config.eventsFile`) catch the critical cases.

### log() escape hatch accepts arbitrary fields

**Accepted**: `log()` accepts `Record<string, unknown>` without type validation or depth constraints.

**Rationale**: `log()` is an intentional escape hatch for untyped logging during incremental adoption. Adding constraints would negate its purpose. JSON serialization in backends handles edge cases.

### Strict-mode console.warn exposes event keys and field names

**Accepted**: Strict mode is an opt-in developer diagnostic. It intentionally bypasses the backend to provide direct console feedback during development.

### CLI error messages expose file paths

**Accepted**: CLI is a local development tool where file paths in error messages are expected and helpful.

---

## Goal Deviations

### spread-then-override in resolveChroniclerConfig

**Accepted**: `{ ...config, backend: resolved, limits: resolved, minLevel: resolved }` is correct JavaScript behavior (later properties override earlier ones). Documented with a clarifying comment.

### Correlation start event emitted immediately in constructor

**Accepted**: The correlation begins when `startCorrelation()` is called. Context can be passed via the `metadata` parameter. Immediate start event is by design.

### ParsedEventGroup mutates readonly during two-pass construction

**Accepted**: Inner Records are only mutated during construction in `convertGroup()`. The outer `readonly` prevents reassignment after construction. TypeScript `readonly` is compile-time only.

### Object.setPrototypeOf in ChroniclerError

**Accepted**: While technically unnecessary for Node.js 20+ native classes, it is a standard defensive pattern for Error subclasses that ensures `instanceof` works correctly across all build configurations and bundlers.

### Loop upper bounds on Object.entries() iterations

**Accepted**: For-of loops over `Object.entries()` in validation, context-store, and events are bounded by config limits (maxContextKeys, field definitions). These are not unbounded.

---

_Last updated: 2026-02-14 — Consolidated from reviews 1-3_
