# Chronicler - Development Tasks

> **Status**: v1.0 Ready | Architectural Review Complete

---

## 📊 Current Status

| Metric | Value            |
| ------ | ---------------- |
| Tests  | ✅ 93/93 passing |
| Build  | ✅ Clean         |
| Lint   | ✅ Clean         |
| Files  | 21 source files  |
| Lines  | ~3,100 LOC       |

**Last Updated**: November 18, 2025

---

## 🚀 v1.0 Release Checklist

- [ ] Final README review with usage examples
- [ ] Choose license (MIT recommended)
- [ ] Set up Changesets for versioning
- [ ] Configure npm publishing workflow
- [ ] Set up GitHub Actions CI/CD
- [ ] Create CHANGELOG.md
- [ ] Tag v1.0.0
- [ ] Publish to npm

---

## 🏗️ Architecture & Type System Refactoring Plan

> **Context**: Pre-v1.0 architectural review with no backward compatibility constraints.
> This is our opportunity to fix fundamental design decisions before release.

### Executive Summary

**Current State**: Functional and well-tested, but has architectural inconsistencies and type safety gaps.

**Proposed Changes**: 7 major refactorings that would significantly improve maintainability, type safety, and clarity.

**Effort**: ~20-30 hours total (can be done incrementally)

**Risk**: Low (comprehensive test suite catches regressions)

---

### R-1: Unify Class vs Factory Pattern 🔴 HIGH IMPACT

**Current Problem:**

```typescript
// Factory pattern for Chronicle
const createChronicleInstance = (...) => ({ event, addContext, fork, startCorrelation })

// Class pattern for Correlation
class CorrelationChronicleImpl implements CorrelationChronicle { ... }
```

**Why This Is Confusing:**

- Inconsistent patterns make codebase harder to learn
- Factory returns plain object (no `this`, no private state encapsulation)
- Class has proper encapsulation but different usage pattern
- Both implement similar interfaces but structured differently

**Proposed Solution: Classes Throughout**

```typescript
// Chronicle becomes a class
export class ChronicleImpl implements Chronicler {
  private forkCounter = 0;
  private readonly perfContext: PerfContext = {};

  constructor(
    private readonly config: ChroniclerConfig,
    private readonly contextStore: ContextStore,
    private readonly currentCorrelationId: () => string,
    private readonly correlationIdGenerator: () => string,
    private readonly forkId: string,
  ) {}

  event<F extends FieldDefinitions>(eventDef: EventDefinition<F>, fields: InferFields<F>): void {
    const payload = this.buildPayload(eventDef, fields);
    callBackendMethod(this.config.backend, eventDef.level, eventDef.message, payload);
  }

  private buildPayload(...): LogPayload {
    // Now an instance method, access to this.config, this.contextStore, etc.
  }

  // ... other methods
}

// Public factory stays simple
export const createChronicle = (config: ChroniclerConfig): Chronicler => {
  // Validation
  const contextStore = new ContextStore(config.metadata);
  const correlationIdGenerator = config.correlationIdGenerator ?? defaultGenerator;

  return new ChronicleImpl(config, contextStore, () => correlationIdGenerator(), correlationIdGenerator, ROOT_FORK_ID);
};
```

**Benefits:**

- ✅ Consistent pattern throughout codebase
- ✅ Proper encapsulation with private methods
- ✅ Easier to test (can test class methods individually)
- ✅ Better IDE support (code completion, refactoring)
- ✅ Clearer ownership of state (no closure magic)
- ✅ Can use inheritance/composition more easily

**Migration Path:**

1. Convert `createChronicleInstance` to `ChronicleImpl` class
2. Keep `createChronicle` as factory function (public API)
3. Move `buildPayload`, `emitSystemEvent` to class methods
4. Update tests to instantiate class directly (better testability)

**Estimated Effort:** 4-6 hours

---

### R-2: Separate Chronicle Concerns into Services 🔴 HIGH IMPACT

**Current Problem:**
Chronicle class does too much:

- Event emission
- Context management
- Fork creation
- Correlation lifecycle
- System event emission
- Payload building
- Backend communication

**Proposed Solution: Service Objects**

```typescript
// Core Chronicle orchestrates, services do work
class ChronicleImpl {
  constructor(
    private readonly config: ChroniclerConfig,
    private readonly contextManager: ContextManager,
    private readonly eventEmitter: EventEmitter,
    private readonly forkManager: ForkManager,
    private readonly forkId: string,
  ) {}

  event(...) {
    // Delegate to services
    const payload = this.eventEmitter.buildPayload(...);
    this.eventEmitter.emit(payload);
  }

  addContext(context: ContextRecord): void {
    const validation = this.contextManager.add(context);
    this.eventEmitter.emitSystemEvents(validation);
  }

  fork(context?: ContextRecord): Chronicler {
    return this.forkManager.createFork(this, context);
  }
}

// Context management service
class ContextManager {
  constructor(private store: ContextStore) {}

  add(context: ContextRecord): ContextValidationResult {
    return this.store.add(context);
  }

  snapshot(): ContextRecord {
    return this.store.snapshot();
  }
}

// Event emission service
class EventEmitter {
  constructor(
    private readonly config: ChroniclerConfig,
    private readonly contextManager: ContextManager,
    private readonly perfContext: PerfContext,
  ) {}

  buildPayload(eventDef: EventDefinition, fields: any, correlationId: string, forkId: string): LogPayload {
    // All payload building logic here
  }

  emit(payload: LogPayload): void {
    callBackendMethod(this.config.backend, payload.level, eventDef.message, payload);
  }

  emitSystemEvents(validation: ContextValidationResult, correlationId: string, forkId: string): void {
    // All system event emission logic
  }
}

// Fork management service
class ForkManager {
  private counter = 0;

  createFork(parent: ChronicleImpl, extraContext?: ContextRecord): Chronicler {
    this.counter++;
    const childForkId = parent.forkId === ROOT_FORK_ID
      ? String(this.counter)
      : `${parent.forkId}${FORK_ID_SEPARATOR}${this.counter}`;

    // Create child with same services but new context
    const childContextManager = new ContextManager(
      new ContextStore(parent.contextManager.snapshot())
    );

    return new ChronicleImpl(
      parent.config,
      childContextManager,
      parent.eventEmitter, // Can share or create new
      new ForkManager(), // Each instance has own counter
      childForkId,
    );
  }
}
```

