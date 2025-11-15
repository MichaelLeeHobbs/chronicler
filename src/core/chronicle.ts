import { ensureBackendSupportsLevels, type LogBackend } from './backend';
import { ContextStore } from './context';
import {
  DEFAULT_REQUIRED_LEVELS,
  InvalidConfigError,
  ReservedFieldError,
  UnsupportedLogLevelError,
} from './errors';
import type { EventDefinition, LogLevel } from './events';
import type { FieldDefinitions, InferFields } from './fields';
import { assertNoReservedKeys } from './reserved';

export interface ChroniclerConfig {
  backend: LogBackend;
  metadata: Record<string, string | number | boolean | null>;
  correlationIdGenerator?: () => string;
}

const REQUIRED_LEVELS = DEFAULT_REQUIRED_LEVELS as readonly LogLevel[];

export interface Chronicler {
  event<F extends FieldDefinitions>(event: EventDefinition<F>, fields: InferFields<F>): void;

  addContext(context: Record<string, unknown>): void;
}

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
      config.backend.log(eventDef.level, eventDef.message, {
        eventKey: eventDef.key,
        fields,
        correlationId: correlationIdGenerator(),
        metadata: baseContextStore.snapshot(),
      });
    },
    addContext(context) {
      baseContextStore.add(context);
    },
  };

  return chronicle;
};
