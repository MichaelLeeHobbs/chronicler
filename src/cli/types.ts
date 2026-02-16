/**
 * Shared types for CLI operations
 */

import type { EventDefinition } from '../core/events';

/**
 * Parsed event tree structure
 */
export interface ParsedEventTree {
  readonly events: EventDefinition[];
  readonly groups: ParsedEventGroup[];
  readonly errors: ValidationError[];
}

/**
 * Event group with nested structure
 */
export interface ParsedEventGroup {
  readonly key: string;
  readonly type: 'system' | 'correlation';
  readonly doc: string;
  readonly timeout?: number;
  readonly events: Record<string, EventDefinition>;
  readonly groups: Record<string, ParsedEventGroup>;
}

/**
 * Validation error from CLI event validation
 */
export interface ValidationError {
  readonly type:
    | 'key-path'
    | 'reserved-field'
    | 'reserved-prefix'
    | 'invalid-level'
    | 'invalid-timeout'
    | 'missing-doc'
    | 'parse-error';
  readonly message: string;
}
