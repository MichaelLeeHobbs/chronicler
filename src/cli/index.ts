/**
 * Chronicler CLI
 */

import path from 'node:path';

import { Command } from 'commander';

import { loadConfig, validateEventsFile } from './config-loader';
import { generateDocs } from './generator/docs-generator';
import { parseEventsFile } from './parser/runtime-parser';
import { formatErrors, validateEventTree } from './parser/validator';
import type { ParsedEventTree, ValidationError } from './types';

const program = new Command();

program
  .name('@ubercode/chronicler')
  .description('Chronicler CLI for event validation and documentation generation')
  .version('0.1.0');

program
  .command('validate')
  .description('Validate event definitions')
  .option('-v, --verbose', 'Show detailed validation information')
  .option('--json', 'Output results as JSON')
  .option('--config <path>', 'Path to config file (default: chronicler.config.ts)')
  .action(async (options: { verbose?: boolean; json?: boolean; config?: string }) => {
    try {
      await runValidate(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('docs')
  .description('Generate documentation from event definitions')
  .option('-f, --format <format>', 'Output format (markdown or json)', 'markdown')
  .option('-o, --output <path>', 'Output file path')
  .option('--config <path>', 'Path to config file (default: chronicler.config.ts)')
  .action(async (options: { format?: string; output?: string; config?: string }) => {
    try {
      await runDocs(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

function resolveCwd(configPath?: string): string | undefined {
  return configPath ? path.dirname(path.resolve(configPath)) : undefined;
}

function printValidateJson(tree: ParsedEventTree, errors: ValidationError[], elapsed: number) {
  const result = {
    success: errors.length === 0,
    eventCount: tree.events.length,
    groupCount: tree.groups.length,
    errorCount: errors.length,
    errors: errors.map((e) => ({ type: e.type, message: e.message, location: e.location })),
    elapsedMs: elapsed,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

function printValidateSuccess(tree: ParsedEventTree, verbose: boolean, elapsed: number) {
  console.log('\n✅ All event definitions are valid!');
  if (verbose) {
    console.log(`\n📊 Summary:`);
    console.log(`   Events: ${tree.events.length}`);
    console.log(`   Groups: ${tree.groups.length}`);
    console.log(`   Errors: 0`);
  }
  console.log(`⏱️  Completed in ${elapsed}ms`);
  process.exit(0);
}

async function runValidate(options: { verbose?: boolean; json?: boolean; config?: string }) {
  const startTime = Date.now();
  const log = (msg: string) => !options.json && console.log(msg);

  log('🔍 Loading configuration...');
  const config = await loadConfig(resolveCwd(options.config));

  if (options.verbose && !options.json) {
    console.log(`   Events file: ${config.eventsFile}`);
  }

  log('📂 Validating events file exists...');
  validateEventsFile(config);

  log(`📖 Parsing ${config.eventsFile}...`);
  const tree = await parseEventsFile(config.eventsFile);

  if (options.verbose && !options.json) {
    console.log(`   Found ${tree.events.length} event definition(s)`);
    console.log(`   Found ${tree.groups.length} group(s)`);
  } else {
    log(`   Found ${tree.events.length} event(s)`);
  }

  const errors = validateEventTree(tree);
  const elapsed = Date.now() - startTime;

  if (options.json) return printValidateJson(tree, errors, elapsed);

  if (errors.length > 0) {
    console.error('\n❌ Validation failed:\n');
    console.error(formatErrors(errors));
    console.error(`\n⏱️  Completed in ${elapsed}ms`);
    process.exit(1);
  }

  printValidateSuccess(tree, options.verbose ?? false, elapsed);
}

function resolveDocsOptions(
  config: { docs?: { format?: string; outputPath?: string } },
  options: { format?: string; output?: string },
): { format: 'markdown' | 'json'; outputPath: string } {
  const VALID_FORMATS = ['markdown', 'json'] as const;
  let format = config.docs?.format ?? 'markdown';
  let outputPath = config.docs?.outputPath ?? './docs/chronicler-events.md';

  if (options.format) {
    if (!VALID_FORMATS.includes(options.format as (typeof VALID_FORMATS)[number])) {
      console.error(
        `Error: Invalid format "${options.format}". Must be one of: ${VALID_FORMATS.join(', ')}`,
      );
      process.exit(1);
    }
    format = options.format;
  }
  if (options.output) outputPath = options.output;

  return { format: format as 'markdown' | 'json', outputPath };
}

async function runDocs(options: { format?: string; output?: string; config?: string }) {
  const startTime = Date.now();

  console.log('🔍 Loading configuration...');
  const config = await loadConfig(resolveCwd(options.config));
  const { format, outputPath } = resolveDocsOptions(config, options);
  config.docs = { format, outputPath };

  console.log(`📂 Validating events file exists...`);
  validateEventsFile(config);

  console.log(`📖 Parsing ${config.eventsFile}...`);
  const tree = await parseEventsFile(config.eventsFile);
  console.log(`   Found ${tree.events.length} event(s)`);

  const errors = validateEventTree(tree);
  if (errors.length > 0) {
    console.error('\n⚠️  Validation warnings found:\n');
    console.error(formatErrors(errors));
    console.error('\nProceeding with documentation generation...\n');
  }

  console.log(`📝 Generating ${format} documentation...`);
  generateDocs(tree, config);

  const elapsed = Date.now() - startTime;
  console.log(`✅ Documentation generated successfully!`);
  console.log(`   Output: ${outputPath}`);
  console.log(`   Format: ${format}`);
  console.log(`   Events documented: ${tree.events.length}`);
  console.log(`⏱️  Completed in ${elapsed}ms`);
  process.exit(0);
}

program.parse();
