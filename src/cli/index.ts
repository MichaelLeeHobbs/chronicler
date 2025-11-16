#!/usr/bin/env node

/**
 * Chronicler CLI
 */

import { loadConfig, validateEventsFile } from './config-loader';
import { parseEventsFile } from './parser/ast-parser';
import { formatErrors, validateEventTree } from './parser/validator';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.error('Usage: chronicler <command>');
    console.error('Commands:');
    console.error('  validate  - Validate event definitions');
    console.error('  docs      - Generate documentation (coming soon)');
    process.exit(1);
  }

  try {
    switch (command) {
      case 'validate':
        await runValidate();
        break;

      case 'docs':
        console.error('Documentation generation coming soon!');
        process.exit(1);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

/**
 * Run validation command
 */
async function runValidate() {
  console.log('Loading configuration...');
  const config = await loadConfig();

  console.log('Validating events file...');
  validateEventsFile(config);

  console.log(`Parsing ${config.eventsFile}...`);
  const tree = parseEventsFile(config.eventsFile);

  console.log(`Found ${tree.events.length} event(s)`);

  // Run validation
  const errors = validateEventTree(tree);

  if (errors.length > 0) {
    console.error('\n❌ Validation failed:\n');
    console.error(formatErrors(errors));
    process.exit(1);
  }

  console.log('\n✅ All event definitions are valid!');
}

// Run CLI
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
