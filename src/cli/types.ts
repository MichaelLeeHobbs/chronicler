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
 * Validation error with location information
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
  readonly location: ErrorLocation;
}

/**
 * Location of an error in source code
 */
export interface ErrorLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}
