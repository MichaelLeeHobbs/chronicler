/**
 * Resolve the effective docs options for the `docs` command by merging CLI
 * flags over the config-file values.
 */

import type { ChroniclerCliConfig } from './config';

const VALID_FORMATS = ['markdown', 'json'] as const;

/**
 * Merge CLI flags over the config-file docs options, validating the format.
 *
 * The existing `docs` config is spread first so fields that aren't exposed as
 * CLI flags (e.g. `eol`) are preserved; `format`/`outputPath` overrides apply
 * on top. This is the single source of truth for what the CLI feeds to
 * {@link generateDocs} — rebuilding `docs` from only `{ format, outputPath }`
 * would silently drop `eol` (and any future `docs.*` field).
 *
 * @param config - Loaded CLI configuration (already merged with defaults)
 * @param options - CLI flag overrides for the `docs` command
 * @returns The resolved docs options to write documentation with
 * @throws {Error} If the requested format is not `markdown` or `json`
 */
export function resolveDocsOptions(
  config: ChroniclerCliConfig,
  options: { format?: string; output?: string },
): NonNullable<ChroniclerCliConfig['docs']> {
  let format = config.docs?.format ?? 'markdown';
  const outputPath = options.output ?? config.docs?.outputPath ?? './docs/chronicler-events.md';

  if (options.format) {
    if (!VALID_FORMATS.includes(options.format as (typeof VALID_FORMATS)[number])) {
      throw new Error(
        `Invalid format "${options.format}". Must be one of: ${VALID_FORMATS.join(', ')}`,
      );
    }
    format = options.format as 'markdown' | 'json';
  }

  return { ...config.docs, format, outputPath };
}
