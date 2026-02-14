/**
 * Shared utility functions used across Chronicler
 */

import type { ContextValue } from './context-store';

/**
 * Check if a value is a simple, serializable value
 * Simple values: string, number, boolean, null
 * Arrays are NOT simple (they're complex nested structures)
 *
 * @param value - Value to check
 * @returns True if value is a simple primitive
 */
export const isSimpleValue = (value: unknown): value is string | number | boolean | null => {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
};

/**
 * Convert ContextValue to string for logging
 *
 * @param value - Value to stringify
 * @returns String representation
 */
export const stringifyValue = (value: ContextValue): string => {
  if (value === null) return 'null';
  return String(value);
};
