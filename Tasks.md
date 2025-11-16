# Chronicler - Remaining Tasks

> **Phase 1 Complete** - Core library implemented and tested. Ready for final polish before v1.0.

## 📊 Current Status

**Core Features**: ✅ All Complete (111 tests passing)

**Quality Metrics:**

- Test Coverage: 14 test files, 111 tests ✅
- Lint: Clean ✅
- TypeScript: No errors ✅
- Build: Passing ✅

**Recent Cleanup (Nov 16, 2025):**

- ✅ Fixed CPU monitoring module-level state bug
- ✅ Removed impossible `undefined` from `ContextCollisionDetail.existingValue`
- ✅ Removed unused `history` and `pendingCollisionDetails` from ContextStore
- ✅ Simplified `stringifyValue()` function
- ✅ Fixed API signatures to use `ContextRecord` instead of `Record<string, unknown>`
- ✅ Removed unused `correlationIdGenerator` field from CorrelationChronicleImpl
- ✅ **Removed nested correlation support** (breaking change - pre-v1.0)
- ✅ Simplified CorrelationChronicleImpl - removed delegate pattern

---

## 🔧 Pre-v1.0 Polish Tasks

### Critical Fixes

| #   | Issue                                                                    | Impact | Status             |
| --- | ------------------------------------------------------------------------ | ------ | ------------------ |
| C-1 | Backend type safety (`\| unknown` defeats TypeScript)                    | Medium | ☐                  |
| C-2 | CPU monitoring uses module-level state (breaks with multiple chronicles) | High   | ☑ **FIXED**       |
| C-3 | Memory leak in CorrelationTimer (doesn't clear before re-setting)        | High   | ☑ **VERIFIED OK** |
| C-4 | Circular reference handling in Winston example                           | Low    | ☐                  |

### Code Quality Improvements

| #   | Issue                                                      | Impact | Status |
| --- | ---------------------------------------------------------- | ------ | ------ |
| Q-1 | Inconsistent error handling (mix of custom/generic Error)  | Low    | ☐      |
| Q-2 | Magic numbers (timeout values, etc.)                       | Low    | ☐      |
| Q-3 | Unused/overly complex types (AllReservedFields never used) | Low    | ☐      |
| Q-4 | Side effects in ContextStore constructor                   | Low    | ☐      |
| Q-5 | Scattered validation logic (across 4 files)                | Medium | ☐      |
| Q-6 | Chronicle class doing too much (God Object)                | Low    | ☐      |

---

## 📋 Detailed Action Plans

### C-1: Backend Type Safety

**Current Problem:**

```typescript
export type LogBackend = {
  [level: string]: ((message: string, payload: LogPayload) => void) | unknown;
};
```

The `| unknown` allows non-function properties, defeating type safety.

**Plan:**

```typescript
// Option A: Strict - only log methods
export type LogBackend = Record<string, (message: string, payload: LogPayload) => void>;

// Option B: Allow known non-function properties (if needed)
export type LogBackend = {
  [K in LogLevel]: (message: string, payload: LogPayload) => void;
} & {
  [key: string]: unknown; // For custom properties
};
```

**Recommendation**: Option A (strict). If users need extra properties, they can use composition.

**Files to Change:**

- `src/core/backend.ts` - Update type definition

**Testing:**

- Verify existing tests still pass
- Add test for type safety (should fail with invalid backend)

---

### C-2: CPU Monitoring State

**Current Problem:**

```typescript
// src/core/perf.ts
let lastCpuUsage: NodeJS.CpuUsage | null = null; // MODULE-LEVEL STATE

export function samplePerformance(options: PerfOptions): PerformanceSample | undefined {
  if (options.cpu) {
    const currentCpu = process.cpuUsage();
    const delta = lastCpuUsage ? process.cpuUsage(lastCpuUsage) : currentCpu;
    lastCpuUsage = currentCpu; // MUTATION - shared across ALL chronicles
  }
}
```

With multiple chronicles, they corrupt each other's CPU measurements.

**Plan:**

**Option A: Move state to Chronicle instance (Recommended)**

```typescript
// src/core/chronicle.ts
class ChronicleImpl {
  private lastCpuUsage: NodeJS.CpuUsage | null = null;

  private samplePerformance(): PerformanceSample | undefined {
    if (!this.monitoring?.cpu) return undefined;

    const currentCpu = process.cpuUsage();
    const delta = this.lastCpuUsage ? process.cpuUsage(this.lastCpuUsage) : currentCpu;
    this.lastCpuUsage = currentCpu;

    return {
      heapUsed: process.memoryUsage().heapUsed,
      // ... etc
      cpuUser: delta.user / 1000,
      cpuSystem: delta.system / 1000,
    };
  }
}
```

**Option B: Pass state explicitly**

```typescript
// src/core/perf.ts
export interface PerfContext {
  lastCpuUsage: NodeJS.CpuUsage | null;
}

export function samplePerformance(
  options: PerfOptions,
  context: PerfContext,
): PerformanceSample | undefined {
  // Use context.lastCpuUsage, mutate it
}
```

**Recommendation**: Option A - keep state with Chronicle instance.

**Files to Change:**

- `src/core/perf.ts` - Remove module-level state, update function signature
- `src/core/chronicle.ts` - Add instance property, inline performance sampling

**Testing:**

- Add test: multiple chronicles with CPU monitoring don't interfere
- Verify CPU deltas are calculated correctly per instance

---

### C-3: Memory Leak in CorrelationTimer

**Current Problem:**

```typescript
// src/core/chronicle.ts
class CorrelationTimer {
  private timeoutId?: NodeJS.Timeout;

  start(timeout: number, onTimeout: () => void): void {
    this.timeoutId = setTimeout(onTimeout, timeout); // LEAK if called twice
  }

  touch(): void {
    this.clear();
    if (this.timeout && this.onTimeout) {
      this.start(this.timeout, this.onTimeout); // Could leak
    }
  }
}
```

If `start()` is called multiple times without `clear()`, previous timers leak.

**Plan:**

```typescript
class CorrelationTimer {
  private timeoutId?: NodeJS.Timeout;
  private timeout: number = 0;
  private onTimeout?: () => void;

  start(timeout: number, onTimeout: () => void): void {
    this.clear(); // ✅ Always clear first
    this.timeout = timeout;
    this.onTimeout = onTimeout;
    this.timeoutId = setTimeout(onTimeout, timeout);
  }

  touch(): void {
    if (this.timeout && this.onTimeout) {
      this.clear(); // ✅ Already called in start(), but explicit
      this.start(this.timeout, this.onTimeout);
    }
  }

  clear(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  }
}
```

**Files to Change:**

- `src/core/chronicle.ts` - Update `CorrelationTimer.start()` to always clear first

**Testing:**

- Add test: verify timers are cleared when restarted
- Add test: verify no timers remain after complete()

---

### C-4: Circular Reference Handling

**Current Problem:**
Winston example will crash on circular references in metadata/fields:

```typescript
const obj: any = { name: 'test' };
obj.self = obj;
chronicle.addContext({ data: obj }); // Winston's printf will crash
```

**Plan:**

**Option A: Add circular-json to example (Easiest)**

```typescript
// examples/winston-app/src/services/logger.ts
import CircularJSON from 'circular-json';

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr =
      Object.keys(meta).length > 0
        ? CircularJSON.stringify(meta, null, 2) // ✅ Use CircularJSON
        : '';
    return `${timestamp} [${level}]: ${message}${metaStr ? '\n' + metaStr : ''}`;
  }),
);
```

**Option B: Use JSON.stringify with replacer**

```typescript
const seen = new WeakSet();
const metaStr = JSON.stringify(
  meta,
  (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  },
  2,
);
```

**Option C: Document limitation**
Add to README:

> **Note**: Avoid circular references in metadata and fields. Use serialization that handles circular refs (like `circular-json`) or validate inputs.

**Recommendation**: Option A + C (add library + document)

**Files to Change:**

- `examples/winston-app/package.json` - Add `circular-json` dependency
- `examples/winston-app/src/services/logger.ts` - Use CircularJSON
- `examples/winston-app/README.md` - Document circular reference handling

---

### Q-1: Inconsistent Error Handling

**Current State:**

```typescript
// Mix of custom errors
throw new UnsupportedLogLevelError(missing.join(', '));
throw new ReservedFieldError(reservedMetadata);
throw new InvalidConfigError('A backend must be provided');

// And generic errors
throw new Error(`Backend does not support log level: ${level}`);
```

**Plan:**

**Goal**: All domain errors should be custom error classes for proper handling.

**Add Missing Error Classes:**

```typescript
// src/core/errors.ts
export class BackendMethodError extends Error {
  constructor(level: string) {
    super(`Backend does not support log level: ${level}`);
    this.name = 'BackendMethodError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

**Files to Change:**

- `src/core/errors.ts` - Add new error classes
- `src/core/backend.ts` - Use `BackendMethodError`
- `src/core/validation.ts` - Use `ValidationError` if needed
- Update any other `throw new Error()` to use custom classes

**Testing:**

- Verify tests still catch errors correctly
- Update test assertions to check error types

---

### Q-2: Magic Numbers

**Current State:**

```typescript
const DEFAULT_CORRELATION_TIMEOUT = 300_000; // What is this?
return { cpuUser: delta.user / 1000 }; // Why 1000?
```

**Plan:**

Create constants file:

```typescript
// src/core/constants.ts

/**
 * Default correlation timeout in milliseconds (5 minutes)
 */
export const DEFAULT_CORRELATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Default fork ID for root chronicle
 */
export const ROOT_FORK_ID = '0';

/**
 * Fork ID separator for hierarchical IDs
 */
export const FORK_ID_SEPARATOR = '.';

/**
 * Convert microseconds to milliseconds
 */
export const MICROSECONDS_TO_MS = 1000;

/**
 * Valid log levels in priority order
 */
export const LOG_LEVELS = [
  'fatal',
  'critical',
  'alert',
  'error',
  'warn',
  'audit',
  'info',
  'debug',
  'trace',
] as const;
```

**Files to Change:**

- Create `src/core/constants.ts`
- Update `src/core/chronicle.ts` - use constants
- Update `src/core/perf.ts` - use `MICROSECONDS_TO_MS`
- Update `src/core/events.ts` - use `LOG_LEVELS`

---

### Q-3: Unused/Overly Complex Types

**Current State:**

```typescript
// src/core/reserved.ts
export type AllReservedFields =
  | ReservedTopLevelFields
  | `_validation.${ReservedValidationFields}`
  | `_perf.${ReservedPerfFields}`;

// This type is NEVER USED in the codebase
```

**Plan:**

**Option A: Remove unused types**

- Keep types that are actually used in APIs
- Remove types that only serve as documentation

**Option B: Use them in APIs**

```typescript
// Make them useful
export function addContext(context: Record<string, unknown>): void {
  // Validate at compile time
  type InvalidKeys = Extract<keyof typeof context, AllReservedFields>;
  // ... use type
}
```

**Recommendation**: Option A - remove if truly unused, or document as "for reference only"

**Files to Change:**

- `src/core/reserved.ts` - Add JSDoc comments explaining when types are for docs only
- OR remove unused types entirely

---

### Q-4: Side Effects in Constructor

**Current State:**

```typescript
// src/core/context.ts
constructor(baseContext: Record<string, SimpleValue>) {
  const validation = this.add(baseContext); // SIDE EFFECT
  if (validation.hasCollisions) {
    this.collisionHistory.push(...validation.collisions);
  }
}
```

**Plan:**

**Option A: Factory pattern**

```typescript
class ContextStore {
  private constructor(
    private baseContext: Record<string, SimpleValue>,
    private collisionHistory: ContextCollisionDetail[] = [],
  ) {}

  static create(baseContext: Record<string, SimpleValue>): ContextStore {
    const store = new ContextStore({}, []);
    const validation = store.add(baseContext);
    if (validation.hasCollisions) {
      store.collisionHistory.push(...validation.collisions);
    }
    return store;
  }
}
```

**Option B: Two-phase initialization**

```typescript
class ContextStore {
  constructor(baseContext: Record<string, SimpleValue>) {
    this.baseContext = baseContext;
    this.collisionHistory = [];
  }

  initialize(): void {
    const validation = this.add(this.baseContext);
    if (validation.hasCollisions) {
      this.collisionHistory.push(...validation.collisions);
    }
  }
}

// Usage
const store = new ContextStore(config.metadata);
store.initialize();
```

**Option C: Accept it as reasonable**

- Constructors CAN do work if it's initialization
- This IS initialization, not random side effects
- Document behavior in JSDoc

**Recommendation**: Option C - this is fine, just add JSDoc

**Files to Change:**

- `src/core/context.ts` - Add JSDoc explaining initialization behavior

---

### Q-5: Scattered Validation Logic

**Current State:**

- Field validation: `src/core/validation.ts`
- Context validation: `src/core/context.ts`
- Reserved fields: `src/core/reserved.ts`
- Backend validation: `src/core/backend.ts`

**Plan:**

**Option A: Centralize in validation.ts**

```typescript
// src/core/validation.ts
export class Validator {
  static validateFields(...) { }
  static validateContext(...) { }
  static validateBackend(...) { }
  static validateReservedFields(...) { }
}
```

**Option B: Keep domain-specific (Current approach is fine)**

- Backend validation belongs with backend
- Context validation belongs with context
- This is proper separation of concerns

**Recommendation**: Option B - current structure is good, just add cross-references in comments

**Files to Change:**

- Add JSDoc cross-references: "See also: validateBackendMethods in backend.ts"

---

### Q-6: God Object (Chronicle Class)

**Current State:**
Chronicle class has ~347 lines and multiple responsibilities:

- Event emission
- Context management
- Correlation lifecycle
- Fork management
- Timer management
- Performance monitoring

**Analysis:**

**Is this actually a problem?**

- Chronicle IS the central orchestrator - this is its job
- It delegates to ContextStore, CorrelationTimer, perf.ts
- Most logic is in ~20-30 line methods
- No single method is overly complex

**Plan:**

**Option A: Split into multiple classes** (Overkill)

```typescript
class EventEmitter { ... }
class CorrelationManager { ... }
class ForkManager { ... }
class Chronicle {
  constructor(
    private emitter: EventEmitter,
    private correlations: CorrelationManager,
    private forks: ForkManager
  ) {}
}
```

**Option B: Extract large methods** (If any exist)

- Break 50+ line methods into smaller ones
- Keep high-level orchestration in Chronicle

**Option C: Accept as reasonable** (Recommended)

- 347 lines for a central orchestrator is fine
- It delegates complex logic to other modules
- Code is readable and well-tested

**Recommendation**: Option C - this is fine. If any method grows >50 lines, extract it.

**Files to Change:**

- None required
- Optional: Add high-level class documentation explaining responsibilities

---

## 🎯 Deferred / Not Started

### Performance Benchmarks

**Status**: Deferred (optional)  
**Reason**: Basic measurements exist in tests. Formal benchmarks not critical for v1.0.

### Watch Mode (CLI)

**Status**: Not implemented  
**Reason**: Nice-to-have feature. Can add post-v1.0.

### Multi-File Event Parsing (CLI)

**Status**: Not implemented  
**Reason**: Single file covers 95% of use cases. Can extend later.

---

## 📦 Publishing (Task P)

**Status**: On hold pending polish tasks

| Task | Description              | Status |
| ---- | ------------------------ | ------ |
| P.1  | Changesets configuration | ☐      |
| P.2  | npm publishing setup     | ☐      |
| P.3  | GitHub Actions CI/CD     | ☐      |
| P.4  | Versioning strategy      | ☐      |
| P.5  | Choose license           | ☐      |

---

## 📋 Implementation Priority

### Sprint 1: Critical Fixes (4-6 hours)

1. C-3: Fix timer memory leak ⚠️ **CRITICAL**
2. C-2: Fix CPU monitoring state 🔴 **HIGH IMPACT**
3. C-1: Strengthen backend type safety
4. C-4: Add circular reference handling to example

### Sprint 2: Code Quality (4-6 hours)

5. Q-2: Create constants file
6. Q-1: Consistent error handling
7. Q-3: Clean up unused types
8. Q-4: Document ContextStore constructor behavior
9. Q-5: Add validation cross-references
10. Q-6: Add high-level Chronicle documentation

### Sprint 3: Review & Polish (2-4 hours)

11. Update Specification.md to match implementation
12. Final API review
13. Security audit
14. Performance spot-check

**Total Estimated Time**: 10-16 hours to v1.0-ready

---

## 📝 Notes

- **setTimeout is global in Node.js** - No import needed ✅
- **Runtime type guards** - Not needed in TypeScript library. Users who bypass types with `as any` accept the risk ✅
- **No TODOs/FIXMEs in code** - Already clean ✅

---

**Status**: Ready for polish sprint. Core functionality is solid and well-tested.

---

## 10. Example App – Winston Backend - complete

### Running the example

```powershell
# from repo root
pnpm install
pnpm -w run build
cd examples/winston-app
pnpm install
pnpm run dev
```

Expected: JSON logs printed to console including `payload` with Chronicler envelope.

### Generating documentation

```powershell
# from examples/winston-app
pnpm run docs
```

This generates `logs.md` in the example directory with auto-generated event documentation.

## P. Publishing

| Status | Task      | Description                                           | Tests              | Deps |
| ------ | --------- | ----------------------------------------------------- | ------------------ | ---- |
| ☐      | P.1 Setup | Changesets, npm publishing, and GitHub Actions flows. | GH Actions dry-run | 9.x  |

---

## 📝 Recent Implementation Notes

**Known Gaps:**

- Task 8.4: Performance benchmarks (optional, deferred)
- Multi-file CLI support (deferred to Phase 3)
- Watch mode (deferred to Phase 3)

## Decisions (Updated)

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
- Backend uses method interrogation, no supportsLevel() wrapper
- Examples show direct logger object usage without classes
