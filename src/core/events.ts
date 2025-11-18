import { LogLevel } from './backend';
import { DEFAULT_CORRELATION_TIMEOUT_MS } from './constants';
import type { FieldDefinitions, InferFields } from './fields';

export type { LogLevel };

export interface EventDefinition<Fields extends FieldDefinitions = FieldDefinitions> {
  key: string;
  level: LogLevel;
  message: string;
  doc: string;
  fields?: Fields;
}

export type EventRecord = Record<string, EventDefinition>;

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

type AutoEventFields = Record<string, FieldDefinitions>;

const correlationAutoFields: AutoEventFields = {
  start: {},
  complete: {
    duration: {
      type: 'number',
      required: false,
      doc: 'Duration of the correlation in milliseconds',
    },
  },
  timeout: {},
  metadataWarning: {
    attemptedKey: { type: 'string', required: true, doc: 'Key attempted to override' },
    existingValue: { type: 'string', required: true, doc: 'Existing value preserved' },
    attemptedValue: { type: 'string', required: true, doc: 'Value that was rejected' },
  },
};

export type CorrelationAutoEvents = {
  [Key in keyof typeof correlationAutoFields]: EventDefinition<(typeof correlationAutoFields)[Key]>;
};

type EmptyEventRecord = Record<never, EventDefinition>;
type WithAutoEvents<Event extends EventRecord | undefined> = (Event extends EventRecord
  ? Event
  : EmptyEventRecord) &
  CorrelationAutoEvents;

export const defineEvent = <Field extends FieldDefinitions>(
  event: EventDefinition<Field>,
): EventDefinition<Field> => event;

export const defineEventGroup = <Group extends SystemEventGroup | CorrelationEventGroup>(
  group: Group,
): Group => group;

export type EventFields<Event extends EventDefinition> =
  Event extends EventDefinition<infer Field>
    ? Field extends FieldDefinitions
      ? InferFields<Field>
      : Record<string, never>
    : never;

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
