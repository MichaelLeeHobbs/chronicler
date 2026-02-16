---
name: scaffold-ci
description: Generate a hardened CI/CD pipeline with quality gates, release automation, and observability setup
disable-model-invocation: true
arguments:
  - name: components
    description: "Comma-separated list of components to set up (e.g., 'pipeline,release,observability'). If omitted, you will be asked."
    required: false
---

# Scaffold CI/CD Pipeline

You are setting up a production-grade CI/CD pipeline for a mission-critical TypeScript project. This skill consolidates pipeline generation, quality gates, and release automation into a single workflow.

## Available Components

| Key             | Component           | Description                                                                  |
| --------------- | ------------------- | ---------------------------------------------------------------------------- |
| `pipeline`      | CI Pipeline         | GitHub Actions workflow with type-check, lint, test, coverage, security scan |
| `release`       | Release Automation  | Automated versioning and publishing via semantic-release or changesets       |
| `observability` | Observability Setup | OpenTelemetry + Pino structured logging with trace-log correlation           |

## Instructions

### 1. Determine components

If `$ARGUMENTS` is provided, parse it as a comma-separated list of component keys. Otherwise, ask the user which components they want using a multi-select question.

### 2. Load project context

Read:

- `package.json` — project name, scripts, dependencies
- `tsconfig.json` — verify TypeScript is configured
- `.github/workflows/` — check for existing workflows (avoid overwriting)
- `.claude/docs/TypeScript Coding Standard for Mission-Critical Systems.md` — if present, cross-reference rules for quality gates

---

## Component: `pipeline` — CI Pipeline

Generate `.github/workflows/ci.yml` with the following characteristics:

### Security hardening (per GitHub Actions best practices)

- **All third-party actions pinned to full SHA hashes** — never use tags like `@v4`
- **Top-level `permissions: contents: read`** — escalate per-job only where needed
- **Concurrency groups** — cancel superseded runs on the same branch
- **No untrusted input interpolation** — use environment variables, not `${{ github.event.*.body }}` in `run:` blocks

### Pipeline stages (all run in parallel where independent)

1. **Type Check**: `npx tsc --noEmit`
2. **Lint**: `npm run lint` (expects `--max-warnings 0` per Rule 3.3)
3. **Test + Coverage**: `npm run test:coverage` with coverage threshold enforcement:
   - Branches >= 95% (Rule 9.1)
   - Fail the job if thresholds are not met
4. **Security Scan**: `npm audit --audit-level=high` — fail on high/critical vulnerabilities
5. **Dead Code Check** (optional): `npx knip` if Knip is in devDependencies
6. **Semgrep** (optional): Run custom rules if `.semgrep/` directory exists

### Pipeline configuration

- Use `actions/setup-node` with caching enabled (`cache: 'npm'`)
- Use `npm ci` (not `npm install`) for reproducible installs
- Matrix strategy for Node.js versions if the user wants multi-version testing
- Status checks: configure as required checks for branch protection

### Template structure

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<SHA>
      - uses: actions/setup-node@<SHA>
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npx tsc --noEmit

  lint:
    # ... similar structure

  test:
    # ... with coverage thresholds

  security-scan:
    # ... npm audit
```

Look up the **latest SHA hashes** for each action by running:

- `gh api repos/actions/checkout/commits/main --jq '.sha'` (or use `!`command`` syntax)
- `gh api repos/actions/setup-node/commits/main --jq '.sha'`

If `gh` is not available, use well-known recent SHAs and add a comment telling the user to verify them.

---

## Component: `release` — Release Automation

Ask the user which approach they prefer:

### Option A: semantic-release (fully automated)

1. Generate `.releaserc.json`:
   ```json
   {
     "branches": ["main"],
     "plugins": [
       "@semantic-release/commit-analyzer",
       "@semantic-release/release-notes-generator",
       "@semantic-release/changelog",
       "@semantic-release/npm",
       "@semantic-release/github",
       [
         "@semantic-release/git",
         {
           "assets": ["CHANGELOG.md", "package.json"],
           "message": "chore(release): ${nextRelease.version}\n\n${nextRelease.notes}"
         }
       ]
     ]
   }
   ```
2. Generate `commitlint.config.js` enforcing Conventional Commits
3. Add a Husky `commit-msg` hook: `npx --no -- commitlint --edit "$1"`
4. Generate `.github/workflows/release.yml` triggered on push to `main`:
   - Permissions: `contents: write`, `issues: write`, `pull-requests: write`
   - Only runs after CI passes
   - Uses `cycjimmy/semantic-release-action` (SHA-pinned)
5. List install commands (do NOT run automatically):
   ```bash
   npm install --save-exact -D semantic-release @semantic-release/changelog @semantic-release/git @commitlint/cli @commitlint/config-conventional
   ```

### Option B: changesets (controlled releases)

1. Generate `.changeset/config.json`
2. Generate `.github/workflows/release.yml` using `changesets/action` (SHA-pinned)
3. Add npm scripts: `"changeset"`, `"version"`, `"release"`
4. List install commands:
   ```bash
   npm install --save-exact -D @changesets/cli @changesets/changelog-github
   ```

Both options: create `CHANGELOG.md` if it doesn't exist (Keep a Changelog format).

---

## Component: `observability` — Observability Setup

1. Generate `src/observability/` module with:
   - `src/observability/logger.ts` — Pino logger factory with:
     - JSON structured logging
     - Log levels: trace, debug, info, warn, error, fatal
     - Request correlation ID injection
     - OpenTelemetry trace ID correlation
     - No PII in logs (document which fields to redact)
   - `src/observability/tracer.ts` — OpenTelemetry SDK initialization with:
     - Auto-instrumentation for HTTP, Express/Fastify (detected from deps)
     - OTLP exporter configuration via environment variables
     - Sampling strategy configuration
   - `src/observability/metrics.ts` — OpenTelemetry Meter for custom metrics
   - `src/observability/index.ts` — Barrel export
2. All code follows the coding standard: Result pattern, readonly, no any, TSDoc, <= 40 lines per function
3. Generate environment variable documentation:
   ```
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
   OTEL_SERVICE_NAME=<project-name>
   LOG_LEVEL=info
   ```
4. Suggest a `docker-compose.observability.yml` for local Jaeger + Prometheus
5. List install commands:
   ```bash
   npm install --save-exact pino @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http
   npm install --save-exact -D pino-pretty
   ```

---

## Summary

After generating all selected components:

1. List all created/modified files
2. List all install commands the user needs to run
3. Suggest setting up branch protection rules to require the CI checks
4. If release was set up, remind about commit message conventions
