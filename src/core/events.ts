import { LogLevel } from './backend';
import { DEFAULT_CORRELATION_TIMEOUT_MS } from './constants';
import { type FieldBuilder, type InferFields, t } from './fields';

export type { LogLevel };

/**
 * Event definition with compile-time type safety
 */
export interface EventDefinition<
  Key extends string = string,
  Fields extends Record<string, FieldBuilder<string, boolean>> = Record<
    string,
    FieldBuilder<string, boolean>
  >,
> {
  readonly key: Key;
  readonly level: LogLevel;
  readonly message: string;
  readonly doc?: string;
  readonly fields?: Fields;
}

/**
 * Helper to extract field types from an event definition
 */
export type EventFields<E> =
  E extends EventDefinition<string, infer F>
    ? F extends Record<string, FieldBuilder<string, boolean>>
      ? InferFields<F>
      : Record<string, never>
    : never;

export type EventRecord = Record<
  string,
  EventDefinition<string, Record<string, FieldBuilder<string, boolean>>>
>;

export interface SystemEventGroup {
  readonly key: string;
  readonly type: 'system';
  readonly doc?: string;
  readonly events?: EventRecord;
  readonly groups?: Record<string, SystemEventGroup | CorrelationEventGroup>;
}

export interface CorrelationEventGroup {
  readonly key: string;
  readonly type: 'correlation';
  readonly doc?: string;
  readonly timeout?: number;
  readonly events?: EventRecord;
  readonly groups?: Record<string, SystemEventGroup | CorrelationEventGroup>;
}

const correlationAutoFields = {
  start: {},
  complete: {
    duration: t.number().optional().doc('Duration of the correlation in milliseconds'),
  },
  fail: {
    duration: t.number().optional().doc('Duration of the correlation in milliseconds'),
    error: t.error().optional().doc('Error that caused the failure'),
  },
  timeout: {},
};

export type CorrelationAutoEvents = {
  [Key in keyof typeof correlationAutoFields]: EventDefinition<
    string,
    (typeof correlationAutoFields)[Key]
  >;
};

type EmptyEventRecord = Record<
  never,
  EventDefinition<string, Record<string, FieldBuilder<string, boolean>>>
>;
type WithAutoEvents<Event extends EventRecord | undefined> = (Event extends EventRecord
  ? Event
  : EmptyEventRecord) &
  CorrelationAutoEvents;

const EVENT_KEY_RE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;

/**
 * Define an event with compile-time type safety.
 *
 * `as const` is **not required** — `defineEvent` uses TypeScript `const` generic
 * parameters (TS 5.0+), so literal types and field builders are narrowed automatically.
 * You may still add `as const` if you prefer, but it has no effect.
 *
 * @example
 * ```typescript
 * const userCreated = defineEvent({
 *   key: 'user.created',
 *   level: 'info',
 *   message: 'User created',
 *   doc: 'Emitted when a new user is created',
 *   fields: {
 *     userId: t.string().doc('User ID'),
 *     email: t.string(),
 *     age: t.number().optional(),
 *   },
 * });
 * ```
 *
 * @param event - Event definition with key, level, message, optional doc and fields
 * @returns The same event definition, typed for compile-time inference
 * @throws {Error} If the event key does not match the required dotted camelCase format
 */
export const defineEvent = <
  const Key extends string,
  const Fields extends Record<string, FieldBuilder<string, boolean>>,
>(
  event: EventDefinition<Key, Fields>,
): EventDefinition<Key, Fields> => {
  if (!EVENT_KEY_RE.test(event.key)) {
    throw new Error(
      `Invalid event key "${event.key}". Keys must be dotted camelCase identifiers (e.g. "user.created", "http.request.started").`,
    );
  }
  return event;
};

/**
 * Define a system or correlation event group for organizational purposes.
 *
 * Groups provide a namespace hierarchy for events. For correlation groups,
 * prefer {@link defineCorrelationGroup} which adds automatic lifecycle events.
 *
 * @param group - Event group definition (system or correlation)
 * @returns The same group definition, typed for compile-time inference
 */
/**
 * Auto-prefix event keys in a group's events with `${groupKey}.${propertyName}`
 * when the event's key doesn't already start with `${groupKey}.`.
 * Existing fully-qualified keys pass through unchanged.
 */
