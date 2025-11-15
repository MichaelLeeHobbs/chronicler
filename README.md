# chronicler

> A TypeScript-first toolkit for building chronicle and audit utilities.

## Features

- ✅ Dual ESM & CJS bundles with type declarations
- ✅ Modern TypeScript toolchain with strict settings
- ✅ Automated formatting, linting, testing, and release workflows

## Getting started

```powershell
pnpm install
pnpm run dev
```

## Scripts

- `pnpm run dev` – watch build via tsup
- `pnpm run build` – clean & create production bundles
- `pnpm run lint` – ESLint with TypeScript rules
- `pnpm run format` – Prettier formatting check
- `pnpm run test` – Vitest unit tests
- `pnpm run coverage` – Coverage report
- `pnpm run check` – lint + typecheck + tests

## Usage

```ts
import { createEntry, formatEntry } from 'chronicler';

const entry = createEntry('user logged in', { userId: '123' });
console.log(formatEntry(entry));
```

## Releasing

```powershell
pnpm run changeset
pnpm run release
```

This will version, build, and publish the package using Changesets.
