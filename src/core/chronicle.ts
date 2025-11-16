import { ensureBackendSupportsLevels, type LogBackend, type LogPayload } from './backend';
import { ContextStore } from './context';
import {
  DEFAULT_REQUIRED_LEVELS,
  InvalidConfigError,
  ReservedFieldError,
  UnsupportedLogLevelError,
} from './errors';
import type { EventDefinition, LogLevel } from './events';
import type { FieldDefinitions, InferFields } from './fields';
import { type PerfOptions, samplePerformance } from './perf';
import { assertNoReservedKeys } from './reserved';
import { buildValidationMetadata, validateFields } from './validation';

export interface ChroniclerConfig {
  backend: LogBackend;
  metadata: Record<string, string | number | boolean | null>;
  correlationIdGenerator?: () => string;
  monitoring?: PerfOptions;
}

const REQUIRED_LEVELS: LogLevel[] = [...DEFAULT_REQUIRED_LEVELS];

export interface Chronicler {
  event<F extends FieldDefinitions>(event: EventDefinition<F>, fields: InferFields<F>): void;
  addContext(context: Record<string, unknown>): void;
}

const buildPayload = (
  config: ChroniclerConfig,
  contextStore: ContextStore,
  eventDef: EventDefinition,
  fields: InferFields<FieldDefinitions>,
  correlationIdGenerator: () => string,
): LogPayload => {
  const fieldValidation = validateFields(eventDef, fields);
  const validationMetadata = buildValidationMetadata(
    fieldValidation,
    contextStore.consumeCollisions(),
  );
  const perfSample = samplePerformance(config.monitoring ?? {});
  const payload: LogPayload = {
    eventKey: eventDef.key,
    fields: fieldValidation.normalizedFields,
    correlationId: correlationIdGenerator(),
    metadata: contextStore.snapshot(),
    timestamp: new Date().toISOString(),
  };

  if (validationMetadata) {
    payload._validation = validationMetadata;
  }

  if (perfSample) {
    payload._perf = perfSample;
  }

  return payload;
};

export const createChronicle = (config: ChroniclerConfig): Chronicler => {
  if (!config.backend) {
    throw new InvalidConfigError('A backend must be provided');
  }

  const unsupported = ensureBackendSupportsLevels(config.backend, REQUIRED_LEVELS);
  if (unsupported.length > 0) {
    throw new UnsupportedLogLevelError(unsupported.join(', '));
  }

  const reservedMetadata = assertNoReservedKeys(config.metadata);
  if (reservedMetadata.length > 0) {
    throw new ReservedFieldError(reservedMetadata);
  }

  const baseContextStore = new ContextStore(config.metadata);
  const correlationIdGenerator =
    config.correlationIdGenerator ?? (() => `${config.metadata.hostname ?? 'host'}_${Date.now()}`);

  const chronicle: Chronicler = {
    event(eventDef, fields) {
      const payload = buildPayload(
        config,
        baseContextStore,
        eventDef,
        fields,
        correlationIdGenerator,
      );
      config.backend.log(eventDef.level, eventDef.message, payload);
    },
    addContext(context) {
      baseContextStore.add(context);
    },
  };

  return chronicle;
};
