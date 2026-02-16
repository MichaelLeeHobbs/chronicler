---
name: scaffold-tooling
description: Set up or upgrade TypeScript project tooling (ESLint, tsconfig, Prettier, Husky)
disable-model-invocation: true
---

# Scaffold Tooling — TypeScript Quality Infrastructure

You are setting up (or upgrading) the quality tooling infrastructure for a TypeScript project. This skill handles ESLint, TypeScript compiler config, Prettier, and git hooks — the deterministic enforcement layer.

## Instructions

### 1. Detect environment

Detect the package manager from lockfiles:

- `pnpm-lock.yaml` → pnpm
- `yarn.lock` → yarn
- `bun.lockb` or `bun.lock` → bun
- `package-lock.json` or none → npm

Check for existing config files:

- `tsconfig.json` or `tsconfig.base.json`
- `eslint.config.mjs` / `eslint.config.js` / `.eslintrc.*`
- `.prettierrc*`
- `.husky/`
- `package.json`

If any exist, inform the user this is an **upgrade** and list what will be modified. Ask for confirmation before proceeding.

### 2. Configure tsconfig.json (Rule 3.1)

Read the template at `.claude/skills/scaffold-tooling/templates/tsconfig.json.template`.

Create or update `tsconfig.json` with the strict configuration. If a tsconfig already exists, show the user a diff of what will change and confirm.

Key flags that must be present:

- `strict: true`
- `useUnknownInCatchVariables: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `isolatedModules: true`
- `noFallthroughCasesInSwitch: true`
- `noImplicitReturns: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`

### 3. Configure ESLint (Rule 3.3)

Read the template at `.claude/skills/scaffold-tooling/templates/eslint.config.mjs.template`.

This uses ESLint 9 flat config format. The template includes:

- `@typescript-eslint/recommended-type-checked` + `stylistic-type-checked` base
- `no-restricted-syntax: TSEnumDeclaration` (Rule 3.5)
- `no-var` + `prefer-const` (Rule 5.2)
- `@typescript-eslint/prefer-readonly` (Rule 7.1)
- `@typescript-eslint/switch-exhaustiveness-check` (Rule 8.3)
- `max-lines-per-function` (40), `max-params` (4), `max-depth` (3), `complexity` (10) (Rule 8.4)
- `no-console` with allow warn/error (Rule 6.3)
- `no-eval` (Security)
- `import/no-cycle` with maxDepth 5 (Rule 10.3)
- `import/no-dynamic-require` (Rule 3.4)
- `eslint-config-prettier` rules spread last

If the project uses legacy `.eslintrc.*` format, inform the user it should be migrated to flat config and provide migration guidance.

### 4. Configure Prettier

Read the template at `.claude/skills/scaffold-tooling/templates/prettierrc.json.template`.

Create `.prettierrc.json` and `.prettierignore` if they don't exist.

### 5. Configure Husky + lint-staged

Set up pre-commit hooks:

```bash
# .husky/pre-commit
<pm> run lint
<pm> run typecheck
```

Add `lint-staged` config to `package.json`:

```json
{
  "lint-staged": {
    "src/**/*.{ts,tsx}": ["<pm> exec eslint --fix --max-warnings=0"],
    "*.{json,md,yml,yaml,ts,tsx,js}": ["<pm> exec prettier --write"]
  }
}
```

Replace `<pm>` with the detected package manager.

### 6. Add/merge package.json scripts

Ensure these scripts exist (merge, don't overwrite existing custom scripts):

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --ext .ts,.tsx --max-warnings=0",
    "lint:fix": "eslint . --ext .ts,.tsx --fix",
    "format": "prettier . --check",
    "format:fix": "prettier . --write",
    "check": "<pm> run lint && <pm> run typecheck && <pm> run test",
    "prepare": "husky"
  }
}
```

### 7. List install commands

Tell the user to run the following commands (do NOT run them automatically):

```bash
# Core tooling
<pm> install --save-exact -D typescript @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint

# Import management
<pm> install --save-exact -D eslint-plugin-import eslint-import-resolver-typescript eslint-plugin-simple-import-sort

# Prettier integration
<pm> install --save-exact -D prettier eslint-config-prettier

# Git hooks
<pm> install --save-exact -D husky lint-staged
```

### 8. Summary

List all files created or modified, all install commands needed, and any manual steps.

## Important Notes

- **Never run install commands automatically** — list them for the user to review
- If upgrading, show diffs and ask for confirmation before overwriting
- Package-manager agnostic: use the detected PM for all commands
- ESLint 9 flat config only — do not generate legacy `.eslintrc.*` files
- Templates provide the baseline; the user may need to adjust for project-specific needs (e.g., relaxing rules for test files)
