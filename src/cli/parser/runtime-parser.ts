/**
 * Runtime parser for extracting event definitions from TypeScript files.
 * Uses tsx/esm/api to dynamically import the file and inspect exports.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { EventDefinition } from '../../core/events';
import type { FieldBuilder } from '../../core/fields';
import type { ParsedEventGroup, ParsedEventTree } from '../types';

/** Auto-generated event property names added by defineCorrelationGroup */
const CORRELATION_AUTO_EVENTS = new Set(['start', 'complete', 'timeout', 'metadataWarning']);

/**
 * Type guard: is the value an EventDefinition?
 */
function isEventDefinition(value: unknown): value is EventDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === 'string' &&
    typeof v.level === 'string' &&
    typeof v.message === 'string' &&
    typeof v.doc === 'string'
  );
}

/**
 * Type guard: is the value a FieldBuilder?
 */
function isFieldBuilder(value: unknown): value is FieldBuilder<string, boolean> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v._type === 'string' && typeof v._required === 'boolean';
}

interface EventGroupLike {
  key: string;
  type: 'system' | 'correlation';
  doc: string;
  timeout?: number;
  events?: Record<string, unknown>;
  groups?: Record<string, unknown>;
}

/**
 * Type guard: is the value an event group (system or correlation)?
 */
function isEventGroup(value: unknown): value is EventGroupLike {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === 'string' &&
    (v.type === 'system' || v.type === 'correlation') &&
    typeof v.doc === 'string'
  );
}

/**
 * Extract clean field data from a FieldBuilder (strips methods, keeps data).
 */
function extractFields(
  fields: Record<string, unknown>,
): Record<string, FieldBuilder<string, boolean>> | undefined {
  const result: Record<string, FieldBuilder<string, boolean>> = {};
  let hasFields = false;

  for (const [name, value] of Object.entries(fields)) {
    if (isFieldBuilder(value)) {
      result[name] = {
        _type: value._type,
        _required: value._required,
        _doc: value._doc,
      } as FieldBuilder<string, boolean>;
      hasFields = true;
    }
  }

  return hasFields ? result : undefined;
}

/**
 * Convert a runtime event group to a ParsedEventGroup.
 * Filters out auto-generated correlation events (start, complete, timeout, metadataWarning).
 */
function convertGroup(group: EventGroupLike): ParsedEventGroup {
  const events: Record<string, EventDefinition> = {};

  if (group.events) {
    for (const [name, value] of Object.entries(group.events)) {
      // Skip auto-generated correlation events
      if (group.type === 'correlation' && CORRELATION_AUTO_EVENTS.has(name)) {
        continue;
      }
      if (isEventDefinition(value)) {
        const fields = value.fields
          ? extractFields(value.fields as Record<string, unknown>)
          : undefined;
        events[name] = fields
          ? { ...value, fields }
          : { key: value.key, level: value.level, message: value.message, doc: value.doc };
      }
    }
  }

  const nestedGroups: Record<string, ParsedEventGroup> = {};
  if (group.groups) {
    for (const [name, value] of Object.entries(group.groups)) {
      if (isEventGroup(value)) {
        nestedGroups[name] = convertGroup(value);
      }
    }
  }

  const parsed: ParsedEventGroup = {
    key: group.key,
    type: group.type,
    doc: group.doc,
    events,
    groups: nestedGroups,
  };

  if (group.timeout !== undefined) {
    parsed.timeout = group.timeout;
  }

  return parsed;
}

/**
 * Recursively collect all events from a group (including nested groups) into a flat list.
 * Uses a Set of event keys for deduplication.
 */
function collectEventsFromGroup(group: ParsedEventGroup, seen: Set<string>): EventDefinition[] {
  const events: EventDefinition[] = [];

  for (const event of Object.values(group.events)) {
    if (!seen.has(event.key)) {
      seen.add(event.key);
      events.push(event);
    }
  }

  for (const nestedGroup of Object.values(group.groups)) {
    events.push(...collectEventsFromGroup(nestedGroup, seen));
  }

  return events;
}

/**
 * Parse an events file by dynamically importing it via tsx and inspecting exports.
 */
export async function parseEventsFile(filePath: string): Promise<ParsedEventTree> {
  const absolutePath = path.resolve(filePath);
  const events: EventDefinition[] = [];
  const groups: ParsedEventGroup[] = [];
  const seen = new Set<string>();

  const { register } = await import('tsx/esm/api');
  const unregister = register();

  try {
    const fileUrl = pathToFileURL(absolutePath).href;
    const mod = (await import(fileUrl)) as Record<string, unknown>;

    for (const value of Object.values(mod)) {
      if (isEventGroup(value)) {
        const parsed = convertGroup(value);
        groups.push(parsed);
        // Collect events from this group into the flat list
        events.push(...collectEventsFromGroup(parsed, seen));
      } else if (isEventDefinition(value)) {
        if (!seen.has(value.key)) {
          seen.add(value.key);
          const fields = value.fields
            ? extractFields(value.fields as Record<string, unknown>)
            : undefined;
          events.push(
            fields
              ? { ...value, fields }
              : { key: value.key, level: value.level, message: value.message, doc: value.doc },
          );
        }
      }
    }
  } finally {
    void unregister();
  }

  return { events, groups, errors: [] };
}
