/**
 * Shared utility functions used across Chronicler
 */

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
