/**
 * CLI configuration schema for Chronicler
 */

export interface ChroniclerCliConfig {
  /**
   * Path to the file containing event definitions
   * Relative to project root
   */
  eventsFile: string;

  /**
   * Documentation generation options
   */
  docs?: {
    /**
     * Output path for generated documentation
     * @default './docs/chronicler-events.md'
     */
    outputPath?: string;

    /**
     * Documentation format
     * @default 'markdown'
     */
    format?: 'markdown' | 'json';
  };
}

export const DEFAULT_CLI_CONFIG: Required<ChroniclerCliConfig> = {
  eventsFile: './src/events/index.ts',
  docs: {
    outputPath: './docs/chronicler-events.md',
    format: 'markdown',
  },
};
