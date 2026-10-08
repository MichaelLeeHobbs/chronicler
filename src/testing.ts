import type { LogPayload } from './core/backend';
import { type ChroniclerConfig, createChronicle } from './core/chronicle';
import type { Chronicle } from './core/chronicle-types';
import { DEFAULT_REQUIRED_LEVELS, type LogLevel } from './core/constants';
import type { CheckCatalog } from './core/events';

/** One event captured by a test chronicle. */
export interface EmittedEvent {
  readonly level: LogLevel;
  readonly message: string;
  readonly payload: LogPayload;
}

/** Anything with an event key: an event definition from the catalog, or an emitter. */
export interface HasKey {
  readonly key: string;
}

/** A chronicle that records events in memory instead of sending them to a backend. */
export interface TestChronicle<C> {
  /** The emitter tree, as returned by `createChronicle`. */
  readonly chronicle: Chronicle<C>;
  /** Every event emitted so far, oldest first. */
  readonly emitted: readonly EmittedEvent[];
  /** Events emitted for one event key. */
  eventsOf(event: HasKey): EmittedEvent[];
  /**
   * Assert that `event` was emitted, optionally with fields that include `fields`.
   * Works with any test runner: throws an `Error` describing what was emitted instead.
   *
   * @returns The first matching event
   */
  assertEmitted(event: HasKey, fields?: Record<string, unknown>): EmittedEvent;
  /** Forget everything emitted so far. */
  clear(): void;
}

const matches = (actual: Record<string, unknown>, expected: Record<string, unknown>): boolean =>
  Object.entries(expected).every(([key, value]) => Object.is(actual[key], value));

/**
 * Create a chronicle for tests. Events are recorded in memory; nothing reaches a real backend.
 *
 * @example
 * ```typescript
 * const t = createTestChronicle(events);
 * t.chronicle.admin.login({ userId: 'u-1', success: true });
 * t.assertEmitted(events.admin.login, { userId: 'u-1' });
 * ```
 */
export const createTestChronicle = <const C extends object>(
  events: C & CheckCatalog<C>,
  config: Omit<ChroniclerConfig<C>, 'events' | 'backend'> = {},
): TestChronicle<C> => {
  const emitted: EmittedEvent[] = [];
  const backend = Object.fromEntries(
    DEFAULT_REQUIRED_LEVELS.map((level) => [
      level,
      (message: string, payload: LogPayload) => {
        emitted.push({ level, message, payload });
      },
    ]),
  ) as unknown as Record<LogLevel, (message: string, payload: LogPayload) => void>;
  const chronicle = createChronicle<C>({ ...config, events, backend });
  const eventsOf = (event: HasKey) => emitted.filter((e) => e.payload.eventKey === event.key);
  return {
    chronicle,
    emitted,
    eventsOf,
    assertEmitted(event, fields = {}) {
      const found = eventsOf(event).find((e) => matches(e.payload.fields, fields));
      if (found) return found;
      const seen = emitted.map(
        (e) => `  ${e.payload.eventKey} ${JSON.stringify(e.payload.fields)}`,
      );
      throw new Error(
        `Expected "${event.key}" to be emitted${Object.keys(fields).length > 0 ? ` with ${JSON.stringify(fields)}` : ''}.\n` +
          (seen.length > 0 ? `Emitted:\n${seen.join('\n')}` : 'Nothing was emitted.'),
      );
    },
    clear() {
      emitted.length = 0;
    },
  };
};
