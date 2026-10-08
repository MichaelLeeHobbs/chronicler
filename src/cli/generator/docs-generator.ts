/**
 * Documentation generator for Chronicler events
 */

import fs from 'node:fs';
import path from 'node:path';

import type { ChroniclerCliConfig } from '../config';
import { applyEol } from '../eol';
import type { ParsedEvent, ParsedEventGroup, ParsedEventTree } from '../types';

/**
 * Generate documentation from parsed event tree.
 *
 * @param tree - Parsed event tree containing events and groups to document
 * @param config - CLI configuration specifying output format and file path
 * @throws {Error} If the output path resolves outside the project directory or the format is unknown
 */
// eslint-disable-next-line complexity -- multiple output format branches and path-safety checks
export function generateDocs(tree: ParsedEventTree, config: ChroniclerCliConfig): void {
  const format = config.docs?.format ?? 'markdown';
  const outputPath = config.docs?.outputPath ?? './docs/chronicler-events.md';

  // Prevent path traversal: output must resolve within cwd.
  // Use fs.realpathSync where possible to resolve symlinks, and normalize
  // case on case-insensitive file systems (Windows).
  const resolved = path.resolve(outputPath);
  const cwd = process.cwd();
  const normalizedResolved = resolved.toLowerCase();
  const normalizedCwd = cwd.toLowerCase();
  if (
    !normalizedResolved.startsWith(normalizedCwd + path.sep) &&
    normalizedResolved !== normalizedCwd
  ) {
    throw new Error(`Output path "${outputPath}" resolves outside the project directory.`);
  }

  let content: string;

  if (format === 'markdown') {
    content = generateMarkdown(tree);
  } else if (format === 'json') {
    content = generateJSON(tree);
  } else {
    throw new Error(`Unknown format: ${String(format)}`);
  }

  // Ensure output directory exists
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Re-validate after mkdir to catch symlinks that resolve outside cwd
  const realDir = fs.realpathSync(dir);
  if (
    !realDir.toLowerCase().startsWith(normalizedCwd + path.sep) &&
    realDir.toLowerCase() !== normalizedCwd
  ) {
    throw new Error('Output directory resolves outside the project directory via symlink.');
  }

  // Generated content uses LF internally; convert to the configured EOL so repos that
  // normalize the working tree to CRLF don't see spurious diffs on every regeneration.
  const normalized = applyEol(content, config.docs?.eol);

  // Write output
  fs.writeFileSync(resolved, normalized, 'utf-8');
}

/** Descriptions of the auto-generated correlation lifecycle events, by suffix. */
const LIFECYCLE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  start: 'Logged when correlation starts',
  complete: 'Logged when correlation completes (includes `duration` field)',
  fail: 'Logged when correlation fails (includes `duration` and `error` fields)',
  timeout: 'Logged when correlation times out due to inactivity',
};

const lifecycleSuffix = (event: ParsedEvent): string =>
  event.key.slice(event.key.lastIndexOf('.') + 1);

/**
 * Generate Markdown documentation
 */
