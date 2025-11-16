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
  type: 'key-path' | 'reserved-field' | 'invalid-level' | 'invalid-timeout' | 'parse-error';
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

/**
 * Result of event parsing
 */
export interface ParseResult {
  success: boolean;
  tree?: ParsedEventTree;
  errors: ValidationError[];
}
