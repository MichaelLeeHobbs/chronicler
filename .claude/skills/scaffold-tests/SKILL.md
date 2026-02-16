---
name: scaffold-tests
description: Set up advanced testing infrastructure — mutation testing, contract testing, load testing, and chaos testing
disable-model-invocation: true
arguments:
  - name: type
    description: "Comma-separated list of test types (e.g., 'mutation,load') or 'all'. If omitted, you will be asked."
    required: false
---

# Scaffold Advanced Testing Infrastructure

You are setting up advanced testing infrastructure for a mission-critical TypeScript project. This skill goes beyond the basic unit/integration tests set up by `/project-init` and `/scaffold-module`, adding specialized testing techniques that validate test quality, service integration, performance, and resilience.

## Available Test Types

| Key        | Test Type        | Tool              | Purpose                                                         |
| ---------- | ---------------- | ----------------- | --------------------------------------------------------------- |
| `mutation` | Mutation Testing | Stryker Mutator   | Validates test quality — are your tests actually catching bugs? |
| `contract` | Contract Testing | Pact              | Validates API contracts between services                        |
| `load`     | Load Testing     | k6                | Validates performance under expected and peak traffic           |
| `chaos`    | Chaos Testing    | node-chaos-monkey | Validates resilience under failure conditions                   |

## Instructions

### 1. Determine test types

If `$ARGUMENTS` is provided, parse it as a comma-separated list of keys. Otherwise, ask the user which test types to set up using a multi-select question.

### 2. Load context

- Read `package.json` for test runner (Vitest expected per coding standard), dependencies, and scripts
- Read `tsconfig.json` for TypeScript configuration
- Scan `src/` for existing modules (to scope mutation testing)
- Read `.claude/docs/TypeScript Coding Standard for Mission-Critical Systems.md` if present

---

## Type: `mutation` — Mutation Testing (Stryker)

Mutation testing evaluates test suite quality by making small changes to source code ("mutants") and checking if tests detect them. The coding standard requires >= 95% branch coverage (Rule 9.1) — mutation testing validates that this coverage is meaningful.

1. **Generate `stryker.config.mjs`**:

   ```javascript
   /** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
   export default {
     packageManager: 'npm',
     reporters: ['html', 'clear-text', 'progress'],
     testRunner: 'vitest',
     checkers: ['typescript'],
     tsconfigFile: 'tsconfig.json',
     vitest: {
       configFile: 'vitest.config.ts',
     },
     coverageAnalysis: 'perTest',
     incremental: true,
     incrementalFile: '.stryker-tmp/incremental.json',
     thresholds: {
       high: 90,
       low: 80,
       break: 75,
     },
     mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.spec.ts', '!src/**/index.ts'],
     tempDirName: '.stryker-tmp',
   };
   ```

2. **Add to `.gitignore`**: `.stryker-tmp/`, `reports/mutation/`

3. **Add npm scripts**:

   ```json
   {
     "mutation-test": "stryker run",
     "mutation-test:incremental": "stryker run --incremental"
   }
   ```

4. **List install commands**:

   ```bash
   npm install --save-exact -D @stryker-mutator/core @stryker-mutator/vitest-runner @stryker-mutator/typescript-checker
   ```

5. **Usage guidance**: Explain that mutation testing is computationally expensive. Recommend:
   - Run incrementally during development (`npm run mutation-test:incremental`)
   - Run full mutation analysis in CI on a nightly schedule
   - Start with core business logic modules, not the entire codebase
   - A surviving mutant means: "if this code changed, no test would fail"

6. **If CI pipeline exists** (`.github/workflows/`), suggest adding a nightly mutation testing job.

---

## Type: `contract` — Contract Testing (Pact)

Contract testing validates API compatibility between services without requiring all services to run simultaneously. Consumer-Driven Contracts (CDC) let the consumer define expectations and the provider verify them.

1. **Ask the user**:
   - Is this service a consumer, provider, or both?
   - What API endpoints/operations need contracts?
   - Is there a Pact Broker URL (or use local file-based contracts)?

2. **Generate directory structure**: `tests/contract/`

3. **For consumers**, generate `tests/contract/consumer.test.ts`:

   ```typescript
   import { describe, it, expect } from 'vitest';
   import { PactV3, MatchersV3 } from '@pact-foundation/pact';

   const provider = new PactV3({
     consumer: '<consumer-name>',
     provider: '<provider-name>',
     dir: './pacts',
   });

   describe('<Provider> API Contract', () => {
     it('should return a valid response for GET /endpoint', async () => {
       await provider
         .given('a specific state')
         .uponReceiving('a request for data')
         .withRequest({
           method: 'GET',
           path: '/endpoint',
         })
         .willRespondWith({
           status: 200,
           headers: { 'Content-Type': 'application/json' },
           body: MatchersV3.like({
             // Match the expected shape using the module's Zod schema
           }),
         })
         .executeTest(async (mockServer) => {
           // Call your client code against mockServer.url
           // Assert on the result
         });
     });
   });
   ```

