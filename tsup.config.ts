import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    minify: false,
    treeshake: true,
    target: 'node20',
    outDir: 'dist',
    cjsInterop: true,
  },
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'],
    sourcemap: true,
    clean: false,
    splitting: false,
    minify: false,
    treeshake: true,
    target: 'node20',
    outDir: 'dist',
    banner: { js: '#!/usr/bin/env node' },
  },
]);