**Benefits:**

- ✅ Single Responsibility Principle
- ✅ Each service is independently testable
- ✅ Clear boundaries between concerns
- ✅ Easier to extend (add new services)
- ✅ Easier to mock for testing
- ✅ Less coupling between features

**Trade-offs:**

- ⚠️ More classes to maintain
- ⚠️ More files (but each smaller and focused)
- ⚠️ Slightly more boilerplate

**Migration Path:**

1. Create `EventEmitter` service, move payload building
2. Create `ContextManager` service, move context logic
3. Create `ForkManager` service, move fork logic
4. Refactor `ChronicleImpl` to orchestrate services
5. Update tests to test services individually

**Estimated Effort:** 6-8 hours

---

### R-3: Consolidate Correlation Lifecycle Management 🟡 MEDIUM IMPACT

**Current Problem:**
`CorrelationChronicleImpl` mixes:

- Timer management
- Completion tracking
- Auto-event emission
- Fork management (inherits from Chronicle pattern)
- Duplicate event emission logic

**Proposed Solution: Extract CorrelationLifecycle Service**

```typescript
// Manages correlation-specific lifecycle
class CorrelationLifecycle {
  private completed = false;
  private completionCount = 0;
  private readonly startedAt = Date.now();

  constructor(
    private readonly timer: CorrelationTimer,
    private readonly autoEvents: CorrelationAutoEvents,
    private readonly eventEmitter: EventEmitter,
  ) {
    this.timer.start();
    this.emitStart();
  }

  private emitStart(): void {
    this.eventEmitter.emit(this.autoEvents.start, {});
  }

  complete(fields?: ContextRecord): void {
    if (!this.completed) {
      this.completed = true;
      this.timer.clear();

      const duration = Date.now() - this.startedAt;
      this.eventEmitter.emit(this.autoEvents.complete, {
        duration,
        ...fields,
      });
    }

    this.completionCount++;
    if (this.completionCount > 1) {
      // Emit warning via system events
    }
  }

  timeout(): void {
    if (!this.completed) {
      this.completed = true;
      this.eventEmitter.emit(this.autoEvents.timeout, {});
    }
  }

  onActivity(): void {
    this.timer.touch();
  }
}

// Simplified CorrelationChronicle
class CorrelationChronicleImpl {
  constructor(
    private readonly chronicle: ChronicleImpl, // Composition, not inheritance
    private readonly lifecycle: CorrelationLifecycle,
  ) {}

  event(...) {
    this.chronicle.event(...);
    this.lifecycle.onActivity(); // Hook into activity
  }

  complete(fields?: ContextRecord): void {
    this.lifecycle.complete(fields);
  }

  // Delegate everything else to inner chronicle
  addContext(context: ContextRecord): void {
    this.chronicle.addContext(context);
  }

  fork(context?: ContextRecord): Chronicler {
    const fork = this.chronicle.fork(context);
    // Hook fork activity to reset timer
    return wrapWithActivityTracking(fork, () => this.lifecycle.onActivity());
  }
}
```

**Benefits:**

- ✅ Clear separation: lifecycle vs event logging
- ✅ Easier to test lifecycle logic independently
- ✅ Composition over inheritance
- ✅ Simpler CorrelationChronicle implementation
- ✅ Lifecycle logic reusable for other patterns

**Migration Path:**

1. Extract `CorrelationLifecycle` class
2. Refactor `CorrelationChronicleImpl` to use composition
3. Add activity tracking wrapper for forks
4. Update tests

**Estimated Effort:** 3-4 hours

---

### R-4: Type-Safe System Event Fields 🟡 MEDIUM IMPACT

**Current Problem:**

```typescript
// System events bypass type safety
emitSystemEvent(
  config,
  contextStore,
  chroniclerSystemEvents.events.contextCollision,
  {
    key: detail.key, // No type checking!
    existingValue: stringifyValue(detail.existingValue),
    attemptedValue: stringifyValue(detail.attemptedValue),
  }, // This is Record<string, unknown>
  ...
);
```

**Why This Is Bad:**

- System events don't benefit from field type validation
- Typos in field names won't be caught
- No autocomplete for field names
- Breaking changes to system events are silent

**Proposed Solution: Properly Typed System Events**

```typescript
// Define proper field types for system events
const contextCollisionFields = {
  key: { type: 'string' as const, required: true as const, doc: 'Context key that collided' },
  existingValue: { type: 'string' as const, required: true as const, doc: 'Current value' },
  attemptedValue: { type: 'string' as const, required: true as const, doc: 'Attempted value' },
  relatedEventKey: { type: 'string' as const, required: false as const, doc: 'Triggering event' },
};

export const chroniclerSystemEvents = defineEventGroup({
  key: SYSTEM_EVENT_PREFIX.slice(0, -1),
  type: 'system',
  doc: 'Internal Chronicler system events',
  events: {
    contextCollision: defineEvent({
      key: `${SYSTEM_EVENT_PREFIX}contextCollision`,
      level: 'warn',
      message: 'Context key collision detected',
      doc: 'Emitted when addContext() attempts to override an existing context key',
      fields: contextCollisionFields, // Properly typed!
    }),
    // ... other events
  },
});

// Now emission is type-safe
chronicle.event(chroniclerSystemEvents.events.contextCollision, {
  key: detail.key,
  existingValue: stringifyValue(detail.existingValue),
  attemptedValue: stringifyValue(detail.attemptedValue),
  // TypeScript error if we miss required fields or add wrong types!
});
```

**Benefits:**

- ✅ Type safety for system events
- ✅ Autocomplete in IDE
- ✅ Compile-time field validation
- ✅ Consistent with user events
- ✅ Self-documenting

**Migration Path:**

1. Define field definitions for each system event
2. Update system-events.ts with field definitions
3. Replace `emitSystemEvent` with typed `chronicle.event()` calls
4. Remove `emitSystemEvent` helper (no longer needed)

**Estimated Effort:** 2-3 hours

---

### R-5: Strengthen ContextValue Type Safety 🟢 LOW IMPACT

