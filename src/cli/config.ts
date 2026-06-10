/**
 * CLI configuration schema for Chronicler
 */

export interface ChroniclerCliConfig {
  /**
   * Path to the file containing event definitions
   * Relative to project root
   */
  readonly eventsFile: string;

  /**
   * Documentation generation options
   */
  readonly docs?: {
    /**
     * Output path for generated documentation
     * @default './docs/chronicler-events.md'
     */
    readonly outputPath?: string;

    /**
     * Documentation format
     * @default 'markdown'
     */
    readonly format?: 'markdown' | 'json';

    /**
     * Line ending used when writing the generated documentation file.
     *
     * Use `'crlf'` on repositories that normalize the working tree to CRLF
     * (e.g. `.gitattributes` with `* text=auto eol=crlf`) to avoid spurious
     * diffs on every regeneration. The default `'lf'` preserves prior behavior
     * and keeps output deterministic across platforms.
     *
     * @default 'lf'
     */
    readonly eol?: 'lf' | 'crlf';
  };
}

export const DEFAULT_DOCS_CONFIG: Required<NonNullable<ChroniclerCliConfig['docs']>> = {
  outputPath: './docs/chronicler-events.md',
  format: 'markdown',
  eol: 'lf',
};
