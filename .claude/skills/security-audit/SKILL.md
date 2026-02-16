---
name: security-audit
description: Comprehensive security audit covering OWASP Top 10, threat modeling, supply chain, secrets, CI security, ASVS, and hardening
disable-model-invocation: true
arguments:
  - name: scope
    description: "Comma-separated list of audit types (e.g., 'owasp,secrets,supply-chain') or 'all'. If omitted, you will be asked."
    required: false
---

# Comprehensive Security Audit

You are performing a comprehensive security audit of this project. This skill consolidates 7 security-focused audits into a single interactive workflow. All audits are **read-only** — they report findings but do not modify code.

## Available Audit Types

| Key            | Audit               | Focus                                                                         |
| -------------- | ------------------- | ----------------------------------------------------------------------------- |
| `owasp`        | OWASP Top 10:2025   | All 10 categories with Node.js/TypeScript-specific patterns                   |
| `threat-model` | STRIDE Threat Model | Data flows, trust boundaries, entry points, STRIDE analysis                   |
| `supply-chain` | Supply Chain Audit  | Lockfile integrity, install scripts, typosquatting, SBOM, .npmrc              |
| `secrets`      | Secrets Scan        | Hardcoded secrets, API keys, PII in logs, .gitignore coverage                 |
| `ci-security`  | CI/CD Security      | GitHub Actions: pinned SHAs, permissions, untrusted input, dangerous triggers |
| `asvs`         | ASVS Compliance     | OWASP ASVS 5.0 verification (L1/L2/L3)                                        |
| `hardening`    | Runtime Hardening   | HTTP headers, CORS, cookies, rate limiting, TLS, Node.js Permission Model     |

## Instructions

### 1. Determine audit scope

If `$ARGUMENTS` is provided, parse it as a comma-separated list of audit keys, or `all` for everything. Otherwise, ask the user which audits to run using a multi-select question. Default recommendation: `all`.

### 2. Load context

- Read `.claude/docs/TypeScript Coding Standard for Mission-Critical Systems.md` if present — cross-reference specific rules
- Read `.claude/skills/deep-review/references/security-checklist.md` for the existing security checklist
- Read `package.json` for dependencies and project metadata
- Determine the scope of source files: all `.ts` files under `src/`

### 3. Execute selected audits

For each selected audit, perform the analysis described below. Collect all findings with this structure:

```
SEVERITY: CRITICAL | HIGH | MEDIUM | LOW
AUDIT: <audit type key>
FILE: <file path>
LINE: <line number or N/A>
RULE: <coding standard rule or OWASP reference>
FINDING: <one-line description>
DETAILS: <explanation>
REMEDIATION: <specific fix>
```

---

### Audit: `owasp` — OWASP Top 10:2025

Search all `.ts` files for patterns matching each category:

**A01 Broken Access Control**: Routes without authorization middleware, missing role checks, direct object references without ownership validation (`/users/:id` without checking the authenticated user owns the resource).

**A02 Security Misconfiguration**: CORS set to `*`, missing Helmet/security headers, `NODE_ENV` not checked, verbose error responses exposing stack traces, default ports or credentials.

**A03 Supply Chain** (covered in detail by `supply-chain` audit): Flag unpinned dependencies, dynamic `require()`.

**A04 Cryptographic Failures**: `MD5`, `SHA1` usage for security, `Math.random()` for tokens/IDs, hardcoded keys/secrets, HTTP URLs for external services, missing TLS configuration.

**A05 Injection**: String concatenation in SQL/NoSQL queries, `eval()`, `new Function()`, `child_process.exec()` with user input, unsanitized template literals in query contexts, path traversal (`../` in file operations with user input).

**A06 Insecure Design**: Missing input validation schemas at boundaries, no rate limiting, no abuse-case tests.

**A07 Authentication Failures**: Hardcoded credentials, weak password hashing (MD5, SHA-256 without salt), JWT with `alg: none`, missing token expiration, no session regeneration.

**A08 Integrity Failures**: `JSON.parse()` on untrusted input without Zod/schema validation, missing subresource integrity, unsigned artifacts.

**A09 Logging Failures**: `console.log` with sensitive data (passwords, tokens, PII), no structured logging, missing security event audit trail, PII in error messages.

**A10 Exception Mishandling**: Bare `catch {}` blocks (swallowed errors), `throw` used for control flow (violates Rule 6.1), unhandled promise rejections, stack traces returned in HTTP responses, catch with `any` instead of `unknown`.

---

### Audit: `threat-model` — STRIDE Threat Model

1. **Map the system**: Identify entry points (routes, message consumers, CLI handlers), data stores (database connections, file system, cache), external services (HTTP clients, APIs, queues), and trust boundaries.

2. **STRIDE analysis** on each component:
   - **Spoofing**: Missing authentication, forgeable identities
   - **Tampering**: Data modifiable in transit/at rest without integrity checks
   - **Repudiation**: Missing audit logging for security-sensitive operations
   - **Information Disclosure**: Data leakage through errors, logs, or over-exposed API responses
   - **Denial of Service**: Unbounded loops (Rule 8.1), missing timeouts (Rule 4.2), no rate limiting
   - **Elevation of Privilege**: Missing authorization checks, role escalation paths

3. **Output**: A structured threat model with data flow description, threat inventory table, and mitigations mapped to coding standard rules.

---

### Audit: `supply-chain` — NPM Supply Chain