**Current Problem:**

```typescript
type SimpleValue = string | number | boolean | null;
export type ContextValue = SimpleValue | SimpleValue[];
//                                       ^^^^^^^^^^^ Allows any array of simple values
```

**Issues:**

- Arrays are allowed but unclear why
- `SimpleValue[]` allows empty arrays
- No validation that arrays contain consistent types
- Usage pattern unclear from type alone

**Proposed Solutions:**

**Option A: Remove Array Support (Simplest)**

```typescript
// If we're not actually using arrays, remove support
export type ContextValue = string | number | boolean | null;

// If array is needed, user can stringify
context.add({ ids: ids.join(',') });
```

**Option B: Constrain Arrays (If needed)**

```typescript
// Only allow non-empty arrays of consistent types
export type ContextValue =
  | string
  | number
  | boolean
  | null
  | readonly [string, ...string[]] // Non-empty string array
  | readonly [number, ...number[]] // Non-empty number array
  | readonly [boolean, ...boolean[]]; // Non-empty boolean array

// Runtime validation to match
function isContextValue(value: unknown): value is ContextValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value) && value.length > 0) {
    const firstType = typeof value[0];
    return value.every((v) => typeof v === firstType);
  }
  return false;
}
```

**Option C: Document Current Behavior**

````typescript
/**
 * Context value types
 *
 * Arrays are allowed for convenience (e.g., list of IDs, tags)
 * but will be stringified as comma-separated values in logs
 *
 * @example
 * ```
 * context.add({ tags: ['urgent', 'customer', 'billing'] });
 * // Logged as: tags: "urgent,customer,billing"
 * ```
 */
export type ContextValue = SimpleValue | SimpleValue[];
````

**Recommendation:** Start with Option A (remove arrays) or Option C (document). Arrays add complexity without clear use case.

**Migration Path:**

1. Survey codebase for array usage in context
2. If none found, remove array support
3. If found, document behavior clearly
4. Add runtime validation to match type

**Estimated Effort:** 1 hour

---

### R-6: Explicit Event Emission Pipeline 🟢 LOW IMPACT

**Current Problem:**
Event emission scattered across multiple functions with unclear data flow:

```
User calls chronicle.event()
  → createChronicleInstance.event()
  → buildPayload()
  → validateFields()
  → buildValidationMetadata()
  → samplePerformance()
  → callBackendMethod()
```

**Proposed Solution: Pipeline Pattern**

```typescript
// Clear pipeline with explicit stages
class EventPipeline {
  constructor(
    private readonly config: ChroniclerConfig,
    private readonly contextManager: ContextManager,
  ) {}

  process(
    eventDef: EventDefinition,
    fields: any,
    metadata: EventMetadata,
  ): void {
    // Stage 1: Validation
    const validationResult = this.validate(eventDef, fields);

    // Stage 2: Enrichment
    const enrichedPayload = this.enrich(validationResult, metadata);

    // Stage 3: Monitoring
    const monitoredPayload = this.addMonitoring(enrichedPayload);

    // Stage 4: Emission
    this.emit(eventDef, monitoredPayload);
  }

  private validate(eventDef: EventDefinition, fields: any): ValidationResult {
    return {
      normalizedFields: validateFields(eventDef, fields),
      validationMetadata: buildValidationMetadata(...),
    };
  }

  private enrich(validation: ValidationResult, metadata: EventMetadata): Payload {
    return {
      eventKey: metadata.eventKey,
      fields: validation.normalizedFields,
      correlationId: metadata.correlationId,
      forkId: metadata.forkId,
      metadata: this.contextManager.snapshot(),
      timestamp: new Date().toISOString(),
      _validation: validation.validationMetadata,
    };
  }

  private addMonitoring(payload: Payload): Payload {
    const perf = samplePerformance(this.config.monitoring, this.perfContext);
    return perf ? { ...payload, _perf: perf } : payload;
  }

  private emit(eventDef: EventDefinition, payload: Payload): void {
    callBackendMethod(this.config.backend, eventDef.level, eventDef.message, payload);
  }
}
```

**Benefits:**

- ✅ Clear stage boundaries
- ✅ Easy to add middleware/hooks between stages
- ✅ Each stage independently testable
- ✅ Easy to add features (e.g., filtering, transformation)
- ✅ Performance profiling per stage

**Migration Path:**

1. Create `EventPipeline` class
2. Extract stages from `buildPayload`
3. Update Chronicle to use pipeline
4. Add stage tests

**Estimated Effort:** 2-3 hours

---

### R-7: Stronger Type Guards and Runtime Validation 🟢 LOW IMPACT

**Current Problem:**
Weak runtime validation in several places:

```typescript
// backend.ts - trusts that LOG_LEVELS are correct
export type LogLevel = keyof typeof LOG_LEVELS;

// validation.ts - weak type checking
if (typeof value === 'string') {
  /* trust it's string */
}

// No validation that backend actually implements LogBackend contract beyond methods existing
```

**Proposed Solution: Defensive Programming with Type Guards**

```typescript
// Stronger log level validation
export function isValidLogLevel(level: string): level is LogLevel {
  return level in LOG_LEVELS;
}

// Use in backend validation
export const validateBackendMethods = (
  backend: LogBackend,
  levels: readonly LogLevel[],
): string[] => {
  const missing: LogLevel[] = [];
  for (const level of levels) {
    if (!isValidLogLevel(level)) {
      throw new Error(`Invalid log level: ${level}`);
    }
    if (typeof backend[level] !== 'function') {
      missing.push(level);
    }
  }
  return missing;
};

// Stronger field type validation with guards
type FieldTypeValidator = (value: unknown) => boolean;

const fieldTypeValidators: Record<FieldType, FieldTypeValidator> = {
  string: (v): v is string => typeof v === 'string' && v.length > 0,
  number: (v): v is number => typeof v === 'number' && !Number.isNaN(v),
  boolean: (v): v is boolean => typeof v === 'boolean',
  error: (v): v is Error => v instanceof Error || (v && typeof v === 'object' && 'message' in v),
};

// Use in validation
export const validateFieldType = (value: unknown, expectedType: FieldType): boolean => {
  const validator = fieldTypeValidators[expectedType];
  return validator(value);
};

// Runtime config validation
export function validateChroniclerConfig(config: unknown): asserts config is ChroniclerConfig {
  if (!config || typeof config !== 'object') {
    throw new InvalidConfigError('Config must be an object');
  }

  if (!('backend' in config)) {
    throw new InvalidConfigError('Backend is required');
  }

  if (!('metadata' in config)) {
    throw new InvalidConfigError('Metadata is required');
  }

  // Validate metadata types
  const metadata = (config as any).metadata;
  for (const [key, value] of Object.entries(metadata)) {
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean' &&
      value !== null
    ) {
      throw new InvalidConfigError(
        `Invalid metadata value for key "${key}": must be string, number, boolean, or null`,
      );
    }
  }
}
```

