---
name: ops-docs
description: Generate operational documentation — runbooks, incident playbooks, architecture diagrams, API docs, and license reports
disable-model-invocation: true
arguments:
  - name: type
    description: "Comma-separated list of doc types (e.g., 'runbooks,api-docs') or 'all'. If omitted, you will be asked."
    required: false
---

# Operational Documentation Generator

You are generating operational documentation for a mission-critical TypeScript project. This skill consolidates multiple documentation types into a single workflow. Unlike `/project-docs` (which handles standard project files like README, LICENSE, CONTRIBUTING), this skill focuses on **operational and technical documentation**.

## Available Document Types

| Key                 | Document                           | Output Location           |
| ------------------- | ---------------------------------- | ------------------------- |
| `runbooks`          | Operational Runbooks               | `docs/runbooks/`          |
| `incident-playbook` | Incident Response Playbook         | `docs/incidents/`         |
| `architecture`      | Architecture Diagrams (C4/Mermaid) | `docs/architecture/`      |
| `api-docs`          | API Documentation Setup (TypeDoc)  | `docs/api/` + config      |
| `license-report`    | Third-Party License Attribution    | `THIRD_PARTY_LICENSES.md` |

## Instructions

### 1. Determine document types

If `$ARGUMENTS` is provided, parse it as a comma-separated list of keys. Otherwise, ask the user which documents to generate using a multi-select question.

### 2. Load context

- Read `package.json` for project name, dependencies, scripts
- Read `CLAUDE.md` and `README.md` for project description
- Scan `src/` directory structure to understand module layout
- Read `.claude/docs/TypeScript Coding Standard for Mission-Critical Systems.md` if present

---

## Type: `runbooks` — Operational Runbooks

1. **Ask the user** for:
   - Service name
   - Known dependencies (databases, caches, external APIs, message queues)
   - Common operational scenarios they want documented (or use defaults)

2. **Create `docs/runbooks/`** directory with:

   **`docs/runbooks/TEMPLATE.md`**: Blank runbook template

   ```markdown
   # RB-NNN: <Title>

   **Severity**: SEV1 | SEV2 | SEV3 | SEV4
   **Last reviewed**: YYYY-MM-DD
   **Owner**: <team/person>

   ## Trigger Conditions

   <What alert or symptom initiates this runbook>

   ## Prerequisites

   - Required access: ...
   - Required tools: ...
   - Relevant dashboards: ...

   ## Diagnostic Steps

   1. ...
   2. ...

   ## Remediation Steps

   1. ...
   2. ...

   ## Rollback / Undo

   1. ...

   ## Escalation

   - When to escalate: ...
   - Contact: ...

   ## Post-Incident Verification

   1. Confirm the issue is resolved: ...
   2. Monitor for recurrence: ...

   ## Related Runbooks

   - [RB-NNN: Related Title](./related.md)
   ```

   **Default runbooks** (generate these unless the user specifies otherwise):
   - `high-latency.md` — Diagnosing and resolving slow response times
   - `database-connection-failure.md` — Handling database connectivity issues
   - `out-of-memory.md` — Diagnosing memory leaks and OOM kills
   - `deployment-rollback.md` — Rolling back a bad deployment
   - `dependency-outage.md` — Handling upstream service outages
   - `certificate-expiry.md` — Rotating expired TLS certificates

   **`docs/runbooks/README.md`**: Index table of all runbooks with ID, title, severity, and trigger.

---

## Type: `incident-playbook` — Incident Response Playbook

1. **Ask the user** for:
   - Team/organization name
   - On-call rotation tool (PagerDuty, OpsGenie, or none)
   - Communication channels (Slack workspace, status page URL)
   - Escalation contacts (or use placeholders)

2. **Create `docs/incidents/`** directory with:

   **`docs/incidents/playbook.md`**:
   - **Severity definitions** (SEV1-SEV4) with impact criteria, response time targets, and communication cadence
   - **Roles**: Incident Commander, Communications Lead, Subject Matter Expert, Scribe — each with responsibilities
   - **Incident lifecycle**: Detection → Triage → Mitigation → Resolution → Post-mortem
   - **Communication templates**: Slack incident channel message, status page update, stakeholder email (one per severity level)
   - **Escalation matrix** with contact placeholders

   **`docs/incidents/post-mortem-template.md`** (blameless, modeled on Google SRE):
   - Incident summary (what happened, duration, impact)
   - Timeline (with timestamps)
   - Root cause analysis (5 Whys method)
   - Impact assessment (users affected, data loss, revenue impact)
   - What went well / What went poorly / Where we got lucky
   - Action items (owner, priority, due date)
   - Lessons learned

   **`docs/incidents/severity-matrix.md`**: Detailed severity classification with examples.

   **`.github/ISSUE_TEMPLATE/incident.yml`**: GitHub Issue template for tracking incidents with structured fields.

