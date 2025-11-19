import {
  callBackendMethod,
  type LogBackend,
  type LogPayload,
  validateBackendMethods,
  type ValidationMetadata,
} from './backend';
import {
  DEFAULT_HOSTNAME,
  DEFAULT_REQUIRED_LEVELS,
  FORK_ID_SEPARATOR,
  ROOT_FORK_ID,
} from './constants';
import {
  type ContextCollisionDetail,
  type ContextRecord,
  ContextStore,
  type ContextValidationResult,
} from './ContextStore';
import { CorrelationTimer } from './CorrelationTimer';
import { InvalidConfigError, ReservedFieldError, UnsupportedLogLevelError } from './errors';
import {
  type CorrelationAutoEvents,
  type CorrelationEventGroup,
  defineCorrelationGroup,
  type EventDefinition,
  type EventFields,
  type EventRecord,
} from './events';
import { type PerfContext, type PerfOptions, samplePerformance } from './perf';
import { assertNoReservedKeys } from './reserved';
import { chroniclerSystemEvents } from './system-events';
import { stringifyValue } from './utils';
import { buildValidationMetadata, validateFields } from './validation';

export interface ChroniclerConfig {
  backend: LogBackend;
  metadata: Record<string, string | number | boolean | null>;
  correlationIdGenerator?: () => string;
  monitoring?: PerfOptions;
}

export interface Chronicler {
  event<E extends EventDefinition>(event: E, fields: EventFields<E>): void;

  addContext(context: ContextRecord): void;

  startCorrelation(group: CorrelationEventGroup, metadata?: ContextRecord): CorrelationChronicle;

  fork(context?: ContextRecord): Chronicler;
}

/**
 * A correlation represents a logical unit of work with a defined lifecycle.
 *
 * Unlike a root Chronicler, a correlation:
 * - Has a single shared correlation ID for all events
 * - Has lifecycle events (start, complete, timeout, metadataWarning)
 * - Can timeout if not completed within the configured duration
 * - Cannot start nested correlations (use fork() for parallel work within a correlation)
 */
export interface CorrelationChronicle {
  event<E extends EventDefinition>(event: E, fields: EventFields<E>): void;

  addContext(context: ContextRecord): void;

  fork(context?: ContextRecord): Chronicler;

  complete(fields?: ContextRecord): void;

  timeout(): void;
}

/**
 * Build a complete log payload from event definition and runtime data
 *
 * This function orchestrates multiple validation and sampling operations:
 * 1. Field validation - checks required fields and types
 * 2. Validation metadata - aggregates validation errors
 * 3. Performance sampling - captures memory/CPU metrics if enabled
 * 4. Payload assembly - combines all data into final structure
 *
 * **Why not split this function?**
 * While this handles multiple concerns, they're all steps in a linear pipeline
 * that must happen in this order. Splitting would add unnecessary indirection
 * without improving testability (each step has its own unit tests).
 *
 * @param config - Chronicler configuration (backend, metadata, monitoring options)
 * @param contextStore - Context storage for metadata snapshot
 * @param eventDef - Event definition with field requirements
 * @param fields - Actual field values being logged
 * @param currentCorrelationId - Function to get current correlation ID
 * @param forkId - Hierarchical fork identifier (e.g., '0', '1', '1.1')
 * @param perfContext - Performance tracking context (for CPU delta calculations)
 * @param validationOverrides - Additional validation metadata (e.g., from correlations)
 * @returns Complete log payload ready for backend
 *
 * @internal This is an internal implementation detail
 */
