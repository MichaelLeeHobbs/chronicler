# Deep Review Checklist — Mission-Critical TypeScript

Comprehensive checklist covering all coding standard rules for deep review analysis.

**Legend**: **(A)** = Automated by ESLint/TypeScript (CI catches these deterministically) | **(M)** = Manual judgment required (LLM review)

## Compiler & Tooling (Section 3)

### Rule 3.1: Strict Compiler Configuration

- [ ] (A) `strict: true` in tsconfig.json
- [ ] (A) All additional strict flags enabled (noUncheckedIndexedAccess, exactOptionalPropertyTypes, etc.)
- [ ] (M) `skipLibCheck: false` — assess whether exceptions are justified

### Rule 3.2: Zero Tolerance for `any`

- [ ] (A) No `any` in source code — `@typescript-eslint/no-explicit-any`
- [ ] (M) No `any` in type assertions without documented justification
- [ ] (M) `unknown` used for untyped inputs with proper narrowing

### Rule 3.3: Static Analysis

- [ ] (A) ESLint configured with @typescript-eslint
- [ ] (A) `--max-warnings 0` enforced
- [ ] (A) Pre-commit hooks running lint + type-check

### Rule 3.4: Dependency Management

- [ ] (M) All versions pinned to exact (no ^, ~, \*, ranges)
- [ ] (A) No dynamic `require()` — `import/no-dynamic-require`
- [ ] (M) Dynamic `import()` calls have documented justification
- [ ] (M) Minimal third-party deps (prefer Node.js built-ins)

### Rule 3.5: No Traditional Enums

- [ ] (A) No `enum` keyword in source code — `no-restricted-syntax: TSEnumDeclaration`
- [ ] (M) Using `as const` objects or string literal unions appropriately

## Async Execution (Section 4)

### Rule 4.1: No Floating Promises

- [ ] (A) Every Promise is awaited, .then/.catch'd, or returned — `@typescript-eslint/no-floating-promises`
- [ ] (M) No `void` on async calls without documented justification

### Rule 4.2: Mandatory Timeouts

- [ ] (M) All network/IO operations have timeouts
- [ ] (M) AbortController used for cancellation
- [ ] (M) Default timeout ≤ 30 seconds

### Rule 4.3: Bounded Parallelism

- [ ] (M) Promise.all bounded (p-limit or semaphore)
- [ ] (M) No unbounded parallel operations on user-controlled input

### Rule 4.4: Async Iteration Safety

- [ ] (M) for-await-of only on trusted iterables
- [ ] (M) Custom async iterators implement cancellation

## Scope & Memory (Section 5)

### Rule 5.1: Resource Disposal

- [ ] (M) Event listeners paired with cleanup
- [ ] (M) Timers cleared in finally/dispose
- [ ] (M) Streams properly closed

### Rule 5.2: No `var`

- [ ] (A) `const` by default, `let` only when needed — `no-var`, `prefer-const`
- [ ] (M) No global mutable state

### Rule 5.3: Safe `this`

- [ ] (M) Arrow functions for callbacks
- [ ] (M) Explicit `this` typing where dynamic binding used

## Error Handling (Section 6)

### Rule 6.1: Reserved Exceptions

- [ ] (M) throw only for unrecoverable panics — requires judgment on each throw site
- [ ] (M) No throw for control flow (validation, expected IO failures)

### Rule 6.2: Result Pattern

- [ ] (M) Fallible functions return Result<T, E>
- [ ] (M) All Result values checked before accessing .value
- [ ] (M) tryCatch/tryCatchSync used for wrapping

### Rule 6.3: Logging

- [ ] (A) No `console.log` in production code — `no-console` (allow warn, error)
- [ ] (M) Structured logger used instead
- [ ] (M) Error context included (stack, inputs, request IDs)
- [ ] (M) No sensitive data in logs

## Defensive Coding (Section 7)

### Rule 7.1: Immutability

- [ ] (A) `readonly` on class fields — `@typescript-eslint/prefer-readonly`
- [ ] (M) ReadonlyArray, ReadonlyMap, ReadonlySet used where appropriate
- [ ] (M) No in-place mutations of function arguments

### Rule 7.2: Runtime Validation

- [ ] (M) All external inputs validated (Zod preferred)
- [ ] (M) Type guards used instead of assertions
- [ ] (M) Outputs sanitized (XSS, SQL injection prevention)

### Rule 7.3: Branded Types

- [ ] (M) Domain primitives use branded types (not raw string/number)
- [ ] (M) Factory functions validate before branding

### Rule 7.4: Security

- [ ] (M) No hardcoded secrets
- [ ] (M) Parameterized queries (no SQL concatenation)
- [ ] (M) Security headers set on HTTP responses
- [ ] (M) Audited crypto libraries only
- [ ] (A) No `eval()` — `no-eval`

## Control Flow (Section 8)

### Rule 8.1: Bounded Loops

- [ ] (M) All loops have documented upper bounds
- [ ] (M) No while(true) without counter + max check

### Rule 8.2: No Recursion

- [ ] (M) No direct recursion
- [ ] (M) No mutual/indirect recursion
- [ ] (M) Iterative algorithms with explicit stacks

### Rule 8.3: Exhaustive Matching

- [ ] (A) All switch statements exhaustively checked — `@typescript-eslint/switch-exhaustiveness-check`
- [ ] (M) All union type checks are exhaustive (non-switch patterns)

### Rule 8.4: Function Design

- [ ] (A) Functions ≤ 40 lines — `max-lines-per-function`
- [ ] (A) Functions ≤ 4 parameters — `max-params`
- [ ] (A) Max 3 levels of nesting — `max-depth`
- [ ] (A) Cyclomatic complexity ≤ 10 — `complexity`
- [ ] (M) Single responsibility — requires judgment

## Testing (Section 9)

### Rule 9.1: Test Coverage

- [ ] (M) ≥95% branch coverage
- [ ] (M) Edge cases tested (empty, null, boundary)
- [ ] (M) Property-based tests for algorithms

### Rule 9.2: Fuzzing

- [ ] (M) Critical paths fuzzed (auth, payments, persistence)

### Rule 9.3: Observability

- [ ] (M) Metrics instrumented for critical functions
- [ ] (M) Health check endpoints

## Documentation (Section 10)

### Rule 10.1: TSDoc

- [ ] (M) All public APIs documented — quality assessment
- [ ] (M) @param, @returns, @throws annotations — accuracy check
- [ ] (M) Usage examples for complex functions

### Rule 10.2: ADRs

- [ ] (M) Significant decisions documented in docs/adr/

### Rule 10.3: Modularity

- [ ] (M) Clear module boundaries
- [ ] (A) No circular dependencies — `import/no-cycle`
- [ ] (M) Dependency Inversion (domain doesn't depend on infrastructure)
