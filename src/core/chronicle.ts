import * as os from 'node:os';

import {
  callBackendMethod,
  DEFAULT_REQUIRED_LEVELS,
  type LogBackend,
  type LogPayload,
  validateBackendMethods,
  type ValidationMetadata,
} from './backend';
import { type ContextCollisionDetail, ContextStore, type ContextValidationResult } from './context';
import { InvalidConfigError, ReservedFieldError, UnsupportedLogLevelError } from './errors';
import {
  type CorrelationAutoEvents,
  type CorrelationEventGroup,
  defineCorrelationGroup,
  type EventDefinition,
  type EventRecord,
  type LogLevel,
} from './events';
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
const DEFAULT_HOSTNAME = process.env.HOSTNAME ?? os.hostname();

export interface Chronicler {
  event<F extends FieldDefinitions>(event: EventDefinition<F>, fields: InferFields<F>): void;

  addContext(context: Record<string, unknown>): void;

  startCorrelation(
    group: CorrelationEventGroup,
    metadata?: Record<string, unknown>,
  ): CorrelationChronicle;

  fork(context?: Record<string, unknown>): Chronicler;
}

export interface CorrelationChronicle extends Chronicler {
  complete(fields?: Record<string, unknown>): void;

  timeout(): void;
}

const buildPayload = (
  config: ChroniclerConfig,
  contextStore: ContextStore,
  eventDef: EventDefinition,
  fields: InferFields<FieldDefinitions>,
  correlationIdProvider: () => string,
  forkId: string,
  validationOverrides?: Partial<ValidationMetadata>,
): LogPayload => {
  const fieldValidation = validateFields(eventDef, fields);
  const validationMetadata = buildValidationMetadata(
    fieldValidation,
    contextStore.consumeCollisions(),
    validationOverrides,
  );
  const perfSample = samplePerformance(config.monitoring ?? {});
  const payload: LogPayload = {
    eventKey: eventDef.key,
    fields: fieldValidation.normalizedFields,
    correlationId: correlationIdProvider(),
    forkId,
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

interface ChronicleHooks {
  onActivity?: () => void;
  onContextValidation?: (validation: ContextValidationResult) => void;
}

type NormalizedCorrelationGroup = Omit<CorrelationEventGroup, 'events' | 'timeout'> & {
  timeout: number;
  events: EventRecord & CorrelationAutoEvents;
};

const createChronicleInstance = (
  config: ChroniclerConfig,
  contextStore: ContextStore,
  correlationIdProvider: () => string,
  correlationIdGenerator: () => string,
  forkId: string,
  hooks: ChronicleHooks = {},
): Chronicler => {
  let forkCounter = 0;

  return {
    event(eventDef, fields) {
      const payload = buildPayload(
        config,
        contextStore,
        eventDef,
        fields,
        correlationIdProvider,
        forkId,
      );
      callBackendMethod(config.backend, eventDef.level, eventDef.message, payload);
      hooks.onActivity?.();
    },
    addContext(context) {
      const validation = contextStore.add(context);
      hooks.onContextValidation?.(validation);
    },
    fork(extraContext = {}) {
      forkCounter++;
      const childForkId = forkId === '0' ? String(forkCounter) : `${forkId}.${forkCounter}`;
      const forkStore = new ContextStore(contextStore.snapshot());
      const forkChronicle = createChronicleInstance(
        config,
        forkStore,
        correlationIdProvider,
        correlationIdGenerator,
        childForkId,
        hooks,
      );
      if (Object.keys(extraContext).length > 0) {
        forkChronicle.addContext(extraContext);
      }
      return forkChronicle;
    },
    startCorrelation(group, metadata = {}) {
      const definedGroup = defineCorrelationGroup(group) as NormalizedCorrelationGroup;
      const correlationStore = new ContextStore({ ...contextStore.snapshot(), ...metadata });
      const correlationId = correlationIdGenerator();
      return new CorrelationChronicleImpl(
        config,
        definedGroup,
        correlationStore,
        () => correlationId,
        correlationIdGenerator,
        forkId,
      );
    },
  };
};

class CorrelationChronicleImpl implements CorrelationChronicle {
  private readonly delegate: Chronicler;
  private readonly timer: CorrelationTimer;
  private completed = false;
  private completionCount = 0;
  private readonly startedAt = Date.now();
  private readonly autoEvents: CorrelationAutoEvents;

  constructor(
    private readonly config: ChroniclerConfig,
    private readonly group: NormalizedCorrelationGroup,
    private readonly contextStore: ContextStore,
    private readonly correlationIdProvider: () => string,
    private readonly correlationIdGenerator: () => string,
    private readonly forkId: string,
  ) {
    this.timer = new CorrelationTimer(this.group.timeout, () => this.timeout());
    this.delegate = createChronicleInstance(
      config,
      contextStore,
      correlationIdProvider,
      correlationIdGenerator,
      forkId,
      {
        onActivity: () => this.timer.touch(),
        onContextValidation: (validation) =>
          this.emitMetadataWarnings(validation.collisionDetails ?? []),
      },
    );
    this.autoEvents = getAutoEvents(this.group.events);
    this.timer.touch();
    this.emitAutoEvent(this.autoEvents.start, {});
  }

  event<F extends FieldDefinitions>(eventDef: EventDefinition<F>, fields: InferFields<F>): void {
    this.delegate.event(eventDef, fields);
  }

  addContext(context: Record<string, unknown>): void {
    this.delegate.addContext(context);
  }

  fork(context?: Record<string, unknown>): Chronicler {
    return this.delegate.fork(context);
  }

  startCorrelation(
    group: CorrelationEventGroup,
    metadata?: Record<string, unknown>,
  ): CorrelationChronicle {
    return this.delegate.startCorrelation(group, metadata);
  }

  complete(fields: Record<string, unknown> = {}): void {
    this.completionCount += 1;
    this.completed = true;
    this.timer.clear();

    const overrides: Partial<ValidationMetadata> | undefined =
      this.completionCount > 1 ? { multipleCompletes: true } : undefined;
    this.emitAutoEvent(
      this.autoEvents.complete,
      { duration: Date.now() - this.startedAt, ...fields },
      overrides,
      false,
    );
  }

  timeout(): void {
    if (this.completed) {
      return;
    }
    this.completed = true;
    this.timer.clear();
    this.emitAutoEvent(this.autoEvents.timeout, {}, undefined, false);
  }

  private emitMetadataWarnings(details: ContextCollisionDetail[]): void {
    if (details.length === 0) {
      return;
    }
    details.forEach((detail) =>
      this.emitAutoEvent(this.autoEvents.metadataWarning, {
        attemptedKey: detail.key,
        existingValue: stringifyValue(detail.existingValue),
        attemptedValue: stringifyValue(detail.attemptedValue),
      }),
    );
  }

  private emitAutoEvent(
    eventDef: EventDefinition,
    fields: Record<string, unknown>,
    overrides?: Partial<ValidationMetadata>,
    touchTimer = true,
  ): void {
    const payload = buildPayload(
      this.config,
      this.contextStore,
      eventDef,
      fields as InferFields<FieldDefinitions>,
      this.correlationIdProvider,
      this.forkId,
      overrides,
    );
    callBackendMethod(this.config.backend, eventDef.level, eventDef.message, payload);
    if (touchTimer) {
      this.timer.touch();
    }
  }
}

class CorrelationTimer {
  private timeoutId?: NodeJS.Timeout;

  constructor(
    private readonly timeoutMs: number,
    private readonly onTimeout: () => void,
  ) {}

  touch(): void {
    this.clear();
    if (this.timeoutMs <= 0) {
      return;
    }
    this.timeoutId = setTimeout(this.onTimeout, this.timeoutMs);
  }

  clear(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  }
}

const stringifyValue = (value: ContextCollisionDetail['existingValue']): string => {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.join(',');
  }
  return String(value);
};

const getAutoEvents = (events: NormalizedCorrelationGroup['events']): CorrelationAutoEvents => {
  const auto = events as CorrelationAutoEvents;
  return {
    start: auto.start,
    complete: auto.complete,
    timeout: auto.timeout,
    metadataWarning: auto.metadataWarning,
  };
};

// no-op helper removal

export const createChronicle = (config: ChroniclerConfig): Chronicler => {
  if (!config.backend) {
    throw new InvalidConfigError('A backend must be provided');
  }

  const missing = validateBackendMethods(config.backend, REQUIRED_LEVELS);
  if (missing.length > 0) {
    throw new UnsupportedLogLevelError(missing.join(', '));
  }

  const reservedMetadata = assertNoReservedKeys(config.metadata);
  if (reservedMetadata.length > 0) {
    throw new ReservedFieldError(reservedMetadata);
  }

  const baseContextStore = new ContextStore(config.metadata);
  const correlationIdGenerator =
    config.correlationIdGenerator ??
    (() => `${config.metadata.hostname ?? DEFAULT_HOSTNAME}_${Date.now()}`);

  return createChronicleInstance(
    config,
    baseContextStore,
    () => correlationIdGenerator(),
    correlationIdGenerator,
    '0',
  );
};