**Benefits:**

- ✅ Fail fast with clear errors
- ✅ Better error messages
- ✅ Catches configuration errors at startup
- ✅ Type guards enable better TypeScript inference
- ✅ Defense against runtime type coercion

**Migration Path:**

1. Add type guard functions
2. Add config validation in `createChronicle`
3. Update field validation to use validators map
4. Add tests for invalid inputs

**Estimated Effort:** 2 hours

---

### Implementation Strategy

**Phase 1: Foundation (8-10 hours)**

- R-1: Convert to classes throughout
- R-2: Extract service objects
- Must be done first as other refactors depend on this

**Phase 2: Type Safety (4-6 hours)**

- R-4: Type-safe system events
- R-5: Strengthen ContextValue
- R-7: Type guards and validation
- Can be done in parallel

**Phase 3: Optimization (6-8 hours)**

- R-3: Extract correlation lifecycle
- R-6: Event pipeline pattern
- Builds on Phase 1 foundation

**Total Estimated Effort:** 18-24 hours

**Testing Strategy:**

- Run full test suite after each refactor
- Add new tests for extracted services
- Test edge cases with type guards
- Performance regression testing

---

### Alternative: Minimal Viable Refactoring

If 20+ hours is too much before v1.0, here's a **4-hour minimum**:

1. **R-4 only** (2 hours): Type-safe system events
   - Highest value for maintainability
   - No structural changes
   - Pure type safety win

2. **R-5 only** (1 hour): Document or remove array support in ContextValue
   - Clarifies type system
   - Minimal code changes

3. **R-7 only** (1 hour): Add config validation
   - Better error messages
   - Fails fast at startup

This gives you type safety improvements without architectural changes.

---

### Decision Framework

**Do the full refactoring if:**

- ✅ You plan to add major features post-v1.0
- ✅ You expect to maintain this for years
- ✅ You want to onboard other developers easily
- ✅ You value code clarity over speed to market

**Ship v1.0 first if:**

- ✅ You need to validate the concept with users
- ✅ You're a solo developer for now
- ✅ The current architecture is "good enough"
- ✅ You can do breaking changes in v2.0

**My Recommendation:** Ship v1.0 with minimal refactoring (R-4, R-5, R-7 only), then do full refactor for v1.1 or v2.0 based on user feedback.

---

## 📦 Publishing Checklist (Task P)

When ready to publish v1.0:

- [ ] **P.1**: Set up Changesets for versioning
- [ ] **P.2**: Configure npm publishing workflow
- [ ] **P.3**: Set up GitHub Actions CI/CD
- [ ] **P.4**: Choose license (MIT recommended)
- [ ] **P.5**: Final README polish with examples
- [ ] **P.6**: Create CHANGELOG.md
- [ ] **P.7**: Add badges to README (build status, npm version, coverage)

---

## 🎯 Decision Log

Key architectural decisions made:

