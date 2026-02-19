/**
 * TypeScript file importer using esbuild.
 *
 * Compiles .ts files to a temporary .mjs file via esbuild, then imports it.
 * The .mjs extension forces ESM parsing regardless of the project's package.json "type".
 * All relative .ts imports are bundled; npm packages are left as external imports.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import esbuild from 'esbuild';

/**
 * Import a TypeScript file by compiling it to a temporary .mjs file.
 * Works in both ESM and CJS project contexts.
 */
export async function importTsModule(filePath: string): Promise<Record<string, unknown>> {
  const absolutePath = path.resolve(filePath);

  const result = await esbuild.build({
    entryPoints: [absolutePath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
    packages: 'external',
  });

  const code = result.outputFiles?.[0]?.text;
  if (!code) {
    throw new Error(`esbuild produced no output for ${filePath}`);
  }
  const tmpFile = absolutePath.replace(/\.ts$/, `.chronicler-tmp-${Date.now()}.mjs`);

  try {
    fs.writeFileSync(tmpFile, code);
    return (await import(pathToFileURL(tmpFile).href)) as Record<string, unknown>;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
