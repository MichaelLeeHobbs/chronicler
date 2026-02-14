/**
 * Documentation generator for Chronicler events
 */

import fs from 'node:fs';
import path from 'node:path';

import type { EventDefinition } from '../../core/events';
import type { ChroniclerCliConfig } from '../config';
import type { ParsedEventGroup, ParsedEventTree } from '../types';

/**
 * Generate documentation from parsed event tree
 */
export function generateDocs(tree: ParsedEventTree, config: ChroniclerCliConfig): void {
  const format = config.docs?.format ?? 'markdown';
  const outputPath = config.docs?.outputPath ?? './docs/chronicler-events.md';

  // Prevent path traversal: output must resolve within cwd
  const resolved = path.resolve(outputPath);
  const cwd = process.cwd();
  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    throw new Error(
      `Output path "${outputPath}" resolves outside the project directory. ` +
        `Resolved: ${resolved}, Project: ${cwd}`,
    );
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

  // Write output
  fs.writeFileSync(resolved, content, 'utf-8');
}

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
      lines.push(`- [${group.key}](#${group.key.replace(/\./g, '')})`);
    });
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Document each group
  tree.groups.forEach((group) => {
    lines.push(...generateGroupMarkdown(group));
  });

  // Document standalone events (not in groups)
  const standaloneEvents = tree.events.filter((event) => {
    return !tree.groups.some((group) => {
      return Object.values(group.events).some((e) => e.key === event.key);
    });
  });

  if (standaloneEvents.length > 0) {
    lines.push('## Standalone Events');
    lines.push('');
    standaloneEvents.forEach((event) => {
      lines.push(...generateEventMarkdown(event));
    });
  }

  return lines.join('\n');
}

/**
 * Generate Markdown for an event group
 */
function generateGroupMarkdown(group: ParsedEventGroup, level = 2): string[] {
  const lines: string[] = [];
  const heading = '#'.repeat(level);

  lines.push(`${heading} ${group.key}`);
  lines.push('');

  if (group.type === 'correlation') {
    lines.push('**Type:** Correlation Group');
    if (group.timeout) {
      lines.push(`**Timeout:** ${group.timeout}ms (activity-based)`);
    }
    lines.push('');
  }

  if (group.doc) {
    lines.push(group.doc);
    lines.push('');
  }

  // Auto-generated events for correlation groups
  if (group.type === 'correlation') {
    lines.push('**Auto-Generated Events:**');
    lines.push('');
    lines.push(`- \`${group.key}.start\` - Logged when correlation starts`);
    lines.push(
      `- \`${group.key}.complete\` - Logged when correlation completes (includes \`duration\` field)`,
    );
    lines.push(
      `- \`${group.key}.fail\` - Logged when correlation fails (includes \`duration\` and \`error\` fields)`,
    );
    lines.push(`- \`${group.key}.timeout\` - Logged when correlation times out due to inactivity`);
    lines.push(`- \`${group.key}.metadataWarning\` - Logged when metadata collision is detected`);
    lines.push('');
  }

  // Document events in this group
  Object.values(group.events).forEach((event) => {
    lines.push(...generateEventMarkdown(event, level + 1));
  });

  // Document nested groups
  Object.values(group.groups).forEach((nestedGroup) => {
    lines.push(...generateGroupMarkdown(nestedGroup, level + 1));
  });

  lines.push('---');
  lines.push('');

  return lines;
}

/**
 * Generate Markdown for a single event
 */
function generateEventMarkdown(event: EventDefinition, level = 3): string[] {
  const lines: string[] = [];
  const heading = '#'.repeat(level);

  lines.push(`${heading} ${event.key}`);
  lines.push('');
  lines.push(`**Level:** \`${event.level}\``);
  lines.push(`**Message:** "${event.message}"`);
  lines.push('');
  if (event.doc) {
    lines.push(event.doc);
    lines.push('');
  }

  if (event.fields && Object.keys(event.fields).length > 0) {
    lines.push('**Fields:**');
    lines.push('');

    Object.entries(event.fields).forEach(([name, field]) => {
      const required = field._required ? 'required' : 'optional';
      lines.push(`- **\`${name}\`** (\`${field._type}\`, ${required}): ${field._doc ?? ''}`);
    });

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
    eventCount: tree.events.length,
    groupCount: tree.groups.length,
    groups: tree.groups.map((group) => serializeGroup(group)),
    standaloneEvents: tree.events
      .filter((event) => {
        return !tree.groups.some((group) => {
          return Object.values(group.events).some((e) => e.key === event.key);
        });
      })
      .map((event) => serializeEvent(event)),
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Serialize event group to JSON
 */
function serializeGroup(group: ParsedEventGroup): Record<string, unknown> {
  return {
    key: group.key,
    type: group.type,
    doc: group.doc ?? '',
    timeout: group.timeout,
    autoEvents:
      group.type === 'correlation'
        ? ['start', 'complete', 'fail', 'timeout', 'metadataWarning']
        : undefined,
    events: Object.entries(group.events).map(([name, event]) => ({
      name,
      ...serializeEvent(event),
    })),
    groups: Object.entries(group.groups).map(([name, nestedGroup]) => ({
      name,
      ...serializeGroup(nestedGroup),
    })),
  };
}

/**
 * Serialize event to JSON
 */
function serializeEvent(event: EventDefinition): Record<string, unknown> {
  return {
    key: event.key,
    level: event.level,
    message: event.message,
    doc: event.doc ?? '',
    fields: event.fields
      ? Object.entries(event.fields).map(([name, field]) => ({
          name,
          type: field._type,
          required: field._required,
          doc: field._doc ?? '',
        }))
      : [],
  };
}
