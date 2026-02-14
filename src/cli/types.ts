/**
 * Shared types for CLI operations
 */

import type { EventDefinition } from '../core/events';

/**
 * Parsed event tree structure
 */
export interface ParsedEventTree {
  events: EventDefinition[];
  groups: ParsedEventGroup[];
  errors: ValidationError[];
}

/**
 * Event group with nested structure
 */
export interface ParsedEventGroup {
  key: string;
  type: 'system' | 'correlation';
  doc: string;
  timeout?: number;
  events: Record<string, EventDefinition>;
  groups: Record<string, ParsedEventGroup>;
}

/**
 * Validation error with location information
 */
export interface ValidationError {
  type:
    | 'key-path'
    | 'reserved-field'
    | 'reserved-prefix'
    | 'invalid-level'
    | 'invalid-timeout'
    | 'missing-doc'
    | 'parse-error';
  message: string;
  location: ErrorLocation;
}

/**
 * Location of an error in source code
 */
export interface ErrorLocation {
  file: string;
  line: number;
  column: number;
}
