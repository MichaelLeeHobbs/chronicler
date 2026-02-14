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

const UNKNOWN_LOCATION = { file: '<unknown>', line: 0, column: 0 } as const;

const makeError = (type: ValidationError['type'], message: string): ValidationError => ({
  type,
  message,
  location: UNKNOWN_LOCATION,
});

/**
 * Validate a single event definition
 */
function validateEvent(event: EventDefinition): ValidationError[] {
  const errors: ValidationError[] = [];

  if (event.key.startsWith('chronicler.')) {
    errors.push(
      makeError(
        'reserved-prefix',
        `Event key "${event.key}" uses reserved prefix "chronicler.". This prefix is reserved for internal Chronicler system events.`,
      ),
    );
  }

  const levelString = event.level as string;
  if (!DEFAULT_REQUIRED_LEVELS.includes(levelString as (typeof DEFAULT_REQUIRED_LEVELS)[number])) {
    errors.push(
      makeError(
        'invalid-level',
        `Invalid log level "${event.level}" in event "${event.key}". Valid levels: ${DEFAULT_REQUIRED_LEVELS.join(', ')}`,
      ),
    );
  }

  if (!event.doc) {
    errors.push(makeError('missing-doc', `Event "${event.key}" is missing a "doc" description`));
  }

  if (event.fields) {
    for (const fieldName of Object.keys(event.fields)) {
      if (
        RESERVED_TOP_LEVEL_FIELDS.includes(fieldName as (typeof RESERVED_TOP_LEVEL_FIELDS)[number])
      ) {
        errors.push(
          makeError(
            'reserved-field',
            `Field "${fieldName}" in event "${event.key}" is a reserved field name`,
          ),
        );
      }
    }
  }

  return errors;
}

/**
 * Validate event group and its hierarchy (iterative)
 */
function validateGroup(rootGroup: ParsedEventGroup, parentKey = ''): ValidationError[] {
  const errors: ValidationError[] = [];
  const stack: { group: ParsedEventGroup; parentKey: string }[] = [{ group: rootGroup, parentKey }];

  while (stack.length > 0) {
    const { group, parentKey: parent } = stack.pop()!;
    const expectedPrefix = parent ? `${parent}.` : '';

    if (parent && !group.key.startsWith(expectedPrefix)) {
      errors.push(
        makeError('key-path', `Group key "${group.key}" should start with "${expectedPrefix}"`),
      );
    }

    for (const [name, event] of Object.entries(group.events)) {
      const expectedKey = `${group.key}.${name}`;
      if (event.key !== expectedKey) {
        errors.push(
          makeError(
            'key-path',
            `Event key "${event.key}" should be "${expectedKey}" based on its position in the hierarchy`,
          ),
        );
      }
      errors.push(...validateEvent(event));
    }

    if (group.type === 'correlation' && group.timeout !== undefined && group.timeout < 0) {
      errors.push(
        makeError(
          'invalid-timeout',
          `Correlation group "${group.key}" has invalid timeout: ${group.timeout}. Must be non-negative.`,
        ),
      );
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
