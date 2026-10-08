/**
 * Chronicler CLI
 */

import path from 'node:path';

import { Command } from 'commander';

import type { ChroniclerCliConfig } from './config';
import { DEFAULT_LOCKFILE } from './config';
import { loadConfig, validateEventsFile } from './config-loader';
import { resolveDocsOptions } from './docs-options';
import { generateDocs } from './generator/docs-generator';
import {
  buildLockfile,
  diffLockfiles,
  formatDiff,
  formatKeyList,
  isBreaking,
  readLockfile,
  writeLockfile,
} from './keys';
import { parseEventsFile } from './parser/runtime-parser';
import { formatErrors, validateEventTree } from './parser/validator';
import type { ParsedEventTree, ValidationError } from './types';

const program = new Command();

program
  .name('@ubercode/chronicler')
  .description('Chronicler CLI for event validation, documentation and key lockfiles')
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

program
  .command('keys')
  .description('List event keys, or write/check the event key lockfile')
  .option('--write', 'Write the key lockfile (default: chronicler.lock.json)')
  .option('--check', 'Fail if keys were removed or changed since the lockfile was written')
  .option('--json', 'Output results as JSON')
  .option('--config <path>', 'Path to config file (default: chronicler.config.ts)')
  .action(async (options: KeysOptions) => {
    try {
      await runKeys(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

interface KeysOptions {
  readonly write?: boolean;
  readonly check?: boolean;
  readonly json?: boolean;
  readonly config?: string;
}

/** Loaded config plus the directory paths in it are relative to. */
interface Project {
  readonly config: ChroniclerCliConfig;
  readonly root: string;
}

/** Derive the working directory from a config file path, or process.cwd(). */
function resolveCwd(configPath?: string): string {
  return configPath ? path.dirname(path.resolve(configPath)) : process.cwd();
}

async function loadProject(configPath?: string): Promise<Project> {
  const root = resolveCwd(configPath);
  return { config: await loadConfig(root), root };
}

/** Check the events file exists and parse its catalog. */
async function parseProject({ config, root }: Project): Promise<ParsedEventTree> {
  validateEventsFile(config, root);
  return parseEventsFile(path.resolve(root, config.eventsFile), {
    exportName: config.eventsExport,
  });
}

const countEvents = (tree: ParsedEventTree) => {
  const lifecycle = tree.events.filter((e) => e.lifecycle).length;
  return { events: tree.events.length - lifecycle, lifecycle };
};

/** Format validation results as JSON and exit. */
function printValidateJson(tree: ParsedEventTree, errors: ValidationError[], elapsed: number) {
  const counts = countEvents(tree);
  const result = {
    success: errors.length === 0,
    eventCount: counts.events,
    lifecycleEventCount: counts.lifecycle,
    groupCount: tree.groups.length,
    catalogExports: tree.catalogExports,
    errorCount: errors.length,
    errors: errors.map((e) => ({ type: e.type, message: e.message })),
    elapsedMs: elapsed,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

/** Print human-readable success summary and exit. */
function printValidateSuccess(tree: ParsedEventTree, verbose: boolean, elapsed: number) {
  console.log('\n✅ All event definitions are valid!');
  if (verbose) {
    const counts = countEvents(tree);
    console.log(`\n📊 Summary:`);
    console.log(`   Catalogs: ${tree.catalogExports.join(', ')}`);
    console.log(`   Events: ${counts.events} (+${counts.lifecycle} lifecycle)`);
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
  const project = await loadProject(options.config);
  const { config } = project;

  if (options.verbose && !options.json) {
    console.log(`   Events file: ${config.eventsFile}`);
  }

  log(`📖 Parsing ${config.eventsFile}...`);
  const tree = await parseProject(project);
  const counts = countEvents(tree);

  if (options.verbose && !options.json) {
    console.log(`   Found ${counts.events} event definition(s) (+${counts.lifecycle} lifecycle)`);
    console.log(`   Found ${tree.groups.length} group(s)`);
  } else {
    log(`   Found ${counts.events} event(s)`);
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

async function runDocs(options: { format?: string; output?: string; config?: string }) {
  const startTime = Date.now();

  console.log('🔍 Loading configuration...');
  const project = await loadProject(options.config);
  const docs = resolveDocsOptions(project.config, options);
  const { format, outputPath } = docs;
  const config: ChroniclerCliConfig = { ...project.config, docs };

  console.log(`📖 Parsing ${config.eventsFile}...`);
  const tree = await parseProject(project);
  const { events } = countEvents(tree);
  console.log(`   Found ${events} event(s)`);

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
  console.log(`   Events documented: ${events}`);
  console.log(`⏱️  Completed in ${elapsed}ms`);
  process.exit(0);
}

/** Print an error result (JSON or text) and exit 1. */
function failKeys(json: boolean | undefined, errors: ValidationError[]): never {
  if (json) {
    console.log(JSON.stringify({ success: false, errors }, null, 2));
  } else {
    console.error('\n❌ Cannot read event keys:\n');
    console.error(formatErrors(errors));
  }
  process.exit(1);
}

function runKeysWrite(lockPath: string, project: Project, tree: ParsedEventTree, json?: boolean) {
  const lockfile = buildLockfile(tree);
  writeLockfile(lockPath, lockfile, project.config.docs?.eol);
  const keyCount = Object.keys(lockfile.events).length;
  const relative = path.relative(process.cwd(), lockPath) || lockPath;
  if (json) {
    console.log(JSON.stringify({ success: true, lockfile: relative, keyCount }, null, 2));
  } else {
    console.log(`🔒 Wrote ${keyCount} key(s) to ${relative}`);
  }
  process.exit(0);
}

function runKeysCheck(lockPath: string, tree: ParsedEventTree, json?: boolean) {
  const relative = path.relative(process.cwd(), lockPath) || lockPath;
  const locked = readLockfile(lockPath);
  if (!locked) {
    failKeys(json, [
      {
        type: 'parse-error',
        message: `Lockfile not found: ${relative}. Run \`chronicler keys --write\` to create it.`,
      },
    ]);
  }
  const diff = diffLockfiles(locked, buildLockfile(tree));
  const success = !isBreaking(diff);
  if (json) {
    console.log(JSON.stringify({ success, lockfile: relative, ...diff, errors: [] }, null, 2));
  } else if (success) {
    console.log(`\n✅ Event keys match ${relative}`);
    if (diff.added.length > 0 || diff.extended.length > 0) console.log(formatDiff(diff));
  } else {
    console.error(`\n❌ Event keys changed since ${relative} was written:\n`);
    console.error(formatDiff(diff));
    console.error(
      '\nIf the change is intended, run `chronicler keys --write` to update the lockfile.',
    );
  }
  process.exit(success ? 0 : 1);
}

async function runKeys(options: KeysOptions) {
  if (options.write && options.check) {
    throw new Error('Use either --write or --check, not both');
  }
  const project = await loadProject(options.config);
  const tree = await parseProject(project);
  if (tree.errors.length > 0) failKeys(options.json, tree.errors);

  const lockPath = path.resolve(project.root, project.config.keys?.lockfile ?? DEFAULT_LOCKFILE);
  if (options.write) return runKeysWrite(lockPath, project, tree, options.json);
  if (options.check) return runKeysCheck(lockPath, tree, options.json);

  const lockfile = buildLockfile(tree);
  console.log(options.json ? JSON.stringify(lockfile, null, 2) : formatKeyList(lockfile));
  process.exit(0);
}

program.parse();
