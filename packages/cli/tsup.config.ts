import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// The CLI source lives in the repo-level src/cli so it shares lint, typecheck and tests
// with the core library. Core internals it imports are bundled; npm dependencies stay external.
export default defineConfig({
  entry: { cli: '../../src/cli/index.ts' },
  format: ['esm'],
  sourcemap: true,
  clean: true,
  splitting: false,
  minify: false,
  treeshake: true,
  target: 'node20',
  outDir: 'dist',
  external: ['esbuild', 'commander'],
  banner: { js: '#!/usr/bin/env node' },
  define: { __CLI_VERSION__: JSON.stringify(version) },
});