1. **Field Types**: Keep simple (string, number, boolean, error) - no dates/enums in v1
2. **Error Serialization**: Use `stderr-lib` package
3. **Correlation Timeout**: Default 300 seconds (5 minutes)
4. **CLI Loading**: Use `tsx` for simplicity
5. **Package Name**: Publish as `chronicler` (unscoped)
6. **Backend Pattern**: Method interrogation, no wrapper classes
7. **Validation Strategy**: Return objects (don't throw), logs should succeed even with bad data
8. **System Events**: Use `chronicler.*` prefix for internal events
9. **Circular References**: Handle in backend formatters (not in Chronicler core)

---

## 📝 Notes

**Why Vitest over Jest?**

- Faster (ES modules native support)
- Better TypeScript integration
- Simpler configuration
- Active development (Jest maintenance slowed)

**Key Design Principles:**

- Type safety without runtime overhead
- Logs should never crash the application
- Validation errors are logged, not thrown
- Performance monitoring is opt-in
- Backend abstraction allows any logger

---

**Last Updated**: November 18, 2025  
**Next Milestone**: v1.0 Release Candidate

> **Phase 1 Complete** - Core library implemented and tested. Ready for final
> polish before v1.0.

---

## 🚀 NEXT ACTIONS (Start Here!)

**Deep code review completed Nov 18, 2025** - See full findings below

### Immediate Priority: High-Impact Quick Wins (4 hours)

These 7 items deliver maximum value with minimal risk. Complete before v1.0:

1. **backend.ts**: Change manual validation to loop (30 min) - See D-2
2. **backend.ts**: Add runtime method check in callBackendMethod (30 min) - See
   B-1
3. **perf.ts**: Wrap cpuUsage in try-catch (15 min) - See B-4
4. **events.ts**: Inline getAutoEvents (15 min) - See Q-11
5. **events.ts**: Simplify timeout defaulting (20 min) - See Q-12
6. **Create constants.ts**: Extract magic numbers/strings (45 min) - See Q-10
7. **Add JSDoc**: Document 4 complex functions (1 hour) - See DOC-1

**Next**: After quick wins, decide on Phase 2 (type safety) or publish v1.0

---

## 📊 Current Status

**Core Features**: ✅ All Complete (111 tests passing)

**Quality Metrics:**

- Test Coverage: 14 test files, 111 tests ✅
- Lint: Clean ✅
- TypeScript: No errors ✅
- Build: Passing ✅
- Lines of Code: 2,910 across 19 source files
- Code Quality: **Production-Ready** ⭐

**Deep Code Review (Nov 18, 2025):**

- Files Reviewed: 19/19 ✅
- Security Issues: 0 ✅
- Blocking Bugs: 0 ✅
- Type Safety Issues: 3 ⚠️
- DRY Violations: 4
- Edge Case Bugs: 4
- Quick Win Opportunities: 7 (4 hours)
- **Overall Rating**: Production-Ready with recommended improvements

**Recent Cleanup (Nov 16, 2025):**

- ✅ Fixed CPU monitoring module-level state bug
- ✅ Removed impossible `undefined` from `ContextCollisionDetail.existingValue`
- ✅ Removed unused `history` and `pendingCollisionDetails` from ContextStore
- ✅ Simplified `stringifyValue()` function
- ✅ Fixed API signatures to use `ContextRecord` instead of
  `Record<string, unknown>`
- ✅ Removed unused `correlationIdGenerator` field from CorrelationChronicleImpl
- ✅ **Removed nested correlation support** (breaking change - pre-v1.0)
- ✅ Simplified CorrelationChronicleImpl - removed delegate pattern
- ✅ **Implemented chronicler system events** (breaking change - pre-v1.0)
  - Collisions now emit `chronicler.contextCollision` immediately
  - Reserved field attempts emit `chronicler.reservedFieldAttempt`
  - Removed `contextCollisions` from `_validation` metadata
  - Removed `consumeCollisions()` from ContextStore
  - Reserved `chronicler.*` prefix for system events only

---

## 🔧 Pre-v1.0 Polish Tasks

### Critical Fixes

| #   | Issue                                                                    | Impact | Status             |
| --- | ------------------------------------------------------------------------ | ------ | ------------------ |
| C-1 | Backend type safety (`\| unknown` defeats TypeScript)                    | Medium | ☑ **FIXED**       |
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

**Recommendation**: Option A (strict). If users need extra properties, they can
use composition.

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

- `src/core/chronicle.ts` - Update `CorrelationTimer.start()` to always clear
  first

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

> **Note**: Avoid circular references in metadata and fields. Use serialization
> that handles circular refs (like `circular-json`) or validate inputs.

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

**Recommendation**: Option A - remove if truly unused, or document as "for
reference only"

**Files to Change:**

- `src/core/reserved.ts` - Add JSDoc comments explaining when types are for docs
  only
- OR remove unused types entirely

---

### Q-4: Side Effects in Constructor

**Current State:**

```typescript
// src/core/ContextStore.ts
constructor(baseContext
:
Record<string, SimpleValue>
)
{
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
    static validateFields(...) {
    }

    static validateContext(...) {
    }

    static validateBackend(...) {
    }

    static validateReservedFields(...) {
    }
}
```

**Option B: Keep domain-specific (Current approach is fine)**

- Backend validation belongs with backend
- Context validation belongs with context
- This is proper separation of concerns

**Recommendation**: Option B - current structure is good, just add
cross-references in comments

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
class EventEmitter {
...
}

class CorrelationManager {
...
}

class ForkManager {
...
}

class Chronicle {
    constructor(
        private emitter: EventEmitter,
        private correlations: CorrelationManager,
        private forks: ForkManager
    ) {
    }
}
```

**Option B: Extract large methods** (If any exist)

- Break 50+ line methods into smaller ones
- Keep high-level orchestration in Chronicle

**Option C: Accept as reasonable** (Recommended)

- 347 lines for a central orchestrator is fine
- It delegates complex logic to other modules
- Code is readable and well-tested

**Recommendation**: Option C - this is fine. If any method grows >50 lines,
extract it.

**Files to Change:**

- None required
- Optional: Add high-level class documentation explaining responsibilities

---

## 🎯 Deferred / Not Started

### Performance Benchmarks

**Status**: Deferred (optional)  
**Reason**: Basic measurements exist in tests. Formal benchmarks not critical
for v1.0.

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

### 🎯 Recommended Roadmap (Updated Nov 18)

#### Phase 1: High-Impact Quick Wins (4 hours) ⭐ DO THIS FIRST

These deliver maximum quality improvement with minimal time investment:

1. **D-2**: Iterate backend validation loop (30 min)
2. **B-1**: Add backend method runtime validation (30 min)
3. **B-4**: Add CPU monitoring try-catch (15 min)
4. **Q-11**: Inline `getAutoEvents` helper (15 min)
5. **Q-12**: Simplify timeout defaulting logic (20 min)
6. **Q-10/Q-2**: Create constants.ts file (45 min)
7. **DOC-1**: Add JSDoc to buildPayload, ContextStore.add, samplePerformance,
   defineCorrelationGroup (1 hour)

**Impact**: Fixes 2 bugs, removes duplication, improves documentation  
**Risk**: Very low - isolated changes

---

#### Phase 2: Type Safety Improvements (3 hours)

8. **T-1**: Fix LogBackend type safety (1 hour)
   - Remove `| unknown` from type
   - Update validateBackendMethods
   - Test with invalid backends

9. **T-2**: Type system event fields properly (1 hour)
   - Define field types for system events
   - Update emitSystemEvent signature

10. **B-2**: Document shallow snapshot limitation (30 min)
    - Add JSDoc warning about object references
    - Consider using structuredClone if Node 20+ only

**Impact**: Prevents entire class of type-related bugs  
**Risk**: Low - TypeScript will catch issues

---

#### Phase 3: DRY Refactoring (3 hours)

11. **D-1**: Extract duplicate system event emission (1 hour)
    - Create `emitBatchSystemEvents` helper
    - Refactor collision and reserved field emissions
    - Test both code paths

12. **D-3**: Refactor field type checking (1 hour)
    - Create validator map pattern
    - Simplify validateFields logic

13. **D-4**: Extract file system error handler (45 min)
    - Create CLI helper function
    - Update 3 call sites

**Impact**: -50-60 lines of code, better maintainability  
**Risk**: Low-medium - requires careful testing

---

#### Phase 4: Architecture & Documentation (4 hours)

14. **A-2**: Refactor createChronicleInstance parameters (1.5 hours)
    - Create ChronicleConfig interface
    - Update call sites
    - Update tests

15. **DOC-2**: Add conceptual documentation (1.5 hours)
    - File-level JSDoc for each core module
    - Explain key design decisions
    - Add architecture diagram to README

16. **Q-7/Q-8**: Improve consistency (1 hour)
    - Document error handling strategy
    - Clarify naming conventions
    - Add comments for unclear patterns

**Impact**: Better long-term maintainability  
**Risk**: Medium - touches multiple files

---

#### Phase 5: Optional Improvements (4 hours) - DEFER TO v1.1

17. **A-1**: Standardize class vs factory pattern (2 hours)
18. **A-3**: Split buildPayload into smaller functions (1 hour)
19. **A-4**: Extract completion/timer management (1 hour)
20. **T-3**: Tighten ContextValue type (30 min)
21. **Q-9**: Clean up unused types (30 min)

**Impact**: Cleaner architecture but not critical  
**Risk**: Medium-high - larger refactors

---

### 📊 Updated Sprint Plan

#### Sprint 1: Critical Fixes + Quick Wins (6-8 hours) ⚠️ BEFORE v1.0

- [x] C-2: CPU monitoring state - **DONE**
- [x] C-3: Timer memory leak check - **VERIFIED OK**
- [ ] **Phase 1: All quick wins** (Items 1-7 above)
- [ ] C-1: Backend type safety (same as T-1)
- [ ] C-4: Circular reference handling in example

**Outcome**: Production-ready v1.0 with high confidence

#### Sprint 2: Type Safety + DRY (6 hours) - v1.0 or v1.1

- [ ] **Phase 2: Type improvements** (Items 8-10)
- [ ] **Phase 3: DRY refactoring** (Items 11-13)
- [ ] Q-1: Consistent error classes

**Outcome**: Maintainable codebase

#### Sprint 3: Polish (4-6 hours) - v1.1

- [ ] **Phase 4: Architecture & docs** (Items 14-16)
- [ ] Q-3: Clean up unused types
- [ ] Q-4: Document constructor behavior
- [ ] Q-5: Add validation cross-references

**Outcome**: Excellent developer experience

#### Sprint 4: Optional (DEFER)

- [ ] **Phase 5: Optional improvements**
- [ ] Update Specification.md
- [ ] Performance benchmarks
- [ ] Security audit

---

### 🎯 Minimum Viable v1.0 (Sprint 1 Only)

**Time**: 6-8 hours  
**Deliverables**:

- ✅ All critical bugs fixed
- ✅ High-impact code quality improvements
- ✅ Core documentation complete
- ✅ Type safety for backends
- ✅ 111 tests passing

**What's deferred**:

- Advanced refactoring (Phases 3-5)
- Architecture improvements (can do incrementally)
- Non-critical documentation

**Confidence Level**: High - ready for production use

---

**Total Estimated Time**:

- **Minimum (v1.0)**: 6-8 hours (Sprint 1 only)
- **Recommended (v1.0)**: 12-14 hours (Sprints 1-2)
- **Complete Polish (v1.1)**: 16-20 hours (All sprints)

---

## 📝 Notes

- **setTimeout is global in Node.js** - No import needed ✅
- **Runtime type guards** - Not needed in TypeScript library. Users who bypass
  types with `as any` accept the risk ✅
- **No TODOs/FIXMEs in code** - Already clean ✅

---

**Status**: Ready for polish sprint. Core functionality is solid and
well-tested.

---

## 🔬 Deep Code Review (Nov 18, 2025)

Comprehensive review of all 19 source files identified the following areas for
improvement:

### 🚨 Critical Type Safety Issues

**T-1: Backend Type Safety Hole**

- **File**: `src/core/backend.ts` line 18
- **Issue**: `LogBackend` type uses `| unknown` which defeats TypeScript
- **Impact**: High - allows invalid backends to pass type checking
- **Fix**: Use strict Record type or index signature without unknown
- **Status**: ☐

**T-2: System Event Field Bypass**

- **File**: `src/core/chronicle.ts` line 107
- **Issue**: `emitSystemEvent` accepts `Record<string, unknown>` bypassing type
  safety
- **Impact**: Medium - system events don't benefit from field validation
- **Fix**: Use typed field definitions for system events
- **Status**: ☐

**T-3: Context Value Type Too Permissive**

- **File**: `src/core/context.ts` line 11
- **Issue**: `unknown[]` in ContextValue allows any array content
- **Impact**: Low - could allow invalid nested values
- **Fix**: Define specific allowed array types or remove array support
- **Status**: ☐

### 🔄 DRY Violations (High Value)

**D-1: Duplicate System Event Emission**

- **File**: `src/core/chronicle.ts` lines 148-195
- **Issue**: Nearly identical patterns for collision and reserved field events
- **Improvement**: Extract to `emitBatchSystemEvents(eventDef, items, mapper)`
- **Impact**: -30 lines, better maintainability
- **Status**: ☐

**D-2: Manual Backend Validation Loop**

- **File**: `src/core/backend.ts` lines 47-67
- **Issue**: Manually checks each log level instead of iterating
- **Improvement**: `for (const level of DEFAULT_REQUIRED_LEVELS) { ... }`
- **Impact**: -15 lines, more maintainable
- **Status**: ☐

**D-3: Repetitive Field Type Checking**

- **File**: `src/core/validation.ts` lines 30-42
- **Issue**: Separate type check for each field type
- **Improvement**: Use type map:
  `const validators = { string: (v) => typeof v === 'string', ... }`
- **Impact**: -20 lines, extensible
- **Status**: ☐

**D-4: File System Error Handling**

- **Files**: `config-loader.ts`, `ast-parser.ts`, `index.ts` (CLI)
- **Issue**: Same try-catch-rethrow pattern in 3+ places
- **Improvement**: Extract `handleFileSystemError(error, context)` helper
- **Impact**: Better consistency
- **Status**: ☐

### 🏗️ Architecture Improvements

**A-1: Mixed Class/Factory Pattern**

- **File**: `src/core/chronicle.ts`
- **Issue**: Uses class for CorrelationChronicle but factory for Chronicle
- **Concern**: Inconsistent pattern - why not both classes or both factories?
- **Decision Needed**: Standardize on one approach
- **Status**: ☐ (discuss)

**A-2: Too Many Function Parameters**

- **File**: `src/core/chronicle.ts` line 129
- **Issue**: `createChronicleInstance` takes 6 parameters, 3 functions
- **Improvement**: Use config object with named properties
- **Impact**: Better readability and extensibility
- **Status**: ☐

**A-3: buildPayload Does Too Much**

- **File**: `src/core/chronicle.ts` lines 60-94
- **Issue**: Single function handles validation, sampling, metadata, payload
- **Improvement**: Split into 4 focused functions
- **Impact**: Better testability and clarity
- **Status**: ☐

**A-4: CorrelationChronicleImpl Too Complex**

- **File**: `src/core/chronicle.ts` lines 245-370
- **Issue**: Manages timer, events, completion, validation, tracking (5+
  responsibilities)
- **Concern**: Moderate - 125 lines isn't terrible but could be cleaner
- **Improvement**: Consider extracting CompletionTracker and TimerManager
- **Status**: ☐ (optional)

### 🐛 Subtle Bugs & Edge Cases

**B-1: Missing Backend Method Validation**

- **File**: `src/core/backend.ts` line 86
- **Issue**: `callBackendMethod` doesn't check if level exists before calling
- **Impact**: Could crash with undefined[level] if backend is malformed
- **Fix**: Add runtime check or assertion
- **Status**: ☐

**B-2: Shallow Context Snapshot**

- **File**: `src/core/context.ts` line 62
- **Issue**: `snapshot()` does shallow copy - mutable objects are shared
- **Impact**: Parent/fork can accidentally modify shared object references
- **Fix**: Document limitation OR use structuredClone (Node 17+)
- **Status**: ☐

**B-3: Silent Timer Touch Failure**

- **File**: `src/core/chronicle.ts` line 293
- **Issue**: `touch()` does nothing if timeout/onTimeout undefined
- **Impact**: Could lead to mysterious timeout failures
- **Fix**: Throw error or log warning
- **Status**: ☐

**B-4: CPU Monitoring Not Defensive**

- **File**: `src/core/perf.ts` line 35
- **Issue**: No try-catch around `process.cpuUsage()` which may throw
- **Impact**: Single platform incompatibility crashes entire log
- **Fix**: Wrap in try-catch, return undefined on failure
- **Status**: ☐

### 🧹 Code Quality Improvements

**Q-7: Inconsistent Error Handling Strategy**

- **Files**: Multiple
- **Issue**: Some functions throw, others return error objects
  - `validateBackendMethods` throws
  - `validateFields` returns validation object
- **Improvement**: Document strategy: validation returns objects, config errors
  throw
- **Status**: ☐

**Q-8: Naming Confusion**

- **File**: `src/core/chronicle.ts`
- **Issues**:
  - `currentCorrelationId` vs `correlationIdGenerator` - both generate, naming
    unclear
  - `forkId` vs `forkCounter` - inconsistent ID/Counter naming
- **Improvement**: Rename for clarity or add better comments
- **Status**: ☐

**Q-9: Unused Type Complexity**

- **File**: `src/core/reserved.ts`
- **Issue**: Maintains 3 separate Sets but only uses combined checks
- **Improvement**: Remove individual Sets if not used, or document why needed
- **Status**: ☐

**Q-10: Magic Constants Throughout**

- **Files**: Multiple
- **Issues**:
  - `'0'` for root fork ID (5+ occurrences)
  - `300_000` for timeout (3+ occurrences)
  - `'chronicler.'` prefix (2+ occurrences)
  - `1000` for microsecond conversion
- **Improvement**: Extract to constants file (already planned as Q-2)
- **Status**: ☐ (in Q-2)

**Q-11: Unnecessary Small Functions**

- **File**: `src/core/events.ts` line 113
- **Issue**: `getAutoEvents` is 3-line wrapper around object spread
- **Improvement**: Inline where used (only 1 place)
- **Impact**: -10 lines, less indirection
- **Status**: ☐

**Q-12: Complex Conditional Logic**

- **File**: `src/core/events.ts` lines 95-110
- **Issue**: Timeout defaulting has 3 nested conditions
- **Improvement**: Simplify to:
  `const timeout = group.timeout ?? 300_000; if (timeout <= 0) throw ...`
- **Impact**: Clearer logic
- **Status**: ☐

### 📖 Documentation Improvements

**DOC-1: Missing Function Documentation**

- **Files**: Multiple
- **Functions needing JSDoc**:
  - `buildPayload` (chronicle.ts)
  - `ContextStore.add` (context.ts) - has complex behavior
  - `samplePerformance` (perf.ts) - CPU monitoring not explained
  - `defineCorrelationGroup` (events.ts) - complex normalization
- **Status**: ☐

**DOC-2: Unclear Semantic Distinctions**

- **Questions users will have**:
  - Why is `currentCorrelationId` a function vs a property?
  - What's the lifecycle of a CorrelationTimer?
  - When to use `fork()` vs `startCorrelation()`?
  - Difference between `PerfContext` and `PerfOptions`?
  - Difference between `ContextValue` and `SimpleValue`?
- **Improvement**: Add conceptual documentation to each file header
- **Status**: ☐

**DOC-3: Missing Usage Examples**

- **Files**: `events.ts`, `fields.ts`, `chronicle.ts`
- **Issue**: Complex APIs have no inline examples
- **Improvement**: Add `@example` tags to JSDoc
- **Status**: ☐

### 🎯 High-Impact Quick Wins (< 2 hours each)

1. **D-2**: Iterate backend validation (30 min)
2. **Q-11**: Inline `getAutoEvents` (15 min)
3. **Q-12**: Simplify timeout logic (20 min)
4. **B-1**: Add backend method validation (30 min)
5. **B-4**: Add CPU monitoring try-catch (15 min)
6. **Q-10**: Create constants file (45 min) - already planned
7. **DOC-1**: Add JSDoc to 4 functions (1 hour)

**Total Quick Wins**: ~4 hours, high impact on code quality

### 🔍 Deep Review Summary

**Lines of Code Reviewed**: 2,910 lines across 19 files

**Issues Found**:

- 🚨 Critical: 3 type safety issues
- ⚠️ Significant: 4 DRY violations, 4 architecture concerns
- 🐛 Subtle: 4 edge case bugs
- 🧹 Quality: 6 code smell issues
- 📖 Documentation: 3 categories of gaps

**Positive Findings**:

- ✅ No security vulnerabilities found
- ✅ Error handling is generally good
- ✅ Test coverage is comprehensive
- ✅ No TODOs/FIXMEs left in code
- ✅ TypeScript strict mode enabled
- ✅ Core algorithms are sound

**Overall Assessment**:
Code is **production-ready** but would benefit from 8-12 hours of focused
refactoring to address type safety, reduce duplication, and improve long-term
maintainability. No blocking issues for v1.0, but addressing high-impact items (
especially T-1, D-1, D-2, B-1) would significantly improve quality.

**Recommendation**:
Complete "High-Impact Quick Wins" (4 hours) before v1.0, defer remaining
improvements to v1.1 or as-needed basis.

---

### 📁 File-by-File Findings Reference

Quick lookup of all issues by file:

#### src/core/backend.ts (97 lines)

- **T-1** 🚨: Type safety hole with `| unknown` (line 18)
- **B-1** 🐛: Missing runtime validation (line 86)
- **D-2** 🔄: Manual validation loop (lines 47-67)
- **Q-7**: Throws errors vs returning validation objects

#### src/core/chronicle.ts (478 lines) ⚠️ Most complex file

- **T-2**: System event fields bypass type safety (line 107)
- **B-3** 🐛: Silent timer touch failure (line 293)
- **D-1** 🔄: Duplicate system event emission (lines 148-195)
- **A-1**: Mixed class/factory patterns (class at 245, factory at 129)
- **A-2**: Too many function parameters (line 129: 6 params)
- **A-3**: buildPayload does too much (lines 60-94)
- **A-4**: CorrelationChronicleImpl too complex (lines 245-370, 125 lines)
- **Q-8**: Naming confusion (currentCorrelationId vs correlationIdGenerator)
- **Q-10**: Magic constants ('0', '300_000')
- **DOC-1**: Missing JSDoc on buildPayload

#### src/core/context.ts (82 lines)

- **T-3**: ContextValue type too permissive (line 11: unknown[])
- **B-2** 🐛: Shallow snapshot shares references (line 62)
- **Q-4**: Constructor side effects (acceptable, needs JSDoc)
- **DOC-1**: ContextStore.add needs better docs

#### src/core/events.ts (125 lines)

- **Q-11**: Unnecessary getAutoEvents wrapper (lines 113-122)
- **Q-12**: Complex timeout logic (lines 95-110)
- **Q-10**: Magic constant 300_000
- **DOC-1**: defineCorrelationGroup needs examples

#### src/core/fields.ts (46 lines)

- **DOC-3**: Could use inline examples
- ✅ Generally clean, good types

#### src/core/perf.ts (66 lines)

- **B-4** 🐛: No try-catch on cpuUsage (line 35)
- **DOC-1**: CPU monitoring behavior not documented
- **DOC-2**: PerfContext vs PerfOptions distinction unclear

#### src/core/reserved.ts (87 lines)

- **Q-9**: Maintains 3 Sets but only uses combined checks (lines 44-46)
- **Q-3**: AllReservedFields type never used
- ✅ Otherwise clean

#### src/core/system-events.ts (73 lines)

- ✅ Clean, well-structured
- Properly uses reserved 'chronicler.' prefix

#### src/core/validation.ts (81 lines)

- **D-3** 🔄: Repetitive field type checking (lines 30-42)
- **Q-7**: Returns objects vs throwing (contrast with backend.ts)
- ✅ Generally good

#### src/core/errors.ts (21 lines)

- **Q-1**: Missing BackendMethodError, ValidationError classes
- ✅ Otherwise fine

#### src/index.ts (28 lines)

- ✅ Clean public API
- ✅ Good re-exports

#### CLI Files (src/cli/\*.ts)

**src/cli/config.ts** (58 lines):

- ✅ Clean

**src/cli/config-loader.ts** (84 lines):

- **D-4** 🔄: Duplicate error handling (lines 32-40, 52-60)
- ✅ Otherwise good

**src/cli/index.ts** (194 lines):

- **D-4** 🔄: Duplicate error handling
- ✅ Well-structured CLI

**src/cli/types.ts** (60 lines):

- ✅ Clean types

**src/cli/parser/ast-parser.ts** (166 lines):

- **D-4** 🔄: Duplicate error handling (lines 42-50)
- ✅ Good AST parsing logic

**src/cli/parser/validator.ts** (180 lines):

- ✅ Comprehensive validation
- ✅ Good error messages

**src/cli/generator/docs-generator.ts** (229 lines):

- ✅ Clean documentation generation
- ✅ Good formatting

#### Summary by Severity

| Severity                  | Count | Files Most Affected                                |
| ------------------------- | ----- | -------------------------------------------------- |
| 🚨 Critical (Type Safety) | 3     | backend.ts, chronicle.ts, context.ts               |
| 🐛 Bugs (Edge Cases)      | 4     | backend.ts, chronicle.ts, context.ts, perf.ts      |
| 🔄 DRY Violations         | 4     | chronicle.ts, backend.ts, validation.ts, CLI files |
| 🏗️ Architecture           | 4     | chronicle.ts (all)                                 |
| 📖 Documentation          | 12    | Multiple files                                     |
| 🧹 Code Quality           | 6     | Multiple files                                     |

**Hotspots** (files needing most attention):

1. **chronicle.ts** (478 lines) - 10 issues (T-2, B-3, D-1, A-1 through A-4,
   Q-8, Q-10, DOC-1)
2. **backend.ts** (97 lines) - 4 issues (T-1, B-1, D-2, Q-7)
3. **context.ts** (82 lines) - 3 issues (T-3, B-2, DOC-1)

**Clean files** (minimal issues):

- system-events.ts ✅
- index.ts ✅
- fields.ts ✅
- Most CLI files ✅

---

**Status**: Ready for polish sprint. Core functionality is solid and
well-tested.

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

Expected: JSON logs printed to console including `payload` with Chronicler
envelope.

### Generating documentation

```powershell
# from examples/winston-app
pnpm run docs
```

This generates `logs.md` in the example directory with auto-generated event
documentation.

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
