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
  };
}

export const DEFAULT_DOCS_CONFIG: Required<NonNullable<ChroniclerCliConfig['docs']>> = {
  outputPath: './docs/chronicler-events.md',
  format: 'markdown',
};
