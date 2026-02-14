/**
 * Configuration loader for Chronicler CLI
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ChroniclerCliConfig } from './config';
import { DEFAULT_CLI_CONFIG } from './config';

async function importConfigModule(configPath: string): Promise<ChroniclerCliConfig> {
  const { register } = await import('tsx/esm/api');
  const unregister = register();

  try {
    const configUrl = pathToFileURL(configPath).href;
    const configModule = (await import(configUrl)) as { default?: ChroniclerCliConfig };
    const config = configModule.default;

    if (!config) {
      throw new Error('chronicler.config.ts must have a default export');
    }
    if (!config.eventsFile) {
      throw new Error('eventsFile is required in chronicler.config.ts');
    }

    return {
      eventsFile: config.eventsFile,
      docs: { ...DEFAULT_CLI_CONFIG.docs, ...config.docs },
    };
  } finally {
    void unregister();
  }
}

/**
 * Load Chronicler CLI configuration from chronicler.config.ts.
 *
 * **Security note:** This function dynamically imports a user-authored TypeScript
 * file, which executes arbitrary code. This is acceptable for a CLI tool that
 * the user invokes locally, but callers must never pass untrusted paths.
 *
 * @param cwd - Working directory to search for chronicler.config.ts (defaults to process.cwd())
 * @returns Resolved CLI configuration merged with defaults
 * @throws {Error} If the config file is missing, has no default export, or lacks required fields
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<ChroniclerCliConfig> {
  const configPath = path.join(cwd, 'chronicler.config.ts');

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Configuration file not found: chronicler.config.ts\n` +
        'Please create a chronicler.config.ts file in your project root.',
    );
  }

  try {
    return await importConfigModule(configPath);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate that the events file exists.
 *
 * @param config - CLI configuration containing the eventsFile path to validate
 * @param cwd - Working directory to resolve the eventsFile path against (defaults to process.cwd())
 * @throws {Error} If the events file does not exist at the resolved path
 */
export function validateEventsFile(config: ChroniclerCliConfig, cwd: string = process.cwd()): void {
  const eventsFilePath = path.resolve(cwd, config.eventsFile);

  if (!fs.existsSync(eventsFilePath)) {
    throw new Error(`Events file not found: ${config.eventsFile}`);
  }
}
