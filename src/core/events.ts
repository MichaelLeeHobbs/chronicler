import { LogLevel } from './backend';
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

const DEFAULT_CORRELATION_TIMEOUT = 300_000;

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

export const defineCorrelationGroup = <Group extends CorrelationEventGroup>(
  group: Group,
): Omit<Group, 'events' | 'timeout'> & {
  events: WithAutoEvents<Group['events']>;
  timeout: number;
} => {
  const autoEvents = buildAutoEvents(group.key);

  return {
    ...group,
    timeout: group.timeout ?? DEFAULT_CORRELATION_TIMEOUT,
    events: {
      ...(group.events ?? {}),
      ...autoEvents,
    } as WithAutoEvents<Group['events']>,
  };
};

export type EventFields<Event extends EventDefinition> =
  Event extends EventDefinition<infer Field>
    ? Field extends FieldDefinitions
      ? InferFields<Field>
      : Record<string, never>
    : never;
