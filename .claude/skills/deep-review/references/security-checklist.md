# Security Review Checklist — Mission-Critical TypeScript

Focused security checklist based on OWASP Top 10 and coding standard Rules 7.2, 7.4.

**Legend**: **(A)** = Automated by ESLint/TypeScript (CI catches these deterministically) | **(M)** = Manual judgment required (LLM review)

## Input Validation (Rule 7.2)

- [ ] (M) **All external inputs validated** — API bodies, query params, headers, env vars, file contents
- [ ] (M) **Schema validation at boundaries** — Zod, Valibot, or equivalent used at every entry point
- [ ] (M) **Length limits enforced** — String inputs have min/max length constraints
- [ ] (M) **Numeric ranges checked** — Numbers validated for min/max, integer vs. float
- [ ] (M) **Type coercion avoided** — No implicit string-to-number or similar conversions
- [ ] (M) **Allowlists over denylists** — Validation accepts known-good patterns, not blocks known-bad

## Injection Prevention (OWASP A03)

- [ ] (M) **SQL injection** — Parameterized queries only; no string concatenation in SQL
- [ ] (M) **NoSQL injection** — User input not passed directly to MongoDB operators ($gt, $regex, etc.)
- [ ] (M) **Command injection** — No `child_process.exec()` with user input; use `execFile` with argument arrays
- [ ] (A) **No eval/Function()** — `no-eval` ESLint rule
- [ ] (M) **XSS prevention** — Output encoding/escaping in HTML contexts; CSP headers set
- [ ] (M) **Path traversal** — File paths validated; no `../` or user-controlled paths to `fs` operations
- [ ] (M) **Template injection** — No user input in template strings evaluated by template engines
- [ ] (M) **LDAP/XML injection** — Input sanitized before passing to LDAP queries or XML parsers

## Authentication & Authorization (OWASP A01, A07)

- [ ] (M) **No hardcoded credentials** — Secrets from env vars or vault only
- [ ] (M) **Password hashing** — bcrypt, scrypt, or Argon2 (never MD5, SHA-1, or plain SHA-256)
- [ ] (M) **Session management** — Secure cookies (HttpOnly, Secure, SameSite)
- [ ] (M) **Token validation** — JWTs verified with proper algorithm pinning (no `alg: none`)
- [ ] (M) **Authorization checks** — Every endpoint verifies user permissions (not just authentication)
- [ ] (M) **Rate limiting** — Login and sensitive endpoints rate-limited

## Cryptography (Rule 7.4)

- [ ] (M) **Audited libraries only** — Node.js `crypto` module or `libsodium.js`
- [ ] (M) **No custom crypto** — No hand-rolled encryption, hashing, or PRNG
- [ ] (M) **Secure random** — `crypto.randomBytes()` or `crypto.randomUUID()` for random values
- [ ] (M) **Key management** — Keys never in source code; rotated periodically
- [ ] (M) **TLS/HTTPS** — All external communications over TLS 1.2+

## Secrets & Data Exposure (OWASP A02, OWASP A04)

- [ ] (M) **No secrets in code** — `.env`, API keys, passwords, tokens not in source files
- [ ] (M) **No secrets in logs** — Logging does not include passwords, tokens, or PII
- [ ] (M) **No secrets in errors** — Error messages don't leak internal paths, stack traces, or config
- [ ] (M) **.gitignore coverage** — `.env`, `*.pem`, `*.key`, credentials files excluded from git
- [ ] (M) **Sensitive data encrypted at rest** — PII, financial data encrypted in databases
- [ ] (M) **Minimal data exposure** — APIs return only necessary fields (no full objects)

## HTTP Security (Rule 7.4)

- [ ] (M) **CORS configured** — Not `*` in production; specific origin allowlist
- [ ] (M) **Security headers set**:
  - Content-Security-Policy
  - Strict-Transport-Security (HSTS)
  - X-Content-Type-Options: nosniff
  - X-Frame-Options: DENY or SAMEORIGIN
  - Referrer-Policy
- [ ] (M) **CSRF protection** — Tokens or SameSite cookies for state-changing operations
- [ ] (M) **Request size limits** — Body parser limits configured to prevent DoS

## Dependency Security (Rule 3.4)

- [ ] (M) **npm audit clean** — No known vulnerabilities in dependencies
- [ ] (M) **Pinned versions** — Exact versions prevent supply chain attacks via malicious updates
- [ ] (M) **Lock file committed** — `package-lock.json` / `pnpm-lock.yaml` in version control
- [ ] (M) **Minimal dependencies** — Each dep justified; Node.js built-ins preferred
- [ ] (A) **No dynamic require()** — `import/no-dynamic-require` ESLint rule
- [ ] (A) **No `any` on external input** — `@typescript-eslint/no-explicit-any`

## Error Handling & Logging (Rules 6.1, 6.3)

- [ ] (M) **No stack traces to users** — Production errors return generic messages
- [ ] (M) **Structured audit logging** — Security events logged with timestamp, actor, operation
- [ ] (M) **Tamper-evident logs** — Append-only or cryptographically signed audit logs
- [ ] (M) **Error handling doesn't leak** — Catch blocks don't expose internal state
- [ ] (A) **No console.log in production** — `no-console` ESLint rule (allow warn, error)

## Async Security (Rules 4.1, 4.2, 4.3)

- [ ] (M) **Timeouts on all I/O** — Prevents resource exhaustion from slow-loris attacks
- [ ] (M) **Bounded parallelism** — Prevents memory exhaustion from parallel request floods
- [ ] (M) **Graceful shutdown** — SIGTERM handler drains connections properly
- [ ] (A) **No floating promises** — `@typescript-eslint/no-floating-promises`
- [ ] (M) **No unhandled rejections** — uncaught rejection handler installed
