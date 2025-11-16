import type { LogLevel } from './errors';
import type { FieldDefinitions, InferFields } from './fields';

export type { LogLevel };

export interface EventDefinition<F extends FieldDefinitions = FieldDefinitions> {
  key: string;
  level: LogLevel;
  message: string;
  doc: string;
  fields?: F;
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
  complete: {},
  timeout: {},
  metadataWarning: {
    attemptedKey: { type: 'string', required: true, doc: 'Key attempted to override' },
    existingValue: { type: 'string', required: true, doc: 'Existing value preserved' },
    attemptedValue: { type: 'string', required: true, doc: 'Value that was rejected' },
  },
};

export type CorrelationAutoEvents = {
  [K in keyof typeof correlationAutoFields]: EventDefinition<(typeof correlationAutoFields)[K]>;
};

type EmptyEventRecord = Record<never, EventDefinition>;
type WithAutoEvents<E extends EventRecord | undefined> = (E extends EventRecord
  ? E
  : EmptyEventRecord) &
  CorrelationAutoEvents;

export const defineEvent = <F extends FieldDefinitions>(
  event: EventDefinition<F>,
): EventDefinition<F> => event;

export const defineEventGroup = <G extends SystemEventGroup | CorrelationEventGroup>(group: G): G =>
  group;

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

export const defineCorrelationGroup = <G extends CorrelationEventGroup>(
  group: G,
): Omit<G, 'events' | 'timeout'> & { events: WithAutoEvents<G['events']>; timeout: number } => {
  const autoEvents = buildAutoEvents(group.key);

  return {
    ...group,
    timeout: group.timeout ?? DEFAULT_CORRELATION_TIMEOUT,
    events: {
      ...(group.events ?? {}),
      ...autoEvents,
    } as WithAutoEvents<G['events']>,
  };
};

export type EventFields<T extends EventDefinition> =
  T extends EventDefinition<infer F>
    ? F extends FieldDefinitions
      ? InferFields<F>
      : Record<string, never>
    : never;
