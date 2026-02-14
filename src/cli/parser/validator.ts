/**
 * Validation rules for event definitions
 */

import { DEFAULT_REQUIRED_LEVELS } from '../../core/constants';
import type { EventDefinition } from '../../core/events';
import { RESERVED_TOP_LEVEL_FIELDS } from '../../core/reserved';
import type { ParsedEventGroup, ParsedEventTree, ValidationError } from '../types';

/**
 * Validate parsed event tree
 */
export function validateEventTree(tree: ParsedEventTree): ValidationError[] {
  const errors: ValidationError[] = [...tree.errors];

  // Validate each event
  tree.events.forEach((event) => {
    errors.push(...validateEvent(event));
  });

  // Validate each group
  tree.groups.forEach((group) => {
    errors.push(...validateGroup(group));
  });

  return errors;
}

/**
 * Validate a single event definition
 */
export function validateEvent(event: EventDefinition): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate reserved event key prefix
  if (event.key.startsWith('chronicler.')) {
    errors.push({
      type: 'reserved-prefix',
      message: `Event key "${event.key}" uses reserved prefix "chronicler.". This prefix is reserved for internal Chronicler system events.`,
      location: {
        file: '<unknown>',
        line: 0,
        column: 0,
      },
    });
  }

  // Validate log level
  const levelString = event.level as string;
  if (!DEFAULT_REQUIRED_LEVELS.includes(levelString as (typeof DEFAULT_REQUIRED_LEVELS)[number])) {
    errors.push({
      type: 'invalid-level',
      message: `Invalid log level "${event.level}" in event "${event.key}". Valid levels: ${DEFAULT_REQUIRED_LEVELS.join(', ')}`,
      location: {
        file: '<unknown>',
        line: 0,
        column: 0,
      },
    });
  }

  // Warn if doc is missing
  if (!event.doc) {
    errors.push({
      type: 'missing-doc',
      message: `Event "${event.key}" is missing a "doc" description`,
      location: {
        file: '<unknown>',
        line: 0,
        column: 0,
      },
    });
  }

  // Validate reserved fields
  if (event.fields) {
    Object.keys(event.fields).forEach((fieldName) => {
      if (
        RESERVED_TOP_LEVEL_FIELDS.includes(fieldName as (typeof RESERVED_TOP_LEVEL_FIELDS)[number])
      ) {
        errors.push({
          type: 'reserved-field',
          message: `Field "${fieldName}" in event "${event.key}" is a reserved field name`,
          location: {
            file: '<unknown>',
            line: 0,
            column: 0,
          },
        });
      }
    });
  }

  return errors;
}

/**
 * Validate event group and its hierarchy (iterative)
 */
export function validateGroup(rootGroup: ParsedEventGroup, parentKey = ''): ValidationError[] {
  const errors: ValidationError[] = [];
  const stack: { group: ParsedEventGroup; parentKey: string }[] = [{ group: rootGroup, parentKey }];

  while (stack.length > 0) {
    const { group, parentKey: parent } = stack.pop()!;
    const expectedPrefix = parent ? `${parent}.` : '';

    if (parent && !group.key.startsWith(expectedPrefix)) {
      errors.push({
        type: 'key-path',
        message: `Group key "${group.key}" should start with "${expectedPrefix}"`,
        location: { file: '<unknown>', line: 0, column: 0 },
      });
    }

    Object.entries(group.events).forEach(([name, event]) => {
      const expectedKey = `${group.key}.${name}`;
      if (event.key !== expectedKey) {
        errors.push({
          type: 'key-path',
          message: `Event key "${event.key}" should be "${expectedKey}" based on its position in the hierarchy`,
          location: { file: '<unknown>', line: 0, column: 0 },
        });
      }
      errors.push(...validateEvent(event));
    });

    if (group.type === 'correlation' && group.timeout !== undefined && group.timeout < 0) {
      errors.push({
        type: 'invalid-timeout',
        message: `Correlation group "${group.key}" has invalid timeout: ${group.timeout}. Must be non-negative.`,
        location: { file: '<unknown>', line: 0, column: 0 },
      });
    }

    for (const nestedGroup of Object.values(group.groups)) {
      stack.push({ group: nestedGroup, parentKey: group.key });
    }
  }

  return errors;
}

/**
 * Format validation errors for display
 */
export function formatErrors(errors: ValidationError[]): string {
  if (errors.length === 0) {
    return 'No errors found.';
  }

  const lines = errors.map((error) => {
    const location =
      error.location.line > 0
        ? `${error.location.file}:${error.location.line}:${error.location.column}`
        : error.location.file;
    return `  ${location}\n    ${error.type}: ${error.message}`;
  });

  return `Found ${errors.length} error(s):\n${lines.join('\n')}`;
}