const buildPayload = (
  config: ChroniclerConfig,
  contextStore: ContextStore,
  eventDef: EventDefinition,
  fields: Record<string, unknown>,
  currentCorrelationId: () => string,
  forkId: string,
  perfContext?: PerfContext,
  validationOverrides?: Partial<ValidationMetadata>,
): LogPayload => {
  const fieldValidation = validateFields(eventDef, fields);
  const validationMetadata = buildValidationMetadata(fieldValidation, validationOverrides);
  const perfSample = samplePerformance(config.monitoring ?? {}, perfContext);
  const payload: LogPayload = {
    eventKey: eventDef.key,
    fields: fieldValidation.normalizedFields,
    correlationId: currentCorrelationId(),
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

/**
 * Helper to emit system events without going through the type-safe event() method.
 * System events are internal and don't need the same type inference as user events.
 */
const emitSystemEvent = (
  config: ChroniclerConfig,
  contextStore: ContextStore,
  eventDef: EventDefinition,
  fields: Record<string, unknown>,
  currentCorrelationId: () => string,
  forkId: string,
  perfContext?: PerfContext,
): void => {
  const payload = buildPayload(
    config,
    contextStore,
    eventDef,
    fields, // Safe cast for system events
    currentCorrelationId,
    forkId,
    perfContext,
  );
  callBackendMethod(config.backend, eventDef.level, eventDef.message, payload);
};

interface ChronicleHooks {
  onActivity?: () => void;
  onContextValidation?: (validation: ContextValidationResult) => void;
}

type NormalizedCorrelationGroup = Omit<CorrelationEventGroup, 'events' | 'timeout'> & {
  timeout: number;
  events: EventRecord & CorrelationAutoEvents;
};

/**
 * Create a Chronicle instance
 *
 * @param config
 * @param contextStore
 * @param currentCorrelationId - Function that returns the current correlation ID for this chronicle.
 *   For root chronicles: generates a NEW ID each time (no correlation, events are independent).
 *   For correlation chronicles: returns the SAME ID (all events share the correlation ID).
 * @param correlationIdGenerator - Function that creates NEW correlation IDs.
 *   Used when startCorrelation() is called on root chronicles.
 *   Also used by forks to create child correlations.
 * @param forkId
 * @param hooks
 */
const createChronicleInstance = (
  config: ChroniclerConfig,
  contextStore: ContextStore,
  currentCorrelationId: () => string,
  correlationIdGenerator: () => string,
  forkId: string,
  hooks: ChronicleHooks = {},
): Chronicler => {
  let forkCounter = 0;
  const perfContext: PerfContext = {}; // Instance-specific performance context

  return {
    event(eventDef, fields) {
      const payload = buildPayload(
        config,
        contextStore,
        eventDef,
        fields as Record<string, unknown>,
        currentCorrelationId,
        forkId,
        perfContext, // Pass instance-specific context
      );
      callBackendMethod(config.backend, eventDef.level, eventDef.message, payload);
      hooks.onActivity?.();
    },
    addContext(context) {
      const validation = contextStore.add(context);

      // Emit system events for collisions
      validation.collisionDetails.forEach((detail) => {
        emitSystemEvent(
          config,
          contextStore,
          chroniclerSystemEvents.events.contextCollision,
          {
            key: detail.key,
            existingValue: stringifyValue(detail.existingValue),
            attemptedValue: stringifyValue(detail.attemptedValue),
          },
          currentCorrelationId,
          forkId,
          perfContext,
        );
      });

      // Emit system events for reserved field attempts
      validation.reserved.forEach((key) => {
        emitSystemEvent(
          config,
          contextStore,
          chroniclerSystemEvents.events.reservedFieldAttempt,
          { key },
          currentCorrelationId,
          forkId,
          perfContext,
        );
      });

      hooks.onContextValidation?.(validation);
    },
    fork(extraContext = {}) {
      forkCounter++;
      const childForkId =
        forkId === ROOT_FORK_ID
          ? String(forkCounter)
          : `${forkId}${FORK_ID_SEPARATOR}${forkCounter}`;
      const forkStore = new ContextStore(contextStore.snapshot());
      const forkChronicle = createChronicleInstance(
        config,
        forkStore,
        currentCorrelationId,
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
  private readonly timer: CorrelationTimer;
  private completed = false;
  private completionCount = 0;
  private readonly startedAt = Date.now();
  private readonly autoEvents: CorrelationAutoEvents;
  private readonly perfContext: PerfContext = {};
  private forkCounter = 0;

  constructor(
    private readonly config: ChroniclerConfig,
    private readonly group: NormalizedCorrelationGroup,
    private readonly contextStore: ContextStore,
    private readonly currentCorrelationId: () => string,
    private readonly correlationIdGenerator: () => string,
    private readonly forkId: string,
  ) {
    this.timer = new CorrelationTimer(this.group.timeout, () => this.timeout());
    this.autoEvents = getAutoEvents(this.group.events);
    this.timer.start();
    this.emitAutoEvent(this.autoEvents.start, {});
  }

  event<E extends EventDefinition>(eventDef: E, fields: EventFields<E>): void {
    const payload = buildPayload(
      this.config,
      this.contextStore,
      eventDef,
      fields as Record<string, unknown>,
      this.currentCorrelationId,
      this.forkId,
      this.perfContext,
    );
    callBackendMethod(this.config.backend, eventDef.level, eventDef.message, payload);
    this.timer.touch();
  }

  addContext(context: ContextRecord): void {
    const validation = this.contextStore.add(context);

    // Emit system events for collisions
    validation.collisionDetails.forEach((detail) => {
      emitSystemEvent(
        this.config,
        this.contextStore,
        chroniclerSystemEvents.events.contextCollision,
        {
          key: detail.key,
          existingValue: stringifyValue(detail.existingValue),
          attemptedValue: stringifyValue(detail.attemptedValue),
        },
        this.currentCorrelationId,
        this.forkId,
        this.perfContext,
      );
    });

    // Emit system events for reserved field attempts
    validation.reserved.forEach((key) => {
      emitSystemEvent(
        this.config,
        this.contextStore,
        chroniclerSystemEvents.events.reservedFieldAttempt,
        { key },
        this.currentCorrelationId,
        this.forkId,
        this.perfContext,
      );
    });

    // Keep the old metadataWarning emission for backward compatibility
    // (This is for correlation-specific warnings)
    if (validation.collisionDetails && validation.collisionDetails.length > 0) {
      this.emitMetadataWarnings(validation.collisionDetails);
    }
  }

  fork(extraContext: ContextRecord = {}): Chronicler {
    this.forkCounter++;
    const childForkId =
      this.forkId === ROOT_FORK_ID
        ? String(this.forkCounter)
        : `${this.forkId}${FORK_ID_SEPARATOR}${this.forkCounter}`;
    const forkStore = new ContextStore({ ...this.contextStore.snapshot(), ...extraContext });

    const forkChronicle = createChronicleInstance(
      this.config,
      forkStore,
      this.currentCorrelationId,
      this.correlationIdGenerator,
      childForkId,
      {
        onActivity: () => this.timer.touch(),
      },
    );

    if (extraContext && Object.keys(extraContext).length > 0) {
      forkChronicle.addContext(extraContext);
    }

    return forkChronicle;
  }

  complete(fields: ContextRecord = {}): void {
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
      fields,
      this.currentCorrelationId,
      this.forkId,
      this.perfContext,
      overrides,
    );
    callBackendMethod(this.config.backend, eventDef.level, eventDef.message, payload);
    if (touchTimer) {
      this.timer.touch();
    }
  }
}

const getAutoEvents = (events: NormalizedCorrelationGroup['events']): CorrelationAutoEvents => {
  const auto = events as CorrelationAutoEvents;
  return {
    start: auto.start,
    complete: auto.complete,
    timeout: auto.timeout,
    metadataWarning: auto.metadataWarning,
  };
};

export const createChronicle = (config: ChroniclerConfig): Chronicler => {
  if (!config.backend) {
    throw new InvalidConfigError('A backend must be provided');
  }

  const missing = validateBackendMethods(config.backend, DEFAULT_REQUIRED_LEVELS);
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
    ROOT_FORK_ID,
  );
};