---

## Type: `architecture` — Architecture Diagrams (C4 Model)

1. **Analyze the project**:
   - Scan `src/` directory structure — each subdirectory is a module
   - Parse import statements across all `.ts` files to build a dependency graph
   - Identify external dependencies from `package.json` (databases, HTTP clients, message queues)
   - Read `package.json` description and `README.md` for system context

2. **Generate C4 diagrams** in Mermaid syntax (renders natively in GitHub):

   **`docs/architecture/context.md`** — System Context diagram:
   - The system as a box in the center
   - External actors (users, external APIs, databases) around it
   - Arrows showing interactions

   **`docs/architecture/components.md`** — Component diagram:
   - Each `src/` subdirectory as a component box
   - Import relationships as arrows (with direction)
   - External dependencies grouped separately
   - **Flag circular dependencies** with a warning

   **`docs/architecture/dependencies.md`** — Module dependency graph:
   - Text-based tree showing which modules import which
   - Import counts per module
   - Circular dependency detection

   **`docs/architecture/README.md`**: Index with descriptions and links.

3. All diagrams use Mermaid code blocks:
   ````markdown
   ```mermaid
   graph TD
     A[Module A] --> B[Module B]
     B --> C[Module C]
   ```
   ````

---

## Type: `api-docs` — API Documentation Setup

1. **Generate TypeDoc configuration** (`typedoc.json`):

   ```json
   {
     "entryPoints": ["src/index.ts"],
     "out": "docs/api",
     "plugin": ["typedoc-plugin-markdown"],
     "exclude": ["**/*.test.ts", "**/*.spec.ts"],
     "readme": "none"
   }
   ```

2. **Add npm script**: `"docs:api": "typedoc"` to `package.json`

3. **TSDoc completeness scan**: Analyze all exported functions and types. For each public API, check for:
   - Missing `@param` annotations
   - Missing `@returns` annotation
   - Missing `@throws` annotation (Rule 10.1)
   - Missing usage examples for complex functions
     Report a TSDoc coverage percentage.

4. **If HTTP framework detected** (Express, Fastify, Hono imports in deps):
   - Ask if the user wants OpenAPI documentation
   - If yes, generate an `openapi.yaml` skeleton with paths inferred from route definitions
   - Suggest `zod-to-openapi` for automatic schema generation from existing Zod schemas
   - List install commands: `npm install --save-exact -D typedoc typedoc-plugin-markdown`

5. **Optionally generate a CI job** for auto-publishing docs to GitHub Pages on push to main.

---

## Type: `license-report` — Third-Party License Attribution

1. **Scan dependencies**: For each production dependency in `package.json`, determine its license by:
   - Reading `node_modules/<pkg>/package.json` license field (if `node_modules` exists)
   - Or running `npm view <pkg> license`

2. **Generate `THIRD_PARTY_LICENSES.md`**:

   ```markdown
   # Third-Party Licenses

   This project uses the following third-party packages:

   | Package | Version | License | Repository                        |
   | ------- | ------- | ------- | --------------------------------- |
   | zod     | 3.22.4  | MIT     | https://github.com/colinhacks/zod |
   | ...     | ...     | ...     | ...                               |
   ```

3. **Generate or update `license-policy.json`**:

   ```json
   {
     "allowed": ["MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "CC0-1.0"],
     "blocked": ["GPL-2.0-only", "GPL-3.0-only", "AGPL-3.0-only", "SSPL-1.0"],
     "requireReview": ["LGPL-2.1-only", "LGPL-3.0-only", "MPL-2.0", "CC-BY-4.0"]
   }
   ```

4. **Flag violations**: Report any dependency with a blocked, unknown, or missing license.

5. **Suggest CI integration**: Add a `license-check` step to the CI pipeline that validates all dependencies against the policy.

---

## Summary

After generating all selected documents:

1. List all created files
2. List any install commands needed (TypeDoc, license-checker)
3. Note any manual steps required (filling in placeholders, reviewing runbooks)
