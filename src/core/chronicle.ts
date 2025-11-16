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

export interface ChronicleBase {
  event<F extends FieldDefinitions>(event: EventDefinition<F>, fields: InferFields<F>): void;
  addContext(context: Record<string, unknown>): void;
  fork(extraContext?: Record<string, unknown>): ChronicleBase;
}

const REQUIRED_LEVELS: LogLevel[] = [...DEFAULT_REQUIRED_LEVELS];

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
  const metadataSnapshot = contextStore.snapshot();

  return {
    eventKey: eventDef.key,
    fields: fieldValidation.normalizedFields,
    correlationId: correlationIdGenerator(),
    metadata: metadataSnapshot,
    timestamp: new Date().toISOString(),
    _validation: validationMetadata,
    _perf: perfSample,
  };
};

const createChronicleInstance = (
  baseConfig: ChroniclerConfig,
  correlationIdGenerator: () => string,
  contextStore: ContextStore,
): ChronicleBase => {
  const chronicle: ChronicleBase = {
    event(eventDef, fields) {
      const payload = buildPayload(
        baseConfig,
        contextStore,
        eventDef,
        fields,
        correlationIdGenerator,
      );
      baseConfig.backend.log(eventDef.level, eventDef.message, payload);
    },
    addContext(context) {
      contextStore.add(context);
    },
    fork(extraContext = {}) {
      const childStore = new ContextStore(contextStore.snapshot());
      if (Object.keys(extraContext).length > 0) {
        childStore.add(extraContext);
      }
      return createChronicleInstance(baseConfig, correlationIdGenerator, childStore);
    },
  };

  return chronicle;
};

export const createChronicle = (config: ChroniclerConfig): ChronicleBase => {
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

  return createChronicleInstance(config, correlationIdGenerator, baseContextStore);
};
