import type { LogBackend, LogPayload } from './core/backend';
import {
  BACKEND_HOOK,
  type BackendHook,
  type ChroniclerConfig,
  createChronicle,
} from './core/chronicle';
import type { Chronicle } from './core/chronicle-types';
import { DEFAULT_REQUIRED_LEVELS, type LogLevel } from './core/constants';
import type { CheckCatalog } from './core/events';

/** One event captured in a test. */
export interface EmittedEvent {
  readonly level: LogLevel;
  readonly message: string;
  readonly payload: LogPayload;
}

/** Anything with an event key: an event definition from the catalog, or an emitter. */
export interface HasKey {
  readonly key: string;
}

/** Events recorded in memory, with helpers to assert on them. */
export interface EventRecorder {
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

/** A chronicle that records events in memory instead of sending them to a backend. */
export interface TestChronicle<C> extends EventRecorder {
  /** The emitter tree, as returned by `createChronicle`. */
  readonly chronicle: Chronicle<C>;
}

/** Recording attached to an existing chronicle by {@link captureEvents}. */
export interface EventCapture extends EventRecorder {
  /** Stop recording and send events to the chronicle's own backend again. */
  restore(): void;
}

const matches = (actual: Record<string, unknown>, expected: Record<string, unknown>): boolean =>
  Object.entries(expected).every(([key, value]) => Object.is(actual[key], value));

const createRecorder = (): EventRecorder & { readonly backend: LogBackend } => {
  const emitted: EmittedEvent[] = [];
  const backend = Object.fromEntries(
    DEFAULT_REQUIRED_LEVELS.map((level) => [
      level,
      (message: string, payload: LogPayload) => {
        emitted.push({ level, message, payload });
      },
    ]),
  ) as unknown as LogBackend;
  const eventsOf = (event: HasKey) => emitted.filter((e) => e.payload.eventKey === event.key);
  return {
    backend,
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
  const { backend, ...recorder } = createRecorder();
  const chronicle = createChronicle<C>({ ...config, events, backend });
  return { chronicle, ...recorder };
};

/**
 * Record the events of an existing chronicle, such as the one your app exports, instead of
 * sending them to its backend. Covers every emitter, fork and correlation of that chronicle.
 * Call `restore()` when done (e.g. in `afterEach`). A lazy `backend` function is never called
 * while capturing, so tests don't create real transports.
 *
 * @example
 * ```typescript
 * import { chronicle } from '../src/logger';
 * import { events } from '../src/events';
 *
 * const capture = captureEvents(chronicle);
 * await loginHandler(req, res); // calls admin.login(...) internally
 * capture.assertEmitted(events.admin.login, { success: true });
 * capture.restore();
 * ```
 *
 * @throws {TypeError} If `chronicle` was not created by `createChronicle`
 */
export const captureEvents = (chronicle: object): EventCapture => {
  const hook = (chronicle as Record<symbol, BackendHook | undefined>)[BACKEND_HOOK];
  if (hook === undefined) {
    throw new TypeError('captureEvents() needs a chronicle created by createChronicle().');
  }
  const { backend, ...recorder } = createRecorder();
  const previous = hook.setOverride(backend);
  let restored = false;
  return {
    ...recorder,
    restore() {
      if (restored) return;
      restored = true;
      hook.setOverride(previous);
    },
  };
};
