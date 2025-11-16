/**
 * Configuration loader for Chronicler CLI
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ChroniclerCliConfig } from './config';
import { DEFAULT_CLI_CONFIG } from './config';

/**
 * Load Chronicler CLI configuration from chronicler.config.ts
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<ChroniclerCliConfig> {
  const configPath = path.join(cwd, 'chronicler.config.ts');

  // Check if config file exists
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Configuration file not found: ${configPath}\n` +
        'Please create a chronicler.config.ts file in your project root.',
    );
  }

  try {
    // Use tsx to load TypeScript config
    // tsx is installed as a dev dependency
    const { register } = await import('tsx/esm/api');
    const unregister = register();

    try {
      // Convert to file URL for dynamic import
      const configUrl = pathToFileURL(configPath).href;
      const configModule = (await import(configUrl)) as { default?: ChroniclerCliConfig };

      // Extract default export
      const config = configModule.default;

      if (!config) {
        throw new Error('chronicler.config.ts must have a default export');
      }

      // Validate required fields
      if (!config.eventsFile) {
        throw new Error('eventsFile is required in chronicler.config.ts');
      }

      // Merge with defaults
      const mergedConfig: ChroniclerCliConfig = {
        eventsFile: config.eventsFile,
        docs: {
          ...DEFAULT_CLI_CONFIG.docs,
          ...config.docs,
        },
        validation: {
          ...DEFAULT_CLI_CONFIG.validation,
          ...config.validation,
        },
      };

      return mergedConfig;
    } finally {
      void unregister();
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate that the events file exists
 */
export function validateEventsFile(config: ChroniclerCliConfig, cwd: string = process.cwd()): void {
  const eventsFilePath = path.resolve(cwd, config.eventsFile);

  if (!fs.existsSync(eventsFilePath)) {
    throw new Error(`Events file not found: ${eventsFilePath}`);
  }
}
