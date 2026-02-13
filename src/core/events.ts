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
  readonly doc: string;
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
  key: string;
  type: 'system';
  doc: string;
  events?: EventRecord;
  groups?: Record<string, SystemEventGroup | CorrelationEventGroup>;
}

export interface CorrelationEventGroup {
  key: string;
  type: 'correlation';
  doc: string;
  timeout?: number;
  events?: EventRecord;
  groups?: Record<string, SystemEventGroup | CorrelationEventGroup>;
}

const correlationAutoFields = {
  start: {},
  complete: {
    duration: t.number().optional().doc('Duration of the correlation in milliseconds'),
  },
  timeout: {},
  metadataWarning: {
    attemptedKey: t.string().doc('Key attempted to override'),
    existingValue: t.string().doc('Existing value preserved'),
    attemptedValue: t.string().doc('Value that was rejected'),
  },
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

/**
 * Define an event with compile-time type safety
 * Use `as const` for full type inference
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
 *   }
 * } as const);
 * ```
 */
export const defineEvent = <
  const Key extends string,
  const Fields extends Record<string, FieldBuilder<string, boolean>>,
>(
  event: EventDefinition<Key, Fields>,
): EventDefinition<Key, Fields> => event;

/**
 * Define a system or correlation event group for organizational purposes.
 *
 * Groups provide a namespace hierarchy for events. For correlation groups,
 * prefer {@link defineCorrelationGroup} which adds automatic lifecycle events.
 *
 * @param group - Event group definition (system or correlation)
 * @returns The same group definition, typed for compile-time inference
 */
export const defineEventGroup = <Group extends SystemEventGroup | CorrelationEventGroup>(
  group: Group,
): Group => group;

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
  timeout: {
    key: `${groupKey}.timeout`,
    level: 'warn',
    message: `${groupKey} timed out`,
    doc: 'Auto-generated correlation timeout event',
  },
  metadataWarning: {
    key: `${groupKey}.metadataWarning`,
    level: 'warn',
    message: 'Metadata collision detected',
    doc: 'Logged when metadata overrides are attempted',
    fields: correlationAutoFields.metadataWarning,
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
 * - `{key}.timeout` - Emitted if no activity within timeout period
 * - `{key}.metadataWarning` - Emitted on context collisions (deprecated, see system events)
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
 * // - requestGroup.events.metadataWarning
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

  return {
    ...group,
    timeout: group.timeout ?? DEFAULT_CORRELATION_TIMEOUT_MS,
    events: {
      ...(group.events ?? {}),
      ...autoEvents,
    } as WithAutoEvents<Group['events']>,
  };
};
