---
name: project-init
description: Initialize or upgrade a TypeScript project to comply with the mission-critical coding standard
disable-model-invocation: true
---

# Initialize Mission-Critical TypeScript Project

You are setting up (or upgrading) a TypeScript project to comply with the mission-critical coding standard.

This skill has two layers:

1. **Tooling infrastructure** — Delegated to the `scaffold-tooling` skill (ESLint, tsconfig, Prettier, Husky)
2. **Project-specific setup** — Handled here (Result types, branded types, directory structure)

## Instructions

### 1. Run scaffold-tooling first

Before doing anything else, run the `scaffold-tooling` skill to set up:

- `tsconfig.json` with full strict config
- `eslint.config.mjs` with all deterministic rules
- `.prettierrc.json` + `.prettierignore`
- Husky + lint-staged
- Package.json scripts

The `scaffold-tooling` skill handles environment detection, package manager detection, upgrade-vs-init logic, and install commands. Do NOT duplicate that work here.

### 2. Create Result type utilities (Rule 6.2)

Read the template at `.claude/skills/project-init/templates/result.ts.template` and write it to `src/utils/result.ts`. If the file already exists, skip and inform the user.

### 3. Create branded type utilities (Rule 7.3)

Read the template at `.claude/skills/project-init/templates/branded-types.ts.template` and write it to `src/utils/branded-types.ts`. If the file already exists, skip and inform the user.

### 4. Create barrel export

Create `src/utils/index.ts` that re-exports from `result.ts` and `branded-types.ts`. If it exists, append the exports (don't overwrite).

### 5. Create src directory structure

Ensure these directories exist:

- `src/`
- `src/utils/`

### 6. Install project-specific dependencies

Tell the user to run the following commands (do NOT run them automatically — the user should review first):

```bash
# Testing
<pm> install --save-exact -D vitest @vitest/coverage-v8

# Property-based testing (Rule 9.1)
<pm> install --save-exact -D fast-check

# Schema validation (Rule 7.2) — optional, add if needed
<pm> install --save-exact zod
```

Replace `<pm>` with the detected package manager (npm/pnpm/yarn/bun).

### 7. Summary

List all files created or modified, and any manual steps the user needs to complete. Remind the user that tooling was set up by `scaffold-tooling` and project utilities by `project-init`.