1. Read `package.json` and `package-lock.json`
2. **Lockfile integrity**: Check for HTTP URLs in resolved fields, git dependencies, untrusted registries
3. **Install scripts**: Run `npm query ':attr(scripts, [postinstall])' 2>/dev/null` or manually check `node_modules/*/package.json` for `preinstall`, `install`, `postinstall` scripts — these are the primary malware vector
4. **Typosquatting**: Compare dependency names against known popular packages; flag names that are 1-2 edits away from common packages
5. **Deprecated/unmaintained**: Run `npm outdated --json` and check for packages with no updates in 2+ years
6. **SBOM capability**: Check if CycloneDX or Syft is available/configured
7. **`.npmrc` hardening**: Check for `ignore-scripts=true`, `package-lock=true`, registry pinning
8. **CI usage**: Search `.github/workflows/` for `npm install` (should be `npm ci`)

---

### Audit: `secrets` — Secrets and Sensitive Data

Search the entire repository (all file types) for:

1. **API key patterns**: `AKIA[0-9A-Z]{16}` (AWS), `sk-[a-zA-Z0-9]{48}` (OpenAI), `ghp_[a-zA-Z0-9]{36}` (GitHub), `xoxb-` (Slack), `SG.` (SendGrid), `sk_live_` / `pk_live_` (Stripe)
2. **Private keys**: `-----BEGIN.*PRIVATE KEY-----`
3. **Connection strings**: `mongodb://.*:.*@`, `postgres://.*:.*@`, `mysql://.*:.*@`, `redis://.*:.*@`
4. **High-entropy strings**: Variable assignments containing 20+ character base64 or hex-encoded values
5. **Hardcoded credentials**: Variables named `password`, `secret`, `apiKey`, `token`, `auth` assigned to string literals
6. **`.gitignore` coverage**: Verify `.env`, `*.pem`, `*.key`, `credentials.*`, `.env.*` are ignored
7. **Logging safety**: Search for logging statements that reference variables named `password`, `token`, `secret`, `key`, `authorization`, `cookie`, `session`
8. **Error response safety**: Check HTTP error handlers for stack trace leakage or internal path disclosure

---

### Audit: `ci-security` — GitHub Actions Security

Scan all `.github/workflows/*.yml` files:

1. **Action pinning**: Flag every `uses:` with a tag (`@v4`, `@main`) instead of a full SHA. Provide the correct SHA for the latest release
2. **Permissions**: Flag missing top-level `permissions:` block. Flag `permissions: write-all` or overly broad permissions
3. **Untrusted input**: Flag `${{ github.event.issue.title }}`, `${{ github.event.pull_request.body }}`, `${{ github.event.*.head_ref }}` used inside `run:` blocks — these allow command injection
4. **Dangerous triggers**: Flag `pull_request_target` when combined with `actions/checkout` using `ref: ${{ github.event.pull_request.head.sha }}`
5. **Secret exposure**: Flag secrets accessible to fork PRs
6. **StepSecurity**: Note if `harden-runner` step is missing

---

### Audit: `asvs` — OWASP ASVS 5.0 Compliance

Ask the user for the target verification level (default: L1). Assess automatable requirements:

- **V2 Authentication**: Password hashing (Argon2/bcrypt/scrypt), MFA support, credential storage
- **V4 Access Control**: Route authorization, deny-by-default, resource ownership checks
- **V5 Validation**: Input validation at all boundaries, output encoding, parameterized queries
- **V6 Cryptography**: Minimum 128-bit security, no deprecated algorithms, no custom crypto
- **V7 Error Handling**: No information leakage, structured logging, audit trail
- **V8 Data Protection**: Sensitive data classification, encryption at rest
- **V9 Tokens**: JWT algorithm pinning, expiration, audience validation
- **V13 API**: Auth on all endpoints, rate limiting, response filtering
- **V14 Configuration**: Security headers, CORS, dependency management

For non-automatable items, generate a manual review checklist. Calculate a compliance percentage.

---

### Audit: `hardening` — Runtime Configuration Hardening

1. **HTTP headers**: Check for Helmet.js or manual configuration of: `Content-Security-Policy`, `Strict-Transport-Security` (max-age >= 31536000), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`
2. **CORS**: Verify origin allowlist is not `*` in production
3. **Cookies**: Check for `HttpOnly`, `Secure`, `SameSite` on all cookie operations
4. **Request limits**: Body parser size limits configured, rate limiting middleware present
5. **TLS**: No HTTP URLs for external services, TLS 1.2+ enforcement
6. **Environment**: `NODE_ENV=production` checks, debug mode disabled
7. **Node.js Permission Model**: Check if `--permission` flag or permission config is used for filesystem/network restriction

---

### 4. Generate consolidated report

Output a structured report to the console:

```markdown
# Security Audit Report

**Date**: YYYY-MM-DD
**Project**: <name>
**Audits performed**: <list>
**Files analyzed**: N

## Executive Summary

<2-4 sentences on overall security posture>

**Findings**: N total (X critical, Y high, Z medium, W low)

## Critical Findings

- [ ] 🔴 `file:line` — **[OWASP A05]** Description
- [ ] 🔴 `file:line` — **[Secrets]** Description

## High Findings

- [ ] 🟠 `file:line` — **[Supply Chain]** Description

## Medium Findings

- [ ] 🟡 `file:line` — **[Hardening]** Description

## Low Findings

- [ ] 🔵 `file:line` — **[ASVS V14]** Description

## Per-Audit Details

### OWASP Top 10:2025

<detailed findings by category>

### STRIDE Threat Model

<data flow analysis, threat inventory>

### Supply Chain

<lockfile, install scripts, typosquatting findings>

### Secrets Scan

<secret patterns found, logging safety>

### CI/CD Security

<per-workflow findings>

### ASVS Compliance

<compliance matrix with percentages>

### Runtime Hardening

<header/CORS/cookie/TLS findings>

## Recommendations

1. Prioritized action list
2. ...

---

_Generated by /security-audit_
```

### 5. Do not modify any files — this is a read-only audit.
