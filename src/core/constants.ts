/**
 * Global constants used throughout Chronicler
 */

/**
 * Default correlation timeout in milliseconds (5 minutes)
 */
export const DEFAULT_CORRELATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Root fork ID for the base chronicle instance
 */
export const ROOT_FORK_ID = '0';

/**
 * Separator used in hierarchical fork IDs
 * @example '1.1', '1.2.3'
 */
export const FORK_ID_SEPARATOR = '.';

/**
 * Reserved prefix for Chronicler system events
 * User events cannot start with this prefix
 */
export const SYSTEM_EVENT_PREFIX = 'chronicler.';

/**
 * Conversion factor from microseconds to milliseconds
 * Used for CPU usage calculations
 */
export const MICROSECONDS_TO_MS = 1000;