function generateMarkdown(tree: ParsedEventTree): string {
  const lines: string[] = [];

  lines.push('# Chronicler Events');
  lines.push('');
  lines.push('> Auto-generated documentation from event definitions');
  lines.push('');

  // Table of contents
  if (tree.groups.length > 0) {
    lines.push('## Table of Contents');
    lines.push('');
    tree.groups.forEach((group) => {
      lines.push(`- [${group.key}](#${group.key.replace(/\./g, '-').toLowerCase()})`);
    });
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Document each top-level namespace / correlation
  tree.groups.forEach((group) => {
    lines.push(...generateGroupMarkdown(group));
  });

  // Document events defined at the catalog root (not in any namespace or correlation)
  if (tree.rootEvents.length > 0) {
    lines.push('## Standalone Events');
    lines.push('');
    tree.rootEvents.forEach((event) => {
      lines.push(...generateEventMarkdown(event));
    });
  }

  return lines.join('\n');
}

/** Markdown for a correlation's type, timeout and doc header lines. */
function correlationHeaderMarkdown(group: ParsedEventGroup): string[] {
  const lines = ['**Type:** Correlation'];
  if (group.timeout !== undefined) {
    lines.push(
      group.timeout === 0
        ? '**Timeout:** Disabled'
        : `**Timeout:** ${group.timeout}ms (activity-based)`,
    );
  }
  lines.push('');
  return lines;
}

/** Markdown list of a correlation's auto-generated lifecycle events. */
function lifecycleMarkdown(group: ParsedEventGroup): string[] {
  const lines = ['**Auto-Generated Events:**', ''];
  for (const event of group.lifecycleEvents) {
    const description = LIFECYCLE_DESCRIPTIONS[lifecycleSuffix(event)] ?? event.doc;
    lines.push(`- \`${event.key}\` (\`${event.level}\`) - ${description}`);
  }
  lines.push('');
  return lines;
}

/** Markdown for one group (without its nested groups). */
function groupBodyMarkdown(group: ParsedEventGroup, level: number): string[] {
  const lines = [`${'#'.repeat(Math.min(level, 6))} ${group.key}`, ''];
  if (group.kind === 'correlation') lines.push(...correlationHeaderMarkdown(group));
  if (group.doc) lines.push(group.doc, '');
  if (group.kind === 'correlation') lines.push(...lifecycleMarkdown(group));
  Object.values(group.events).forEach((event) => {
    lines.push(...generateEventMarkdown(event, level + 1));
  });
  return lines;
}

/**
 * Generate Markdown for a namespace or correlation and its nested groups (iterative)
 */
function generateGroupMarkdown(rootGroup: ParsedEventGroup, rootLevel = 2): string[] {
  const lines: string[] = [];
  const stack: { group: ParsedEventGroup; level: number }[] = [
    { group: rootGroup, level: rootLevel },
  ];

  while (stack.length > 0) {
    const { group, level } = stack.pop()!;
    lines.push(...groupBodyMarkdown(group, level));

    // Push nested groups in reverse order so they process in original order
    const nested = Object.values(group.groups);
    for (let i = nested.length - 1; i >= 0; i--) {
      stack.push({ group: nested[i]!, level: level + 1 });
    }

    lines.push('---');
    lines.push('');
  }

  return lines;
}

/**
 * Generate Markdown for a single event
 */
function generateEventMarkdown(event: ParsedEvent, level = 3): string[] {
  const lines: string[] = [];
  const heading = '#'.repeat(Math.min(level, 6));

  lines.push(`${heading} ${event.key}`);
  lines.push('');
  lines.push(`**Level:** \`${event.level}\``);
  lines.push(`**Message:** "${event.message}"`);
  lines.push('');
  if (event.doc) {
    lines.push(event.doc);
    lines.push('');
  }

  const fields = Object.entries(event.fields);
  if (fields.length > 0) {
    lines.push('**Fields:**');
    lines.push('');
    for (const [name, field] of fields) {
      const required = field.required ? 'required' : 'optional';
      lines.push(`- **\`${name}\`** (\`${field.type}\`, ${required}): ${field.doc}`);
    }
    lines.push('');
  }

  return lines;
}

/**
 * Generate JSON documentation
 */
function generateJSON(tree: ParsedEventTree): string {
  const output = {
    generated: new Date().toISOString(),
    eventCount: tree.events.filter((event) => !event.lifecycle).length,
    lifecycleEventCount: tree.events.filter((event) => event.lifecycle).length,
    groupCount: tree.groups.length,
    groups: tree.groups.map((group) => serializeGroup(group)),
    standaloneEvents: tree.rootEvents.map((event) => serializeEvent(event)),
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Serialize a namespace or correlation (and its nested groups) to JSON
 */
function serializeGroup(group: ParsedEventGroup): Record<string, unknown> {
  const isCorrelation = group.kind === 'correlation';
  return {
    key: group.key,
    path: group.path,
    type: group.kind,
    doc: group.doc,
    timeout: group.timeout,
    autoEvents: isCorrelation ? group.lifecycleEvents.map(lifecycleSuffix) : undefined,
    lifecycleEvents: isCorrelation ? group.lifecycleEvents.map(serializeEvent) : undefined,
    events: Object.entries(group.events).map(([name, event]) => ({
      name,
      ...serializeEvent(event),
    })),
    groups: Object.entries(group.groups).map(([name, nested]) => ({
      name,
      ...serializeGroup(nested),
    })),
  };
}

/**
 * Serialize event to JSON
 */
function serializeEvent(event: ParsedEvent): Record<string, unknown> {
  return {
    key: event.key,
    level: event.level,
    message: event.message,
    doc: event.doc,
    fields: Object.entries(event.fields).map(([name, field]) => ({
      name,
      type: field.type,
      required: field.required,
      doc: field.doc,
    })),
  };
}