4. **For providers**, generate `tests/contract/provider.test.ts`:

   ```typescript
   import { Verifier } from '@pact-foundation/pact';

   describe('Provider Verification', () => {
     it('should fulfill all consumer contracts', async () => {
       const verifier = new Verifier({
         providerBaseUrl: 'http://localhost:3000',
         pactUrls: ['./pacts/consumer-provider.json'],
         // Or: pactBrokerUrl: process.env.PACT_BROKER_URL,
         stateHandlers: {
           'a specific state': async () => {
             // Set up the provider state
           },
         },
       });
       await verifier.verifyProvider();
     });
   });
   ```

5. **Generate `pacts/.gitkeep`** and **`tests/contract/README.md`** explaining the workflow.

6. **Add npm scripts**:

   ```json
   {
     "test:contract:consumer": "vitest run tests/contract/consumer",
     "test:contract:provider": "vitest run tests/contract/provider"
   }
   ```

7. **List install commands**:
   ```bash
   npm install --save-exact -D @pact-foundation/pact
   ```

---

## Type: `load` — Load Testing (k6)

Load testing validates performance under expected and peak traffic conditions. k6 provides high-performance execution with built-in thresholds.

1. **Ask the user**:
   - Target service URL/endpoint (default: `http://localhost:3000`)
   - Expected requests per second at steady state
   - Acceptable latency thresholds (p95, p99)
   - Acceptable error rate threshold
   - Test duration

2. **Generate `tests/load/`** directory with:

   **`tests/load/config.ts`**: Typed configuration constants

   ```typescript
   export const LOAD_TEST_CONFIG = {
     baseUrl: process.env.LOAD_TEST_URL ?? 'http://localhost:3000',
     thresholds: {
       http_req_duration_p95_ms: 200,
       http_req_duration_p99_ms: 500,
       http_req_failed_rate: 0.01, // 1% error rate
     },
     scenarios: {
       warmUp: { duration: '30s', vus: 5 },
       rampUp: { duration: '1m', target: 50 },
       sustained: { duration: '3m', vus: 50 },
       spike: { duration: '30s', target: 100 },
       coolDown: { duration: '30s', target: 0 },
     },
   } as const;
   ```

   **`tests/load/main.ts`**: k6 test script with scenarios, thresholds, and checks.

   **`tests/load/README.md`**: How to run tests, interpret results, and adjust scenarios.

3. **Add npm scripts**:

   ```json
   {
     "test:load": "k6 run tests/load/main.ts"
   }
   ```

4. **Note**: k6 must be installed separately (it's a Go binary, not an npm package). Provide installation instructions for the user's platform.

---

## Type: `chaos` — Chaos Testing (node-chaos-monkey)

Chaos testing validates system resilience by injecting controlled failures. This directly tests the coding standard's requirements around timeouts (Rule 4.2), error handling (Rule 6.2), and bounded operations (Rule 8.1).

1. **Generate `tests/chaos/`** directory with:

   **`tests/chaos/config.ts`**: Chaos scenario configuration

   ```typescript
   export const CHAOS_SCENARIOS = {
     dependencyTimeout: {
       description: 'Simulates slow downstream service',
       validates: 'AbortController + Promise.race (Rule 4.2)',
     },
     memoryPressure: {
       description: 'Validates memory limits and OOM handling',
       validates: 'Resource disposal (Rule 5.1)',
     },
     processCrash: {
       description: 'Validates restart and data consistency',
       validates: 'Graceful shutdown (Rule 12.2)',
     },
     random500: {
       description: 'Injects random 500 errors on routes',
       validates: 'Error handling (Rule 6.2)',
     },
     eventLoopBlock: {
       description: 'Blocks event loop to test health check responsiveness',
       validates: 'Timeout handling (Rule 4.2)',
     },
   } as const;
   ```

   **`tests/chaos/runner.ts`**: Test harness that:
   - Checks `CHAOS_ENABLED=true` environment variable (safety guard — never set in production)
   - Starts the application with chaos middleware injected
   - Runs a workload against the application
   - Validates that health checks still respond correctly
   - Validates that error counts are within acceptable bounds

   **`tests/chaos/README.md`**: Explains chaos testing, safety guardrails, and how to run scenarios.

2. **Add npm scripts**:

   ```json
   {
     "test:chaos": "CHAOS_ENABLED=true vitest run tests/chaos"
   }
   ```

3. **List install commands**:

   ```bash
   npm install --save-exact -D node-chaos-monkey
   ```

4. **Safety guardrails**: Emphasize that chaos testing must NEVER run in production. The `CHAOS_ENABLED` env var must not be set in any production environment. Add a comment in `.env.example` documenting this.

---

## Summary

After setting up all selected test types:

1. List all created files and directories
2. List all install commands the user needs to run
3. Explain how each test type integrates with CI:
   - `mutation`: Nightly scheduled job
   - `contract`: On every PR (consumer tests) and on release (provider verification)
   - `load`: Weekly scheduled job or before each release candidate
   - `chaos`: Periodic game day exercises, not on every PR
4. Note that all generated test code follows the coding standard (no `any`, Result patterns where applicable, TSDoc)