const prefixEventKeys = (
  groupKey: string,
  events: EventRecord | undefined,
): EventRecord | undefined => {
  if (!events) return events;
  const result: EventRecord = {};
  for (const [name, event] of Object.entries(events)) {
    if (event.key.startsWith(`${groupKey}.`)) {
      result[name] = event;
    } else {
      result[name] = { ...event, key: `${groupKey}.${name}` };
    }
  }
  return result;
};

export const defineEventGroup = <Group extends SystemEventGroup | CorrelationEventGroup>(
  group: Group,
): Group => {
  const prefixed = prefixEventKeys(group.key, group.events);
  if (prefixed !== group.events) {
    return { ...group, events: prefixed } as Group;
  }
  return group;
};

const buildAutoEvents = (groupKey: string): CorrelationAutoEvents => ({
  start: {
    key: `${groupKey}.start`,
    level: 'info',
    message: `${groupKey} started`,
    doc: 'Auto-generated correlation start event',
  },
  complete: {
    key: `${groupKey}.complete`,
    level: 'info',
    message: `${groupKey} completed`,
    doc: 'Auto-generated correlation completion event',
    fields: correlationAutoFields.complete,
  },
  fail: {
    key: `${groupKey}.fail`,
    level: 'error',
    message: `${groupKey} failed`,
    doc: 'Auto-generated correlation failure event',
    fields: correlationAutoFields.fail,
  },
  timeout: {
    key: `${groupKey}.timeout`,
    level: 'warn',
    message: `${groupKey} timed out`,
    doc: 'Auto-generated correlation timeout event',
  },
});

/**
 * Define a correlation event group with automatic lifecycle events
 *
 * **What is a correlation group?**
 * A correlation represents a logical unit of work with a defined lifecycle
 * (start, complete, timeout). Common examples: HTTP requests, batch jobs, workflows.
 *
 * **Automatic events added:**
 * - `{key}.start` - Emitted when startCorrelation() is called
 * - `{key}.complete` - Emitted when complete() is called (includes duration)
 * - `{key}.fail` - Emitted when fail() is called (includes duration and error)
 * - `{key}.timeout` - Emitted if no activity within timeout period
 *
 * **Timeout behavior:**
 * - Defaults to 5 minutes (300,000ms) if not specified
 * - Timer resets on ANY activity (log events, fork creation)
 * - Set to 0 to disable timeout
 *
 * **Type safety:**
 * TypeScript will infer all event keys and field types. The return type
 * includes both your events and the auto-generated lifecycle events.
 *
 * @param group - Correlation group definition
 * @returns Normalized group with auto-events and default timeout
 *
 * @example
 * ```typescript
 * const requestGroup = defineCorrelationGroup({
 *   key: 'api.request',
 *   doc: 'HTTP request lifecycle',
 *   timeout: 30_000, // 30 seconds
 *   events: {
 *     validated: defineEvent({
 *       key: 'api.request.validated',
 *       level: 'debug',
 *       message: 'Request validated',
 *       doc: 'Validation passed',
 *     }),
 *     processed: defineEvent({
 *       key: 'api.request.processed',
 *       level: 'info',
 *       message: 'Request processed',
 *       doc: 'Processing complete',
 *       fields: { statusCode: { type: 'number', required: true } },
 *     }),
 *   },
 * });
 *
 * // Auto-events available:
 * // - requestGroup.events.start
 * // - requestGroup.events.complete
 * // - requestGroup.events.timeout
 * // - requestGroup.events.validated (your event)
 * // - requestGroup.events.processed (your event)
 * ```
 */
export const defineCorrelationGroup = <Group extends CorrelationEventGroup>(
  group: Group,
): Omit<Group, 'events' | 'timeout'> & {
  events: WithAutoEvents<Group['events']>;
  timeout: number;
} => {
  const autoEvents = buildAutoEvents(group.key);
  const prefixed = prefixEventKeys(group.key, group.events) ?? {};

  const autoKeys = Object.keys(autoEvents);
  const conflicts = autoKeys.filter((k) => Object.hasOwn(prefixed, k));
  if (conflicts.length > 0) {
    throw new Error(
      `Correlation group "${group.key}" defines events that collide with auto-generated lifecycle events: ${conflicts.join(', ')}. Rename these events to avoid the conflict.`,
    );
  }

  return {
    ...group,
    timeout: group.timeout ?? DEFAULT_CORRELATION_TIMEOUT_MS,
    events: {
      ...prefixed,
      ...autoEvents,
    } as WithAutoEvents<Group['events']>,
  };
};
